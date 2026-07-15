import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import { FORGE_ROOT } from '../src/config.mjs';
import { sha256 } from '../src/hashing.mjs';
import { auditTransparentPng } from '../src/images/audit-alpha.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { materializeProductionSourceSnapshot, promotionPreview } from '../src/jobs/lifecycle.mjs';
import { readAssetDefinitions } from '../src/jobs/define-assets.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';

const WAVE_ID = 'wave2-snow-field';
const ASSET_ID = 'field.snow';
const TILE = 64;
const RAW_RELATIVE = `tmp/imagegen/${WAVE_ID}/raw/field_snow.png`;
const PREPARED_RELATIVE = `tmp/imagegen/${WAVE_ID}/prepared/field_snow.png`;
const PROMPT_RELATIVE = `review/prompts/${WAVE_ID}/field_snow.txt`;
const CONTACT_RELATIVE = 'review/wave2-required-fields-native.png';
const AUDIT_RELATIVE = 'review/wave2-snow-field-audit.json';

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function labelSvg(text, width, height = 24) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171b1d"/><text x="5" y="16" font-family="ui-monospace,monospace" font-size="10" fill="#f1ede3">${escapeXml(text)}</text></svg>`);
}

function reconcileEdges(data, width, height, band = 4) {
  const output = Buffer.from(data);
  const blend = (firstIndex, secondIndex, strength, source) => {
    for (let channel = 0; channel < 4; channel += 1) {
      const first = source[firstIndex + channel];
      const second = source[secondIndex + channel];
      if (strength === 0.5) {
        const value = Math.round((first + second) / 2);
        output[firstIndex + channel] = value;
        output[secondIndex + channel] = value;
      } else {
        output[firstIndex + channel] = Math.round(first * (1 - strength) + second * strength);
        output[secondIndex + channel] = Math.round(second * (1 - strength) + first * strength);
      }
    }
  };
  for (let y = 0; y < height; y += 1) {
    for (let inset = 0; inset < band; inset += 1) {
      blend((y * width + inset) * 4, (y * width + width - 1 - inset) * 4,
        inset === 0 ? 0.5 : (band - inset) / (band * 2), data);
    }
  }
  const horizontal = Buffer.from(output);
  for (let x = 0; x < width; x += 1) {
    for (let inset = 0; inset < band; inset += 1) {
      blend((inset * width + x) * 4, ((height - 1 - inset) * width + x) * 4,
        inset === 0 ? 0.5 : (band - inset) / (band * 2), horizontal);
    }
  }
  return output;
}

async function prepareSnow(rawPath, preparedPath) {
  const raw = await readFile(rawPath);
  const metadata = await sharp(raw).metadata();
  if (metadata.width < TILE || metadata.height < TILE) throw new Error('Snow source would require enlargement');
  const resized = await sharp(raw)
    .resize(TILE, TILE, { fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const reconciled = reconcileEdges(resized.data, TILE, TILE);
  const prepared = await sharp(reconciled, { raw: { width: TILE, height: TILE, channels: 4 } })
    .png({ compressionLevel: 8, adaptiveFiltering: false, palette: true, colours: 96, dither: 0 })
    .toBuffer();
  await mkdir(path.dirname(preparedPath), { recursive: true });
  await writeFile(preparedPath, prepared);
  return { raw, metadata, prepared };
}

async function edgeAudit(buffer) {
  const decoded = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let horizontalEdgeDelta = 0;
  let verticalEdgeDelta = 0;
  const colors = new Set();
  for (let y = 0; y < TILE; y += 1) {
    const left = y * TILE * 4;
    const right = (y * TILE + TILE - 1) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      horizontalEdgeDelta += Math.abs(decoded.data[left + channel] - decoded.data[right + channel]);
    }
  }
  for (let x = 0; x < TILE; x += 1) {
    const top = x * 4;
    const bottom = ((TILE - 1) * TILE + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      verticalEdgeDelta += Math.abs(decoded.data[top + channel] - decoded.data[bottom + channel]);
    }
  }
  for (let index = 0; index < decoded.data.length; index += 4) {
    colors.add(decoded.data.subarray(index, index + 4).toString('hex'));
  }
  return { horizontalEdgeDelta, verticalEdgeDelta, uniqueColors: colors.size };
}

async function renderRequiredFieldContact(generations) {
  const definitions = (await readAssetDefinitions()).filter((asset) => asset.category === 'field' && asset.required);
  if (definitions.length !== 19 || definitions.some((asset) => asset.id === 'field.sand')
    || !definitions.some((asset) => asset.id === ASSET_ID)) {
    throw new Error('Required field contact must contain 19 fields with snow and without sand');
  }
  const entries = [];
  for (const definition of definitions) {
    const generation = [...generations.results].reverse().find((entry) => entry.assetId === definition.id && entry.status === 'pending');
    if (!generation) throw new Error(`Missing pending candidate for ${definition.id}`);
    entries.push({ assetId: definition.id, buffer: await readFile(path.join(FORGE_ROOT, generation.outputPath)) });
  }
  const columns = 5;
  const cellWidth = 148;
  const cellHeight = 98;
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = (index % columns) * cellWidth + 8;
    const y = Math.floor(index / columns) * cellHeight + 8;
    composites.push({ input: entry.buffer, left: x, top: y });
    composites.push({ input: labelSvg(entry.assetId, 132), left: x, top: y + 66 });
  }
  const destination = path.join(FORGE_ROOT, CONTACT_RELATIVE);
  await sharp({
    create: {
      width: columns * cellWidth,
      height: Math.ceil(entries.length / columns) * cellHeight,
      channels: 4,
      background: '#171b1d'
    }
  }).composite(composites).png({ compressionLevel: 9 }).toFile(destination);
  return { path: CONTACT_RELATIVE, assetIds: entries.map((entry) => entry.assetId) };
}

async function main() {
  const rawPath = path.join(FORGE_ROOT, RAW_RELATIVE);
  const preparedPath = path.join(FORGE_ROOT, PREPARED_RELATIVE);
  const promptPath = path.join(FORGE_ROOT, PROMPT_RELATIVE);
  const { raw, metadata, prepared } = await prepareSnow(rawPath, preparedPath);
  const prompt = await readFile(promptPath);
  const { job } = await buildJob({ assetId: ASSET_ID, provider: 'manual-import' });
  const sourceSha256 = sha256(raw);
  const promptSha256 = sha256(prompt);
  const before = await readLocalGenerationManifest(FORGE_ROOT);
  let result = before.results.find((entry) => entry.assetId === ASSET_ID && entry.status === 'pending'
    && entry.productionRecipe?.source.sha256 === sourceSha256
    && entry.productionRecipe?.generationPromptSha256 === promptSha256);
  if (!result) {
    const productionRecipe = {
      waveId: WAVE_ID,
      assetId: ASSET_ID,
      method: 'imagegen',
      generator: 'codex-imagegen-built-in',
      scaleClass: 'medium',
      generationPromptPath: PROMPT_RELATIVE,
      generationPromptSha256: promptSha256,
      toolMode: 'built-in',
      orientationContract: 'non-directional walkable blue-grey compacted medieval street snow; all four edges seamless',
      transformSteps: ['full-frame', 'nearest-downscale', 'wrap-edge-reconcile', 'palette-quantize'],
      inputReferences: job.referenceImageIds.map((id, index) => ({
        id,
        sha256: job.referenceImageHashes[index],
        role: index === 0 ? 'global-style' : 'primary-subject'
      })),
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      source: {
        path: RAW_RELATIVE,
        sha256: sourceSha256,
        width: metadata.width,
        height: metadata.height,
        cropRect: null
      },
      backgroundRemoval: {
        method: 'none', keyColor: null, autoKey: null, softMatte: false,
        transparentThreshold: 0, opaqueThreshold: 255, despill: false,
        cleanup: { alphaCutoff: 0, componentMinPixels: 1, targetMaxWidth: TILE, targetMaxHeight: TILE, resizeKernel: 'nearest' }
      },
      canvas: { width: TILE, height: TILE, baselineY: TILE - 1 },
      subjectBbox: { x: 0, y: 0, width: TILE, height: TILE }
    };
    const imported = await importCandidate({ assetId: ASSET_ID, file: preparedPath, productionRecipe });
    result = imported.result;
  }
  const snapshot = await materializeProductionSourceSnapshot({ generationId: result.id });
  const preview = await promotionPreview({ generationId: result.id });
  const after = await readLocalGenerationManifest(FORGE_ROOT);
  const contact = await renderRequiredFieldContact(after);
  const alpha = await auditTransparentPng(prepared);
  const seams = await edgeAudit(prepared);
  const audit = {
    schemaVersion: 1,
    waveId: WAVE_ID,
    state: 'pending-inspection',
    generationId: result.id,
    assetId: ASSET_ID,
    prompt: { path: PROMPT_RELATIVE, sha256: promptSha256, exactBuiltInCallSnapshot: true },
    inputReferences: result.productionRecipe.inputReferences,
    rawSource: result.productionRecipe.source,
    sourceSnapshot: snapshot.result.productionRecipe.sourceSnapshot,
    candidate: {
      path: result.outputPath,
      sha256: result.outputSha256,
      width: result.outputInspection.width,
      height: result.outputInspection.height
    },
    alpha,
    seams,
    contact,
    promotionPreview: preview,
    humanApproved: false,
    exported: false
  };
  await writeFile(path.join(FORGE_ROOT, AUDIT_RELATIVE), `${JSON.stringify(audit, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}

await main();
