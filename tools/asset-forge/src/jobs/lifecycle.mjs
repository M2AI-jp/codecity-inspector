import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
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
import { productionRecipeProblem } from '../validate.mjs';
import { findAsset } from './define-assets.mjs';

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
    : ['schemaVersion', 'kind', 'generationId', 'assetId', 'category', 'sourcePath', 'sourceSha256', 'destinationPath', 'note', 'transitionAt', 'status'];
  if (!hasExactKeys(journal, keys) || journal.schemaVersion !== 1 || journal.kind !== kind
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
  return withFileLock(root, paths.lifecycleLock, async () => {
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
      'approved',
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
  });
}

async function writeFileOrVerify(root, destination, bytes) {
  try {
    await atomicWriteFile(root, destination, bytes);
    return 'written';
  } catch (error) {
    let existing;
    try { existing = await readFile(destination); } catch { throw error; }
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

export async function promotionPreview({ generationId }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  const pending = await checkedPending(root, await generationResult(root, validateGenerationId(generationId)));
  const definition = await findAsset(pending.result.assetId, { root: forgeRoot });
  await assertGenerationReferenceMetadata(definition, pending.result, { root: forgeRoot });
  await assertRecipeReadyForPromotion(root, pending.result, forgeRoot, definition, pending.sourceBytes);
  const approvedPath = path.join(pathsFor(root).generated, categoryDirectory(pending.result.category), 'approved', `${assetFileStem(pending.result.assetId)}-${pending.sourceSha256.slice(0, 16)}.png`);
  return {
    generationId,
    assetId: pending.result.assetId,
    sourcePath: pending.result.outputPath,
    sourceSha256: pending.sourceSha256,
    approvedPath: toPosixRelative(root, approvedPath),
    approvedSha256: pending.sourceSha256
  };
}

export async function promoteCandidate({
  generationId, reviewer, note, write, confirmed,
  expectedSourceSha256, expectedApprovedPath
}, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  now = () => new Date().toISOString()
} = {}) {
  validateGenerationId(generationId);
  const preflightGeneration = await generationResult(root, generationId);
  const preflightDefinition = await findAsset(preflightGeneration.assetId, { root: forgeRoot });
  await assertGenerationReferenceMetadata(preflightDefinition, preflightGeneration, { root: forgeRoot });
  await assertRecipeReadyForPromotion(root, preflightGeneration, forgeRoot, preflightDefinition);
  if (!process.stdin.isTTY || !process.stdout.isTTY || reviewer !== 'human' || !write || !confirmed) {
    throw new Error('Promotion requires an interactive human reviewer, --write, and explicit confirmation');
  }
  const approvalNote = String(note ?? '').trim();
  if (!approvalNote) throw new Error('--note is required');
  if (!/^[a-f0-9]{64}$/.test(expectedSourceSha256 ?? '') || typeof expectedApprovedPath !== 'string') {
    throw new Error('Promotion requires the exact previewed hash and destination');
  }
  const paths = pathsFor(root);
  return withFileLock(root, paths.lifecycleLock, async () => {
    let current = await generationResult(root, generationId);
    const definition = await findAsset(current.assetId, { root: forgeRoot });
    await assertGenerationReferenceMetadata(definition, current, { root: forgeRoot });
    const pending = current.status === 'pending' ? await checkedPending(root, current) : null;
    await assertRecipeReadyForPromotion(root, current, forgeRoot, definition, pending?.sourceBytes);
    const computedApprovedPath = pending
      ? `generated/${categoryDirectory(current.category)}/approved/${assetFileStem(current.assetId)}-${pending.sourceSha256.slice(0, 16)}.png`
      : current.approval?.approvedPath;
    if (pending && (expectedSourceSha256 !== pending.sourceSha256 || expectedApprovedPath !== computedApprovedPath)) {
      throw new Error('Candidate no longer matches the preview confirmed by the human reviewer');
    }
    const initial = {
      schemaVersion: 1,
      kind: 'promote',
      generationId,
      assetId: current.assetId,
      category: current.category,
      sourcePath: pending?.result.outputPath,
      sourceSha256: pending?.sourceSha256 ?? current.approval?.approvedSha256,
      destinationPath: computedApprovedPath,
      note: approvalNote,
      transitionAt: now(),
      status: 'preparing'
    };
    const { journalPath, journal } = await lifecycleJournal(root, generationId, initial);
    if (journal.note !== approvalNote) throw new Error('Promotion retry must use the original note');
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
    const approved = {
      ...current,
      status: 'approved',
      outputPath: journal.destinationPath,
      outputSha256: journal.sourceSha256,
      metadataPath: toPosixRelative(root, metadataPath),
      approval,
      inspection: {
        ...current.inspection,
        observed: [...current.inspection.observed, 'A human-only promotion ceremony recorded an immutable approved copy.'],
        unknown: current.inspection.unknown.filter((item) => item !== 'human approval')
      }
    };

    const approvals = await readJson(paths.approvalManifest);
    const approvalValidation = validateWith('approval-manifest.schema.json', approvals);
    if (!approvalValidation.ok) throw new Error(`Invalid current approval manifest: ${JSON.stringify(approvalValidation.errors)}`);
    const approvalRecord = {
      generationId, assetId: current.assetId, reviewer: 'human', note: journal.note, approvedAt: journal.transitionAt,
      sourcePath: journal.sourcePath, sourceSha256: journal.sourceSha256,
      approvedPath: journal.destinationPath, approvedSha256: journal.sourceSha256
    };
    const existingApproval = approvals.approvals.find((entry) => entry.generationId === generationId || entry.approvedPath === journal.destinationPath);
    if (existingApproval && canonicalJson(existingApproval) !== canonicalJson(approvalRecord)) throw new Error('Approval record collision');
    const updatedApprovals = existingApproval ? approvals : { ...approvals, approvals: [...approvals.approvals, approvalRecord] };
    const updatedApprovalValidation = validateWith('approval-manifest.schema.json', updatedApprovals);
    if (!updatedApprovalValidation.ok) throw new Error(`Invalid updated approval manifest: ${JSON.stringify(updatedApprovalValidation.errors)}`);

    const assets = await readJson(paths.assetManifest);
    const assetValidation = validateWith('asset-manifest.schema.json', assets);
    if (!assetValidation.ok) throw new Error(`Invalid current asset manifest: ${JSON.stringify(assetValidation.errors)}`);
    const assetIndex = assets.assets.findIndex((entry) => entry.assetId === current.assetId);
    if (assetIndex < 0) throw new Error('Asset manifest entry is missing');
    const assetEntry = assets.assets[assetIndex];
    if (assetEntry.category !== current.category) throw new Error('Asset manifest category does not match generation');
    if (['approved', 'exported'].includes(assetEntry.status) && assetEntry.approvedPath !== journal.destinationPath) {
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

    await writeFileOrVerify(root, approvedPath, pending.sourceBytes);
    if (await hashFile(approvedPath) !== journal.sourceSha256) throw new Error('Approved copy hash mismatch');
    await writeJsonOrVerify(root, metadataPath, approved);
    await atomicReplaceJson(root, paths.assetManifest, updatedAssets);
    await atomicReplaceJson(root, paths.approvalManifest, updatedApprovals);
    current = await replaceGenerationResult(root, generationId, (latest) => {
      if (latest.status === 'approved' && latest.outputPath === approved.outputPath) return latest;
      if (latest.status !== 'pending' || latest.outputPath !== journal.sourcePath || latest.outputSha256 !== journal.sourceSha256) {
        throw new Error('Candidate state changed during promotion');
      }
      return approved;
    });
    await completeJournal(root, journalPath, journal);
    return { status: 'approved', result: current, approvalRecord };
  });
}
