import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { canonicalJson, sha256 } from '../src/hashing.mjs';
import { main } from '../src/cli.mjs';
import {
  executeBundleApprovalInternal as executeBundleApproval,
  parseV3WaveIds,
  previewBundleApprovalInternal as previewBundleApproval,
  runV3Export,
  verifyApprovedGenerationForBundle,
  verifyBundleApprovalForExport
} from '../src/v3/operator.mjs';
import {
  bundleLedgerDigest,
  readBundleLedger,
  transactBundleLedger,
  withBundleLedgerSnapshot
} from '../src/v3/persistence.mjs';
import { appendBundleApproval, prepareBundleApproval } from '../src/v3/bundle-ledger.mjs';

const NOW = '2026-07-16T02:00:00.000Z';

async function operatorRoot(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forge-v3-operator-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'project', 'tools', 'asset-forge');
  await mkdir(path.join(root, 'data', 'v3'), { recursive: true });
  await cp(
    path.join(FORGE_ROOT, 'data', 'v3', 'bundle-approvals.json'),
    path.join(root, 'data', 'v3', 'bundle-approvals.json')
  );
  return { root, temporary };
}

function artifact(assetId, role, version = 'v1') {
  const category = assetId.split('.')[0];
  const directory = {
    character: 'characters', building: 'buildings', terrain: 'terrains', overlay: 'overlays',
    structure: 'structures', interior: 'interiors', prop: 'props', ui: 'ui', effect: 'effects'
  }[category];
  const stem = assetId.replaceAll('.', '_');
  return {
    role,
    generationId: `gen_${stem}_${version}`,
    approvedPath: `generated/${directory}/approved/${stem}-${role}-${version}.png`,
    sha256: sha256(`${assetId}:${role}:${version}`)
  };
}

function approvalFixture(assetId, version = 'v1') {
  const category = assetId.split('.')[0];
  const roles = category === 'building' ? ['base', 'roof'] : ['primary'];
  return prepareBundleApproval({
    assetId,
    category,
    definitionSha256: sha256(`definition:${assetId}:${version}`),
    generationRecordDigest: sha256(`generation:${assetId}:${version}`),
    artifacts: roles.map((role) => artifact(assetId, role, version)),
    reviewer: 'human',
    note: `human ${version}`,
    approvedAt: NOW
  });
}

test('persisted v3 ledger reads canonically and transactions are atomic append-only CAS operations', async (t) => {
  const { root } = await operatorRoot(t);
  const initial = await readBundleLedger({ root });
  const initialDigest = bundleLedgerDigest(initial);
  const approval = approvalFixture('prop.crate');

  await assert.rejects(
    () => transactBundleLedger((ledger) => appendBundleApproval(ledger, approval), {
      root,
      expectedLedgerDigest: initialDigest,
      hooks: { beforeWrite: () => { throw new Error('pre-commit crash'); } }
    }),
    /pre-commit crash/
  );
  assert.deepEqual(await readBundleLedger({ root }), initial);

  const externallyCommitted = appendBundleApproval(initial, approvalFixture('ui.cursor'));
  await assert.rejects(
    () => transactBundleLedger((ledger) => appendBundleApproval(ledger, approval), {
      root,
      expectedLedgerDigest: initialDigest,
      hooks: {
        beforeWrite: async () => writeFile(
          path.join(root, 'data', 'v3', 'bundle-approvals.json'),
          canonicalJson(externallyCommitted)
        )
      }
    }),
    /changed immediately before atomic commit/
  );
  assert.deepEqual(await readBundleLedger({ root }), externallyCommitted);
  await writeFile(
    path.join(root, 'data', 'v3', 'bundle-approvals.json'),
    canonicalJson(initial)
  );

  const committed = await transactBundleLedger(
    (ledger) => appendBundleApproval(ledger, approval),
    { root, expectedLedgerDigest: initialDigest }
  );
  assert.equal(committed.ledger.approvals.length, 1);
  assert.notEqual(committed.ledgerDigest, initialDigest);
  assert.deepEqual(
    await readFile(path.join(root, 'data', 'v3', 'bundle-approvals.json'), 'utf8'),
    canonicalJson(committed.ledger)
  );
  await assert.rejects(
    () => transactBundleLedger((ledger) => ({ ...ledger, approvals: [] }), { root }),
    /cannot delete history/
  );
  await assert.rejects(
    () => transactBundleLedger((ledger) => appendBundleApproval(ledger, approvalFixture('ui.cursor')), {
      root, expectedLedgerDigest: initialDigest
    }),
    /changed after preview/
  );

  let releaseSnapshot;
  let markEntered;
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const hold = new Promise((resolve) => { releaseSnapshot = resolve; });
  const holding = withBundleLedgerSnapshot(async () => {
    markEntered();
    await hold;
  }, { root });
  await entered;
  await assert.rejects(
    () => transactBundleLedger((current) => appendBundleApproval(current, approvalFixture('ui.cursor')), { root }),
    /Concurrent writer lock is held/
  );
  releaseSnapshot();
  await holding;
});

test('persisted ledger fails closed on noncanonical bytes, malformed JSON, and symlinks', async (t) => {
  const { root: noncanonical } = await operatorRoot(t);
  const ledgerPath = path.join(noncanonical, 'data', 'v3', 'bundle-approvals.json');
  const ledger = await readBundleLedger({ root: noncanonical });
  await writeFile(ledgerPath, JSON.stringify(ledger));
  await assert.rejects(() => readBundleLedger({ root: noncanonical }), /canonical JSON/);
  await writeFile(ledgerPath, '{');
  await assert.rejects(() => readBundleLedger({ root: noncanonical }), /Malformed/);

  const { root: linked } = await operatorRoot(t);
  const linkedPath = path.join(linked, 'data', 'v3', 'bundle-approvals.json');
  const outside = path.join(linked, 'outside.json');
  await writeFile(outside, canonicalJson(ledger));
  await rm(linkedPath);
  await symlink(outside, linkedPath);
  await assert.rejects(() => readBundleLedger({ root: linked }), /Symbolic links/);
});

test('approval write cannot inject a provenance verifier or fake the interactive TTY gate', async (t) => {
  const { root } = await operatorRoot(t);
  let injectedVerifierCalled = false;
  await assert.rejects(
    () => previewBundleApproval({
      assetId: 'prop.crate', generationId: 'gen_prop_crate_v1', note: 'mock bypass'
    }, {
      root,
      forgeRoot: root,
      now: () => NOW,
      verifyApprovedGeneration: async () => {
        injectedVerifierCalled = true;
        return {};
      }
    }),
    /data\/v2|Wave A|reference/i
  );
  assert.equal(injectedVerifierCalled, false);

  const before = await readFile(path.join(root, 'data', 'v3', 'bundle-approvals.json'));
  const fakePreview = {
    status: 'ready-for-human-confirmation',
    confirmationPhrase: `APPROVE V3 BUNDLE ${sha256('fake')}`
  };
  await assert.rejects(
    () => executeBundleApproval(fakePreview, fakePreview.confirmationPhrase, {
      root,
      forgeRoot: root,
      isInteractiveHumanConfirmation: () => true,
      verifyApprovedGeneration: async () => ({})
    }),
    /interactive TTYs/
  );
  assert.deepEqual(await readFile(path.join(root, 'data', 'v3', 'bundle-approvals.json')), before);
});

test('the internal individual route rejects every canonical Wave A asset before clock or provenance work', async (t) => {
  const { root } = await operatorRoot(t);
  await cp(path.join(FORGE_ROOT, 'data', 'v2'), path.join(root, 'data', 'v2'), { recursive: true });
  let injectedClockCalled = false;
  await assert.rejects(
    () => previewBundleApproval({
      assetId: 'character.player',
      generationId: 'gen_character_player_attempt',
      note: 'must not bypass the bulk ceremony'
    }, {
      root,
      forgeRoot: root,
      now: () => {
        injectedClockCalled = true;
        return NOW;
      }
    }),
    /Individual bundle approval is disabled for Wave A/
  );
  assert.equal(injectedClockCalled, false);
});

test('export provenance verifier has no mock dependency override', async () => {
  const approval = approvalFixture('prop.crate');
  let injectedVerifierCalled = false;
  await assert.rejects(
    () => verifyBundleApprovalForExport(approval, {
      verifyApprovedGeneration: async () => {
        injectedVerifierCalled = true;
        return {};
      }
    }),
    /Wave A reference authorization|not production-ready|Unknown generation result/i
  );
  assert.equal(injectedVerifierCalled, false);
});

test('default verification fails closed on stale reference authorization or a legacy generation', async (t) => {
  const { root } = await operatorRoot(t);
  await cp(path.join(FORGE_ROOT, 'data', 'v2'), path.join(root, 'data', 'v2'), { recursive: true });
  await mkdir(path.join(root, 'data', 'manifests'), { recursive: true });
  await cp(
    path.join(FORGE_ROOT, 'data', 'manifests', 'references.json'),
    path.join(root, 'data', 'manifests', 'references.json')
  );
  await cp(path.join(FORGE_ROOT, 'references'), path.join(root, 'references'), { recursive: true });
  await mkdir(path.join(root, 'review'), { recursive: true });

  const authorizationPath = path.join(root, 'data', 'v2', 'reference-authorization-wave-a.json');
  const authorization = JSON.parse(await readFile(authorizationPath, 'utf8'));
  const review = {
    schemaVersion: 1,
    reviewType: 'fable5-wave-reference-rights',
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    status: 'pass',
    reviewer: 'independent-read-only',
    reviewedAt: NOW,
    ownerAuthorizationSha256: sha256(canonicalJson(authorization.ownerAuthorization)),
    assetReferenceMapSha256: authorization.assetReferenceMapSha256,
    authorizedReferenceIds: authorization.allowedReferenceIds,
    forbiddenReferenceIds: authorization.forbiddenReferenceIds,
    observed: ['test fixture reproduces the exact checked-in Wave A mapping digest'],
    limitations: ['test fixture is not a project approval']
  };
  const reviewBytes = Buffer.from(canonicalJson(review));
  await writeFile(path.join(root, 'review', 'reference-review.json'), reviewBytes);
  authorization.status = 'approved';
  authorization.independentReview = {
    status: 'pass',
    reviewPath: 'review/reference-review.json',
    reviewSha256: sha256(reviewBytes),
    reviewedAt: NOW
  };
  await writeFile(authorizationPath, canonicalJson(authorization));

  const trackedAssets = JSON.parse(await readFile(
    path.join(FORGE_ROOT, 'data', 'manifests', 'assets.json'), 'utf8'
  ));
  const player = trackedAssets.assets.find(({ assetId }) => assetId === 'character.player');
  assert.ok(player?.approvedPath);
  const legacy = JSON.parse(await readFile(
    path.join(FORGE_ROOT, player.approvedPath.replace(/\.png$/, '.json')), 'utf8'
  ));
  assert.equal(legacy.assetId, 'character.player');
  assert.equal(legacy.requiredSetId, undefined);
  await mkdir(path.join(root, 'data', 'local'), { recursive: true });
  await writeFile(path.join(root, 'data', 'local', 'generations.json'), canonicalJson({
    schemaVersion: 1, tracked: false, results: [legacy]
  }));
  await assert.rejects(
    () => verifyApprovedGenerationForBundle({
      assetId: 'character.player', generationId: legacy.id
    }, { root, forgeRoot: root }),
    /authorization.*stale|stale or is not bound to the current Fable5 Wave A definition/i
  );
});

test('CLI exposes human-only approval and a fixed-destination complete-wave export only', async (t) => {
  const help = await main(['help']);
  assert.match(help.phase, /does not generate or approve Wave A assets/);
  assert.ok(help.commands.includes('make-job-v2 --asset <wave-a-asset-id> [--seed <seed>]'));
  assert.ok(help.commands.some((line) => line.startsWith('approve-wave-a --note')));
  assert.ok(help.commands.every((line) => !line.includes('approve-bundle')));
  assert.match(help.authority, /no per-asset approval command/);
  await assert.rejects(() => main(['help', '--write']), /does not accept option/);

  const packageJson = JSON.parse(await readFile(path.join(FORGE_ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.help, 'node src/cli.mjs help');
  assert.equal(packageJson.scripts['make-job-v2'], 'node src/cli.mjs make-job-v2');
  assert.equal(packageJson.scripts['import-v2'], 'node src/cli.mjs import-v2');
  assert.equal(packageJson.scripts['list-v2'], 'node src/cli.mjs list-v2');
  assert.equal(packageJson.scripts['approve-wave-a'], 'node src/cli.mjs approve-wave-a');
  assert.equal(Object.hasOwn(packageJson.scripts, 'approve-bundle'), false);

  assert.deepEqual(parseV3WaveIds('A'), ['A']);
  assert.throws(() => parseV3WaveIds('A,B'), /Wave B approval and export are not implemented/);
  assert.throws(() => parseV3WaveIds('B'), /Wave B approval and export are not implemented/);
  await assert.rejects(
    () => main(['approve-wave-a', '--note', 'x', '--write']),
    /does not accept option/
  );
  await assert.rejects(
    () => main(['approve-wave-a', '--note', 'x']),
    /interactive TTYs/
  );
  await assert.rejects(
    () => main(['approve-bundle', '--asset', 'prop.crate']),
    /Unknown command/
  );
  await assert.rejects(
    () => main(['export-v3', '--waves', 'A', '--public-root', '/tmp/escape']),
    /does not accept option/
  );
  await assert.rejects(() => main(['export-v3', '--waves', 'B']), /Wave B approval and export are not implemented/);

  const { root, temporary } = await operatorRoot(t);
  await cp(path.join(FORGE_ROOT, 'data', 'v2'), path.join(root, 'data', 'v2'), { recursive: true });
  const callerPublic = path.join(temporary, 'escape');
  await assert.rejects(
    () => runV3Export({
      waveIds: ['A'], write: false, publicRoot: callerPublic, verifyApproval: async () => ({})
    }, { root, forgeRoot: root }),
    /roots and destinations are fixed/
  );
  await assert.rejects(() => access(callerPublic), /ENOENT/);
});
