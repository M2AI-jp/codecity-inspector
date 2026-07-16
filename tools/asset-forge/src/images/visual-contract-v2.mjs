import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { IMAGE_LIMITS } from '../config.mjs';
import { auditTransparentPng } from './audit-alpha.mjs';

export const CHARACTER_DIRECTIONS_V2 = Object.freeze(['front', 'back', 'left', 'right']);
export const CHARACTER_FRAMES_V2 = Object.freeze([
  'idle_1', 'idle_2', 'walk_1', 'walk_2', 'walk_3', 'walk_4',
  'talk_1', 'talk_2', 'work_1', 'work_2'
]);

export const BUILDING_SCALE_CONTRACTS_V2 = Object.freeze({
  S: Object.freeze({ width: 128, height: 224, widthTiles: 2, heightTiles: 2 }),
  M: Object.freeze({ width: 192, height: 288, widthTiles: 3, heightTiles: 3 }),
  L: Object.freeze({ width: 256, height: 352, widthTiles: 4, heightTiles: 4 }),
  XL: Object.freeze({ width: 320, height: 384, widthTiles: 5, heightTiles: 4 }),
  tower: Object.freeze({ width: 128, height: 352, widthTiles: 2, heightTiles: 2 }),
  rowhouse_s: Object.freeze({ width: 384, height: 288, widthTiles: 6, heightTiles: 3 }),
  rowhouse_l: Object.freeze({ width: 512, height: 352, widthTiles: 8, heightTiles: 4 })
});

const CATEGORY_SCALE_CLASSES_V2 = Object.freeze({
  character: Object.freeze(['character']),
  building: Object.freeze(Object.keys(BUILDING_SCALE_CONTRACTS_V2)),
  terrain: Object.freeze(['terrain']),
  overlay: Object.freeze(['overlay_s', 'overlay_m', 'overlay_l', 'overlay_xl']),
  structure: Object.freeze(['structure']),
  interior: Object.freeze(['interior']),
  prop: Object.freeze(['prop32', 'prop64', 'prop_tall']),
  effect: Object.freeze(['effect32', 'effect64']),
  ui: Object.freeze(['ui'])
});

export function spriteSheetV2Problems(specification) {
  if (specification?.visualContractVersion !== 2) return [];
  const problems = [];
  const frames = specification.frames ?? [];
  const ids = frames.map((frame) => frame.id);
  const positions = frames.map((frame) => `${frame.x}:${frame.y}`);
  if (!unique(ids) || !unique(positions)) problems.push('v2 sprite sheet frame ids and positions must be unique');
  if (specification.layout === 'character-4x10') {
    if (specification.frameWidth !== 48 || specification.frameHeight !== 96
      || specification.columns !== 10 || specification.rows !== 4 || frames.length !== 40) {
      problems.push('v2 character sprite sheet must be 10x4 cells at 48x96');
    }
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 10; column += 1) {
        const position = row * 10 + column;
        const frame = frames[position];
        const direction = CHARACTER_DIRECTIONS_V2[row];
        const animation = CHARACTER_FRAMES_V2[column];
        if (!frame || frame.id !== `${direction}.${animation}`
          || frame.x !== column * 48 || frame.y !== row * 96
          || frame.width !== 48 || frame.height !== 96
          || frame.direction !== direction || frame.animation !== animation || frame.index !== column) {
          problems.push(`v2 character sprite frame ${row}:${column} does not match canonical row/column coverage`);
        }
      }
    }
  } else if (specification.layout === 'terrain-blob16') {
    if (specification.frameWidth !== 64 || specification.frameHeight !== 64
      || specification.columns !== 5 || specification.rows !== 5 || frames.length !== 25) {
      problems.push('v2 terrain sprite sheet must be 5x5 cells at 64x64');
    }
    for (let index = 0; index < 25; index += 1) {
      const frame = frames[index];
      const column = index % 5;
      const row = Math.floor(index / 5);
      if (!frame || frame.id !== `tile_${index}`
        || frame.x !== column * 64 || frame.y !== row * 64
        || frame.width !== 64 || frame.height !== 64 || frame.index !== index) {
        problems.push(`v2 terrain sprite frame ${index} does not match canonical cell coverage`);
      }
    }
  } else {
    problems.push('v2 sprite sheet layout is unknown');
  }
  return [...new Set(problems)];
}

function equalValues(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameSize(left, right) {
  return left?.width === right?.width && left?.height === right?.height;
}

function samePoint(left, right) {
  return left?.x === right?.x && left?.y === right?.y;
}

function sameRect(left, right) {
  return left?.x === right?.x && left?.y === right?.y
    && left?.width === right?.width && left?.height === right?.height;
}

function sorted(values) {
  return [...values].sort((left, right) => left - right);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function rectWithin(rect, width, height) {
  return Number.isInteger(rect?.x) && Number.isInteger(rect?.y)
    && Number.isInteger(rect?.width) && Number.isInteger(rect?.height)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= width && rect.y + rect.height <= height;
}

function effectivePlacementSize(definition) {
  if (definition.category === 'character') return definition.characterSpriteContract?.frame;
  if (definition.category === 'terrain' || definition.category === 'interior') {
    const tileSize = definition.autotileContract?.tileSize;
    return Number.isInteger(tileSize) ? { width: tileSize, height: tileSize } : null;
  }
  return definition.outputSize;
}

function expectedRasterSize(definition) {
  const frame = definition.pixelArt?.logicalSpriteSize;
  const grid = definition.sprites?.grid;
  if (frame && grid) return { width: frame.width * grid.columns, height: frame.height * grid.rows };
  if (frame) return frame;
  if (definition.pixelArt?.tileSize && grid) {
    return {
      width: definition.pixelArt.tileSize * grid.columns,
      height: definition.pixelArt.tileSize * grid.rows
    };
  }
  if (definition.pixelArt?.tileSize) {
    return { width: definition.pixelArt.tileSize, height: definition.pixelArt.tileSize };
  }
  return null;
}

export function visualContractV2Problems(definition) {
  if (definition?.visualContractVersion !== 2) return [];
  const problems = [];
  const categoryScaleClasses = CATEGORY_SCALE_CLASSES_V2[definition.category];
  if (!categoryScaleClasses?.includes(definition.scaleClass)) {
    problems.push('scaleClass is not valid for the v2 asset category');
  }
  const outputSize = definition.outputSize;
  if (definition.output?.preferredFormat !== 'png'
    || definition.output?.background !== 'transparent'
    || definition.output?.needsTransparency !== true
    || definition.output?.needsTrim !== false) {
    problems.push('v2 runtime artifact must be an untrimmed transparent PNG');
  }
  const placementSize = effectivePlacementSize(definition);
  const rasterSize = expectedRasterSize(definition);
  if (!sameSize(outputSize, rasterSize)) problems.push('outputSize does not match the declared raster/grid dimensions');
  if (!placementSize) problems.push('placement coordinate extent could not be determined');
  if (placementSize && (definition.pivot?.x < 0 || definition.pivot?.x > placementSize.width
    || definition.pivot?.y < 0 || definition.pivot?.y > placementSize.height)) {
    problems.push('pivot is outside the rendered asset extent');
  }
  if (placementSize && (definition.baseline?.edgeY < 0 || definition.baseline?.edgeY > placementSize.height)) {
    problems.push('baseline edge is outside the rendered asset extent');
  }
  if (definition.pivot?.y !== definition.baseline?.edgeY) problems.push('pivot and baseline must share the same bottom edge');
  for (const polygon of definition.collision?.polygons ?? []) {
    for (const point of polygon.points ?? []) {
      if (point.x < 0 || point.y < 0 || point.x > definition.footprint.widthTiles
        || point.y > definition.footprint.heightTiles) {
        problems.push('collision polygon escapes the footprint');
        break;
      }
    }
  }
  for (const region of definition.occlusion?.regions ?? []) {
    if (!rectWithin(region, outputSize?.width, outputSize?.height)) {
      problems.push('occlusion region escapes outputSize');
      break;
    }
  }
  const windowIds = (definition.windowAnchors ?? []).map((entry) => entry.id);
  const roomIndices = (definition.windowAnchors ?? []).map((entry) => entry.roomIndex);
  if (!unique(windowIds) || !unique(roomIndices)) problems.push('window anchors must have unique ids and room indices');
  if ((definition.windowAnchors ?? []).some((entry) => entry.x < 0 || entry.x > outputSize.width
    || entry.y < 0 || entry.y > outputSize.height)) {
    problems.push('window anchor escapes outputSize');
  }
  const alphaGate = definition.inspectionGates?.alphaBbox;
  if (alphaGate?.policy === 'exact' && !alphaGate.expected) problems.push('exact alpha bbox policy requires an expected rect');
  if (alphaGate?.policy !== 'exact' && alphaGate?.expected) problems.push('non-empty alpha bbox policy must not claim an exact rect');
  const seamGate = definition.inspectionGates?.exactSeams;
  if (seamGate?.required !== Boolean(seamGate?.tileIndices?.length)) {
    problems.push('exact seam required flag must match whether tile indices are declared');
  }
  if (definition.pixelArt?.nearestNeighbor !== true || definition.pixelArt?.allowAntiAlias !== false
    || definition.inspectionGates?.resize?.kernel !== 'nearest'
    || definition.inspectionGates?.resize?.allowEnlargement !== false) {
    problems.push('v2 raster and resize contract must be nearest-only with no enlargement');
  }

  if (definition.category === 'building') {
    const expected = BUILDING_SCALE_CONTRACTS_V2[definition.scaleClass];
    if (!expected) problems.push('building scaleClass is not part of the v2 building table');
    if (expected && (!sameSize(outputSize, expected)
      || definition.footprint?.widthTiles !== expected.widthTiles
      || definition.footprint?.heightTiles !== expected.heightTiles)) {
      problems.push('building outputSize/footprint does not match scaleClass');
    }
    const edgeLength = ['north', 'south'].includes(definition.entrance?.edge)
      ? definition.footprint?.widthTiles : definition.footprint?.heightTiles;
    if (!Number.isInteger(edgeLength) || definition.entrance?.offsetTiles + 1 > edgeLength) {
      problems.push('building entrance does not fit its declared footprint edge');
    }
    if ((definition.collision?.polygons ?? []).length === 0) problems.push('building collision must contain at least one footprint polygon');
    const artifacts = definition.buildingLayerContract?.artifacts ?? [];
    if (artifacts.length !== 2 || artifacts[0]?.role !== 'base' || artifacts[1]?.role !== 'roof') {
      problems.push('building layer contract must contain ordered base and roof artifacts');
    }
    for (const artifact of artifacts) {
      if (!sameSize(artifact.outputSize, outputSize) || !samePoint(artifact.anchor, definition.pivot)) {
        problems.push('building base/roof must share outputSize and pivot anchor');
        break;
      }
    }
    if (definition.roofMask?.artifact !== 'roof') problems.push('building roofMask must derive from the roof artifact');
  } else if (definition.roofMask !== null) {
    problems.push('only v2 buildings may declare a roofMask');
  }

  if (definition.category === 'character') {
    const contract = definition.characterSpriteContract;
    const grid = definition.sprites?.grid;
    if (!sameSize(contract?.frame, { width: 48, height: 96 })
      || !sameSize(contract?.sheet, { width: 480, height: 384 })
      || contract?.sheet?.columns !== 10 || contract?.sheet?.rows !== 4
      || grid?.columns !== 10 || grid?.rows !== 4 || grid?.frameWidth !== 48 || grid?.frameHeight !== 96
      || !equalValues(definition.sprites?.directions, CHARACTER_DIRECTIONS_V2)
      || !equalValues(definition.sprites?.frames, CHARACTER_FRAMES_V2)
      || !equalValues(contract?.directionRows, CHARACTER_DIRECTIONS_V2)
      || !equalValues(contract?.frameColumns, CHARACTER_FRAMES_V2)) {
      problems.push('character grid must be 10 frame columns by 4 direction rows at 48x96');
    }
    if (contract?.visibleBboxHeight?.min > contract?.visibleBboxHeight?.max
      || contract?.visibleBboxHeight?.max > contract?.body?.height) {
      problems.push('character visible bbox height range is invalid');
    }
    if (!samePoint(definition.pivot, { x: 24, y: 96 }) || definition.baseline?.edgeY !== 96) {
      problems.push('character pivot/baseline must use the 48x96 frame bottom edge');
    }
  }

  if (definition.category === 'terrain' || definition.category === 'interior') {
    const contract = definition.autotileContract;
    const base = contract?.baseVariantIndices ?? [];
    const blob = (contract?.blob16 ?? []).map((entry) => entry.tileIndex);
    const masks = (contract?.blob16 ?? []).map((entry) => entry.mask);
    const auxiliary = contract?.auxiliaryTileIndices ?? [];
    const auxiliaryRoles = contract?.auxiliaryRoles ?? [];
    const animation = contract?.animationFrameIndices ?? [];
    const all = [...base, ...blob, ...auxiliary];
    if (!unique(all) || !equalValues(sorted(all), Array.from({ length: 25 }, (_, index) => index))) {
      problems.push('terrain base/blob/auxiliary indices must partition all 25 cells exactly once');
    }
    if (!unique(masks) || !equalValues(sorted(masks), Array.from({ length: 16 }, (_, index) => index))) {
      problems.push('terrain blob16 masks must cover 0..15 exactly once');
    }
    if (!unique(animation) || animation.some((index) => !auxiliary.includes(index))) {
      problems.push('terrain animation frames must be a unique subset of auxiliary cells');
    }
    if (auxiliaryRoles.length !== auxiliary.length) {
      problems.push('terrain auxiliary roles must cover every auxiliary cell');
    }
    const isWater = definition.id === 'terrain.water';
    const isCliff = definition.id === 'terrain.cliff';
    if ((isWater && animation.length !== 3) || (!isWater && animation.length !== 0)) {
      problems.push('only terrain.water may use exactly three auxiliary cells for its second base frame');
    }
    const expectedRoles = isWater
      ? [
          'animation-base-0', 'animation-base-1', 'animation-base-2',
          'transparent-reserved-0', 'transparent-reserved-1', 'transparent-reserved-2'
        ]
      : isCliff ? [
          'cliff-face-north', 'cliff-face-east', 'cliff-face-south',
          'cliff-face-west', 'cliff-inner-corner', 'cliff-outer-corner'
        ]
        : Array.from({ length: 6 }, (_, index) => `transparent-reserved-${index}`);
    if (!equalValues(auxiliaryRoles, expectedRoles)) {
      problems.push('terrain auxiliary roles do not match water/cliff/reserved semantics');
    }
    const requiredSeams = sorted([...base, ...animation]);
    if (!equalValues(sorted(seamGate?.tileIndices ?? []), requiredSeams)) {
      problems.push('terrain exact seam set must cover every base and animation tile');
    }
    if (definition.sprites?.grid?.columns !== 5 || definition.sprites?.grid?.rows !== 5
      || definition.sprites?.grid?.frameWidth !== 64 || definition.sprites?.grid?.frameHeight !== 64) {
      problems.push('terrain grid must be 5x5 at 64x64');
    }
  }
  return [...new Set(problems)];
}

async function decodeRgba(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Visual contract audit input must be a Buffer');
  return sharp(buffer, {
    animated: false,
    failOn: 'error',
    limitInputPixels: IMAGE_LIMITS.maxInputPixels,
    sequentialRead: true
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function pixelOffset(width, channels, x, y) {
  return (y * width + x) * channels;
}

function cellBuffer(decoded, tileIndex, columns, cellWidth, cellHeight = cellWidth) {
  const column = tileIndex % columns;
  const row = Math.floor(tileIndex / columns);
  const output = Buffer.allocUnsafe(cellWidth * cellHeight * decoded.info.channels);
  for (let y = 0; y < cellHeight; y += 1) {
    const sourceStart = pixelOffset(
      decoded.info.width,
      decoded.info.channels,
      column * cellWidth,
      row * cellHeight + y
    );
    const destinationStart = y * cellWidth * decoded.info.channels;
    decoded.data.copy(
      output,
      destinationStart,
      sourceStart,
      sourceStart + cellWidth * decoded.info.channels
    );
  }
  return output;
}

function alphaBounds(raw, width, height, channels) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (raw[pixelOffset(width, channels, x, y) + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visiblePixels += 1;
    }
  }
  return {
    visiblePixels,
    subjectBbox: visiblePixels === 0 ? null : {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    }
  };
}

function cellSha256(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function hiddenRgbPixelCount(decoded) {
  let count = 0;
  for (let offset = 0; offset < decoded.data.length; offset += decoded.info.channels) {
    if (decoded.data[offset + 3] === 0
      && (decoded.data[offset] !== 0 || decoded.data[offset + 1] !== 0 || decoded.data[offset + 2] !== 0)) {
      count += 1;
    }
  }
  return count;
}

function cellRole(definition, index) {
  const grid = definition.sprites?.grid;
  if (!grid) return 'primary';
  if (definition.category === 'character') {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    return `${definition.sprites.directions[row]}.${definition.sprites.frames[column]}`;
  }
  if (definition.category === 'terrain' || definition.category === 'interior') {
    const contract = definition.autotileContract;
    const basePosition = contract.baseVariantIndices.indexOf(index);
    if (basePosition >= 0) return `base-variant-${basePosition}`;
    const blob = contract.blob16.find(({ tileIndex }) => tileIndex === index);
    if (blob) return `blob-mask-${blob.mask}`;
    const auxiliaryPosition = contract.auxiliaryTileIndices.indexOf(index);
    return contract.auxiliaryRoles[auxiliaryPosition] ?? `auxiliary-${index}`;
  }
  return definition.sprites.frames[index] ?? `cell-${index}`;
}

function cellExpectation(definition, index) {
  if (definition.category !== 'terrain' && definition.category !== 'interior') return 'nonempty';
  const contract = definition.autotileContract;
  const blob = contract.blob16.find(({ tileIndex }) => tileIndex === index);
  if (blob?.mask === 0) return 'semantic-transparent';
  const auxiliaryPosition = contract.auxiliaryTileIndices.indexOf(index);
  if (auxiliaryPosition >= 0
    && contract.auxiliaryRoles[auxiliaryPosition]?.startsWith('transparent-reserved-')) {
    return 'reserved-transparent';
  }
  return 'nonempty';
}

function cellInspection(decoded, definition) {
  const grid = definition.sprites?.grid;
  const columns = grid?.columns ?? 1;
  const rows = grid?.rows ?? 1;
  const width = grid?.frameWidth ?? definition.outputSize.width;
  const height = grid?.frameHeight ?? definition.outputSize.height;
  const declaredSlots = columns * rows;
  const records = [];
  const problems = [];
  const nonemptyDigests = new Map();
  for (let index = 0; index < declaredSlots; index += 1) {
    const raw = grid
      ? cellBuffer(decoded, index, columns, width, height)
      : decoded.data;
    const bounds = alphaBounds(raw, width, height, decoded.info.channels);
    const expectation = cellExpectation(definition, index);
    const role = cellRole(definition, index);
    if (expectation === 'nonempty' && bounds.visiblePixels === 0) {
      problems.push(`semantic cell ${index} (${role}) is empty`);
    }
    if (expectation !== 'nonempty' && bounds.visiblePixels !== 0) {
      problems.push(`${expectation} cell ${index} (${role}) is not fully transparent`);
    }
    const sha256 = cellSha256(raw);
    if (expectation === 'nonempty' && bounds.visiblePixels > 0) {
      const predecessor = nonemptyDigests.get(sha256);
      if (predecessor) {
        problems.push(`semantic cells ${predecessor.index} (${predecessor.role}) and ${index} (${role}) are byte-identical`);
      } else nonemptyDigests.set(sha256, { index, role });
    }
    records.push({
      index,
      role,
      expectation,
      sha256,
      visiblePixels: bounds.visiblePixels
    });
  }
  const reservedTransparent = records.filter(({ expectation }) => expectation === 'reserved-transparent').length;
  const expectedTransparentSemantic = records
    .filter(({ expectation }) => expectation === 'semantic-transparent').length;
  const expectedNonempty = records.filter(({ expectation }) => expectation === 'nonempty').length;
  return {
    problems,
    inspection: {
      declaredSlots,
      semanticCells: declaredSlots - reservedTransparent,
      expectedNonempty,
      expectedTransparentSemantic,
      reservedTransparent,
      records,
      passed: problems.length === 0
    }
  };
}

function exactEdgeMismatch(left, right, width, channels, leftEdge, rightEdge) {
  for (let index = 0; index < width; index += 1) {
    const leftOffset = leftEdge(index);
    const rightOffset = rightEdge(index);
    for (let channel = 0; channel < channels; channel += 1) {
      if (left[leftOffset + channel] !== right[rightOffset + channel]) return true;
    }
  }
  return false;
}

function exactSeamMismatchCount(decoded, indices, columns, tileSize) {
  const cells = new Map(indices.map((index) => [index, cellBuffer(decoded, index, columns, tileSize)]));
  let mismatches = 0;
  for (const left of cells.values()) {
    for (const right of cells.values()) {
      if (exactEdgeMismatch(
        left,
        right,
        tileSize,
        decoded.info.channels,
        (y) => pixelOffset(tileSize, decoded.info.channels, tileSize - 1, y),
        (y) => pixelOffset(tileSize, decoded.info.channels, 0, y)
      )) mismatches += 1;
      if (exactEdgeMismatch(
        left,
        right,
        tileSize,
        decoded.info.channels,
        (x) => pixelOffset(tileSize, decoded.info.channels, x, tileSize - 1),
        (x) => pixelOffset(tileSize, decoded.info.channels, x, 0)
      )) mismatches += 1;
    }
  }
  return mismatches;
}

async function nearestResizeAudit(sourceBuffer, outputDecoded, outputSize) {
  const sourceDecoded = await decodeRgba(sourceBuffer);
  const enlarged = outputSize.width > sourceDecoded.info.width || outputSize.height > sourceDecoded.info.height;
  const expected = sameSize(sourceDecoded.info, outputSize)
    ? sourceDecoded.data
    : (await sharp(sourceBuffer, {
        animated: false,
        failOn: 'error',
        limitInputPixels: IMAGE_LIMITS.maxInputPixels
      }).ensureAlpha().resize(outputSize.width, outputSize.height, {
        fit: 'fill',
        kernel: sharp.kernel.nearest
      }).raw().toBuffer({ resolveWithObject: true })).data;
  return {
    source: { width: sourceDecoded.info.width, height: sourceDecoded.info.height },
    output: outputSize,
    enlarged,
    matches: expected.equals(outputDecoded.data)
  };
}

function characterCellProblems(decoded, definition) {
  const problems = [];
  const contract = definition.characterSpriteContract;
  const width = contract.frame.width;
  const height = contract.frame.height;
  const channels = decoded.info.channels;
  for (let row = 0; row < 4; row += 1) {
    const cells = [];
    for (let column = 0; column < 10; column += 1) {
      const raw = cellBuffer(decoded, row * 10 + column, 10, width, height);
      cells.push(raw);
      const bounds = alphaBounds(raw, width, height, channels);
      if (!bounds.subjectBbox) {
        problems.push(`character cell ${row}:${column} is empty`);
        continue;
      }
      if (bounds.subjectBbox.width > contract.body.width
        || bounds.subjectBbox.height < contract.visibleBboxHeight.min
        || bounds.subjectBbox.height > contract.visibleBboxHeight.max
        || bounds.subjectBbox.y + bounds.subjectBbox.height !== height) {
        problems.push(`character cell ${row}:${column} violates body bbox/baseline`);
      }
    }
    for (let left = 0; left < cells.length; left += 1) {
      for (let right = left + 1; right < cells.length; right += 1) {
        if (cells[left]?.equals(cells[right])) {
          problems.push(`character direction row ${row} contains byte-identical frame slots`);
        }
      }
    }
  }
  return [...new Set(problems)];
}

function terrainCellProblems(decoded, definition) {
  const problems = [];
  const contract = definition.autotileContract;
  const opaqueIndices = [...contract.baseVariantIndices, ...contract.animationFrameIndices];
  const auxiliaryRoles = new Map(contract.auxiliaryTileIndices.map((index, position) => [
    index, contract.auxiliaryRoles[position]
  ]));
  for (const index of opaqueIndices) {
    const raw = cellBuffer(decoded, index, 5, 64);
    for (let offset = 3; offset < raw.length; offset += decoded.info.channels) {
      if (raw[offset] !== 255) {
        problems.push(`terrain base/animation tile ${index} is not fully opaque`);
        break;
      }
    }
  }
  for (const index of contract.auxiliaryTileIndices.filter((value) => auxiliaryRoles.get(value)?.startsWith('transparent-reserved-'))) {
    const raw = cellBuffer(decoded, index, 5, 64);
    for (let offset = 3; offset < raw.length; offset += decoded.info.channels) {
      if (raw[offset] !== 0) {
        problems.push(`terrain reserved tile ${index} is not fully transparent`);
        break;
      }
    }
  }
  for (const index of contract.auxiliaryTileIndices.filter((value) => auxiliaryRoles.get(value)?.startsWith('cliff-'))) {
    const raw = cellBuffer(decoded, index, 5, 64);
    if (!alphaBounds(raw, 64, 64, decoded.info.channels).subjectBbox) {
      problems.push(`terrain cliff-face tile ${index} is empty`);
    }
  }
  for (const { mask, tileIndex } of contract.blob16) {
    if (mask === 0) continue;
    const raw = cellBuffer(decoded, tileIndex, 5, 64);
    if (!alphaBounds(raw, 64, 64, decoded.info.channels).subjectBbox) {
      problems.push(`terrain blob mask ${mask} is empty`);
    }
  }
  return problems;
}

export async function auditVisualAssetV2(buffer, definition, {
  sourceBuffer = buffer,
  verifyResize = true
} = {}) {
  const problems = visualContractV2Problems(definition);
  if (definition?.visualContractVersion !== 2) {
    return { ok: true, problems: [], technicalInspection: null };
  }
  const decoded = await decodeRgba(buffer);
  if (!sameSize(decoded.info, definition.outputSize)) problems.push('decoded image dimensions do not match outputSize');
  const alpha = await auditTransparentPng(buffer);
  if (!alpha.subjectBbox) problems.push('alpha bbox gate rejected an empty image');
  if (definition.output.needsTransparency && alpha.transparentPixels === 0) {
    problems.push('transparent-output gate rejected a fully opaque canvas');
  }
  const hiddenRgbPixels = hiddenRgbPixelCount(decoded);
  if (hiddenRgbPixels !== 0) {
    problems.push('transparent-output gate rejected non-zero RGB hidden under fully transparent pixels');
  }
  const alphaGate = definition.inspectionGates.alphaBbox;
  if (alphaGate.policy === 'exact' && !sameRect(alpha.subjectBbox, alphaGate.expected)) {
    problems.push('alpha bbox does not match the exact contract');
  }
  if (!alphaGate.allowBorderContact && alpha.borderVisiblePixels > 0) {
    problems.push('alpha bbox touches a forbidden canvas border');
  }
  if (alpha.partialAlphaPixels !== 0) problems.push('hard-alpha gate rejected partial alpha pixels');

  const seamIndices = definition.inspectionGates.exactSeams.tileIndices;
  const seamMismatchCount = seamIndices.length > 0
    ? exactSeamMismatchCount(
        decoded,
        seamIndices,
        definition.sprites?.grid?.columns,
        definition.sprites?.grid?.frameWidth
      )
    : 0;
  if (seamMismatchCount > 0) problems.push('exact-seam gate rejected mismatched RGBA edges');
  if (definition.category === 'character' && sameSize(decoded.info, definition.outputSize)) {
    problems.push(...characterCellProblems(decoded, definition));
  }
  if ((definition.category === 'terrain' || definition.category === 'interior')
    && sameSize(decoded.info, definition.outputSize)) {
    problems.push(...terrainCellProblems(decoded, definition));
  }
  const cells = sameSize(decoded.info, definition.outputSize)
    ? cellInspection(decoded, definition)
    : null;
  if (cells) problems.push(...cells.problems);
  const resize = verifyResize
    ? await nearestResizeAudit(sourceBuffer, decoded, definition.outputSize)
    : {
        source: { width: decoded.info.width, height: decoded.info.height },
        output: { width: decoded.info.width, height: decoded.info.height },
        enlarged: false,
        matches: true
      };
  if (resize.enlarged) problems.push('nearest-resize gate rejected enlargement');
  if (!resize.matches) problems.push('nearest-resize gate rejected output pixels that do not match nearest reconstruction');
  const uniqueProblems = [...new Set(problems)];
  return {
    ok: uniqueProblems.length === 0,
    problems: uniqueProblems,
    technicalInspection: uniqueProblems.length === 0 ? {
      visualContractVersion: 2,
      alpha: {
        subjectBbox: alpha.subjectBbox,
        opaquePixels: alpha.opaquePixels,
        transparentPixels: alpha.transparentPixels,
        hiddenRgbPixels,
        partialAlphaPixels: alpha.partialAlphaPixels,
        borderVisiblePixels: alpha.borderVisiblePixels,
        passed: true
      },
      exactSeams: {
        checkedTileIndices: seamIndices,
        mismatchCount: seamMismatchCount,
        passed: true
      },
      resize: {
        kernel: 'nearest',
        source: resize.source,
        output: resize.output,
        enlarged: resize.enlarged,
        passed: true
      },
      cells: { ...cells.inspection, passed: true }
    } : null
  };
}

export async function auditBuildingBundleV2(artifacts, definition, { sourceArtifacts = artifacts } = {}) {
  const problems = visualContractV2Problems(definition);
  if (definition?.visualContractVersion !== 2 || definition.category !== 'building') {
    return { ok: false, problems: ['building bundle audit requires a v2 building definition'] };
  }
  const byRole = new Map((artifacts ?? []).map((entry) => [entry.role, entry]));
  const sourceByRole = new Map((sourceArtifacts ?? []).map((entry) => [entry.role, entry]));
  if (byRole.size !== 2 || !byRole.has('base') || !byRole.has('roof')) {
    problems.push('building bundle must contain exactly one base and one roof artifact');
  }
  for (const role of ['base', 'roof']) {
    const artifact = byRole.get(role);
    if (!Buffer.isBuffer(artifact?.bytes)) continue;
    const audit = await auditVisualAssetV2(artifact.bytes, definition, {
      sourceBuffer: sourceByRole.get(role)?.bytes ?? artifact.bytes
    });
    problems.push(...audit.problems.map((problem) => `${role}: ${problem}`));
  }
  if (Buffer.isBuffer(byRole.get('base')?.bytes) && Buffer.isBuffer(byRole.get('roof')?.bytes)) {
    const base = await decodeRgba(byRole.get('base').bytes);
    const roof = await decodeRgba(byRole.get('roof').bytes);
    if (!sameSize(base.info, definition.outputSize) || !sameSize(roof.info, definition.outputSize)) {
      problems.push('building base/roof decoded dimensions differ from outputSize');
    }
    if (base.data.equals(roof.data)) problems.push('building base and roof artifacts must not be identical');
  }
  const uniqueProblems = [...new Set(problems)];
  return { ok: uniqueProblems.length === 0, problems: uniqueProblems };
}
