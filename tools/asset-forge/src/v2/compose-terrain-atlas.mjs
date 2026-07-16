import sharp from 'sharp';
import { canonicalJson, sha256 } from '../hashing.mjs';

export const TERRAIN_COMPOSER_VERSION = 'terrain-composed-atlas-v1';
export const TERRAIN_COMPOSER_ALGORITHM = 'terrain-composed-atlas/shared-seam-blob16-v1';
export const TERRAIN_COMPOSER_UNIT_STEP = 'deterministic-terrain-compose-v1';

const TILE = 64;
const SHEET_COLUMNS = 5;
const SHEET_ROWS = 5;
const SEAM_BAND = 4;
const BASE_ROLES = Object.freeze(['base-0', 'base-1', 'base-2']);
const WATER_MOTION_ROLES = Object.freeze(['water-motion-0', 'water-motion-1', 'water-motion-2']);
const BASE_DERIVED_SHIFTS = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 17, y: 11 }),
  Object.freeze({ x: 31, y: 23 })
]);
const WATER_DERIVED_SHIFTS = Object.freeze([
  Object.freeze({ x: 7, y: 13 }),
  Object.freeze({ x: 19, y: 5 }),
  Object.freeze({ x: 29, y: 17 })
]);

const CONFIG = Object.freeze({
  schemaVersion: 1,
  composerVersion: TERRAIN_COMPOSER_VERSION,
  algorithm: TERRAIN_COMPOSER_ALGORITHM,
  tileSize: TILE,
  sheet: Object.freeze({ columns: SHEET_COLUMNS, rows: SHEET_ROWS }),
  seamBand: SEAM_BAND,
  resizeKernel: 'nearest',
  allowEnlargement: false,
  sourceAlpha: 'fully-opaque',
  outputAlpha: 'hard-alpha-zero-hidden-rgb',
  baseRoles: BASE_ROLES,
  baseDerivedShifts: BASE_DERIVED_SHIFTS,
  waterMotionRoles: WATER_MOTION_ROLES,
  waterDerivedShifts: WATER_DERIVED_SHIFTS,
  blobMaskBits: Object.freeze({ north: 1, east: 2, south: 4, west: 8 }),
  blobGeometry: Object.freeze({ centerRadius: 14, armHalfWidth: 10 })
});

function pixelOffset(x, y) {
  return (y * TILE + x) * 4;
}

function blobMask(mask) {
  const output = Buffer.alloc(TILE * TILE);
  if (mask === 0) return output;
  const center = (TILE - 1) / 2;
  const radius = CONFIG.blobGeometry.centerRadius;
  const halfWidth = CONFIG.blobGeometry.armHalfWidth;
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const centered = Math.abs(x - center) + Math.abs(y - center) <= radius * 1.45;
      const north = Boolean(mask & 1) && y <= center && Math.abs(x - center) <= halfWidth;
      const east = Boolean(mask & 2) && x >= center && Math.abs(y - center) <= halfWidth;
      const south = Boolean(mask & 4) && y >= center && Math.abs(x - center) <= halfWidth;
      const west = Boolean(mask & 8) && x <= center && Math.abs(y - center) <= halfWidth;
      if (centered || north || east || south || west) output[y * TILE + x] = 255;
    }
  }
  return output;
}

const MASK_BUFFERS = Object.freeze(Array.from({ length: 16 }, (_, mask) => blobMask(mask)));

export const TERRAIN_COMPOSER_CONFIG_SHA256 = sha256(canonicalJson(CONFIG));
export const TERRAIN_COMPOSER_MASK_SET_SHA256 = sha256(Buffer.concat(MASK_BUFFERS));

export function terrainCompositionPlanFor(asset) {
  if (asset?.id === 'terrain.cliff') {
    throw new Error('terrain-composed-atlas excludes terrain.cliff until directional face inputs are defined');
  }
  if (asset?.category !== 'terrain' || asset?.autotileContract?.tileSize !== TILE
    || asset?.outputSize?.width !== TILE * SHEET_COLUMNS
    || asset?.outputSize?.height !== TILE * SHEET_ROWS) {
    throw new Error('Terrain composition requires a canonical Wave A 5x5 terrain definition');
  }
  const water = asset.id === 'terrain.water';
  return {
    schemaVersion: 1,
    originKind: 'deterministic-derived',
    composerVersion: TERRAIN_COMPOSER_VERSION,
    algorithm: TERRAIN_COMPOSER_ALGORITHM,
    configSha256: TERRAIN_COMPOSER_CONFIG_SHA256,
    maskSetSha256: TERRAIN_COMPOSER_MASK_SET_SHA256,
    tileSize: TILE,
    seamBand: SEAM_BAND,
    baseInputs: { minimum: 1, maximum: 3, roles: [...BASE_ROLES] },
    waterMotionInputs: {
      minimum: 0,
      maximum: water ? 3 : 0,
      roles: water ? [...WATER_MOTION_ROLES] : []
    }
  };
}

function canonicalRoleOrder(asset) {
  return [
    ...BASE_ROLES,
    ...(asset.id === 'terrain.water' ? WATER_MOTION_ROLES : [])
  ];
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width && right.x < left.x + left.width
    && left.y < right.y + right.height && right.y < left.y + left.height;
}

function validateInputs(job, inputs) {
  if (job?.category !== 'terrain' || job.generationMode !== 'terrain-composed-atlas') {
    throw new Error('Terrain composer accepts only an explicit terrain-composed-atlas job');
  }
  if (canonicalJson(job.terrainCompositionPlan) !== canonicalJson(terrainCompositionPlanFor(job.assetDefinition))) {
    throw new Error('Terrain composer plan drifted from the current deterministic configuration');
  }
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 6) {
    throw new Error('Terrain composition requires 1..6 ordered provider-original input crops');
  }
  const roles = inputs.map(({ role }) => role);
  if (new Set(roles).size !== roles.length) throw new Error('Terrain composition input roles must be unique');
  const allowedOrder = canonicalRoleOrder(job.assetDefinition);
  if (roles.some((role) => !allowedOrder.includes(role))) {
    throw new Error('Terrain composition contains a role not allowed by this terrain definition');
  }
  const expectedOrder = allowedOrder.filter((role) => roles.includes(role));
  if (canonicalJson(roles) !== canonicalJson(expectedOrder)) {
    throw new Error('Terrain composition input roles are not in canonical order');
  }
  const baseRoles = roles.filter((role) => BASE_ROLES.includes(role));
  if (baseRoles.length < 1 || baseRoles.length > 3
    || canonicalJson(baseRoles) !== canonicalJson(BASE_ROLES.slice(0, baseRoles.length))) {
    throw new Error('Terrain composition requires contiguous base-0..base-2 inputs');
  }
  const waterRoles = roles.filter((role) => WATER_MOTION_ROLES.includes(role));
  if (job.assetId !== 'terrain.water' && waterRoles.length !== 0) {
    throw new Error('Water motion inputs are legal only for terrain.water');
  }
  if (canonicalJson(waterRoles) !== canonicalJson(WATER_MOTION_ROLES.slice(0, waterRoles.length))) {
    throw new Error('Terrain water motion inputs must be contiguous from water-motion-0');
  }
  const requestedByCanonical = new Map();
  const canonicalByHash = new Map();
  const byCanonical = new Map();
  for (const input of inputs) {
    const { source, cropRect } = input;
    if (!source?.image?.buffer || !source?.image?.metadata || !source?.sha256
      || !source?.canonicalPath || !input.requestedPath) {
      throw new Error(`Terrain composition ${input.role} lacks resolved provider-original evidence`);
    }
    if (!cropRect || ![cropRect.x, cropRect.y, cropRect.width, cropRect.height].every(Number.isInteger)
      || cropRect.x < 0 || cropRect.y < 0 || cropRect.width < TILE || cropRect.height < TILE
      || cropRect.width !== cropRect.height
      || cropRect.x + cropRect.width > source.image.metadata.width
      || cropRect.y + cropRect.height > source.image.metadata.height) {
      throw new Error(`Terrain composition ${input.role} crop must be a bounded square of at least ${TILE}px`);
    }
    const requested = requestedByCanonical.get(source.canonicalPath) ?? new Set();
    requested.add(input.requestedPath);
    requestedByCanonical.set(source.canonicalPath, requested);
    const canonicals = canonicalByHash.get(source.sha256) ?? new Set();
    canonicals.add(source.canonicalPath);
    canonicalByHash.set(source.sha256, canonicals);
    const records = byCanonical.get(source.canonicalPath) ?? [];
    records.push(input);
    byCanonical.set(source.canonicalPath, records);
  }
  if ([...requestedByCanonical.values()].some((paths) => paths.size !== 1)) {
    throw new Error('Terrain composition rejects multiple path aliases for one provider-original file');
  }
  if ([...canonicalByHash.values()].some((paths) => paths.size !== 1)) {
    throw new Error('Terrain composition rejects duplicate provider-original bytes under different files');
  }
  for (const records of byCanonical.values()) {
    for (let left = 0; left < records.length; left += 1) {
      for (let right = left + 1; right < records.length; right += 1) {
        if (rectanglesOverlap(records[left].cropRect, records[right].cropRect)) {
          throw new Error('Terrain composition provider-original cropRects must not overlap');
        }
      }
    }
  }
}

async function normalizedOpaqueCell(input) {
  const cropped = await sharp(input.source.image.buffer, { animated: false, failOn: 'error' })
    .extract({
      left: input.cropRect.x,
      top: input.cropRect.y,
      width: input.cropRect.width,
      height: input.cropRect.height
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (cropped.info.width !== input.cropRect.width
    || cropped.info.height !== input.cropRect.height
    || cropped.info.channels !== 4) {
    throw new Error(`Terrain composition ${input.role} did not decode the exact provider crop as RGBA`);
  }
  for (let offset = 0; offset < cropped.data.length; offset += 4) {
    if (cropped.data[offset + 3] !== 255) {
      throw new Error(`Terrain composition ${input.role} provider-original crop is not fully opaque`);
    }
    if (cropped.data[offset] === 255 && cropped.data[offset + 1] === 0
      && cropped.data[offset + 2] === 255) {
      throw new Error(`Terrain composition ${input.role} provider-original crop contains opaque #FF00FF`);
    }
  }
  const normalized = await sharp(cropped.data, {
    raw: {
      width: cropped.info.width,
      height: cropped.info.height,
      channels: cropped.info.channels
    }
  }).resize(TILE, TILE, {
    fit: 'fill',
    withoutEnlargement: true,
    kernel: sharp.kernel.nearest
  }).raw().toBuffer({ resolveWithObject: true });
  if (normalized.info.width !== TILE || normalized.info.height !== TILE
    || normalized.info.channels !== 4) {
    throw new Error(`Terrain composition ${input.role} did not normalize to exact 64x64 RGBA`);
  }
  return Buffer.from(normalized.data);
}

function reconcileOpposingEdges(data) {
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
  for (let y = 0; y < TILE; y += 1) {
    for (let inset = 0; inset < SEAM_BAND; inset += 1) {
      blend(pixelOffset(inset, y), pixelOffset(TILE - 1 - inset, y),
        inset === 0 ? 0.5 : (SEAM_BAND - inset) / (SEAM_BAND * 2), data);
    }
  }
  const horizontal = Buffer.from(output);
  for (let x = 0; x < TILE; x += 1) {
    for (let inset = 0; inset < SEAM_BAND; inset += 1) {
      blend(pixelOffset(x, inset), pixelOffset(x, TILE - 1 - inset),
        inset === 0 ? 0.5 : (SEAM_BAND - inset) / (SEAM_BAND * 2), horizontal);
    }
  }
  return output;
}

function toroidalShift(data, shift) {
  if (shift.x === 0 && shift.y === 0) return Buffer.from(data);
  const output = Buffer.alloc(data.length);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const sourceX = (x + shift.x) % TILE;
      const sourceY = (y + shift.y) % TILE;
      data.copy(output, pixelOffset(x, y), pixelOffset(sourceX, sourceY), pixelOffset(sourceX, sourceY) + 4);
    }
  }
  return output;
}

function applySharedSeamBand(data, canonical) {
  const output = Buffer.from(data);
  const blendPixel = (target, source, numerator) => {
    for (let channel = 0; channel < 4; channel += 1) {
      output[target + channel] = Math.round(
        (output[target + channel] * (SEAM_BAND - numerator) + canonical[source + channel] * numerator)
        / SEAM_BAND
      );
    }
  };
  for (let y = 0; y < TILE; y += 1) {
    for (let inset = 0; inset < SEAM_BAND; inset += 1) {
      const weight = SEAM_BAND - inset;
      blendPixel(pixelOffset(inset, y), pixelOffset(inset, y), weight);
      blendPixel(pixelOffset(TILE - 1 - inset, y), pixelOffset(TILE - 1 - inset, y), weight);
    }
  }
  for (let x = 0; x < TILE; x += 1) {
    for (let inset = 0; inset < SEAM_BAND; inset += 1) {
      const weight = SEAM_BAND - inset;
      blendPixel(pixelOffset(x, inset), pixelOffset(x, inset), weight);
      blendPixel(pixelOffset(x, TILE - 1 - inset), pixelOffset(x, TILE - 1 - inset), weight);
    }
  }
  for (let offset = 3; offset < output.length; offset += 4) output[offset] = 255;
  return output;
}

function applyMask(data, mask) {
  const output = Buffer.from(data);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    if (mask[pixel] === 0) output.fill(0, offset, offset + 4);
    else output[offset + 3] = 255;
  }
  return output;
}

function copyCell(target, rect, cell) {
  for (let y = 0; y < rect.height; y += 1) {
    const targetStart = ((rect.y + y) * TILE * SHEET_COLUMNS + rect.x) * 4;
    cell.copy(target, targetStart, y * rect.width * 4, (y + 1) * rect.width * 4);
  }
}

function sourceDescriptor(input, normalizedCell) {
  return {
    role: input.role,
    sha256: input.source.sha256,
    format: input.source.image.sourceFormat,
    width: input.source.image.metadata.width,
    height: input.source.image.metadata.height,
    cropRect: structuredClone(input.cropRect),
    normalizedCellSha256: sha256(normalizedCell)
  };
}

function derivation(unit, raw, {
  sourceInputs = [], operations, shift = { x: 0, y: 0 }, maskId = null
}) {
  return {
    unitId: unit.unitId,
    sourceRoles: sourceInputs.map(({ role }) => role),
    sourceSha256s: sourceInputs.map(({ source }) => source.sha256),
    operations,
    shift: structuredClone(shift),
    maskId,
    outputCellSha256: sha256(raw)
  };
}

export function terrainDerivationSha256(composition) {
  return sha256(canonicalJson({
    descriptor: composition.descriptor,
    inputDescriptors: composition.inputDescriptors,
    inputSetSha256: composition.inputSetSha256,
    unitDerivations: composition.unitDerivations,
    unitDerivationSetSha256: composition.unitDerivationSetSha256,
    atlasRawSha256: composition.atlasRawSha256
  }));
}

function selectMaterialInput(inputs, roles, index, shifts) {
  const available = roles.map((role) => inputs.find((input) => input.role === role)).filter(Boolean);
  if (index < available.length) return { input: available[index], shift: { x: 0, y: 0 } };
  return { input: available[index % available.length], shift: shifts[index] };
}

export async function composeTerrainAtlas(job, inputs) {
  validateInputs(job, inputs);
  const normalized = new Map();
  for (const input of inputs) normalized.set(input.role, await normalizedOpaqueCell(input));
  const baseInputs = BASE_ROLES.map((role) => inputs.find((input) => input.role === role)).filter(Boolean);
  const canonicalSeam = reconcileOpposingEdges(normalized.get('base-0'));
  const baseCells = [];
  const baseSources = [];
  const baseShifts = [];
  for (let index = 0; index < 3; index += 1) {
    const selected = selectMaterialInput(inputs, BASE_ROLES, index, BASE_DERIVED_SHIFTS);
    baseSources.push(selected.input);
    baseShifts.push(selected.shift);
    baseCells.push(applySharedSeamBand(
      toroidalShift(normalized.get(selected.input.role), selected.shift),
      canonicalSeam
    ));
  }

  const motionCells = [];
  const motionSources = [];
  const motionShifts = [];
  if (job.assetId === 'terrain.water') {
    const suppliedMotion = WATER_MOTION_ROLES
      .map((role) => inputs.find((input) => input.role === role))
      .filter(Boolean);
    for (let index = 0; index < 3; index += 1) {
      const direct = suppliedMotion[index] ?? null;
      const fallback = baseInputs[index % baseInputs.length];
      const selected = direct ?? fallback;
      const shift = direct ? { x: 0, y: 0 } : WATER_DERIVED_SHIFTS[index];
      motionSources.push(selected);
      motionShifts.push(shift);
      motionCells.push(applySharedSeamBand(
        toroidalShift(normalized.get(selected.role), shift),
        canonicalSeam
      ));
    }
  }

  const rawByIndex = new Map();
  const derivationByIndex = new Map();
  for (let index = 0; index < 3; index += 1) {
    rawByIndex.set(index, baseCells[index]);
    derivationByIndex.set(index, {
      sourceInputs: [baseSources[index]],
      operations: [
        'crop', 'nearest-downscale', 'toroidal-shift', 'shared-seam-band',
        'hard-alpha-zero-hidden-rgb'
      ],
      shift: baseShifts[index],
      maskId: null
    });
  }
  rawByIndex.set(3, Buffer.alloc(TILE * TILE * 4));
  derivationByIndex.set(3, {
    sourceInputs: [], operations: ['semantic-zero-rgba'], shift: { x: 0, y: 0 }, maskId: 'blob-0'
  });
  for (let mask = 1; mask < 16; mask += 1) {
    const index = mask + 3;
    rawByIndex.set(index, applyMask(baseCells[0], blobMask(mask)));
    derivationByIndex.set(index, {
      sourceInputs: [baseSources[0]],
      operations: [
        'crop', 'nearest-downscale', 'shared-seam-band', 'canonical-blob-mask',
        'hard-alpha-zero-hidden-rgb'
      ],
      shift: baseShifts[0],
      maskId: `blob-${mask}`
    });
  }
  for (let index = 19; index <= 24; index += 1) {
    if (job.assetId === 'terrain.water' && index <= 21) {
      const motionIndex = index - 19;
      rawByIndex.set(index, motionCells[motionIndex]);
      derivationByIndex.set(index, {
        sourceInputs: [motionSources[motionIndex]],
        operations: [
          'crop', 'nearest-downscale', 'toroidal-shift', 'shared-seam-band',
          'hard-alpha-zero-hidden-rgb'
        ],
        shift: motionShifts[motionIndex],
        maskId: null
      });
    } else {
      rawByIndex.set(index, Buffer.alloc(TILE * TILE * 4));
      derivationByIndex.set(index, {
        sourceInputs: [], operations: ['reserved-zero-rgba'], shift: { x: 0, y: 0 }, maskId: null
      });
    }
  }

  const unitRecords = [];
  const atlasRaw = Buffer.alloc(TILE * SHEET_COLUMNS * TILE * SHEET_ROWS * 4);
  for (const unit of job.generationUnits) {
    const index = Number(unit.frameId.slice('tile_'.length));
    const raw = rawByIndex.get(index);
    if (!raw) throw new Error(`Terrain composer did not produce ${unit.frameId}`);
    copyCell(atlasRaw, unit.targetRect, raw);
    unitRecords.push({
      unit,
      raw,
      derivation: derivation(unit, raw, derivationByIndex.get(index))
    });
  }
  const nonemptyHashes = unitRecords.filter(({ unit }) => unit.sourceRequired).map(({ raw }) => sha256(raw));
  if (new Set(nonemptyHashes).size !== nonemptyHashes.length) {
    throw new Error('Terrain composer produced byte-identical expected-nonempty cells');
  }
  const inputDescriptors = inputs.map((input) => sourceDescriptor(input, normalized.get(input.role)));
  const unitDerivations = unitRecords.map(({ derivation: record }) => record);
  const composition = {
    descriptor: {
      originKind: 'deterministic-derived',
      composerVersion: TERRAIN_COMPOSER_VERSION,
      algorithm: TERRAIN_COMPOSER_ALGORITHM,
      configSha256: TERRAIN_COMPOSER_CONFIG_SHA256,
      maskSetSha256: TERRAIN_COMPOSER_MASK_SET_SHA256,
      seamBand: SEAM_BAND
    },
    inputs,
    inputDescriptors,
    inputSetSha256: sha256(canonicalJson(inputDescriptors)),
    unitRecords,
    unitDerivations,
    unitDerivationSetSha256: sha256(canonicalJson(unitDerivations)),
    atlasRaw,
    atlasRawSha256: sha256(atlasRaw)
  };
  return {
    ...composition,
    derivationSha256: terrainDerivationSha256(composition)
  };
}
