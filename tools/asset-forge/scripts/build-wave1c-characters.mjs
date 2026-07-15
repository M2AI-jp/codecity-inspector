import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import { FORGE_ROOT } from '../src/config.mjs';
import { sha256 } from '../src/hashing.mjs';
import { auditTransparentPng } from '../src/images/audit-alpha.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';

const WAVE_ID = 'wave1c-characters';
const FRAME = Object.freeze({ width: 24, height: 40, alphaCutoff: 96 });
const SHEET = Object.freeze({ width: 96, height: 120, columns: 4, rows: 3 });
const SOURCE_COLUMN_ORDER = Object.freeze(['front', 'back', 'right', 'left']);
const NORMALIZED_COLUMN_ORDER = Object.freeze(['front', 'back', 'left', 'right']);
const NORMALIZED_COLUMN_SOURCES = Object.freeze([0, 1, 3, 2]);
const ROW_ORDER = Object.freeze(['idle', 'walk1', 'walk2']);
const RAW_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', WAVE_ID, 'raw');
const CLEANED_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', WAVE_ID, 'cleaned');
const PREPARED_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', WAVE_ID, 'prepared');
const PROMPT_ROOT = path.join(FORGE_ROOT, 'review', 'prompts', WAVE_ID);
const REVIEW_ROOT = path.join(FORGE_ROOT, 'review');

const CHARACTERS = Object.freeze([
  ['character.player', 'player', 'adult', 'inspector ledger and satchel'],
  ['character.innkeeper', 'innkeeper', 'adult', 'apron and key'],
  ['character.tavern_master', 'tavern_master', 'adult', 'vest and tankard'],
  ['character.town_clerk', 'town_clerk', 'adult', 'reserved coat and ledger'],
  ['character.workshop_artisan', 'workshop_artisan', 'adult', 'leather apron and hammer'],
  ['character.dojo_inspector', 'dojo_inspector', 'adult', 'training coat and scroll'],
  ['character.watchtower_guard', 'watchtower_guard', 'adult', 'mail and tabard'],
  ['character.dock_ferryman', 'dock_ferryman', 'adult', 'weathered coat and rope'],
  ['character.warehouse_keeper', 'warehouse_keeper', 'adult', 'heavy apron and keyring'],
  ['character.gatekeeper', 'gatekeeper', 'adult', 'cloak and lantern'],
  ['character.mob.townsfolk_male', 'mob_townsfolk_male', 'adult', 'plain wool tunic'],
  ['character.mob.townsfolk_female', 'mob_townsfolk_female', 'adult', 'shawl and long skirt'],
  ['character.mob.elder', 'mob_elder', 'elder', 'stooped posture and cane'],
  ['character.mob.child', 'mob_child', 'child', 'short child silhouette'],
  ['character.mob.traveler', 'mob_traveler', 'adult', 'cloak and backpack'],
  ['character.mob.merchant', 'mob_merchant', 'adult', 'layered coat and satchel'],
  ['character.mob.artisan', 'mob_artisan', 'adult', 'short work apron and tool'],
  ['character.mob.tavern_guest', 'mob_tavern_guest', 'adult', 'casual clothes and mug'],
  ['character.mob.inn_guest', 'mob_inn_guest', 'adult', 'travel coat and luggage'],
  ['character.mob.dock_worker', 'mob_dock_worker', 'adult', 'cap and rope'],
  ['character.mob.delivery_person', 'mob_delivery_person', 'adult', 'short coat and parcel'],
  ['character.guildmaster', 'guildmaster', 'adult', 'restrained ornate coat and medallion']
].map(([id, stem, heightClass, roleRead]) => Object.freeze({ id, stem, heightClass, roleRead })));

const HEIGHT = Object.freeze({
  adult: Object.freeze({ min: 28, max: 32, target: 30 }),
  elder: Object.freeze({ min: 26, max: 30, target: 28 }),
  child: Object.freeze({ min: 21, max: 25, target: 23 })
});

const CALL_EVIDENCE = Object.freeze({
  player: ['batch-01-single', 'exec-2099c0e5-422f-4b52-9ac5-c05d65a4700a.png'],
  innkeeper: ['batch-02-four', 'exec-c8a15332-1e42-46fe-976d-52bc9ed4203f.png'],
  tavern_master: ['batch-02-four', 'exec-8c93b9f8-6ec4-4a66-888b-adf15424f309.png'],
  town_clerk: ['batch-02-four', 'exec-120a8518-1058-4fa2-92e5-471cdf6c71ff.png'],
  workshop_artisan: ['batch-02-four', 'exec-d3b57e97-b43a-4599-bcb6-11a60afc4834.png'],
  dojo_inspector: ['batch-03-three', 'exec-4bf13e20-6bd8-43bb-9f75-78d007058531.png'],
  watchtower_guard: ['batch-03-three', 'exec-54034166-3914-4a9a-92af-f3637673162a.png'],
  dock_ferryman: ['batch-03-three', 'exec-c45ec826-915b-497c-8eaf-6a4bbeef2010.png'],
  warehouse_keeper: ['batch-04-three', 'exec-243ba14c-f9c9-437d-b1ea-cd4513dccb05.png'],
  gatekeeper: ['batch-04-three', 'exec-ce73f3af-498c-4fd1-ae7c-c314ff2fa18e.png'],
  mob_townsfolk_male: ['batch-04-three', 'exec-1504caf9-f50b-4b36-9d76-6fbb913c7c47.png'],
  mob_townsfolk_female: ['batch-05-three', 'exec-befddbf3-eb2b-4e71-a32e-2b3c009baf31.png'],
  mob_elder: ['batch-05-three', 'exec-f314f0c0-bfe9-44f3-be3e-74304a1a411e.png'],
  mob_child: ['batch-05-three', 'exec-65e725d1-631d-4c51-9654-ac8cfe5da94b.png'],
  mob_traveler: ['batch-06-three', 'exec-891a80b7-1bd8-48bf-8d4c-749a50b472bb.png'],
  mob_merchant: ['batch-06-three', 'exec-d90b81ca-18fc-4785-83a9-f14fc1c06d71.png'],
  mob_artisan: ['batch-06-three', 'exec-f0637f27-5820-4afe-92dd-9029d889b39f.png'],
  mob_tavern_guest: ['batch-07-two', 'exec-bce4345a-a0f3-4384-9d5b-5ce136758425.png'],
  mob_inn_guest: ['batch-07-two', 'exec-25868151-dd1b-41a2-bbfb-3eaeb515c9cb.png'],
  mob_dock_worker: ['batch-08-three', 'exec-5979c215-6cf4-43e3-a54a-df87c2affcce.png'],
  mob_delivery_person: ['batch-08-three', 'exec-6da859c1-ec36-49f4-9bca-5c880fafafe2.png'],
  guildmaster: ['batch-09-technical-retry', 'exec-28351a6e-655f-4bc2-ae6c-a4e21fa7887f.png']
});

const REJECTED_INPUTS = Object.freeze([{
  assetId: 'character.guildmaster',
  reason: 'The first source had 256–318px source-cell visible heights, so one common downscale could not satisfy the adult 28–32px output contract.',
  rawPath: 'tmp/imagegen/wave1c-characters/rejected/guildmaster-v1-inconsistent-scale.png',
  promptPath: 'review/prompts/wave1c-characters/rejected/guildmaster-v1-inconsistent-scale.txt'
}]);

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function labelSvg(text, width, height = 24, fontSize = 10) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171b1d"/><text x="5" y="${Math.min(height - 6, fontSize + 6)}" font-family="ui-monospace,monospace" font-size="${fontSize}" fill="#f1ede3">${escapeXml(text)}</text></svg>`);
}

function checkerSvg(width, height, size) {
  const blocks = [];
  for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
    const fill = ((x / size + y / size) % 2 === 0) ? '#30383c' : '#465156';
    blocks.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${blocks.join('')}</svg>`);
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

async function countFiles(directory) {
  return (await filesBelow(directory)).length;
}

function sameObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function bboxFor(data, width, height, cutoff = 0) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let partialAlphaPixels = 0;
  const colors = new Set();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    const alpha = data[index + 3];
    if (alpha > 0 && alpha < 255) partialAlphaPixels += 1;
    if (alpha <= cutoff) continue;
    visiblePixels += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    colors.add(data.subarray(index, index + 3).toString('hex'));
  }
  return {
    bbox: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    visiblePixels,
    visibleColorCount: colors.size,
    partialAlphaPixels
  };
}

function removeTinyComponents(data, width, height, cutoff = 16, minPixels = 64) {
  const output = Buffer.from(data);
  const visited = new Uint8Array(width * height);
  const neighbors = [-1, 0, 1];
  for (let seed = 0; seed < width * height; seed += 1) {
    if (visited[seed]) continue;
    const alpha = output[seed * 4 + 3];
    if (alpha <= cutoff) { visited[seed] = 1; continue; }
    const stack = [seed];
    const component = [];
    visited[seed] = 1;
    while (stack.length) {
      const pixel = stack.pop();
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (const dy of neighbors) for (const dx of neighbors) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (visited[next]) continue;
        if (output[next * 4 + 3] <= cutoff) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    if (component.length < minPixels) for (const pixel of component) output.fill(0, pixel * 4, pixel * 4 + 4);
  }
  return output;
}

function hardenAlpha(data) {
  const output = Buffer.from(data);
  for (let index = 0; index < output.length; index += 4) {
    if (output[index + 3] < FRAME.alphaCutoff) output.fill(0, index, index + 4);
    else output[index + 3] = 255;
  }
  return output;
}

function frameDifference(first, second) {
  let changedPixels = 0;
  let silhouetteChangedPixels = 0;
  let colorChangedPixels = 0;
  for (let index = 0; index < first.length; index += 4) {
    const firstVisible = first[index + 3] > 0;
    const secondVisible = second[index + 3] > 0;
    const changed = first[index] !== second[index] || first[index + 1] !== second[index + 1]
      || first[index + 2] !== second[index + 2] || first[index + 3] !== second[index + 3];
    if (changed) changedPixels += 1;
    if (firstVisible !== secondVisible) silhouetteChangedPixels += 1;
    if (firstVisible && secondVisible && changed) colorChangedPixels += 1;
  }
  return { changedPixels, silhouetteChangedPixels, colorChangedPixels };
}

function hamming(left, right) {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) distance += 1;
  return distance;
}

async function perceptualHash(framePng) {
  const sample = await sharp(framePng).flatten({ background: '#000000' }).greyscale()
    .resize({ width: 8, height: 8, fit: 'fill', kernel: sharp.kernel.nearest }).raw().toBuffer();
  const average = [...sample].reduce((sum, value) => sum + value, 0) / sample.length;
  return [...sample].map((value) => value >= average ? '1' : '0').join('');
}

async function sourceFrames(cleaned) {
  const metadata = await sharp(cleaned).metadata();
  const columnEdges = Array.from({ length: 5 }, (_, index) => Math.floor(index * metadata.width / 4));
  const rowEdges = Array.from({ length: 4 }, (_, index) => Math.floor(index * metadata.height / 3));
  const frames = [];
  for (let row = 0; row < 3; row += 1) for (let sourceColumn = 0; sourceColumn < 4; sourceColumn += 1) {
    const cell = {
      left: columnEdges[sourceColumn], top: rowEdges[row],
      width: columnEdges[sourceColumn + 1] - columnEdges[sourceColumn],
      height: rowEdges[row + 1] - rowEdges[row]
    };
    const decoded = await sharp(cleaned).extract(cell).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cleanedPixels = removeTinyComponents(decoded.data, decoded.info.width, decoded.info.height);
    const audit = bboxFor(cleanedPixels, decoded.info.width, decoded.info.height, 16);
    if (!audit.bbox) throw new Error(`empty source cell ${sourceColumn},${row}`);
    frames.push({ sourceColumn, row, cell, data: cleanedPixels, info: decoded.info, audit });
  }
  return { metadata, columnEdges, rowEdges, frames };
}

async function normalizedFrames(source, bounds, scale) {
  const frames = [];
  for (const entry of source.frames) {
    const cropped = await sharp(entry.data, { raw: entry.info }).extract({
      left: entry.audit.bbox.x, top: entry.audit.bbox.y,
      width: entry.audit.bbox.width, height: entry.audit.bbox.height
    }).resize({
      width: Math.max(1, Math.floor(entry.audit.bbox.width * scale)),
      height: Math.max(1, Math.floor(entry.audit.bbox.height * scale)),
      fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const hardened = hardenAlpha(cropped.data);
    const visible = bboxFor(hardened, cropped.info.width, cropped.info.height, 0);
    if (!visible.bbox) throw new Error(`empty normalized source cell ${entry.sourceColumn},${entry.row}`);
    const visibleCrop = await sharp(hardened, { raw: cropped.info }).extract({
      left: visible.bbox.x, top: visible.bbox.y, width: visible.bbox.width, height: visible.bbox.height
    }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    const left = Math.floor((FRAME.width - visible.bbox.width) / 2);
    const top = FRAME.height - visible.bbox.height;
    if (left < 1 || top < 1 || visible.bbox.width > 22 || visible.bbox.height < bounds.min || visible.bbox.height > bounds.max) {
      return null;
    }
    const png = await sharp({ create: { width: FRAME.width, height: FRAME.height, channels: 4, background: '#00000000' } })
      .composite([{ input: visibleCrop, left, top }]).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    frames.push({ ...entry, png, decoded, normalizedAudit: bboxFor(decoded.data, FRAME.width, FRAME.height, 0) });
  }
  return frames;
}

async function chooseScale(source, bounds) {
  const minHeight = Math.min(...source.frames.map((frame) => frame.audit.bbox.height));
  const maxHeight = Math.max(...source.frames.map((frame) => frame.audit.bbox.height));
  const maxWidth = Math.max(...source.frames.map((frame) => frame.audit.bbox.width));
  const lower = bounds.min / minHeight;
  const upper = Math.min((bounds.max + 0.95) / maxHeight, 22.95 / maxWidth, 0.999999);
  if (lower > upper) throw new Error(`no common sprite scale satisfies bounds ${JSON.stringify({ lower, upper, minHeight, maxHeight, maxWidth, bounds })}`);
  const ideal = Math.max(lower, Math.min(upper, bounds.target / maxHeight));
  const candidates = [ideal];
  for (let step = 1; step <= 100; step += 1) {
    candidates.push(Math.min(upper, ideal + step * 0.0005));
    candidates.push(Math.max(lower, ideal - step * 0.0005));
  }
  for (const scale of [...new Set(candidates)]) {
    const frames = await normalizedFrames(source, bounds, scale);
    if (frames && frames.every((frame) => {
      const box = frame.normalizedAudit.bbox;
      return box && box.height >= bounds.min && box.height <= bounds.max && box.width <= 22
        && box.y + box.height === FRAME.height && frame.normalizedAudit.partialAlphaPixels === 0;
    })) return { scale, frames };
  }
  throw new Error(`normalized alpha bounds could not satisfy contract ${JSON.stringify(bounds)}`);
}

async function prepareCharacter(spec) {
  const rawPath = path.join(RAW_ROOT, `${spec.stem}.png`);
  const cleanedPath = path.join(CLEANED_ROOT, `${spec.stem}.png`);
  const promptPath = path.join(PROMPT_ROOT, `${spec.stem}.txt`);
  const [raw, cleaned, prompt] = await Promise.all([readFile(rawPath), readFile(cleanedPath), readFile(promptPath)]);
  const rawMetadata = await sharp(raw).metadata();
  const cleanedMetadata = await sharp(cleaned).metadata();
  if (rawMetadata.width !== cleanedMetadata.width || rawMetadata.height !== cleanedMetadata.height) {
    throw new Error(`${spec.id}: chroma removal changed source dimensions`);
  }
  const source = await sourceFrames(cleaned);
  const bounds = HEIGHT[spec.heightClass];
  const { scale, frames } = await chooseScale(source, bounds);
  const byCell = new Map(frames.map((frame) => [`${frame.sourceColumn}:${frame.row}`, frame]));
  const unquantizedSheet = await sharp({ create: { width: SHEET.width, height: SHEET.height, channels: 4, background: '#00000000' } })
    .composite(NORMALIZED_COLUMN_SOURCES.flatMap((sourceColumn, normalizedColumn) => ROW_ORDER.map((_, row) => ({
      input: byCell.get(`${sourceColumn}:${row}`).png,
      left: normalizedColumn * FRAME.width,
      top: row * FRAME.height
    }))))
    .png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  const sheet = await sharp(unquantizedSheet).png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 96, dither: 0 }).toBuffer();
  const sheetMetadata = await sharp(sheet).metadata();
  if (sheetMetadata.width !== SHEET.width || sheetMetadata.height !== SHEET.height) throw new Error(`${spec.id}: invalid sheet dimensions`);
  const preparedPath = path.join(PREPARED_ROOT, `${spec.stem}.png`);
  await writeFile(preparedPath, sheet);

  const normalized = [];
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 4; column += 1) {
    const framePng = await sharp(sheet).extract({ left: column * FRAME.width, top: row * FRAME.height, width: FRAME.width, height: FRAME.height })
      .png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    const decoded = await sharp(framePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const audit = bboxFor(decoded.data, FRAME.width, FRAME.height, 0);
    normalized.push({ column, row, direction: NORMALIZED_COLUMN_ORDER[column], pose: ROW_ORDER[row], png: framePng, decoded, audit, hash: sha256(framePng) });
  }
  const byNormalizedCell = new Map(normalized.map((frame) => [`${frame.column}:${frame.row}`, frame]));
  const animationDifferences = NORMALIZED_COLUMN_ORDER.map((direction, column) => {
    const idle = byNormalizedCell.get(`${column}:0`).decoded.data;
    const walk1 = byNormalizedCell.get(`${column}:1`).decoded.data;
    const walk2 = byNormalizedCell.get(`${column}:2`).decoded.data;
    return { direction, idleVsWalk1: frameDifference(idle, walk1), idleVsWalk2: frameDifference(idle, walk2), walk1VsWalk2: frameDifference(walk1, walk2) };
  });
  const sheetAlpha = await auditTransparentPng(sheet);
  return {
    spec, raw, cleaned, prompt, rawPath, cleanedPath, promptPath, rawMetadata, cleanedMetadata,
    source, scale, bounds, frames: normalized, animationDifferences, sheet, preparedPath, sheetAlpha,
    frontIdle: byNormalizedCell.get('0:0')
  };
}

async function renderFrontIdleNative(entries) {
  const columns = 4;
  const cellWidth = 180;
  const cellHeight = 70;
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = (index % columns) * cellWidth + 8;
    const y = Math.floor(index / columns) * cellHeight + 8;
    composites.push({ input: entry.frontIdle.png, left: x, top: y });
    composites.push({ input: labelSvg(entry.spec.id, 140, 24, 9), left: x + 30, top: y + 8 });
    composites.push({ input: labelSvg(`${entry.frontIdle.audit.bbox.height}px · ${entry.spec.roleRead}`, 164, 24, 8), left: x, top: y + 42 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(entries.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-front-idle-native.png`));
}

async function renderBoardScalePreview(entries) {
  const scale = 8;
  const spriteWidth = FRAME.width * scale;
  const spriteHeight = FRAME.height * scale;
  const columns = 4;
  const cellWidth = 224;
  const cellHeight = 360;
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = (index % columns) * cellWidth + 16;
    const y = Math.floor(index / columns) * cellHeight + 16;
    const enlarged = await sharp(entry.frontIdle.png).resize({ width: spriteWidth, height: spriteHeight, kernel: sharp.kernel.nearest }).png().toBuffer();
    composites.push({ input: checkerSvg(spriteWidth, spriteHeight, 32), left: x, top: y });
    composites.push({ input: enlarged, left: x, top: y });
    composites.push({ input: labelSvg(entry.spec.id, spriteWidth, 24, 10), left: x, top: y + spriteHeight + 4 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(entries.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-board-scale-8x-preview.png`));
}

async function renderCheckerPages(entries) {
  const scale = 4;
  const sheetWidth = SHEET.width * scale;
  const sheetHeight = SHEET.height * scale;
  for (let page = 0; page < 2; page += 1) {
    const selected = entries.slice(page * 11, page * 11 + 11);
    const columns = 4;
    const cellWidth = 400;
    const cellHeight = 520;
    const composites = [];
    for (const [index, entry] of selected.entries()) {
      const x = (index % columns) * cellWidth + 8;
      const y = Math.floor(index / columns) * cellHeight + 8;
      const enlarged = await sharp(entry.sheet).resize({ width: sheetWidth, height: sheetHeight, kernel: sharp.kernel.nearest }).png().toBuffer();
      composites.push({ input: checkerSvg(sheetWidth, sheetHeight, 16), left: x, top: y });
      composites.push({ input: enlarged, left: x, top: y });
      composites.push({ input: labelSvg(`${entry.spec.id} · 4x · 12 frames`, sheetWidth, 28, 10), left: x, top: y + sheetHeight + 4 });
    }
    await sharp({ create: { width: columns * cellWidth, height: Math.ceil(selected.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
      .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-all-frames-checker-page-${page + 1}.png`));
  }
}

async function renderRoleComparison(entries) {
  const scale = 6;
  const spriteWidth = FRAME.width * scale;
  const spriteHeight = FRAME.height * scale;
  const columns = 6;
  const cellWidth = 180;
  const cellHeight = 294;
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = (index % columns) * cellWidth + 18;
    const y = Math.floor(index / columns) * cellHeight + 10;
    const enlarged = await sharp(entry.frontIdle.png).resize({ width: spriteWidth, height: spriteHeight, kernel: sharp.kernel.nearest }).png().toBuffer();
    composites.push({ input: enlarged, left: x, top: y });
    composites.push({ input: labelSvg(entry.spec.stem, 168, 22, 9), left: x - 6, top: y + spriteHeight + 4 });
    composites.push({ input: labelSvg(entry.spec.roleRead, 168, 22, 8), left: x - 6, top: y + spriteHeight + 26 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(entries.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-role-comparison.png`));
}

async function main() {
  if (CHARACTERS.length !== 22 || new Set(CHARACTERS.map((entry) => entry.id)).size !== 22) throw new Error('Wave 1C must define 22 unique required characters');
  await mkdir(PREPARED_ROOT, { recursive: true });
  await mkdir(REVIEW_ROOT, { recursive: true });
  const rawFiles = await filesBelow(RAW_ROOT);
  const cleanedFiles = await filesBelow(CLEANED_ROOT);
  const promptFiles = (await readdir(PROMPT_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
    .map((entry) => path.join(PROMPT_ROOT, entry.name)).sort();
  if (rawFiles.length !== 22 || cleanedFiles.length !== 22 || promptFiles.length !== 22) throw new Error('Wave 1C requires exactly 22 raw, cleaned, and tracked prompt files');

  const before = await readLocalGenerationManifest(FORGE_ROOT);
  if (before.results.length !== 36 || before.results.some((entry) => entry.category === 'character')
    || before.results.filter((entry) => entry.category === 'building').length !== 17
    || before.results.filter((entry) => entry.category === 'field').length !== 19
    || before.results.some((entry) => entry.status !== 'pending')) {
    throw new Error('Wave 1C requires exactly the existing 17 buildings and 19 fields in pending state');
  }
  if (await countFiles(path.join(FORGE_ROOT, 'generated', 'characters', 'pending')) !== 0) throw new Error('Wave 1C requires an empty character pending directory');
  const existingHashesBefore = {
    buildings: await treeHashes(path.join(FORGE_ROOT, 'generated', 'buildings', 'pending')),
    fields: await treeHashes(path.join(FORGE_ROOT, 'generated', 'fields', 'pending'))
  };

  const entries = [];
  for (const spec of CHARACTERS) {
    try {
      entries.push(await prepareCharacter(spec));
    } catch (error) {
      throw new Error(`${spec.id}: ${error.message}`, { cause: error });
    }
  }

  const outputHashes = new Set();
  for (const entry of entries) {
    const { job } = await buildJob({ assetId: entry.spec.id, provider: 'manual-import' });
    const productionRecipe = {
      waveId: WAVE_ID,
      assetId: entry.spec.id,
      method: 'imagegen',
      generator: 'codex-imagegen-built-in',
      scaleClass: 'tiny',
      generationPromptPath: path.relative(FORGE_ROOT, entry.promptPath).split(path.sep).join('/'),
      generationPromptSha256: sha256(entry.prompt),
      toolMode: 'built-in',
      inputReferences: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index], role: index === 0 ? 'global-style' : 'primary-subject' })),
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      transformSteps: ['full-frame', 'chroma-key-remove', 'cell-extract', 'shared-scale-normalize', 'nearest-downscale', 'hard-alpha', 'column-reorder', 'palette-quantize'],
      spriteContract: {
        frame: { width: FRAME.width, height: FRAME.height },
        sourceColumnOrderObserved: SOURCE_COLUMN_ORDER,
        normalizedColumnOrder: NORMALIZED_COLUMN_ORDER,
        normalizedColumnSources: NORMALIZED_COLUMN_SOURCES,
        rowOrder: ROW_ORDER,
        commonFootBaseline: true,
        visibleBboxHeight: { class: entry.spec.heightClass, ...entry.bounds },
        resizeKernel: 'nearest',
        allowEnlargement: false,
        partialAlphaPixels: 0
      },
      source: {
        path: path.relative(FORGE_ROOT, entry.rawPath).split(path.sep).join('/'),
        sha256: sha256(entry.raw), width: entry.rawMetadata.width, height: entry.rawMetadata.height, cropRect: null
      },
      backgroundRemoval: {
        method: 'official-chroma-key-helper', keyColor: null, autoKey: 'border', softMatte: true,
        transparentThreshold: 35, opaqueThreshold: 110, despill: true,
        cleanup: { alphaCutoff: FRAME.alphaCutoff, componentMinPixels: 64, targetMaxWidth: 22, targetMaxHeight: entry.bounds.max, resizeKernel: 'nearest' }
      },
      canvas: { width: SHEET.width, height: SHEET.height, baselineY: SHEET.height - 1 },
      subjectBbox: entry.sheetAlpha.subjectBbox
    };
    const imported = await importCandidate({ assetId: entry.spec.id, file: entry.preparedPath, productionRecipe }, {
      now: () => '2026-07-14T09:00:00.000Z'
    });
    entry.result = imported.result;
    entry.output = await readFile(path.join(FORGE_ROOT, imported.result.outputPath));
    outputHashes.add(imported.result.outputSha256);
  }

  const after = await readLocalGenerationManifest(FORGE_ROOT);
  const existingHashesAfter = {
    buildings: await treeHashes(path.join(FORGE_ROOT, 'generated', 'buildings', 'pending')),
    fields: await treeHashes(path.join(FORGE_ROOT, 'generated', 'fields', 'pending'))
  };
  const approvals = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'approvals.json')));
  const assets = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'assets.json')));
  let publicForgeAbsent = false;
  try { await access(path.resolve(FORGE_ROOT, '..', '..', 'public', 'assets', 'forge')); } catch (error) { publicForgeAbsent = error?.code === 'ENOENT'; }

  const frontIdle = [];
  for (const entry of entries) frontIdle.push({
    assetId: entry.spec.id,
    exactHash: entry.frontIdle.hash,
    perceptualHash: await perceptualHash(entry.frontIdle.png)
  });
  const perceptualPairs = [];
  for (let left = 0; left < frontIdle.length; left += 1) for (let right = left + 1; right < frontIdle.length; right += 1) {
    perceptualPairs.push({ left: frontIdle[left].assetId, right: frontIdle[right].assetId, hammingDistance: hamming(frontIdle[left].perceptualHash, frontIdle[right].perceptualHash) });
  }
  perceptualPairs.sort((left, right) => left.hammingDistance - right.hammingDistance || left.left.localeCompare(right.left));

  const callRecords = entries.map((entry) => ({
    assetId: entry.spec.id,
    evidenceClass: 'orchestration-session observation; not an independent provider attestation',
    sessionEvidence: {
      generatedImageSessionDirectory: '019f5db8-e80b-7b43-82d1-64b5d230f35c',
      batchId: CALL_EVIDENCE[entry.spec.stem][0],
      generatedOutputArtifactBasename: CALL_EVIDENCE[entry.spec.stem][1],
      observedProcedure: 'The orchestrator read the tracked prompt file immediately before the distinct built-in imagegen call and passed the returned string as that call prompt argument.'
    },
    promptPath: path.relative(FORGE_ROOT, entry.promptPath).split(path.sep).join('/'),
    trackedPromptSha256: sha256(entry.prompt),
    recipePromptSnapshotSha256: entry.result.productionRecipe.generationPromptSha256,
    recipePromptSnapshotHashConsistent: sha256(entry.prompt) === entry.result.productionRecipe.generationPromptSha256,
    toolMode: entry.result.productionRecipe.toolMode,
    inputReferences: entry.result.productionRecipe.inputReferences,
    rawSourcePath: entry.result.productionRecipe.source.path,
    rawSourceSha256: entry.result.productionRecipe.source.sha256,
    cleanedSourcePath: path.relative(FORGE_ROOT, entry.cleanedPath).split(path.sep).join('/'),
    cleanedSourceSha256: sha256(entry.cleaned),
    outputPath: entry.result.outputPath,
    outputSha256: entry.result.outputSha256
  }));
  const rejectedInputs = [];
  for (const record of REJECTED_INPUTS) rejectedInputs.push({
    ...record,
    rawSha256: sha256(await readFile(path.join(FORGE_ROOT, record.rawPath))),
    promptSha256: sha256(await readFile(path.join(FORGE_ROOT, record.promptPath)))
  });

  const frameAudits = entries.flatMap((entry) => entry.frames.map((frame) => ({
    assetId: entry.spec.id, heightClass: entry.spec.heightClass, direction: frame.direction, pose: frame.pose,
    bbox: frame.audit.bbox, visiblePixels: frame.audit.visiblePixels, visibleColorCount: frame.audit.visibleColorCount,
    partialAlphaPixels: frame.audit.partialAlphaPixels, exactHash: frame.hash
  })));
  const animationAudits = entries.flatMap((entry) => entry.animationDifferences.map((difference) => ({ assetId: entry.spec.id, ...difference })));
  const gates = {
    rawSources22: rawFiles.length === 22 && new Set(entries.map((entry) => sha256(entry.raw))).size === 22,
    cleanedSources22: cleanedFiles.length === 22,
    trackedPrompts22: promptFiles.length === 22 && new Set(entries.map((entry) => sha256(entry.prompt))).size === 22,
    sessionObservedTrackedPromptCallProcedure22: callRecords.length === 22 && callRecords.every((record) => record.sessionEvidence.batchId
      && record.sessionEvidence.generatedOutputArtifactBasename.startsWith('exec-')
      && record.evidenceClass.includes('not an independent provider attestation')),
    recipePromptSnapshotHashesConsistent22: callRecords.length === 22 && callRecords.every((record) => record.recipePromptSnapshotHashConsistent
      && record.toolMode === 'built-in' && record.inputReferences.length === 2
      && record.inputReferences[0].id === 'world_visual_master' && record.inputReferences[0].role === 'global-style'
      && record.inputReferences[1].id === 'character_visual_master' && record.inputReferences[1].role === 'primary-subject'),
    nativeSheets22At96x120: entries.length === 22 && entries.every((entry) => entry.result.outputInspection.width === 96 && entry.result.outputInspection.height === 120),
    frames264: frameAudits.length === 264,
    frameBboxesWithinClass: frameAudits.every((frame) => {
      const bounds = HEIGHT[frame.heightClass];
      return frame.bbox && frame.bbox.height >= bounds.min && frame.bbox.height <= bounds.max && frame.bbox.width <= 22;
    }),
    commonFootBaseline: frameAudits.every((frame) => frame.bbox.y + frame.bbox.height === FRAME.height),
    partialAlphaZero: frameAudits.every((frame) => frame.partialAlphaPixels === 0),
    visibleColorCountsRecorded: frameAudits.every((frame) => frame.visibleColorCount >= 2 && frame.visibleColorCount <= 96),
    allAnimationPairsPixelAndSilhouetteDistinct: animationAudits.every((entry) => [entry.idleVsWalk1, entry.idleVsWalk2, entry.walk1VsWalk2]
      .every((difference) => difference.changedPixels > 0 && difference.silhouetteChangedPixels > 0)),
    sourceColumnMappingRecorded: entries.every((entry) => sameObject(entry.result.productionRecipe.spriteContract.sourceColumnOrderObserved, SOURCE_COLUMN_ORDER)
      && sameObject(entry.result.productionRecipe.spriteContract.normalizedColumnSources, NORMALIZED_COLUMN_SOURCES)),
    frontIdleExactHashesUnique22: new Set(frontIdle.map((entry) => entry.exactHash)).size === 22,
    perceptualPairAuditComplete: perceptualPairs.length === 231,
    outputHashesUnique22: outputHashes.size === 22,
    rejectedInputsRecordedAndExcluded: rejectedInputs.length === 1 && rejectedInputs.every((rejected) => {
      const adopted = callRecords.find((record) => record.assetId === rejected.assetId);
      return adopted && adopted.rawSourceSha256 !== rejected.rawSha256 && adopted.trackedPromptSha256 !== rejected.promptSha256;
    }),
    existingBuildingsAndFieldsByteUnchanged: sameObject(existingHashesBefore, existingHashesAfter),
    ledgerExactly58Pending: after.results.length === 58 && after.results.every((entry) => entry.status === 'pending'),
    ledgerCategorySplit17_19_22: after.results.filter((entry) => entry.category === 'building').length === 17
      && after.results.filter((entry) => entry.category === 'field').length === 19
      && after.results.filter((entry) => entry.category === 'character').length === 22,
    productionApprovalsZero: approvals.approvals.length === 0,
    lifecycleZero: assets.assets.every((entry) => entry.status === 'missing' && entry.approvedPath == null),
    approvedCharacterFilesZero: await countFiles(path.join(FORGE_ROOT, 'generated', 'characters', 'approved')) === 0,
    publicForgeAbsent
  };
  if (Object.values(gates).some((value) => !value)) throw new Error(`Wave 1C gate failure: ${JSON.stringify(gates)}`);

  await renderFrontIdleNative(entries);
  await renderBoardScalePreview(entries);
  await renderCheckerPages(entries);
  await renderRoleComparison(entries);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-imagegen-call-audit.json`), `${JSON.stringify({ schemaVersion: 1, waveId: WAVE_ID, adoptedCallCount: 22, rejectedInputs, records: callRecords }, null, 2)}\n`);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-recipes.json`), `${JSON.stringify({ schemaVersion: 1, waveId: WAVE_ID, state: 'pending-inspection', recipes: entries.map((entry) => ({ outputPath: entry.result.outputPath, ...entry.result.productionRecipe })) }, null, 2)}\n`);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-native-sheets.json`), `${JSON.stringify({ schemaVersion: 1, waveId: WAVE_ID, sheets: entries.map((entry) => ({ assetId: entry.spec.id, outputPath: entry.result.outputPath, outputSha256: entry.result.outputSha256, width: 96, height: 120 })) }, null, 2)}\n`);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-audit.json`), `${JSON.stringify({
    schemaVersion: 1,
    waveId: WAVE_ID,
    state: 'pending-human-inspection',
    observed: [
      'Twenty-two distinct built-in imagegen calls produced twenty-two accepted raw 4x3 character source candidates.',
      'Lead visually reviewed the original twenty-two raw sources as distinct role silhouettes; the guildmaster was then regenerated once for a measurable scale-contract failure and its adopted retry remains pending Lead visual review.',
      'All generated sources placed side directions in front, back, right, left source order; recipes record the observed swap into front, back, left, right runtime order.',
      'All 264 normalized frames satisfy their adult, elder, or child native-height contract on a common per-character scale and foot baseline.',
      'Every direction has non-zero pixel and silhouette differences among idle, walk1, and walk2.'
    ],
    inferred: [
      'Native and enlarged role comparisons preserve the requested role-defining clothing and accessory silhouettes within the muted board palette.',
      'Exact front-idle uniqueness, perceptual-pair measurements, and Lead raw review together support that these are distinct authored roles rather than one sprite recolored twenty-two times.'
    ],
    unknown: [
      'final Lead approval of the normalized production candidates',
      'Lead visual confirmation of the adopted guildmaster retry source',
      'Lead visual confirmation that every normalized direction still reads correctly after column reordering',
      'runtime animation timing and in-game collision alignment',
      'final export and runtime integration'
    ],
    gates,
    contract: {
      frame: FRAME,
      normalizedColumns: NORMALIZED_COLUMN_ORDER,
      rows: ROW_ORDER,
      commonFootBaseline: true,
      nearestDownscaleOnly: true,
      allowEnlargement: false,
      partialAlphaPixels: 0,
      visibleBboxHeight: HEIGHT
    },
    roleReadability: entries.map((entry) => ({
      assetId: entry.spec.id,
      requestedRoleRead: entry.spec.roleRead,
      rawLeadVisualDecision: entry.spec.id === 'character.guildmaster' ? 'pending Lead review after technical retry' : 'accepted',
      normalizedVisualDecision: 'pending Lead review'
    })),
    rejectedInputs,
    frames: frameAudits,
    animations: animationAudits,
    frontIdle,
    nearestPerceptualPairs: perceptualPairs.slice(0, 32),
    existingTreeHashes: { before: existingHashesBefore, after: existingHashesAfter }
  }, null, 2)}\n`);
}

await main();
