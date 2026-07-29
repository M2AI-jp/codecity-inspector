import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FABLE5_VISIBLE_RUNTIME_ASSET_SET_FORMAT,
  verifyFable5VisibleRuntimeAssetSet
} from '../../tools/qa/fable5-visible-runtime-asset-set.mjs';
import {
  FABLE5_APPROVED_RUNTIME_BINDINGS,
  FABLE5_INNKEEPER_RUNTIME_GATE,
  FABLE5_RETIRED_RUNTIME_BINDINGS,
  PRODUCTION_ASSETS
} from '../../public/fable5-v2/runtime-asset-manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function productionAssetsFrom(report) {
  return Object.fromEntries(
    report.observed.directProductionBindings.map(({ key, contract }) => [key, { ...contract }])
  );
}

test('the static report enumerates the bounded prefab and direct visual asset set', async () => {
  const report = await verifyFable5VisibleRuntimeAssetSet({ repoRoot: REPO_ROOT });

  assert.equal(report.format, FABLE5_VISIBLE_RUNTIME_ASSET_SET_FORMAT);
  assert.equal(report.staticOnly, true);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.observed.counts, {
    prefabDerivedAssetCount: 48,
    activePrefabDerivedAssetCount: 47,
    suppressedPrefabDerivedAssetCount: 1,
    directProductionBindingCount: 8,
    canonicalVisualAssetCount: 54
  });
  assert.equal(report.observed.prefabManifest.prefabDerivedAssets.length, 48);
  assert.equal(report.observed.directProductionBindings.length, 8);
  assert.equal(report.observed.canonicalVisualAssets.length, 54);
  assert.deepEqual(
    report.observed.runtimeAssetGates,
    [{
      key: 'bartender',
      state: 'blocked-pending-human-approved-replacement',
      runtimeInstallAllowed: false,
      approvalState: 'not-approved',
      replacementAssetId: null
    }]
  );
  assert.equal(report.observed.directProductionBindings.some(({ key }) => key === 'bartender'), false);
  assert.equal(FABLE5_INNKEEPER_RUNTIME_GATE.runtimeInstallAllowed, false);
  assert.equal(
    report.observed.prefabManifest.prefabDerivedAssets.filter(({ runtimeDisposition }) => runtimeDisposition === 'WORLD_PREFABS').length,
    45
  );
  assert.deepEqual(
    report.observed.prefabManifest.prefabDerivedAssets
      .filter(({ runtimeDisposition }) => runtimeDisposition !== 'WORLD_PREFABS')
      .map(({ assetId, runtimeDisposition }) => ({ assetId, runtimeDisposition })),
    [
      { assetId: 'target-town-inn-bartender-source-visible-v1', runtimeDisposition: 'SUPPRESSED_NOT_LOADED' },
      { assetId: 'target-town-inn-entrance-foreground-v1', runtimeDisposition: 'DIRECT_PRODUCTION_BINDING' },
      { assetId: 'target-town-route-streetlamp-foreground-v1', runtimeDisposition: 'DIRECT_PRODUCTION_BINDING' }
    ]
  );
  assert.deepEqual(report.inferred, []);
  assert.deepEqual(report.unknown.map(({ subject, state }) => ({ subject, state })), [
    { subject: 'browser-runtime-network-and-visibility', state: 'NOT_EVALUATED' }
  ]);
});

test('pending candidate dependencies are reported as UNMET without an approval claim', async () => {
  const report = await verifyFable5VisibleRuntimeAssetSet({ repoRoot: REPO_ROOT });

  assert.equal(report.ok, true);
  assert.equal(report.acceptance.state, 'UNMET');
  assert.deepEqual(
    report.acceptance.candidateDependentAssets.map(({ assetId }) => assetId),
    [
      'bld_l_town_hall.interior',
      'bld_m_house.interior',
      'bld_m_inn.interior',
      'char_player',
      'char_resident',
      'char_town_clerk'
    ]
  );
  for (const candidate of report.acceptance.candidateDependentAssets) {
    assert.equal(candidate.acceptanceState, 'UNMET');
    assert.equal(candidate.approvalState, 'NOT_APPROVED');
    assert.equal(candidate.runtimeInstallAllowed, false);
    assert.equal(candidate.runtimePath, null);
  }
});

test('the retired innkeeper 4x10 asset is absent from the visible runtime set even if a manual binding tries to restore it', async () => {
  const retiredInnkeeper = FABLE5_RETIRED_RUNTIME_BINDINGS.find(({ key }) => key === 'bartender');
  const report = await verifyFable5VisibleRuntimeAssetSet({
    repoRoot: REPO_ROOT,
    productionAssets: { ...PRODUCTION_ASSETS, bartender: retiredInnkeeper.contract },
    approvedBindings: [retiredInnkeeper]
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.includes(
    'withdrawn innkeeper 4x10 binding must not be an approved runtime binding'
  ));
  assert.ok(report.errors.includes(
    'withdrawn innkeeper runtime asset must not be present in production assets'
  ));
  assert.ok(report.errors.includes('retired innkeeper 4x10 runtime bytes must not be present under another production asset key'));
  assert.equal(report.observed.directProductionBindings.find(({ key }) => key === 'bartender')?.tracking.kind, 'WITHDRAWN_STYLE_AUTHORITY');
  assert.equal(report.observed.canonicalVisualAssets.some(({ assetId }) => assetId === retiredInnkeeper.contract.id), false);
});

test('a pending candidate assetId cannot be promoted by a manual production binding', async () => {
  const retiredInnkeeperBinding = FABLE5_RETIRED_RUNTIME_BINDINGS.find(({ key }) => key === 'bartender');
  const report = await verifyFable5VisibleRuntimeAssetSet({
    repoRoot: REPO_ROOT,
    approvedBindings: [
      ...FABLE5_APPROVED_RUNTIME_BINDINGS,
      {
        ...retiredInnkeeperBinding,
        key: 'player',
        assetId: 'char_player',
        contract: PRODUCTION_ASSETS.player
      }
    ]
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('approved runtime binding player is absent from its frozen ledger allowlist'));
  assert.ok(report.errors.includes(
    'direct production asset player is not authorized by a verified frozen ledger allowlist'
  ));
  assert.equal(
    report.observed.directProductionBindings.find(({ key }) => key === 'player')?.tracking.kind,
    'UNTRACKED'
  );
});

test('forbidden master URLs, duplicate IDs or URLs, and untracked direct assets fail closed', async () => {
  const baseline = await verifyFable5VisibleRuntimeAssetSet({ repoRoot: REPO_ROOT });
  const productionAssets = productionAssetsFrom(baseline);

  const withForbiddenMaster = await verifyFable5VisibleRuntimeAssetSet({
    repoRoot: REPO_ROOT,
    productionAssets: {
      ...productionAssets,
      player: {
        ...productionAssets.player,
        url: '/fable5-v2/assets/world/target-town-user-direct-v1.png'
      }
    }
  });
  assert.equal(withForbiddenMaster.ok, false);
  assert.ok(withForbiddenMaster.errors.includes(
    'forbidden runtime URL /fable5-v2/assets/world/target-town-user-direct-v1.png: loads the target master'
  ));
  assert.ok(withForbiddenMaster.errors.includes('untracked direct production asset player'));

  const withDuplicate = await verifyFable5VisibleRuntimeAssetSet({
    repoRoot: REPO_ROOT,
    productionAssets: {
      ...productionAssets,
      duplicatedPlayer: { ...productionAssets.player }
    }
  });
  assert.equal(withDuplicate.ok, false);
  assert.ok(withDuplicate.errors.includes(`duplicate direct production assetId ${productionAssets.player.id}`));
  assert.ok(withDuplicate.errors.includes(`duplicate direct production URL ${productionAssets.player.url}`));
  assert.ok(withDuplicate.errors.some((error) => error.startsWith(`duplicate visible runtime assetId ${productionAssets.player.id} (`)));
  assert.ok(withDuplicate.errors.some((error) => error.startsWith(`duplicate visible runtime URL ${productionAssets.player.url} (`)));

  const withUntrackedAsset = await verifyFable5VisibleRuntimeAssetSet({
    repoRoot: REPO_ROOT,
    productionAssets: {
      ...productionAssets,
      untracked: {
        ...productionAssets.player,
        id: 'untracked-visible-asset',
        url: '/fable5-v2/assets/ui/untracked-visible-asset.png'
      }
    }
  });
  assert.equal(withUntrackedAsset.ok, false);
  assert.ok(withUntrackedAsset.errors.includes('untracked direct production asset untracked'));
});
