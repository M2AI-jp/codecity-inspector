import { createHash } from 'node:crypto';
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
import { inspectFable5PrefabCharacterCandidate } from '../asset-forge/src/fable5-prefab-character-intake.mjs';
import { verifyFable5RuntimeAssetLedger } from '../asset-forge/src/fable5-runtime-asset-ledger.mjs';
import { assertExistingFileWithin } from '../asset-forge/src/paths.mjs';

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

async function readJsonWithin(root, relativePath, label) {
  const sourcePath = await assertExistingFileWithin(root, relativePath);
  try {
    return JSON.parse(await readFile(sourcePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function characterOutputContractPath(jobPackPath) {
  if (typeof jobPackPath !== 'string'
    || !/^generated\/jobs\/[a-z0-9_]+\/job-pack\.json$/.test(jobPackPath)) {
    throw new Error('approved character job pack path is invalid');
  }
  return `${path.posix.dirname(jobPackPath)}/output-contract.json`;
}

async function validateApprovedCharacterMechanics(binding, entry, {
  forgeRoot,
  inspectCharacterCandidate
}) {
  if (entry.category !== 'character') return;
  const artifactPath = await assertExistingFileWithin(forgeRoot, entry.artifact?.path);
  const jobPackPath = entry.job?.path;
  const expectedOutputContractPath = characterOutputContractPath(jobPackPath);
  const jobPath = `${path.posix.dirname(jobPackPath)}/job.json`;
  const [artifact, jobPack, job, outputContract] = await Promise.all([
    readFile(artifactPath),
    readJsonWithin(forgeRoot, jobPackPath, 'approved character job pack'),
    readJsonWithin(forgeRoot, jobPath, 'approved character job'),
    readJsonWithin(forgeRoot, expectedOutputContractPath, 'approved character output contract')
  ]);
  if (sha256(artifact) !== entry.artifact?.sha256) {
    throw new Error('approved character artifact bytes no longer match the frozen ledger');
  }
  if (jobPack.assetId !== binding.assetId || jobPack.jobId !== entry.job?.jobId || jobPack.status !== 'job-pack') {
    throw new Error('approved character job pack does not bind its frozen ledger entry');
  }
  if (jobPack.outputContractPath !== expectedOutputContractPath) {
    throw new Error('approved character job pack does not name its sibling output contract');
  }
  if (job.id !== entry.job?.jobId || job.assetId !== binding.assetId || !sameJson(job.outputContract, outputContract)) {
    throw new Error('approved character output contract does not match its frozen job record');
  }
  const inspection = await inspectCharacterCandidate(artifact, outputContract);
  if (!inspection?.ok) {
    const problems = Array.isArray(inspection?.problems) && inspection.problems.length > 0
      ? `: ${inspection.problems.join('; ')}`
      : '';
    throw new Error(`Fable5 4x10 character mechanical intake did not pass${problems}`);
  }
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

function validateWithdrawnInnkeeperGate({
  gate,
  retiredBindings,
  productionAssets,
  bindingsByKey,
  errors
}) {
  const key = 'bartender';
  const authority = gate?.authority;
  const authorityMatches = authority?.sourcePath === 'art/references/user-provided/character_style_authority_20260722_v1.png'
    && authority?.sha256 === '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932';
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
    errors.push('innkeeper runtime gate must remain blocked until a replacement under the exact new style authority receives explicit human approval');
  }

  const retired = Array.isArray(retiredBindings)
    ? retiredBindings.filter((binding) => binding?.key === key)
    : [];
  if (retired.length !== 1 || !retired[0]?.contract) {
    errors.push('withdrawn innkeeper 4x10 binding must remain archived with its provenance');
  }
  if (blocked && bindingsByKey.has(key)) {
    errors.push('withdrawn innkeeper 4x10 binding must not be an approved runtime binding');
  }
  if (blocked && Object.hasOwn(productionAssets ?? {}, key)) {
    errors.push('withdrawn innkeeper runtime asset must not be present in production assets');
  }
  const retiredContract = retired[0]?.contract;
  if (retiredContract && Object.values(productionAssets ?? {}).some((contract) => sameJson(contract, retiredContract))) {
    errors.push('retired innkeeper 4x10 runtime bytes must not be present under another production asset key');
  }
  if (approved && bindingsByKey.get(key)?.assetId !== gate.approval.replacementAssetId) {
    errors.push('approved innkeeper replacement must match the explicitly human-approved replacement assetId');
  }
  // A malformed gate cannot reopen the character; only the complete approved
  // shape above is allowed to make the historical baseline key active again.
  return approved ? new Set() : new Set([key]);
}

async function validateApprovedBinding(binding, contract, {
  repoRoot,
  errors,
  inspectCharacterCandidate
}) {
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
      return;
    }
    try {
      // This is a fresh mechanical check of the ledger-bound approved bytes.
      // It intentionally says nothing about visual or human approval.
      await validateApprovedCharacterMechanics(binding, entry, { forgeRoot, inspectCharacterCandidate });
    } catch (error) {
      errors.push(`approved runtime binding ${binding.key} character mechanical recheck failed: ${error.message}`);
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
  approvedBindings = FABLE5_APPROVED_RUNTIME_BINDINGS,
  innkeeperRuntimeGate = FABLE5_INNKEEPER_RUNTIME_GATE,
  retiredBindings = FABLE5_RETIRED_RUNTIME_BINDINGS,
  inspectCharacterCandidate = inspectFable5PrefabCharacterCandidate
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
  const withdrawnKeys = validateWithdrawnInnkeeperGate({
    gate: innkeeperRuntimeGate,
    retiredBindings,
    productionAssets,
    bindingsByKey,
    errors
  });

  for (const [key, contract] of Object.entries(productionAssets ?? {})) {
    if (withdrawnKeys.has(key)) continue;
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
    if (repoRoot && path.isAbsolute(repoRoot)) {
      await validateApprovedBinding(binding, contract, { repoRoot, errors, inspectCharacterCandidate });
    }
  }

  for (const [key] of bindingsByKey) {
    if (withdrawnKeys.has(key)) continue;
    if (!productionKeys.has(key)) errors.push(`approved runtime binding ${key} has no production runtime contract`);
  }
  for (const key of baselineKeys) {
    if (withdrawnKeys.has(key)) continue;
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
