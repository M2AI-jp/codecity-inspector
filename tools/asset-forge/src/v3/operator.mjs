import path from 'node:path';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { assertCanonicalInteractiveTerminal } from '../human-write-gate.mjs';
import { withFileLock } from '../fs-safe.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { readRequiredWavesV2 } from '../v2/definition-builder.mjs';
import {
  appendBundleApproval,
  assertBundleLedger,
  prepareBundleApproval
} from './bundle-ledger.mjs';
import { runCanonicalV3Export } from './export-v3.mjs';
import {
  bundleLedgerDigest,
  readBundleLedger,
  transactBundleLedger
} from './persistence.mjs';
import {
  verifyApprovedGenerationForBundle,
  verifyBundleApprovalForExport
} from './provenance.mjs';

// Internal non-Wave-A compatibility path only. Fable5 Wave A is authoritative
// exclusively through wave-operator.mjs's single bulk ceremony. These helpers
// are intentionally absent from the v3 public index and from the CLI.

function requireGenerationId(generationId) {
  if (typeof generationId !== 'string' || !/^gen_[a-z0-9][a-z0-9_-]{0,127}$/.test(generationId)) {
    throw new Error('Invalid v3 generation id');
  }
}

function requireRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid bundle approval request');
  const allowed = ['assetId', 'generationId', 'note', 'supersedesBundleDigest'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('Unexpected bundle approval request field');
  if (typeof input.assetId !== 'string' || typeof input.generationId !== 'string') {
    throw new Error('Bundle approval requires assetId and generationId');
  }
  requireGenerationId(input.generationId);
  const note = String(input.note ?? '').trim();
  if (!note) throw new Error('Bundle approval requires a non-empty human note');
  if (input.supersedesBundleDigest !== undefined
    && !/^[a-f0-9]{64}$/.test(input.supersedesBundleDigest)) {
    throw new Error('Invalid superseded bundle digest');
  }
  return {
    assetId: input.assetId,
    generationId: input.generationId,
    note,
    ...(input.supersedesBundleDigest
      ? { supersedesBundleDigest: input.supersedesBundleDigest }
      : {})
  };
}

async function buildPreview(input, { root, forgeRoot, now, ledger }) {
  const request = requireRequest(input);
  const declaration = await readRequiredWavesV2({ root: forgeRoot });
  if (declaration.requiredSetId !== 'fable5-v2') {
    throw new Error('Individual bundle approval requires the canonical fable5-v2 declaration');
  }
  if (declaration.waves.find(({ id }) => id === 'A')?.assetIds.includes(request.assetId)) {
    throw new Error('Individual bundle approval is disabled for Wave A; use the one bulk human approval ceremony');
  }
  const verified = await verifyApprovedGenerationForBundle({
    assetId: request.assetId,
    generationId: request.generationId
  }, { root, forgeRoot });
  const currentLedger = ledger ?? await readBundleLedger({ root });
  const ledgerInspection = assertBundleLedger(currentLedger);
  const currentLedgerDigest = bundleLedgerDigest(currentLedger);
  const approvedAt = now();
  if (Number.isNaN(Date.parse(approvedAt))) throw new Error('Bundle approval clock returned an invalid timestamp');
  const proposed = prepareBundleApproval({
    assetId: request.assetId,
    category: verified.definition.category,
    definitionSha256: verified.definitionSha256,
    generationRecordDigest: verified.generationRecordDigest,
    artifacts: verified.artifacts,
    reviewer: 'human',
    note: request.note,
    approvedAt
  });
  const active = ledgerInspection.activeByAsset.get(request.assetId);
  if (active?.bundleDigest === proposed.bundleDigest) {
    return {
      schemaVersion: 1,
      status: 'already-approved',
      request,
      ledgerDigest: currentLedgerDigest,
      approval: active,
      generationRecordDigest: verified.generationRecordDigest,
      confirmationPhrase: null
    };
  }
  if (active && request.supersedesBundleDigest !== active.bundleDigest) {
    throw new Error(`Bundle replacement must name the current active digest: ${active.bundleDigest}`);
  }
  if (!active && request.supersedesBundleDigest) {
    throw new Error('Cannot supersede a bundle when the asset has no active v3 approval');
  }
  const planCore = {
    schemaVersion: 1,
    request,
    ledgerDigest: currentLedgerDigest,
    previousBundleDigest: active?.bundleDigest ?? null,
    approval: proposed,
    generationRecordDigest: verified.generationRecordDigest
  };
  const planDigest = sha256(canonicalJson({ contract: 'fable5-bundle-approval-plan-v3', ...planCore }));
  return {
    ...planCore,
    status: 'ready-for-human-confirmation',
    planDigest,
    confirmationPhrase: `APPROVE V3 BUNDLE ${planDigest}`
  };
}

export async function previewBundleApprovalInternal(input, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  now = () => new Date().toISOString()
} = {}) {
  return buildPreview(input, {
    root: path.resolve(root),
    forgeRoot: path.resolve(forgeRoot),
    now,
    ledger: null
  });
}

export function formatBundleApprovalPreview(preview) {
  if (preview.status === 'already-approved') {
    return `V3 bundle is already approved: ${preview.approval.assetId} ${preview.approval.bundleDigest}\n`;
  }
  const lines = [
    'Fable5 v3 bundle approval (human-only)',
    `Asset: ${preview.approval.assetId}`,
    `Generation: ${preview.request.generationId}`,
    `Definition SHA-256: ${preview.approval.definitionSha256}`,
    `Bundle SHA-256: ${preview.approval.bundleDigest}`,
    `Replaces: ${preview.previousBundleDigest ?? 'none'}`,
    'Artifacts:'
  ];
  for (const artifact of preview.approval.artifacts) {
    lines.push(`  ${artifact.role}: ${artifact.approvedPath} ${artifact.sha256}`);
  }
  lines.push(`Note: ${preview.approval.note}`);
  lines.push(`Type exactly: ${preview.confirmationPhrase}`);
  return `${lines.join('\n')}\n`;
}

export async function executeBundleApprovalInternal(preview, answer, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  // There is deliberately no injectable TTY predicate or provenance verifier.
  // Automated code may preview, but it cannot impersonate the human write gate.
  assertCanonicalInteractiveTerminal('V3 bundle approval');
  if (preview?.status !== 'ready-for-human-confirmation' || typeof preview.confirmationPhrase !== 'string') {
    throw new Error('V3 bundle approval requires a ready preview');
  }
  if (answer !== preview.confirmationPhrase) throw new Error('V3 bundle approval confirmation did not match exactly');
  const actualRoot = path.resolve(root);
  const actualForgeRoot = path.resolve(forgeRoot);
  if (actualRoot !== actualForgeRoot) {
    throw new Error('V3 bundle approval requires one canonical Asset Forge root');
  }
  const paths = pathsFor(actualRoot);
  const committed = await withFileLock(actualRoot, paths.requiredPromotionLock, () =>
    withFileLock(actualRoot, paths.lifecycleLock, () =>
      transactBundleLedger(async (currentLedger) => {
        const live = await buildPreview(preview.request, {
          root: actualRoot,
          forgeRoot: actualForgeRoot,
          now: () => preview.approval.approvedAt,
          ledger: currentLedger
        });
        if (live.status !== 'ready-for-human-confirmation'
          || live.planDigest !== preview.planDigest
          || live.confirmationPhrase !== preview.confirmationPhrase) {
          throw new Error('V3 bundle approval plan changed after human preview');
        }
        const next = appendBundleApproval(currentLedger, live.approval, {
          ...(live.previousBundleDigest ? {
            supersession: {
              expectedBundleDigest: live.previousBundleDigest,
              reviewer: 'human',
              note: live.approval.note,
              supersededAt: live.approval.approvedAt
            }
          } : {})
        });
        return { ledger: next, value: { approval: live.approval, planDigest: live.planDigest } };
      }, {
        root: actualRoot,
        expectedLedgerDigest: preview.ledgerDigest
      })));
  return {
    status: 'bundle-approved',
    approval: committed.value.approval,
    planDigest: committed.value.planDigest,
    ledgerDigestBefore: committed.ledgerDigestBefore,
    ledgerDigest: committed.ledgerDigest
  };
}

export function parseV3WaveIds(value) {
  if (value === 'A') return ['A'];
  throw new Error('--waves must be exactly A; Wave B approval and export are not implemented');
}

export async function runV3Export({ waveIds, write = false } = {}) {
  if (arguments.length !== 1 || !arguments[0] || typeof arguments[0] !== 'object'
    || Array.isArray(arguments[0])
    || Object.keys(arguments[0]).some((key) => !['waveIds', 'write'].includes(key))) {
    throw new Error('Public v3 export accepts only waveIds and write; roots and destinations are fixed');
  }
  if (!Array.isArray(waveIds)) throw new Error('V3 export requires explicit wave ids');
  return runCanonicalV3Export({
    waveIds,
    write
  });
}

export { verifyApprovedGenerationForBundle, verifyBundleApprovalForExport };
