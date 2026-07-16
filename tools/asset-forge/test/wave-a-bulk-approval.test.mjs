import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { FORGE_ROOT } from '../src/config.mjs';
import { canonicalJson, sha256 } from '../src/hashing.mjs';
import { readWaveADefinitions } from '../src/v2/definition-builder.mjs';
import {
  appendWaveApproval,
  allowedBlueprintIdsForDefinition,
  artifactSetDigestFor,
  assertUnambiguousGenerationLedger,
  assertWaveAReviewChronology,
  assertWaveAVisualEvidenceBindings,
  auditWaveAAssetCells,
  bundleLedgerDigest,
  cellAuditDigestFor,
  cellAuditSetDigestFor,
  deriveAssetCellContract,
  deriveWaveACellContract,
  emptyBundleLedger,
  evidenceCoverageDigestFor,
  executeWaveAApproval,
  inspectBundleLedger,
  isRepeatableDefinition,
  prepareWaveBundleApproval,
  previewWaveAApproval,
  requiredBlueprintIdsForDefinition,
  verifyWaveBundleMaterialization,
  waveApprovalDigestFor
} from '../src/v3/index.mjs';
import * as v3Public from '../src/v3/index.mjs';
import { readLegacyDisposition } from '../src/v3/migration.mjs';
import {
  assertDistinctDecodedEvidenceRoles,
  inspectStaticPngEvidenceBytes
} from '../src/v3/wave-operator.mjs';

const PLAN_DIGEST = 'a'.repeat(64);
const APPROVED_AT = '2026-07-16T06:00:00.000Z';

async function terrainCandidateBytes(definition, mutate = () => {}) {
  const { width, height } = definition.outputSize;
  const grid = definition.sprites.grid;
  const data = Buffer.alloc(width * height * 4);
  const contract = deriveAssetCellContract(definition);
  for (const cell of contract) {
    if (cell.expectation !== 'semantic-nonempty') continue;
    const row = Math.floor(cell.cellIndex / grid.columns);
    const column = cell.cellIndex % grid.columns;
    const rgba = [
      (cell.cellIndex * 37 + 11) % 256,
      (cell.cellIndex * 67 + 23) % 256,
      (cell.cellIndex * 97 + 41) % 256,
      255
    ];
    for (let y = 0; y < grid.frameHeight; y += 1) {
      for (let x = 0; x < grid.frameWidth; x += 1) {
        const offset = (((row * grid.frameHeight + y) * width)
          + column * grid.frameWidth + x) * 4;
        data.set(rgba, offset);
      }
    }
  }
  mutate(data, grid, width);
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function clearCell(data, grid, imageWidth, cellIndex) {
  const row = Math.floor(cellIndex / grid.columns);
  const column = cellIndex % grid.columns;
  for (let y = 0; y < grid.frameHeight; y += 1) {
    const start = (((row * grid.frameHeight + y) * imageWidth) + column * grid.frameWidth) * 4;
    data.fill(0, start, start + grid.frameWidth * 4);
  }
}

function copyCell(data, grid, imageWidth, sourceIndex, targetIndex) {
  const sourceRow = Math.floor(sourceIndex / grid.columns);
  const sourceColumn = sourceIndex % grid.columns;
  const targetRow = Math.floor(targetIndex / grid.columns);
  const targetColumn = targetIndex % grid.columns;
  for (let y = 0; y < grid.frameHeight; y += 1) {
    const source = (((sourceRow * grid.frameHeight + y) * imageWidth) + sourceColumn * grid.frameWidth) * 4;
    const target = (((targetRow * grid.frameHeight + y) * imageWidth) + targetColumn * grid.frameWidth) * 4;
    data.copy(data, target, source, source + grid.frameWidth * 4);
  }
}

function countCells(cells, expectation) {
  return cells.filter((cell) => cell.expectation === expectation).length;
}

function auditFixture(definition) {
  const contract = deriveAssetCellContract(definition);
  const cells = contract.map((cell) => {
    const nonempty = cell.expectation === 'semantic-nonempty';
    return {
      ...cell,
      rgbaSha256: sha256(`${definition.id}:${cell.artifactRole}:${cell.cellIndex}`),
      alphaPixelCount: nonempty ? 1 : 0,
      hiddenRgbPixelCount: 0,
      alphaBbox: nonempty ? { x: 0, y: 0, width: 1, height: 1 } : null
    };
  });
  const content = {
    declaredLogicalSlotCount: cells.length,
    semanticCellCount: cells.filter(({ expectation }) => expectation !== 'reserved-transparent').length,
    expectedNonemptySemanticCellCount: countCells(cells, 'semantic-nonempty'),
    expectedTransparentSemanticCellCount: countCells(cells, 'semantic-transparent-autotile-mask0'),
    reservedTransparentCellCount: countCells(cells, 'reserved-transparent'),
    cells
  };
  return { ...content, cellAuditDigest: cellAuditDigestFor(content) };
}

function visualSelectionFixture(definitions) {
  const blueprintIds = ['old-town', 'snow', 'harbor', 'woodland', 'night', 'cutaway'];
  const blueprintRecord = new Map(blueprintIds.map((id) => [id, {
    id,
    status: 'pass',
    reviewer: 'human',
    reviewedAt: APPROVED_AT,
    path: `review/evidence/v3/scene-${id}.png`,
    sha256: sha256(`scene-blueprint:${id}`),
    includedAssets: []
  }]));
  const assets = definitions.map((definition, index) => {
    const artifactSha256s = (definition.category === 'building' ? ['base', 'roof'] : ['primary'])
      .map((role) => sha256(`selected:${definition.id}:${role}`));
    const requiredIds = [...requiredBlueprintIdsForDefinition(definition)];
    const entry = {
      assetId: definition.id,
      artifacts: artifactSha256s.map((artifactSha256) => ({ sha256: artifactSha256 })),
      visualReview: {
        reviewer: 'human',
        reviewedAt: APPROVED_AT,
        native: {
          status: 'pass',
          path: `review/evidence/v3/native-${String(index).padStart(3, '0')}.png`,
          sha256: sha256(`native:${definition.id}`),
          artifactSha256s
        },
        repeat: isRepeatableDefinition(definition) ? {
          status: 'pass',
          layout: '3x3',
          path: `review/evidence/v3/repeat-${String(index).padStart(3, '0')}.png`,
          sha256: sha256(`repeat:${definition.id}`),
          artifactSha256s
        } : {
          status: 'not-applicable',
          reason: 'definition-is-not-repeatable',
          artifactSha256s
        },
        ensemble: requiredIds.map((blueprintId) => {
          const blueprint = blueprintRecord.get(blueprintId);
          return {
            status: 'pass',
            blueprintId,
            path: blueprint.path,
            sha256: blueprint.sha256,
            artifactSha256s
          };
        })
      }
    };
    for (const blueprintId of requiredIds) {
      blueprintRecord.get(blueprintId).includedAssets.push({
        assetId: definition.id,
        artifactSha256s
      });
    }
    return entry;
  });
  return { assets, sceneBlueprints: blueprintIds.map((id) => blueprintRecord.get(id)) };
}

async function bulkLedgerFixture() {
  const definitions = await readWaveADefinitions();
  const empty = emptyBundleLedger();
  const bundleDirectory = `generated/v3/wave-bundles/${PLAN_DIGEST}`;
  const approvals = [];
  const assets = [];
  for (const [index, definition] of definitions.entries()) {
    const generationId = `gen_wave_a_fixture_${String(index).padStart(3, '0')}`;
    const roles = definition.category === 'building' ? ['base', 'roof'] : ['primary'];
    const artifacts = roles.map((role) => {
      const artifactSha256 = sha256(`${definition.id}:${role}:artifact`);
      return {
        role,
        generationId,
        approvedPath: `${bundleDirectory}/${definition.id.replaceAll('.', '_')}-${role}-${artifactSha256.slice(0, 16)}.png`,
        sha256: artifactSha256
      };
    });
    const definitionSha256 = sha256(canonicalJson(definition));
    const generationRecordDigest = sha256(`${definition.id}:pending-generation`);
    const approval = prepareWaveBundleApproval({
      assetId: definition.id,
      category: definition.category,
      definitionSha256,
      generationRecordDigest,
      artifacts,
      reviewer: 'human',
      note: 'single exact Wave A human review',
      approvedAt: APPROVED_AT
    }, { bundleDirectory });
    approvals.push(approval);
    assets.push({
      assetId: definition.id,
      pendingGenerationId: generationId,
      pendingGenerationRecordDigest: generationRecordDigest,
      definitionSha256,
      bundleDigest: approval.bundleDigest,
      visualEvidenceDigest: sha256(`${definition.id}:visual-evidence`),
      artifacts: artifacts.map(({ role, approvedPath, sha256: artifactSha256 }) => ({
        role, approvedPath, sha256: artifactSha256
      })),
      cellAudit: auditFixture(definition)
    });
  }
  const counts = assets.reduce((sum, { cellAudit }) => ({
    declaredLogicalSlotCount: sum.declaredLogicalSlotCount + cellAudit.declaredLogicalSlotCount,
    semanticCellCount: sum.semanticCellCount + cellAudit.semanticCellCount,
    expectedNonemptySemanticCellCount: sum.expectedNonemptySemanticCellCount + cellAudit.expectedNonemptySemanticCellCount,
    expectedTransparentSemanticCellCount: sum.expectedTransparentSemanticCellCount + cellAudit.expectedTransparentSemanticCellCount,
    reservedTransparentCellCount: sum.reservedTransparentCellCount + cellAudit.reservedTransparentCellCount
  }), {
    declaredLogicalSlotCount: 0,
    semanticCellCount: 0,
    expectedNonemptySemanticCellCount: 0,
    expectedTransparentSemanticCellCount: 0,
    reservedTransparentCellCount: 0
  });
  const unsigned = {
    schemaVersion: 3,
    contract: 'fable5-wave-approval-v3',
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    status: 'approved',
    reviewer: 'human',
    approvedAt: APPROVED_AT,
    note: 'single exact Wave A human review',
    planDigest: PLAN_DIGEST,
    selectionDigest: sha256('selection'),
    legacyDispositionDigest: sha256('migration'),
    referenceAuthorizationSha256: sha256('authorization'),
    evidenceCoverageDigest: evidenceCoverageDigestFor(assets),
    cellAuditDigest: cellAuditSetDigestFor(assets),
    artifactSetDigest: artifactSetDigestFor(assets),
    requiredAssetCount: 109,
    outputPngCount: 128,
    ...counts,
    bundleLedgerDigestBefore: bundleLedgerDigest(empty),
    bundleDirectory,
    assets
  };
  const waveApproval = { ...unsigned, approvalDigest: waveApprovalDigestFor(unsigned) };
  return { empty, approvals, waveApproval };
}

test('Wave A definitions derive 771 declared slots as 696 visible + 12 semantic transparent + 63 reserved', async () => {
  const definitions = await readWaveADefinitions();
  const contract = deriveWaveACellContract(definitions);
  assert.equal(definitions.length, 109);
  assert.deepEqual({
    declared: contract.declaredLogicalSlotCount,
    semantic: contract.semanticCellCount,
    nonempty: contract.expectedNonemptySemanticCellCount,
    transparentSemantic: contract.expectedTransparentSemanticCellCount,
    transparentReserved: contract.reservedTransparentCellCount
  }, {
    declared: 771,
    semantic: 708,
    nonempty: 696,
    transparentSemantic: 12,
    transparentReserved: 63
  });
  const maskZero = contract.assets.flatMap(({ assetId, cells }) => cells
    .filter(({ expectation }) => expectation === 'semantic-transparent-autotile-mask0')
    .map((cell) => ({ assetId, ...cell })));
  assert.equal(maskZero.length, 12);
  assert.ok(maskZero.every(({ frameRole }) => frameRole === 'autotile-blob-mask-0'));
  const pier = definitions.find(({ id }) => id === 'structure.pier');
  assert.equal(isRepeatableDefinition(pier), true);
  assert.equal(isRepeatableDefinition(definitions.find(({ id }) => id === 'prop.crate')), false);
  assert.deepEqual(
    [...allowedBlueprintIdsForDefinition(definitions.find(({ id }) => id === 'terrain.snow'))].sort(),
    ['night', 'snow']
  );
  assert.deepEqual(
    [...requiredBlueprintIdsForDefinition(definitions.find(({ id }) => id === 'terrain.snow'))],
    ['snow']
  );
  assert.deepEqual(
    [...requiredBlueprintIdsForDefinition(definitions.find(({ id }) => id === 'building.town_hall'))].sort(),
    ['cutaway', 'night', 'old-town']
  );
  assert.ok(allowedBlueprintIdsForDefinition(
    definitions.find(({ id }) => id === 'ui.evidence_panel')
  ).has('cutaway'));
});

test('review chronology cannot predate selected candidate bytes or the approval instant', () => {
  const pendingByAsset = new Map([['terrain.grass', {
    createdAt: '2026-07-16T05:00:00.000Z'
  }]]);
  const selection = {
    sceneBlueprints: [{
      id: 'old-town',
      reviewedAt: '2026-07-16T05:01:00.000Z',
      includedAssets: [{ assetId: 'terrain.grass' }]
    }],
    assets: [{
      assetId: 'terrain.grass',
      visualReview: { reviewedAt: '2026-07-16T05:01:00.000Z' }
    }]
  };
  assert.doesNotThrow(() => assertWaveAReviewChronology(selection, pendingByAsset, APPROVED_AT));
  const visualBeforeBytes = structuredClone(selection);
  visualBeforeBytes.assets[0].visualReview.reviewedAt = '2026-07-16T04:59:59.999Z';
  assert.throws(
    () => assertWaveAReviewChronology(visualBeforeBytes, pendingByAsset, APPROVED_AT),
    /predates the selected candidate bytes/
  );
  const blueprintBeforeBytes = structuredClone(selection);
  blueprintBeforeBytes.sceneBlueprints[0].reviewedAt = '2026-07-16T04:59:59.999Z';
  assert.throws(
    () => assertWaveAReviewChronology(blueprintBeforeBytes, pendingByAsset, APPROVED_AT),
    /reviewed before included candidate bytes existed/
  );
  assert.throws(
    () => assertWaveAReviewChronology(selection, pendingByAsset, '2026-07-16T05:00:30.000Z'),
    /future-dated/
  );
});

test('bulk planning rejects duplicate generation ids, metadata paths, and cross-generation output paths', () => {
  const first = {
    id: 'gen_first',
    metadataPath: 'generated/props/pending/first.json',
    outputPath: 'generated/props/pending/first.png'
  };
  assert.doesNotThrow(() => assertUnambiguousGenerationLedger({ results: [first] }));
  assert.throws(
    () => assertUnambiguousGenerationLedger({ results: [first, { ...first }] }),
    /repeats id/
  );
  assert.throws(
    () => assertUnambiguousGenerationLedger({ results: [first, {
      ...first, id: 'gen_second', outputPath: 'generated/props/pending/second.png'
    }] }),
    /reuses metadata path/
  );
  assert.throws(
    () => assertUnambiguousGenerationLedger({ results: [first, {
      ...first, id: 'gen_second', metadataPath: 'generated/props/pending/second.json'
    }] }),
    /reuses output path/
  );
});

test('public bulk preview ignores caller-supplied clocks and fails before an incomplete root can approve', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forge-wave-clock-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await mkdir(path.join(temporary, 'data', 'v3'), { recursive: true });
  await writeFile(
    path.join(temporary, 'data', 'v3', 'bundle-approvals.json'),
    canonicalJson(emptyBundleLedger())
  );
  let injectedClockCalled = false;
  await assert.rejects(
    () => previewWaveAApproval({ note: 'cannot inject time' }, {
      root: temporary,
      forgeRoot: temporary,
      now: () => {
        injectedClockCalled = true;
        return APPROVED_AT;
      }
    }),
    /roots, clocks, and dependencies are fixed/
  );
  assert.equal(injectedClockCalled, false);

  const descriptors = [process.stdin, process.stdout]
    .map((stream) => Object.getOwnPropertyDescriptor(stream, 'isTTY'));
  try {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await assert.rejects(
      () => executeWaveAApproval({
        status: 'ready-for-human-confirmation',
        confirmationPhrase: `APPROVE FABLE5 WAVE A ${PLAN_DIGEST}`
      }, `APPROVE FABLE5 WAVE A ${PLAN_DIGEST}`),
      /real interactive TTYs/
    );
  } finally {
    for (const [index, stream] of [process.stdin, process.stdout].entries()) {
      if (descriptors[index]) Object.defineProperty(stream, 'isTTY', descriptors[index]);
      else delete stream.isTTY;
    }
  }
});

test('visual evidence binds distinct physical roles and every asset to its applicable biome scenes', async () => {
  const definitions = await readWaveADefinitions();
  const valid = visualSelectionFixture(definitions);
  assert.doesNotThrow(() => assertWaveAVisualEvidenceBindings(valid, definitions));

  const crossRoleAlias = structuredClone(valid);
  crossRoleAlias.assets[0].visualReview.native.path = crossRoleAlias.sceneBlueprints[0].path;
  crossRoleAlias.assets[0].visualReview.native.sha256 = crossRoleAlias.sceneBlueprints[0].sha256;
  assert.throws(
    () => assertWaveAVisualEvidenceBindings(crossRoleAlias, definitions),
    /reuses physical evidence across review roles/
  );

  const wrongBiome = structuredClone(valid);
  const snowEntry = wrongBiome.assets.find(({ assetId }) => assetId === 'terrain.snow');
  const snowBlueprint = wrongBiome.sceneBlueprints.find(({ id }) => id === 'snow');
  const nightBlueprint = wrongBiome.sceneBlueprints.find(({ id }) => id === 'night');
  snowEntry.visualReview.ensemble = snowEntry.visualReview.ensemble
    .filter(({ blueprintId }) => blueprintId !== 'snow');
  snowBlueprint.includedAssets = snowBlueprint.includedAssets
    .filter(({ assetId }) => assetId !== 'terrain.snow');
  snowEntry.visualReview.ensemble.push({
    status: 'pass',
    blueprintId: 'night',
    path: nightBlueprint.path,
    sha256: nightBlueprint.sha256,
    artifactSha256s: snowEntry.artifacts.map(({ sha256: artifactSha256 }) => artifactSha256)
  });
  nightBlueprint.includedAssets.push({
    assetId: 'terrain.snow',
    artifactSha256s: snowEntry.artifacts.map(({ sha256: artifactSha256 }) => artifactSha256)
  });
  assert.throws(
    () => assertWaveAVisualEvidenceBindings(wrongBiome, definitions),
    /lacks a mandatory applicable-biome/
  );

  const missingCoverage = structuredClone(valid);
  const townHall = missingCoverage.assets.find(({ assetId }) => assetId === 'building.town_hall');
  const oldTown = missingCoverage.sceneBlueprints.find(({ id }) => id === 'old-town');
  assert.ok(townHall.visualReview.ensemble.some(({ blueprintId }) => blueprintId === 'old-town'));
  oldTown.includedAssets = oldTown.includedAssets
    .filter(({ assetId }) => assetId !== 'building.town_hall');
  assert.throws(
    () => assertWaveAVisualEvidenceBindings(missingCoverage, definitions),
    /ensemble records do not exactly match scene blueprint coverage/
  );

  const duplicateBlueprint = structuredClone(valid);
  duplicateBlueprint.sceneBlueprints[1].path = duplicateBlueprint.sceneBlueprints[0].path;
  duplicateBlueprint.sceneBlueprints[1].sha256 = duplicateBlueprint.sceneBlueprints[0].sha256;
  assert.throws(
    () => assertWaveAVisualEvidenceBindings(duplicateBlueprint, definitions),
    /six distinct scene blueprint files and image hashes/i
  );
});

test('visual evidence rejects re-encoded PNGs with byte-distinct files but identical decoded RGBA', async () => {
  const width = 48;
  const height = 48;
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba.set([(offset / 4) % 251, 73, 149, 255], offset);
  }
  const nativeBytes = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const repeatBytes = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  assert.notEqual(sha256(nativeBytes), sha256(repeatBytes));
  const native = await inspectStaticPngEvidenceBytes(nativeBytes, 'prop.crate native');
  const repeat = await inspectStaticPngEvidenceBytes(repeatBytes, 'prop.crate repeat');
  assert.equal(native.decodedRgbaSha256, repeat.decodedRgbaSha256);
  assert.throws(
    () => assertDistinctDecodedEvidenceRoles([
      { label: 'prop.crate native', inspection: native },
      { label: 'prop.crate repeat', inspection: repeat }
    ]),
    /reuses decoded RGBA pixels across physical review roles/
  );
});

test('the v3 public surface exposes only the Wave A bulk approval authority', () => {
  assert.equal(Object.hasOwn(v3Public, 'previewBundleApproval'), false);
  assert.equal(Object.hasOwn(v3Public, 'executeBundleApproval'), false);
  assert.equal(Object.hasOwn(v3Public, 'formatBundleApprovalPreview'), false);
  assert.equal(Object.hasOwn(v3Public, 'previewWaveAApproval'), true);
  assert.equal(Object.hasOwn(v3Public, 'executeWaveAApproval'), true);
  for (const internalName of [
    'buildWaveAPlan', 'prepareJournalAndBundle', 'materializeBundleAfterJournal'
  ]) {
    assert.equal(Object.hasOwn(v3Public, internalName), false);
  }
});

test('cell audit reads candidate RGBA and rejects empty semantic, nontransparent reserved, and duplicated roles', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forge-cell-audit-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const pendingPath = 'generated/terrains/pending/terrain_grass.png';
  const absolute = path.join(temporary, pendingPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const definition = (await readWaveADefinitions()).find(({ id }) => id === 'terrain.grass');

  const valid = await terrainCandidateBytes(definition);
  await writeFile(absolute, valid);
  const validAudit = await auditWaveAAssetCells(temporary, definition, [{
    role: 'primary', pendingPath, sha256: sha256(valid)
  }]);
  assert.deepEqual({
    declared: validAudit.declaredLogicalSlotCount,
    nonempty: validAudit.expectedNonemptySemanticCellCount,
    semanticTransparent: validAudit.expectedTransparentSemanticCellCount,
    reserved: validAudit.reservedTransparentCellCount
  }, { declared: 25, nonempty: 18, semanticTransparent: 1, reserved: 6 });

  const emptySemantic = await terrainCandidateBytes(definition, (data, grid, width) => {
    clearCell(data, grid, width, 0);
  });
  await writeFile(absolute, emptySemantic);
  await assert.rejects(
    () => auditWaveAAssetCells(temporary, definition, [{
      role: 'primary', pendingPath, sha256: sha256(emptySemantic)
    }]),
    /must contain visible semantic pixels/
  );

  const visibleReserved = await terrainCandidateBytes(definition, (data, grid, width) => {
    const offset = ((3 * grid.frameHeight) * width + 4 * grid.frameWidth) * 4;
    data.set([1, 2, 3, 255], offset);
  });
  await writeFile(absolute, visibleReserved);
  await assert.rejects(
    () => auditWaveAAssetCells(temporary, definition, [{
      role: 'primary', pendingPath, sha256: sha256(visibleReserved)
    }]),
    /must be fully transparent/
  );

  const hiddenRgb = await terrainCandidateBytes(definition, (data, grid) => {
    const offset = (3 * grid.frameWidth) * 4;
    data.set([255, 0, 255, 0], offset);
  });
  await writeFile(absolute, hiddenRgb);
  await assert.rejects(
    () => auditWaveAAssetCells(temporary, definition, [{
      role: 'primary', pendingPath, sha256: sha256(hiddenRgb)
    }]),
    /RGB data hidden below alpha 0/
  );

  const duplicated = await terrainCandidateBytes(definition, (data, grid, width) => {
    copyCell(data, grid, width, 0, 1);
  });
  await writeFile(absolute, duplicated);
  await assert.rejects(
    () => auditWaveAAssetCells(temporary, definition, [{
      role: 'primary', pendingPath, sha256: sha256(duplicated)
    }]),
    /reuses identical pixels for distinct semantic cell roles/
  );
});

test('one ledger append is the authority for all 109 bundles and rejects orphan wave-path approvals', async () => {
  const { empty, approvals, waveApproval } = await bulkLedgerFixture();
  const orphanLedger = { ...empty, approvals };
  const orphanInspection = inspectBundleLedger(orphanLedger);
  assert.equal(orphanInspection.ok, false);
  assert.match(orphanInspection.errors.join('\n'), /not authorized by a bulk approval/);

  const committed = appendWaveApproval(empty, approvals, waveApproval);
  const inspection = inspectBundleLedger(committed);
  assert.equal(inspection.ok, true, inspection.errors.join('\n'));
  assert.equal(inspection.activeByAsset.size, 109);
  assert.equal(inspection.waveApprovalById.get('A').outputPngCount, 128);
  assert.throws(() => appendWaveApproval(committed, approvals, waveApproval), /exactly once/);

  const tampered = structuredClone(committed);
  tampered.waveApprovals[0].assets[0].cellAudit.cells[0].alphaPixelCount += 1;
  assert.equal(inspectBundleLedger(tampered).ok, false);

  const normalizedEvidenceTamper = structuredClone(committed);
  const character = normalizedEvidenceTamper.waveApprovals[0].assets
    .find(({ assetId }) => assetId === 'character.player');
  character.pendingGenerationRecordDigest = sha256('provider-key-normalization-evidence-tamper');
  assert.equal(
    inspectBundleLedger(normalizedEvidenceTamper).ok,
    false,
    'raw/normalized provenance changes must invalidate the one bulk Wave A authority'
  );
});

test('legacy disposition pins exact A45/B20/retire13 mapping and rejects a recomputed Wave B redirect', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forge-migration-v3-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'forge');
  await mkdir(path.join(root, 'data'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'data', 'v2'), path.join(root, 'data', 'v2'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'data', 'asset-definitions'), path.join(root, 'data', 'asset-definitions'), { recursive: true });
  await mkdir(path.join(root, 'data', 'manifests'), { recursive: true });
  for (const name of ['assets.json', 'approvals.json']) {
    await cp(
      path.join(FORGE_ROOT, 'data', 'manifests', name),
      path.join(root, 'data', 'manifests', name)
    );
  }
  await mkdir(path.join(root, 'data', 'v3'), { recursive: true });
  const freezePath = path.join(FORGE_ROOT, 'data', 'v3', 'legacy-v2-freeze.json');
  await cp(freezePath, path.join(root, 'data', 'v3', 'legacy-v2-freeze.json'));
  const freeze = JSON.parse(await readFile(freezePath, 'utf8'));
  for (const asset of freeze.assets) {
    for (const relative of [asset.approvedPath, asset.approvedMetadataPath]) {
      const destination = path.join(root, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(FORGE_ROOT, relative), destination);
    }
  }
  const canonical = await readLegacyDisposition({ root });
  assert.deepEqual(canonical.counts, {
    keep: 0, remake: 65, retire: 13, waveARemake: 45, waveBRemake: 20
  });

  const first = freeze.assets[0];
  const metadataPath = path.join(root, first.approvedMetadataPath);
  const originalMetadata = await readFile(metadataPath);
  const changedMetadata = JSON.parse(originalMetadata);
  changedMetadata.approval.note = `${changedMetadata.approval.note} tampered`;
  await writeFile(metadataPath, canonicalJson(changedMetadata));
  await assert.rejects(
    () => readLegacyDisposition({ root }),
    /changed after freeze/
  );
  await writeFile(metadataPath, originalMetadata);

  const artifactPath = path.join(root, first.approvedPath);
  const originalArtifact = await readFile(artifactPath);
  const changedArtifact = Buffer.from(originalArtifact);
  changedArtifact[changedArtifact.length - 1] ^= 1;
  await writeFile(artifactPath, changedArtifact);
  await assert.rejects(
    () => readLegacyDisposition({ root }),
    /contradicts approval|changed after freeze|PNG/i
  );
  await writeFile(artifactPath, originalArtifact);

  const changed = structuredClone(canonical);
  changed.waveBRemakes[0].successorAssetId = 'character.shopkeeper';
  delete changed.dispositionDigest;
  changed.dispositionDigest = sha256(canonicalJson(changed));
  await writeFile(path.join(root, 'data', 'v2', 'legacy-disposition.json'), canonicalJson(changed));
  await assert.rejects(
    () => readLegacyDisposition({ root }),
    /differs from the declared Fable5 migration/
  );
});

test('an unreferenced wave-bundle directory is reusable only when all 128 names and hashes match', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forge-wave-orphan-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'generated', 'v3', 'wave-bundles', PLAN_DIGEST);
  await mkdir(directory, { recursive: true });
  const artifacts = [];
  for (let index = 0; index < 128; index += 1) {
    const relativeName = `artifact-${String(index).padStart(3, '0')}.png`;
    const bytes = Buffer.from(`pending-artifact-${index}`);
    artifacts.push({ relativeName, sha256: sha256(bytes) });
    await writeFile(path.join(directory, relativeName), bytes);
  }
  assert.deepEqual(
    await verifyWaveBundleMaterialization({ planDigest: PLAN_DIGEST, artifacts }, { root: temporary }),
    { ok: true, planDigest: PLAN_DIGEST, artifactCount: 128 }
  );

  await writeFile(path.join(directory, artifacts[27].relativeName), Buffer.from('one-byte-different'));
  await assert.rejects(
    () => verifyWaveBundleMaterialization({ planDigest: PLAN_DIGEST, artifacts }, { root: temporary }),
    /hash mismatch/
  );
  await writeFile(path.join(directory, artifacts[27].relativeName), Buffer.from('pending-artifact-27'));
  await writeFile(path.join(directory, 'extra.png'), Buffer.from('extra'));
  await assert.rejects(
    () => verifyWaveBundleMaterialization({ planDigest: PLAN_DIGEST, artifacts }, { root: temporary }),
    /exact 128 planned files/
  );
});
