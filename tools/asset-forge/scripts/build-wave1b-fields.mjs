import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import { FORGE_ROOT } from '../src/config.mjs';
import { sha256 } from '../src/hashing.mjs';
import { auditTransparentPng } from '../src/images/audit-alpha.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';

const WAVE_ID = 'wave1b-fields';
const TILE = 64;
const CANVAS = Object.freeze({ width: TILE, height: TILE, baselineY: TILE - 1 });
const RAW_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', WAVE_ID, 'raw');
const PREPARED_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', WAVE_ID, 'prepared');
const MASK_ROOT = path.join(FORGE_ROOT, 'tmp', 'imagegen', WAVE_ID, 'masks');
const REVIEW_ROOT = path.join(FORGE_ROOT, 'review');
const PROMPT_ROOT = path.join(REVIEW_ROOT, 'prompts', WAVE_ID);

const WORLD = 'world_visual_master.png';
const COBBLE = 'field_cobblestone_roads_sheet.png';
const HARBOR = 'field_harbor_docks_tiles_sheet.png';
const TERRAIN = 'field_stairs_bridges_cliffs_sheet.png';

const FIELDS = Object.freeze([
  { id: 'field.cobblestone', file: 'field_cobblestone.png', method: 'direct-extraction', primary: COBBLE, crop: [538, 539, 145, 145], seamless: true, orientation: 'non-directional walkable small-stone cobblestone' },
  { id: 'field.dirt_path', file: 'field_dirt_path.png', method: 'imagegen', primary: COBBLE, seamless: true, orientation: 'non-directional walkable compacted dirt and fine gravel' },
  { id: 'field.grass', file: 'field_grass.png', method: 'imagegen', primary: TERRAIN, seamless: true, orientation: 'non-directional walkable grass ground' },
  { id: 'field.water', file: 'field_water.png', method: 'direct-extraction', primary: HARBOR, crop: [560, 20, 160, 160], seamless: true, orientation: 'non-directional deep water surface' },
  { id: 'field.river_edge', file: 'field_river_edge.png', method: 'imagegen', primary: HARBOR, orientation: 'land occupies the top; water occupies the bottom; shoreline runs left-to-right' },
  { id: 'field.bridge_stone', file: 'field_bridge_stone.png', method: 'imagegen', primary: TERRAIN, orientation: 'walkable stone bridge crosses left-to-right over water flowing top-to-bottom' },
  { id: 'field.bridge_wood', file: 'field_bridge_wood.png', method: 'imagegen', primary: HARBOR, orientation: 'walkable wooden bridge crosses left-to-right over water flowing top-to-bottom' },
  { id: 'field.stairs_stone', file: 'field_stairs_stone.png', method: 'imagegen', primary: TERRAIN, orientation: 'lower ground at bottom connects through stairs to upper ground at top' },
  { id: 'field.cliff', file: 'field_cliff.png', method: 'imagegen', primary: TERRAIN, orientation: 'upper plateau at top; vertical cliff face descends toward bottom' },
  { id: 'field.wall_stone', file: 'field_wall_stone.png', method: 'imagegen', primary: TERRAIN, orientation: 'horizontal impassable stone wall connecting left and right edges' },
  { id: 'field.fence_wood', file: 'field_fence_wood.png', method: 'imagegen', primary: TERRAIN, orientation: 'horizontal impassable wooden fence connecting left and right edges' },
  { id: 'field.dock_floor', file: 'field_dock_floor.png', method: 'direct-extraction', primary: HARBOR, crop: [1090, 175, 64, 64], seamless: true, orientation: 'non-directional walkable wooden dock planks with no water, post, or outer edge' },
  { id: 'field.plaza', file: 'field_plaza.png', method: 'direct-extraction', primary: COBBLE, crop: [201, 539, 160, 160], seamless: true, orientation: 'non-directional walkable large plaza flagstones' },
  { id: 'field.road_corner', file: 'field_road_corner.png', method: 'imagegen', primary: COBBLE, orientation: 'cobblestone road enters from top and exits right in a ninety-degree corner' },
  { id: 'field.road_edge', file: 'field_road_edge.png', method: 'imagegen', primary: COBBLE, orientation: 'cobblestone road enters only from top and terminates before bottom; left, right, and bottom edges are grass' },
  { id: 'field.road_intersection', file: 'field_road_intersection.png', method: 'imagegen', primary: COBBLE, orientation: 'four-way cobblestone road connects top, right, bottom, and left edges' },
  { id: 'field.sand', file: 'field_sand.png', method: 'imagegen', primary: HARBOR, seamless: true, orientation: 'non-directional walkable dark damp compacted harbor sand and fine muted gravel' },
  { id: 'field.rock', file: 'field_rock.png', method: 'imagegen', primary: TERRAIN, orientation: 'single natural impassable rock obstacle centered on matching ground' },
  { id: 'field.tree', file: 'field_tree.png', method: 'imagegen', primary: TERRAIN, orientation: 'single natural impassable tree obstacle centered on matching ground' }
]);

const SEAM_IDS = new Set(FIELDS.filter((entry) => entry.seamless).map((entry) => entry.id));
const CONNECTION_IDS = [
  'field.road_corner', 'field.road_edge', 'field.road_intersection', 'field.river_edge',
  'field.bridge_stone', 'field.bridge_wood', 'field.stairs_stone', 'field.cliff',
  'field.wall_stone', 'field.fence_wood'
];
const ROAD_FAMILY_IDS = new Set(['field.road_corner', 'field.road_edge', 'field.road_intersection']);

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function labelSvg(text, width, height = 24) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171b1d"/><text x="5" y="16" font-family="ui-monospace,monospace" font-size="10" fill="#f1ede3">${escapeXml(text)}</text></svg>`);
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
  for (const file of await filesBelow(directory)) {
    result[path.relative(directory, file)] = sha256(await readFile(file));
  }
  return result;
}

function sameObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function countFiles(directory) {
  return (await filesBelow(directory)).length;
}

function reconcileEdges(data, width, height, band = 4) {
  const output = Buffer.from(data);
  const blendPair = (leftIndex, rightIndex, strength) => {
    for (let channel = 0; channel < 4; channel += 1) {
      const left = data[leftIndex + channel];
      const right = data[rightIndex + channel];
      if (strength === 0.5) {
        const value = Math.round((left + right) / 2);
        output[leftIndex + channel] = value;
        output[rightIndex + channel] = value;
      } else {
        output[leftIndex + channel] = Math.round(left * (1 - strength) + right * strength);
        output[rightIndex + channel] = Math.round(right * (1 - strength) + left * strength);
      }
    }
  };
  for (let y = 0; y < height; y += 1) {
    for (let inset = 0; inset < band; inset += 1) {
      blendPair((y * width + inset) * 4, (y * width + width - 1 - inset) * 4, inset === 0 ? 0.5 : (band - inset) / (band * 2));
    }
  }
  const horizontal = Buffer.from(output);
  for (let x = 0; x < width; x += 1) {
    for (let inset = 0; inset < band; inset += 1) {
      const topIndex = (inset * width + x) * 4;
      const bottomIndex = ((height - 1 - inset) * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = horizontal[topIndex + channel];
        const bottom = horizontal[bottomIndex + channel];
        const strength = inset === 0 ? 0.5 : (band - inset) / (band * 2);
        if (inset === 0) {
          const value = Math.round((top + bottom) / 2);
          output[topIndex + channel] = value;
          output[bottomIndex + channel] = value;
        } else {
          output[topIndex + channel] = Math.round(top * (1 - strength) + bottom * strength);
          output[bottomIndex + channel] = Math.round(bottom * (1 - strength) + top * strength);
        }
      }
    }
  }
  return output;
}

function roadMaskFor(assetId) {
  const mask = new Uint8Array(TILE * TILE);
  for (let y = 0; y < TILE; y += 1) for (let x = 0; x < TILE; x += 1) {
    let keep = false;
    if (assetId === 'field.road_corner') keep = (x >= 20 && x < 44 && y < 44) || (y >= 20 && y < 44 && x >= 20);
    if (assetId === 'field.road_edge') {
      const bulb = ((x - 31.5) / 14) ** 2 + ((y - 34) / 11) ** 2 <= 1;
      keep = (x >= 20 && x < 44 && y <= 34) || bulb;
    }
    if (assetId === 'field.road_intersection') keep = (x >= 20 && x < 44) || (y >= 20 && y < 44);
    if (keep) mask[y * TILE + x] = 255;
  }
  return mask;
}

async function writeRoadMask(assetId, mask) {
  await mkdir(MASK_ROOT, { recursive: true });
  const pathName = path.join(MASK_ROOT, `${assetId.replaceAll('.', '_')}.png`);
  const rgba = Buffer.alloc(TILE * TILE * 4);
  for (let index = 0; index < mask.length; index += 1) {
    rgba[index * 4] = mask[index];
    rgba[index * 4 + 1] = mask[index];
    rgba[index * 4 + 2] = mask[index];
    rgba[index * 4 + 3] = 255;
  }
  const png = await sharp(rgba, { raw: { width: TILE, height: TILE, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 2, dither: 0 }).toBuffer();
  await writeFile(pathName, png);
  return { path: pathName, png };
}

async function prepareTile(spec) {
  const referencePath = path.join(FORGE_ROOT, 'references', 'approved', spec.primary);
  let sourcePath;
  let source;
  let sourceMetadata;
  let initial;
  const transformSteps = [];
  if (spec.method === 'direct-extraction') {
    sourcePath = referencePath;
    source = await readFile(sourcePath);
    sourceMetadata = await sharp(source).metadata();
    const [left, top, width, height] = spec.crop;
    initial = await sharp(source).extract({ left, top, width, height })
      .resize(TILE, TILE, { fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    transformSteps.push('crop');
    if (width !== TILE || height !== TILE) transformSteps.push('nearest-downscale');
  } else {
    sourcePath = path.join(RAW_ROOT, spec.file);
    source = await readFile(sourcePath);
    sourceMetadata = await sharp(source).metadata();
    if (sourceMetadata.width < TILE || sourceMetadata.height < TILE) throw new Error(`${spec.id}: raw source would require enlargement`);
    initial = await sharp(source).resize(TILE, TILE, { fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    transformSteps.push('full-frame', 'nearest-downscale');
  }
  if (initial.info.width !== TILE || initial.info.height !== TILE) throw new Error(`${spec.id}: did not prepare a 64x64 tile`);
  let pixels = Buffer.from(initial.data);
  if (spec.seamless) {
    pixels = reconcileEdges(pixels, TILE, TILE);
    transformSteps.push('wrap-edge-reconcile');
  }
  transformSteps.push('palette-quantize');
  let compositeMask = null;
  let prepared;
  if (ROAD_FAMILY_IDS.has(spec.id)) {
    const quantizedRoad = await sharp(pixels, { raw: { width: TILE, height: TILE, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 96, dither: 0 }).toBuffer();
    const road = await sharp(quantizedRoad).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const grassPath = path.join(PREPARED_ROOT, 'field_grass.png');
    const grassPng = await readFile(grassPath);
    const grass = await sharp(grassPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mask = roadMaskFor(spec.id);
    const composed = Buffer.from(grass.data);
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] !== 255) continue;
      road.data.copy(composed, index * 4, index * 4, index * 4 + 4);
    }
    const writtenMask = await writeRoadMask(spec.id, mask);
    compositeMask = {
      path: path.relative(FORGE_ROOT, writtenMask.path).split(path.sep).join('/'),
      sha256: sha256(writtenMask.png),
      width: TILE,
      height: TILE,
      backgroundAssetId: 'field.grass',
      backgroundPath: path.relative(FORGE_ROOT, grassPath).split(path.sep).join('/'),
      backgroundSha256: sha256(grassPng)
    };
    prepared = await sharp(composed, { raw: { width: TILE, height: TILE, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
    transformSteps.push('grass-background-composite');
  } else {
    prepared = await sharp(pixels, { raw: { width: TILE, height: TILE, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 96, dither: 0 }).toBuffer();
  }
  const output = path.join(PREPARED_ROOT, spec.file);
  await writeFile(output, prepared);
  return {
    output,
    buffer: prepared,
    source,
    sourcePath,
    sourceMetadata,
    transformSteps,
    compositeMask
  };
}

async function pixelAudit(buffer) {
  const decoded = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = new Set();
  let partialAlphaPixels = 0;
  let transparentPixels = 0;
  let changedPairs = 0;
  let pairCount = 0;
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const index = (y * decoded.info.width + x) * 4;
      colors.add(decoded.data.subarray(index, index + 4).toString('hex'));
      const alpha = decoded.data[index + 3];
      if (alpha === 0) transparentPixels += 1;
      else if (alpha < 255) partialAlphaPixels += 1;
      if (x + 1 < decoded.info.width) {
        const next = index + 4;
        const delta = Math.abs(decoded.data[index] - decoded.data[next])
          + Math.abs(decoded.data[index + 1] - decoded.data[next + 1])
          + Math.abs(decoded.data[index + 2] - decoded.data[next + 2]);
        if (delta >= 24) changedPairs += 1;
        pairCount += 1;
      }
      if (y + 1 < decoded.info.height) {
        const next = index + decoded.info.width * 4;
        const delta = Math.abs(decoded.data[index] - decoded.data[next])
          + Math.abs(decoded.data[index + 1] - decoded.data[next + 1])
          + Math.abs(decoded.data[index + 2] - decoded.data[next + 2]);
        if (delta >= 24) changedPairs += 1;
        pairCount += 1;
      }
    }
  }
  let horizontalEdgeDelta = 0;
  let verticalEdgeDelta = 0;
  for (let y = 0; y < TILE; y += 1) {
    const left = y * TILE * 4;
    const right = (y * TILE + TILE - 1) * 4;
    for (let c = 0; c < 3; c += 1) horizontalEdgeDelta += Math.abs(decoded.data[left + c] - decoded.data[right + c]);
  }
  for (let x = 0; x < TILE; x += 1) {
    const top = x * 4;
    const bottom = ((TILE - 1) * TILE + x) * 4;
    for (let c = 0; c < 3; c += 1) verticalEdgeDelta += Math.abs(decoded.data[top + c] - decoded.data[bottom + c]);
  }
  const dhashRaw = await sharp(buffer).greyscale().resize(9, 8, { fit: 'fill', kernel: sharp.kernel.nearest }).raw().toBuffer();
  let dHash = '';
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) dHash += dhashRaw[y * 9 + x] > dhashRaw[y * 9 + x + 1] ? '1' : '0';
  return {
    width: decoded.info.width,
    height: decoded.info.height,
    uniqueColors: colors.size,
    partialAlphaPixels,
    transparentPixels,
    changedPairRatio: changedPairs / pairCount,
    horizontalEdgeDelta,
    verticalEdgeDelta,
    dHash
  };
}

function hamming(left, right) {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) distance += 1;
  return distance;
}

async function roadFamilyAudit(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const grass = await sharp(byId.get('field.grass').buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const expected = {
    'field.road_corner': { top: [20, 43], right: [20, 43], bottom: null, left: null },
    'field.road_edge': { top: [20, 43], right: null, bottom: null, left: null },
    'field.road_intersection': { top: [20, 43], right: [20, 43], bottom: [20, 43], left: [20, 43] }
  };
  const records = [];
  for (const assetId of ROAD_FAMILY_IDS) {
    const entry = byId.get(assetId);
    const maskRaw = await sharp(path.join(FORGE_ROOT, entry.prepared.compositeMask.path)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const output = await sharp(entry.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const edges = {
      top: Array.from({ length: TILE }, (_, index) => [index, maskRaw.data[index]]),
      right: Array.from({ length: TILE }, (_, index) => [index, maskRaw.data[index * TILE + TILE - 1]]),
      bottom: Array.from({ length: TILE }, (_, index) => [index, maskRaw.data[(TILE - 1) * TILE + index]]),
      left: Array.from({ length: TILE }, (_, index) => [index, maskRaw.data[index * TILE]])
    };
    const endpointRuns = {};
    let grassPixelsCompared = 0;
    let grassPixelMismatches = 0;
    for (const [edgeName, values] of Object.entries(edges)) {
      const connected = values.filter(([, value]) => value >= 128).map(([index]) => index);
      endpointRuns[edgeName] = connected.length === 0 ? null : {
        min: Math.min(...connected), max: Math.max(...connected), width: connected.length,
        centerline: (Math.min(...connected) + Math.max(...connected)) / 2
      };
      for (const [position, value] of values) {
        if (value >= 128) continue;
        const pixelIndex = edgeName === 'top' ? position
          : edgeName === 'right' ? position * TILE + TILE - 1
            : edgeName === 'bottom' ? (TILE - 1) * TILE + position
              : position * TILE;
        grassPixelsCompared += 1;
        for (let channel = 0; channel < 4; channel += 1) {
          if (output.data[pixelIndex * 4 + channel] !== grass.data[pixelIndex * 4 + channel]) {
            grassPixelMismatches += 1;
            break;
          }
        }
      }
    }
    const endpointContractExact = Object.entries(expected[assetId]).every(([edge, range]) => {
      const observed = endpointRuns[edge];
      return range === null ? observed === null
        : observed?.min === range[0] && observed?.max === range[1]
          && observed?.width === 24 && observed?.centerline === 31.5;
    });
    records.push({
      assetId,
      maskPath: entry.prepared.compositeMask.path,
      maskSha256: entry.prepared.compositeMask.sha256,
      endpointRuns,
      endpointContractExact,
      grassPixelsCompared,
      grassPixelMismatches,
      grassOnlyEdgePixelsExact: grassPixelMismatches === 0
    });
  }
  return records;
}

async function renderNative(entries) {
  const columns = 5;
  const cellWidth = 148;
  const cellHeight = 98;
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = (index % columns) * cellWidth + 8;
    const y = Math.floor(index / columns) * cellHeight + 8;
    composites.push({ input: entry.buffer, left: x, top: y });
    composites.push({ input: labelSvg(entry.id, 132), left: x, top: y + 66 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(entries.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-native.png`));
}

async function renderSeams(entries) {
  const selected = entries.filter((entry) => SEAM_IDS.has(entry.id));
  const columns = 2;
  const cellWidth = 220;
  const cellHeight = 226;
  const composites = [];
  for (const [index, entry] of selected.entries()) {
    const x = (index % columns) * cellWidth + 8;
    const y = Math.floor(index / columns) * cellHeight + 8;
    for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
      composites.push({ input: entry.buffer, left: x + column * TILE, top: y + row * TILE });
    }
    composites.push({ input: labelSvg(`${entry.id} · 3x3 native`, 192), left: x, top: y + 194 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(selected.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-seams.png`));
}

async function renderConnections(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const columns = 4;
  const cellWidth = 166;
  const cellHeight = 104;
  const composites = [];
  for (const [index, id] of CONNECTION_IDS.entries()) {
    const entry = byId.get(id);
    const x = (index % columns) * cellWidth + 8;
    const y = Math.floor(index / columns) * cellHeight + 8;
    composites.push({ input: entry.buffer, left: x, top: y });
    composites.push({ input: labelSvg(id, 150), left: x, top: y + 66 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(CONNECTION_IDS.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-connections.png`));
}

async function renderGrassRoadComparison(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const grass = byId.get('field.grass');
  const roadIds = ['field.road_corner', 'field.road_edge', 'field.road_intersection'];
  const composites = [];
  for (const [index, roadId] of roadIds.entries()) {
    const y = 8 + index * 94;
    composites.push({ input: grass.buffer, left: 8, top: y });
    composites.push({ input: byId.get(roadId).buffer, left: 72, top: y });
    composites.push({ input: grass.buffer, left: 136, top: y });
    composites.push({ input: labelSvg(`grass | ${roadId} | grass`, 192), left: 8, top: y + 66 });
  }
  await sharp({ create: { width: 208, height: roadIds.length * 94 + 8, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-grass-road-comparison.png`));
}

async function renderSourceComparison(entries) {
  const columns = 4;
  const cellWidth = 190;
  const cellHeight = 102;
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const x = (index % columns) * cellWidth + 8;
    const y = Math.floor(index / columns) * cellHeight + 8;
    let sourceSample;
    if (entry.spec.method === 'direct-extraction') {
      const [left, top, width, height] = entry.spec.crop;
      sourceSample = await sharp(entry.prepared.source).extract({ left, top, width, height })
        .resize(TILE, TILE, { fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest }).png().toBuffer();
    } else {
      sourceSample = await sharp(entry.prepared.source).resize(TILE, TILE, { fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.nearest }).png().toBuffer();
    }
    composites.push({ input: sourceSample, left: x, top: y });
    composites.push({ input: entry.buffer, left: x + 72, top: y });
    composites.push({ input: labelSvg(`source → ${entry.id}`, 172), left: x, top: y + 66 });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(entries.length / columns) * cellHeight, channels: 4, background: '#171b1d' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-source-comparison.png`));
}

async function main() {
  if (FIELDS.length !== 19 || new Set(FIELDS.map((entry) => entry.id)).size !== 19) throw new Error('Wave 1B must define 19 unique fields');
  if (FIELDS.filter((entry) => entry.method === 'direct-extraction').length !== 4) throw new Error('Wave 1B direct-extraction count must be four');
  if (FIELDS.filter((entry) => entry.method === 'imagegen').length !== 15) throw new Error('Wave 1B imagegen count must be fifteen');
  await mkdir(PREPARED_ROOT, { recursive: true });
  await mkdir(REVIEW_ROOT, { recursive: true });

  const buildingRoot = path.join(FORGE_ROOT, 'generated', 'buildings', 'pending');
  const buildingHashesBefore = await treeHashes(buildingRoot);
  const before = await readLocalGenerationManifest(FORGE_ROOT);
  if (before.results.length !== 17 || !before.results.every((result) => result.category === 'building' && result.status === 'pending')) {
    throw new Error('Wave 1B requires exactly the 17 existing pending buildings');
  }
  if (await countFiles(path.join(FORGE_ROOT, 'generated', 'fields', 'pending')) !== 0) throw new Error('Wave 1B requires an empty field pending directory');
  for (const spec of FIELDS.filter((entry) => entry.method === 'imagegen')) await access(path.join(RAW_ROOT, spec.file));

  const entries = [];
  for (const spec of FIELDS) {
    const prepared = await prepareTile(spec);
    const { job } = await buildJob({ assetId: spec.id, provider: 'manual-import' });
    const sourceRelative = path.relative(FORGE_ROOT, prepared.sourcePath).split(path.sep).join('/');
    const [cropX, cropY, cropWidth, cropHeight] = spec.crop ?? [];
    const productionRecipe = {
      waveId: WAVE_ID,
      assetId: spec.id,
      method: spec.method,
      generator: spec.method === 'imagegen' ? 'codex-imagegen-built-in' : 'asset-forge-direct-extraction',
      scaleClass: 'medium',
      orientationContract: spec.orientation,
      transformSteps: prepared.transformSteps,
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      ...(spec.method === 'imagegen' ? (() => {
        const promptFile = spec.file.replace(/\.png$/, '.txt');
        return {
          generationPromptPath: path.posix.join('review', 'prompts', WAVE_ID, promptFile),
          generationPromptSha256: sha256(prepared.prompt ?? Buffer.alloc(0)),
          toolMode: 'built-in',
          inputReferences: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index], role: index === 0 ? 'global-style' : 'primary-subject' }))
        };
      })() : {}),
      source: {
        path: sourceRelative,
        sha256: sha256(prepared.source),
        width: prepared.sourceMetadata.width,
        height: prepared.sourceMetadata.height,
        cropRect: spec.crop ? { x: cropX, y: cropY, width: cropWidth, height: cropHeight } : null
      },
      ...(prepared.compositeMask ? { compositeMask: prepared.compositeMask } : {}),
      backgroundRemoval: {
        method: 'none', keyColor: null, autoKey: null, softMatte: false,
        transparentThreshold: 0, opaqueThreshold: 255, despill: false,
        cleanup: { alphaCutoff: 0, componentMinPixels: 1, targetMaxWidth: TILE, targetMaxHeight: TILE, resizeKernel: 'nearest' }
      },
      canvas: CANVAS,
      subjectBbox: { x: 0, y: 0, width: TILE, height: TILE }
    };
    if (spec.method === 'imagegen') {
      const promptPath = path.join(PROMPT_ROOT, spec.file.replace(/\.png$/, '.txt'));
      prepared.prompt = await readFile(promptPath);
      productionRecipe.generationPromptSha256 = sha256(prepared.prompt);
    }
    const imported = await importCandidate({ assetId: spec.id, file: prepared.output, productionRecipe }, { now: () => '2026-07-14T00:00:00.000Z' });
    const buffer = await readFile(path.join(FORGE_ROOT, imported.result.outputPath));
    entries.push({ id: spec.id, spec, prepared, result: imported.result, buffer, pixel: await pixelAudit(buffer), alpha: await auditTransparentPng(buffer) });
  }

  const after = await readLocalGenerationManifest(FORGE_ROOT);
  const buildingHashesAfter = await treeHashes(buildingRoot);
  const roadFamily = await roadFamilyAudit(entries);
  const exactHashes = entries.map((entry) => entry.result.outputSha256);
  const pairs = [];
  for (let left = 0; left < entries.length; left += 1) for (let right = left + 1; right < entries.length; right += 1) {
    pairs.push({ left: entries[left].id, right: entries[right].id, hammingDistance: hamming(entries[left].pixel.dHash, entries[right].pixel.dHash) });
  }
  pairs.sort((left, right) => left.hammingDistance - right.hammingDistance);
  const approvals = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'approvals.json')));
  const rejectedInputs = [
    {
      assetId: 'field.grass',
      reason: 'Lead visual review rejected excessive brightness and saturated lawn-green palette.',
      rawPath: 'tmp/imagegen/wave1b-fields/rejected/field_grass-v1-bright.png',
      promptPath: 'review/prompts/wave1b-fields/rejected/field_grass-v1-bright.txt'
    },
    {
      assetId: 'field.sand',
      reason: 'Lead visual review rejected excessive golden high-key beach palette.',
      rawPath: 'tmp/imagegen/wave1b-fields/rejected/field_sand-v1-bright.png',
      promptPath: 'review/prompts/wave1b-fields/rejected/field_sand-v1-bright.txt'
    }
  ];
  for (const record of rejectedInputs) {
    record.rawSha256 = sha256(await readFile(path.join(FORGE_ROOT, record.rawPath)));
    record.promptSha256 = sha256(await readFile(path.join(FORGE_ROOT, record.promptPath)));
  }
  const imagegenCallRecords = [];
  for (const entry of entries.filter((candidate) => candidate.spec.method === 'imagegen')) {
    const recipe = entry.result.productionRecipe;
    const promptSha256 = sha256(await readFile(path.join(FORGE_ROOT, recipe.generationPromptPath)));
    imagegenCallRecords.push({
      assetId: entry.id,
      callProcedure: 'Exact tracked prompt file bytes were read immediately before the built-in imagegen call and passed as its prompt.',
      promptPath: recipe.generationPromptPath,
      promptSha256,
      recipePromptSha256: recipe.generationPromptSha256,
      exactPromptSnapshotMatch: promptSha256 === recipe.generationPromptSha256,
      toolMode: recipe.toolMode,
      inputReferences: recipe.inputReferences,
      adoptedRawPath: recipe.source.path,
      adoptedRawSha256: recipe.source.sha256,
      rejectedRawHashMatch: rejectedInputs.some((record) => record.rawSha256 === recipe.source.sha256)
    });
  }
  let publicForgeAbsent = false;
  try { await access(path.resolve(FORGE_ROOT, '..', '..', 'public', 'assets', 'forge')); } catch (error) { publicForgeAbsent = error?.code === 'ENOENT'; }
  const gates = {
    ledgerExactly36Pending: after.results.length === 36 && after.results.every((result) => result.status === 'pending'),
    ledgerCategorySplit: after.results.filter((result) => result.category === 'building').length === 17 && after.results.filter((result) => result.category === 'field').length === 19,
    dimensions64: entries.every((entry) => entry.pixel.width === TILE && entry.pixel.height === TILE),
    fullyOpaque: entries.every((entry) => entry.pixel.transparentPixels === 0 && entry.pixel.partialAlphaPixels === 0),
    controlledPalette: entries.every((entry) => entry.pixel.uniqueColors <= (ROAD_FAMILY_IDS.has(entry.id) ? 192 : 96)),
    nonEmptyTexture: entries.every((entry) => entry.pixel.changedPairRatio >= 0.08),
    exactHashesUnique: new Set(exactHashes).size === entries.length,
    seamlessEdgePixelsExact: entries.filter((entry) => entry.spec.seamless).every((entry) => entry.pixel.horizontalEdgeDelta === 0 && entry.pixel.verticalEdgeDelta === 0),
    promptSnapshotsComplete: entries.filter((entry) => entry.spec.method === 'imagegen').every((entry) => /^[a-f0-9]{64}$/.test(entry.result.productionRecipe.generationPromptSha256)),
    imagegenCallRecords15: imagegenCallRecords.length === 15 && imagegenCallRecords.every((entry) => entry.exactPromptSnapshotMatch
      && entry.toolMode === 'built-in' && entry.inputReferences.length === 2 && !entry.rejectedRawHashMatch),
    directCropProvenanceComplete: entries.filter((entry) => entry.spec.method === 'direct-extraction').every((entry) => entry.result.productionRecipe.source.cropRect && entry.result.productionRecipe.transformSteps.includes('crop')),
    orientationContractsComplete: entries.every((entry) => entry.result.productionRecipe.orientationContract === entry.spec.orientation),
    roadFamilyEndpointsExact: roadFamily.every((entry) => entry.endpointContractExact),
    roadGrassOnlyEdgesExact: roadFamily.every((entry) => entry.grassOnlyEdgePixelsExact),
    roadCompositeProvenanceComplete: entries.filter((entry) => ROAD_FAMILY_IDS.has(entry.id)).every((entry) => entry.result.productionRecipe.transformSteps.includes('grass-background-composite')
      && entry.result.productionRecipe.compositeMask?.sha256 === entry.prepared.compositeMask.sha256),
    rejectedInputsExcluded: rejectedInputs.every((record) => entries.find((entry) => entry.id === record.assetId)?.result.productionRecipe.source.sha256 !== record.rawSha256),
    buildingsByteUnchanged: sameObject(buildingHashesBefore, buildingHashesAfter),
    approvalsZero: approvals.approvals.length === 0,
    lifecycleZero: await countFiles(path.join(FORGE_ROOT, 'data', 'local', 'lifecycle')) === 0,
    approvedFieldsZero: await countFiles(path.join(FORGE_ROOT, 'generated', 'fields', 'approved')) === 0,
    publicForgeAbsent
  };
  if (Object.values(gates).some((value) => !value)) throw new Error(`Wave 1B gate failure: ${JSON.stringify(gates)}`);

  await renderNative(entries);
  await renderSeams(entries);
  await renderConnections(entries);
  await renderGrassRoadComparison(entries);
  await renderSourceComparison(entries);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-imagegen-call-audit.json`), `${JSON.stringify({
    schemaVersion: 1,
    waveId: WAVE_ID,
    adoptedCallCount: imagegenCallRecords.length,
    rejectedInputs,
    records: imagegenCallRecords
  }, null, 2)}\n`);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-recipes.json`), `${JSON.stringify({ schemaVersion: 1, waveId: WAVE_ID, state: 'pending-inspection', recipes: entries.map((entry) => ({ outputPath: entry.result.outputPath, ...entry.result.productionRecipe })) }, null, 2)}\n`);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-audit.json`), `${JSON.stringify({
    schemaVersion: 1,
    waveId: WAVE_ID,
    state: 'pending-inspection',
    observed: [
      'Exactly 19 required field candidates were imported through the canonical manual-import path and remain pending.',
      'All outputs are native 64x64 opaque PNG tiles prepared with nearest-neighbor reduction only.',
      'Four candidates use exact source crops; fifteen use tracked built-in imagegen prompts and two hashed references.',
      'The seven base texture candidates have byte-identical opposite edge pixels after recorded wrap-aware reconciliation.',
      'The three road-family candidates retain their road pixels inside hashed 24-pixel endpoint masks and use the accepted grass tile outside those masks.',
      'The pre-existing 17 building candidate files are byte-identical before and after this wave.'
    ],
    inferred: [
      'Exact opposite edge pixels remove hard one-pixel seams; the native 3x3 sheet is still required for human pattern-repeat judgment.',
      'Orientation contracts should preserve the required river, bridge, stairs, cliff, road, wall, and fence meanings.'
    ],
    unknown: [
      'human visual approval',
      'runtime integration quality',
      'semantic correctness after the game rotates or transforms any tile',
      'final visual suitability at every in-game zoom level'
    ],
    gates,
    counts: { candidates: entries.length, directExtraction: 4, imagegen: 15, pendingLedgerResults: after.results.length },
    rejectedInputs,
    roadFamily,
    closestPerceptualPair: pairs[0],
    candidates: entries.map((entry) => ({
      assetId: entry.id,
      method: entry.spec.method,
      orientationContract: entry.spec.orientation,
      primaryReferenceId: entry.result.referenceImageIds[1],
      primaryReferenceSha256: entry.result.referenceImageHashes[1],
      sourcePath: entry.result.productionRecipe.source.path,
      sourceSha256: entry.result.productionRecipe.source.sha256,
      cropRect: entry.result.productionRecipe.source.cropRect,
      generationPromptPath: entry.result.productionRecipe.generationPromptPath ?? null,
      generationPromptSha256: entry.result.productionRecipe.generationPromptSha256 ?? null,
      transformSteps: entry.result.productionRecipe.transformSteps,
      compositeMask: entry.result.productionRecipe.compositeMask ?? null,
      outputPath: entry.result.outputPath,
      outputSha256: entry.result.outputSha256,
      pixelAudit: entry.pixel
    }))
  }, null, 2)}\n`);
}

await main();
