import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { SITE_RECIPES, authoredTilePlacement, groundAssetAt, groundTransformAt } from '../../../public/site-runtime.mjs';
import { FORGE_ROOT } from '../src/config.mjs';
import { sha256 } from '../src/hashing.mjs';
import { auditTransparentPng } from '../src/images/audit-alpha.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { materializeProductionSourceSnapshot, promotionPreview } from '../src/jobs/lifecycle.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';

const WAVE_ID = 'wave4-forest-features';
const TILE = 64;
const FEATURES = new Set(['field.tree', 'field.rock']);
const SPECS = Object.freeze([
  { assetId: 'field.tree', stem: 'field_tree', maxWidth: 60, maxHeight: 60, minCoverage: 0.35, maxCoverage: 0.85 },
  { assetId: 'field.rock', stem: 'field_rock', maxWidth: 56, maxHeight: 48, minCoverage: 0.15, maxCoverage: 0.65 }
]);
const TMP_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', WAVE_ID);
const REVIEW_ROOT = path.join(FORGE_ROOT, 'review');
const AUDIT_RELATIVE = `review/${WAVE_ID}-audit.json`;
const NATIVE_CONTACT_RELATIVE = `review/${WAVE_ID}-native.png`;
const WOODLAND_CONTACT_RELATIVE = 'review/wave4-woodland-representative.png';

function posix(file) {
  return path.relative(FORGE_ROOT, file).split(path.sep).join('/');
}

function labelSvg(text, width, height = 24) {
  const safe = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171b1d"/><text x="6" y="17" font-family="ui-monospace,monospace" font-size="11" fill="#f1ede3">${safe}</text></svg>`);
}

function checkerSvg(width, height, size = 16) {
  const blocks = [];
  for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
    blocks.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${((x / size + y / size) % 2) ? '#435054' : '#2b3438'}"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${blocks.join('')}</svg>`);
}

async function prepareFeature(spec) {
  const rawPath = path.join(TMP_ROOT, 'raw', `${spec.stem}.png`);
  const extractedPath = path.join(TMP_ROOT, 'extracted', `${spec.stem}.png`);
  const preparedPath = path.join(TMP_ROOT, 'prepared', `${spec.stem}.png`);
  const raw = await readFile(rawPath);
  const rawMetadata = await sharp(raw).metadata();
  if (rawMetadata.width < TILE || rawMetadata.height < TILE) throw new Error(`${spec.assetId}: raw source would require enlargement`);

  const trimmed = await sharp(await readFile(extractedPath))
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .png({ palette: false })
    .toBuffer();
  const resized = await sharp(trimmed)
    .resize({
      width: spec.maxWidth,
      height: spec.maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.nearest
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((TILE - resized.info.width) / 2);
  const top = TILE - 1 - resized.info.height;
  const canvas = await sharp({
    create: { width: TILE, height: TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{ input: await sharp(resized.data, { raw: resized.info }).png().toBuffer(), left, top }])
    .ensureAlpha().raw().toBuffer();
  for (let offset = 0; offset < canvas.length; offset += 4) {
    if (canvas[offset + 3] >= 128) canvas[offset + 3] = 255;
    else {
      canvas[offset] = 0;
      canvas[offset + 1] = 0;
      canvas[offset + 2] = 0;
      canvas[offset + 3] = 0;
    }
  }
  const prepared = await sharp(canvas, { raw: { width: TILE, height: TILE, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  await mkdir(path.dirname(preparedPath), { recursive: true });
  await writeFile(preparedPath, prepared);
  const alpha = await auditTransparentPng(prepared);
  const gates = {
    rgba: (await sharp(prepared).metadata()).channels === 4,
    transparentCorners: alpha.cornerAlpha.every((value) => value === 0),
    coverage: alpha.visibleCoverage >= spec.minCoverage && alpha.visibleCoverage <= spec.maxCoverage,
    hardAlpha: alpha.partialAlphaPixels === 0,
    noOpaqueRectangle: alpha.transparentPixels > 0 && alpha.borderVisiblePixels === 0,
    bboxContained: Boolean(alpha.subjectBbox)
      && alpha.subjectBbox.x > 0 && alpha.subjectBbox.y > 0
      && alpha.subjectBbox.x + alpha.subjectBbox.width < TILE
      && alpha.subjectBbox.y + alpha.subjectBbox.height < TILE
  };
  if (Object.values(gates).some((value) => !value)) throw new Error(`${spec.assetId}: technical gates failed ${JSON.stringify({ alpha, gates })}`);
  return { spec, raw, rawMetadata, prepared, preparedPath, alpha, gates };
}

async function importFeature(entry, manifest) {
  const promptRelative = `review/prompts/${WAVE_ID}/${entry.spec.stem}.txt`;
  const prompt = await readFile(path.join(FORGE_ROOT, promptRelative));
  const promptSha256 = sha256(prompt);
  const sourceSha256 = sha256(entry.raw);
  let result = manifest.results.find((candidate) => candidate.assetId === entry.spec.assetId
    && candidate.status === 'pending'
    && candidate.productionRecipe?.waveId === WAVE_ID
    && candidate.productionRecipe?.source?.sha256 === sourceSha256
    && candidate.productionRecipe?.generationPromptSha256 === promptSha256);
  if (!result) {
    const { job } = await buildJob({ assetId: entry.spec.assetId, provider: 'manual-import' });
    const recipe = {
      waveId: WAVE_ID,
      assetId: entry.spec.assetId,
      method: 'imagegen',
      generator: 'codex-imagegen-built-in',
      scaleClass: 'medium',
      generationPromptPath: promptRelative,
      generationPromptSha256: promptSha256,
      toolMode: 'built-in',
      orientationContract: 'non-directional transparent terrain feature overlay; bottom anchored on field.grass',
      transformSteps: ['full-frame', 'chroma-key-remove', 'nearest-downscale', 'hard-alpha'],
      inputReferences: job.referenceImageIds.map((id, index) => ({
        id, sha256: job.referenceImageHashes[index], role: index === 0 ? 'global-style' : 'primary-subject'
      })),
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      source: {
        path: posix(path.join(TMP_ROOT, 'raw', `${entry.spec.stem}.png`)),
        sha256: sourceSha256,
        width: entry.rawMetadata.width,
        height: entry.rawMetadata.height,
        cropRect: null
      },
      backgroundRemoval: {
        method: 'official-chroma-key-helper', keyColor: '#fb03fa', autoKey: 'border', softMatte: true,
        transparentThreshold: 8, opaqueThreshold: 64, despill: true,
        cleanup: {
          alphaCutoff: 128, componentMinPixels: 1,
          targetMaxWidth: entry.spec.maxWidth, targetMaxHeight: entry.spec.maxHeight, resizeKernel: 'nearest'
        }
      },
      canvas: {
        width: TILE,
        height: TILE,
        baselineY: entry.alpha.subjectBbox.y + entry.alpha.subjectBbox.height - 1
      },
      subjectBbox: entry.alpha.subjectBbox
    };
    result = (await importCandidate({ assetId: entry.spec.assetId, file: entry.preparedPath, productionRecipe: recipe })).result;
  }
  const snapshot = await materializeProductionSourceSnapshot({ generationId: result.id });
  const preview = await promotionPreview({ generationId: result.id });
  return { ...entry, result: snapshot.result, preview };
}

async function latestPendingBuffer(manifest, assetId) {
  const result = [...manifest.results].reverse().find((entry) => entry.assetId === assetId && entry.status === 'pending');
  if (!result) throw new Error(`Missing pending candidate for ${assetId}`);
  return readFile(path.join(FORGE_ROOT, result.outputPath));
}

async function renderNativeContact(entries, manifest) {
  const grass = await latestPendingBuffer(manifest, 'field.grass');
  const width = 1120;
  const height = 320;
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const feature = await sharp(entry.prepared).resize(256, 256, { kernel: sharp.kernel.nearest }).png().toBuffer();
    const grassLarge = await sharp(grass).resize(256, 256, { kernel: sharp.kernel.nearest }).png().toBuffer();
    const y = 40;
    const checkerX = 32 + index * 544;
    const grassX = checkerX + 272;
    composites.push({ input: checkerSvg(256, 256), left: checkerX, top: y });
    composites.push({ input: feature, left: checkerX, top: y });
    composites.push({ input: grassLarge, left: grassX, top: y });
    composites.push({ input: feature, left: grassX, top: y });
    composites.push({ input: labelSvg(`${entry.spec.assetId} checker | grass composite`, 520), left: checkerX, top: 8 });
  }
  const destination = path.join(FORGE_ROOT, NATIVE_CONTACT_RELATIVE);
  await sharp({ create: { width, height, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(destination);
  return NATIVE_CONTACT_RELATIVE;
}

async function renderWoodlandSite(recipe, manifest) {
  const ids = new Set(['field.grass']);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 12; x += 1) ids.add(groundAssetAt(recipe, x, y));
  const decorEntries = [...recipe.rearDecor, ...recipe.props, ...recipe.frontOccluders];
  for (const entry of decorEntries) ids.add(entry.assetId);
  const buffers = new Map(await Promise.all([...ids].map(async (id) => [id, await latestPendingBuffer(manifest, id)])));
  const layers = [];
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 12; x += 1) {
    const id = groundAssetAt(recipe, x, y);
    layers.push({ input: buffers.get(FEATURES.has(id) ? 'field.grass' : id), left: x * TILE, top: y * TILE });
  }
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 12; x += 1) {
    const id = groundAssetAt(recipe, x, y);
    if (FEATURES.has(id)) {
      const feature = groundTransformAt(recipe, x, y).flipX
        ? await sharp(buffers.get(id)).flop().png().toBuffer()
        : buffers.get(id);
      layers.push({ input: feature, left: x * TILE, top: y * TILE });
    }
  }
  for (const entry of decorEntries) {
    const placement = authoredTilePlacement(entry);
    const image = placement.flipX
      ? await sharp(buffers.get(entry.assetId)).flop().png().toBuffer()
      : buffers.get(entry.assetId);
    layers.push({ input: image, left: placement.x, top: placement.y });
  }
  return sharp({ create: { width: 768, height: 512, channels: 4, background: '#000000' } })
    .composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

async function renderWoodlandContact(manifest) {
  const sites = ['woodland_hut', 'overgrown_ruin'].map((id) => SITE_RECIPES.find((recipe) => recipe.id === id));
  const composites = [];
  for (const [index, site] of sites.entries()) {
    composites.push({ input: labelSvg(site.label, 768), left: 8, top: 8 + index * 548 });
    composites.push({ input: await renderWoodlandSite(site, manifest), left: 8, top: 36 + index * 548 });
  }
  const destination = path.join(FORGE_ROOT, WOODLAND_CONTACT_RELATIVE);
  await sharp({ create: { width: 784, height: 1096, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(destination);
  return WOODLAND_CONTACT_RELATIVE;
}

async function main() {
  const prepared = [];
  for (const spec of SPECS) prepared.push(await prepareFeature(spec));
  let manifest = await readLocalGenerationManifest(FORGE_ROOT);
  const imported = [];
  for (const entry of prepared) {
    imported.push(await importFeature(entry, manifest));
    manifest = await readLocalGenerationManifest(FORGE_ROOT);
  }
  const nativeContact = await renderNativeContact(imported, manifest);
  const woodlandContact = await renderWoodlandContact(manifest);
  const audit = {
    schemaVersion: 1,
    waveId: WAVE_ID,
    state: 'pending-inspection',
    retiredCandidatePolicy: 'superseded tree/rock candidates are deleted, not rejected or archived; exact retired identifiers are kept out of repository evidence',
    assets: imported.map((entry) => ({
      assetId: entry.spec.assetId,
      generationId: entry.result.id,
      prompt: {
        path: entry.result.productionRecipe.generationPromptPath,
        sha256: entry.result.productionRecipe.generationPromptSha256,
        exactBuiltInCallSnapshot: true
      },
      inputReferences: entry.result.productionRecipe.inputReferences,
      rawSource: entry.result.productionRecipe.source,
      sourceSnapshot: entry.result.productionRecipe.sourceSnapshot,
      candidate: {
        path: entry.result.outputPath,
        sha256: entry.result.outputSha256,
        width: entry.result.outputInspection.width,
        height: entry.result.outputInspection.height
      },
      alpha: entry.alpha,
      gates: entry.gates,
      coverageRange: [entry.spec.minCoverage, entry.spec.maxCoverage],
      promotionPreview: entry.preview
    })),
    contacts: { nativeCheckerAndGrassComposite: nativeContact, woodlandRepresentative: woodlandContact },
    humanApproved: false,
    exported: false,
    observed: [
      'Both candidates are RGBA 64x64 PNGs with transparent corners, hard alpha, contained bounding boxes, and in-range visible coverage.',
      'Both production recipes retain built-in imagegen prompts, two approved reference hashes, raw source snapshots, and promotion previews.',
      'Representative woodland composites paint field.grass before every field.tree/field.rock feature.'
    ],
    inferred: ['The technical gates make square mattes and soft alpha regressions unlikely to reach human review.'],
    unknown: ['human approval', 'final export', 'subjective visual acceptance in every town context']
  };
  await writeFile(path.join(FORGE_ROOT, AUDIT_RELATIVE), `${JSON.stringify(audit, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}

await main();
