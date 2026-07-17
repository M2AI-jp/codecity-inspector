import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CATEGORY_DIRS, FORGE_ROOT } from '../src/config.mjs';
import { canonicalJson, sha256 } from '../src/hashing.mjs';
import { createMockPng } from '../src/providers/mock-provider.mjs';
import { validateWith } from '../src/schemas.mjs';
import { readWaveADefinitions } from '../src/v2/definition-builder.mjs';
import {
  appendBundleApproval,
  emptyBundleLedger,
  inspectBundleLedger,
  prepareBundleApproval
} from '../src/v3/index.mjs';
import {
  buildV3ExportPlan,
  loadRequiredWaveDeclaration,
  runCanonicalV3Export
} from '../src/v3/export-v3.mjs';

const APPROVED_AT = '2026-07-16T00:00:00.000Z';

function categoryFor(assetId) {
  return assetId.split('.')[0];
}

function artifactRecord(assetId, role, version = 'v1', definition) {
  const category = categoryFor(assetId);
  const stem = assetId.replaceAll('.', '_');
  const suffix = `${stem}-${role}-${version}.png`;
  const bytes = createMockPng({
    assetId: `${assetId}.${role}`,
    seed: version,
    outputContract: definition?.outputSize ?? { width: 2, height: 2 }
  });
  return {
    bytes,
    record: {
      role,
      generationId: `gen_${stem}_${role}_${version}`,
      approvedPath: `generated/${CATEGORY_DIRS[category]}/approved/${suffix}`,
      sha256: sha256(bytes)
    }
  };
}

function approvalFixture(assetId, version = 'v1', definition) {
  const category = categoryFor(assetId);
  const roles = category === 'building' ? ['base', 'roof'] : ['primary'];
  const artifacts = roles.map((role) => artifactRecord(assetId, role, version, definition));
  return {
    artifacts,
    approval: prepareBundleApproval({
      assetId,
      category,
      definitionSha256: definition
        ? sha256(canonicalJson(definition))
        : sha256(`definition:${assetId}:${version}`),
      generationRecordDigest: sha256(`generation:${assetId}:${version}`),
      artifacts: artifacts.map(({ record }) => record),
      reviewer: 'human',
      note: `human fixture ${version}`,
      approvedAt: APPROVED_AT
    })
  };
}

async function fixtureRoot(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forge-v3-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'project', 'tools', 'asset-forge');
  await mkdir(path.join(root, 'data', 'v3'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'data', 'v2'), path.join(root, 'data', 'v2'), { recursive: true });
  await cp(
    path.join(FORGE_ROOT, 'data', 'v3', 'bundle-approvals.json'),
    path.join(root, 'data', 'v3', 'bundle-approvals.json')
  );
  return { root, temporary };
}

async function writeApprovalArtifacts(root, fixture) {
  for (const { bytes, record } of fixture.artifacts) {
    const target = path.join(root, record.approvedPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

async function fullMockLedgerFixture(t) {
  const { root, temporary } = await fixtureRoot(t);
  const declaration = await loadRequiredWaveDeclaration({ forgeRoot: root });
  const currentDefinitions = await readWaveADefinitions({ root });
  const currentById = new Map(currentDefinitions.map((definition) => [definition.id, definition]));
  const approvals = [];
  for (const assetId of declaration.waves.flatMap(({ assetIds }) => assetIds)) {
    const fixture = approvalFixture(assetId, 'v1', currentById.get(assetId));
    await writeApprovalArtifacts(root, fixture);
    approvals.push(fixture.approval);
  }
  const ledger = {
    schemaVersion: 3,
    requiredSetId: declaration.requiredSetId,
    approvals,
    supersessions: [],
    waveApprovals: []
  };
  await writeFile(path.join(root, 'data', 'v3', 'bundle-approvals.json'), canonicalJson(ledger));
  return { root, temporary, declaration, currentById, ledger };
}

test('bundle digest canonicalizes an ordinary artifact and an atomic building base/roof pair', () => {
  const ordinary = approvalFixture('character.player').approval;
  assert.deepEqual(ordinary.artifacts.map(({ role }) => role), ['primary']);

  const buildingFixture = approvalFixture('building.inn');
  const reversed = prepareBundleApproval({
    assetId: 'building.inn',
    category: 'building',
    definitionSha256: buildingFixture.approval.definitionSha256,
    generationRecordDigest: buildingFixture.approval.generationRecordDigest,
    artifacts: [...buildingFixture.approval.artifacts].reverse(),
    reviewer: 'human',
    note: 'human fixture v1',
    approvedAt: APPROVED_AT
  });
  assert.deepEqual(reversed.artifacts.map(({ role }) => role), ['base', 'roof']);
  assert.equal(reversed.bundleDigest, buildingFixture.approval.bundleDigest);
  assert.equal(validateWith('asset-bundle-approval.schema.json', {
    schemaVersion: 3,
    requiredSetId: 'fable5-v2',
    approvals: [ordinary, reversed],
    supersessions: [],
    waveApprovals: []
  }).ok, true);

  assert.throws(() => prepareBundleApproval({
    assetId: buildingFixture.approval.assetId,
    category: buildingFixture.approval.category,
    definitionSha256: buildingFixture.approval.definitionSha256,
    generationRecordDigest: buildingFixture.approval.generationRecordDigest,
    artifacts: buildingFixture.approval.artifacts.slice(0, 1),
    reviewer: 'human',
    note: 'human fixture v1',
    approvedAt: APPROVED_AT
  }), /atomic base and roof pair/);
});

test('bundle supersession is append-only, stale-safe, and leaves exactly one active bundle', () => {
  const first = approvalFixture('prop.crate', 'v1').approval;
  const replacement = approvalFixture('prop.crate', 'v2').approval;
  const empty = emptyBundleLedger();
  const firstLedger = appendBundleApproval(empty, first);
  const frozenFirst = JSON.stringify(firstLedger);

  assert.throws(() => appendBundleApproval(firstLedger, replacement), /Supersession request must be an object/);
  const replaced = appendBundleApproval(firstLedger, replacement, {
    supersession: {
      expectedBundleDigest: first.bundleDigest,
      reviewer: 'human',
      note: 'replace after human review',
      supersededAt: '2026-07-16T01:00:00.000Z'
    }
  });
  assert.equal(JSON.stringify(firstLedger), frozenFirst);
  assert.equal(replaced.approvals.length, 2);
  assert.equal(replaced.supersessions.length, 1);
  const inspection = inspectBundleLedger(replaced);
  assert.equal(inspection.ok, true, inspection.errors.join('\n'));
  assert.equal(inspection.activeByAsset.get('prop.crate').bundleDigest, replacement.bundleDigest);
});

test('v3 planning rejects arbitrary complete mock ledgers and caller-supplied verifier bypasses', async (t) => {
  const { root, ledger } = await fullMockLedgerFixture(t);
  let injectedVerifierCalled = false;
  await assert.rejects(
    () => buildV3ExportPlan({
      root,
      forgeRoot: root,
      ledger,
      waveIds: ['A'],
      verifyApproval: async () => {
        injectedVerifierCalled = true;
        return {};
      }
    }),
    /committed single Wave A bulk approval/
  );
  assert.equal(injectedVerifierCalled, false);

  const stale = structuredClone(ledger);
  const staleIndex = 0;
  const previous = stale.approvals[staleIndex];
  stale.approvals[staleIndex] = prepareBundleApproval({
    assetId: previous.assetId,
    category: previous.category,
    definitionSha256: sha256('stale-definition'),
    generationRecordDigest: previous.generationRecordDigest,
    artifacts: previous.artifacts,
    reviewer: previous.reviewer,
    note: previous.note,
    approvedAt: previous.approvedAt
  });
  await assert.rejects(
    () => buildV3ExportPlan({ root, forgeRoot: root, ledger: stale, waveIds: ['A'] }),
    /committed single Wave A bulk approval/
  );

  const normalizedEvidenceStale = structuredClone(ledger);
  const characterIndex = normalizedEvidenceStale.approvals
    .findIndex(({ assetId }) => assetId === 'character.player');
  const characterApproval = normalizedEvidenceStale.approvals[characterIndex];
  normalizedEvidenceStale.approvals[characterIndex] = prepareBundleApproval({
    assetId: characterApproval.assetId,
    category: characterApproval.category,
    definitionSha256: characterApproval.definitionSha256,
    generationRecordDigest: sha256('provider-key-normalization-evidence-tamper'),
    artifacts: characterApproval.artifacts,
    reviewer: characterApproval.reviewer,
    note: characterApproval.note,
    approvedAt: characterApproval.approvedAt
  });
  await assert.rejects(
    () => buildV3ExportPlan({
      root,
      forgeRoot: root,
      ledger: normalizedEvidenceStale,
      waveIds: ['A']
    }),
    /committed single Wave A bulk approval/
  );

  const incomplete = structuredClone(ledger);
  incomplete.approvals = incomplete.approvals.filter(({ assetId }) => assetId !== 'character.player');
  await assert.rejects(
    () => buildV3ExportPlan({ root, forgeRoot: root, ledger: incomplete, waveIds: ['A'] }),
    /complete declared required set/
  );
  await assert.rejects(
    () => buildV3ExportPlan({ root, forgeRoot: root, ledger, waveIds: ['B'] }),
    /only the implemented and approved Wave A/
  );
});

test('required wave declaration recomputes the ordered asset-id digest', async (t) => {
  const { root } = await fixtureRoot(t);
  const wavePath = path.join(root, 'data', 'v2', 'waves.json');
  const declaration = JSON.parse(await readFile(wavePath, 'utf8'));
  [declaration.waves[0].assetIds[0], declaration.waves[0].assetIds[1]] = [
    declaration.waves[0].assetIds[1], declaration.waves[0].assetIds[0]
  ];
  await writeFile(wavePath, JSON.stringify(declaration));
  await assert.rejects(
    () => loadRequiredWaveDeclaration({ forgeRoot: root }),
    /wave A assetIds digest mismatch/
  );

  declaration.waves[0].assetIds.reverse();
  declaration.waves = declaration.waves.slice(0, 1);
  await writeFile(wavePath, JSON.stringify(declaration));
  await assert.rejects(
    () => loadRequiredWaveDeclaration({ forgeRoot: root }),
    /exactly ordered waves A and B/
  );
});

test('only the canonical operator can write and it fails before creating output for mock provenance', async (t) => {
  const { root, temporary } = await fullMockLedgerFixture(t);
  const derivedPublic = path.join(temporary, 'project', 'public');
  const callerDestination = path.join(temporary, 'escape');
  await assert.rejects(
    () => runCanonicalV3Export({
      root,
      forgeRoot: root,
      waveIds: ['A'],
      write: true,
      publicRoot: callerDestination,
      verifyApproval: async () => ({})
    }),
    /source and destination roots are fixed/
  );
  await assert.rejects(() => access(derivedPublic), /ENOENT/);
  await assert.rejects(() => access(callerDestination), /ENOENT/);

  const exports = await import('../src/v3/export-v3.mjs');
  assert.equal(Object.hasOwn(exports, 'exportV3'), false);
  assert.equal(Object.hasOwn(exports, 'executePlan'), false);
  assert.equal(Object.hasOwn(exports, 'exportCanonicalSnapshot'), false);
});

test('the checked-in v3 ledger is canonical, empty, and does not mutate legacy v2 export surfaces', async () => {
  const checkedIn = await readFile(path.join(FORGE_ROOT, 'data', 'v3', 'bundle-approvals.json'));
  const parsed = JSON.parse(checkedIn);
  assert.deepEqual(parsed, emptyBundleLedger('fable5-v2'));
  assert.deepEqual(checkedIn, Buffer.from(canonicalJson(parsed)));
  assert.equal(validateWith('asset-bundle-approval.schema.json', parsed).ok, true);
  await assert.rejects(() => access(path.join(FORGE_ROOT, 'data', 'v2', 'bundle-approvals.json')), /ENOENT/);
});
