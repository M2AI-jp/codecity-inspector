import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectFable5PrefabCharacterCandidate } from '../asset-forge/src/fable5-prefab-character-intake.mjs';
import { inspectFable5PrefabInteriorCandidate } from '../asset-forge/src/fable5-prefab-interior-intake.mjs';

const DEFAULT_INDEX = 'review/fable5-runtime-assets/pending-evidence/20260722/index.json';
const PENDING_HUMAN_REVIEW = 'pending-human-review';
const HISTORICAL_SUPERSEDED = 'historical-superseded';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safePath(root, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty Forge-relative path`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes the Forge root`);
  }
  return resolved;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function evidenceState(entry) {
  if (!Object.hasOwn(entry, 'formalIntake')) return 'formal-intake';
  assert(entry.formalIntake === 'unresolved-awaiting-formal-intake',
    `${entry.assetId} has an unsupported formal-intake state`);
  return 'pre-intake-review';
}

function evidenceIndexMode(index) {
  if (index.status === PENDING_HUMAN_REVIEW) return 'current-pending';
  if (index.status === HISTORICAL_SUPERSEDED) {
    const authority = index.supersededBy;
    assert(isNonEmptyString(authority?.sourceId) && isSha256(authority?.sha256)
      && isNonEmptyString(authority?.reviewPacketPath),
    'historical evidence index must identify the superseding style authority and review packet');
    return 'historical-superseded';
  }
  throw new Error('pending evidence index has an unsupported status');
}

async function verifyPreIntakeReceipt({ forgeRoot, entry, artifactSha256 }) {
  assert(entry.category === 'character', `${entry.assetId} pre-intake review state currently supports characters only`);
  assert(entry.jobPackPath === null && entry.jobPackSha256 === null,
    `${entry.assetId} pre-intake evidence must not claim a job pack`);
  assert(isNonEmptyString(entry.provenanceReceiptPath) && isSha256(entry.provenanceReceiptSha256),
    `${entry.assetId} pre-intake evidence requires a hash-bound provenance receipt`);

  const receiptPath = safePath(forgeRoot, entry.provenanceReceiptPath, `${entry.assetId} provenanceReceiptPath`);
  const receiptBytes = await readFile(receiptPath);
  assert(sha256(receiptBytes) === entry.provenanceReceiptSha256,
    `${entry.assetId} provenance-receipt hash mismatch`);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  assert(receipt.format === 'fable5-pending-character-provenance-receipt-v1' && receipt.assetId === entry.assetId,
    `${entry.assetId} provenance receipt does not bind its candidate`);
  assert(receipt.status === 'pending-inspection' && receipt.custody?.userDirect === false,
    `${entry.assetId} provenance receipt has an invalid pending/custody state`);
  assert(receipt.humanReview?.required === true && receipt.humanReview?.submitted === false && receipt.humanReview?.promotionAllowed === false,
    `${entry.assetId} provenance receipt must forbid human promotion before review`);
  assert(receipt.runtime?.allowed === false && receipt.runtime?.path === null,
    `${entry.assetId} provenance receipt must forbid runtime use`);
  assert(!Object.hasOwn(receipt, 'mechanicalChecks') && !Object.hasOwn(receipt, 'jobPack'),
    `${entry.assetId} pre-intake provenance receipt must not claim mechanical validation or a job pack`);

  const stages = receipt.hashes;
  assert(stages && typeof stages === 'object', `${entry.assetId} provenance receipt has no stage hashes`);
  for (const stageName of ['rawSource', 'normalizedIntermediate', 'alphaOutput', 'finalCandidate']) {
    const stage = stages[stageName];
    assert(isNonEmptyString(stage?.path) && isSha256(stage?.sha256),
      `${entry.assetId} provenance receipt has an invalid ${stageName} hash`);
    const stageBytes = await readFile(safePath(forgeRoot, stage.path, `${entry.assetId} ${stageName} path`));
    assert(sha256(stageBytes) === stage.sha256, `${entry.assetId} ${stageName} hash mismatch`);
  }
  assert(stages.finalCandidate.path === entry.artifactPath && stages.finalCandidate.sha256 === artifactSha256,
    `${entry.assetId} provenance receipt does not bind final candidate bytes`);
  assert(stages.alphaOutput.sha256 === artifactSha256,
    `${entry.assetId} provenance receipt alpha output does not bind final candidate bytes`);
}

/**
 * Revalidates committed review-only candidate evidence. A current index is
 * pending human review; a historical index is audit-only and remains unable
 * to authorize promotion, export, or runtime use.
 */
export async function verifyFable5PendingRuntimeEvidence({
  repoRoot,
  indexPath = DEFAULT_INDEX
} = {}) {
  assert(typeof repoRoot === 'string' && path.isAbsolute(repoRoot), 'repoRoot must be an absolute path');
  const forgeRoot = path.join(repoRoot, 'tools', 'asset-forge');
  const index = await readJson(safePath(forgeRoot, indexPath, 'indexPath'), 'pending evidence index');
  assert(index?.format === 'fable5-pending-runtime-evidence-v1', 'pending evidence index format is invalid');
  const mode = evidenceIndexMode(index);
  assert(index.approval?.humanDecision === null && index.approval.runtimeInstallAllowed === false && index.approval.promotionAllowed === false,
    'evidence index must not contain a terminal, promotion, or runtime decision');
  assert(Array.isArray(index.assets) && index.assets.length > 0, 'pending evidence index has no assets');

  const seen = new Set();
  const checked = [];
  for (const entry of index.assets) {
    assert(typeof entry?.assetId === 'string' && !seen.has(entry.assetId), `duplicate or invalid pending evidence asset ${entry?.assetId}`);
    seen.add(entry.assetId);
    assert(entry.category === 'character' || entry.category === 'interior', `${entry.assetId} has unsupported category`);
    const state = evidenceState(entry);
    const [artifact, metadataBytes, contractBytes] = await Promise.all([
      readFile(safePath(forgeRoot, entry.artifactPath, `${entry.assetId} artifactPath`)),
      readFile(safePath(forgeRoot, entry.metadataPath, `${entry.assetId} metadataPath`)),
      readFile(safePath(forgeRoot, entry.contractPath, `${entry.assetId} contractPath`))
    ]);
    assert(sha256(artifact) === entry.artifactSha256, `${entry.assetId} artifact hash mismatch`);
    assert(sha256(metadataBytes) === entry.metadataSha256, `${entry.assetId} metadata hash mismatch`);
    const [metadata, contract] = [
      JSON.parse(metadataBytes.toString('utf8')),
      JSON.parse(contractBytes.toString('utf8'))
    ];
    assert(metadata.assetId === entry.assetId && metadata.status === 'pending-inspection', `${entry.assetId} metadata is not pending`);
    assert(metadata.approval?.status === 'not-yet-submitted' && metadata.approval?.humanOnly === true,
      `${entry.assetId} has an unexpected approval state`);
    assert(contract.assetId === entry.assetId, `${entry.assetId} contract does not bind its asset ID`);
    if (state === 'formal-intake') {
      assert(isNonEmptyString(entry.jobPackPath) && isSha256(entry.jobPackSha256),
        `${entry.assetId} formal-intake evidence requires a hash-bound job pack`);
      assert(!Object.hasOwn(entry, 'provenanceReceiptPath') && !Object.hasOwn(entry, 'provenanceReceiptSha256'),
        `${entry.assetId} formal-intake evidence cannot be mixed with a pre-intake receipt state`);
      assert(metadata.source?.sha256 === entry.artifactSha256, `${entry.assetId} metadata does not bind candidate bytes`);
      assert(metadata.export?.allowed === false && metadata.runtime?.allowed === false,
        `${entry.assetId} pending evidence must not allow export or runtime`);
      const jobPackPath = safePath(forgeRoot, entry.jobPackPath, `${entry.assetId} jobPackPath`);
      const jobPackBytes = await readFile(jobPackPath);
      assert(sha256(jobPackBytes) === entry.jobPackSha256, `${entry.assetId} job-pack hash mismatch`);
      const jobPack = JSON.parse(jobPackBytes.toString('utf8'));
      assert(jobPack.assetId === entry.assetId && jobPack.jobId === metadata.jobPack?.jobId,
        `${entry.assetId} job pack does not bind its pending metadata`);
      const outputContract = await readJson(path.join(path.dirname(jobPackPath), 'output-contract.json'),
        `${entry.assetId} evidence output contract`);
      const inspection = entry.category === 'character'
        ? await inspectFable5PrefabCharacterCandidate(artifact, outputContract)
        : await inspectFable5PrefabInteriorCandidate(artifact, outputContract);
      assert(inspection.ok, `${entry.assetId} evidence mechanical inspection failed: ${inspection.problems.join('; ')}`);
    } else {
      assert(metadata.format === 'fable5-prefab-character-review-candidate-v1' && metadata.custody?.userDirect === false,
        `${entry.assetId} pre-intake metadata has an invalid format or custody state`);
      if (mode === 'current-pending') {
        assert(contract.status === 'draft-pending-review' && contract.draftMeta?.evidenceCandidate?.path === entry.artifactPath &&
          contract.draftMeta?.evidenceCandidate?.sha256 === entry.artifactSha256,
        `${entry.assetId} pre-intake contract does not bind candidate bytes`);
      }
      assert(metadata.artifact?.sha256 === entry.artifactSha256,
        `${entry.assetId} pre-intake metadata does not bind candidate bytes`);
      assert(metadata.assetForgeIntake?.status === 'unresolved-awaiting-formal-intake' && metadata.assetForgeIntake?.executed === false,
        `${entry.assetId} pre-intake metadata must explicitly leave formal intake unresolved`);
      assert(!Object.hasOwn(metadata, 'jobPack') && !Object.hasOwn(metadata, 'mechanicalChecks'),
        `${entry.assetId} pre-intake metadata must not claim a job pack or mechanical validation`);
      assert(metadata.export === undefined || metadata.export?.allowed === false,
        `${entry.assetId} pre-intake metadata must not allow export`);
      assert(metadata.runtime?.allowed === false && metadata.runtime?.path === null,
        `${entry.assetId} pre-intake metadata must forbid runtime use`);
      await verifyPreIntakeReceipt({ forgeRoot, entry, artifactSha256: entry.artifactSha256 });
    }
    checked.push(Object.freeze({ assetId: entry.assetId, category: entry.category, sha256: entry.artifactSha256, state }));
  }
  const stateCounts = checked.reduce((counts, asset) => {
    counts[asset.state] += 1;
    return counts;
  }, { 'formal-intake': 0, 'pre-intake-review': 0 });
  return Object.freeze({
    ok: true,
    evidenceStatus: index.status,
    mode,
    auditOnly: mode === 'historical-superseded',
    assetCount: checked.length,
    assets: Object.freeze(checked),
    stateCounts: Object.freeze(stateCounts),
    supersededBy: mode === 'historical-superseded' ? Object.freeze({ ...index.supersededBy }) : null,
    approval: Object.freeze({ humanDecision: null, runtimeInstallAllowed: false, promotionAllowed: false })
  });
}

async function runCli() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  process.stdout.write(`${JSON.stringify(await verifyFable5PendingRuntimeEvidence({ repoRoot }))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
