import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FABLE5_APPROVED_ASSET_N1_N9_STATIC_PREFLIGHT_FORMAT,
  verifyFable5ApprovedAssetN1N9StaticPreflight
} from '../../tools/qa/fable5-asset-n1-n9-preflight.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER_PATH = 'tools/asset-forge/generated/fable5-runtime-ledgers/ca4cd4e4139d0b70cb9945d7b95572123e6507fceca7cf3086297ce5bb812f9c.json';

test('approved runtime ledger exposes a static mechanical N1–N9 report without claiming full visual or browser acceptance', async () => {
  const result = await verifyFable5ApprovedAssetN1N9StaticPreflight({
    repoRoot: REPO_ROOT,
    ledgerPaths: [LEDGER_PATH]
  });

  assert.equal(result.format, FABLE5_APPROVED_ASSET_N1_N9_STATIC_PREFLIGHT_FORMAT);
  assert.equal(result.staticOnly, true);
  assert.equal(result.ok, true);
  assert.equal(result.mechanicalPreflightStatus, 'PASS');
  assert.equal(result.fullN1N9Status, 'INCOMPLETE');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.ledgers, [{
    path: LEDGER_PATH,
    ledgerSha256: 'ca4cd4e4139d0b70cb9945d7b95572123e6507fceca7cf3086297ce5bb812f9c',
    runtimeReady: true,
    runtimeAssetCount: 1,
    approvedOnly: true
  }]);

  const innkeeper = result.assets[0];
  assert.equal(innkeeper.assetId, 'char_innkeeper');
  assert.equal(innkeeper.category, 'character');
  assert.equal(innkeeper.mechanicalStatus, 'PASS');
  assert.equal(innkeeper.provenance.mechanicalLedgerBinding, 'PASS');
  assert.deepEqual(
    Object.fromEntries(Object.entries(innkeeper.n1N9).map(([gate, value]) => [gate, value.status])),
    {
      N1: 'PASS', N2: 'PARTIAL', N3: 'NOT_IMPLEMENTED', N4: 'PARTIAL', N5: 'NOT_IMPLEMENTED',
      N6: 'PASS', N7: 'PASS', N8: 'NOT_IMPLEMENTED', N9: 'NOT_IMPLEMENTED'
    }
  );
  assert.ok(result.limitations.some((line) => line.includes('Human visual review')));
  assert.ok(result.limitations.some((line) => line.includes('Browser rendering')));
  assert.ok(result.limitations.some((line) => line.includes('cannot claim a full N1–N9 pass')));
});

test('a ledger that tracks pending or rejected assets is rejected before any asset can receive a mechanical result', async () => {
  const pendingLedgerPath = `tools/asset-forge/generated/fable5-runtime-ledgers/${'f'.repeat(64)}.json`;
  let inspectionCalled = false;
  const result = await verifyFable5ApprovedAssetN1N9StaticPreflight({
    repoRoot: REPO_ROOT,
    ledgerPaths: [pendingLedgerPath]
  }, {
    verifyLedger: async () => ({
      status: 'verified',
      ledgerSha256: 'f'.repeat(64),
      runtimeReady: false,
      runtimeAssetCount: 0
    }),
    loadLedger: async () => ({
      ledgerSha256: 'f'.repeat(64),
      runtimeReady: false,
      trackedAssets: [{ assetId: 'char_player', category: 'character', state: 'pending-inspection' }],
      runtimeAllowlist: [],
      stateCounts: { approved: 0, 'pending-inspection': 1, rejected: 0 }
    }),
    inspectCharacterCandidate: async () => {
      inspectionCalled = true;
      return { ok: true, checks: {} };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.mechanicalPreflightStatus, 'FAIL');
  assert.equal(result.fullN1N9Status, 'FAIL');
  assert.equal(inspectionCalled, false);
  assert.deepEqual(result.assets, []);
  assert.ok(result.errors.includes(`approved runtime ledger ${pendingLedgerPath} is not runtime-ready`));
  assert.ok(result.errors.includes(
    `approved runtime ledger ${pendingLedgerPath} contains non-approved tracked assets: char_player (pending-inspection)`
  ));
  assert.ok(result.errors.includes(
    `approved runtime ledger ${pendingLedgerPath} allowlist does not contain exactly its approved tracked assets`
  ));
});

test('a malformed or unscoped ledger path fails closed', async () => {
  const result = await verifyFable5ApprovedAssetN1N9StaticPreflight({
    repoRoot: REPO_ROOT,
    ledgerPaths: ['generated/fable5-runtime-ledgers/not-approved.json']
  });
  assert.equal(result.ok, false);
  assert.equal(result.assets.length, 0);
  assert.ok(result.errors.some((error) => error.startsWith('invalid approved runtime ledger path:')));
});
