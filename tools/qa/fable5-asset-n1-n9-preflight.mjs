import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FABLE5_APPROVED_RUNTIME_BINDINGS } from '../../public/fable5-v2/runtime-asset-manifest.mjs';
import {
  inspectFable5PrefabCharacterCandidate,
  verifyFable5PrefabCharacterJobPack
} from '../asset-forge/src/fable5-prefab-character-intake.mjs';
import {
  inspectFable5PrefabInteriorCandidate,
  verifyFable5PrefabInteriorJobPack
} from '../asset-forge/src/fable5-prefab-interior-intake.mjs';
import { verifyFable5RuntimeAssetLedger } from '../asset-forge/src/fable5-runtime-asset-ledger.mjs';
import { assertExistingFileWithin } from '../asset-forge/src/paths.mjs';

// This is intentionally a *static mechanical* report, not the historical
// normalize-check command described by the older docs. It reuses Asset Forge's
// ledger and candidate inspectors; it cannot turn a human visual decision,
// a browser capture, or unimplemented N2/N3/N4/N5/N8/N9 image analysis into a
// mechanical PASS.
export const FABLE5_APPROVED_ASSET_N1_N9_STATIC_PREFLIGHT_FORMAT =
  'fable5-approved-runtime-asset-n1-n9-static-preflight-v1';

const SHA256 = /^[a-f0-9]{64}$/;
const FORGE_LEDGER_PREFIX = 'tools/asset-forge/';
const STATIC_LIMITATIONS = Object.freeze([
  'Human visual review, character-style continuity, and owner approval quality are out of scope for this static preflight.',
  'Browser rendering, network allowlists, animation timing, collision, and runtime behavior are out of scope for this static preflight.',
  'N2 edge-sharpness thresholds, N3 material-swatch color comparison, N4 outline/halo analysis, N5 shadow-apron analysis, N8 text detection, and N9 emissive-region analysis are not implemented here; this report cannot claim a full N1–N9 pass.'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function freeze(value) {
  return Object.freeze(value);
}

function nGate(status, evidence = {}) {
  return freeze({ status, ...evidence });
}

function normalizeLedgerPath(ledgerPath) {
  if (typeof ledgerPath !== 'string' || !ledgerPath.startsWith(FORGE_LEDGER_PREFIX)) {
    throw new Error('approved runtime ledger path must start with tools/asset-forge/');
  }
  const forgeRelativePath = ledgerPath.slice(FORGE_LEDGER_PREFIX.length);
  if (!/^generated\/fable5-runtime-ledgers\/[a-f0-9]{64}\.json$/.test(forgeRelativePath)) {
    throw new Error('approved runtime ledger path must be content-addressed');
  }
  return freeze({ repoRelativePath: ledgerPath, forgeRelativePath });
}

function defaultLedgerPaths(approvedBindings, errors) {
  const paths = new Set();
  for (const binding of approvedBindings ?? []) {
    if (!binding || typeof binding !== 'object') {
      errors.push('approved runtime binding must be an object');
      continue;
    }
    try {
      paths.add(normalizeLedgerPath(binding.ledgerPath).repoRelativePath);
    } catch (error) {
      errors.push(`approved runtime binding ${binding.key ?? '(unknown)'} has invalid ledger path: ${error.message}`);
    }
  }
  return [...paths].sort();
}

function normalizeRequestedLedgerPaths(ledgerPaths, approvedBindings, errors) {
  const requested = ledgerPaths === undefined
    ? defaultLedgerPaths(approvedBindings, errors)
    : ledgerPaths;
  if (!Array.isArray(requested) || requested.length === 0) {
    errors.push('at least one approved runtime ledger path is required');
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const ledgerPath of requested) {
    try {
      const value = normalizeLedgerPath(ledgerPath);
      if (seen.has(value.repoRelativePath)) {
        errors.push(`approved runtime ledger path is repeated: ${value.repoRelativePath}`);
        continue;
      }
      seen.add(value.repoRelativePath);
      normalized.push(value);
    } catch (error) {
      errors.push(`invalid approved runtime ledger path: ${error.message}`);
    }
  }
  return normalized.sort((left, right) => left.repoRelativePath.localeCompare(right.repoRelativePath));
}

async function readRuntimeLedger(forgeRoot, forgeRelativePath) {
  const ledgerFile = await assertExistingFileWithin(forgeRoot, forgeRelativePath);
  try {
    return JSON.parse(await readFile(ledgerFile, 'utf8'));
  } catch (error) {
    throw new Error('approved runtime ledger is not valid JSON', { cause: error });
  }
}

async function readBytesWithin(forgeRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`${label} path is missing`);
  }
  return readFile(await assertExistingFileWithin(forgeRoot, relativePath));
}

function ensureApprovedOnlyLedger(ledger, ledgerPath, errors) {
  const tracked = ledger?.trackedAssets;
  const allowlist = ledger?.runtimeAllowlist;
  if (!Array.isArray(tracked) || !Array.isArray(allowlist)) {
    errors.push(`approved runtime ledger ${ledgerPath} has no tracked asset and allowlist arrays`);
    return false;
  }
  if (ledger.runtimeReady !== true) {
    errors.push(`approved runtime ledger ${ledgerPath} is not runtime-ready`);
  }
  if (tracked.length === 0) {
    errors.push(`approved runtime ledger ${ledgerPath} contains no approved runtime assets`);
    return false;
  }
  const nonApproved = tracked.filter((entry) => entry?.state !== 'approved');
  if (nonApproved.length > 0) {
    const states = nonApproved.map(({ assetId, state }) => `${assetId ?? '(unknown)'} (${state ?? 'missing-state'})`).join(', ');
    errors.push(`approved runtime ledger ${ledgerPath} contains non-approved tracked assets: ${states}`);
  }
  const trackedIds = new Set();
  for (const entry of tracked) {
    if (typeof entry?.assetId !== 'string' || entry.assetId.length === 0) {
      errors.push(`approved runtime ledger ${ledgerPath} contains an asset without an assetId`);
      continue;
    }
    if (trackedIds.has(entry.assetId)) {
      errors.push(`approved runtime ledger ${ledgerPath} repeats tracked asset ${entry.assetId}`);
      continue;
    }
    trackedIds.add(entry.assetId);
  }
  const allowlistIds = new Set();
  for (const entry of allowlist) {
    if (typeof entry?.assetId !== 'string' || entry.assetId.length === 0) {
      errors.push(`approved runtime ledger ${ledgerPath} allowlist contains an asset without an assetId`);
      continue;
    }
    if (allowlistIds.has(entry.assetId)) {
      errors.push(`approved runtime ledger ${ledgerPath} repeats allowlisted asset ${entry.assetId}`);
      continue;
    }
    allowlistIds.add(entry.assetId);
    if (!trackedIds.has(entry.assetId)) {
      errors.push(`approved runtime ledger ${ledgerPath} allowlists untracked asset ${entry.assetId}`);
    }
  }
  if (allowlist.length !== tracked.length || allowlistIds.size !== trackedIds.size) {
    errors.push(`approved runtime ledger ${ledgerPath} allowlist does not contain exactly its approved tracked assets`);
  }
  return nonApproved.length === 0 && tracked.length === allowlist.length;
}

function requireCharacterContract(entry, contract) {
  const errors = [];
  if (contract?.assetId !== entry.assetId) errors.push('assetId does not match its ledger entry');
  if (contract?.category !== 'character') errors.push('category is not character');
  if (contract?.png?.w !== 640 || contract?.png?.h !== 512) errors.push('PNG contract is not 640x512');
  if (contract?.nativeScale !== 1) errors.push('nativeScale is not one');
  if (contract?.logicalTileSize !== 64) errors.push('logicalTileSize is not 64');
  if (contract?.pivot?.x !== 32 || contract?.pivot?.y !== 120) errors.push('foot pivot is not (32,120)');
  if (contract?.sheet?.rows !== 4 || contract?.sheet?.cols !== 10
    || contract?.sheet?.frameW !== 64 || contract?.sheet?.frameH !== 128) {
    errors.push('sheet contract is not a 4x10 grid of 64x128 frames');
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

function characterNGates(contractCheck, inspection) {
  const checks = inspection?.checks ?? {};
  return freeze({
    N1: nGate(contractCheck.ok && checks.exactDimensions === true && checks.exactGrid === true ? 'PASS' : 'FAIL', {
      dimensionsAndGrid: checks.exactDimensions === true && checks.exactGrid === true,
      contract: contractCheck.ok
    }),
    N2: nGate(contractCheck.ok && checks.exactDimensions === true ? 'PARTIAL' : 'FAIL', {
      nativeScaleDeclaredOne: contractCheck.ok,
      limitation: 'No Laplacian/edge-sharpness threshold is implemented.'
    }),
    N3: nGate('NOT_IMPLEMENTED', { limitation: 'No accepted material-swatch color comparison is implemented.' }),
    N4: nGate(checks.opaqueChromaKeyPixels === 0 ? 'PARTIAL' : 'FAIL', {
      opaqueChromaKeyPixels: checks.opaqueChromaKeyPixels ?? null,
      limitation: 'No outline-thickness or black-halo comparison is implemented.'
    }),
    N5: nGate('NOT_IMPLEMENTED', { limitation: 'No footprint-apron shadow analysis is implemented.' }),
    N6: nGate(contractCheck.ok && checks.pivotAt32_120AllFrames === true ? 'PASS' : 'FAIL', {
      footPivotAt32_120AllFrames: checks.pivotAt32_120AllFrames === true,
      contract: contractCheck.ok
    }),
    N7: nGate(checks.transparentCorners === true && checks.opaqueChromaKeyPixels === 0 ? 'PASS' : 'FAIL', {
      transparentCorners: checks.transparentCorners === true,
      opaqueChromaKeyPixels: checks.opaqueChromaKeyPixels ?? null
    }),
    N8: nGate('NOT_IMPLEMENTED', { limitation: 'No text/high-frequency cluster detector is implemented.' }),
    N9: nGate('NOT_IMPLEMENTED', { limitation: 'No bright-emissive-region detector is implemented.' })
  });
}

function interiorNGates(contract, inspection) {
  const checks = inspection?.checks ?? {};
  const contractMatches = contract?.png?.w === contract?.composition?.worldRect?.width
    && contract?.png?.h === contract?.composition?.worldRect?.height
    && contract?.nativeScale === 1;
  return freeze({
    N1: nGate(contractMatches && checks.exactDimensions === true ? 'PASS' : 'FAIL', {
      dimensions: checks.exactDimensions === true,
      contract: contractMatches
    }),
    N2: nGate(contractMatches ? 'PARTIAL' : 'FAIL', {
      nativeScaleDeclaredOne: contract?.nativeScale === 1,
      limitation: 'No Laplacian/edge-sharpness threshold is implemented.'
    }),
    N3: nGate('NOT_IMPLEMENTED', { limitation: 'No accepted material-swatch color comparison is implemented.' }),
    N4: nGate(checks.noOpaqueChromaKeyPixels === true ? 'PARTIAL' : 'FAIL', {
      noOpaqueChromaKeyPixels: checks.noOpaqueChromaKeyPixels === true,
      limitation: 'No outline-thickness or black-halo comparison is implemented.'
    }),
    N5: nGate('NOT_IMPLEMENTED', { limitation: 'No footprint-apron shadow analysis is implemented.' }),
    N6: nGate('NOT_APPLICABLE', { reason: 'The fixed character foot pivot is not an interior-kit assertion.' }),
    N7: nGate(checks.noOpaqueChromaKeyPixels === true ? 'PARTIAL' : 'FAIL', {
      noOpaqueChromaKeyPixels: checks.noOpaqueChromaKeyPixels === true,
      limitation: 'Interior kits use contract-defined opaque coverage rather than character-sheet corners.'
    }),
    N8: nGate('NOT_IMPLEMENTED', { limitation: 'No text/high-frequency cluster detector is implemented.' }),
    N9: nGate('NOT_IMPLEMENTED', { limitation: 'No bright-emissive-region detector is implemented.' })
  });
}

function provenanceCheck(entry) {
  const errors = [];
  if (!SHA256.test(entry?.artifact?.sha256 ?? '')) errors.push('artifact SHA-256 is invalid');
  if (!SHA256.test(entry?.contract?.sha256 ?? '')) errors.push('contract SHA-256 is invalid');
  if (!SHA256.test(entry?.job?.sha256 ?? '')) errors.push('job-pack SHA-256 is invalid');
  if (!SHA256.test(entry?.job?.provenanceKey ?? '')) errors.push('job provenance key is invalid');
  if (!SHA256.test(entry?.approval?.sha256 ?? '')) errors.push('approval-record SHA-256 is invalid');
  if (entry?.approval?.status !== 'approved') errors.push('approval record is not approved');
  if (!Array.isArray(entry?.approval?.scope) || !entry.approval.scope.includes('runtime-use')) {
    errors.push('approval record lacks runtime-use scope');
  }
  if (entry?.category === 'character' && !entry.approval.scope.includes('character-style-lock')) {
    errors.push('character approval record lacks character-style-lock scope');
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

async function verifiedOutputContract(entry, {
  forgeRoot,
  projectRoot,
  verifyCharacterJobPack,
  verifyInteriorJobPack
}) {
  const assetId = entry?.assetId;
  const jobPackPath = entry?.job?.path;
  if (typeof assetId !== 'string' || assetId.length === 0 || typeof jobPackPath !== 'string') {
    throw new Error('approved asset lacks an assetId or job-pack path');
  }
  if (entry.category === 'character') {
    const verified = await verifyCharacterJobPack(
      { assetId, jobPackPath },
      { forgeRoot, projectRoot }
    );
    return verified.job.outputContract;
  }
  if (entry.category === 'interior') {
    const verified = await verifyInteriorJobPack(
      { assetId, jobPackPath },
      { forgeRoot, projectRoot }
    );
    return verified.job.outputContract;
  }
  throw new Error(`no verified job-pack output contract exists for category ${entry.category ?? '(missing)'}`);
}

async function inspectApprovedAsset(entry, {
  forgeRoot,
  projectRoot,
  inspectCharacterCandidate,
  inspectInteriorCandidate,
  verifyCharacterJobPack,
  verifyInteriorJobPack
}) {
  const artifact = await readBytesWithin(forgeRoot, entry?.artifact?.path, `${entry?.assetId ?? 'asset'} artifact`);
  const contractBytes = await readBytesWithin(forgeRoot, entry?.contract?.path, `${entry?.assetId ?? 'asset'} contract`);
  const contract = JSON.parse(contractBytes.toString('utf8'));
  const errors = [];
  if (sha256(artifact) !== entry?.artifact?.sha256) errors.push('artifact bytes do not match the ledger SHA-256');
  if (sha256(contractBytes) !== entry?.contract?.sha256) errors.push('contract bytes do not match the ledger SHA-256');
  const provenance = provenanceCheck(entry);
  errors.push(...provenance.errors);

  let inspection;
  let n1N9;
  if (entry?.category === 'character') {
    const contractCheck = requireCharacterContract(entry, contract);
    errors.push(...contractCheck.errors);
    const outputContract = await verifiedOutputContract(entry, {
      forgeRoot,
      projectRoot,
      verifyCharacterJobPack,
      verifyInteriorJobPack
    });
    inspection = await inspectCharacterCandidate(artifact, outputContract);
    if (!inspection?.ok) errors.push(...(inspection?.problems ?? ['character mechanical inspection did not pass']));
    n1N9 = characterNGates(contractCheck, inspection);
  } else if (entry?.category === 'interior') {
    if (contract?.assetId !== entry.assetId || contract?.category !== 'interior') {
      errors.push('interior contract does not match its ledger entry');
    }
    const outputContract = await verifiedOutputContract(entry, {
      forgeRoot,
      projectRoot,
      verifyCharacterJobPack,
      verifyInteriorJobPack
    });
    inspection = await inspectInteriorCandidate(artifact, outputContract);
    if (!inspection?.ok) errors.push(...(inspection?.problems ?? ['interior mechanical inspection did not pass']));
    n1N9 = interiorNGates(contract, inspection);
  } else {
    errors.push(`no supported static N1–N9 inspector exists for category ${entry?.category ?? '(missing)'}`);
    n1N9 = freeze({});
  }

  for (const [gate, result] of Object.entries(n1N9)) {
    if (result.status === 'FAIL') errors.push(`${gate} static assertion failed`);
  }
  return freeze({
    assetId: entry?.assetId ?? null,
    category: entry?.category ?? null,
    mechanicalStatus: errors.length === 0 ? 'PASS' : 'FAIL',
    hashes: freeze({
      artifactSha256: entry?.artifact?.sha256 ?? null,
      contractSha256: entry?.contract?.sha256 ?? null,
      jobPackSha256: entry?.job?.sha256 ?? null,
      approvalRecordSha256: entry?.approval?.sha256 ?? null
    }),
    provenance: freeze({
      mechanicalLedgerBinding: provenance.ok ? 'PASS' : 'FAIL',
      errors: provenance.errors
    }),
    n1N9,
    errors: freeze(errors)
  });
}

/**
 * Rechecks the currently approved, runtime-ready Asset Forge ledger(s). The
 * result deliberately separates a pass of implemented static mechanics from
 * a full N1–N9 acceptance decision, which remains incomplete until the other
 * specified N-gate analyzers and human/browser evidence exist.
 */
export async function verifyFable5ApprovedAssetN1N9StaticPreflight({
  repoRoot,
  ledgerPaths = undefined,
  approvedBindings = FABLE5_APPROVED_RUNTIME_BINDINGS
} = {}, dependencies = {}) {
  const errors = [];
  if (!repoRoot || !path.isAbsolute(repoRoot)) {
    errors.push('repoRoot must be an absolute path');
  }
  const normalizedLedgerPaths = normalizeRequestedLedgerPaths(ledgerPaths, approvedBindings, errors);
  if (errors.length > 0 || !repoRoot || !path.isAbsolute(repoRoot)) {
    return freeze({
      format: FABLE5_APPROVED_ASSET_N1_N9_STATIC_PREFLIGHT_FORMAT,
      staticOnly: true,
      mechanicalPreflightStatus: 'FAIL',
      fullN1N9Status: 'FAIL',
      ok: false,
      errors: freeze(errors),
      ledgers: freeze([]),
      assets: freeze([]),
      limitations: STATIC_LIMITATIONS
    });
  }

  const forgeRoot = path.join(repoRoot, 'tools', 'asset-forge');
  const verifyLedger = dependencies.verifyLedger ?? verifyFable5RuntimeAssetLedger;
  const loadLedger = dependencies.loadLedger ?? readRuntimeLedger;
  const inspectCharacterCandidate = dependencies.inspectCharacterCandidate ?? inspectFable5PrefabCharacterCandidate;
  const inspectInteriorCandidate = dependencies.inspectInteriorCandidate ?? inspectFable5PrefabInteriorCandidate;
  const verifyCharacterJobPack = dependencies.verifyCharacterJobPack ?? verifyFable5PrefabCharacterJobPack;
  const verifyInteriorJobPack = dependencies.verifyInteriorJobPack ?? verifyFable5PrefabInteriorJobPack;
  const ledgers = [];
  const assets = [];

  for (const ledgerPath of normalizedLedgerPaths) {
    try {
      const verified = await verifyLedger(
        { ledgerPath: ledgerPath.forgeRelativePath },
        { forgeRoot, projectRoot: repoRoot }
      );
      if (verified?.status !== 'verified') {
        throw new Error('approved runtime ledger verification did not return verified status');
      }
      const ledger = await loadLedger(forgeRoot, ledgerPath.forgeRelativePath);
      if (ledger?.ledgerSha256 !== verified.ledgerSha256) {
        throw new Error('verified runtime ledger SHA-256 does not match ledger contents');
      }
      const approvalOnly = ensureApprovedOnlyLedger(ledger, ledgerPath.repoRelativePath, errors);
      const ledgerResult = {
        path: ledgerPath.repoRelativePath,
        ledgerSha256: verified.ledgerSha256,
        runtimeReady: verified.runtimeReady === true,
        runtimeAssetCount: verified.runtimeAssetCount ?? null,
        approvedOnly: approvalOnly
      };
      ledgers.push(freeze(ledgerResult));
      if (!approvalOnly || verified.runtimeReady !== true) continue;

      for (const entry of ledger.runtimeAllowlist) {
        const asset = await inspectApprovedAsset(entry, {
          forgeRoot,
          projectRoot: repoRoot,
          inspectCharacterCandidate,
          inspectInteriorCandidate,
          verifyCharacterJobPack,
          verifyInteriorJobPack
        });
        assets.push(asset);
        for (const error of asset.errors) {
          errors.push(`${entry.assetId ?? '(unknown)'}: ${error}`);
        }
      }
    } catch (error) {
      errors.push(`approved runtime ledger ${ledgerPath.repoRelativePath} verification failed: ${error.message}`);
    }
  }

  return freeze({
    format: FABLE5_APPROVED_ASSET_N1_N9_STATIC_PREFLIGHT_FORMAT,
    staticOnly: true,
    mechanicalPreflightStatus: errors.length === 0 ? 'PASS' : 'FAIL',
    // Do not collapse “the implemented checks passed” into “N1–N9 passed”.
    fullN1N9Status: errors.length === 0 ? 'INCOMPLETE' : 'FAIL',
    ok: errors.length === 0,
    errors: freeze(errors),
    ledgers: freeze(ledgers),
    assets: freeze(assets),
    limitations: STATIC_LIMITATIONS
  });
}

function cliLedgerPaths(argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--ledger') continue;
    const ledgerPath = argv[index + 1];
    if (typeof ledgerPath !== 'string' || ledgerPath.startsWith('--')) {
      throw new Error('--ledger requires a repository-relative path');
    }
    values.push(ledgerPath);
    index += 1;
  }
  const unexpected = argv.filter((argument, index) => argument.startsWith('--') && argument !== '--ledger'
    && argv[index - 1] !== '--ledger');
  if (unexpected.length > 0) throw new Error(`unsupported option(s): ${unexpected.join(', ')}`);
  return values.length > 0 ? values : undefined;
}

async function runCli() {
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(thisFile), '..', '..');
  const result = await verifyFable5ApprovedAssetN1N9StaticPreflight({
    repoRoot,
    ledgerPaths: cliLedgerPaths(process.argv.slice(2))
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
