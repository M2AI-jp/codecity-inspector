import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FABLE5_INNKEEPER_RUNTIME_GATE,
  FABLE5_LEGACY_RUNTIME_ASSET_BASELINE,
  FABLE5_RETIRED_RUNTIME_BINDINGS,
  PRODUCTION_ASSETS
} from '../../public/fable5-v2/runtime-asset-manifest.mjs';
import { verifyFable5RuntimeAssetPreflight } from '../../tools/qa/fable5-runtime-asset-preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('the active direct runtime set excludes the withdrawn innkeeper until a replacement is approved', async () => {
  const result = await verifyFable5RuntimeAssetPreflight({ repoRoot: REPO_ROOT });
  assert.deepEqual(result, {
    ok: true,
    errors: [],
    legacyBaselineSha256: 'd2c681cbdd16eafaa6483065c0cccc5d2867fff470727324f5d7df9165257d1d',
    productionAssetCount: Object.keys(PRODUCTION_ASSETS).length,
    approvedBindingCount: 0
  });
  assert.equal(Object.hasOwn(PRODUCTION_ASSETS, 'bartender'), false);
  assert.equal(
    Object.values(PRODUCTION_ASSETS).some(({ url }) => url === FABLE5_RETIRED_RUNTIME_BINDINGS[0].contract.url),
    false
  );
  assert.equal(FABLE5_INNKEEPER_RUNTIME_GATE.runtimeInstallAllowed, false);
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

test('the retired innkeeper 4x10 binding cannot be reactivated manually or as a legacy fallback', async () => {
  const retiredInnkeeper = FABLE5_RETIRED_RUNTIME_BINDINGS.find(({ key }) => key === 'bartender');
  const result = await verifyFable5RuntimeAssetPreflight({
    repoRoot: REPO_ROOT,
    productionAssets: { ...PRODUCTION_ASSETS, bartender: retiredInnkeeper.contract },
    approvedBindings: [retiredInnkeeper]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes(
    'withdrawn innkeeper 4x10 binding must not be an approved runtime binding'
  ));
  assert.ok(result.errors.includes('withdrawn innkeeper runtime asset must not be present in production assets'));
  assert.ok(result.errors.includes('retired innkeeper 4x10 runtime bytes must not be present under another production asset key'));

  const legacyFallback = await verifyFable5RuntimeAssetPreflight({
    repoRoot: REPO_ROOT,
    productionAssets: {
      ...PRODUCTION_ASSETS,
      bartender: FABLE5_LEGACY_RUNTIME_ASSET_BASELINE.assets.bartender
    }
  });
  assert.equal(legacyFallback.ok, false);
  assert.ok(legacyFallback.errors.includes('withdrawn innkeeper runtime asset must not be present in production assets'));
});

test('site runtime imports the asset table rather than declaring its own direct asset URLs', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'public/fable5-v2/site-runtime.mjs'), 'utf8');
  assert.match(source, /import \{ PRODUCTION_ASSETS \} from '\.\/runtime-asset-manifest\.mjs'/);
  assert.doesNotMatch(source, /export const PRODUCTION_ASSETS\s*=/);
  assert.equal(FABLE5_LEGACY_RUNTIME_ASSET_BASELINE.format, 'fable5-runtime-legacy-baseline-v1');
});
