import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FABLE5_APPROVED_RUNTIME_BINDINGS,
  FABLE5_LEGACY_RUNTIME_ASSET_BASELINE,
  PRODUCTION_ASSETS
} from '../../public/fable5-v2/runtime-asset-manifest.mjs';
import { verifyFable5RuntimeAssetLedger } from '../asset-forge/src/fable5-runtime-asset-ledger.mjs';

// This digest makes a legacy-baseline change an explicit review event. It is
// not a claim that legacy assets have Forge approval; new/replaced Fable5
// assets must use a binding to an approved frozen ledger instead.
export const FABLE5_LEGACY_RUNTIME_BASELINE_SHA256 = 'd2c681cbdd16eafaa6483065c0cccc5d2867fff470727324f5d7df9165257d1d';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function asRuntimeUrl(publicPath) {
  return `/${publicPath.slice('public/'.length)}`;
}

function safeBindingMap(bindings, errors) {
  const byKey = new Map();
  for (const binding of bindings) {
    if (!binding || typeof binding !== 'object' || typeof binding.key !== 'string' || binding.key.length === 0) {
      errors.push('approved runtime binding has no non-empty key');
      continue;
    }
    if (byKey.has(binding.key)) {
      errors.push(`approved runtime bindings repeat key ${binding.key}`);
      continue;
    }
    byKey.set(binding.key, binding);
  }
  return byKey;
}

async function validateApprovedBinding(binding, contract, { repoRoot, errors }) {
  if (typeof binding.assetId !== 'string' || !/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(binding.assetId)) {
    errors.push(`approved runtime binding ${binding.key} has an invalid assetId`);
    return;
  }
  if (typeof binding.ledgerPath !== 'string' || !binding.ledgerPath.startsWith('tools/asset-forge/generated/fable5-runtime-ledgers/')) {
    errors.push(`approved runtime binding ${binding.key} must name a frozen Asset Forge ledger`);
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(binding.ledgerSha256 ?? '')) {
    errors.push(`approved runtime binding ${binding.key} has an invalid frozen ledger SHA-256`);
    return;
  }
  const forgeRoot = path.join(repoRoot, 'tools', 'asset-forge');
  const ledgerPath = binding.ledgerPath.slice('tools/asset-forge/'.length);
  try {
    const verified = await verifyFable5RuntimeAssetLedger({ ledgerPath }, { forgeRoot, projectRoot: repoRoot });
    if (!verified.runtimeReady || verified.ledgerSha256 !== binding.ledgerSha256) {
      errors.push(`approved runtime binding ${binding.key} does not name a runtime-ready frozen ledger`);
      return;
    }
    const ledger = JSON.parse(await readFile(path.join(forgeRoot, ledgerPath), 'utf8'));
    const entry = ledger.runtimeAllowlist.find((item) => item.assetId === binding.assetId);
    if (!entry) {
      errors.push(`approved runtime binding ${binding.key} is absent from its ledger allowlist`);
      return;
    }
    const expectedUrl = asRuntimeUrl(entry.runtime.path);
    if (contract.url !== expectedUrl || contract.sha256 !== entry.runtime.sha256) {
      errors.push(`approved runtime binding ${binding.key} does not match its ledger runtime bytes`);
    }
  } catch (error) {
    errors.push(`approved runtime binding ${binding.key} ledger verification failed: ${error.message}`);
  }
}

/**
 * Verify the preflight boundary for every direct production asset. A contract
 * may be an exact member of the fixed legacy baseline, or it must be attached
 * to a frozen, runtime-ready Asset Forge ledger. There is no third path.
 */
export async function verifyFable5RuntimeAssetPreflight({
  repoRoot,
  productionAssets = PRODUCTION_ASSETS,
  legacyBaseline = FABLE5_LEGACY_RUNTIME_ASSET_BASELINE,
  approvedBindings = FABLE5_APPROVED_RUNTIME_BINDINGS
} = {}) {
  const errors = [];
  if (!repoRoot || !path.isAbsolute(repoRoot)) errors.push('repoRoot must be an absolute path');
  if (legacyBaseline?.format !== 'fable5-runtime-legacy-baseline-v1' || !legacyBaseline.assets) {
    errors.push('legacy runtime baseline has an invalid format');
  }
  const observedBaselineSha256 = sha256(canonicalJson(legacyBaseline));
  if (observedBaselineSha256 !== FABLE5_LEGACY_RUNTIME_BASELINE_SHA256) {
    errors.push('legacy runtime baseline digest changed without an explicit preflight update');
  }
  const bindingsByKey = safeBindingMap(approvedBindings, errors);
  const baselineKeys = new Set(Object.keys(legacyBaseline?.assets ?? {}));
  const productionKeys = new Set(Object.keys(productionAssets ?? {}));

  for (const [key, contract] of Object.entries(productionAssets ?? {})) {
    const baselineContract = legacyBaseline?.assets?.[key];
    const binding = bindingsByKey.get(key);
    if (baselineContract && !binding) {
      if (!sameJson(contract, baselineContract)) errors.push(`legacy runtime contract drifted: ${key}`);
      continue;
    }
    if (!binding) {
      errors.push(`runtime contract ${key} is neither a fixed legacy baseline asset nor a frozen-ledger binding`);
      continue;
    }
    if (!sameJson(contract, binding.contract)) {
      errors.push(`approved runtime binding ${key} does not equal its declared runtime contract`);
      continue;
    }
    if (repoRoot && path.isAbsolute(repoRoot)) await validateApprovedBinding(binding, contract, { repoRoot, errors });
  }

  for (const [key] of bindingsByKey) {
    if (!productionKeys.has(key)) errors.push(`approved runtime binding ${key} has no production runtime contract`);
  }
  for (const key of baselineKeys) {
    if (!productionKeys.has(key)) errors.push(`legacy runtime baseline asset ${key} disappeared from production assets`);
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    legacyBaselineSha256: observedBaselineSha256,
    productionAssetCount: productionKeys.size,
    approvedBindingCount: bindingsByKey.size
  });
}

async function runCli() {
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(thisFile), '..', '..');
  const result = await verifyFable5RuntimeAssetPreflight({ repoRoot });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
