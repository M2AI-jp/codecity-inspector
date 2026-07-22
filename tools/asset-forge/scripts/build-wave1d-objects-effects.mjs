import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';

import sharp from 'sharp';

import { FORGE_ROOT } from '../src/config.mjs';
import { atomicReplaceJson } from '../src/fs-safe.mjs';
import { hashFile, sha256 } from '../src/hashing.mjs';
import { auditTransparentPng } from '../src/images/audit-alpha.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { readLocalGenerationManifest, replaceGenerationResult } from '../src/manifests/local-generations.mjs';

const execFileAsync = promisify(execFile);
const WAVE_ID = 'wave1d-objects-effects';
const REVIEW_ROOT = path.join(FORGE_ROOT, 'review');
const PROMPT_ROOT = path.join(REVIEW_ROOT, 'prompts', WAVE_ID);
const TMP_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', WAVE_ID);
const RAW_ROOT = path.join(TMP_ROOT, 'raw');
const CLEANED_ROOT = path.join(TMP_ROOT, 'cleaned');
const EXTRACTION_ROOT = path.join(TMP_ROOT, 'extractions');
const PREPARED_ROOT = path.join(TMP_ROOT, 'prepared');
const OVERLAY_ROOT = path.join(REVIEW_ROOT, 'wave1d-crop-overlays');
const WORLD_REFERENCE = 'world_visual_master';
const STREET_REFERENCE = 'intake_20260713_object_street_props';
const STATUS_REFERENCE = 'intake_20260713_object_status_markers';
const HARBOR_REFERENCE = 'intake_20260713_field_harbor_docks_tiles';
const STREET_PATH = path.join(FORGE_ROOT, 'references', 'approved', 'object_street_props_sheet.png');
const CHROMA_HELPER = path.join(process.env.CODEX_HOME || path.join(process.env.HOME, '.codex'), 'skills', '.system', 'imagegen', 'scripts', 'remove_chroma_key.py');
const OBJECT_CANVAS = Object.freeze({ width: 64, height: 64, baselineY: 63, maxSubjectWidth: 60, maxSubjectHeight: 60 });
const EFFECT_FRAME = Object.freeze({ width: 32, height: 32, maxSubjectWidth: 28, maxSubjectHeight: 28 });
const EFFECT_SHEET = Object.freeze({ width: 128, height: 32 });
const ALPHA_CUTOFF = 128;

const OBJECTS = Object.freeze([
  { id: 'object.barrel', stem: 'barrel', method: 'direct-extraction', crop: [9, 10, 58, 75], primary: STREET_REFERENCE },
  { id: 'object.crate', stem: 'crate', method: 'direct-extraction', crop: [748, 450, 64, 64], primary: STREET_REFERENCE },
  { id: 'object.stacked_crates', stem: 'stacked_crates', method: 'direct-extraction', crop: [367, 8, 62, 76], primary: STREET_REFERENCE },
  { id: 'object.lamp', stem: 'lamp', method: 'direct-extraction', crop: [596, 145, 62, 90], primary: STREET_REFERENCE },
  { id: 'object.streetlight', stem: 'streetlight', method: 'direct-extraction', crop: [927, 10, 52, 160], primary: STREET_REFERENCE },
  { id: 'object.signboard', stem: 'signboard', method: 'imagegen', primary: STREET_REFERENCE },
  { id: 'object.notice_board', stem: 'notice_board', method: 'imagegen', primary: STREET_REFERENCE },
  { id: 'object.well', stem: 'well', method: 'direct-extraction', crop: [808, 188, 92, 80], primary: STREET_REFERENCE },
  { id: 'object.bench', stem: 'bench', method: 'direct-extraction', crop: [617, 98, 105, 60], primary: STREET_REFERENCE },
  { id: 'object.flowerbed', stem: 'flowerbed', method: 'direct-extraction', crop: [188, 222, 82, 55], primary: STREET_REFERENCE },
  { id: 'object.grass_patch', stem: 'grass_patch', method: 'direct-extraction', crop: [12, 332, 72, 58], primary: STREET_REFERENCE },
  { id: 'object.construction_sign', stem: 'construction_sign', method: 'imagegen', primary: STATUS_REFERENCE },
  { id: 'object.unverified_tag', stem: 'unverified_tag', method: 'imagegen', primary: STATUS_REFERENCE },
  { id: 'object.warning_stake', stem: 'warning_stake', method: 'imagegen', primary: STATUS_REFERENCE },
  { id: 'object.red_flag', stem: 'red_flag', method: 'imagegen', primary: STATUS_REFERENCE },
  { id: 'object.yellow_flag', stem: 'yellow_flag', method: 'imagegen', primary: STATUS_REFERENCE },
  { id: 'object.blue_flag', stem: 'blue_flag', method: 'imagegen', primary: STATUS_REFERENCE },
  { id: 'object.rubble', stem: 'rubble', method: 'direct-extraction', crop: [768, 334, 65, 44], primary: STREET_REFERENCE }
]);

const EFFECTS = Object.freeze([
  { id: 'effect.construction_dust', stem: 'construction_dust', primary: STATUS_REFERENCE, alignment: 'bottom', sourceCuts: [0, 443, 887, 1330, 1774] },
  { id: 'effect.water_ripple', stem: 'water_ripple', primary: HARBOR_REFERENCE, alignment: 'center', sourceCuts: [0, 400, 800, 1347, 1774] }
]);

const CALL_EVIDENCE = Object.freeze({
  notice_board: ['batch-01-single', 'exec-7142c56d-2087-4f25-bbc8-cfdef3ae17ca.png'],
  construction_sign: ['batch-04-medieval-retry', 'exec-303f031f-d52a-4441-871e-8c4b944b5e4d.png'],
  unverified_tag: ['batch-02-status-three', 'exec-f9631741-89f0-439b-a7c1-7c6d1cdb6225.png'],
  warning_stake: ['batch-02-status-three', 'exec-16c746bf-0439-4e83-887b-27af824fab54.png'],
  red_flag: ['batch-03-flags-three', 'exec-fcd60775-cf9f-4807-979c-21e2f99c5137.png'],
  yellow_flag: ['batch-03-flags-three', 'exec-0464a447-2d4d-4c21-a810-e7cd865c67bf.png'],
  blue_flag: ['batch-03-flags-three', 'exec-a31293fd-b45f-4c11-a588-e0cb6594c603.png'],
  construction_dust: ['batch-05-effects-two', 'exec-f466121c-4629-4f0c-975a-a010de1eed7d.png'],
  water_ripple: ['batch-05-effects-two', 'exec-28045850-79d9-407d-9ea8-23c6d7151239.png'],
  signboard: ['batch-06-recovered-completed-output', 'exec-5a45c82f-adb8-403d-b684-3f44fb10b243.png']
});

const REJECTED_INPUTS = Object.freeze([
  {
    assetId: 'object.construction_sign', kind: 'imagegen-source',
    rawPath: 'tmp/imagegen/wave1d-objects-effects/rejected/construction_sign-v1-modern-hazard.png',
    promptPath: 'review/prompts/wave1d-objects-effects/rejected/construction_sign-v1-modern-hazard.txt',
    reason: 'Lead rejected the black/yellow industrial hazard language; the adopted retry uses medieval red/cream repair language.'
  },
  {
    assetId: 'object.crate', kind: 'direct-crop', cropRect: { x: 297, y: 15, width: 60, height: 70 },
    rawPath: 'tmp/imagegen/wave1d-objects-effects/rejected/crate-v1-two-box-crop.png',
    cleanedPath: 'tmp/imagegen/wave1d-objects-effects/rejected/crate-v1-two-box-crop.keyed.png',
    reason: 'Lead rejected the two-box cluster because it was not a standalone single closed crate.'
  },
  {
    assetId: 'object.signboard', kind: 'direct-crop', cropRect: { x: 734, y: 148, width: 88, height: 90 },
    rawPath: 'tmp/imagegen/wave1d-objects-effects/rejected/signboard-v1-contaminated-crop.png',
    cleanedPath: 'tmp/imagegen/wave1d-objects-effects/rejected/signboard-v1-contaminated-crop.keyed.png',
    reason: 'Lead rejected neighboring specimen residue at the left/bottom; an isolated imagegen source replaced it.'
  }
]);

function posix(file) {
  return path.relative(FORGE_ROOT, file).split(path.sep).join('/');
}

async function filesBelow(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(candidate));
    else files.push(candidate);
  }
  return files.sort();
}

async function treeHashes(directory) {
  const result = {};
  for (const file of await filesBelow(directory)) result[path.relative(directory, file)] = sha256(await readFile(file));
  return result;
}

async function readPriorRecipeMigrations() {
  try {
    const audit = JSON.parse(await readFile(path.join(REVIEW_ROOT, `${WAVE_ID}-audit.json`), 'utf8'));
    return audit.waveId === WAVE_ID && Array.isArray(audit.recipeMigrations)
      ? audit.recipeMigrations
      : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function effectBaselineY(entry) {
  if (entry.spec.alignment === 'bottom') return EFFECT_SHEET.height - 1;
  if (entry.spec.alignment === 'center') {
    return entry.sheetAlpha.subjectBbox.y + Math.floor((entry.sheetAlpha.subjectBbox.height - 1) / 2);
  }
  throw new Error(`${entry.spec.id}: unsupported effect alignment ${entry.spec.alignment}`);
}

async function resumeWithVerifiedRecipe(existing, recipe, preparedSource, { allowCenteredBaselineMigration = false } = {}) {
  if (existing.sourceSha256 !== sha256(preparedSource)
    || existing.productionRecipe?.source?.sha256 !== recipe.source.sha256) {
    throw new Error(`${existing.assetId}: resumable result does not match deterministic prepared input/source provenance`);
  }
  const completedRecipe = {
    ...recipe,
    ...(existing.productionRecipe?.sourceSnapshot
      ? { sourceSnapshot: existing.productionRecipe.sourceSnapshot }
      : {}),
    outputSha256: existing.outputSha256
  };
  if (isDeepStrictEqual(existing.productionRecipe, completedRecipe)) return { result: existing, migration: null };

  const normalizedExistingRecipe = structuredClone(existing.productionRecipe);
  const baselineOnly = allowCenteredBaselineMigration
    && normalizedExistingRecipe?.effectContract?.alignment === 'center'
    && completedRecipe.effectContract?.alignment === 'center';
  if (baselineOnly) normalizedExistingRecipe.canvas.baselineY = completedRecipe.canvas.baselineY;
  if (!baselineOnly || !isDeepStrictEqual(normalizedExistingRecipe, completedRecipe)) {
    throw new Error(`${existing.assetId}: refusing resumable production-recipe mutation beyond the centered-effect baseline correction`);
  }

  const outputHashBefore = await hashFile(path.join(FORGE_ROOT, existing.outputPath));
  if (outputHashBefore !== existing.outputSha256) throw new Error(`${existing.assetId}: persisted output hash mismatch before recipe correction`);
  const corrected = { ...existing, productionRecipe: completedRecipe };
  const metadataPath = path.join(FORGE_ROOT, existing.metadataPath);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (!isDeepStrictEqual(metadata, existing) && !isDeepStrictEqual(metadata, corrected)) {
    throw new Error(`${existing.assetId}: metadata/ledger mismatch prevents safe recipe correction`);
  }
  if (!isDeepStrictEqual(metadata, corrected)) await atomicReplaceJson(FORGE_ROOT, metadataPath, corrected);
  const result = await replaceGenerationResult(FORGE_ROOT, existing.id, () => corrected);
  if (await hashFile(path.join(FORGE_ROOT, existing.outputPath)) !== outputHashBefore) {
    throw new Error(`${existing.assetId}: output bytes changed during recipe correction`);
  }
  return {
    result,
    migration: {
      assetId: existing.assetId,
      generationId: existing.id,
      kind: 'centered-effect-baseline-correction',
      baselineYBefore: existing.productionRecipe.canvas.baselineY,
      baselineYAfter: completedRecipe.canvas.baselineY,
      outputPath: existing.outputPath,
      outputSha256: existing.outputSha256,
      outputBytesUnchanged: true
    }
  };
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function labelSvg(text, width, height = 24, size = 10) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171b1d"/><text x="5" y="${Math.min(height - 5, size + 7)}" font-family="ui-monospace,monospace" font-size="${size}" fill="#f1ede3">${escapeXml(text)}</text></svg>`);
}

function checkerSvg(width, height, size = 8) {
  const blocks = [];
  for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
    blocks.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${((x / size + y / size) % 2 === 0) ? '#30383c' : '#465054'}"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${blocks.join('')}</svg>`);
}

function visibleAudit(data, width, height) {
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  let visiblePixels = 0; let partialAlphaPixels = 0; let borderPixels = 0;
  const colors = new Set();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    const alpha = data[index + 3];
    if (alpha > 0 && alpha < 255) partialAlphaPixels += 1;
    if (alpha === 0) continue;
    visiblePixels += 1;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) borderPixels += 1;
    colors.add(data.subarray(index, index + 4).toString('hex'));
  }
  return {
    bbox: visiblePixels ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    visiblePixels, partialAlphaPixels, borderPixels, visibleColorCount: colors.size
  };
}

function hardenLargest(data, width, height) {
  const pixels = width * height;
  const visible = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) if (data[index * 4 + 3] >= ALPHA_CUTOFF) visible[index] = 1;
  const seen = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  const components = [];
  for (let start = 0; start < pixels; start += 1) {
    if (!visible[start] || seen[start]) continue;
    let head = 0; let tail = 0; let border = false;
    const members = [];
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const current = queue[head++]; members.push(current);
      const x = current % width; const y = Math.floor(current / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true;
      const neighbors = [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1];
      for (const next of neighbors) if (next >= 0 && visible[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
    }
    components.push({ members, border });
  }
  components.sort((left, right) => right.members.length - left.members.length);
  if (!components.length) throw new Error('background cleanup removed the entire subject');
  const keep = new Uint8Array(pixels);
  for (const index of components[0].members) keep[index] = 1;
  const output = Buffer.alloc(data.length);
  for (let index = 0; index < pixels; index += 1) if (keep[index]) {
    output[index * 4] = data[index * 4]; output[index * 4 + 1] = data[index * 4 + 1]; output[index * 4 + 2] = data[index * 4 + 2]; output[index * 4 + 3] = 255;
  }
  return { data: output, audit: visibleAudit(output, width, height), componentCountBefore: components.length, keptPixels: components[0].members.length, largestTouchedCropBorder: components[0].border };
}

function hardenAll(data, width, height) {
  const output = Buffer.alloc(data.length);
  for (let index = 0; index < width * height; index += 1) if (data[index * 4 + 3] >= ALPHA_CUTOFF) {
    output[index * 4] = data[index * 4]; output[index * 4 + 1] = data[index * 4 + 1]; output[index * 4 + 2] = data[index * 4 + 2]; output[index * 4 + 3] = 255;
  }
  return { data: output, audit: visibleAudit(output, width, height) };
}

async function runChroma(input, output, transparentThreshold) {
  await execFileAsync('python', [CHROMA_HELPER, '--input', input, '--out', output, '--auto-key', 'border', '--soft-matte', '--transparent-threshold', String(transparentThreshold), '--opaque-threshold', '110', '--despill', '--force']);
}

async function normalizeObjectFromCleaned(cleanedBuffer, stem) {
  const decoded = await sharp(cleanedBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hardened = hardenLargest(decoded.data, decoded.info.width, decoded.info.height);
  if (!hardened.audit.bbox) throw new Error(`${stem}: empty object`);
  const bbox = hardened.audit.bbox;
  const sourceCrop = await sharp(hardened.data, { raw: decoded.info }).extract({ left: bbox.x, top: bbox.y, width: bbox.width, height: bbox.height }).png().toBuffer();
  const scale = Math.min(1, OBJECT_CANVAS.maxSubjectWidth / bbox.width, OBJECT_CANVAS.maxSubjectHeight / bbox.height);
  const targetWidth = Math.max(1, Math.floor(bbox.width * scale));
  const targetHeight = Math.max(1, Math.floor(bbox.height * scale));
  const sprite = (targetWidth === bbox.width && targetHeight === bbox.height)
    ? sourceCrop
    : await sharp(sourceCrop).resize(targetWidth, targetHeight, { fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest }).png().toBuffer();
  const left = Math.floor((OBJECT_CANVAS.width - targetWidth) / 2);
  const top = OBJECT_CANVAS.baselineY - targetHeight + 1;
  const composed = await sharp({ create: { width: OBJECT_CANVAS.width, height: OBJECT_CANVAS.height, channels: 4, background: '#00000000' } })
    .composite([{ input: sprite, left, top }]).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  const output = await sharp(composed).png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 96, dither: 0 }).toBuffer();
  const finalDecoded = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { output, sourceAudit: hardened.audit, audit: visibleAudit(finalDecoded.data, OBJECT_CANVAS.width, OBJECT_CANVAS.height), scale, targetWidth, targetHeight, cleanup: { componentCountBefore: hardened.componentCountBefore, keptPixels: hardened.keptPixels, largestTouchedCropBorder: hardened.largestTouchedCropBorder } };
}

function frameDifference(left, right) {
  let changedPixels = 0; let silhouetteChangedPixels = 0;
  for (let index = 0; index < left.length; index += 4) {
    if (left[index] !== right[index] || left[index + 1] !== right[index + 1] || left[index + 2] !== right[index + 2] || left[index + 3] !== right[index + 3]) changedPixels += 1;
    if ((left[index + 3] > 0) !== (right[index + 3] > 0)) silhouetteChangedPixels += 1;
  }
  return { changedPixels, silhouetteChangedPixels };
}

async function prepareEffect(spec) {
  const rawPath = path.join(RAW_ROOT, `${spec.stem}.png`);
  const cleanedPath = path.join(CLEANED_ROOT, `${spec.stem}.png`);
  const promptPath = path.join(PROMPT_ROOT, `${spec.stem}.txt`);
  const [raw, cleaned, prompt] = await Promise.all([readFile(rawPath), readFile(cleanedPath), readFile(promptPath)]);
  const rawMetadata = await sharp(raw).metadata();
  const cleanedMetadata = await sharp(cleaned).metadata();
  if (rawMetadata.width !== cleanedMetadata.width || rawMetadata.height !== cleanedMetadata.height) throw new Error(`${spec.id}: chroma removal changed source dimensions`);
  const sourceFrames = [];
  for (let column = 0; column < 4; column += 1) {
    const left = spec.sourceCuts ? spec.sourceCuts[column] : Math.floor(column * cleanedMetadata.width / 4);
    const right = spec.sourceCuts ? spec.sourceCuts[column + 1] : Math.floor((column + 1) * cleanedMetadata.width / 4);
    if (left < 0 || right > cleanedMetadata.width || right <= left) throw new Error(`${spec.id}: invalid source cell cuts`);
    const extracted = await sharp(cleaned).extract({ left, top: 0, width: right - left, height: cleanedMetadata.height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const hardened = hardenAll(extracted.data, extracted.info.width, extracted.info.height);
    if (!hardened.audit.bbox || hardened.audit.borderPixels > 0) throw new Error(`${spec.id}: frame ${column + 1} is empty or touches its source-cell border`);
    sourceFrames.push({ column, left, width: right - left, raw: hardened.data, info: extracted.info, audit: hardened.audit });
  }
  const scale = Math.min(1, ...sourceFrames.map((frame) => EFFECT_FRAME.maxSubjectWidth / frame.audit.bbox.width), ...sourceFrames.map((frame) => EFFECT_FRAME.maxSubjectHeight / frame.audit.bbox.height));
  const normalized = [];
  for (const frame of sourceFrames) {
    const box = frame.audit.bbox;
    const crop = await sharp(frame.raw, { raw: frame.info }).extract({ left: box.x, top: box.y, width: box.width, height: box.height }).png().toBuffer();
    const width = Math.max(1, Math.floor(box.width * scale));
    const height = Math.max(1, Math.floor(box.height * scale));
    const sprite = await sharp(crop).resize(width, height, { fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest }).png().toBuffer();
    const left = Math.floor((EFFECT_FRAME.width - width) / 2);
    const top = spec.alignment === 'bottom' ? EFFECT_FRAME.height - height : Math.floor((EFFECT_FRAME.height - height) / 2);
    const png = await sharp({ create: { width: EFFECT_FRAME.width, height: EFFECT_FRAME.height, channels: 4, background: '#00000000' } })
      .composite([{ input: sprite, left, top }]).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    normalized.push({ ...frame, png, targetWidth: width, targetHeight: height });
  }
  const unquantized = await sharp({ create: { width: EFFECT_SHEET.width, height: EFFECT_SHEET.height, channels: 4, background: '#00000000' } })
    .composite(normalized.map((frame, index) => ({ input: frame.png, left: index * EFFECT_FRAME.width, top: 0 })))
    .png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  const output = await sharp(unquantized).png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 96, dither: 0 }).toBuffer();
  const frames = [];
  for (let column = 0; column < 4; column += 1) {
    const png = await sharp(output).extract({ left: column * EFFECT_FRAME.width, top: 0, width: EFFECT_FRAME.width, height: EFFECT_FRAME.height }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    frames.push({ column, png, decoded, audit: visibleAudit(decoded.data, EFFECT_FRAME.width, EFFECT_FRAME.height), exactHash: sha256(png), sourceBbox: sourceFrames[column].audit.bbox, targetWidth: normalized[column].targetWidth, targetHeight: normalized[column].targetHeight });
  }
  const differences = [];
  for (let left = 0; left < 4; left += 1) for (let right = left + 1; right < 4; right += 1) differences.push({ left: left + 1, right: right + 1, ...frameDifference(frames[left].decoded.data, frames[right].decoded.data) });
  const outputPath = path.join(PREPARED_ROOT, `${spec.stem}.png`);
  await writeFile(outputPath, output);
  return { spec, raw, cleaned, prompt, rawPath, cleanedPath, promptPath, rawMetadata, cleanedMetadata, output, outputPath, scale, sourceFrames, frames, differences, sheetAlpha: await auditTransparentPng(output) };
}

async function prepareObject(spec) {
  let raw; let cleaned; let prompt = null; let rawPath; let cleanedPath; let rawMetadata; let sourceCropPath = null;
  if (spec.method === 'direct-extraction') {
    rawPath = STREET_PATH;
    raw = await readFile(rawPath);
    rawMetadata = await sharp(raw).metadata();
    const [left, top, width, height] = spec.crop;
    sourceCropPath = path.join(EXTRACTION_ROOT, `${spec.stem}.png`);
    cleanedPath = path.join(EXTRACTION_ROOT, `${spec.stem}.keyed.png`);
    await sharp(raw).extract({ left, top, width, height }).png().toFile(sourceCropPath);
    await runChroma(sourceCropPath, cleanedPath, 20);
    cleaned = await readFile(cleanedPath);
  } else {
    rawPath = path.join(RAW_ROOT, `${spec.stem}.png`);
    cleanedPath = path.join(CLEANED_ROOT, `${spec.stem}.png`);
    const promptPath = path.join(PROMPT_ROOT, `${spec.stem}.txt`);
    [raw, cleaned, prompt] = await Promise.all([readFile(rawPath), readFile(cleanedPath), readFile(promptPath)]);
    rawMetadata = await sharp(raw).metadata();
    const cleanedMetadata = await sharp(cleaned).metadata();
    if (rawMetadata.width !== cleanedMetadata.width || rawMetadata.height !== cleanedMetadata.height) throw new Error(`${spec.id}: chroma removal changed source dimensions`);
  }
  const normalized = await normalizeObjectFromCleaned(cleaned, spec.stem);
  if (spec.method === 'direct-extraction' && normalized.cleanup.largestTouchedCropBorder) throw new Error(`${spec.id}: adopted extraction touches its crop border`);
  const outputPath = path.join(PREPARED_ROOT, `${spec.stem}.png`);
  await writeFile(outputPath, normalized.output);
  return {
    spec, raw, cleaned, prompt, rawPath, cleanedPath, sourceCropPath, rawMetadata, outputPath,
    output: normalized.output, scale: normalized.scale, sourceAudit: normalized.sourceAudit,
    audit: normalized.audit, cleanup: normalized.cleanup, targetWidth: normalized.targetWidth, targetHeight: normalized.targetHeight
  };
}

async function renderCropOverlay(entry) {
  const [x, y, width, height] = entry.spec.crop;
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#ff1744" stroke-width="6"/><rect x="${x}" y="${Math.max(0, y - 30)}" width="${Math.max(220, width)}" height="28" fill="#171b1d"/><text x="${x + 5}" y="${Math.max(18, y - 10)}" font-size="18" fill="#ffffff">${escapeXml(`${entry.spec.id} [${entry.spec.crop.join(',')}]`)}</text></svg>`);
  const markedSource = await sharp(STREET_PATH).composite([{ input: overlay, left: 0, top: 0 }]).png().toBuffer();
  const source = await sharp(markedSource).resize(768, 512, { kernel: sharp.kernel.nearest }).png().toBuffer();
  const crop = await sharp(entry.sourceCropPath).resize(220, 220, { fit: 'contain', background: '#171b1d', kernel: sharp.kernel.nearest }).png().toBuffer();
  const adopted = await sharp(entry.output).resize(220, 220, { fit: 'contain', kernel: sharp.kernel.nearest }).png().toBuffer();
  const checker = checkerSvg(220, 220, 16);
  const panel = await sharp({ create: { width: 1232, height: 540, channels: 4, background: '#171b1d' } })
    .composite([
      { input: source, left: 8, top: 8 },
      { input: crop, left: 784, top: 8 },
      { input: checker, left: 1008, top: 8 },
      { input: adopted, left: 1008, top: 8 },
      { input: labelSvg(`source overlay · crop ${entry.spec.crop.join(',')} · source sha ${sha256(entry.raw).slice(0, 16)}`, 1216, 24, 11), left: 8, top: 516 }
    ]).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(OVERLAY_ROOT, `${entry.spec.stem}.png`), panel);
}

async function renderObjectNative(entries) {
  const columns = 6; const cellWidth = 150; const cellHeight = 118; const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = (index % columns) * cellWidth + 8; const y = Math.floor(index / columns) * cellHeight + 8;
    composites.push({ input: checkerSvg(64, 64, 8), left: x, top: y });
    composites.push({ input: entry.output, left: x, top: y });
    composites.push({ input: labelSvg(entry.spec.id, 136, 24, 9), left: x, top: y + 68 });
    composites.push({ input: labelSvg(`${entry.audit.bbox.width}x${entry.audit.bbox.height} · ${entry.spec.method}`, 136, 18, 8), left: x, top: y + 90 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(entries.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-objects-native.png`));
}

async function renderObjectRole4x(entries) {
  const columns = 3; const cellWidth = 300; const cellHeight = 300; const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = (index % columns) * cellWidth + 20; const y = Math.floor(index / columns) * cellHeight + 8;
    const enlarged = await sharp(entry.output).resize(256, 256, { kernel: sharp.kernel.nearest }).png().toBuffer();
    composites.push({ input: checkerSvg(256, 256, 32), left: x, top: y });
    composites.push({ input: enlarged, left: x, top: y });
    composites.push({ input: labelSvg(`${entry.spec.id} · 4x`, 272, 28, 11), left: x, top: y + 260 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(entries.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-objects-role-4x.png`));
}

async function renderEffectSheets(entries) {
  const nativeComposites = []; const enlargedComposites = [];
  for (const [index, entry] of entries.entries()) {
    const nativeY = index * 82 + 8;
    nativeComposites.push({ input: checkerSvg(128, 32, 4), left: 8, top: nativeY });
    nativeComposites.push({ input: entry.output, left: 8, top: nativeY });
    nativeComposites.push({ input: labelSvg(`${entry.spec.id} · frames 1 2 3 4`, 330, 24, 11), left: 144, top: nativeY + 4 });
    const enlarged = await sharp(entry.output).resize(512, 128, { kernel: sharp.kernel.nearest }).png().toBuffer();
    const largeY = index * 172 + 8;
    enlargedComposites.push({ input: checkerSvg(512, 128, 16), left: 8, top: largeY });
    enlargedComposites.push({ input: enlarged, left: 8, top: largeY });
    enlargedComposites.push({ input: labelSvg(`${entry.spec.id} · 4x · ordered 1 → 4`, 512, 28, 11), left: 8, top: largeY + 132 });
  }
  await sharp({ create: { width: 480, height: entries.length * 82, channels: 4, background: '#171b1d' } })
    .composite(nativeComposites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-effects-all-frames-native.png`));
  await sharp({ create: { width: 528, height: entries.length * 172, channels: 4, background: '#171b1d' } })
    .composite(enlargedComposites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-effects-all-frames-4x.png`));
}

async function main() {
  if (OBJECTS.length !== 18 || EFFECTS.length !== 2 || new Set([...OBJECTS, ...EFFECTS].map((entry) => entry.id)).size !== 20) throw new Error('Wave 1D must define exactly 18 objects and 2 effects');
  await Promise.all([mkdir(EXTRACTION_ROOT, { recursive: true }), mkdir(PREPARED_ROOT, { recursive: true }), mkdir(OVERLAY_ROOT, { recursive: true }), mkdir(REVIEW_ROOT, { recursive: true })]);
  const promptFiles = (await readdir(PROMPT_ROOT, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.txt')).map((entry) => entry.name).sort();
  const rawFiles = (await readdir(RAW_ROOT, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.png')).map((entry) => entry.name).sort();
  const cleanedFiles = (await readdir(CLEANED_ROOT, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.png')).map((entry) => entry.name).sort();
  if (promptFiles.length !== 10 || rawFiles.length !== 10 || cleanedFiles.length !== 10) throw new Error(`Wave 1D requires exactly 10 active prompt/raw/cleaned imagegen files: ${JSON.stringify({ promptFiles: promptFiles.length, rawFiles: rawFiles.length, cleanedFiles: cleanedFiles.length })}`);

  const before = await readLocalGenerationManifest(FORGE_ROOT);
  const beforeCounts = Object.fromEntries(['building', 'field', 'character', 'object', 'effect'].map((category) => [category, before.results.filter((entry) => entry.category === category).length]));
  const waveIds = new Set([...OBJECTS, ...EFFECTS].map((entry) => entry.id));
  const existingWaveResults = before.results.filter((entry) => entry.category === 'object' || entry.category === 'effect');
  if (beforeCounts.building !== 17 || beforeCounts.field !== 19 || beforeCounts.character !== 22
    || beforeCounts.object > 18 || beforeCounts.effect > 2 || before.results.some((entry) => entry.status !== 'pending')
    || existingWaveResults.some((entry) => !waveIds.has(entry.assetId))
    || new Set(existingWaveResults.map((entry) => entry.assetId)).size !== existingWaveResults.length) {
    throw new Error(`Wave 1D requires the accepted 58 inputs plus only resumable Wave 1D pending results: ${JSON.stringify(beforeCounts)}`);
  }
  const objectPendingFileCount = (await filesBelow(path.join(FORGE_ROOT, 'generated', 'objects', 'pending'))).length;
  const effectPendingFileCount = (await filesBelow(path.join(FORGE_ROOT, 'generated', 'effects', 'pending'))).length;
  if (objectPendingFileCount !== beforeCounts.object * 3 || effectPendingFileCount !== beforeCounts.effect * 3) throw new Error(`Wave 1D resumable file count mismatch: ${JSON.stringify({ objectPendingFileCount, effectPendingFileCount, beforeCounts })}`);
  const existingByAssetId = new Map(existingWaveResults.map((entry) => [entry.assetId, entry]));
  const recipeMigrations = await readPriorRecipeMigrations();
  const accepted58Before = {
    buildings: await treeHashes(path.join(FORGE_ROOT, 'generated', 'buildings', 'pending')),
    fields: await treeHashes(path.join(FORGE_ROOT, 'generated', 'fields', 'pending')),
    characters: await treeHashes(path.join(FORGE_ROOT, 'generated', 'characters', 'pending'))
  };

  const objects = [];
  for (const spec of OBJECTS) objects.push(await prepareObject(spec));
  const effects = [];
  for (const spec of EFFECTS) effects.push(await prepareEffect(spec));

  for (const entry of objects) {
    const { job } = await buildJob({ assetId: entry.spec.id, provider: 'manual-import' });
    const direct = entry.spec.method === 'direct-extraction';
    const transformSteps = direct
      ? ['crop', 'chroma-key-remove', ...(entry.scale < 1 ? ['nearest-downscale'] : []), 'hard-alpha', 'palette-quantize']
      : ['full-frame', 'chroma-key-remove', 'nearest-downscale', 'hard-alpha', 'palette-quantize'];
    const recipe = {
      waveId: WAVE_ID, assetId: entry.spec.id, method: entry.spec.method, generator: direct ? 'approved-reference-direct-extraction' : 'codex-imagegen-built-in', scaleClass: 'tiny',
      ...(direct ? { orientationContract: 'complete standalone prop centered on a 64x64 transparent canvas and aligned to baseline y=63' } : {
        generationPromptPath: posix(path.join(PROMPT_ROOT, `${entry.spec.stem}.txt`)),
        generationPromptSha256: sha256(entry.prompt), toolMode: 'built-in',
        inputReferences: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index], role: index === 0 ? 'global-style' : 'primary-subject' }))
      }),
      transformSteps,
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      source: {
        path: posix(entry.rawPath), sha256: sha256(entry.raw), width: entry.rawMetadata.width, height: entry.rawMetadata.height,
        cropRect: direct ? { x: entry.spec.crop[0], y: entry.spec.crop[1], width: entry.spec.crop[2], height: entry.spec.crop[3] } : null
      },
      backgroundRemoval: {
        method: 'official-chroma-key-helper', keyColor: null, autoKey: 'border', softMatte: true,
        transparentThreshold: direct ? 20 : 35, opaqueThreshold: 110, despill: true,
        cleanup: { alphaCutoff: ALPHA_CUTOFF, componentMinPixels: 1, targetMaxWidth: OBJECT_CANVAS.maxSubjectWidth, targetMaxHeight: OBJECT_CANVAS.maxSubjectHeight, resizeKernel: 'nearest' }
      },
      canvas: { width: OBJECT_CANVAS.width, height: OBJECT_CANVAS.height, baselineY: OBJECT_CANVAS.baselineY },
      subjectBbox: entry.audit.bbox
    };
    const existing = existingByAssetId.get(entry.spec.id);
    if (existing) {
      const resumed = await resumeWithVerifiedRecipe(existing, recipe, entry.output);
      entry.result = resumed.result;
    } else {
      const imported = await importCandidate({ assetId: entry.spec.id, file: entry.outputPath, productionRecipe: recipe }, { now: () => '2026-07-14T10:00:00.000Z' });
      entry.result = imported.result;
    }
  }

  for (const entry of effects) {
    const { job } = await buildJob({ assetId: entry.spec.id, provider: 'manual-import' });
    const recipe = {
      waveId: WAVE_ID, assetId: entry.spec.id, method: 'imagegen', generator: 'codex-imagegen-built-in', scaleClass: 'tiny',
      generationPromptPath: posix(entry.promptPath), generationPromptSha256: sha256(entry.prompt), toolMode: 'built-in',
      inputReferences: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index], role: index === 0 ? 'global-style' : 'primary-subject' })),
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      transformSteps: ['full-frame', 'chroma-key-remove', 'cell-extract', 'shared-scale-normalize', 'nearest-downscale', 'hard-alpha', 'palette-quantize'],
      effectContract: {
        frame: { width: EFFECT_FRAME.width, height: EFFECT_FRAME.height }, grid: { columns: 4, rows: 1 },
        frameOrder: ['frame_1', 'frame_2', 'frame_3', 'frame_4'], segmentation: 'explicit-transparent-gutters',
        sourceSlices: entry.sourceFrames.map((frame) => ({
          frame: frame.column + 1,
          rect: { x: frame.left, y: 0, width: frame.width, height: entry.cleanedMetadata.height },
          transparentMargins: {
            left: frame.audit.bbox.x,
            right: frame.width - frame.audit.bbox.x - frame.audit.bbox.width,
            top: frame.audit.bbox.y,
            bottom: entry.cleanedMetadata.height - frame.audit.bbox.y - frame.audit.bbox.height
          }
        })),
        sharedScale: entry.scale, alignment: entry.spec.alignment, resizeKernel: 'nearest', allowEnlargement: false, partialAlphaPixels: 0
      },
      source: { path: posix(entry.rawPath), sha256: sha256(entry.raw), width: entry.rawMetadata.width, height: entry.rawMetadata.height, cropRect: null },
      backgroundRemoval: {
        method: 'official-chroma-key-helper', keyColor: null, autoKey: 'border', softMatte: true, transparentThreshold: 35, opaqueThreshold: 110, despill: true,
        cleanup: { alphaCutoff: ALPHA_CUTOFF, componentMinPixels: 1, targetMaxWidth: EFFECT_FRAME.maxSubjectWidth, targetMaxHeight: EFFECT_FRAME.maxSubjectHeight, resizeKernel: 'nearest' }
      },
      canvas: { width: EFFECT_SHEET.width, height: EFFECT_SHEET.height, baselineY: effectBaselineY(entry) }, subjectBbox: entry.sheetAlpha.subjectBbox
    };
    const existing = existingByAssetId.get(entry.spec.id);
    if (existing) {
      const resumed = await resumeWithVerifiedRecipe(existing, recipe, entry.output, { allowCenteredBaselineMigration: true });
      entry.result = resumed.result;
      if (resumed.migration && !recipeMigrations.some((entry) => entry.generationId === resumed.migration.generationId
        && entry.kind === resumed.migration.kind)) recipeMigrations.push(resumed.migration);
    } else {
      const imported = await importCandidate({ assetId: entry.spec.id, file: entry.outputPath, productionRecipe: recipe }, { now: () => '2026-07-14T10:00:00.000Z' });
      entry.result = imported.result;
    }
  }

  for (const entry of objects.filter((candidate) => candidate.spec.method === 'direct-extraction')) await renderCropOverlay(entry);
  await renderObjectNative(objects);
  await renderObjectRole4x(objects);
  await renderEffectSheets(effects);

  const after = await readLocalGenerationManifest(FORGE_ROOT);
  const afterCounts = Object.fromEntries(['building', 'field', 'character', 'object', 'effect'].map((category) => [category, after.results.filter((entry) => entry.category === category).length]));
  const accepted58After = {
    buildings: await treeHashes(path.join(FORGE_ROOT, 'generated', 'buildings', 'pending')),
    fields: await treeHashes(path.join(FORGE_ROOT, 'generated', 'fields', 'pending')),
    characters: await treeHashes(path.join(FORGE_ROOT, 'generated', 'characters', 'pending'))
  };
  const approvals = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'approvals.json')));
  const assets = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'assets.json')));
  let publicForgeAbsent = false;
  try { await access(path.resolve(FORGE_ROOT, '..', '..', 'public', 'assets', 'forge')); } catch (error) { publicForgeAbsent = error?.code === 'ENOENT'; }

  const rejectedInputs = [];
  for (const rejected of REJECTED_INPUTS) rejectedInputs.push({
    ...rejected,
    rawSha256: sha256(await readFile(path.join(FORGE_ROOT, rejected.rawPath))),
    ...(rejected.promptPath ? { promptSha256: sha256(await readFile(path.join(FORGE_ROOT, rejected.promptPath))) } : {}),
    ...(rejected.cleanedPath ? { cleanedSha256: sha256(await readFile(path.join(FORGE_ROOT, rejected.cleanedPath))) } : {})
  });
  const imagegenEntries = [...objects.filter((entry) => entry.spec.method === 'imagegen'), ...effects];
  const callRecords = imagegenEntries.map((entry) => ({
    assetId: entry.spec.id,
    evidenceClass: 'orchestration-session observation; not an independent provider attestation',
    sessionEvidence: {
      generatedImageSessionDirectory: '019f5db8-e80b-7b43-82d1-64b5d230f35c', batchId: CALL_EVIDENCE[entry.spec.stem][0], generatedOutputArtifactBasename: CALL_EVIDENCE[entry.spec.stem][1],
      observedProcedure: 'The orchestrator read the tracked prompt immediately before the distinct built-in imagegen call and passed that text with the world and definition-primary references.',
      ...(entry.spec.stem === 'signboard' ? { recoveryNote: 'The call completed and returned an output_hint; after interruption, the existing completed artifact was recovered exactly once. It was not a failed call and was not retried.' } : {})
    },
    promptPath: posix(entry.promptPath || path.join(PROMPT_ROOT, `${entry.spec.stem}.txt`)), trackedPromptSha256: sha256(entry.prompt),
    recipePromptSnapshotSha256: entry.result.productionRecipe.generationPromptSha256,
    recipePromptSnapshotHashConsistent: sha256(entry.prompt) === entry.result.productionRecipe.generationPromptSha256,
    inputReferences: entry.result.productionRecipe.inputReferences, rawSourcePath: entry.result.productionRecipe.source.path,
    rawSourceSha256: entry.result.productionRecipe.source.sha256, cleanedSourcePath: posix(entry.cleanedPath), cleanedSourceSha256: sha256(entry.cleaned),
    outputPath: entry.result.outputPath, outputSha256: entry.result.outputSha256
  }));
  const objectAudits = objects.map((entry) => ({
    assetId: entry.spec.id, method: entry.spec.method, primaryReferenceId: entry.spec.primary,
    sourcePath: entry.result.productionRecipe.source.path, sourceSha256: entry.result.productionRecipe.source.sha256,
    cropRect: entry.result.productionRecipe.source.cropRect, outputPath: entry.result.outputPath, outputSha256: entry.result.outputSha256,
    outputDimensions: { width: entry.result.outputInspection.width, height: entry.result.outputInspection.height },
    sourceBbox: entry.sourceAudit.bbox, outputBbox: entry.audit.bbox, scale: entry.scale, partialAlphaPixels: entry.audit.partialAlphaPixels,
    visiblePixels: entry.audit.visiblePixels, visibleColorCount: entry.audit.visibleColorCount, cleanup: entry.cleanup
  }));
  const effectAudits = effects.map((entry) => ({
    assetId: entry.spec.id, primaryReferenceId: entry.spec.primary, outputPath: entry.result.outputPath, outputSha256: entry.result.outputSha256,
    outputDimensions: { width: entry.result.outputInspection.width, height: entry.result.outputInspection.height },
    canvas: entry.result.productionRecipe.canvas, subjectBbox: entry.result.productionRecipe.subjectBbox, sharedScale: entry.scale,
    sourceSlices: entry.result.productionRecipe.effectContract.sourceSlices,
    frames: entry.frames.map((frame) => ({ frame: frame.column + 1, sourceBbox: frame.sourceBbox, outputBbox: frame.audit.bbox, partialAlphaPixels: frame.audit.partialAlphaPixels, visiblePixels: frame.audit.visiblePixels, visibleColorCount: frame.audit.visibleColorCount, exactHash: frame.exactHash })),
    pairDifferences: entry.differences
  }));
  const allOutputHashes = after.results.map((entry) => entry.outputSha256);
  const processingRecoveries = [];
  for (const file of await filesBelow(path.join(TMP_ROOT, 'orphaned-import'))) processingRecoveries.push({
    kind: 'unledgered-import-file-preserved', path: posix(file), sha256: sha256(await readFile(file)),
    reason: 'A schema-validation stop occurred after atomic source/output writes but before metadata and ledger append; the two unledgered files were moved aside before the successful resumable import.'
  });
  const gates = {
    activeImagegenPromptRawCleaned10: promptFiles.length === 10 && rawFiles.length === 10 && cleanedFiles.length === 10,
    distinctBuiltInCalls10Recorded: callRecords.length === 10 && callRecords.every((record) => record.sessionEvidence.generatedOutputArtifactBasename.startsWith('exec-') && record.evidenceClass.includes('not an independent provider attestation')),
    promptSnapshotsAndReferencesExact10: callRecords.every((record) => record.recipePromptSnapshotHashConsistent && record.inputReferences.length === 2 && record.inputReferences[0].id === WORLD_REFERENCE && record.inputReferences[0].role === 'global-style' && record.inputReferences[1].role === 'primary-subject'),
    objects18At64x64: objectAudits.length === 18 && objectAudits.every((entry) => entry.outputDimensions.width === 64 && entry.outputDimensions.height === 64),
    objectAlphaBboxColors: objectAudits.every((entry) => entry.partialAlphaPixels === 0 && entry.outputBbox && entry.outputBbox.width <= 60 && entry.outputBbox.height <= 60 && entry.outputBbox.y + entry.outputBbox.height === 64 && entry.visibleColorCount >= 2 && entry.visibleColorCount <= 96),
    objectNoEnlargement: objectAudits.every((entry) => entry.scale > 0 && entry.scale <= 1 && entry.outputBbox.width <= entry.sourceBbox.width && entry.outputBbox.height <= entry.sourceBbox.height),
    directExtractions10WithCleanCropOverlays: objectAudits.filter((entry) => entry.method === 'direct-extraction').length === 10 && objectAudits.filter((entry) => entry.method === 'direct-extraction').every((entry) => entry.cropRect && !entry.cleanup.largestTouchedCropBorder) && (await filesBelow(OVERLAY_ROOT)).length === 10,
    effects2At128x32FourFrames: effectAudits.length === 2 && effectAudits.every((entry) => entry.outputDimensions.width === 128 && entry.outputDimensions.height === 32 && entry.frames.length === 4),
    effectAlphaBboxColors: effectAudits.flatMap((entry) => entry.frames).every((frame) => frame.partialAlphaPixels === 0 && frame.outputBbox && frame.outputBbox.width <= 28 && frame.outputBbox.height <= 28 && frame.visibleColorCount >= 1 && frame.visibleColorCount <= 96),
    effectFramesDistinctReadable: effectAudits.every((entry) => new Set(entry.frames.map((frame) => frame.exactHash)).size === 4 && entry.pairDifferences.length === 6 && entry.pairDifferences.every((pair) => pair.changedPixels > 0 && pair.silhouetteChangedPixels > 0)),
    effectSharedScaleNoEnlargement: effectAudits.every((entry) => entry.sharedScale > 0 && entry.sharedScale <= 1),
    effectSourceSlicesUseVerifiedTransparentGutters: effectAudits.every((entry) => entry.sourceSlices.length === 4 && entry.sourceSlices.every((slice) => Object.values(slice.transparentMargins).every((margin) => margin > 0))),
    rejectedAttemptsRecordedAndExcluded: rejectedInputs.length === 3 && rejectedInputs.every((rejected) => {
      const adopted = objectAudits.find((entry) => entry.assetId === rejected.assetId);
      if (!adopted) return false;
      if (rejected.kind === 'imagegen-source') return adopted.sourceSha256 !== rejected.rawSha256;
      return !same(adopted.cropRect, rejected.cropRect);
    }),
    accepted58CandidateTreesByteUnchanged: same(accepted58Before, accepted58After),
    ledgerExactly78Pending: after.results.length === 78 && after.results.every((entry) => entry.status === 'pending'),
    ledgerCategorySplit17_19_22_18_2: same(afterCounts, { building: 17, field: 19, character: 22, object: 18, effect: 2 }),
    all78OutputHashesUnique: new Set(allOutputHashes).size === 78,
    productionApprovalsZero: approvals.approvals.length === 0,
    lifecycleZero: assets.assets.every((entry) => entry.status === 'missing' && entry.approvedPath == null),
    approvedObjectEffectFilesZero: [...await filesBelow(path.join(FORGE_ROOT, 'generated', 'objects', 'approved')), ...await filesBelow(path.join(FORGE_ROOT, 'generated', 'effects', 'approved'))]
      .every((file) => /\.source-original\.(png|jpg|webp)$/.test(file)),
    publicForgeAbsent
  };
  if (Object.values(gates).some((value) => !value)) throw new Error(`Wave 1D gate failure: ${JSON.stringify(gates)}`);

  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-imagegen-call-audit.json`), `${JSON.stringify({ schemaVersion: 1, waveId: WAVE_ID, adoptedCallCount: 10, recoveredCompletedCalls: ['object.signboard'], rejectedInputs, records: callRecords }, null, 2)}\n`);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-recipes.json`), `${JSON.stringify({ schemaVersion: 1, waveId: WAVE_ID, state: 'pending-formal-promotion', recipes: [...objects, ...effects].map((entry) => ({ outputPath: entry.result.outputPath, ...entry.result.productionRecipe })) }, null, 2)}\n`);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-audit.json`), `${JSON.stringify({
    schemaVersion: 1, waveId: WAVE_ID, state: 'lead-visually-accepted-pending-formal-promotion',
    observed: [
      'Lead visually accepted every adopted raw source, including the medieval construction-sign retry, the recovered completed signboard call, the single-crate replacement, and both four-frame effects.',
      'Lead visually accepted all eighteen normalized objects and both normalized four-frame effects in native and four-times QA sheets, pending formal production promotion.',
      'Ten approved-reference direct crops and ten distinct built-in imagegen calls produced eighteen normalized objects and two normalized effects.',
      'All normalized objects and effect frames satisfy their exact dimensions, hard-alpha, bounding-box, palette, source, reference, and no-enlargement gates.',
      'The pre-existing fifty-eight candidate trees remained byte-identical and the local ledger now contains exactly seventy-eight pending candidates.'
    ],
    inferred: [
      'Native and enlarged QA sheets preserve clear role silhouettes and ordered animation states at intended map scale.'
    ],
    unknown: [
      'formal production promotion and export',
      'runtime animation timing, placement, and collision behavior'
    ],
    gates, contract: { objectCanvas: OBJECT_CANVAS, effectFrame: EFFECT_FRAME, effectSheet: EFFECT_SHEET, hardAlpha: true, nearestDownscaleOnly: true, allowEnlargement: false },
    rejectedInputs, processingRecoveries, recipeMigrations, objects: objectAudits, effects: effectAudits, accepted58TreeHashes: { before: accepted58Before, after: accepted58After }
  }, null, 2)}\n`);
}

await main();
