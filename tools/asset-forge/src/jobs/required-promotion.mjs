import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { readJson, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, hashFile, sha256 } from '../hashing.mjs';
import { readLocalGenerationManifest } from '../manifests/local-generations.mjs';
import { assertExistingFileWithin, assertExistingPendingCandidate, assertExistingStateFile } from '../paths.mjs';
import { validateWith } from '../schemas.mjs';
import { validateRepository } from '../validate.mjs';
import { readAssetDefinitions } from './define-assets.mjs';
import { promoteCandidate, promotionPreview } from './lifecycle.mjs';

export const REQUIRED_PROMOTION_COUNT = 78;
export const REQUIRED_PLAN_KEYS = Object.freeze([
  'assetId', 'generationId', 'sourcePath', 'sourceSha256', 'approvedPath', 'approvedSha256'
]);

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort(compareCodeUnits).join('\0') === [...keys].sort(compareCodeUnits).join('\0');
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 hash`);
}

function assertPlanItem(item) {
  if (!exactKeys(item, REQUIRED_PLAN_KEYS)) throw new Error('Required promotion plan items must contain exactly the six public keys');
  if (typeof item.assetId !== 'string' || !item.assetId) throw new Error('Required promotion plan assetId is invalid');
  if (typeof item.generationId !== 'string' || !item.generationId) throw new Error(`Required promotion generationId is invalid: ${item.assetId}`);
  if (typeof item.sourcePath !== 'string' || !item.sourcePath) throw new Error(`Required promotion sourcePath is invalid: ${item.assetId}`);
  if (typeof item.approvedPath !== 'string' || !item.approvedPath) throw new Error(`Required promotion approvedPath is invalid: ${item.assetId}`);
  assertHash(item.sourceSha256, `Required promotion sourceSha256 for ${item.assetId}`);
  assertHash(item.approvedSha256, `Required promotion approvedSha256 for ${item.assetId}`);
  if (item.sourceSha256 !== item.approvedSha256) throw new Error(`Required promotion must preserve bytes: ${item.assetId}`);
  return item;
}

export function canonicalRequiredPlan(items, { requiredCount = REQUIRED_PROMOTION_COUNT } = {}) {
  if (!Number.isInteger(requiredCount) || requiredCount < 1) throw new Error('Required promotion count is invalid');
  if (!Array.isArray(items) || items.length !== requiredCount) {
    throw new Error(`Required promotion requires exactly ${requiredCount} plan items`);
  }
  const plan = items.map((item) => ({ ...assertPlanItem(item) }))
    .sort((left, right) => compareCodeUnits(left.assetId, right.assetId));
  if (new Set(plan.map((item) => item.assetId)).size !== requiredCount) {
    throw new Error('Required promotion plan contains duplicate asset IDs');
  }
  if (new Set(plan.map((item) => item.generationId)).size !== requiredCount) {
    throw new Error('Required promotion plan contains duplicate generation IDs');
  }
  return {
    plan,
    digest: sha256(canonicalJson(plan))
  };
}

export function selectRequiredGenerations(definitions, generations, {
  requiredCount = REQUIRED_PROMOTION_COUNT
} = {}) {
  if (!Array.isArray(definitions) || !Array.isArray(generations)) throw new Error('Required promotion inputs are invalid');
  const definitionIds = definitions.map((definition) => definition?.id);
  if (new Set(definitionIds).size !== definitionIds.length) throw new Error('Asset definitions contain duplicate IDs');
  const required = definitions.filter((definition) => definition?.required === true)
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  if (required.length !== requiredCount) throw new Error(`Required promotion requires exactly ${requiredCount} required definitions`);

  const selected = [];
  const selectedGenerationIds = new Set();
  for (const definition of required) {
    const matches = generations.filter((generation) => generation?.assetId === definition.id);
    if (matches.length === 0) throw new Error(`Required promotion candidate is missing: ${definition.id}`);
    if (matches.length !== 1) throw new Error(`Required promotion candidate is duplicated: ${definition.id}`);
    const generation = matches[0];
    if (!['pending', 'approved'].includes(generation.status)) {
      throw new Error(`Required promotion candidate has a disallowed state: ${definition.id} (${generation.status})`);
    }
    if (generation.category !== definition.category) {
      throw new Error(`Required promotion candidate category mismatches its definition: ${definition.id}`);
    }
    if (selectedGenerationIds.has(generation.id)) throw new Error(`Required promotion generation ID is duplicated: ${generation.id}`);
    selectedGenerationIds.add(generation.id);
    selected.push({ definition, generation });
  }
  return selected;
}

function assertManifest(schema, value, label) {
  const validation = validateWith(schema, value);
  if (!validation.ok) throw new Error(`Invalid ${label}: ${JSON.stringify(validation.errors)}`);
  return value;
}

function assertPreparingJournal(journal, definition, generation, preview) {
  const keys = [
    'schemaVersion', 'kind', 'generationId', 'assetId', 'category', 'sourcePath', 'sourceSha256',
    'destinationPath', 'note', 'transitionAt', 'status'
  ];
  if (!exactKeys(journal, keys) || journal.schemaVersion !== 1 || journal.kind !== 'promote'
    || journal.status !== 'preparing' || journal.generationId !== generation.id
    || journal.assetId !== definition.id || journal.category !== definition.category
    || journal.sourcePath !== preview.sourcePath || journal.sourceSha256 !== preview.sourceSha256
    || journal.destinationPath !== preview.approvedPath || typeof journal.note !== 'string' || !journal.note
    || Number.isNaN(Date.parse(journal.transitionAt))) {
    throw new Error(`Pending required candidate has an invalid promotion journal: ${definition.id}`);
  }
  return journal;
}

async function assertTransitionApprovedArtifact(root, definition, generation, journal) {
  const approvedFile = await assertExistingStateFile(root, definition.category, 'approved', journal.destinationPath);
  if (await hashFile(approvedFile) !== journal.sourceSha256) {
    throw new Error(`Recoverable approved copy hash changed: ${definition.id}`);
  }
  const metadataPath = await assertExistingFileWithin(
    path.dirname(approvedFile),
    `${path.basename(approvedFile, '.png')}.json`
  );
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (metadata.id !== generation.id || metadata.assetId !== definition.id || metadata.category !== definition.category
    || metadata.status !== 'approved' || metadata.outputPath !== journal.destinationPath
    || metadata.outputSha256 !== journal.sourceSha256 || metadata.approval?.reviewer !== 'human'
    || metadata.approval?.note !== journal.note || metadata.approval?.approvedAt !== journal.transitionAt
    || metadata.approval?.approvedPath !== journal.destinationPath
    || metadata.approval?.approvedSha256 !== journal.sourceSha256) {
    throw new Error(`Recoverable approved metadata conflicts with promotion journal: ${definition.id}`);
  }
}

async function pendingManifestConsistency(root, paths, definition, assetEntry, generation, approvals, preview) {
  const journal = await readJson(path.join(paths.local, 'lifecycle', `${generation.id}.json`), {
    allowMissing: true,
    fallback: null
  });
  if (!journal) {
    if (!['missing', 'pending'].includes(assetEntry.status)) {
      throw new Error(`Pending required candidate conflicts with asset manifest: ${generation.assetId}`);
    }
    if (assetEntry.status === 'pending'
      && (assetEntry.pendingGenerationIds.length !== 1 || assetEntry.pendingGenerationIds[0] !== generation.id)) {
      throw new Error(`Pending required candidate is not the sole manifest pending generation: ${generation.assetId}`);
    }
    if (approvals.some((approval) => approval.assetId === generation.assetId || approval.generationId === generation.id)) {
      throw new Error(`Pending required candidate conflicts with approval ledger: ${generation.assetId}`);
    }
    return { batchNote: null, recoverableValidationIssue: false };
  }

  assertPreparingJournal(journal, definition, generation, preview);
  const relatedApprovals = approvals.filter((approval) => approval.assetId === definition.id
    || approval.generationId === generation.id || approval.approvedPath === journal.destinationPath);
  if (relatedApprovals.length > 1) throw new Error(`Recoverable promotion has duplicate approval records: ${definition.id}`);
  if (!['missing', 'pending', 'approved'].includes(assetEntry.status)) {
    throw new Error(`Recoverable promotion has an invalid asset manifest state: ${definition.id}`);
  }
  if (assetEntry.status === 'pending'
    && (assetEntry.pendingGenerationIds.length !== 1 || assetEntry.pendingGenerationIds[0] !== generation.id)) {
    throw new Error(`Recoverable promotion has a mismatched pending manifest entry: ${definition.id}`);
  }
  if (assetEntry.status !== 'approved' && relatedApprovals.length !== 0) {
    throw new Error(`Recoverable promotion approval ledger advanced before its asset manifest: ${definition.id}`);
  }
  if (assetEntry.status === 'approved') {
    if (assetEntry.approvedPath !== journal.destinationPath || assetEntry.lastUpdated !== journal.transitionAt) {
      throw new Error(`Recoverable promotion asset manifest conflicts with its journal: ${definition.id}`);
    }
    await assertTransitionApprovedArtifact(root, definition, generation, journal);
  }
  if (relatedApprovals.length === 1) {
    const approval = relatedApprovals[0];
    if (approval.generationId !== generation.id || approval.assetId !== definition.id
      || approval.reviewer !== 'human' || approval.note !== journal.note || approval.approvedAt !== journal.transitionAt
      || approval.sourcePath !== journal.sourcePath || approval.sourceSha256 !== journal.sourceSha256
      || approval.approvedPath !== journal.destinationPath || approval.approvedSha256 !== journal.sourceSha256) {
      throw new Error(`Recoverable promotion approval ledger conflicts with its journal: ${definition.id}`);
    }
  }
  return {
    batchNote: journal.note,
    recoverableValidationIssue: assetEntry.status === 'approved' && relatedApprovals.length === 0
  };
}

async function approvedPlanItem(root, definition, generation, assetEntry, approvals) {
  if (!['approved', 'exported'].includes(assetEntry.status)) {
    throw new Error(`Approved required candidate must match an approved asset manifest entry: ${definition.id}`);
  }
  const relatedApprovals = approvals.filter((approval) => approval.assetId === definition.id
    || approval.generationId === generation.id
    || approval.approvedPath === generation.outputPath);
  if (relatedApprovals.length !== 1) throw new Error(`Approved required candidate must have exactly one approval record: ${definition.id}`);
  const approval = relatedApprovals[0];
  if (approval.assetId !== definition.id || approval.generationId !== generation.id
    || approval.reviewer !== 'human' || generation.approval?.reviewer !== 'human'
    || approval.approvedPath !== generation.outputPath
    || approval.approvedPath !== generation.approval?.approvedPath
    || approval.approvedPath !== assetEntry.approvedPath
    || approval.approvedSha256 !== generation.outputSha256
    || approval.approvedSha256 !== generation.approval?.approvedSha256
    || approval.note !== generation.approval?.note
    || approval.approvedAt !== generation.approval?.approvedAt) {
    throw new Error(`Approved generation, approval ledger, and asset manifest disagree: ${definition.id}`);
  }
  const pendingSource = await assertExistingPendingCandidate(root, definition.category, approval.sourcePath);
  if (await hashFile(pendingSource) !== approval.sourceSha256) {
    throw new Error(`Approved required candidate source hash changed: ${definition.id}`);
  }
  const approvedFile = await assertExistingStateFile(root, definition.category, 'approved', approval.approvedPath);
  const approvedSha256 = await hashFile(approvedFile);
  if (approvedSha256 !== approval.approvedSha256 || approval.sourceSha256 !== approval.approvedSha256) {
    throw new Error(`Approved required candidate destination hash changed: ${definition.id}`);
  }
  return {
    item: {
      assetId: definition.id,
      generationId: generation.id,
      sourcePath: approval.sourcePath,
      sourceSha256: approval.sourceSha256,
      approvedPath: approval.approvedPath,
      approvedSha256
    },
    approvalNote: approval.note
  };
}

async function collectRequiredPlan(root, forgeRoot, dependencies) {
  const paths = pathsFor(root);
  const [definitions, generationManifest, approvals, assets] = await Promise.all([
    dependencies.readDefinitions({ root: forgeRoot }),
    dependencies.readGenerations(root),
    readJson(paths.approvalManifest),
    readJson(paths.assetManifest)
  ]);
  assertManifest('approval-manifest.schema.json', approvals, 'approval manifest');
  assertManifest('asset-manifest.schema.json', assets, 'asset manifest');
  const selected = selectRequiredGenerations(definitions, generationManifest.results);
  const plan = [];
  const batchNotes = [];
  const recoverableAssetIds = [];
  const pendingGenerationIds = [];
  const approvedGenerationIds = [];
  let pendingCount = 0;
  let approvedCount = 0;
  for (const { definition, generation } of selected) {
    const assetEntries = assets.assets.filter((entry) => entry.assetId === definition.id);
    if (assetEntries.length !== 1 || assetEntries[0].category !== definition.category) {
      throw new Error(`Required asset manifest entry is missing, duplicated, or mismatched: ${definition.id}`);
    }
    if (generation.status === 'pending') {
      const preview = await dependencies.previewer({ generationId: generation.id }, { root, forgeRoot });
      if (preview.assetId !== definition.id || preview.generationId !== generation.id) {
        throw new Error(`Promotion preview identifies a different candidate: ${definition.id}`);
      }
      const transition = await pendingManifestConsistency(
        root, paths, definition, assetEntries[0], generation, approvals.approvals, preview
      );
      plan.push({ ...assertPlanItem(preview) });
      if (transition.batchNote) batchNotes.push({ assetId: definition.id, note: transition.batchNote });
      if (transition.recoverableValidationIssue) recoverableAssetIds.push(definition.id);
      pendingGenerationIds.push(generation.id);
      pendingCount += 1;
    } else {
      const approved = await approvedPlanItem(root, definition, generation, assetEntries[0], approvals.approvals);
      plan.push(approved.item);
      batchNotes.push({ assetId: definition.id, note: approved.approvalNote });
      approvedGenerationIds.push(generation.id);
      approvedCount += 1;
    }
  }
  return {
    ...canonicalRequiredPlan(plan), pendingCount, approvedCount, batchNotes, recoverableAssetIds,
    pendingGenerationIds, approvedGenerationIds
  };
}

function assertRepositoryReady(validation, recoverableAssetIds) {
  const recoverable = new Set(recoverableAssetIds);
  const unexpectedIssues = (validation?.issues ?? []).filter((issue) => !(issue.code === 'INVALID_APPROVED_ASSET'
    && recoverable.has(issue.id) && issue.message === 'approval ledger record is missing'));
  if (validation?.requiredAssetCount !== REQUIRED_PROMOTION_COUNT || unexpectedIssues.length !== 0
    || (validation?.ok !== true && (validation?.issues ?? []).length === 0)) {
    throw new Error(`Asset Forge repository integrity failed before required promotion: ${canonicalJson(validation?.issues ?? [])}`);
  }
}

export async function buildRequiredPromotionPlan({
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}, dependencies = {}) {
  const resolved = {
    readDefinitions: dependencies.readDefinitions ?? readAssetDefinitions,
    readGenerations: dependencies.readGenerations ?? readLocalGenerationManifest,
    previewer: dependencies.previewer ?? promotionPreview,
    validator: dependencies.validator ?? validateRepository
  };
  const firstValidation = await resolved.validator({ root });
  const first = await collectRequiredPlan(root, forgeRoot, resolved);
  assertRepositoryReady(firstValidation, first.recoverableAssetIds);
  const secondValidation = await resolved.validator({ root });
  const second = await collectRequiredPlan(root, forgeRoot, resolved);
  assertRepositoryReady(secondValidation, second.recoverableAssetIds);
  if (!isDeepStrictEqual(first.plan, second.plan)
    || !isDeepStrictEqual(first.batchNotes, second.batchNotes)
    || !isDeepStrictEqual(first.recoverableAssetIds, second.recoverableAssetIds)
    || !isDeepStrictEqual(first.pendingGenerationIds, second.pendingGenerationIds)
    || !isDeepStrictEqual(first.approvedGenerationIds, second.approvedGenerationIds)
    || first.digest !== second.digest
    || first.pendingCount !== second.pendingCount
    || first.approvedCount !== second.approvedCount) {
    throw new Error('Required promotion inputs changed during full preflight');
  }
  const note = requiredPromotionNote(second.digest);
  for (const approval of second.batchNotes) {
    if (approval.note !== note) throw new Error(`Approved item is not from this required batch: ${approval.assetId}`);
  }
  return {
    count: second.plan.length,
    pendingCount: second.pendingCount,
    approvedCount: second.approvedCount,
    pendingGenerationIds: second.pendingGenerationIds,
    approvedGenerationIds: second.approvedGenerationIds,
    plan: second.plan,
    digest: second.digest
  };
}

export function requiredPromotionPhrase(digest) {
  assertHash(digest, 'Required promotion digest');
  return `APPROVE REQUIRED ${REQUIRED_PROMOTION_COUNT} ${digest}`;
}

export function requiredPromotionNote(digest) {
  assertHash(digest, 'Required promotion digest');
  return `Required ${REQUIRED_PROMOTION_COUNT} batch approval ${digest}`;
}

export function isExactRequiredPromotionAnswer(answer, digest) {
  return typeof answer === 'string' && answer === requiredPromotionPhrase(digest);
}

function assertPreflight(preflight) {
  if (!preflight || preflight.count !== REQUIRED_PROMOTION_COUNT
    || !Number.isInteger(preflight.pendingCount) || !Number.isInteger(preflight.approvedCount)
    || preflight.pendingCount + preflight.approvedCount !== REQUIRED_PROMOTION_COUNT) {
    throw new Error('Required promotion preflight is invalid');
  }
  const canonical = canonicalRequiredPlan(preflight.plan);
  if (canonical.digest !== preflight.digest || !isDeepStrictEqual(canonical.plan, preflight.plan)) {
    throw new Error('Required promotion preflight digest or order is invalid');
  }
  if (!Array.isArray(preflight.pendingGenerationIds) || !Array.isArray(preflight.approvedGenerationIds)
    || preflight.pendingGenerationIds.length !== preflight.pendingCount
    || preflight.approvedGenerationIds.length !== preflight.approvedCount) {
    throw new Error('Required promotion status partition is invalid');
  }
  const planGenerationIds = preflight.plan.map((item) => item.generationId);
  const partition = [...preflight.pendingGenerationIds, ...preflight.approvedGenerationIds];
  if (new Set(partition).size !== REQUIRED_PROMOTION_COUNT
    || partition.some((generationId) => !planGenerationIds.includes(generationId))) {
    throw new Error('Required promotion status partition is duplicated or contains an unknown generation');
  }
  for (const ids of [preflight.pendingGenerationIds, preflight.approvedGenerationIds]) {
    const indexes = ids.map((generationId) => planGenerationIds.indexOf(generationId));
    if (indexes.some((index, position) => position > 0 && index <= indexes[position - 1])) {
      throw new Error('Required promotion status partition is not in asset plan order');
    }
  }
  return preflight;
}

export function formatRequiredPromotionPlan(preflight) {
  assertPreflight(preflight);
  const lines = [
    `Required asset approval plan (${preflight.count})`,
    `Batch digest: ${preflight.digest}`,
    ''
  ];
  preflight.plan.forEach((item, index) => {
    lines.push(
      `${String(index + 1).padStart(2, '0')}. ${item.assetId}`,
      `    generation:  ${item.generationId}`,
      `    source:      ${item.sourcePath}`,
      `    source SHA:  ${item.sourceSha256}`,
      `    destination: ${item.approvedPath}`,
      `    approved SHA: ${item.approvedSha256}`
    );
  });
  lines.push('', `Exact confirmation: ${requiredPromotionPhrase(preflight.digest)}`, '');
  return lines.join('\n');
}

export async function beginRequiredPromotion({ input, output }, {
  planBuilder = buildRequiredPromotionPlan,
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  if (!input?.isTTY || !output?.isTTY) throw new Error('Required promotion requires stdin and stdout to both be interactive TTYs');
  return planBuilder({ root, forgeRoot });
}

function samePreflight(left, right) {
  return left.digest === right.digest && isDeepStrictEqual(left.plan, right.plan)
    && isDeepStrictEqual(left.pendingGenerationIds, right.pendingGenerationIds)
    && isDeepStrictEqual(left.approvedGenerationIds, right.approvedGenerationIds);
}

function safeErrorMessage(error) {
  return String(error?.message ?? error ?? 'Unknown promotion failure')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 500);
}

export async function executeRequiredPromotion(preflight, answer, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  planBuilder = buildRequiredPromotionPlan,
  promoter = promoteCandidate
} = {}) {
  assertPreflight(preflight);
  if (!isExactRequiredPromotionAnswer(answer, preflight.digest)) {
    throw new Error('Required promotion confirmation did not exactly match the displayed batch');
  }
  const paths = pathsFor(root);
  return withFileLock(root, paths.requiredPromotionLock, async () => {
    const stable = await planBuilder({ root, forgeRoot });
    assertPreflight(stable);
    if (!samePreflight(preflight, stable)) throw new Error('Required promotion plan changed after interactive confirmation');
    const pending = new Set(stable.pendingGenerationIds);
    const note = requiredPromotionNote(preflight.digest);
    for (const item of preflight.plan) {
      if (!pending.has(item.generationId)) continue;
      try {
        const outcome = await promoter({
          generationId: item.generationId,
          reviewer: 'human',
          note,
          write: true,
          confirmed: true,
          expectedSourceSha256: item.sourceSha256,
          expectedApprovedPath: item.approvedPath
        }, { root, forgeRoot });
        if (outcome?.status !== 'approved' || outcome.resumed === true
          || (outcome.resumed !== undefined && typeof outcome.resumed !== 'boolean')) {
          throw new Error(`Required promoter returned an invalid pending-candidate result: ${item.assetId}`);
        }
      } catch (error) {
        let approvedCount = null;
        let remainingCount = null;
        try {
          const resumed = await planBuilder({ root, forgeRoot });
          assertPreflight(resumed);
          if (resumed.digest === preflight.digest && isDeepStrictEqual(resumed.plan, preflight.plan)) {
            approvedCount = resumed.approvedCount;
            remainingCount = REQUIRED_PROMOTION_COUNT - approvedCount;
          }
        } catch {
          // State is not inferred after a failed recovery preflight; the next run must inspect it again.
        }
        return {
          status: 'partial-failure',
          digest: preflight.digest,
          count: REQUIRED_PROMOTION_COUNT,
          approvedCount,
          remainingCount,
          failedAssetId: item.assetId,
          error: safeErrorMessage(error)
        };
      }
    }
    const completed = await planBuilder({ root, forgeRoot });
    assertPreflight(completed);
    if (completed.digest !== preflight.digest || !isDeepStrictEqual(completed.plan, preflight.plan)
      || completed.pendingCount !== 0 || completed.approvedCount !== REQUIRED_PROMOTION_COUNT) {
      throw new Error('Required promotion completed without a stable all-approved batch');
    }
    return {
      status: 'approved',
      digest: preflight.digest,
      count: REQUIRED_PROMOTION_COUNT,
      approvedCount: completed.approvedCount,
      resumedCount: stable.approvedCount,
      newlyApprovedCount: stable.pendingCount,
      exported: false
    };
  });
}
