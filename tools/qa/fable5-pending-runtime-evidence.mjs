import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectFable5PrefabCharacterCandidate } from '../asset-forge/src/fable5-prefab-character-intake.mjs';
import { inspectFable5PrefabInteriorCandidate } from '../asset-forge/src/fable5-prefab-interior-intake.mjs';

const DEFAULT_INDEX = 'review/fable5-runtime-assets/pending-evidence/20260722/index.json';

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

/**
 * Revalidates the committed, review-only copies of pending candidate bytes.
 * It deliberately does not call promotion/export code and never returns a
 * visual or runtime acceptance verdict.
 */
export async function verifyFable5PendingRuntimeEvidence({
  repoRoot,
  indexPath = DEFAULT_INDEX
} = {}) {
  assert(typeof repoRoot === 'string' && path.isAbsolute(repoRoot), 'repoRoot must be an absolute path');
  const forgeRoot = path.join(repoRoot, 'tools', 'asset-forge');
  const index = await readJson(safePath(forgeRoot, indexPath, 'indexPath'), 'pending evidence index');
  assert(index?.format === 'fable5-pending-runtime-evidence-v1', 'pending evidence index format is invalid');
  assert(index.status === 'pending-human-review', 'pending evidence index is not pending human review');
  assert(index.approval?.humanDecision === null && index.approval.runtimeInstallAllowed === false && index.approval.promotionAllowed === false,
    'pending evidence index must not contain a terminal or runtime decision');
  assert(Array.isArray(index.assets) && index.assets.length > 0, 'pending evidence index has no assets');

  const seen = new Set();
  const checked = [];
  for (const entry of index.assets) {
    assert(typeof entry?.assetId === 'string' && !seen.has(entry.assetId), `duplicate or invalid pending evidence asset ${entry?.assetId}`);
    seen.add(entry.assetId);
    assert(entry.category === 'character' || entry.category === 'interior', `${entry.assetId} has unsupported category`);
    const [artifact, metadataBytes, jobPackBytes, contractBytes] = await Promise.all([
      readFile(safePath(forgeRoot, entry.artifactPath, `${entry.assetId} artifactPath`)),
      readFile(safePath(forgeRoot, entry.metadataPath, `${entry.assetId} metadataPath`)),
      readFile(safePath(forgeRoot, entry.jobPackPath, `${entry.assetId} jobPackPath`)),
      readFile(safePath(forgeRoot, entry.contractPath, `${entry.assetId} contractPath`))
    ]);
    assert(sha256(artifact) === entry.artifactSha256, `${entry.assetId} artifact hash mismatch`);
    assert(sha256(metadataBytes) === entry.metadataSha256, `${entry.assetId} metadata hash mismatch`);
    assert(sha256(jobPackBytes) === entry.jobPackSha256, `${entry.assetId} job-pack hash mismatch`);
    const [metadata, jobPack, contract] = [
      JSON.parse(metadataBytes.toString('utf8')),
      JSON.parse(jobPackBytes.toString('utf8')),
      JSON.parse(contractBytes.toString('utf8'))
    ];
    assert(metadata.assetId === entry.assetId && metadata.status === 'pending-inspection', `${entry.assetId} metadata is not pending`);
    assert(metadata.source?.sha256 === entry.artifactSha256, `${entry.assetId} metadata does not bind candidate bytes`);
    assert(metadata.approval?.status === 'not-yet-submitted' && metadata.approval?.humanOnly === true,
      `${entry.assetId} has an unexpected approval state`);
    assert(metadata.export?.allowed === false && metadata.runtime?.allowed === false,
      `${entry.assetId} pending evidence must not allow export or runtime`);
    assert(jobPack.assetId === entry.assetId && jobPack.jobId === metadata.jobPack?.jobId,
      `${entry.assetId} job pack does not bind its pending metadata`);
    assert(contract.assetId === entry.assetId, `${entry.assetId} contract does not bind its asset ID`);
    const outputContract = await readJson(path.join(path.dirname(safePath(forgeRoot, entry.jobPackPath, `${entry.assetId} jobPackPath`)), 'output-contract.json'),
      `${entry.assetId} evidence output contract`);
    const inspection = entry.category === 'character'
      ? await inspectFable5PrefabCharacterCandidate(artifact, outputContract)
      : await inspectFable5PrefabInteriorCandidate(artifact, outputContract);
    assert(inspection.ok, `${entry.assetId} evidence mechanical inspection failed: ${inspection.problems.join('; ')}`);
    checked.push(Object.freeze({ assetId: entry.assetId, category: entry.category, sha256: entry.artifactSha256 }));
  }
  return Object.freeze({
    ok: true,
    assetCount: checked.length,
    assets: Object.freeze(checked),
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
