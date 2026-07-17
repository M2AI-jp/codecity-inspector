import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { FORGE_ROOT } from '../src/config.mjs';
import { sha256 } from '../src/hashing.mjs';
import { auditTransparentPng } from '../src/images/audit-alpha.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';

const execFileAsync = promisify(execFile);
const WAVE_ID = 'wave1a-buildings';
const CANVAS = Object.freeze({ width: 256, height: 256, baselineY: 244 });
const ALPHA_CUTOFF = 16;
const COMPONENT_MIN_PIXELS = 128;
const RAW_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', 'wave1a', 'raw');
const KEYED_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', 'wave1a', 'keyed');
const PREPARED_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', 'wave1a', 'prepared');
const REVIEW_ROOT = path.join(FORGE_ROOT, 'review');
const PROMPT_ROOT = path.join(REVIEW_ROOT, 'prompts', WAVE_ID);

const BUILDINGS = Object.freeze([
  { id: 'building.inn', file: 'building_inn.png', scaleClass: 'large', max: [210, 210], primary: 'building_inn_sheet.png', compare: [20, 20, 410, 390] },
  { id: 'building.pub', file: 'building_pub.png', scaleClass: 'medium', max: [188, 188], primary: 'building_houses_shops_ruins_sheet.png', compare: [10, 175, 205, 170] },
  { id: 'building.town_hall', file: 'building_town_hall.png', scaleClass: 'landmark', max: [232, 222], primary: 'building_town_hall_sheet.png', compare: [540, 0, 600, 380] },
  { id: 'building.dock', file: 'building_dock.png', scaleClass: 'large', max: [218, 190], primary: 'field_harbor_docks_tiles_sheet.png', compare: [0, 0, 535, 475] },
  { id: 'building.workshop', file: 'building_workshop.png', scaleClass: 'large', max: [214, 205], primary: 'building_workshop_sheet.png', compare: [0, 0, 500, 380] },
  { id: 'building.dojo', file: 'building_dojo.png', scaleClass: 'large', max: [212, 205], primary: 'building_guild_variant_01_sheet.png', compare: [160, 0, 975, 590] },
  { id: 'building.watchtower', file: 'building_watchtower.png', scaleClass: 'landmark', max: [170, 236], primary: 'building_watchtower_sheet.png', compare: [20, 0, 330, 360] },
  { id: 'building.warehouse', file: 'building_warehouse.png', scaleClass: 'large', max: [216, 188], primary: 'building_warehouse_sheet.png', compare: [0, 0, 500, 370] },
  { id: 'building.well', file: 'building_well.png', scaleClass: 'tiny', max: [110, 112], primary: 'object_street_props_sheet.png', compare: [770, 145, 205, 190] },
  { id: 'building.gate', file: 'building_gate.png', scaleClass: 'medium', max: [208, 190], primary: 'object_status_markers_sheet.png', compare: [0, 430, 650, 210] },
  { id: 'building.house.small', file: 'building_house_small.png', scaleClass: 'small', max: [150, 154], primary: 'building_houses_shops_ruins_sheet.png', compare: [0, 0, 175, 175] },
  { id: 'building.house.medium', file: 'building_house_medium.png', scaleClass: 'medium', max: [184, 184], primary: 'building_houses_shops_ruins_sheet.png', compare: [165, 0, 185, 180] },
  { id: 'building.shop', file: 'building_shop.png', scaleClass: 'medium', max: [180, 184], primary: 'building_houses_shops_ruins_sheet.png', compare: [215, 175, 215, 175] },
  { id: 'building.hut', file: 'building_hut.png', scaleClass: 'small', max: [142, 148], primary: 'building_houses_shops_ruins_sheet.png', compare: [680, 175, 205, 180] },
  { id: 'building.ruin', file: 'building_ruin.png', scaleClass: 'medium', max: [184, 178], keepDetached: true, primary: 'building_houses_shops_ruins_sheet.png', compare: [0, 340, 215, 190] },
  { id: 'building.old_house', file: 'building_old_house.png', scaleClass: 'medium', max: [180, 184], primary: 'building_houses_shops_ruins_sheet.png', compare: [210, 335, 215, 200] },
  { id: 'building.guild', file: 'building_guild.png', scaleClass: 'large', max: [218, 210], primary: 'building_guild_variant_01_sheet.png', compare: [160, 0, 975, 590] }
]);

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function labelSvg(text, width, height = 28) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#171b1d"/>
    <text x="8" y="19" font-family="ui-monospace,monospace" font-size="12" fill="#f1ede3">${escapeXml(text)}</text>
  </svg>`);
}

function checkerSvg(width, height, size = 16) {
  const blocks = [];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const fill = ((x / size + y / size) % 2 === 0) ? '#283034' : '#384246';
      blocks.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}"/>`);
    }
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${blocks.join('')}</svg>`);
}

function componentCleanup(data, width, height, { keepDetached = false } = {}) {
  const pixels = width * height;
  const visible = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    if (data[index * 4 + 3] > ALPHA_CUTOFF) visible[index] = 1;
    else data.fill(0, index * 4, index * 4 + 4);
  }
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  const components = [];
  for (let start = 0; start < pixels; start += 1) {
    if (!visible[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const members = [];
    while (head < tail) {
      const current = queue[head++];
      members.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbors = [];
      if (x > 0) neighbors.push(current - 1);
      if (x + 1 < width) neighbors.push(current + 1);
      if (y > 0) neighbors.push(current - width);
      if (y + 1 < height) neighbors.push(current + width);
      for (const next of neighbors) {
        if (visible[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    components.push(members);
  }
  components.sort((left, right) => right.length - left.length);
  const keep = new Uint8Array(pixels);
  const keptComponents = components.filter((component, index) => index === 0
    || (keepDetached && component.length >= COMPONENT_MIN_PIXELS));
  for (const component of keptComponents) {
    for (const index of component) keep[index] = 1;
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let keptPixels = 0;
  for (let index = 0; index < pixels; index += 1) {
    if (!keep[index]) {
      data.fill(0, index * 4, index * 4 + 4);
      continue;
    }
    keptPixels += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (keptPixels === 0) throw new Error('Background cleanup removed the entire candidate');
  return {
    bounds: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    componentCountBefore: components.length,
    componentCountKept: keptComponents.length,
    keptPixels
  };
}

async function prepareCandidate(spec) {
  const keyedPath = path.join(KEYED_ROOT, spec.file);
  const decoded = await sharp(keyedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mutable = Buffer.from(decoded.data);
  const cleanup = componentCleanup(mutable, decoded.info.width, decoded.info.height, { keepDetached: spec.keepDetached });
  const cropped = await sharp(mutable, { raw: decoded.info }).extract(cleanup.bounds)
    .resize(spec.max[0], spec.max[1], { fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.nearest })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  const resized = await sharp(cropped).metadata();
  if (!resized.width || !resized.height || resized.width > cleanup.bounds.width || resized.height > cleanup.bounds.height) {
    throw new Error(`${spec.id}: preparation would enlarge the source`);
  }
  const left = Math.floor((CANVAS.width - resized.width) / 2);
  const top = CANVAS.baselineY - resized.height + 1;
  if (left < 1 || top < 1 || left + resized.width >= CANVAS.width || top + resized.height > CANVAS.height) {
    throw new Error(`${spec.id}: scaled candidate does not have safe transparent margins`);
  }
  const prepared = await sharp({
    create: { width: CANVAS.width, height: CANVAS.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{ input: cropped, left, top }])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  const alpha = await auditTransparentPng(prepared);
  if (!alpha.subjectBbox || alpha.subjectBbox.y + alpha.subjectBbox.height - 1 !== CANVAS.baselineY) {
    throw new Error(`${spec.id}: candidate does not sit on the shared baseline`);
  }
  const output = path.join(PREPARED_ROOT, spec.file);
  await writeFile(output, prepared);
  return { output, prepared, alpha, cleanup };
}

async function perceptualHash(buffer) {
  const raw = await sharp(buffer).flatten({ background: '#30383c' }).greyscale()
    .resize(9, 8, { fit: 'fill', kernel: sharp.kernel.nearest }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? '1' : '0';
  }
  return bits;
}

function hamming(left, right) {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) distance += 1;
  return distance;
}

async function renderNativeContactSheet(entries) {
  const columns = 4;
  const cellWidth = 280;
  const cellHeight = 300;
  const rows = Math.ceil(entries.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = (index % columns) * cellWidth + 12;
    const y = Math.floor(index / columns) * cellHeight + 8;
    composites.push({ input: checkerSvg(256, 256), left: x, top: y });
    composites.push({ input: entry.buffer, left: x, top: y });
    composites.push({ input: labelSvg(`${entry.id} · ${entry.scaleClass}`, 256), left: x, top: y + 260 });
  }
  const output = await sharp({ create: { width, height, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-native.png`), output);
}

async function renderSourceComparison(entries) {
  const columns = 2;
  const cellWidth = 568;
  const cellHeight = 312;
  const rows = Math.ceil(entries.length / columns);
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const baseX = (index % columns) * cellWidth + 8;
    const baseY = Math.floor(index / columns) * cellHeight + 8;
    const referencePath = path.join(FORGE_ROOT, 'references', 'approved', entry.primary);
    const metadata = await sharp(referencePath).metadata();
    const [x, y, desiredWidth, desiredHeight] = entry.compare;
    const extract = {
      left: Math.min(x, metadata.width - 1),
      top: Math.min(y, metadata.height - 1),
      width: Math.min(desiredWidth, metadata.width - Math.min(x, metadata.width - 1)),
      height: Math.min(desiredHeight, metadata.height - Math.min(y, metadata.height - 1))
    };
    const reference = await sharp(referencePath).extract(extract).resize(256, 256, {
      fit: 'contain', background: '#30383c', kernel: sharp.kernel.nearest
    }).png().toBuffer();
    composites.push({ input: reference, left: baseX, top: baseY });
    composites.push({ input: checkerSvg(256, 256), left: baseX + 276, top: baseY });
    composites.push({ input: entry.buffer, left: baseX + 276, top: baseY });
    composites.push({ input: labelSvg(`source → ${entry.id}`, 532), left: baseX, top: baseY + 260 });
  }
  const output = await sharp({
    create: { width: columns * cellWidth, height: rows * cellHeight, channels: 4, background: '#171b1d' }
  }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-source-comparison.png`), output);
}

async function countFiles(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile()).length;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

async function previousApprovedHashes() {
  const { stdout } = await execFileAsync('git', ['show', 'HEAD:tools/asset-forge/data/manifests/approvals.json'], {
    cwd: path.resolve(FORGE_ROOT, '..', '..')
  });
  return new Set(JSON.parse(stdout).approvals.map((entry) => entry.approvedSha256));
}

async function main() {
  if (BUILDINGS.length !== 17 || new Set(BUILDINGS.map((entry) => entry.id)).size !== 17) {
    throw new Error('Wave 1A must define exactly 17 unique building assets');
  }
  await mkdir(PREPARED_ROOT, { recursive: true });
  await mkdir(REVIEW_ROOT, { recursive: true });
  const before = await readLocalGenerationManifest(FORGE_ROOT);
  if (before.results.length !== 0) throw new Error('Wave 1A requires an empty local generation ledger');
  if (await countFiles(path.join(FORGE_ROOT, 'generated', 'buildings', 'pending')) !== 0) {
    throw new Error('Wave 1A requires an empty building pending directory');
  }

  const entries = [];
  for (const spec of BUILDINGS) {
    const rawPath = path.join(RAW_ROOT, spec.file);
    const raw = await readFile(rawPath);
    const rawMetadata = await sharp(raw).metadata();
    const promptFile = spec.file.replace(/\.png$/, '.txt');
    const generationPromptPath = path.posix.join('review', 'prompts', WAVE_ID, promptFile);
    const generationPrompt = await readFile(path.join(PROMPT_ROOT, promptFile));
    const prepared = await prepareCandidate(spec);
    const { job } = await buildJob({ assetId: spec.id, provider: 'manual-import' });
    const productionRecipe = {
      waveId: WAVE_ID,
      assetId: spec.id,
      method: 'imagegen',
      generator: 'codex-imagegen-built-in',
      scaleClass: spec.scaleClass,
      generationPromptPath,
      generationPromptSha256: sha256(generationPrompt),
      toolMode: 'built-in',
      inputReferences: job.referenceImageIds.map((id, index) => ({
        id,
        sha256: job.referenceImageHashes[index],
        role: index === 0 ? 'global-style' : 'primary-subject'
      })),
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      source: {
        path: path.posix.join('tmp', 'imagegen', 'wave1a', 'raw', spec.file),
        sha256: sha256(raw),
        width: rawMetadata.width,
        height: rawMetadata.height,
        cropRect: null,
        comparisonRect: { x: spec.compare[0], y: spec.compare[1], width: spec.compare[2], height: spec.compare[3] }
      },
      backgroundRemoval: {
        method: 'official-chroma-key-helper',
        keyColor: null,
        autoKey: 'border',
        softMatte: true,
        transparentThreshold: 12,
        opaqueThreshold: 220,
        despill: true,
        cleanup: {
          alphaCutoff: ALPHA_CUTOFF,
          componentMinPixels: COMPONENT_MIN_PIXELS,
          targetMaxWidth: spec.max[0],
          targetMaxHeight: spec.max[1],
          resizeKernel: 'nearest'
        }
      },
      canvas: CANVAS,
      subjectBbox: prepared.alpha.subjectBbox
    };
    const imported = await importCandidate({
      assetId: spec.id,
      file: prepared.output,
      productionRecipe
    }, { now: () => '2026-07-14T00:00:00.000Z' });
    const persisted = await readFile(path.join(FORGE_ROOT, imported.result.outputPath));
    entries.push({
      ...spec,
      buffer: persisted,
      result: imported.result,
      alpha: await auditTransparentPng(persisted),
      cleanup: prepared.cleanup,
      perceptualHash: await perceptualHash(persisted)
    });
  }

  const exactHashes = entries.map((entry) => entry.result.outputSha256);
  const pairDistances = [];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      pairDistances.push({
        left: entries[left].id,
        right: entries[right].id,
        hammingDistance: hamming(entries[left].perceptualHash, entries[right].perceptualHash)
      });
    }
  }
  pairDistances.sort((left, right) => left.hammingDistance - right.hammingDistance);
  const oldHashes = await previousApprovedHashes();
  const oldHashMatches = exactHashes.filter((hash) => oldHashes.has(hash));
  const after = await readLocalGenerationManifest(FORGE_ROOT);
  const lifecycleFiles = await countFiles(path.join(FORGE_ROOT, 'data', 'local', 'lifecycle'));
  const approvedBuildingFiles = await countFiles(path.join(FORGE_ROOT, 'generated', 'buildings', 'approved'));
  const gates = {
    exactly17PendingBuildings: after.results.length === 17
      && after.results.every((result) => result.category === 'building' && result.status === 'pending'),
    dimensions256: entries.every((entry) => entry.alpha.width === 256 && entry.alpha.height === 256),
    alphaPresent: entries.every((entry) => entry.alpha.transparentPixels > 0 && entry.alpha.visiblePixels > 0),
    transparentCorners: entries.every((entry) => entry.alpha.cornerAlpha.every((alpha) => alpha === 0)),
    noOpaqueRectangle: entries.every((entry) => entry.alpha.borderVisiblePixels === 0 && entry.alpha.visibleCoverage < 0.72),
    noClipping: entries.every((entry) => entry.alpha.subjectBbox.x > 0 && entry.alpha.subjectBbox.y > 0
      && entry.alpha.subjectBbox.x + entry.alpha.subjectBbox.width < 256
      && entry.alpha.subjectBbox.y + entry.alpha.subjectBbox.height - 1 === CANVAS.baselineY),
    noEmptyCandidate: entries.every((entry) => entry.alpha.visibleCoverage > 0.02),
    exactHashesUnique: new Set(exactHashes).size === entries.length,
    perceptualDistance: pairDistances[0].hammingDistance >= 4,
    recipeProvenanceComplete: entries.every((entry) => entry.result.productionRecipe?.outputSha256 === entry.result.outputSha256
      && entry.result.productionRecipe.referenceImages.length === 2),
    generationPromptSnapshotsComplete: entries.every((entry) => entry.result.productionRecipe?.generationPromptPath
      && /^[a-f0-9]{64}$/.test(entry.result.productionRecipe.generationPromptSha256)),
    generationPromptHashesDistinctFromManualImport: entries.every((entry) => entry.result.productionRecipe.generationPromptSha256
      !== entry.result.promptHash),
    inputReferenceRolesComplete: entries.every((entry) => entry.result.productionRecipe.toolMode === 'built-in'
      && entry.result.productionRecipe.inputReferences?.[0]?.role === 'global-style'
      && entry.result.productionRecipe.inputReferences?.[1]?.role === 'primary-subject'),
    oldApprovedHashMatchesZero: oldHashMatches.length === 0,
    lifecycleFilesZero: lifecycleFiles === 0,
    approvedBuildingFilesZero: approvedBuildingFiles === 0
  };
  if (Object.values(gates).some((passed) => !passed)) {
    throw new Error(`Wave 1A gate failure: ${JSON.stringify(gates)}`);
  }
  await renderNativeContactSheet(entries);
  await renderSourceComparison(entries);
  const recipes = {
    schemaVersion: 1,
    waveId: WAVE_ID,
    state: 'pending-inspection',
    recipes: entries.map((entry) => ({
      outputPath: entry.result.outputPath,
      ...entry.result.productionRecipe
    }))
  };
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-recipes.json`), `${JSON.stringify(recipes, null, 2)}\n`);
  const audit = {
    schemaVersion: 1,
    waveId: WAVE_ID,
    state: 'pending-inspection',
    observed: [
      'Exactly 17 required building candidates were imported through the canonical manual-import path.',
      'Every candidate is a 256x256 PNG with transparency and a shared subject baseline.',
      'Every candidate records the exact built-in imagegen prompt snapshot and role-labelled input reference hashes.',
      'No candidate output hash matches the previously approved asset set.'
    ],
    inferred: [
      'The fixed scale classes should preserve relative building size when the runtime draws assets without stretching.'
    ],
    unknown: [
      'human visual approval',
      'runtime integration quality',
      'final visual suitability at every in-game zoom level'
    ],
    gates,
    counts: {
      candidates: entries.length,
      pendingLedgerResults: after.results.length,
      lifecycleFiles,
      approvedBuildingFiles,
      oldApprovedHashMatches: oldHashMatches.length
    },
    closestPerceptualPair: pairDistances[0],
    candidates: entries.map((entry) => ({
      assetId: entry.id,
      method: entry.result.productionRecipe.method,
      scaleClass: entry.scaleClass,
      primaryReferenceId: entry.result.referenceImageIds[1],
      primaryReferenceSha256: entry.result.referenceImageHashes[1],
      sourceSha256: entry.result.productionRecipe.source.sha256,
      outputPath: entry.result.outputPath,
      outputSha256: entry.result.outputSha256,
      generationPromptPath: entry.result.productionRecipe.generationPromptPath,
      generationPromptSha256: entry.result.productionRecipe.generationPromptSha256,
      canonicalManualImportPromptSha256: entry.result.promptHash,
      toolMode: entry.result.productionRecipe.toolMode,
      inputReferences: entry.result.productionRecipe.inputReferences,
      subjectBbox: entry.alpha.subjectBbox,
      alpha: {
        visiblePixels: entry.alpha.visiblePixels,
        partialAlphaPixels: entry.alpha.partialAlphaPixels,
        visibleCoverage: entry.alpha.visibleCoverage,
        borderVisiblePixels: entry.alpha.borderVisiblePixels,
        cornerAlpha: entry.alpha.cornerAlpha
      },
      cleanup: entry.cleanup
    }))
  };
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-audit.json`), `${JSON.stringify(audit, null, 2)}\n`);
}

await main();
