import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import sharp from 'sharp';
import { sha256 } from '../hashing.mjs';
import { assertExistingFileWithin } from '../paths.mjs';
import { cellAuditDigestFor } from './bundle-ledger.mjs';

export const WAVE_A_CELL_COUNTS = Object.freeze({
  declaredLogicalSlotCount: 771,
  semanticCellCount: 708,
  expectedNonemptySemanticCellCount: 696,
  expectedTransparentSemanticCellCount: 12,
  reservedTransparentCellCount: 63
});

function artifactRoles(definition) {
  return definition.buildingLayerContract?.artifacts.map(({ role }) => role) ?? ['primary'];
}

function frameRoleFor(definition, cellIndex) {
  const autotile = definition.autotileContract;
  if (autotile) {
    const base = autotile.baseVariantIndices.indexOf(cellIndex);
    if (base >= 0) return `autotile-base-variant-${base}`;
    const blob = autotile.blob16.find(({ tileIndex }) => tileIndex === cellIndex);
    if (blob) return `autotile-blob-mask-${blob.mask}`;
    const auxiliary = autotile.auxiliaryTileIndices.indexOf(cellIndex);
    if (auxiliary >= 0) return `autotile-${autotile.auxiliaryRoles[auxiliary]}`;
    throw new Error(`${definition.id} autotile leaves cell ${cellIndex} without a semantic role`);
  }
  const grid = definition.sprites?.grid;
  if (!grid) return 'whole-artifact';
  const directions = definition.sprites?.directions ?? [];
  const frames = definition.sprites?.frames ?? [];
  const row = Math.floor(cellIndex / grid.columns);
  const column = cellIndex % grid.columns;
  if (directions.length === grid.rows && frames.length === grid.columns) {
    return `${directions[row]}:${frames[column]}`;
  }
  if (frames.length === grid.columns * grid.rows) return frames[cellIndex];
  throw new Error(`${definition.id} grid does not assign one semantic frame role to every cell`);
}

function expectationFor(definition, cellIndex) {
  const autotile = definition.autotileContract;
  if (!autotile) return 'semantic-nonempty';
  const auxiliary = autotile.auxiliaryTileIndices.indexOf(cellIndex);
  if (auxiliary >= 0 && autotile.auxiliaryRoles[auxiliary]?.startsWith('transparent-reserved-')) {
    return 'reserved-transparent';
  }
  const blob = autotile.blob16.find(({ tileIndex }) => tileIndex === cellIndex);
  if (blob?.mask === 0) return 'semantic-transparent-autotile-mask0';
  return 'semantic-nonempty';
}

export function deriveAssetCellContract(definition) {
  const grid = definition.sprites?.grid;
  const cellsPerArtifact = grid ? grid.columns * grid.rows : 1;
  const cells = [];
  for (const role of artifactRoles(definition)) {
    for (let cellIndex = 0; cellIndex < cellsPerArtifact; cellIndex += 1) {
      cells.push({
        artifactRole: role,
        cellIndex,
        frameRole: frameRoleFor(definition, cellIndex),
        expectation: expectationFor(definition, cellIndex)
      });
    }
  }
  if (new Set(cells.map(({ artifactRole, frameRole }) => `${artifactRole}:${frameRole}`)).size !== cells.length) {
    throw new Error(`${definition.id} cell roles are not unique`);
  }
  return cells;
}

export function deriveWaveACellContract(definitions) {
  const assets = definitions.map((definition) => ({
    assetId: definition.id,
    cells: deriveAssetCellContract(definition)
  }));
  const all = assets.flatMap(({ cells }) => cells);
  return {
    assets,
    declaredLogicalSlotCount: all.length,
    semanticCellCount: all.filter(({ expectation }) => expectation !== 'reserved-transparent').length,
    expectedNonemptySemanticCellCount: all.filter(({ expectation }) => expectation === 'semantic-nonempty').length,
    expectedTransparentSemanticCellCount: all.filter(({ expectation }) => expectation === 'semantic-transparent-autotile-mask0').length,
    reservedTransparentCellCount: all.filter(({ expectation }) => expectation === 'reserved-transparent').length
  };
}

export function assertWaveACellCounts(summary) {
  for (const [field, expected] of Object.entries(WAVE_A_CELL_COUNTS)) {
    if (summary[field] !== expected) {
      throw new Error(`Wave A definition-derived ${field} drifted: expected ${expected}, found ${summary[field]}`);
    }
  }
}

async function readStableBytes(root, relativePath, maximumBytes = 25 * 1024 * 1024) {
  const source = await assertExistingFileWithin(root, relativePath);
  const before = await lstat(source, { bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(maximumBytes)) {
    throw new Error(`Wave A cell audit input is empty or too large: ${relativePath}`);
  }
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) {
      throw new Error(`Wave A cell audit input changed while opening: ${relativePath}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
      || BigInt(bytes.length) !== opened.size) {
      throw new Error(`Wave A cell audit input changed while reading: ${relativePath}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function rgbaCell(decoded, grid, cellIndex) {
  const columns = grid?.columns ?? 1;
  const rows = grid?.rows ?? 1;
  const width = grid?.frameWidth ?? decoded.info.width;
  const height = grid?.frameHeight ?? decoded.info.height;
  if (width * columns !== decoded.info.width || height * rows !== decoded.info.height) {
    throw new Error('Decoded PNG dimensions do not match the definition grid');
  }
  const row = Math.floor(cellIndex / columns);
  const column = cellIndex % columns;
  const bytes = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (((row * height) + y) * decoded.info.width + column * width) * 4;
    decoded.data.copy(bytes, y * width * 4, sourceStart, sourceStart + width * 4);
  }
  return { bytes, width, height };
}

function alphaSummary(bytes, width, height) {
  let count = 0;
  let hiddenRgbPixelCount = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < width * height; index += 1) {
    if (bytes[index * 4 + 3] === 0) {
      if (bytes[index * 4] !== 0 || bytes[index * 4 + 1] !== 0 || bytes[index * 4 + 2] !== 0) {
        hiddenRgbPixelCount += 1;
      }
      continue;
    }
    count += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    count,
    hiddenRgbPixelCount,
    bbox: count === 0 ? null : {
      x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1
    }
  };
}

export async function auditWaveAAssetCells(root, definition, artifacts) {
  const contract = deriveAssetCellContract(definition);
  const contractByRole = new Map();
  for (const cell of contract) {
    const entries = contractByRole.get(cell.artifactRole) ?? [];
    entries.push(cell);
    contractByRole.set(cell.artifactRole, entries);
  }
  const cells = [];
  for (const artifact of artifacts) {
    const bytes = await readStableBytes(root, artifact.pendingPath);
    if (sha256(bytes) !== artifact.sha256) throw new Error(`${definition.id}.${artifact.role} changed before cell audit`);
    const decoded = await sharp(bytes, { animated: false, failOn: 'error' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.channels !== 4
      || decoded.info.width !== definition.outputSize.width
      || decoded.info.height !== definition.outputSize.height) {
      throw new Error(`${definition.id}.${artifact.role} does not match its exact native output size`);
    }
    const roleCells = contractByRole.get(artifact.role);
    if (!roleCells) throw new Error(`${definition.id} has an unexpected artifact role: ${artifact.role}`);
    const nonemptyHashes = new Set();
    for (const expected of roleCells) {
      const raw = rgbaCell(decoded, definition.sprites?.grid, expected.cellIndex);
      const alpha = alphaSummary(raw.bytes, raw.width, raw.height);
      if (alpha.hiddenRgbPixelCount !== 0) {
        throw new Error(`${definition.id}.${artifact.role} ${expected.frameRole} has RGB data hidden below alpha 0`);
      }
      if (expected.expectation === 'semantic-nonempty' && alpha.count === 0) {
        throw new Error(`${definition.id}.${artifact.role} ${expected.frameRole} must contain visible semantic pixels`);
      }
      if (expected.expectation !== 'semantic-nonempty' && alpha.count !== 0) {
        throw new Error(`${definition.id}.${artifact.role} ${expected.frameRole} must be fully transparent`);
      }
      const rgbaSha256 = sha256(raw.bytes);
      if (definition.sprites?.grid && expected.expectation === 'semantic-nonempty') {
        if (nonemptyHashes.has(rgbaSha256)) {
          throw new Error(`${definition.id}.${artifact.role} reuses identical pixels for distinct semantic cell roles`);
        }
        nonemptyHashes.add(rgbaSha256);
      }
      cells.push({
        ...expected,
        rgbaSha256,
        alphaPixelCount: alpha.count,
        hiddenRgbPixelCount: alpha.hiddenRgbPixelCount,
        alphaBbox: alpha.bbox
      });
    }
  }
  if (cells.length !== contract.length) throw new Error(`${definition.id} cell audit is incomplete`);
  const content = {
    declaredLogicalSlotCount: cells.length,
    semanticCellCount: cells.filter(({ expectation }) => expectation !== 'reserved-transparent').length,
    expectedNonemptySemanticCellCount: cells.filter(({ expectation }) => expectation === 'semantic-nonempty').length,
    expectedTransparentSemanticCellCount: cells.filter(({ expectation }) => expectation === 'semantic-transparent-autotile-mask0').length,
    reservedTransparentCellCount: cells.filter(({ expectation }) => expectation === 'reserved-transparent').length,
    cells
  };
  return { ...content, cellAuditDigest: cellAuditDigestFor(content) };
}
