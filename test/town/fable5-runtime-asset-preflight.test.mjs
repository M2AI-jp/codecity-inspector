import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FABLE5_LEGACY_RUNTIME_ASSET_BASELINE,
  PRODUCTION_ASSETS
} from '../../public/fable5-v2/runtime-asset-manifest.mjs';
import { verifyFable5RuntimeAssetPreflight } from '../../tools/qa/fable5-runtime-asset-preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('every current direct runtime asset is locked to the fixed legacy baseline', async () => {
  const result = await verifyFable5RuntimeAssetPreflight({ repoRoot: REPO_ROOT });
  assert.deepEqual(result, {
    ok: true,
    errors: [],
    legacyBaselineSha256: 'd2c681cbdd16eafaa6483065c0cccc5d2867fff470727324f5d7df9165257d1d',
    productionAssetCount: Object.keys(PRODUCTION_ASSETS).length,
    approvedBindingCount: 0
  });
});

test('a new or changed direct runtime asset fails closed without a frozen-ledger binding', async () => {
  const changed = {
    ...PRODUCTION_ASSETS,
    player: { ...PRODUCTION_ASSETS.player, sha256: '0'.repeat(64) },
    unreviewed: { ...PRODUCTION_ASSETS.player, id: 'unreviewed-candidate' }
  };
  const result = await verifyFable5RuntimeAssetPreflight({
    repoRoot: REPO_ROOT,
    productionAssets: changed
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('legacy runtime contract drifted: player'));
  assert.ok(result.errors.includes('runtime contract unreviewed is neither a fixed legacy baseline asset nor a frozen-ledger binding'));
});

test('site runtime imports the asset table rather than declaring its own direct asset URLs', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'public/fable5-v2/site-runtime.mjs'), 'utf8');
  assert.match(source, /import \{ PRODUCTION_ASSETS \} from '\.\/runtime-asset-manifest\.mjs'/);
  assert.doesNotMatch(source, /export const PRODUCTION_ASSETS\s*=/);
  assert.equal(FABLE5_LEGACY_RUNTIME_ASSET_BASELINE.format, 'fable5-runtime-legacy-baseline-v1');
});
