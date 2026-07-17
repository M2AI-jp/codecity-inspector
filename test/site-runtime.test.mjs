import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  ForgeAssetError,
  FORGE_MANIFEST_URL,
  FORGE_RELEASE_TRUST,
  WAVE_A_ASSET_COUNT,
  WAVE_A_ASSET_IDS,
  characterFrame,
  collectWorldPlanAssetIds,
  createAssetResolver,
  createForgeTrustPolicy,
  fetchForgeManifest,
  loadForgeAssetImages,
  spriteFrame,
  terrainFrame,
  validateForgeManifest,
  verifyForgeManifestDigests
} from '../public/fable5-v2/site-runtime.mjs';
import { canonicalJson, sha256 } from '../tools/asset-forge/src/hashing.mjs';
import { validateWith } from '../tools/asset-forge/src/schemas.mjs';
import { readWaveADefinitions } from '../tools/asset-forge/src/v2/definition-builder.mjs';
import { readWaveAReferenceAuthorization } from '../tools/asset-forge/src/v2/reference-authorization.mjs';
import {
  artifactSetDigestFor,
  bundleDigestFor,
  cellAuditDigestFor,
  cellAuditSetDigestFor,
  evidenceCoverageDigestFor,
  inspectBundleLedger,
  waveApprovalDigestFor
} from '../tools/asset-forge/src/v3/bundle-ledger.mjs';
import { createMockPng } from '../tools/asset-forge/src/providers/mock-provider.mjs';
import {
  allowedBlueprintIdsForDefinition,
  assertWaveAVisualEvidenceBindings,
  isRepeatableDefinition
} from '../tools/asset-forge/src/v3/wave-operator.mjs';

const APPROVED_AT = '2026-07-16T10:00:00.000Z';
const NOTE = 'Formal frontend release verification fixture.';
const CATEGORY_DIR = Object.freeze({
  character: 'characters', building: 'buildings', terrain: 'terrains', overlay: 'overlays',
  structure: 'structures', interior: 'interiors', prop: 'props', ui: 'ui', effect: 'effects'
});
const hash = (value) => createHash('sha256').update(value).digest('hex');
const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const [FORMAL_DEFINITIONS, REFERENCE_AUTHORIZATION, LEGACY_DISPOSITION] = await Promise.all([
  readWaveADefinitions(),
  readWaveAReferenceAuthorization(),
  readFile(new URL('../tools/asset-forge/data/v2/legacy-disposition.json', import.meta.url), 'utf8').then(JSON.parse)
]);

function auditCounts(index) {
  const semanticCellCount = index < 54 ? 7 : 6;
  const expectedTransparentSemanticCellCount = index < 12 ? 1 : 0;
  const reservedTransparentCellCount = index < 63 ? 1 : 0;
  return {
    declaredLogicalSlotCount: semanticCellCount + reservedTransparentCellCount,
    semanticCellCount,
    expectedNonemptySemanticCellCount: semanticCellCount - expectedTransparentSemanticCellCount,
    expectedTransparentSemanticCellCount,
    reservedTransparentCellCount
  };
}

function makeCellAudit(index, assetId, roles) {
  const counts = auditCounts(index);
  const expectations = [
    ...Array.from({ length: counts.expectedNonemptySemanticCellCount }, () => 'semantic-nonempty'),
    ...Array.from({ length: counts.expectedTransparentSemanticCellCount }, () => 'semantic-transparent-autotile-mask0'),
    ...Array.from({ length: counts.reservedTransparentCellCount }, () => 'reserved-transparent')
  ];
  const roleIndexes = new Map(roles.map((role) => [role, 0]));
  const cells = expectations.map((expectation, cellIndex) => {
    const artifactRole = roles[cellIndex % roles.length];
    const roleIndex = roleIndexes.get(artifactRole);
    roleIndexes.set(artifactRole, roleIndex + 1);
    const visible = expectation === 'semantic-nonempty';
    return {
      artifactRole,
      cellIndex: roleIndex,
      frameRole: `frame_${cellIndex}`,
      expectation,
      rgbaSha256: sha256(`cell:${assetId}:${artifactRole}:${cellIndex}:${expectation}`),
      alphaPixelCount: visible ? 1 : 0,
      hiddenRgbPixelCount: 0,
      alphaBbox: visible ? { x: 0, y: 0, width: 1, height: 1 } : null
    };
  });
  const content = { ...counts, cells };
  return { ...content, cellAuditDigest: cellAuditDigestFor(content) };
}

function evidencePath(token) {
  return `review/wave-a/evidence/${token}.png`;
}

async function makeReleaseFixture() {
  assert.equal(FORMAL_DEFINITIONS.length, 109);
  const definitionById = new Map(FORMAL_DEFINITIONS.map((definition) => [definition.id, definition]));
  assert.deepEqual([...definitionById.keys()].sort(compareCodeUnits), WAVE_A_ASSET_IDS);

  const bytesByHash = new Map();
  const prepared = [...FORMAL_DEFINITIONS]
    .sort((left, right) => compareCodeUnits(left.id, right.id))
    .map((definition, index) => {
    const roles = definition.category === 'building' ? ['base', 'roof'] : ['primary'];
    const generationId = `gen_${definition.id.replaceAll('.', '_')}`;
    const generationRecordDigest = sha256(`generation:${definition.id}`);
    const artifacts = roles.map((role) => {
      const bytes = createMockPng({
        assetId: definition.id,
        seed: role,
        promptHash: sha256(`prompt:${definition.id}:${role}`),
        outputContract: definition.outputSize
      });
      const artifactSha256 = hash(bytes);
      assert.equal(bytesByHash.has(artifactSha256), false, `fixture PNG must be unique: ${definition.id}:${role}`);
      bytesByHash.set(artifactSha256, new Uint8Array(bytes));
      const fileToken = `${definition.id.replaceAll('.', '_')}.${role}.${artifactSha256.slice(0, 12)}`;
      return {
        role,
        pendingPath: `generated/${CATEGORY_DIR[definition.category]}/pending/${fileToken}.png`,
        sha256: artifactSha256
      };
    });
    const artifactSha256s = artifacts.map(({ sha256: artifactSha256 }) => artifactSha256);
    const token = definition.id.replaceAll('.', '_');
    const visualReview = {
      reviewer: 'human',
      reviewedAt: APPROVED_AT,
      native: {
        status: 'pass', path: evidencePath(`${token}.native`), sha256: sha256(`native:${definition.id}`), artifactSha256s
      },
      repeat: isRepeatableDefinition(definition)
        ? {
          status: 'pass', layout: '3x3', path: evidencePath(`${token}.repeat`),
          sha256: sha256(`repeat:${definition.id}`), artifactSha256s
        }
        : { status: 'not-applicable', reason: 'definition-is-not-repeatable', artifactSha256s },
      ensemble: []
    };
    return {
      definition,
      definitionSha256: sha256(canonicalJson(definition)),
      generationId,
      generationRecordDigest,
      artifacts,
      visualReview,
      cellAudit: makeCellAudit(index, definition.id, roles)
    };
    });

  const blueprintIds = ['old-town', 'snow', 'harbor', 'woodland', 'night', 'cutaway'];
  const blueprintCoverage = new Map(blueprintIds.map((id) => [id, []]));
  for (const entry of prepared) {
    const allowed = [...allowedBlueprintIdsForDefinition(entry.definition)];
    assert.ok(allowed.length > 0, `${entry.definition.id} needs at least one applicable blueprint`);
    for (const blueprintId of allowed) blueprintCoverage.get(blueprintId).push(entry);
  }
  const sceneBlueprints = blueprintIds.map((id) => ({
    id,
    status: 'pass',
    reviewer: 'human',
    reviewedAt: APPROVED_AT,
    path: evidencePath(`blueprint.${id}`),
    sha256: sha256(`blueprint:${id}`),
    includedAssets: blueprintCoverage.get(id).map(({ definition, artifacts }) => ({
      assetId: definition.id,
      artifactSha256s: artifacts.map(({ sha256: artifactSha256 }) => artifactSha256)
    }))
  }));
  const blueprintById = new Map(sceneBlueprints.map((blueprint) => [blueprint.id, blueprint]));
  for (const entry of prepared) {
    const artifactSha256s = entry.artifacts.map(({ sha256: artifactSha256 }) => artifactSha256);
    entry.visualReview.ensemble = [...allowedBlueprintIdsForDefinition(entry.definition)].map((blueprintId) => {
      const blueprint = blueprintById.get(blueprintId);
      return {
        status: 'pass', blueprintId, path: blueprint.path, sha256: blueprint.sha256, artifactSha256s
      };
    });
    entry.visualEvidenceDigest = sha256(canonicalJson({
      visualReview: entry.visualReview,
      sceneBlueprints: entry.visualReview.ensemble.map(({ blueprintId }) => blueprintById.get(blueprintId))
    }));
  }
  const selectionWithoutDigest = {
    schemaVersion: 3,
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    requiredAssetCount: 109,
    outputPngCount: 128,
    declaredLogicalSlotCount: 771,
    semanticCellCount: 708,
    expectedNonemptySemanticCellCount: 696,
    expectedTransparentSemanticCellCount: 12,
    reservedTransparentCellCount: 63,
    legacyDispositionDigest: LEGACY_DISPOSITION.dispositionDigest,
    sceneBlueprints,
    assets: prepared.map(({ definition, definitionSha256, generationId, generationRecordDigest, artifacts, visualReview }) => ({
      assetId: definition.id,
      generationId,
      definitionSha256,
      pendingGenerationRecordDigest: generationRecordDigest,
      artifacts,
      visualReview
    }))
  };
  const selection = {
    ...selectionWithoutDigest,
    selectionDigest: sha256(canonicalJson(selectionWithoutDigest))
  };
  assert.doesNotThrow(() => assertWaveAVisualEvidenceBindings(
    selection,
    prepared.map(({ definition }) => definition)
  ));
  const referenceAuthorizationSha256 = sha256(canonicalJson(REFERENCE_AUTHORIZATION));
  const planAssets = prepared.map(({ definition, generationId, generationRecordDigest, definitionSha256, visualEvidenceDigest, artifacts, cellAudit }) => ({
    assetId: definition.id,
    pendingGenerationId: generationId,
    pendingGenerationRecordDigest: generationRecordDigest,
    definitionSha256,
    visualEvidenceDigest,
    sourceArtifacts: artifacts.map(({ role, pendingPath, sha256: artifactSha256 }) => ({ role, pendingPath, sha256: artifactSha256 })),
    cellAudit
  }));
  const bundleLedgerBefore = sha256('bundle-ledger-before');
  const planCore = {
    schemaVersion: 3,
    contract: 'fable5-wave-a-approval-plan-v3',
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    approvedAt: APPROVED_AT,
    note: NOTE,
    selectionDigest: selection.selectionDigest,
    legacyDispositionDigest: LEGACY_DISPOSITION.dispositionDigest,
    referenceAuthorizationSha256,
    generationLedgerDigest: sha256('generation-ledger'),
    bundleLedgerBefore,
    requiredAssetCount: 109,
    outputPngCount: 128,
    declaredLogicalSlotCount: 771,
    semanticCellCount: 708,
    expectedNonemptySemanticCellCount: 696,
    expectedTransparentSemanticCellCount: 12,
    reservedTransparentCellCount: 63,
    assets: planAssets
  };
  const planDigest = sha256(canonicalJson(planCore));
  const bundleDirectory = `generated/v3/wave-bundles/${planDigest}`;
  const bundleApprovals = [];
  const approvalAssets = prepared.map((entry) => {
    const approvedArtifactsWithGeneration = entry.artifacts.map(({ role, sha256: artifactSha256 }) => ({
      role,
      generationId: entry.generationId,
      approvedPath: `${bundleDirectory}/${entry.definition.id.replaceAll('.', '_')}.${role}.${artifactSha256.slice(0, 12)}.png`,
      sha256: artifactSha256
    }));
    const bundleDigest = bundleDigestFor({
      assetId: entry.definition.id,
      category: entry.definition.category,
      definitionSha256: entry.definitionSha256,
      generationRecordDigest: entry.generationRecordDigest,
      artifacts: approvedArtifactsWithGeneration
    });
    bundleApprovals.push({
      assetId: entry.definition.id,
      category: entry.definition.category,
      definitionSha256: entry.definitionSha256,
      generationRecordDigest: entry.generationRecordDigest,
      bundleDigest,
      artifacts: approvedArtifactsWithGeneration,
      reviewer: 'human',
      note: NOTE,
      approvedAt: APPROVED_AT
    });
    return {
      assetId: entry.definition.id,
      pendingGenerationId: entry.generationId,
      pendingGenerationRecordDigest: entry.generationRecordDigest,
      definitionSha256: entry.definitionSha256,
      bundleDigest,
      visualEvidenceDigest: entry.visualEvidenceDigest,
      artifacts: approvedArtifactsWithGeneration.map(({ role, approvedPath, sha256: artifactSha256 }) => ({
        role, approvedPath, sha256: artifactSha256
      })),
      cellAudit: entry.cellAudit
    };
  });
  const approvalWithoutDigest = {
    schemaVersion: 3,
    contract: 'fable5-wave-approval-v3',
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    status: 'approved',
    reviewer: 'human',
    approvedAt: APPROVED_AT,
    note: NOTE,
    planDigest,
    selectionDigest: selection.selectionDigest,
    legacyDispositionDigest: LEGACY_DISPOSITION.dispositionDigest,
    referenceAuthorizationSha256,
    evidenceCoverageDigest: evidenceCoverageDigestFor(approvalAssets),
    cellAuditDigest: cellAuditSetDigestFor(approvalAssets),
    artifactSetDigest: artifactSetDigestFor(approvalAssets),
    requiredAssetCount: 109,
    outputPngCount: 128,
    declaredLogicalSlotCount: 771,
    semanticCellCount: 708,
    expectedNonemptySemanticCellCount: 696,
    expectedTransparentSemanticCellCount: 12,
    reservedTransparentCellCount: 63,
    bundleLedgerDigestBefore: bundleLedgerBefore,
    bundleDirectory,
    assets: approvalAssets
  };
  const approval = { ...approvalWithoutDigest, approvalDigest: waveApprovalDigestFor(approvalWithoutDigest) };
  const trustPolicy = await createForgeTrustPolicy({
    approval,
    planCore,
    selection,
    referenceAuthorization: REFERENCE_AUTHORIZATION,
    legacyMigration: LEGACY_DISPOSITION,
    bundleApprovals
  });

  const approvalById = new Map(approvalAssets.map((asset) => [asset.assetId, asset]));
  const manifestAssets = [...FORMAL_DEFINITIONS].sort((left, right) => compareCodeUnits(left.id, right.id)).map((definition) => {
    const approved = approvalById.get(definition.id);
    return {
      assetId: definition.id,
      category: definition.category,
      definitionSha256: approved.definitionSha256,
      bundleDigest: approved.bundleDigest,
      generationRecordDigest: approved.pendingGenerationRecordDigest,
      definition: structuredClone(definition),
      cellAudit: {
        declaredLogicalSlotCount: approved.cellAudit.declaredLogicalSlotCount,
        semanticCellCount: approved.cellAudit.semanticCellCount,
        expectedNonemptySemanticCellCount: approved.cellAudit.expectedNonemptySemanticCellCount,
        expectedTransparentSemanticCellCount: approved.cellAudit.expectedTransparentSemanticCellCount,
        reservedTransparentCellCount: approved.cellAudit.reservedTransparentCellCount,
        cellAuditDigest: approved.cellAudit.cellAuditDigest
      },
      artifacts: approved.artifacts.map(({ role, sha256: artifactSha256 }) => ({
        role,
        sha256: artifactSha256,
        publicPath: `/assets/forge/v3/blobs/${artifactSha256}.png`
      }))
    };
  });
  const manifest = {
    schemaVersion: 3,
    scope: 'wave-a-only-not-full-fable5-set',
    requiredSet: { id: 'fable5-v2', waveIds: ['A'], assetCount: 109, minimumOutputPngCount: 128 },
    completeForDeclaredWaves: true,
    fullFable5SetComplete: false,
    bundleSetDigest: '',
    waveAApprovalEvidence: {
      approvalDigest: approval.approvalDigest,
      planDigest: approval.planDigest,
      selectionDigest: approval.selectionDigest,
      legacyDispositionDigest: approval.legacyDispositionDigest,
      referenceAuthorizationSha256: approval.referenceAuthorizationSha256,
      evidenceCoverageDigest: approval.evidenceCoverageDigest,
      cellAuditDigest: approval.cellAuditDigest,
      artifactSetDigest: approval.artifactSetDigest,
      requiredAssetCount: 109,
      outputPngCount: 128,
      declaredLogicalSlotCount: 771,
      semanticCellCount: 708,
      expectedNonemptySemanticCellCount: 696,
      expectedTransparentSemanticCellCount: 12,
      reservedTransparentCellCount: 63
    },
    legacyMigration: { recordSha256: sha256(canonicalJson(LEGACY_DISPOSITION)), record: structuredClone(LEGACY_DISPOSITION) },
    assets: manifestAssets
  };
  manifest.bundleSetDigest = sha256(canonicalJson({
    contract: 'fable5-required-bundle-set-v3',
    requiredSetId: 'fable5-v2',
    waveIds: ['A'],
    waveAApprovalDigest: approval.approvalDigest,
    legacyDispositionDigest: LEGACY_DISPOSITION.dispositionDigest,
    bundles: manifestAssets.map(({ assetId, bundleDigest, generationRecordDigest }) => ({ assetId, bundleDigest, generationRecordDigest }))
  }));
  const ledger = {
    schemaVersion: 3,
    requiredSetId: 'fable5-v2',
    approvals: bundleApprovals,
    supersessions: [],
    waveApprovals: [approval]
  };
  return {
    manifest, trustPolicy, bytesByHash, selection, approval, planCore, ledger, bundleApprovals,
    referenceAuthorization: REFERENCE_AUTHORIZATION, legacyMigration: LEGACY_DISPOSITION
  };
}

const FIXTURE = await makeReleaseFixture();

test('formal exporter-ordered manifest passes Forge schemas and ledger semantics', async () => {
  assert.equal(FORGE_MANIFEST_URL, '/assets/forge/v3/manifest.json');
  assert.equal(WAVE_A_ASSET_IDS.length, WAVE_A_ASSET_COUNT);
  assert.deepEqual(FIXTURE.manifest.assets.map(({ assetId }) => assetId), WAVE_A_ASSET_IDS);
  assert.equal(new Set(FIXTURE.manifest.assets.flatMap(({ artifacts }) => artifacts.map(({ sha256: digest }) => digest))).size, 128);
  assert.equal(new Set(FIXTURE.manifest.assets.flatMap(({ artifacts }) => artifacts.map(({ publicPath }) => publicPath))).size, 128);
  assert.deepEqual(validateWith('wave-a-selection-v3.schema.json', FIXTURE.selection), { ok: true, errors: [] });
  assert.deepEqual(validateWith('wave-a-approval-v3.schema.json', FIXTURE.approval), { ok: true, errors: [] });
  assert.deepEqual(validateWith('game-export-v3.schema.json', FIXTURE.manifest), { ok: true, errors: [] });
  assert.doesNotThrow(() => assertWaveAVisualEvidenceBindings(
    FIXTURE.selection,
    [...FORMAL_DEFINITIONS].sort((left, right) => compareCodeUnits(left.id, right.id))
  ));
  assert.equal(inspectBundleLedger(FIXTURE.ledger).ok, true, inspectBundleLedger(FIXTURE.ledger).errors.join('\n'));
  const validation = validateForgeManifest(FIXTURE.manifest, { requiredAssetIds: ['character.player', 'terrain.grass'] });
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  await assert.doesNotReject(() => verifyForgeManifestDigests(FIXTURE.manifest, { trustPolicy: FIXTURE.trustPolicy }));
});

test('un-pinned release trust fails closed even for a structurally valid manifest', async () => {
  assert.equal(FORGE_RELEASE_TRUST.approvalDigest, null);
  await assert.rejects(() => verifyForgeManifestDigests(FIXTURE.manifest), /release trust/i);
});

test('asset order/set, definition contract, global uniqueness, and pinned legacy drift fail closed', () => {
  const cases = [];
  const swapped = structuredClone(FIXTURE.manifest);
  [swapped.assets[0], swapped.assets[1]] = [swapped.assets[1], swapped.assets[0]];
  cases.push(swapped);
  const extra = structuredClone(FIXTURE.manifest);
  extra.assets.push(structuredClone(extra.assets[0]));
  extra.requiredSet.assetCount = 110;
  cases.push(extra);
  const missingDefinitionField = structuredClone(FIXTURE.manifest);
  delete missingDefinitionField.assets[0].definition.gameMeaning;
  cases.push(missingDefinitionField);
  const duplicateArtifact = structuredClone(FIXTURE.manifest);
  duplicateArtifact.assets[1].artifacts[0].sha256 = duplicateArtifact.assets[0].artifacts[0].sha256;
  duplicateArtifact.assets[1].artifacts[0].publicPath = duplicateArtifact.assets[0].artifacts[0].publicPath;
  cases.push(duplicateArtifact);
  const legacyDrift = structuredClone(FIXTURE.manifest);
  legacyDrift.legacyMigration.record.legacyFreezeDigest = sha256('other freeze');
  cases.push(legacyDrift);
  const emptyEvidence = structuredClone(FIXTURE.manifest);
  emptyEvidence.waveAApprovalEvidence = {};
  cases.push(emptyEvidence);
  for (const manifest of cases) assert.equal(validateForgeManifest(manifest).ok, false);
});

test('every exported trust field and canonical content digest rejects tampering', async () => {
  for (const key of [
    'approvalDigest', 'planDigest', 'selectionDigest', 'referenceAuthorizationSha256',
    'evidenceCoverageDigest', 'cellAuditDigest', 'artifactSetDigest'
  ]) {
    const manifest = structuredClone(FIXTURE.manifest);
    manifest.waveAApprovalEvidence[key] = sha256(`tampered:${key}`);
    await assert.rejects(() => verifyForgeManifestDigests(manifest, { trustPolicy: FIXTURE.trustPolicy }), ForgeAssetError);
  }
  for (const mutate of [
    (manifest) => { manifest.assets[0].definition.displayName += 'x'; },
    (manifest) => { manifest.assets[0].bundleDigest = sha256('wrong bundle'); },
    (manifest) => { manifest.assets[0].generationRecordDigest = sha256('wrong generation'); },
    (manifest) => { manifest.assets[0].cellAudit.cellAuditDigest = sha256('wrong cell audit'); },
    (manifest) => {
      manifest.assets[0].artifacts[0].sha256 = sha256('wrong artifact');
      manifest.assets[0].artifacts[0].publicPath = `/assets/forge/v3/blobs/${manifest.assets[0].artifacts[0].sha256}.png`;
    },
    (manifest) => { manifest.bundleSetDigest = sha256('wrong bundle set'); },
    (manifest) => { manifest.legacyMigration.record.dispositionDigest = sha256('wrong legacy'); },
    (manifest) => { manifest.legacyMigration.recordSha256 = sha256('wrong legacy record'); }
  ]) {
    const manifest = structuredClone(FIXTURE.manifest);
    mutate(manifest);
    await assert.rejects(() => verifyForgeManifestDigests(manifest, { trustPolicy: FIXTURE.trustPolicy }), ForgeAssetError);
  }
  await assert.rejects(() => verifyForgeManifestDigests(FIXTURE.manifest, {
    trustPolicy: { ...FIXTURE.trustPolicy, assetBindingDigest: sha256('wrong asset binding') }
  }), ForgeAssetError);
});

test('selection, plan, approval, bundle, authorization, and legacy record tampering all fail trust creation', async () => {
  const base = () => ({
    selection: structuredClone(FIXTURE.selection),
    planCore: structuredClone(FIXTURE.planCore),
    approval: structuredClone(FIXTURE.approval),
    bundleApprovals: structuredClone(FIXTURE.bundleApprovals),
    referenceAuthorization: structuredClone(FIXTURE.referenceAuthorization),
    legacyMigration: structuredClone(FIXTURE.legacyMigration)
  });
  const mutations = [
    (records) => { records.selection.assets[0].visualReview.native.sha256 = sha256('changed review'); },
    (records) => { records.planCore.assets[0].visualEvidenceDigest = sha256('changed evidence'); },
    (records) => { records.approval.assets[0].cellAudit.cells[0].rgbaSha256 = sha256('changed cell'); },
    (records) => { records.bundleApprovals[0].artifacts[0].approvedPath = records.bundleApprovals[0].artifacts[0].approvedPath.replace('.png', '.changed.png'); },
    (records) => { records.referenceAuthorization.status = 'rejected'; },
    (records) => { records.legacyMigration.legacyFreezeDigest = sha256('changed freeze'); }
  ];
  for (const mutate of mutations) {
    const records = base();
    mutate(records);
    await assert.rejects(() => createForgeTrustPolicy(records), ForgeAssetError);
  }

  const reordered = base();
  for (const assets of [reordered.selection.assets, reordered.planCore.assets, reordered.approval.assets]) {
    [assets[0], assets[1]] = [assets[1], assets[0]];
  }
  const withoutDigest = (record, key) => Object.fromEntries(
    Object.entries(record).filter(([candidate]) => candidate !== key)
  );
  reordered.selection.selectionDigest = sha256(canonicalJson(withoutDigest(reordered.selection, 'selectionDigest')));
  reordered.planCore.selectionDigest = reordered.selection.selectionDigest;
  const reorderedPlanDigest = sha256(canonicalJson(reordered.planCore));
  const reorderedBundleDirectory = `generated/v3/wave-bundles/${reorderedPlanDigest}`;
  const bundleByAssetId = new Map(reordered.bundleApprovals.map((bundle) => [bundle.assetId, bundle]));
  for (const approved of reordered.approval.assets) {
    const bundle = bundleByAssetId.get(approved.assetId);
    for (const artifact of approved.artifacts) {
      artifact.approvedPath = `${reorderedBundleDirectory}/${artifact.approvedPath.split('/').at(-1)}`;
      const bundleArtifact = bundle.artifacts.find(({ role }) => role === artifact.role);
      bundleArtifact.approvedPath = artifact.approvedPath;
    }
    bundle.bundleDigest = bundleDigestFor({
      assetId: bundle.assetId,
      category: bundle.category,
      definitionSha256: bundle.definitionSha256,
      generationRecordDigest: bundle.generationRecordDigest,
      artifacts: bundle.artifacts
    });
    approved.bundleDigest = bundle.bundleDigest;
  }
  Object.assign(reordered.approval, {
    planDigest: reorderedPlanDigest,
    selectionDigest: reordered.selection.selectionDigest,
    bundleDirectory: reorderedBundleDirectory,
    evidenceCoverageDigest: evidenceCoverageDigestFor(reordered.approval.assets),
    cellAuditDigest: cellAuditSetDigestFor(reordered.approval.assets),
    artifactSetDigest: artifactSetDigestFor(reordered.approval.assets)
  });
  reordered.approval.approvalDigest = waveApprovalDigestFor(withoutDigest(reordered.approval, 'approvalDigest'));
  await assert.rejects(() => createForgeTrustPolicy(reordered), (error) => {
    assert.ok(error instanceof ForgeAssetError);
    assert.deepEqual(error.issues, [
      'selection, plan, and approval must share the exact canonical 109 asset set and release order'
    ]);
    return true;
  });
});

test('all 128 PNG bytes are checked before decode and dimensions are checked afterward', async () => {
  const decoded = [];
  const resolver = await loadForgeAssetImages({
    manifest: FIXTURE.manifest,
    trustPolicy: FIXTURE.trustPolicy,
    artifactFetcher: async (_url, { artifact }) => FIXTURE.bytesByHash.get(artifact.sha256),
    imageDecoder: async (_bytes, _url, asset, artifact) => {
      decoded.push(`${asset.assetId}:${artifact.role}`);
      const size = asset.category === 'building'
        ? asset.definition.buildingLayerContract.artifacts.find((entry) => entry.role === artifact.role).outputSize
        : asset.definition.outputSize;
      return { naturalWidth: size.width, naturalHeight: size.height };
    }
  });
  assert.equal(decoded.length, 128);
  assert.equal(resolver.imageByKey.size, 128);

  const player = FIXTURE.manifest.assets.find(({ assetId }) => assetId === 'character.player');
  const original = FIXTURE.bytesByHash.get(player.artifacts[0].sha256);
  const tampered = Uint8Array.from(original);
  tampered[tampered.length - 1] ^= 1;
  let decodeCalls = 0;
  await assert.rejects(() => loadForgeAssetImages({
    manifest: FIXTURE.manifest,
    trustPolicy: FIXTURE.trustPolicy,
    requiredAssetIds: ['character.player'],
    artifactFetcher: async () => tampered,
    imageDecoder: async () => {
      decodeCalls += 1;
      return { naturalWidth: 480, naturalHeight: 384 };
    }
  }), /SHA-256/);
  assert.equal(decodeCalls, 0);
});

test('fetch path verifies release trust and sheet helpers obey formal definitions', async () => {
  const fetched = await fetchForgeManifest({
    requiredAssetIds: ['character.player'],
    trustPolicy: FIXTURE.trustPolicy,
    fetchImpl: async () => ({ ok: true, json: async () => FIXTURE.manifest })
  });
  assert.equal(fetched, FIXTURE.manifest);
  const resolver = createAssetResolver(fetched);
  assert.equal(resolver.artifact('building.town_hall', 'roof').role, 'roof');
  const grass = resolver.definition('terrain.grass');
  assert.deepEqual(terrainFrame(grass, 'mask:15'), { tileIndex: 18, sx: 192, sy: 192, sw: 64, sh: 64 });
  const player = resolver.definition('character.player');
  assert.deepEqual(characterFrame(player, 'north', 'walk', 360), { column: 4, row: 1, sx: 192, sy: 96, sw: 48, sh: 96 });
  assert.deepEqual(spriteFrame({ outputSize: { width: 128, height: 64 }, sprites: { grid: { columns: 2, rows: 1 } } }, 1), {
    index: 1, sx: 64, sy: 0, sw: 64, sh: 64
  });
});

test('WorldPlan asset collection remains exact and isolated Fable5 v2 UI exposes hardened paths', async () => {
  assert.deepEqual(collectWorldPlanAssetIds({
    terrain: [{ assetId: 'terrain.grass' }],
    buildings: [{ assetId: 'building.town_hall', overlays: ['overlay.ivy.s'] }],
    npcs: [{ assetId: 'character.town_clerk' }],
    props: [{ assetId: 'prop.lamp' }],
    lights: [{ assetId: 'effect.window_glow' }]
  }), [
    'building.town_hall', 'character.player', 'character.town_clerk', 'effect.window_glow',
    'overlay.ivy.s', 'prop.lamp', 'terrain.grass'
  ]);
  assert.throws(() => collectWorldPlanAssetIds({ terrain: [{ assetId: '../unsafe.png' }] }), ForgeAssetError);
  const [app, world, site, html, css] = await Promise.all([
    readFile(new URL('../public/fable5-v2/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/fable5-v2/world-runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../public/fable5-v2/site-runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../public/fable5-v2/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/fable5-v2/styles.css', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(`${app}\n${world}`, /localeCompare/);
  assert.match(app, /visibleDepthEntries/);
  assert.match(html, /id="world-canvas" tabindex="0"/);
  assert.match(css, /--dialogue-size:\s*20px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(site, /128 globally unique/);
});

test('Fable5 v2 shows inspected identity before the v3 asset gate and retains it on gate failure', async () => {
  const app = await readFile(new URL('../public/fable5-v2/app.js', import.meta.url), 'utf8');
  const loadTownStart = app.indexOf('async function loadTown()');
  const loadTownEnd = app.indexOf("elements.zoomOut.addEventListener", loadTownStart);
  const loadTown = app.slice(loadTownStart, loadTownEnd);
  const showFatalStart = app.indexOf('function showFatal(');
  const showFatalEnd = app.indexOf('function assertTownPayload(', showFatalStart);
  const showFatal = app.slice(showFatalStart, showFatalEnd);

  const runtimeValidation = loadTown.indexOf('state.runtime = createWorldRuntime(payload.worldPlan)');
  const repositoryIdentity = loadTown.indexOf('elements.repositoryName.textContent = state.repositoryName');
  const habitabilityIdentity = loadTown.indexOf('elements.habitabilityBadge.textContent = habitabilityLabel(payload.habitability)');
  const manifestGate = loadTown.indexOf('const manifest = await fetchForgeManifest({ requiredAssetIds })');
  const criticalAssetGate = loadTown.indexOf('state.assets = await withDeadline(loadForgeAssetImages({');
  const interactionsEnabled = loadTown.indexOf('state.ready = true');

  for (const position of [
    runtimeValidation,
    repositoryIdentity,
    habitabilityIdentity,
    manifestGate,
    criticalAssetGate,
    interactionsEnabled
  ]) assert.notEqual(position, -1);
  assert.ok(runtimeValidation < repositoryIdentity);
  assert.ok(repositoryIdentity < manifestGate);
  assert.ok(habitabilityIdentity < manifestGate);
  assert.ok(manifestGate < criticalAssetGate);
  assert.ok(criticalAssetGate < interactionsEnabled);
  assert.match(loadTown, /catch \(error\) \{[\s\S]*showFatal\(title, error\)/);
  assert.doesNotMatch(showFatal, /repositoryName\.textContent|habitabilityBadge/);
  assert.match(showFatal, /state\.ready = false/);
  assert.match(showFatal, /elements\.actionButton\.disabled = true/);
});

test('isolated Fable5 v2 interaction code keeps five mechanics and progressive-loading UX distinct', async () => {
  const [app, html] = await Promise.all([
    readFile(new URL('../public/fable5-v2/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/fable5-v2/index.html', import.meta.url), 'utf8')
  ]);
  assert.match(app, /performLedgerInteraction/);
  assert.match(app, /kind: 'entry-tags'.*\bindex: 0/s);
  assert.match(app, /plan\.streets\.flatMap\(\(street\) => street\.edgeBindings/);
  assert.match(app, /kind: 'timed-target'.*startedAt: now.*readyAt:/s);
  assert.match(app, /drawDojoObservation/);
  assert.match(app, /cancelDojoObservation/);
  assert.match(app, /residentConversationTarget\(state\.runtime, nearby\.building, fact\)/);
  assert.match(app, /conversationActorId/);
  assert.match(app, /if \(npc\.role === 'resident' \|\| npc\.role === 'dojo-student'\) return npc\.home === state\.cutawayId;/);
  assert.match(app, /entity\.kind === 'npc' && shouldDrawNpc\(entity\.npc\)/);
  assert.match(app, /kind: 'fit-world'.*previousZoom.*previousCamera/s);
  assert.match(app, /leaveTowerOverview\(\{ record: true \}\)/);
  assert.match(app, /factId: interactionFactId|const factId = interactionFactId/);
  assert.doesNotMatch(app, /WITNESS_STEPS/);

  assert.match(app, /state\.route = \[\];\s*state\.footsteps = \[\];\s*const next = nextNodeForDirection/);
  assert.match(app, /if \(elements\.dialogue\.open && direction\)[\s\S]*state\.modalBufferedDirection = direction/);
  assert.match(app, /if \(!elements\.dialogue\.open\) updateMovement\(timestamp\)/);
  assert.match(app, /elements\.dialogue\.addEventListener\('close', finalizeDialogueClose\)/);
  assert.match(app, /asset\?\.category !== 'building'[\s\S]*structure\.survey_plot/);
  assert.match(app, /if \(buildingImageReady\(entity\.building\)\) \{\s*for \(const overlay/);
  assert.match(app, /expectedPngCount !== 128 \|\| completeAssets\.imageByKey\.size !== 128/);
  assert.match(app, /state\.assets = completeAssets;\s*state\.assetsComplete = true/);
  assert.match(html, /aria-keyshortcuts="E Enter"/);
  assert.match(html, /Tabで操作ボタンへ/);
  assert.match(html, /対応するテストとの関連が静的検査で見つかった家/);
  assert.match(html, /テストを実行したことや、成功したことを意味しません/);
  assert.match(html, /対応するテストが、この検査ではまだ見つかっていない家/);
  assert.match(html, /建物やコードの故障・失敗を意味しません/);
  assert.match(html, /建物を覆う蔦/);
  assert.match(html, /足場と覆い布/);
  assert.match(html, /存在と活動/);
  assert.doesNotMatch(html, /PLAY STOPPED|CONVERSATION|FIELD JOURNAL|>EVIDENCE</);
});
