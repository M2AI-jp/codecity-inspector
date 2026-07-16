import { canonicalJson, sha256 } from '../hashing.mjs';

export const GENERATION_MODES_V2 = Object.freeze(['per-unit', 'monolithic-atlas']);
export const UNIT_EXPECTATIONS_V2 = Object.freeze([
  'expected-nonempty',
  'semantic-transparent',
  'reserved-transparent'
]);

function artifactContracts(asset) {
  if (asset.category === 'building') {
    const artifacts = asset.buildingLayerContract?.artifacts ?? [];
    if (artifacts.length !== 2
      || artifacts[0]?.role !== 'base'
      || artifacts[1]?.role !== 'roof') {
      throw new Error(`${asset.id}: generation units require ordered base/roof artifacts`);
    }
    return artifacts.map((artifact) => ({
      role: artifact.role,
      outputSize: structuredClone(artifact.outputSize)
    }));
  }
  return [{ role: 'primary', outputSize: structuredClone(asset.outputSize) }];
}

function semanticRole(asset, frameId, direction) {
  if (asset.category === 'character') return `${direction}-${frameId}`;
  if (asset.category === 'building') return frameId;
  const autotile = asset.autotileContract;
  if (autotile) {
    const tileIndex = Number(frameId.slice('tile_'.length));
    const basePosition = autotile.baseVariantIndices.indexOf(tileIndex);
    if (basePosition >= 0) return `base-variant-${basePosition}`;
    const blob = autotile.blob16.find((entry) => entry.tileIndex === tileIndex);
    if (blob) return `blob-mask-${blob.mask}`;
    const auxiliaryPosition = autotile.auxiliaryTileIndices.indexOf(tileIndex);
    if (auxiliaryPosition >= 0) return autotile.auxiliaryRoles[auxiliaryPosition];
  }
  return frameId;
}

function expectationFor(asset, frameId) {
  const autotile = asset.autotileContract;
  if (!autotile) return 'expected-nonempty';
  const tileIndex = Number(frameId.slice('tile_'.length));
  const blob = autotile.blob16.find((entry) => entry.tileIndex === tileIndex);
  if (blob?.mask === 0) return 'semantic-transparent';
  const auxiliaryPosition = autotile.auxiliaryTileIndices.indexOf(tileIndex);
  const role = auxiliaryPosition >= 0 ? autotile.auxiliaryRoles[auxiliaryPosition] : null;
  if (role?.startsWith('transparent-reserved-')) return 'reserved-transparent';
  return 'expected-nonempty';
}

function unitId(index, artifactRole, direction, frameId) {
  return [
    'unit',
    String(index).padStart(3, '0'),
    artifactRole,
    ...(direction ? [direction] : []),
    frameId
  ].join('_').replaceAll(/[^a-z0-9_]+/g, '_');
}

function frameVisualContent(asset, frameId) {
  return asset.artDirection.frameContent.find((entry) => entry.frameId === frameId)?.visualContent
    ?? null;
}

function rawGenerationUnits(asset) {
  const artifacts = artifactContracts(asset);
  if (asset.category === 'building') {
    return artifacts.map((artifact, index) => ({
      artifactRole: artifact.role,
      artifactOutputSize: artifact.outputSize,
      cellIndex: 0,
      frameId: artifact.role,
      semanticRole: artifact.role,
      targetRect: {
        x: 0,
        y: 0,
        width: artifact.outputSize.width,
        height: artifact.outputSize.height
      },
      expectation: 'expected-nonempty',
      sourceRequired: true,
      visualContent: frameVisualContent(asset, artifact.role),
      unitId: unitId(index, artifact.role, null, artifact.role)
    }));
  }
  const artifact = artifacts[0];
  const grid = asset.sprites?.grid;
  if (!grid) {
    return [{
      artifactRole: 'primary',
      artifactOutputSize: artifact.outputSize,
      cellIndex: 0,
      frameId: 'primary',
      semanticRole: 'primary',
      targetRect: {
        x: 0, y: 0,
        width: artifact.outputSize.width,
        height: artifact.outputSize.height
      },
      expectation: 'expected-nonempty',
      sourceRequired: true,
      visualContent: frameVisualContent(asset, 'primary'),
      unitId: unitId(0, 'primary', null, 'primary')
    }];
  }
  if (grid.columns * grid.frameWidth !== artifact.outputSize.width
    || grid.rows * grid.frameHeight !== artifact.outputSize.height) {
    throw new Error(`${asset.id}: sprite grid does not fill its output artifact`);
  }
  const units = [];
  const frames = asset.sprites.frames;
  if (asset.category === 'character') {
    const directions = asset.sprites.directions;
    if (directions.length !== grid.rows || frames.length !== grid.columns) {
      throw new Error(`${asset.id}: character direction/frame product does not match the declared grid`);
    }
    for (let row = 0; row < directions.length; row += 1) {
      for (let column = 0; column < frames.length; column += 1) {
        const index = row * grid.columns + column;
        const frameId = frames[column];
        const direction = directions[row];
        units.push({
          artifactRole: 'primary',
          artifactOutputSize: artifact.outputSize,
          cellIndex: index,
          frameId,
          direction,
          semanticRole: semanticRole(asset, frameId, direction),
          targetRect: {
            x: column * grid.frameWidth,
            y: row * grid.frameHeight,
            width: grid.frameWidth,
            height: grid.frameHeight
          },
          expectation: 'expected-nonempty',
          sourceRequired: true,
          visualContent: frameVisualContent(asset, frameId),
          unitId: unitId(index, 'primary', direction, frameId)
        });
      }
    }
    return units;
  }
  if (frames.length !== grid.columns * grid.rows) {
    throw new Error(`${asset.id}: frame count does not match the declared grid`);
  }
  for (let index = 0; index < frames.length; index += 1) {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const frameId = frames[index];
    const expectation = expectationFor(asset, frameId);
    units.push({
      artifactRole: 'primary',
      artifactOutputSize: artifact.outputSize,
      cellIndex: index,
      frameId,
      semanticRole: semanticRole(asset, frameId, null),
      targetRect: {
        x: column * grid.frameWidth,
        y: row * grid.frameHeight,
        width: grid.frameWidth,
        height: grid.frameHeight
      },
      expectation,
      sourceRequired: expectation === 'expected-nonempty',
      visualContent: frameVisualContent(asset, frameId),
      unitId: unitId(index, 'primary', null, frameId)
    });
  }
  return units;
}

export function generationUnitProblems(asset, units) {
  const problems = [];
  if (!Array.isArray(units) || units.length === 0) return ['generation units are empty'];
  if (new Set(units.map(({ unitId: id }) => id)).size !== units.length) {
    problems.push('generation unit IDs are not unique');
  }
  const byArtifact = new Map();
  for (const unit of units) {
    if (!UNIT_EXPECTATIONS_V2.includes(unit.expectation)) {
      problems.push(`${unit.unitId}: unknown expectation`);
    }
    if (unit.sourceRequired !== (unit.expectation === 'expected-nonempty')) {
      problems.push(`${unit.unitId}: sourceRequired is not derived from expectation`);
    }
    if (!unit.visualContent) problems.push(`${unit.unitId}: missing exact frame art direction`);
    const { x, y, width, height } = unit.targetRect;
    const output = unit.artifactOutputSize;
    if (![x, y, width, height].every(Number.isInteger)
      || x < 0 || y < 0 || width < 1 || height < 1
      || x + width > output.width || y + height > output.height) {
      problems.push(`${unit.unitId}: targetRect escapes its artifact`);
    }
    const records = byArtifact.get(unit.artifactRole) ?? [];
    records.push(unit);
    byArtifact.set(unit.artifactRole, records);
  }
  for (const [role, records] of byArtifact) {
    const size = records[0].artifactOutputSize;
    const occupancy = new Uint8Array(size.width * size.height);
    for (const unit of records) {
      const rect = unit.targetRect;
      for (let y = rect.y; y < rect.y + rect.height; y += 1) {
        for (let x = rect.x; x < rect.x + rect.width; x += 1) {
          const index = y * size.width + x;
          if (occupancy[index]) problems.push(`${role}: overlapping targetRect at ${x},${y}`);
          occupancy[index] = 1;
        }
      }
    }
    if (occupancy.some((value) => value === 0)) {
      problems.push(`${role}: generation units do not cover the complete artifact`);
    }
  }
  return [...new Set(problems)];
}

export function enumerateWaveAGenerationUnits(asset) {
  const units = rawGenerationUnits(asset);
  const problems = generationUnitProblems(asset, units);
  if (problems.length > 0) {
    throw new Error(`Invalid generation units for ${asset.id}: ${problems.join('; ')}`);
  }
  return units;
}

export function summarizeWaveAGenerationUnits(definitions) {
  const units = definitions.flatMap((asset) => enumerateWaveAGenerationUnits(asset)
    .map((unit) => ({ assetId: asset.id, ...unit })));
  const expectations = Object.fromEntries(UNIT_EXPECTATIONS_V2.map((expectation) => [
    expectation,
    units.filter((unit) => unit.expectation === expectation).length
  ]));
  return {
    unitCount: units.length,
    sourceRequiredCount: units.filter(({ sourceRequired }) => sourceRequired).length,
    expectations,
    unitSetSha256: sha256(canonicalJson(units)),
    units
  };
}
