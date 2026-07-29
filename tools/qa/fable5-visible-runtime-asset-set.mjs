import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FABLE5_APPROVED_RUNTIME_BINDINGS,
  FABLE5_INNKEEPER_RUNTIME_GATE,
  FABLE5_LEGACY_RUNTIME_ASSET_BASELINE,
  FABLE5_RETIRED_RUNTIME_BINDINGS,
  PRODUCTION_ASSETS
} from '../../public/fable5-v2/runtime-asset-manifest.mjs';
import { WORLD_PREFABS } from '../../public/fable5-v2/site-runtime.mjs';
import { verifyFable5RuntimeAssetLedger } from '../asset-forge/src/fable5-runtime-asset-ledger.mjs';

export const FABLE5_VISIBLE_RUNTIME_ASSET_SET_FORMAT = 'fable5-visible-runtime-asset-set-v1';
export const FABLE5_VISIBLE_RUNTIME_PREFAB_COUNT = 48;
export const FABLE5_VISIBLE_RUNTIME_PREFAB_MANIFEST_PATH = 'public/fable5-v2/assets/prefabs/manifest.json';
export const FABLE5_PENDING_RUNTIME_INVENTORY_PATH = 'tools/asset-forge/review/fable5-runtime-assets/fable5-pending-runtime-assets-20260722.json';

const FROZEN_LEDGER_PATH = /^tools\/asset-forge\/generated\/fable5-runtime-ledgers\/([a-f0-9]{64})\.json$/;
const ASSET_ID = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;

// These are the only manifest records that do not appear directly in
// WORLD_PREFABS. The first two retain their existing state-specific direct
// runtime bindings; the baked bartender crop is deliberately not fetched.
// Keeping this list finite makes a new omission or alias a review event.
const SPECIAL_PREFAB_RUNTIME_DISPOSITIONS = Object.freeze([
  Object.freeze({
    assetId: 'target-town-route-streetlamp-foreground-v1',
    directProductionKey: 'routeStreetlamp',
    disposition: 'DIRECT_PRODUCTION_BINDING'
  }),
  Object.freeze({
    assetId: 'target-town-inn-entrance-foreground-v1',
    directProductionKey: 'entranceForeground',
    disposition: 'DIRECT_PRODUCTION_BINDING'
  }),
  Object.freeze({
    assetId: 'target-town-inn-bartender-source-visible-v1',
    directProductionKey: null,
    disposition: 'SUPPRESSED_NOT_LOADED'
  })
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  }
  return value;
}

function runtimeUrlFor(publicPath) {
  return typeof publicPath === 'string' && publicPath.startsWith('public/')
    ? `/${publicPath.slice('public/'.length)}`
    : null;
}

function compareByAssetId(left, right) {
  return left.assetId.localeCompare(right.assetId);
}

function compareByRuntimeId(left, right) {
  return String(left?.id).localeCompare(String(right?.id));
}

function compareByKey(left, right) {
  return left.key.localeCompare(right.key);
}

function pushError(errors, message) {
  errors.push(message);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function readObjectEntries(value, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    pushError(errors, `${label} must be an object`);
    return [];
  }
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function readArray(value, label, errors) {
  if (!Array.isArray(value)) {
    pushError(errors, `${label} must be an array`);
    return [];
  }
  return value;
}

function directContractFor(binding) {
  return {
    id: binding.id,
    url: binding.url,
    width: binding.width,
    height: binding.height,
    bytes: binding.bytes,
    sha256: binding.sha256,
    role: binding.role
  };
}

function prefabContractFor(record) {
  return {
    id: record.assetId,
    url: runtimeUrlFor(record.path),
    width: record.dimensions?.width,
    height: record.dimensions?.height,
    sha256: record.sha256
  };
}

function sameRuntimeIdentity(left, right) {
  return left.id === right.id
    && left.url === right.url
    && left.width === right.width
    && left.height === right.height
    && left.sha256 === right.sha256;
}

function forbiddenRuntimeUrl(url, masterRuntimeUrl) {
  if (url === masterRuntimeUrl) return 'loads the target master';
  if (typeof url !== 'string') return null;
  const normalized = url.toLowerCase();
  if (!normalized.startsWith('/fable5-v2/assets/')) return 'is outside /fable5-v2/assets/';
  if (normalized.includes('/assets/world/') && /(?:master|target|mask)/.test(normalized)) {
    return 'loads a forbidden world master/target/mask asset';
  }
  if (/(?:^|\/)(?:master|target-town-user-direct|mask)[^/]*\.png$/.test(normalized)) {
    return 'loads a forbidden master/target/mask asset';
  }
  return null;
}

function createBindingMap(approvedBindings, errors) {
  const bindings = new Map();
  for (const binding of readArray(approvedBindings, 'approved runtime bindings', errors)) {
    if (!binding || typeof binding !== 'object' || typeof binding.key !== 'string' || binding.key.length === 0) {
      pushError(errors, 'approved runtime binding has no non-empty key');
      continue;
    }
    if (bindings.has(binding.key)) {
      pushError(errors, `approved runtime bindings repeat key ${binding.key}`);
      continue;
    }
    bindings.set(binding.key, binding);
  }
  return bindings;
}

function validateWithdrawnInnkeeperGate({
  gate,
  retiredBindings,
  productionAssets,
  approvedBindingsByKey,
  errors
}) {
  const key = 'bartender';
  const authorityMatches = gate?.authority?.sourcePath === 'art/references/user-provided/character_style_authority_20260722_v1.png'
    && gate.authority?.sha256 === '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932';
  const common = gate?.format === 'fable5-innkeeper-runtime-gate-v1'
    && gate.key === key
    && authorityMatches
    && typeof gate.availabilityReason === 'string'
    && gate.availabilityReason.length > 0;
  const blocked = common
    && gate.state === 'blocked-pending-human-approved-replacement'
    && gate.runtimeInstallAllowed === false
    && gate.approval?.state === 'not-approved'
    && gate.approval?.replacementAssetId === null;
  const approved = common
    && gate.state === 'available'
    && gate.runtimeInstallAllowed === true
    && gate.approval?.state === 'approved'
    && typeof gate.approval?.replacementAssetId === 'string'
    && gate.approval.replacementAssetId.length > 0;
  if (!blocked && !approved) {
    pushError(errors, 'innkeeper runtime gate must remain blocked until a replacement under the exact new style authority receives explicit human approval');
  }

  const retired = Array.isArray(retiredBindings)
    ? retiredBindings.filter((binding) => binding?.key === key)
    : [];
  if (retired.length !== 1 || !retired[0]?.contract) {
    pushError(errors, 'withdrawn innkeeper 4x10 binding must remain archived with its provenance');
  }
  if (blocked && approvedBindingsByKey.has(key)) {
    pushError(errors, 'withdrawn innkeeper 4x10 binding must not be an approved runtime binding');
  }
  if (blocked && Object.hasOwn(productionAssets ?? {}, key)) {
    pushError(errors, 'withdrawn innkeeper runtime asset must not be present in production assets');
  }
  const retiredContract = retired[0]?.contract ?? null;
  if (retiredContract && Object.values(productionAssets ?? {}).some((contract) => sameJson(contract, retiredContract))) {
    pushError(errors, 'retired innkeeper 4x10 runtime bytes must not be present under another production asset key');
  }
  if (approved && approvedBindingsByKey.get(key)?.assetId !== gate.approval.replacementAssetId) {
    pushError(errors, 'approved innkeeper replacement must match the explicitly human-approved replacement assetId');
  }
  return Object.freeze({ withdrawnKeys: new Set(approved ? [] : [key]), retiredContract });
}

function frozenLedgerPathFor(binding) {
  const match = FROZEN_LEDGER_PATH.exec(binding?.ledgerPath ?? '');
  if (!match || match[1] !== binding?.ledgerSha256) return null;
  return binding.ledgerPath.slice('tools/asset-forge/'.length);
}

async function createFrozenLedgerAllowlist({
  repoRoot,
  approvedBindingsByKey,
  errors,
  verifyRuntimeLedger
}) {
  const allowlistByKey = new Map();
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) return allowlistByKey;

  const forgeRoot = path.join(repoRoot, 'tools', 'asset-forge');
  for (const [key, binding] of [...approvedBindingsByKey.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!ASSET_ID.test(binding?.assetId ?? '')) {
      pushError(errors, `approved runtime binding ${key} has an invalid assetId`);
      continue;
    }
    const ledgerPath = frozenLedgerPathFor(binding);
    if (!ledgerPath) {
      pushError(errors, `approved runtime binding ${key} must name a content-addressed frozen ledger with its declared SHA-256`);
      continue;
    }

    try {
      const verified = await verifyRuntimeLedger(
        { ledgerPath },
        { forgeRoot, projectRoot: repoRoot }
      );
      if (!verified.runtimeReady || verified.ledgerSha256 !== binding.ledgerSha256) {
        pushError(errors, `approved runtime binding ${key} does not name a runtime-ready frozen ledger`);
        continue;
      }
      const ledger = await readJson(path.join(repoRoot, binding.ledgerPath), `approved runtime binding ${key} ledger`, errors);
      const matches = Array.isArray(ledger?.runtimeAllowlist)
        ? ledger.runtimeAllowlist.filter((entry) => entry?.assetId === binding.assetId)
        : [];
      if (matches.length !== 1) {
        pushError(errors, `approved runtime binding ${key} is absent from its frozen ledger allowlist`);
        continue;
      }
      const entry = matches[0];
      const runtimePath = entry.runtime?.path;
      const runtimeSha256 = entry.runtime?.sha256;
      const runtimeUrl = runtimeUrlFor(runtimePath);
      if (typeof entry.category !== 'string' || !runtimeUrl || typeof runtimeSha256 !== 'string') {
        pushError(errors, `approved runtime binding ${key} has an invalid frozen ledger allowlist entry`);
        continue;
      }
      allowlistByKey.set(key, Object.freeze({
        assetId: binding.assetId,
        category: entry.category,
        ledgerPath: binding.ledgerPath,
        ledgerSha256: binding.ledgerSha256,
        runtimePath,
        runtimeUrl,
        runtimeSha256
      }));
    } catch (error) {
      pushError(errors, `approved runtime binding ${key} ledger verification failed: ${error.message}`);
    }
  }
  return allowlistByKey;
}

function directBindingState(key, contract, legacyAssets, approvedBindingsByKey, frozenLedgerAllowlistByKey, errors) {
  const approvedBinding = approvedBindingsByKey.get(key);
  if (approvedBinding) {
    if (!sameJson(contract, approvedBinding.contract)) {
      pushError(errors, `direct production asset ${key} does not equal its declared frozen-ledger binding`);
      return Object.freeze({ kind: 'UNTRACKED' });
    }
    const ledgerEntry = frozenLedgerAllowlistByKey.get(key);
    if (!ledgerEntry) {
      pushError(errors, `direct production asset ${key} is not authorized by a verified frozen ledger allowlist`);
      return Object.freeze({ kind: 'UNTRACKED' });
    }
    if (contract.url !== ledgerEntry.runtimeUrl || contract.sha256 !== ledgerEntry.runtimeSha256) {
      pushError(errors, `direct production asset ${key} does not match its frozen ledger allowlist bytes`);
      return Object.freeze({ kind: 'UNTRACKED' });
    }
    return Object.freeze({
      kind: 'VERIFIED_FROZEN_LEDGER_ALLOWLIST',
      assetId: ledgerEntry.assetId,
      category: ledgerEntry.category,
      ledgerPath: ledgerEntry.ledgerPath,
      ledgerSha256: ledgerEntry.ledgerSha256,
      runtimePath: ledgerEntry.runtimePath
    });
  }

  if (Object.hasOwn(legacyAssets, key) && sameJson(contract, legacyAssets[key])) {
    return Object.freeze({ kind: 'LEGACY_BASELINE' });
  }

  pushError(errors, `untracked direct production asset ${key}`);
  return Object.freeze({ kind: 'UNTRACKED' });
}

function reportCandidateDependentAssets(inventory, errors) {
  if (inventory?.format !== 'fable5-runtime-asset-inventory-v1') {
    pushError(errors, 'pending runtime inventory has an invalid format');
    return [];
  }

  const entries = readArray(inventory.assets, 'pending runtime inventory assets', errors);
  const byAssetId = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.assetId !== 'string' || entry.assetId.length === 0) {
      pushError(errors, 'pending runtime inventory has an asset without a non-empty assetId');
      continue;
    }
    if (byAssetId.has(entry.assetId)) {
      pushError(errors, `pending runtime inventory repeats assetId ${entry.assetId}`);
      continue;
    }
    byAssetId.set(entry.assetId, entry);
  }

  return [...byAssetId.values()]
    .sort(compareByAssetId)
    .map((entry) => {
      const isPending = entry.state === 'pending-inspection'
        && entry.runtimePath === null
        && entry.approvalRecordPath === null;
      if (!isPending) {
        pushError(errors, `candidate-dependent asset ${entry.assetId} must remain pending with no runtime or approval path`);
      }
      return Object.freeze({
        assetId: entry.assetId,
        category: entry.category,
        inventoryState: entry.state,
        acceptanceState: 'UNMET',
        approvalState: 'NOT_APPROVED',
        runtimeInstallAllowed: false,
        runtimePath: entry.runtimePath,
        reason: 'Pending candidate evidence is not a runtime approval or installation record.'
      });
    });
}

async function readJson(absolutePath, label, errors) {
  try {
    return JSON.parse(await readFile(absolutePath, 'utf8'));
  } catch (error) {
    pushError(errors, `${label} could not be read as JSON: ${error.message}`);
    return null;
  }
}

/**
 * Build a deterministic, static inventory of the Fable5 visual runtime set.
 * This checks only declared module/manifest/ledger inputs; it does not start a
 * server, execute browser code, capture a network trace, or infer visibility
 * from a renderer run.
 */
export async function verifyFable5VisibleRuntimeAssetSet({
  repoRoot,
  prefabManifestPath = FABLE5_VISIBLE_RUNTIME_PREFAB_MANIFEST_PATH,
  pendingRuntimeInventoryPath = FABLE5_PENDING_RUNTIME_INVENTORY_PATH,
  prefabManifest,
  pendingRuntimeInventory,
  worldPrefabs = WORLD_PREFABS,
  productionAssets = PRODUCTION_ASSETS,
  legacyBaseline = FABLE5_LEGACY_RUNTIME_ASSET_BASELINE,
  approvedBindings = FABLE5_APPROVED_RUNTIME_BINDINGS,
  innkeeperRuntimeGate = FABLE5_INNKEEPER_RUNTIME_GATE,
  retiredBindings = FABLE5_RETIRED_RUNTIME_BINDINGS,
  verifyRuntimeLedger = verifyFable5RuntimeAssetLedger
} = {}) {
  const errors = [];
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    pushError(errors, 'repoRoot must be an absolute path');
  }

  const manifest = prefabManifest ?? await readJson(
    path.join(repoRoot ?? '', prefabManifestPath),
    'prefab manifest',
    errors
  );
  const pendingInventory = pendingRuntimeInventory ?? await readJson(
    path.join(repoRoot ?? '', pendingRuntimeInventoryPath),
    'pending runtime inventory',
    errors
  );

  const manifestPrefabs = readArray(manifest?.prefabs, 'prefab manifest prefabs', errors);
  if (manifest?.prefabCountTotal !== FABLE5_VISIBLE_RUNTIME_PREFAB_COUNT || manifestPrefabs.length !== FABLE5_VISIBLE_RUNTIME_PREFAB_COUNT) {
    pushError(errors, `prefab manifest must contain exactly ${FABLE5_VISIBLE_RUNTIME_PREFAB_COUNT} identities`);
  }
  if (manifest?.source?.path !== 'public/fable5-v2/assets/world/target-town-user-direct-v1.png') {
    pushError(errors, 'prefab manifest must name the bounded target master source');
  }
  const masterRuntimeUrl = runtimeUrlFor(manifest?.source?.path);

  const approvedBindingsByKey = createBindingMap(approvedBindings, errors);
  const innkeeperGate = validateWithdrawnInnkeeperGate({
    gate: innkeeperRuntimeGate,
    retiredBindings,
    productionAssets,
    approvedBindingsByKey,
    errors
  });
  const legacyAssets = legacyBaseline?.assets;
  if (!legacyAssets || typeof legacyAssets !== 'object' || Array.isArray(legacyAssets)) {
    pushError(errors, 'legacy runtime baseline assets must be an object');
  }
  const safeLegacyAssets = legacyAssets && typeof legacyAssets === 'object' && !Array.isArray(legacyAssets)
    ? legacyAssets
    : {};
  const frozenLedgerAllowlistByKey = await createFrozenLedgerAllowlist({
    repoRoot,
    approvedBindingsByKey,
    errors,
    verifyRuntimeLedger
  });

  const specialByAssetId = new Map();
  for (const special of SPECIAL_PREFAB_RUNTIME_DISPOSITIONS) {
    specialByAssetId.set(special.assetId, special);
  }

  const manifestByAssetId = new Map();
  const manifestByUrl = new Map();
  for (const record of [...manifestPrefabs].sort((left, right) => String(left?.assetId).localeCompare(String(right?.assetId)))) {
    if (!record || typeof record !== 'object' || typeof record.assetId !== 'string' || record.assetId.length === 0) {
      pushError(errors, 'prefab manifest has a record without a non-empty assetId');
      continue;
    }
    const contract = prefabContractFor(record);
    if (!contract.url || !Number.isFinite(contract.width) || !Number.isFinite(contract.height)
      || typeof contract.sha256 !== 'string') {
      pushError(errors, `prefab manifest record ${record.assetId} has an invalid runtime contract`);
    }
    if (manifestByAssetId.has(record.assetId)) {
      pushError(errors, `duplicate prefab assetId ${record.assetId}`);
      continue;
    }
    if (manifestByUrl.has(contract.url)) {
      pushError(errors, `duplicate prefab runtime URL ${contract.url}`);
      continue;
    }
    manifestByAssetId.set(record.assetId, record);
    manifestByUrl.set(contract.url, record);
  }

  const worldPrefabByAssetId = new Map();
  const worldPrefabByUrl = new Map();
  for (const prefab of [...readArray(worldPrefabs, 'WORLD_PREFABS', errors)].sort(compareByRuntimeId)) {
    if (!prefab || typeof prefab !== 'object' || typeof prefab.id !== 'string' || prefab.id.length === 0) {
      pushError(errors, 'WORLD_PREFABS has a record without a non-empty id');
      continue;
    }
    if (worldPrefabByAssetId.has(prefab.id)) {
      pushError(errors, `duplicate runtime prefab assetId ${prefab.id}`);
      continue;
    }
    if (worldPrefabByUrl.has(prefab.url)) {
      pushError(errors, `duplicate runtime prefab URL ${prefab.url}`);
      continue;
    }
    worldPrefabByAssetId.set(prefab.id, prefab);
    worldPrefabByUrl.set(prefab.url, prefab);
  }

  const directBindings = [];
  const directByAssetId = new Map();
  const directByUrl = new Map();
  for (const [key, contract] of readObjectEntries(productionAssets, 'production assets', errors)) {
    const normalized = directContractFor(contract ?? {});
    const withdrawnInnkeeperAsset = innkeeperGate.withdrawnKeys.has(key)
      || (innkeeperGate.retiredContract && sameJson(contract, innkeeperGate.retiredContract));
    if (innkeeperGate.withdrawnKeys.has(key)) {
      pushError(errors, 'withdrawn innkeeper runtime asset must not be present in production assets');
    }
    if (innkeeperGate.retiredContract && sameJson(contract, innkeeperGate.retiredContract)) {
      pushError(errors, 'retired innkeeper 4x10 runtime bytes must not be present under another production asset key');
    }
    if (typeof normalized.id !== 'string' || normalized.id.length === 0 || typeof normalized.url !== 'string' || normalized.url.length === 0
      || !Number.isFinite(normalized.width) || !Number.isFinite(normalized.height)
      || !Number.isFinite(normalized.bytes) || typeof normalized.sha256 !== 'string') {
      pushError(errors, `direct production asset ${key} has an invalid runtime contract`);
    }
    if (directByAssetId.has(normalized.id)) {
      pushError(errors, `duplicate direct production assetId ${normalized.id}`);
    } else {
      directByAssetId.set(normalized.id, key);
    }
    if (directByUrl.has(normalized.url)) {
      pushError(errors, `duplicate direct production URL ${normalized.url}`);
    } else {
      directByUrl.set(normalized.url, key);
    }
    directBindings.push(Object.freeze({
      key,
      contract: Object.freeze(normalized),
      tracking: withdrawnInnkeeperAsset
        ? Object.freeze({ kind: 'WITHDRAWN_STYLE_AUTHORITY' })
        : directBindingState(
          key,
          contract,
          safeLegacyAssets,
          approvedBindingsByKey,
          frozenLedgerAllowlistByKey,
          errors
        )
    }));
  }
  directBindings.sort(compareByKey);
  const directByKey = new Map(directBindings.map((binding) => [binding.key, binding]));

  for (const key of Object.keys(safeLegacyAssets).sort()) {
    if (innkeeperGate.withdrawnKeys.has(key)) continue;
    if (!directByKey.has(key)) pushError(errors, `legacy direct production asset ${key} disappeared`);
  }
  for (const key of [...approvedBindingsByKey.keys()].sort()) {
    if (innkeeperGate.withdrawnKeys.has(key)) continue;
    if (!directByKey.has(key)) pushError(errors, `declared frozen-ledger binding ${key} has no direct production asset`);
  }

  const canonicalAssets = [];
  const canonicalByAssetId = new Map();
  const canonicalByUrl = new Map();
  function registerCanonical(asset, source) {
    if (canonicalByAssetId.has(asset.assetId)) {
      pushError(errors, `duplicate visible runtime assetId ${asset.assetId} (${source})`);
      return false;
    }
    if (canonicalByUrl.has(asset.url)) {
      pushError(errors, `duplicate visible runtime URL ${asset.url} (${source})`);
      return false;
    }
    canonicalByAssetId.set(asset.assetId, asset);
    canonicalByUrl.set(asset.url, asset);
    canonicalAssets.push(asset);
    return true;
  }

  const prefabAssets = [];
  for (const record of [...manifestByAssetId.values()].sort((left, right) => left.assetId.localeCompare(right.assetId))) {
    const contract = prefabContractFor(record);
    const runtimePrefab = worldPrefabByAssetId.get(record.assetId);
    const special = specialByAssetId.get(record.assetId);
    let runtimeDisposition;
    let directProductionKeys = [];
    if (runtimePrefab) {
      if (record.provenance !== 'this-manifest') {
        pushError(errors, `runtime prefab ${record.assetId} must be this-manifest provenance`);
      }
      if (!sameRuntimeIdentity(contract, { ...runtimePrefab, id: runtimePrefab.id })) {
        pushError(errors, `runtime prefab ${record.assetId} does not match its manifest contract`);
      }
      if (special) pushError(errors, `special prefab ${record.assetId} must not also appear in WORLD_PREFABS`);
      runtimeDisposition = 'WORLD_PREFABS';
    } else if (special) {
      if (record.provenance !== 'pre-existing') {
        pushError(errors, `special prefab ${record.assetId} must retain pre-existing provenance`);
      }
      runtimeDisposition = special.disposition;
      if (special.directProductionKey) {
        const direct = directByKey.get(special.directProductionKey);
        if (!direct) {
          pushError(errors, `special prefab ${record.assetId} is missing direct production binding ${special.directProductionKey}`);
        } else if (!sameRuntimeIdentity(contract, direct.contract)) {
          pushError(errors, `special prefab ${record.assetId} does not exactly match direct production binding ${special.directProductionKey}`);
        } else {
          directProductionKeys = [special.directProductionKey];
        }
      }
    } else {
      pushError(errors, `prefab manifest asset ${record.assetId} has no bounded runtime disposition`);
      runtimeDisposition = 'UNTRACKED';
    }

    const asset = Object.freeze({
      assetId: record.assetId,
      url: contract.url,
      width: contract.width,
      height: contract.height,
      sha256: contract.sha256,
      source: 'PREFAB_MANIFEST',
      provenance: record.provenance,
      runtimeDisposition,
      directProductionKeys: Object.freeze(directProductionKeys)
    });
    prefabAssets.push(asset);
    registerCanonical(asset, 'prefab manifest');
  }

  for (const prefab of [...worldPrefabByAssetId.values()].sort(compareByRuntimeId)) {
    if (!manifestByAssetId.has(prefab.id)) {
      pushError(errors, `runtime prefab ${prefab.id} is absent from the prefab manifest`);
    }
    const reason = forbiddenRuntimeUrl(prefab.url, masterRuntimeUrl);
    if (reason) pushError(errors, `forbidden runtime URL ${prefab.url}: ${reason}`);
  }
  for (const special of SPECIAL_PREFAB_RUNTIME_DISPOSITIONS) {
    if (!manifestByAssetId.has(special.assetId)) {
      pushError(errors, `bounded special prefab ${special.assetId} is absent from the prefab manifest`);
    }
  }

  for (const direct of directBindings) {
    const reason = forbiddenRuntimeUrl(direct.contract.url, masterRuntimeUrl);
    if (reason) pushError(errors, `forbidden runtime URL ${direct.contract.url}: ${reason}`);

    if (direct.tracking.kind === 'WITHDRAWN_STYLE_AUTHORITY') continue;

    const special = specialByAssetId.get(direct.contract.id);
    const expectedAlias = special?.directProductionKey === direct.key;
    if (expectedAlias) continue;

    const asset = Object.freeze({
      assetId: direct.contract.id,
      url: direct.contract.url,
      width: direct.contract.width,
      height: direct.contract.height,
      sha256: direct.contract.sha256,
      source: 'DIRECT_PRODUCTION',
      provenance: direct.tracking.kind,
      runtimeDisposition: 'DIRECT_PRODUCTION_BINDING',
      directProductionKeys: Object.freeze([direct.key])
    });
    registerCanonical(asset, `direct production binding ${direct.key}`);
  }

  const candidateDependentAssets = reportCandidateDependentAssets(pendingInventory, errors);
  const activePrefabAssetCount = prefabAssets.filter(({ runtimeDisposition }) => runtimeDisposition !== 'SUPPRESSED_NOT_LOADED').length;
  const suppressedPrefabAssetCount = prefabAssets.length - activePrefabAssetCount;
  const acceptanceState = candidateDependentAssets.length > 0 ? 'UNMET' : 'NOT_EVALUATED';

  return freeze({
    format: FABLE5_VISIBLE_RUNTIME_ASSET_SET_FORMAT,
    staticOnly: true,
    ok: errors.length === 0,
    errors: uniqueSorted(errors),
    observed: {
      prefabManifest: {
        path: prefabManifestPath,
        manifestId: manifest?.manifestId ?? null,
        targetMasterRuntimeUrl: masterRuntimeUrl,
        prefabDerivedAssets: prefabAssets.sort(compareByAssetId)
      },
      runtimeAssetGates: [
        {
          key: innkeeperRuntimeGate.key ?? null,
          state: innkeeperRuntimeGate.state ?? null,
          runtimeInstallAllowed: innkeeperRuntimeGate.runtimeInstallAllowed === true,
          approvalState: innkeeperRuntimeGate.approval?.state ?? null,
          replacementAssetId: innkeeperRuntimeGate.approval?.replacementAssetId ?? null
        }
      ],
      directProductionBindings: directBindings,
      canonicalVisualAssets: canonicalAssets.sort(compareByAssetId),
      counts: {
        prefabDerivedAssetCount: prefabAssets.length,
        activePrefabDerivedAssetCount: activePrefabAssetCount,
        suppressedPrefabDerivedAssetCount: suppressedPrefabAssetCount,
        directProductionBindingCount: directBindings.length,
        canonicalVisualAssetCount: canonicalAssets.length
      }
    },
    inferred: [],
    unknown: [
      {
        subject: 'browser-runtime-network-and-visibility',
        state: 'NOT_EVALUATED',
        reason: 'This static preflight does not run a browser, capture network traffic, or assert renderer visibility.'
      }
    ],
    acceptance: {
      state: acceptanceState,
      candidateDependentAssets,
      reason: candidateDependentAssets.length > 0
        ? 'Candidate-dependent assets remain UNMET and are not runtime approvals.'
        : 'No candidate-dependent assets were declared by the bounded pending inventory.'
    }
  });
}

async function runCli() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const report = await verifyFable5VisibleRuntimeAssetSet({ repoRoot });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
