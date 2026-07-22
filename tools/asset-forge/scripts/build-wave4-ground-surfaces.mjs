import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { FORGE_ROOT } from '../src/config.mjs';
import { sha256 } from '../src/hashing.mjs';
import { auditTransparentPng } from '../src/images/audit-alpha.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { materializeProductionSourceSnapshot, promotionPreview } from '../src/jobs/lifecycle.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';

const WAVE_ID = 'wave4-ground-surfaces';
const TILE = 64;
const REPRESENTATIVE_CROP = Object.freeze({ left: 499, top: 499, width: 256, height: 256 });
const SPECS = Object.freeze([
  { assetId: 'field.grass', stem: 'field_grass', crop: REPRESENTATIVE_CROP, orientation: 'non-directional walkable dark moss and leaf-litter woodland floor' },
  { assetId: 'field.dirt_path', stem: 'field_dirt_path', crop: REPRESENTATIVE_CROP, orientation: 'non-directional walkable compacted earth, stone, moss, and leaf-litter path' },
  { assetId: 'field.snow', stem: 'field_snow', crop: Object.freeze({ left: 224, top: 224, width: 256, height: 256 }), orientation: 'non-directional walkable blue-grey wind-swept snowfield' }
]);
const ROAD_IDS = Object.freeze(['field.road_corner', 'field.road_edge', 'field.road_intersection']);
const TMP_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', WAVE_ID);
const PROMPT_ROOT = path.join(FORGE_ROOT, 'review', 'prompts', WAVE_ID);
const CONTACT_RELATIVE = 'review/wave4-ground-surfaces-native-8x.png';
const SNOW_REPEAT_RELATIVE = 'review/wave4-snow-repeat-12x8.png';
const AUDIT_RELATIVE = 'review/wave4-ground-surfaces-audit.json';

function posix(file) {
  return path.relative(FORGE_ROOT, file).split(path.sep).join('/');
}

function labelSvg(text, width, height = 24) {
  const safe = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171b1d"/><text x="6" y="17" font-family="ui-monospace,monospace" font-size="11" fill="#f1ede3">${safe}</text></svg>`);
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
  for (let y = 0; y < height; y += 1) for (let inset = 0; inset < band; inset += 1) {
    blend((y * width + inset) * 4, (y * width + width - 1 - inset) * 4,
      inset === 0 ? 0.5 : (band - inset) / (band * 2), data);
  }
  const horizontal = Buffer.from(output);
  for (let x = 0; x < width; x += 1) for (let inset = 0; inset < band; inset += 1) {
    blend((inset * width + x) * 4, ((height - 1 - inset) * width + x) * 4,
      inset === 0 ? 0.5 : (band - inset) / (band * 2), horizontal);
  }
  return output;
}

function quantizeRgb(data, colorCount) {
  const unique = [...new Set(Array.from({ length: data.length / 4 }, (_, index) => {
    const offset = index * 4;
    return `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
  }))].map((entry) => entry.split(',').map(Number))
    .sort((left, right) => (left[0] + left[1] + left[2]) - (right[0] + right[1] + right[2]));
  if (unique.length <= colorCount) return Buffer.from(data);
  let centers = Array.from({ length: colorCount }, (_, index) =>
    [...unique[Math.min(unique.length - 1, Math.floor(((index + 0.5) / colorCount) * unique.length))]]);
  const assignments = new Uint8Array(data.length / 4);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sums = Array.from({ length: colorCount }, () => [0, 0, 0, 0]);
    for (let pixel = 0; pixel < assignments.length; pixel += 1) {
      const offset = pixel * 4;
      let best = 0;
      let bestDistance = Infinity;
      for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
        const center = centers[centerIndex];
        const distance = (data[offset] - center[0]) ** 2 + (data[offset + 1] - center[1]) ** 2
          + (data[offset + 2] - center[2]) ** 2;
        if (distance < bestDistance) { best = centerIndex; bestDistance = distance; }
      }
      assignments[pixel] = best;
      sums[best][0] += data[offset]; sums[best][1] += data[offset + 1]; sums[best][2] += data[offset + 2]; sums[best][3] += 1;
    }
    centers = centers.map((center, index) => sums[index][3] === 0 ? center : [
      Math.round(sums[index][0] / sums[index][3]),
      Math.round(sums[index][1] / sums[index][3]),
      Math.round(sums[index][2] / sums[index][3])
    ]);
  }
  const output = Buffer.from(data);
  for (let pixel = 0; pixel < assignments.length; pixel += 1) {
    const offset = pixel * 4;
    const center = centers[assignments[pixel]];
    output[offset] = center[0]; output[offset + 1] = center[1]; output[offset + 2] = center[2]; output[offset + 3] = 255;
  }
  return output;
}

function compressRgbContrast(data, targetRange = 22) {
  const output = Buffer.from(data);
  const pixels = data.length / 4;
  const means = [0, 0, 0];
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const luminance = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
    minimum = Math.min(minimum, luminance);
    maximum = Math.max(maximum, luminance);
    means[0] += data[offset]; means[1] += data[offset + 1]; means[2] += data[offset + 2];
  }
  for (let channel = 0; channel < 3; channel += 1) means[channel] /= pixels;
  const scale = maximum > minimum ? Math.min(1, targetRange / (maximum - minimum)) : 1;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = Math.round(means[channel] + (data[offset + channel] - means[channel]) * scale);
    }
  }
  return output;
}

async function edgeAudit(buffer) {
  const decoded = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let horizontalEdgeDelta = 0;
  let verticalEdgeDelta = 0;
  let localRgbDelta = 0;
  const colors = new Set();
  let minimumLuminance = Infinity;
  let maximumLuminance = -Infinity;
  for (let y = 0; y < TILE; y += 1) {
    const left = y * TILE * 4;
    const right = (y * TILE + TILE - 1) * 4;
    for (let channel = 0; channel < 3; channel += 1) horizontalEdgeDelta += Math.abs(decoded.data[left + channel] - decoded.data[right + channel]);
  }
  for (let x = 0; x < TILE; x += 1) {
    const top = x * 4;
    const bottom = ((TILE - 1) * TILE + x) * 4;
    for (let channel = 0; channel < 3; channel += 1) verticalEdgeDelta += Math.abs(decoded.data[top + channel] - decoded.data[bottom + channel]);
  }
  for (let y = 0; y < TILE; y += 1) for (let x = 0; x < TILE; x += 1) {
    const index = (y * TILE + x) * 4;
    colors.add(decoded.data.subarray(index, index + 4).toString('hex'));
    const luminance = (decoded.data[index] + decoded.data[index + 1] + decoded.data[index + 2]) / 3;
    minimumLuminance = Math.min(minimumLuminance, luminance);
    maximumLuminance = Math.max(maximumLuminance, luminance);
    if (x + 1 < TILE) for (let channel = 0; channel < 3; channel += 1) {
      localRgbDelta += Math.abs(decoded.data[index + channel] - decoded.data[index + 4 + channel]);
    }
  }
  return { horizontalEdgeDelta, verticalEdgeDelta, uniqueColors: colors.size, localRgbDelta,
    rgbContrast: Math.round((maximumLuminance - minimumLuminance) * 100) / 100 };
}

async function prepareSurface(spec) {
  const rawPath = path.join(TMP_ROOT, 'raw', `${spec.stem}.png`);
  const preparedPath = path.join(TMP_ROOT, 'prepared', `${spec.stem}.png`);
  const raw = await readFile(rawPath);
  const rawMetadata = await sharp(raw).metadata();
  if (rawMetadata.width < TILE || rawMetadata.height < TILE) throw new Error(`${spec.assetId}: source would require enlargement`);
  const isSnow = spec.assetId === 'field.snow';
  const workingSize = isSnow ? 32 : TILE;
  const resized = await sharp(raw).extract(spec.crop)
    .resize(workingSize, workingSize, { fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const reconciled = reconcileEdges(resized.data, workingSize, workingSize, isSnow ? 2 : 4);
  const quantized = isSnow ? compressRgbContrast(quantizeRgb(reconciled, 8), 22) : reconciled;
  let preparedPipeline = sharp(quantized, { raw: { width: workingSize, height: workingSize, channels: 4 } });
  if (isSnow) preparedPipeline = preparedPipeline.resize(TILE, TILE, { kernel: sharp.kernel.nearest });
  const prepared = await preparedPipeline
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: !isSnow, colours: 96, dither: 0 })
    .toBuffer();
  await mkdir(path.dirname(preparedPath), { recursive: true });
  await writeFile(preparedPath, prepared);
  const alpha = await auditTransparentPng(prepared);
  const seams = await edgeAudit(prepared);
  const gates = {
    opaque: alpha.visibleCoverage === 1 && alpha.transparentPixels === 0 && alpha.partialAlphaPixels === 0,
    exactCanvas: alpha.width === TILE && alpha.height === TILE,
    seamlessEdges: seams.horizontalEdgeDelta === 0 && seams.verticalEdgeDelta === 0,
    paletteRange: isSnow ? seams.uniqueColors >= 8 && seams.uniqueColors <= 12 : seams.uniqueColors >= 12 && seams.uniqueColors <= 96,
    twoPixelBlocks: !isSnow || await twoPixelBlockAudit(prepared),
    snowContrast: !isSnow || (seams.rgbContrast >= 18 && seams.rgbContrast <= 24)
  };
  if (Object.values(gates).some((value) => !value)) throw new Error(`${spec.assetId}: technical gates failed ${JSON.stringify({ alpha, seams, gates })}`);
  return { spec, raw, rawMetadata, rawPath, prepared, preparedPath, alpha, seams, gates };
}

async function twoPixelBlockAudit(buffer) {
  const decoded = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < TILE; y += 2) for (let x = 0; x < TILE; x += 2) {
    const first = (y * TILE + x) * 4;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
      const candidate = ((y + dy) * TILE + x + dx) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        if (decoded.data[first + channel] !== decoded.data[candidate + channel]) return false;
      }
    }
  }
  return true;
}

async function importSurface(entry, manifest) {
  const promptPath = path.join(PROMPT_ROOT, `${entry.spec.stem}.txt`);
  const promptRelative = posix(promptPath);
  const promptSha256 = sha256(await readFile(promptPath));
  const sourceSha256 = sha256(entry.raw);
  let result = manifest.results.find((candidate) => candidate.assetId === entry.spec.assetId
    && candidate.status === 'pending'
    && candidate.productionRecipe?.waveId === WAVE_ID
    && candidate.productionRecipe?.source?.sha256 === sourceSha256
    && candidate.productionRecipe?.generationPromptSha256 === promptSha256
    && candidate.productionRecipe?.source?.cropRect?.x === entry.spec.crop.left
    && candidate.productionRecipe?.source?.cropRect?.y === entry.spec.crop.top
    && candidate.productionRecipe?.source?.cropRect?.width === entry.spec.crop.width
    && candidate.productionRecipe?.source?.cropRect?.height === entry.spec.crop.height
    && candidate.sourceSha256 === sha256(entry.prepared));
  if (!result) {
    const { job } = await buildJob({ assetId: entry.spec.assetId, provider: 'manual-import' });
    const productionRecipe = {
      waveId: WAVE_ID,
      assetId: entry.spec.assetId,
      method: 'imagegen',
      generator: 'codex-imagegen-built-in',
      scaleClass: 'medium',
      generationPromptPath: promptRelative,
      generationPromptSha256: promptSha256,
      toolMode: 'built-in',
      orientationContract: entry.spec.assetId === 'field.snow'
        ? `${entry.spec.orientation}; all four edges seamless; crop 256px, nearest-downscale to 32px, reconcile a 2px wrap band, quantize to 8 colors, compress RGB contrast to 22, then nearest-upscale to 64px`
        : `${entry.spec.orientation}; all four edges seamless`,
      transformSteps: entry.spec.assetId === 'field.snow'
        ? ['crop', 'nearest-downscale', 'wrap-edge-reconcile', 'palette-quantize', 'shared-scale-normalize']
        : ['crop', 'nearest-downscale', 'wrap-edge-reconcile', 'palette-quantize'],
      inputReferences: job.referenceImageIds.map((id, index) => ({
        id, sha256: job.referenceImageHashes[index], role: index === 0 ? 'global-style' : 'primary-subject'
      })),
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      source: {
        path: posix(entry.rawPath), sha256: sourceSha256,
        width: entry.rawMetadata.width, height: entry.rawMetadata.height,
        cropRect: { x: entry.spec.crop.left, y: entry.spec.crop.top, width: entry.spec.crop.width, height: entry.spec.crop.height }
      },
      backgroundRemoval: {
        method: 'none', keyColor: null, autoKey: null, softMatte: false,
        transparentThreshold: 0, opaqueThreshold: 255, despill: false,
        cleanup: { alphaCutoff: 0, componentMinPixels: 1, targetMaxWidth: TILE, targetMaxHeight: TILE, resizeKernel: 'nearest' }
      },
      canvas: { width: TILE, height: TILE, baselineY: TILE - 1 },
      subjectBbox: { x: 0, y: 0, width: TILE, height: TILE }
    };
    result = (await importCandidate({ assetId: entry.spec.assetId, file: entry.preparedPath, productionRecipe })).result;
  }
  const snapshot = await materializeProductionSourceSnapshot({ generationId: result.id });
  const preview = await promotionPreview({ generationId: result.id });
  return { ...entry, result: snapshot.result, preview };
}

async function refreshRoadGrassComposites(grassEntry, manifest) {
  const refreshed = [];
  const grassPath = grassEntry.preparedPath;
  const grassSha256 = sha256(grassEntry.prepared);
  const grass = await sharp(grassEntry.prepared).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const assetId of ROAD_IDS) {
    const previous = manifest.results.find((entry) => entry.assetId === assetId && entry.status === 'pending');
    if (!previous?.productionRecipe?.compositeMask) throw new Error(`${assetId}: missing existing road composite recipe`);
    let result = manifest.results.find((entry) => entry.assetId === assetId && entry.status === 'pending'
      && entry.productionRecipe?.waveId === WAVE_ID
      && entry.productionRecipe?.compositeMask?.backgroundSha256 === grassSha256);
    const preparedPath = path.join(TMP_ROOT, 'prepared', `${assetId.replaceAll('.', '_')}.png`);
    if (!result) {
      const rawPath = path.join(FORGE_ROOT, previous.productionRecipe.source.path);
      const roadPixels = await sharp(await readFile(rawPath))
        .resize(TILE, TILE, { fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const quantizedRoad = await sharp(roadPixels.data, { raw: roadPixels.info })
        .png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 96, dither: 0 }).toBuffer();
      const road = await sharp(quantizedRoad).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const mask = await sharp(path.join(FORGE_ROOT, previous.productionRecipe.compositeMask.path))
        .greyscale().raw().toBuffer({ resolveWithObject: true });
      const composed = Buffer.from(grass.data);
      for (let index = 0; index < mask.data.length; index += 1) {
        if (mask.data[index] < 128) continue;
        road.data.copy(composed, index * 4, index * 4, index * 4 + 4);
      }
      const prepared = await sharp(composed, { raw: { width: TILE, height: TILE, channels: 4 } })
        .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
      await writeFile(preparedPath, prepared);
      const { outputSha256: _oldOutput, sourceSnapshot: _oldSnapshot, ...recipeDraft } = previous.productionRecipe;
      const productionRecipe = {
        ...recipeDraft,
        waveId: WAVE_ID,
        compositeMask: {
          ...recipeDraft.compositeMask,
          backgroundPath: posix(grassPath),
          backgroundSha256: grassSha256
        }
      };
      result = (await importCandidate({ assetId, file: preparedPath, productionRecipe })).result;
    }
    const snapshot = await materializeProductionSourceSnapshot({ generationId: result.id });
    const preview = await promotionPreview({ generationId: result.id });
    refreshed.push({ assetId, result: snapshot.result, preview, backgroundPath: posix(grassPath), backgroundSha256: grassSha256 });
    manifest = await readLocalGenerationManifest(FORGE_ROOT);
  }
  return refreshed;
}

async function renderNativeContact(entries) {
  const width = 536;
  const height = entries.length * 544;
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    composites.push({ input: labelSvg(`${entry.spec.assetId} | native 64px enlarged 8x`, 512), left: 12, top: index * 544 + 8 });
    composites.push({ input: await sharp(entry.prepared).resize(512, 512, { kernel: sharp.kernel.nearest }).png().toBuffer(), left: 12, top: index * 544 + 32 });
  }
  const destination = path.join(FORGE_ROOT, CONTACT_RELATIVE);
  await sharp({ create: { width, height, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(destination);
  return CONTACT_RELATIVE;
}

async function renderSnowRepeat(entry) {
  const composites = [];
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 12; x += 1) {
    const phase = (x * 3 + y * 5) % 4;
    let tile = sharp(entry.prepared);
    if (phase >= 2) tile = tile.rotate(180);
    if (phase % 2 === 1) tile = tile.flop();
    composites.push({ input: await tile.png().toBuffer(), left: x * TILE, top: y * TILE });
  }
  await sharp({ create: { width: 12 * TILE, height: 8 * TILE, channels: 4, background: '#d2d9e6' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(FORGE_ROOT, SNOW_REPEAT_RELATIVE));
  return SNOW_REPEAT_RELATIVE;
}

async function main() {
  const prepared = [];
  for (const spec of SPECS) prepared.push(await prepareSurface(spec));
  let manifest = await readLocalGenerationManifest(FORGE_ROOT);
  const imported = [];
  for (const entry of prepared) {
    imported.push(await importSurface(entry, manifest));
    manifest = await readLocalGenerationManifest(FORGE_ROOT);
  }
  const roads = await refreshRoadGrassComposites(imported.find((entry) => entry.spec.assetId === 'field.grass'), manifest);
  const contact = await renderNativeContact(imported);
  const snowRepeat = await renderSnowRepeat(imported.find((entry) => entry.spec.assetId === 'field.snow'));
  const audit = {
    schemaVersion: 1,
    waveId: WAVE_ID,
    state: 'pending-inspection',
    retiredCandidatePolicy: 'superseded grass/dirt-path/snow candidates and generation records are deleted after replacement candidates are materialized',
    assets: imported.map((entry) => ({
      assetId: entry.spec.assetId,
      generationId: entry.result.id,
      prompt: { path: entry.result.productionRecipe.generationPromptPath, sha256: entry.result.productionRecipe.generationPromptSha256, exactBuiltInCallSnapshot: true },
      inputReferences: entry.result.productionRecipe.inputReferences,
      rawSource: entry.result.productionRecipe.source,
      sourceSnapshot: entry.result.productionRecipe.sourceSnapshot,
      candidate: { path: entry.result.outputPath, sha256: entry.result.outputSha256, width: TILE, height: TILE },
      alpha: entry.alpha,
      seams: entry.seams,
      gates: entry.gates,
      promotionPreview: entry.preview
    })),
    roadRecomposites: roads.map((entry) => ({
      assetId: entry.assetId,
      generationId: entry.result.id,
      candidate: { path: entry.result.outputPath, sha256: entry.result.outputSha256, width: TILE, height: TILE },
      background: { assetId: 'field.grass', path: entry.backgroundPath, sha256: entry.backgroundSha256 },
      sourceSnapshot: entry.result.productionRecipe.sourceSnapshot,
      promotionPreview: entry.preview
    })),
    contacts: { native8x: contact, snowRepeat12x8: snowRepeat },
    humanApproved: false,
    exported: false,
    observed: [
      'All three candidates are opaque 64x64 PNGs with exact opposing-edge equality after wrap-edge reconciliation.',
      'All three production recipes retain exact imagegen prompts, approved reference hashes, raw source snapshots, and promotion previews.',
      'The three road-family candidates are recomposited over the replacement grass through their existing hashed masks.',
      'Each raw imagegen source is cropped to the recorded representative 256x256 center region before nearest-neighbor reduction to 64x64.',
      'Snow alone uses the recorded deterministic 32px intermediate, 2px wrap-band reconciliation, 8-color quantization, RGB contrast 22, and nearest 2x enlargement to the final 64px tile.',
      'The native review board enlarges each final 64px candidate by exactly 8x with nearest-neighbor sampling.',
      'The snow repeat board renders the exact runtime 12x8 four-phase sequence: identity, horizontal flip, 180-degree rotation, and 180-degree rotation plus horizontal flip.'
    ],
    inferred: ['Opaque and edge-equality gates make transparency holes and one-pixel seams unlikely to reach human review.'],
    unknown: ['human approval', 'final export', 'subjective acceptance in every town context']
  };
  await writeFile(path.join(FORGE_ROOT, AUDIT_RELATIVE), `${JSON.stringify(audit, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}

await main();
