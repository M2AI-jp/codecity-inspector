import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { assertCanonicalInteractiveTerminal } from '../human-write-gate.mjs';
import { atomicReplaceJson, atomicWriteFile, atomicWriteJson, readJson, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, hashFile, sha256 } from '../hashing.mjs';
import { readExternalImage } from '../images/inspect-image.mjs';
import { readLocalGenerationManifest, replaceGenerationResult } from '../manifests/local-generations.mjs';
import {
  assertExistingFileWithin,
  assertExistingPendingCandidate,
  assetFileStem,
  categoryDirectory,
  toPosixRelative
} from '../paths.mjs';
import { assertGenerationReferenceMetadata } from '../references.mjs';
import { validateWith } from '../schemas.mjs';
import {
  inspectApprovalTopology,
  inspectHistoricalApprovedArtifact,
  productionRecipeProblem
} from '../validate.mjs';
import { findAsset } from './define-assets.mjs';

const ISSUED_LEGACY_PROMOTION_PREVIEWS = new WeakMap();

function assertLegacyV1PromotionCandidate(generation, definition, stage) {
  const v2Markers = generation?.requiredSetId === 'fable5-v2'
    || generation?.waveId === 'A'
    || generation?.visualContractVersion === 2
    || generation?.productionRecipesV2 !== undefined
    || generation?.unitAssemblyV2 !== undefined
    || definition?.requiredSetId === 'fable5-v2'
    || definition?.waveId === 'A'
    || definition?.visualContractVersion === 2;
  if (v2Markers) {
    throw new Error(`${stage} rejects Fable5 VisualAssetContract v2 / Wave A candidates; use the v3 bulk Wave A ceremony`);
  }
}

function validateGenerationId(generationId) {
  if (typeof generationId !== 'string' || !/^[a-z0-9_]+$/.test(generationId)) throw new Error('Invalid generation id');
  return generationId;
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function validateJournal(journal, generationId, kind) {
  const keys = kind === 'reject'
    ? ['schemaVersion', 'kind', 'generationId', 'assetId', 'category', 'sourcePath', 'sourceSha256', 'destinationPath', 'reason', 'transitionAt', 'status']
    : [
      'schemaVersion', 'kind', 'generationId', 'assetId', 'category', 'sourcePath',
      'sourceSha256', 'destinationPath', 'note', 'transitionAt', 'status',
      ...(kind === 'supersede' ? ['supersedesGenerationId'] : [])
    ];
  if (!hasExactKeys(journal, keys) || journal.schemaVersion !== 1 || journal.kind !== kind
    || !['reject', 'promote', 'supersede'].includes(kind)
    || journal.generationId !== generationId || !['preparing', 'complete'].includes(journal.status)
    || typeof journal.assetId !== 'string' || typeof journal.category !== 'string'
    || typeof journal.sourcePath !== 'string' || !/^[a-f0-9]{64}$/.test(journal.sourceSha256)
    || typeof journal.destinationPath !== 'string' || Number.isNaN(Date.parse(journal.transitionAt))) {
    throw new Error('Invalid lifecycle journal');
  }
  const stateDir = categoryDirectory(journal.category);
  if (!new RegExp(`^(generated|processed)/${stateDir}/pending/[a-z0-9_-]+\\.png$`).test(journal.sourcePath)) {
    throw new Error('Invalid lifecycle journal source');
  }
  const expectedDestination = kind === 'reject'
    ? `generated/${stateDir}/rejected/${assetFileStem(journal.assetId)}-${generationId}.png`
    : `generated/${stateDir}/approved/${assetFileStem(journal.assetId)}-${journal.sourceSha256.slice(0, 16)}.png`;
  if (journal.destinationPath !== expectedDestination) throw new Error('Invalid lifecycle journal destination');
  const decision = kind === 'reject' ? journal.reason : journal.note;
  if (typeof decision !== 'string' || !decision.trim()) throw new Error('Invalid lifecycle journal decision');
  if (kind === 'supersede' && (typeof journal.supersedesGenerationId !== 'string'
    || !/^[a-z0-9_]+$/.test(journal.supersedesGenerationId)
    || journal.supersedesGenerationId === generationId)) {
    throw new Error('Invalid lifecycle journal supersession');
  }
  return journal;
}

async function generationResult(root, generationId) {
  const manifest = await readLocalGenerationManifest(root);
  const result = manifest.results.find((entry) => entry.id === generationId);
  if (!result) throw new Error(`Unknown generation result: ${generationId}`);
  return result;
}

async function checkedPending(root, result) {
  if (result.status !== 'pending' || !result.outputPath || !result.outputSha256) throw new Error('Only a pending candidate can transition');
  const sourcePath = await assertExistingPendingCandidate(root, result.category, result.outputPath);
  const sourceBytes = await readFile(sourcePath);
  const sourceSha256 = sha256(sourceBytes);
  if (sourceSha256 !== result.outputSha256) throw new Error('Candidate hash mismatch');
  return { result, sourcePath, sourceBytes, sourceSha256 };
}

async function assertRecipeReadyForPromotion(root, result, forgeRoot, definition, outputBytes) {
  const problem = await productionRecipeProblem(root, result, { forgeRoot, definition, outputBytes });
  if (problem) throw new Error(`Production recipe integrity failed: ${problem}`);
  if (result.productionRecipe && !result.productionRecipe.sourceSnapshot) {
    throw new Error('Promotion requires a verified persistent original source snapshot');
  }
}

export async function materializeProductionSourceSnapshot({ generationId }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  validateGenerationId(generationId);
  const paths = pathsFor(root);
  return withFileLock(root, paths.requiredPromotionLock, () =>
    withFileLock(root, paths.lifecycleLock, async () => {
    const current = await generationResult(root, generationId);
    const pending = await checkedPending(root, current);
    const definition = await findAsset(current.assetId, { root: forgeRoot });
    await assertGenerationReferenceMetadata(definition, current, { root: forgeRoot });
    const recipeProblem = await productionRecipeProblem(root, current, {
      forgeRoot, definition, outputBytes: pending.sourceBytes, requirePersistentSourceSnapshot: false
    });
    if (recipeProblem) throw new Error(`Production recipe integrity failed: ${recipeProblem}`);
    if (!current.productionRecipe) throw new Error('A verified production recipe is required to persist its original source');
    if (current.productionRecipe.sourceSnapshot) {
      await assertRecipeReadyForPromotion(root, current, forgeRoot, definition, pending.sourceBytes);
      return { status: 'source-snapshot-ready', result: current, resumed: true };
    }

    const sourcePath = await assertExistingFileWithin(forgeRoot, current.productionRecipe.source.path);
    const original = await readExternalImage(sourcePath);
    const source = current.productionRecipe.source;
    if (sha256(original.buffer) !== source.sha256
      || original.metadata.width !== source.width
      || original.metadata.height !== source.height) {
      throw new Error('Production recipe original source changed before persistence');
    }
    const extension = original.sourceFormat === 'jpeg' ? 'jpg' : original.sourceFormat;
    const snapshotPath = path.join(
      paths.generated,
      categoryDirectory(current.category),
      'pending',
      'sources',
      `source-${source.sha256}.source-original.${extension}`
    );
    const sourceSnapshot = {
      path: toPosixRelative(root, snapshotPath),
      sha256: source.sha256,
      width: source.width,
      height: source.height
    };
    await writeFileOrVerify(root, snapshotPath, original.buffer);
    if (await hashFile(snapshotPath) !== source.sha256) throw new Error('Persistent original source snapshot hash mismatch');

    const corrected = {
      ...current,
      productionRecipe: { ...current.productionRecipe, sourceSnapshot }
    };
    const validation = validateWith('generation-result.schema.json', corrected);
    if (!validation.ok) throw new Error(`Invalid source-snapshot result: ${JSON.stringify(validation.errors)}`);
    const metadataPath = path.join(root, ...current.metadataPath.split('/'));
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (!isDeepStrictEqual(metadata, current) && !isDeepStrictEqual(metadata, corrected)) {
      throw new Error('Generation metadata and ledger differ before source-snapshot persistence');
    }
    const outputHashBefore = await hashFile(pending.sourcePath);
    if (!isDeepStrictEqual(metadata, corrected)) await atomicReplaceJson(root, metadataPath, corrected);
    const result = await replaceGenerationResult(root, generationId, (latest) => {
      if (isDeepStrictEqual(latest, corrected)) return latest;
      if (!isDeepStrictEqual(latest, current)) throw new Error('Generation changed during source-snapshot persistence');
      return corrected;
    });
    if (await hashFile(pending.sourcePath) !== outputHashBefore || outputHashBefore !== current.outputSha256) {
      throw new Error('Candidate output changed during source-snapshot persistence');
    }
    await assertRecipeReadyForPromotion(root, result, forgeRoot, definition, pending.sourceBytes);
    return {
      status: 'source-snapshot-ready',
      result,
      resumed: false,
      sourceSnapshot,
      outputSha256: current.outputSha256,
      outputBytesUnchanged: true
    };
    }));
}

async function writeFileOrVerify(root, destination, bytes) {
  try {
    await atomicWriteFile(root, destination, bytes);
    return 'written';
  } catch (error) {
    let existing;
    try {
      const relative = toPosixRelative(root, destination);
      existing = await readFile(await assertExistingFileWithin(root, relative));
    } catch { throw error; }
    if (!existing.equals(Buffer.from(bytes))) throw error;
    return 'existing-identical';
  }
}

async function writeJsonOrVerify(root, destination, value) {
  return writeFileOrVerify(root, destination, Buffer.from(canonicalJson(value)));
}

async function lifecycleJournal(root, generationId, initial) {
  const journalPath = path.join(pathsFor(root).local, 'lifecycle', `${validateGenerationId(generationId)}.json`);
  const existing = await readJson(journalPath, { allowMissing: true, fallback: null });
  if (existing) {
    return { journalPath, journal: validateJournal(existing, generationId, initial.kind) };
  }
  validateJournal(initial, generationId, initial.kind);
  await atomicWriteJson(root, journalPath, initial);
  return { journalPath, journal: initial };
}

async function completeJournal(root, journalPath, journal) {
  if (journal.status === 'complete') return;
  await atomicReplaceJson(root, journalPath, { ...journal, status: 'complete' });
}

export async function rejectCandidate({ generationId, reason }, {
  root = FORGE_ROOT,
  now = () => new Date().toISOString()
} = {}) {
  validateGenerationId(generationId);
  const rejectionReason = String(reason ?? '').trim();
  if (!rejectionReason) throw new Error('--reason is required');
  const paths = pathsFor(root);
  return withFileLock(root, paths.lifecycleLock, async () => {
    let current = await generationResult(root, generationId);
    const initialPending = current.status === 'pending' ? await checkedPending(root, current) : null;
    const initial = {
      schemaVersion: 1,
      kind: 'reject',
      generationId,
      assetId: current.assetId,
      category: current.category,
      sourcePath: current.outputPath,
      sourceSha256: current.outputSha256,
      destinationPath: `generated/${categoryDirectory(current.category)}/rejected/${assetFileStem(current.assetId)}-${generationId}.png`,
      reason: rejectionReason,
      transitionAt: now(),
      status: 'preparing'
    };
    const { journalPath, journal } = await lifecycleJournal(root, generationId, initial);
    if (journal.reason !== rejectionReason) throw new Error('Reject retry must use the original reason');
    if (current.status === 'rejected') {
      if (current.outputPath !== journal.destinationPath || current.outputSha256 !== journal.sourceSha256) throw new Error('Rejected result conflicts with lifecycle journal');
      await completeJournal(root, journalPath, journal);
      return { status: 'rejected', result: current, resumed: true };
    }
    if (!initialPending || current.assetId !== journal.assetId || current.category !== journal.category
      || current.outputPath !== journal.sourcePath || initialPending.sourceSha256 !== journal.sourceSha256) {
      throw new Error('Pending candidate changed after lifecycle journal creation');
    }
    const destination = path.join(root, ...journal.destinationPath.split('/'));
    const metadataPath = destination.replace(/\.png$/, '.json');
    const rejected = {
      ...current,
      status: 'rejected',
      outputPath: journal.destinationPath,
      outputSha256: journal.sourceSha256,
      metadataPath: toPosixRelative(root, metadataPath),
      rejection: { reason: journal.reason, rejectedAt: journal.transitionAt },
      inspection: {
        ...current.inspection,
        observed: [...current.inspection.observed, 'Candidate was copied to rejected state with the same SHA-256.'],
        unknown: [...new Set([...current.inspection.unknown, 'whether a future candidate will be suitable'])]
      }
    };
    const validation = validateWith('generation-result.schema.json', rejected);
    if (!validation.ok) throw new Error(`Invalid rejection result: ${JSON.stringify(validation.errors)}`);
    await writeFileOrVerify(root, destination, initialPending.sourceBytes);
    await writeJsonOrVerify(root, metadataPath, rejected);
    current = await replaceGenerationResult(root, generationId, (latest) => {
      if (latest.status === 'rejected' && latest.outputPath === rejected.outputPath) return latest;
      if (latest.status !== 'pending' || latest.outputPath !== journal.sourcePath || latest.outputSha256 !== journal.sourceSha256) {
        throw new Error('Candidate state changed during rejection');
      }
      return rejected;
    });
    await completeJournal(root, journalPath, journal);
    return { status: 'rejected', result: current };
  });
}

function supersededGenerationIds(approvals) {
  return new Set((approvals.supersessions ?? []).map((entry) => entry.supersededGenerationId));
}

async function assertApprovedArtifact({ root, forgeRoot, assetEntry, approval }) {
  if (!approval || approval.assetId !== assetEntry.assetId
    || !assetEntry.category || assetEntry.approvedPath !== approval.approvedPath) {
    throw new Error('Current approved asset/approval record is inconsistent');
  }
  const historical = await inspectHistoricalApprovedArtifact(root, approval, {
    forgeRoot,
    category: assetEntry.category
  });
  if (historical.problem) throw new Error(`Current approved artifact integrity failed: ${historical.problem}`);
  return historical;
}

async function replacementContext({
  root, assetId, category, replacementGenerationId, replacementApprovedPath,
  replacementApprovedSha256, supersedesGenerationId, requireState = false,
  allowApprovedResume = false, forgeRoot = FORGE_ROOT
}) {
  const paths = pathsFor(root);
  const [assets, approvals] = await Promise.all([
    readJson(paths.assetManifest, { allowMissing: true, fallback: null }),
    readJson(paths.approvalManifest, { allowMissing: true, fallback: null })
  ]);
  if (!assets || !approvals) {
    if (requireState || supersedesGenerationId) {
      throw new Error('Supersession requires complete asset and approval manifests');
    }
    return { assets: null, approvals: null, assetIndex: -1, assetEntry: null, supersession: null, resumed: false };
  }
  for (const [schema, value] of [
    ['asset-manifest.schema.json', assets],
    ['approval-manifest.schema.json', approvals]
  ]) {
    const validation = validateWith(schema, value);
    if (!validation.ok) throw new Error(`Invalid supersession input ${schema}: ${JSON.stringify(validation.errors)}`);
  }
  const topology = inspectApprovalTopology(approvals, assets);
  if (topology.problem) throw new Error(`Invalid approval topology: ${topology.problem}`);
  const assetIndex = assets.assets.findIndex((entry) => entry.assetId === assetId);
  if (assetIndex < 0) throw new Error('Asset manifest entry is missing');
  const assetEntry = assets.assets[assetIndex];
  if (assetEntry.category !== category) throw new Error('Asset manifest category does not match generation');
  const recorded = (approvals.supersessions ?? []).find((entry) => entry.replacementGenerationId === replacementGenerationId);
  if (recorded) {
    const previousApproval = approvals.approvals.find((entry) => entry.generationId === recorded.supersededGenerationId);
    const replacementApproval = approvals.approvals.find((entry) => entry.generationId === recorded.replacementGenerationId);
    if (recorded.assetId !== assetId || recorded.supersededGenerationId !== supersedesGenerationId
      || recorded.replacementApprovedPath !== replacementApprovedPath
      || recorded.replacementApprovedSha256 !== replacementApprovedSha256
      || !previousApproval || previousApproval.assetId !== assetId
      || previousApproval.approvedPath !== recorded.supersededApprovedPath
      || previousApproval.approvedSha256 !== recorded.supersededApprovedSha256
      || !replacementApproval || replacementApproval.assetId !== assetId
      || replacementApproval.approvedPath !== recorded.replacementApprovedPath
      || replacementApproval.approvedSha256 !== recorded.replacementApprovedSha256
      || replacementApproval.reviewer !== recorded.reviewer
      || replacementApproval.note !== recorded.note
      || replacementApproval.approvedAt !== recorded.supersededAt
      || !['approved', 'exported'].includes(assetEntry.status)
      || ![recorded.supersededApprovedPath, recorded.replacementApprovedPath].includes(assetEntry.approvedPath)) {
      throw new Error('Recorded supersession conflicts with replacement candidate');
    }
    await assertApprovedArtifact({
      root,
      forgeRoot,
      assetEntry: { ...assetEntry, approvedPath: recorded.supersededApprovedPath },
      approval: previousApproval
    });
    return { assets, approvals, assetIndex, assetEntry, supersession: recorded, resumed: true };
  }
  if (allowApprovedResume && ['approved', 'exported'].includes(assetEntry.status)
    && assetEntry.approvedPath === replacementApprovedPath && !supersedesGenerationId) {
    const currentApproval = approvals.approvals.find((entry) => entry.approvedPath === replacementApprovedPath);
    if (!currentApproval || currentApproval.generationId !== replacementGenerationId
      || currentApproval.approvedSha256 !== replacementApprovedSha256) {
      throw new Error('Approved resume does not match the current approval record');
    }
    await assertApprovedArtifact({ root, forgeRoot, assetEntry, approval: currentApproval });
    return { assets, approvals, assetIndex, assetEntry, supersession: null, resumed: true };
  }
  if (!['approved', 'exported'].includes(assetEntry.status)) {
    if (supersedesGenerationId) throw new Error('--supersedes requires a currently approved version of the same asset');
    return { assets, approvals, assetIndex, assetEntry, supersession: null, resumed: false };
  }
  if (!supersedesGenerationId) {
    throw new Error(`Asset already has an approved version; pass --supersedes with its generation id: ${assetId}`);
  }
  if (assetEntry.approvedPath === replacementApprovedPath) {
    throw new Error('Replacement candidate is byte-identical to the current approved version');
  }
  const currentApproval = approvals.approvals.find((entry) => entry.approvedPath === assetEntry.approvedPath);
  if (!currentApproval || currentApproval.assetId !== assetId
    || currentApproval.generationId !== supersedesGenerationId) {
    throw new Error('--supersedes does not identify the current approved version');
  }
  if (supersededGenerationIds(approvals).has(supersedesGenerationId)) {
    throw new Error('The selected approved generation is already superseded');
  }
  if ((approvals.supersessions ?? []).some((entry) => entry.replacementGenerationId === replacementGenerationId)) {
    throw new Error('Replacement generation already participates in a supersession');
  }
  await assertApprovedArtifact({
    root, forgeRoot, assetEntry, approval: currentApproval
  });
  return {
    assets,
    approvals,
    assetIndex,
    assetEntry,
    resumed: false,
    supersession: {
      assetId,
      supersededGenerationId: currentApproval.generationId,
      supersededApprovedPath: currentApproval.approvedPath,
      supersededApprovedSha256: currentApproval.approvedSha256,
      replacementGenerationId,
      replacementApprovedPath,
      replacementApprovedSha256
    }
  };
}

async function preparingReplacementContext({
  root,
  forgeRoot,
  current,
  journal,
  supersedesGenerationId
}) {
  const paths = pathsFor(root);
  const [assets, approvals] = await Promise.all([
    readJson(paths.assetManifest),
    readJson(paths.approvalManifest)
  ]);
  for (const [schema, value] of [
    ['asset-manifest.schema.json', assets],
    ['approval-manifest.schema.json', approvals]
  ]) {
    const validation = validateWith(schema, value);
    if (!validation.ok) throw new Error(`Invalid preparing promotion input ${schema}: ${JSON.stringify(validation.errors)}`);
  }
  const assetIndex = assets.assets.findIndex((entry) => entry.assetId === current.assetId);
  if (assetIndex < 0) throw new Error('Asset manifest entry is missing');
  const assetEntry = assets.assets[assetIndex];
  if (assetEntry.category !== current.category) throw new Error('Asset manifest category does not match generation');
  if (journal.kind === 'promote') {
    if (supersedesGenerationId) throw new Error('Promotion retry must preserve the original supersession selection');
    if (['approved', 'exported'].includes(assetEntry.status)
      && assetEntry.approvedPath !== journal.destinationPath) {
      throw new Error('Preparing promotion would replace an existing approval without supersession');
    }
  } else if (journal.supersedesGenerationId !== supersedesGenerationId) {
    throw new Error('Promotion retry must preserve the original supersession selection');
  }
  const approvalRecord = {
    generationId: current.id,
    assetId: current.assetId,
    reviewer: 'human',
    note: journal.note,
    approvedAt: journal.transitionAt,
    sourcePath: journal.sourcePath,
    sourceSha256: journal.sourceSha256,
    approvedPath: journal.destinationPath,
    approvedSha256: journal.sourceSha256
  };
  let supersession = null;
  if (journal.kind === 'supersede') {
    if (!['approved', 'exported'].includes(assetEntry.status)
      || ![journal.destinationPath, approvals.approvals.find((entry) =>
        entry.generationId === journal.supersedesGenerationId)?.approvedPath].includes(assetEntry.approvedPath)) {
      throw new Error('Preparing supersession asset pointer is neither the former nor replacement approval');
    }
    const previous = approvals.approvals.find((entry) => entry.generationId === journal.supersedesGenerationId);
    if (!previous || previous.assetId !== current.assetId) {
      throw new Error('Preparing supersession former approval is missing');
    }
    supersession = {
      assetId: current.assetId,
      supersededGenerationId: previous.generationId,
      supersededApprovedPath: previous.approvedPath,
      supersededApprovedSha256: previous.approvedSha256,
      replacementGenerationId: current.id,
      replacementApprovedPath: journal.destinationPath,
      replacementApprovedSha256: journal.sourceSha256,
      reviewer: 'human',
      note: journal.note,
      supersededAt: journal.transitionAt
    };
    await assertApprovedArtifact({
      root,
      forgeRoot,
      assetEntry: { ...assetEntry, approvedPath: previous.approvedPath },
      approval: previous
    });
  }
  const updatedApprovals = appendApprovalTransition(approvals, approvalRecord, supersession);
  const updatedAssets = structuredClone(assets);
  updatedAssets.assets[assetIndex] = {
    ...assetEntry,
    status: 'approved',
    approvedPath: journal.destinationPath,
    lastUpdated: journal.transitionAt
  };
  const topology = inspectApprovalTopology(updatedApprovals, updatedAssets);
  if (topology.problem) throw new Error(`Invalid preparing promotion topology: ${topology.problem}`);
  return {
    assets,
    approvals,
    updatedAssets,
    updatedApprovals,
    assetIndex,
    assetEntry,
    approvalRecord,
    supersession: supersession && {
      assetId: supersession.assetId,
      supersededGenerationId: supersession.supersededGenerationId,
      supersededApprovedPath: supersession.supersededApprovedPath,
      supersededApprovedSha256: supersession.supersededApprovedSha256,
      replacementGenerationId: supersession.replacementGenerationId,
      replacementApprovedPath: supersession.replacementApprovedPath,
      replacementApprovedSha256: supersession.replacementApprovedSha256
    },
    supersessionRecord: supersession,
    resumed: true
  };
}

export function appendApprovalTransition(approvals, approvalRecord, supersession = null) {
  const existingApproval = approvals.approvals.find((entry) => entry.generationId === approvalRecord.generationId
    || entry.approvedPath === approvalRecord.approvedPath);
  if (existingApproval && canonicalJson(existingApproval) !== canonicalJson(approvalRecord)) {
    throw new Error('Approval record collision');
  }
  const next = existingApproval ? structuredClone(approvals) : {
    ...structuredClone(approvals),
    approvals: [...approvals.approvals, approvalRecord]
  };
  if (!supersession) return next;
  const oldApproval = next.approvals.find((entry) => entry.generationId === supersession.supersededGenerationId);
  if (!oldApproval || oldApproval.assetId !== supersession.assetId
    || oldApproval.approvedPath !== supersession.supersededApprovedPath
    || oldApproval.approvedSha256 !== supersession.supersededApprovedSha256) {
    throw new Error('Superseded approval history is missing or changed');
  }
  const replacementApproval = next.approvals.find((entry) => entry.generationId === supersession.replacementGenerationId);
  if (!replacementApproval || replacementApproval.assetId !== supersession.assetId
    || replacementApproval.approvedPath !== supersession.replacementApprovedPath
    || replacementApproval.approvedSha256 !== supersession.replacementApprovedSha256
    || replacementApproval.reviewer !== supersession.reviewer
    || replacementApproval.note !== supersession.note
    || replacementApproval.approvedAt !== supersession.supersededAt) {
    throw new Error('Replacement approval does not match its supersession decision');
  }
  const existing = (next.supersessions ?? []).find((entry) => entry.supersededGenerationId === supersession.supersededGenerationId
    || entry.replacementGenerationId === supersession.replacementGenerationId);
  if (existing && canonicalJson(existing) !== canonicalJson(supersession)) {
    throw new Error('Supersession record collision');
  }
  if (!existing) next.supersessions = [...(next.supersessions ?? []), supersession];
  return next;
}

async function promotionPreviewAtRoot({ generationId, supersedesGenerationId }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  const id = validateGenerationId(generationId);
  const current = await generationResult(root, id);
  const definition = await findAsset(current.assetId, { root: forgeRoot });
  assertLegacyV1PromotionCandidate(current, definition, 'Legacy promotion preview');
  if (current.status === 'pending') {
    const pending = await checkedPending(root, current);
    await assertGenerationReferenceMetadata(definition, pending.result, { root: forgeRoot });
    await assertRecipeReadyForPromotion(root, pending.result, forgeRoot, definition, pending.sourceBytes);
    const approvedPath = path.join(pathsFor(root).generated, categoryDirectory(pending.result.category), 'approved', `${assetFileStem(pending.result.assetId)}-${pending.sourceSha256.slice(0, 16)}.png`);
    const approvedRelative = toPosixRelative(root, approvedPath);
    const journalPath = path.join(pathsFor(root).local, 'lifecycle', `${id}.json`);
    const rawJournal = await readJson(journalPath, { allowMissing: true, fallback: null });
    let replacement;
    if (rawJournal) {
      if (rawJournal.status !== 'preparing' || !['promote', 'supersede'].includes(rawJournal.kind)) {
        throw new Error('Pending generation has a non-resumable promotion journal');
      }
      const journal = validateJournal(rawJournal, id, rawJournal.kind);
      if (journal.assetId !== current.assetId || journal.category !== current.category
        || journal.sourcePath !== current.outputPath || journal.sourceSha256 !== pending.sourceSha256
        || journal.destinationPath !== approvedRelative
        || (journal.kind === 'supersede' && journal.supersedesGenerationId !== supersedesGenerationId)
        || (journal.kind === 'promote' && supersedesGenerationId)) {
        throw new Error('Pending generation conflicts with its preparing promotion journal');
      }
      replacement = await preparingReplacementContext({
        root, forgeRoot, current, journal, supersedesGenerationId
      });
    } else {
      replacement = await replacementContext({
        root,
        assetId: pending.result.assetId,
        category: pending.result.category,
        replacementGenerationId: generationId,
        replacementApprovedPath: approvedRelative,
        replacementApprovedSha256: pending.sourceSha256,
        supersedesGenerationId,
        forgeRoot,
        definition
      });
    }
    return {
      generationId,
      assetId: pending.result.assetId,
      sourcePath: pending.result.outputPath,
      sourceSha256: pending.sourceSha256,
      approvedPath: approvedRelative,
      approvedSha256: pending.sourceSha256,
      ...(rawJournal ? { resumed: true } : {}),
      ...(replacement.supersession ? {
        supersedes: {
          generationId: replacement.supersession.supersededGenerationId,
          approvedPath: replacement.supersession.supersededApprovedPath,
          approvedSha256: replacement.supersession.supersededApprovedSha256
        }
      } : {})
    };
  }
  if (current.status !== 'approved') throw new Error('Only a pending candidate can transition');
  const journalPath = path.join(pathsFor(root).local, 'lifecycle', `${id}.json`);
  const rawJournal = await readJson(journalPath, { allowMissing: true, fallback: null });
  if (!rawJournal || rawJournal.status !== 'preparing' || !['promote', 'supersede'].includes(rawJournal.kind)) {
    throw new Error('Approved generation is not a resumable preparing promotion');
  }
  const journal = validateJournal(rawJournal, id, rawJournal.kind);
  if ((journal.kind === 'supersede' && journal.supersedesGenerationId !== supersedesGenerationId)
    || (journal.kind === 'promote' && supersedesGenerationId)) {
    throw new Error('Promotion retry must preserve the original supersession selection');
  }
  if (current.assetId !== journal.assetId || current.category !== journal.category
    || current.outputPath !== journal.destinationPath || current.outputSha256 !== journal.sourceSha256
    || current.approval?.note !== journal.note || current.approval?.approvedAt !== journal.transitionAt
    || current.approval?.approvedPath !== journal.destinationPath
    || current.approval?.approvedSha256 !== journal.sourceSha256) {
    throw new Error('Approved generation conflicts with its preparing promotion journal');
  }
  const pendingSource = await assertExistingPendingCandidate(root, current.category, journal.sourcePath);
  if (await hashFile(pendingSource) !== journal.sourceSha256) {
    throw new Error('Preparing promotion source hash changed');
  }
  await assertGenerationReferenceMetadata(definition, current, { root: forgeRoot });
  await assertRecipeReadyForPromotion(root, current, forgeRoot, definition);
  const replacement = await replacementContext({
    root,
    assetId: current.assetId,
    category: current.category,
    replacementGenerationId: id,
    replacementApprovedPath: journal.destinationPath,
    replacementApprovedSha256: journal.sourceSha256,
    supersedesGenerationId,
    requireState: true,
    allowApprovedResume: true,
    forgeRoot,
    definition
  });
  if (replacement.assetEntry.approvedPath !== journal.destinationPath) {
    throw new Error('Preparing promotion current pointer did not reach the approved generation');
  }
  const currentApproval = replacement.approvals.approvals.find((entry) => entry.generationId === id);
  await assertApprovedArtifact({
    root, forgeRoot, assetEntry: replacement.assetEntry, approval: currentApproval
  });
  return {
    generationId: id,
    assetId: current.assetId,
    sourcePath: journal.sourcePath,
    sourceSha256: journal.sourceSha256,
    approvedPath: journal.destinationPath,
    approvedSha256: journal.sourceSha256,
    resumed: true,
    ...(journal.kind === 'supersede' ? {
      supersedes: {
        generationId: replacement.supersession.supersededGenerationId,
        approvedPath: replacement.supersession.supersededApprovedPath,
        approvedSha256: replacement.supersession.supersededApprovedSha256
      }
    } : {})
  };
}

export async function promotionPreviewInternal(input, options = {}) {
  return promotionPreviewAtRoot(input, options);
}

export async function promotionPreview(input) {
  if (arguments.length !== 1 || !input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['generationId', 'supersedesGenerationId', 'note'].includes(key))) {
    throw new Error('Legacy promotion public preview accepts only generationId, supersedesGenerationId, and note');
  }
  const note = String(input.note ?? '').trim();
  if (!note) throw new Error('Legacy promotion public preview requires a non-empty note');
  const core = await promotionPreviewAtRoot({
    generationId: input.generationId,
    supersedesGenerationId: input.supersedesGenerationId
  }, { root: FORGE_ROOT, forgeRoot: FORGE_ROOT });
  const plan = { ...core, note };
  const planDigest = sha256(canonicalJson(plan));
  const preview = {
    ...plan,
    planDigest,
    confirmationPhrase: `APPROVE LEGACY PROMOTION ${planDigest}`
  };
  ISSUED_LEGACY_PROMOTION_PREVIEWS.set(preview, sha256(canonicalJson(preview)));
  return preview;
}

export async function promoteCandidateInternal({
  generationId, reviewer, note, write, confirmed,
  expectedSourceSha256, expectedApprovedPath, supersedesGenerationId
}, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  now = () => new Date().toISOString(),
  hooks = {}
} = {}) {
  validateGenerationId(generationId);
  const preview = await promotionPreviewAtRoot({ generationId, supersedesGenerationId }, { root, forgeRoot });
  if (reviewer !== 'human' || !write || !confirmed) {
    throw new Error('Promotion requires an interactive human reviewer, --write, and explicit confirmation');
  }
  const approvalNote = String(note ?? '').trim();
  if (!approvalNote) throw new Error('--note is required');
  if (!/^[a-f0-9]{64}$/.test(expectedSourceSha256 ?? '') || typeof expectedApprovedPath !== 'string') {
    throw new Error('Promotion requires the exact previewed hash and destination');
  }
  if (preview.sourceSha256 !== expectedSourceSha256 || preview.approvedPath !== expectedApprovedPath) {
    throw new Error('Promotion requires the exact previewed hash and destination');
  }
  const paths = pathsFor(root);
  return withFileLock(root, paths.lifecycleLock, async () => {
    let current = await generationResult(root, generationId);
    const definition = await findAsset(current.assetId, { root: forgeRoot });
    assertLegacyV1PromotionCandidate(current, definition, 'Legacy promotion write');
    await assertGenerationReferenceMetadata(definition, current, { root: forgeRoot });
    const pending = current.status === 'pending' ? await checkedPending(root, current) : null;
    await assertRecipeReadyForPromotion(root, current, forgeRoot, definition, pending?.sourceBytes);
    const computedApprovedPath = pending
      ? `generated/${categoryDirectory(current.category)}/approved/${assetFileStem(current.assetId)}-${pending.sourceSha256.slice(0, 16)}.png`
      : current.approval?.approvedPath;
    if (pending && (expectedSourceSha256 !== pending.sourceSha256 || expectedApprovedPath !== computedApprovedPath)) {
      throw new Error('Candidate no longer matches the preview confirmed by the human reviewer');
    }
    const existingJournalPath = path.join(pathsFor(root).local, 'lifecycle', `${generationId}.json`);
    const existingJournal = await readJson(existingJournalPath, { allowMissing: true, fallback: null });
    if (current.status === 'pending' && existingJournal && existingJournal.status !== 'preparing') {
      throw new Error('Pending generation has a non-resumable promotion journal');
    }
    const replacement = current.status === 'pending' && existingJournal
      ? await preparingReplacementContext({
          root,
          forgeRoot,
          current,
          journal: validateJournal(existingJournal, generationId, existingJournal.kind),
          supersedesGenerationId
        })
      : await replacementContext({
          root,
          assetId: current.assetId,
          category: current.category,
          replacementGenerationId: generationId,
          replacementApprovedPath: computedApprovedPath,
          replacementApprovedSha256: pending?.sourceSha256 ?? current.approval?.approvedSha256,
          supersedesGenerationId,
          requireState: true,
          allowApprovedResume: current.status === 'approved',
          forgeRoot,
          definition
        });
    const initial = {
      schemaVersion: 1,
      kind: replacement.supersession ? 'supersede' : 'promote',
      generationId,
      assetId: current.assetId,
      category: current.category,
      sourcePath: pending?.result.outputPath ?? preview.sourcePath,
      sourceSha256: pending?.sourceSha256 ?? preview.sourceSha256,
      destinationPath: computedApprovedPath,
      note: approvalNote,
      transitionAt: now(),
      status: 'preparing',
      ...(replacement.supersession ? { supersedesGenerationId: replacement.supersession.supersededGenerationId } : {})
    };
    const { journalPath, journal } = await lifecycleJournal(root, generationId, initial);
    if (journal.note !== approvalNote) throw new Error('Promotion retry must use the original note');
    if (journal.kind === 'supersede' && journal.supersedesGenerationId !== supersedesGenerationId) {
      throw new Error('Promotion retry must supersede the originally selected generation');
    }
    if (expectedSourceSha256 !== journal.sourceSha256 || expectedApprovedPath !== journal.destinationPath) {
      throw new Error('Candidate no longer matches the preview confirmed by the human reviewer');
    }
    if (current.status === 'approved') {
      if (current.outputPath !== journal.destinationPath || current.outputSha256 !== journal.sourceSha256) throw new Error('Approved result conflicts with lifecycle journal');
      await completeJournal(root, journalPath, journal);
      return { status: 'approved', result: current, resumed: true };
    }
    if (!pending || current.assetId !== journal.assetId || current.category !== journal.category
      || current.outputPath !== journal.sourcePath || pending.sourceSha256 !== journal.sourceSha256) {
      throw new Error('Pending candidate changed after lifecycle journal creation');
    }
    if (definition.category !== current.category) throw new Error('Generation asset/category does not match its definition');
    const approvedPath = path.join(root, ...journal.destinationPath.split('/'));
    const metadataPath = approvedPath.replace(/\.png$/, '.json');
    const approval = {
      reviewer: 'human', note: journal.note, approvedAt: journal.transitionAt,
      approvedPath: journal.destinationPath, approvedSha256: journal.sourceSha256
    };
    let approvedProductionRecipe = current.productionRecipe;
    let approvedSourceSnapshot = null;
    if (pending && current.productionRecipe?.sourceSnapshot) {
      const snapshot = current.productionRecipe.sourceSnapshot;
      const pendingSnapshotPath = await assertExistingFileWithin(root, snapshot.path);
      const original = await readExternalImage(pendingSnapshotPath);
      if (sha256(original.buffer) !== snapshot.sha256
        || original.metadata.width !== snapshot.width
        || original.metadata.height !== snapshot.height) {
        throw new Error('Pending production source snapshot changed before promotion');
      }
      const extension = original.sourceFormat === 'jpeg' ? 'jpg' : original.sourceFormat;
      const destination = path.join(
        paths.generated,
        categoryDirectory(current.category),
        'approved',
        `source-${snapshot.sha256}.source-original.${extension}`
      );
      approvedSourceSnapshot = { destination, bytes: original.buffer };
      approvedProductionRecipe = {
        ...current.productionRecipe,
        sourceSnapshot: { ...snapshot, path: toPosixRelative(root, destination) }
      };
    }
    const approved = {
      ...current,
      status: 'approved',
      outputPath: journal.destinationPath,
      outputSha256: journal.sourceSha256,
      metadataPath: toPosixRelative(root, metadataPath),
      approval,
      ...(approvedProductionRecipe ? { productionRecipe: approvedProductionRecipe } : {}),
      inspection: {
        ...current.inspection,
        observed: [...current.inspection.observed, 'A human-only promotion ceremony recorded an immutable approved copy.'],
        unknown: current.inspection.unknown.filter((item) => item !== 'human approval')
      }
    };

    const approvals = replacement.approvals;
    const approvalValidation = validateWith('approval-manifest.schema.json', approvals);
    if (!approvalValidation.ok) throw new Error(`Invalid current approval manifest: ${JSON.stringify(approvalValidation.errors)}`);
    const approvalRecord = {
      generationId, assetId: current.assetId, reviewer: 'human', note: journal.note, approvedAt: journal.transitionAt,
      sourcePath: journal.sourcePath, sourceSha256: journal.sourceSha256,
      approvedPath: journal.destinationPath, approvedSha256: journal.sourceSha256
    };
    const supersessionRecord = replacement.supersession ? {
      ...replacement.supersession,
      reviewer: 'human',
      note: journal.note,
      supersededAt: journal.transitionAt
    } : null;
    const updatedApprovals = appendApprovalTransition(approvals, approvalRecord, supersessionRecord);
    const updatedApprovalValidation = validateWith('approval-manifest.schema.json', updatedApprovals);
    if (!updatedApprovalValidation.ok) throw new Error(`Invalid updated approval manifest: ${JSON.stringify(updatedApprovalValidation.errors)}`);

    const assets = replacement.assets;
    const assetValidation = validateWith('asset-manifest.schema.json', assets);
    if (!assetValidation.ok) throw new Error(`Invalid current asset manifest: ${JSON.stringify(assetValidation.errors)}`);
    const assetIndex = assets.assets.findIndex((entry) => entry.assetId === current.assetId);
    if (assetIndex < 0) throw new Error('Asset manifest entry is missing');
    const assetEntry = assets.assets[assetIndex];
    if (assetEntry.category !== current.category) throw new Error('Asset manifest category does not match generation');
    if (['approved', 'exported'].includes(assetEntry.status) && assetEntry.approvedPath !== journal.destinationPath
      && !replacement.supersession) {
      throw new Error('Asset already has a different approved version');
    }
    const updatedAssets = structuredClone(assets);
    updatedAssets.assets[assetIndex] = {
      ...assetEntry, status: 'approved', approvedPath: journal.destinationPath, lastUpdated: journal.transitionAt
    };
    const updatedAssetValidation = validateWith('asset-manifest.schema.json', updatedAssets);
    if (!updatedAssetValidation.ok) throw new Error(`Invalid updated asset manifest: ${JSON.stringify(updatedAssetValidation.errors)}`);
    const resultValidation = validateWith('generation-result.schema.json', approved);
    if (!resultValidation.ok) throw new Error(`Invalid approval result: ${JSON.stringify(resultValidation.errors)}`);

    // Recheck immediately before the first authoritative artifact write. This
    // prevents a v2/A record from entering the legacy approved tree even if a
    // caller races mutable state between preview and execution.
    assertLegacyV1PromotionCandidate(current, definition, 'Legacy promotion commit');
    await writeFileOrVerify(root, approvedPath, pending.sourceBytes);
    if (await hashFile(approvedPath) !== journal.sourceSha256) throw new Error('Approved copy hash mismatch');
    if (approvedSourceSnapshot) {
      await writeFileOrVerify(root, approvedSourceSnapshot.destination, approvedSourceSnapshot.bytes);
      if (await hashFile(approvedSourceSnapshot.destination) !== approved.productionRecipe.sourceSnapshot.sha256) {
        throw new Error('Approved production source snapshot hash mismatch');
      }
    }
    await writeJsonOrVerify(root, metadataPath, approved);
    await hooks.afterApprovedFiles?.();
    if (replacement.supersession) {
      await atomicReplaceJson(root, paths.approvalManifest, updatedApprovals);
      await hooks.afterApprovalManifest?.();
      await atomicReplaceJson(root, paths.assetManifest, updatedAssets);
      await hooks.afterAssetManifest?.();
    } else {
      await atomicReplaceJson(root, paths.assetManifest, updatedAssets);
      await hooks.afterAssetManifest?.();
      await atomicReplaceJson(root, paths.approvalManifest, updatedApprovals);
      await hooks.afterApprovalManifest?.();
    }
    await hooks.afterManifests?.();
    current = await replaceGenerationResult(root, generationId, (latest) => {
      if (latest.status === 'approved' && latest.outputPath === approved.outputPath) return latest;
      if (latest.status !== 'pending' || latest.outputPath !== journal.sourcePath || latest.outputSha256 !== journal.sourceSha256) {
        throw new Error('Candidate state changed during promotion');
      }
      return approved;
    });
    await hooks.afterLedger?.();
    await completeJournal(root, journalPath, journal);
    return {
      status: 'approved',
      result: current,
      ...(existingJournal ? { resumed: true } : {}),
      approvalRecord,
      ...(supersessionRecord ? { supersessionRecord } : {})
    };
  });
}

export async function promoteCandidate(request) {
  if (arguments.length !== 1 || !request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).some((key) => !['preview', 'answer', 'write'].includes(key))) {
    throw new Error('Legacy promotion public execution accepts only preview, answer, and write');
  }
  assertCanonicalInteractiveTerminal('Legacy promotion');
  const { preview, answer, write } = request;
  const issuedDigest = ISSUED_LEGACY_PROMOTION_PREVIEWS.get(preview);
  if (!issuedDigest || issuedDigest !== sha256(canonicalJson(preview))) {
    throw new Error('Legacy promotion requires the exact in-process preview issued by promotionPreview');
  }
  if (answer !== preview.confirmationPhrase) {
    throw new Error('Legacy promotion confirmation did not exactly match the issued preview');
  }
  ISSUED_LEGACY_PROMOTION_PREVIEWS.delete(preview);
  return promoteCandidateInternal({
    generationId: preview.generationId,
    reviewer: 'human',
    note: preview.note,
    write: write === true,
    confirmed: true,
    expectedSourceSha256: preview.sourceSha256,
    expectedApprovedPath: preview.approvedPath,
    ...(preview.supersedes ? { supersedesGenerationId: preview.supersedes.generationId } : {})
  }, {
    root: FORGE_ROOT,
    forgeRoot: FORGE_ROOT
  });
}
