import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { FORGE_ROOT, CATEGORY_DIRS, pathsFor } from './config.mjs';
import { atomicWriteJson, withFileLock } from './fs-safe.mjs';
import { canonicalJson, hashApprovedTree, sha256 } from './hashing.mjs';
import { assertExistingFileWithin, toPosixRelative } from './paths.mjs';

export const FABLE5_RUNTIME_ASSET_INVENTORY_VERSION = 'fable5-runtime-asset-inventory-v1';
export const FABLE5_RUNTIME_ASSET_LEDGER_VERSION = 'fable5-runtime-asset-ledger-v1';

const SHA256 = /^[a-f0-9]{64}$/;
const ASSET_ID = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;
const REVIEW_STATES = new Set(['pending-inspection', 'approved', 'rejected']);
const STATE_DIRECTORY = Object.freeze({
  'pending-inspection': 'pending',
  approved: 'approved',
  rejected: 'rejected'
});

function projectRootFor(forgeRoot, projectRoot) {
  return path.resolve(projectRoot ?? path.join(forgeRoot, '..', '..'));
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
}

function requireSha256(value, label) {
  if (!SHA256.test(value ?? '')) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function requireAssetId(value) {
  if (!ASSET_ID.test(value ?? '')) throw new Error('Fable5 runtime inventory has an invalid assetId');
  return value;
}

function requireForgeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)
    || value.includes('\\') || value.includes('\0')) throw new Error(`${label} must be a safe Forge-relative path`);
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} must be a safe Forge-relative path`);
  }
  return value;
}

function requireRuntimeRelativePath(value) {
  if (typeof value !== 'string' || !value.startsWith('public/fable5-v2/assets/')
    || !value.endsWith('.png') || path.isAbsolute(value) || value.includes('\\') || value.includes('\0')) {
    throw new Error('Approved Fable5 runtime assets must use public/fable5-v2/assets/<...>.png');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Approved Fable5 runtime asset path is unsafe');
  }
  return value;
}

async function readJsonWithin(root, relativePath, label) {
  const source = await assertExistingFileWithin(root, requireForgeRelativePath(relativePath, label));
  try {
    return Object.freeze({ path: source, value: JSON.parse(await readFile(source, 'utf8')) });
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function categoryDirectory(category) {
  if (typeof category !== 'string' || !Object.hasOwn(CATEGORY_DIRS, category)) {
    throw new Error('Fable5 runtime inventory has an unsupported category');
  }
  return CATEGORY_DIRS[category];
}

function expectedArtifactPrefix(category, state) {
  return `generated/${categoryDirectory(category)}/${STATE_DIRECTORY[state]}/`;
}

function requireStatePath(value, category, state, extension, label) {
  const prefix = expectedArtifactPrefix(category, state);
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    throw new Error(`${label} does not match the declared ${state} category path`);
  }
  const basename = value.slice(prefix.length);
  if (!/^[a-z0-9_-]+\.(?:png|json)$/.test(basename) || !basename.endsWith(extension)) {
    throw new Error(`${label} must be a direct ${extension} file in its declared state directory`);
  }
  return value;
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function contentHash(value) {
  return sha256(canonicalJson(value));
}

function declaredArtifactHash(metadata) {
  const candidateHash = metadata?.source?.sha256;
  const outputHash = metadata?.outputSha256;
  if (SHA256.test(outputHash ?? '')) return outputHash;
  if (SHA256.test(candidateHash ?? '')) return candidateHash;
  throw new Error('Asset metadata has no valid output/source SHA-256');
}

function metadataArtifactPath(metadata) {
  return metadata?.outputPath ?? metadata?.pendingPath ?? null;
}

function requireApprovalMetadata(metadata, assetId, assetPath, artifactHash) {
  const approval = metadata?.approval;
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    throw new Error(`Approved asset ${assetId} has no explicit approval metadata`);
  }
  if (approval.status !== 'human-approved' || approval.humanOnly !== true) {
    throw new Error(`Approved asset ${assetId} is not marked human-approved`);
  }
  if (metadataArtifactPath(metadata) !== assetPath || declaredArtifactHash(metadata) !== artifactHash) {
    throw new Error(`Approved asset ${assetId} approval metadata does not bind the artifact bytes`);
  }
}

function normalizeApprovalRecord(record, assetId, assetPath, artifactHash, state, category) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Fable5 human approval record must be an object');
  }
  if (record.assetId !== assetId) throw new Error(`Human approval record does not match ${assetId}`);
  const derivation = record.derivation;
  const review = record.review;
  if (!derivation || typeof derivation !== 'object' || Array.isArray(derivation)
    || derivation.outputPath !== assetPath || derivation.outputSha256 !== artifactHash) {
    throw new Error(`Human approval record does not bind ${assetId} artifact path and hash`);
  }
  const approval = review?.approval;
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    throw new Error(`Human approval record has no review approval for ${assetId}`);
  }
  if (approval.status !== state || !Array.isArray(approval.scope)
    || !approval.scope.includes('runtime-use') || typeof approval.approvedBy !== 'string'
    || approval.approvedBy.trim() === '' || typeof approval.decisionRef !== 'string' || approval.decisionRef.trim() === '') {
    throw new Error(`Human approval record is incomplete for ${assetId}`);
  }
  if (category === 'character' && !approval.scope.includes('character-style-lock')) {
    throw new Error(`Character asset ${assetId} lacks the required character-style-lock human review scope`);
  }
  return Object.freeze({
    status: approval.status,
    approvedBy: approval.approvedBy,
    decisionRef: approval.decisionRef,
    scope: Object.freeze([...approval.scope].sort())
  });
}

async function inspectJobPack(forgeRoot, entry, assetId) {
  const jobPackPath = requireForgeRelativePath(entry.jobPackPath, 'jobPackPath');
  if (!/^generated\/jobs\/[a-z0-9_]+\/job-pack\.json$/.test(jobPackPath)) {
    throw new Error('Fable5 runtime asset jobPackPath must be generated/jobs/<id>/job-pack.json');
  }
  const jobPack = await readJsonWithin(forgeRoot, jobPackPath, 'Fable5 job pack');
  if (jobPack.value.assetId !== assetId || typeof jobPack.value.jobId !== 'string' || jobPack.value.status !== 'job-pack') {
    throw new Error(`Job pack does not bind asset ${assetId}`);
  }
  const jobPath = path.posix.join(path.posix.dirname(jobPackPath), 'job.json');
  const job = await readJsonWithin(forgeRoot, jobPath, 'Fable5 job');
  if (job.value.id !== jobPack.value.jobId || job.value.assetId !== assetId
    || typeof job.value.provenanceKey !== 'string' || !SHA256.test(job.value.provenanceKey)) {
    throw new Error(`Job record does not bind asset ${assetId} and its provenance key`);
  }
  if (job.value.contractPath !== entry.contractPath) {
    throw new Error(`Job record contract does not match runtime inventory for ${assetId}`);
  }
  return Object.freeze({
    path: jobPackPath,
    sha256: sha256(await readFile(jobPack.path)),
    jobId: jobPack.value.jobId,
    provenanceKey: job.value.provenanceKey
  });
}

async function inspectTrackedAsset(entry, { forgeRoot, projectRoot }) {
  exactKeys(entry, [
    'assetId', 'category', 'state', 'artifactPath', 'metadataPath', 'contractPath', 'jobPackPath',
    'approvalRecordPath', 'runtimePath'
  ], 'Fable5 runtime inventory asset');
  const assetId = requireAssetId(entry.assetId);
  const category = entry.category;
  const state = entry.state;
  if (!REVIEW_STATES.has(state)) throw new Error(`Fable5 runtime inventory state is invalid for ${assetId}`);
  const artifactPath = requireStatePath(entry.artifactPath, category, state, '.png', 'artifactPath');
  const metadataPath = requireStatePath(entry.metadataPath, category, state, '.json', 'metadataPath');
  if (path.posix.basename(artifactPath, '.png') !== path.posix.basename(metadataPath, '.json')) {
    throw new Error(`Artifact and metadata names must share a stem for ${assetId}`);
  }
  const contractPath = requireForgeRelativePath(entry.contractPath, 'contractPath');
  if (!contractPath.startsWith('contracts/fable5-prefab/') || !contractPath.endsWith('.json')) {
    throw new Error('Fable5 runtime asset contractPath must be a Fable5 prefab JSON contract');
  }
  const [artifact, metadata, contract, job] = await Promise.all([
    assertExistingFileWithin(forgeRoot, artifactPath),
    readJsonWithin(forgeRoot, metadataPath, 'Fable5 asset metadata'),
    assertExistingFileWithin(forgeRoot, contractPath),
    inspectJobPack(forgeRoot, entry, assetId)
  ]);
  const artifactBytes = await readFile(artifact);
  const artifactSha256 = sha256(artifactBytes);
  if (metadata.value.assetId !== assetId || metadata.value.status !== state) {
    throw new Error(`Asset metadata state does not match inventory for ${assetId}`);
  }
  if (declaredArtifactHash(metadata.value) !== artifactSha256 || metadataArtifactPath(metadata.value) !== artifactPath) {
    throw new Error(`Asset metadata does not bind ${assetId} artifact path and hash`);
  }
  const contractSha256 = sha256(await readFile(contract));
  const base = {
    assetId,
    category,
    state,
    artifact: Object.freeze({ path: artifactPath, sha256: artifactSha256 }),
    metadata: Object.freeze({ path: metadataPath, sha256: sha256(await readFile(metadata.path)) }),
    contract: Object.freeze({ path: contractPath, sha256: contractSha256 }),
    job,
    approval: null,
    runtime: null
  };

  if (state === 'pending-inspection') {
    if (entry.approvalRecordPath !== null || entry.runtimePath !== null) {
      throw new Error(`Pending asset ${assetId} cannot carry an approval record or runtime path`);
    }
    return Object.freeze(base);
  }

  if (typeof entry.approvalRecordPath !== 'string' || !entry.approvalRecordPath.startsWith('review/provenance/')) {
    throw new Error(`${state} asset ${assetId} requires a human approval record under review/provenance/`);
  }
  const approvalRecordPath = requireForgeRelativePath(entry.approvalRecordPath, 'approvalRecordPath');
  const approvalRecord = await readJsonWithin(forgeRoot, approvalRecordPath, 'Fable5 human approval record');
  const approval = normalizeApprovalRecord(approvalRecord.value, assetId, artifactPath, artifactSha256, state, category);
  const approvalBinding = Object.freeze({
    path: approvalRecordPath,
    sha256: sha256(await readFile(approvalRecord.path)),
    ...approval
  });

  if (state === 'rejected') {
    if (entry.runtimePath !== null) throw new Error(`Rejected asset ${assetId} cannot carry a runtime path`);
    return Object.freeze({ ...base, approval: approvalBinding });
  }

  requireApprovalMetadata(metadata.value, assetId, artifactPath, artifactSha256);
  const runtimePath = requireRuntimeRelativePath(entry.runtimePath);
  const runtime = await assertExistingFileWithin(projectRoot, runtimePath);
  const runtimeSha256 = sha256(await readFile(runtime));
  if (runtimeSha256 !== artifactSha256) {
    throw new Error(`Runtime bytes do not equal approved asset bytes for ${assetId}`);
  }
  return Object.freeze({
    ...base,
    approval: approvalBinding,
    runtime: Object.freeze({ path: runtimePath, sha256: runtimeSha256 })
  });
}

function normalizedLedgerContent({ inventoryPath, inventorySha256, assets }) {
  const trackedAssets = [...assets].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const runtimeAllowlist = trackedAssets
    .filter(({ state }) => state === 'approved')
    .map(({ assetId, category, artifact, contract, job, approval, runtime }) => Object.freeze({
      assetId, category, artifact, contract, job, approval, runtime
    }));
  const stateCounts = Object.freeze(Object.fromEntries(
    [...REVIEW_STATES].sort().map((state) => [state, trackedAssets.filter((asset) => asset.state === state).length])
  ));
  return Object.freeze({
    format: FABLE5_RUNTIME_ASSET_LEDGER_VERSION,
    status: 'frozen',
    sourceInventory: Object.freeze({ path: inventoryPath, sha256: inventorySha256 }),
    trackedAssets: Object.freeze(trackedAssets),
    runtimeAllowlist: Object.freeze(runtimeAllowlist),
    stateCounts,
    runtimeReady: trackedAssets.length > 0 && stateCounts.approved === trackedAssets.length,
    guards: Object.freeze({
      automaticApproval: false,
      automaticPromotion: false,
      runtimeRequiresApprovedAssetByteEquality: true,
      humanApprovalRecordRequiredForTerminalStates: true,
      characterRuntimeRequiresStyleLockScope: true
    })
  });
}

function withLedgerHash(content) {
  return Object.freeze({ ...content, ledgerSha256: contentHash(content) });
}

function requireInventoryShape(inventory) {
  exactKeys(inventory, ['format', 'assets'], 'Fable5 runtime asset inventory');
  if (inventory.format !== FABLE5_RUNTIME_ASSET_INVENTORY_VERSION || !Array.isArray(inventory.assets)) {
    throw new Error(`Expected ${FABLE5_RUNTIME_ASSET_INVENTORY_VERSION} inventory`);
  }
  if (inventory.assets.length === 0) throw new Error('Fable5 runtime asset inventory cannot be empty');
  const ids = new Set();
  for (const item of inventory.assets) {
    const id = item?.assetId;
    if (ids.has(id)) throw new Error(`Fable5 runtime asset inventory repeats asset ${id}`);
    ids.add(id);
  }
}

async function buildFromInventory(inventory, { forgeRoot, projectRoot, inventoryPath, inventorySha256 }) {
  requireInventoryShape(inventory);
  const assets = await Promise.all(inventory.assets.map((entry) => inspectTrackedAsset(entry, { forgeRoot, projectRoot })));
  return withLedgerHash(normalizedLedgerContent({ inventoryPath, inventorySha256, assets }));
}

function ledgerOutputPath(forgeRoot, ledgerSha256) {
  return path.join(pathsFor(forgeRoot).generated, 'fable5-runtime-ledgers', `${ledgerSha256}.json`);
}

export async function buildFable5RuntimeAssetLedger({ inventoryPath }, dependencies = {}) {
  const forgeRoot = path.resolve(dependencies.forgeRoot ?? FORGE_ROOT);
  const projectRoot = projectRootFor(forgeRoot, dependencies.projectRoot);
  const normalizedInventoryPath = requireForgeRelativePath(inventoryPath, 'inventoryPath');
  const inventory = await readJsonWithin(forgeRoot, normalizedInventoryPath, 'Fable5 runtime asset inventory');
  const ledger = await buildFromInventory(inventory.value, {
    forgeRoot,
    projectRoot,
    inventoryPath: normalizedInventoryPath,
    inventorySha256: sha256(await readFile(inventory.path))
  });
  return Object.freeze({
    status: 'dry-run',
    ledger,
    output: ledgerOutputPath(forgeRoot, ledger.ledgerSha256)
  });
}

export async function freezeFable5RuntimeAssetLedger({ inventoryPath, dryRun = false }, dependencies = {}) {
  const forgeRoot = path.resolve(dependencies.forgeRoot ?? FORGE_ROOT);
  const plan = await buildFable5RuntimeAssetLedger({ inventoryPath }, { forgeRoot, projectRoot: dependencies.projectRoot });
  if (dryRun) return plan;
  return withFileLock(forgeRoot, pathsFor(forgeRoot).requiredPromotionLock, async () => {
    const approvedBefore = await hashApprovedTree(forgeRoot);
    const rechecked = await buildFable5RuntimeAssetLedger({ inventoryPath }, { forgeRoot, projectRoot: dependencies.projectRoot });
    if (rechecked.ledger.ledgerSha256 !== plan.ledger.ledgerSha256) {
      throw new Error('Fable5 runtime inventory changed while freezing its ledger');
    }
    await atomicWriteJson(forgeRoot, rechecked.output, rechecked.ledger);
    const approvedAfter = await hashApprovedTree(forgeRoot);
    if (approvedBefore !== approvedAfter) throw new Error('Approved tree changed while freezing the Fable5 runtime ledger');
    return Object.freeze({
      status: 'frozen',
      ledger: rechecked.ledger,
      output: toPosixRelative(forgeRoot, rechecked.output),
      approvedTreeSha256Before: approvedBefore,
      approvedTreeSha256After: approvedAfter
    });
  });
}

export async function verifyFable5RuntimeAssetLedger({ ledgerPath }, dependencies = {}) {
  const forgeRoot = path.resolve(dependencies.forgeRoot ?? FORGE_ROOT);
  const projectRoot = projectRootFor(forgeRoot, dependencies.projectRoot);
  const normalizedLedgerPath = requireForgeRelativePath(ledgerPath, 'ledgerPath');
  if (!/^generated\/fable5-runtime-ledgers\/[a-f0-9]{64}\.json$/.test(normalizedLedgerPath)) {
    throw new Error('Fable5 runtime ledger must be a content-addressed generated/fable5-runtime-ledgers/<sha256>.json file');
  }
  const source = await readJsonWithin(forgeRoot, normalizedLedgerPath, 'Fable5 runtime asset ledger');
  const ledger = source.value;
  if (!ledger || ledger.format !== FABLE5_RUNTIME_ASSET_LEDGER_VERSION || ledger.status !== 'frozen'
    || !ledger.sourceInventory || !Array.isArray(ledger.trackedAssets) || !Array.isArray(ledger.runtimeAllowlist)
    || !SHA256.test(ledger.ledgerSha256 ?? '')) {
    throw new Error(`Expected frozen ${FABLE5_RUNTIME_ASSET_LEDGER_VERSION} ledger`);
  }
  const { ledgerSha256, ...withoutHash } = ledger;
  if (contentHash(withoutHash) !== ledgerSha256 || path.posix.basename(normalizedLedgerPath, '.json') !== ledgerSha256) {
    throw new Error('Fable5 runtime ledger content hash does not match its content-addressed filename');
  }
  const sourceInventory = ledger.sourceInventory;
  if (typeof sourceInventory.path !== 'string' || !SHA256.test(sourceInventory.sha256 ?? '')) {
    throw new Error('Fable5 runtime ledger source inventory receipt is invalid');
  }
  const rebuilt = await buildFromInventory({
    format: FABLE5_RUNTIME_ASSET_INVENTORY_VERSION,
    assets: ledger.trackedAssets.map(({ assetId, category, state, artifact, metadata, contract, job, approval, runtime }) => ({
      assetId,
      category,
      state,
      artifactPath: artifact?.path,
      metadataPath: metadata?.path,
      contractPath: contract?.path,
      jobPackPath: job?.path,
      approvalRecordPath: approval?.path ?? null,
      runtimePath: runtime?.path ?? null
    }))
  }, {
    forgeRoot,
    projectRoot,
    inventoryPath: sourceInventory.path,
    inventorySha256: sourceInventory.sha256
  });
  if (!sameJson(rebuilt, ledger)) throw new Error('Fable5 runtime ledger no longer matches its assets, approvals, contracts, jobs, provenance, or runtime bytes');
  return Object.freeze({
    status: 'verified',
    ledgerPath: normalizedLedgerPath,
    ledgerSha256,
    runtimeReady: ledger.runtimeReady,
    runtimeAssetCount: ledger.runtimeAllowlist.length,
    stateCounts: ledger.stateCounts
  });
}
