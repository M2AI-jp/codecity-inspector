import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT, pathsFor } from './config.mjs';
import { canonicalJson, hashFile, sha256 } from './hashing.mjs';
import { auditTransparentPng } from './images/audit-alpha.mjs';
import { readExternalImage } from './images/inspect-image.mjs';
import {
  auditBuildingBundleV2,
  auditVisualAssetV2,
  visualContractV2Problems
} from './images/visual-contract-v2.mjs';
import {
  assertExistingFileWithin,
  assertExistingPendingCandidate,
  assertExistingStateFile,
  assetFileStem,
  categoryDirectory
} from './paths.mjs';
import { inspectPng } from './png-core.mjs';
import { validateWith } from './schemas.mjs';
import { outputContractFor } from './jobs/build-job.mjs';
import { readWaveADefinitions } from './v2/definition-builder.mjs';
import { verifyPersistedWaveAUnitAssembly } from './v2/import-candidate.mjs';
import { inspectWaveAReferenceAuthorization } from './v2/reference-authorization.mjs';
import { assertBundleLedger } from './v3/bundle-ledger.mjs';
import { readBundleLedger } from './v3/persistence.mjs';

async function loadJson(filePath, issues, label = path.basename(filePath)) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    issues.push({
      code: error instanceof SyntaxError ? 'MALFORMED_JSON' : 'READ_FAILED',
      path: label,
      message: error.message
    });
    return null;
  }
}

function schemaCheck(schema, value, label, issues) {
  if (value == null) return false;
  const result = validateWith(schema, value);
  if (!result.ok) issues.push({ code: 'SCHEMA', path: label, errors: result.errors });
  return result.ok;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function sameValues(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function isExplicitWaveAAssembly(generation) {
  return generation?.requiredSetId === 'fable5-v2'
    && generation.waveId === 'A'
    && generation.visualContractVersion === 2
    && generation.unitAssemblyV2 != null;
}

const REJECTION_OBSERVED = 'Candidate was copied to rejected state with the same SHA-256.';
const REJECTION_UNKNOWN = 'whether a future candidate will be suitable';
const REJECTION_JOURNAL_V2_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'generationId',
  'assetId',
  'category',
  'sourcePath',
  'sourceSha256',
  'destinationPath',
  'reason',
  'transitionAt',
  'pendingRecordPath',
  'pendingRecordSha256',
  'status'
]);

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

export function rejectionSourceFromPending(pending) {
  if (typeof pending?.outputPath === 'string' && /^[a-f0-9]{64}$/.test(pending.outputSha256)) {
    return { path: pending.outputPath, sha256: pending.outputSha256 };
  }
  const primary = pending?.outputArtifacts?.[0];
  if (primary && ['primary', 'base'].includes(primary.role)
    && typeof primary.path === 'string' && /^[a-f0-9]{64}$/.test(primary.sha256)) {
    return { path: primary.path, sha256: primary.sha256 };
  }
  throw new Error('Pending candidate has no canonical primary output');
}

export function validateRejectionJournalV2(journal, generationId, {
  requireComplete = false
} = {}) {
  if (!hasExactKeys(journal, REJECTION_JOURNAL_V2_KEYS)
    || journal.schemaVersion !== 2 || journal.kind !== 'reject'
    || journal.generationId !== generationId
    || (requireComplete ? journal.status !== 'complete' : !['preparing', 'complete'].includes(journal.status))
    || typeof journal.assetId !== 'string' || typeof journal.category !== 'string'
    || typeof journal.sourcePath !== 'string' || !/^[a-f0-9]{64}$/.test(journal.sourceSha256)
    || typeof journal.destinationPath !== 'string'
    || typeof journal.reason !== 'string' || !journal.reason.trim()
    || Number.isNaN(Date.parse(journal.transitionAt))
    || !/^[a-f0-9]{64}$/.test(journal.pendingRecordSha256)) {
    throw new Error('Invalid v2 rejection lifecycle journal');
  }
  const stateDir = categoryDirectory(journal.category);
  if (!new RegExp(`^(generated|processed)/${stateDir}/pending/[a-z0-9_.-]+\\.png$`).test(journal.sourcePath)) {
    throw new Error('Invalid v2 rejection lifecycle journal source');
  }
  const expectedDestination =
    `generated/${stateDir}/rejected/${assetFileStem(journal.assetId)}-${generationId}.png`;
  if (journal.destinationPath !== expectedDestination
    || journal.pendingRecordPath !== `data/local/lifecycle/${generationId}.pending.json`) {
    throw new Error('Invalid v2 rejection lifecycle journal destination or pending snapshot');
  }
  return journal;
}

export function rejectionResultFromPending(pending, journal) {
  validateRejectionJournalV2(journal, pending?.id);
  if (pending.status !== 'pending' || pending.id !== journal.generationId
    || pending.assetId !== journal.assetId || pending.category !== journal.category) {
    throw new Error('Rejection journal does not identify its pending record');
  }
  const source = rejectionSourceFromPending(pending);
  if (source.path !== journal.sourcePath || source.sha256 !== journal.sourceSha256) {
    throw new Error('Rejection journal does not bind the pending primary output');
  }
  return {
    ...pending,
    status: 'rejected',
    outputPath: journal.destinationPath,
    outputSha256: journal.sourceSha256,
    metadataPath: journal.destinationPath.replace(/\.png$/, '.json'),
    rejection: { reason: journal.reason, rejectedAt: journal.transitionAt },
    inspection: {
      ...pending.inspection,
      observed: [...pending.inspection.observed, REJECTION_OBSERVED],
      unknown: [...new Set([...pending.inspection.unknown, REJECTION_UNKNOWN])]
    }
  };
}

async function rejectedWaveATransitionProblem(root, generation, forgeRoot) {
  try {
    const journalPath = `data/local/lifecycle/${generation.id}.json`;
    const journalBytes = await readFile(await assertExistingFileWithin(root, journalPath));
    const journal = JSON.parse(journalBytes);
    validateRejectionJournalV2(journal, generation.id, { requireComplete: true });
    if (!journalBytes.equals(Buffer.from(canonicalJson(journal)))) {
      throw new Error('rejection lifecycle journal is not canonical JSON');
    }
    const pendingBytes = await readFile(
      await assertExistingFileWithin(root, journal.pendingRecordPath)
    );
    if (sha256(pendingBytes) !== journal.pendingRecordSha256) {
      throw new Error('rejection pending-record snapshot digest mismatch');
    }
    const pending = JSON.parse(pendingBytes);
    if (!pendingBytes.equals(Buffer.from(canonicalJson(pending)))) {
      throw new Error('rejection pending-record snapshot is not canonical JSON');
    }
    const pendingValidation = validateWith('generation-result.schema.json', pending);
    if (!pendingValidation.ok || !isExplicitWaveAAssembly(pending) || pending.status !== 'pending') {
      throw new Error('rejection pending-record snapshot is not an explicit pending Wave A result');
    }
    const expected = rejectionResultFromPending(pending, journal);
    if (canonicalJson(generation) !== canonicalJson(expected)) {
      throw new Error('rejected result is not the exact journaled pending-to-rejected transition');
    }
    const metadataBytes = await readFile(
      await assertExistingFileWithin(root, generation.metadataPath)
    );
    if (!metadataBytes.equals(Buffer.from(canonicalJson(generation)))) {
      throw new Error('rejected metadata bytes differ from the generation ledger');
    }
    await verifyPersistedWaveAUnitAssembly(pending, {
      root,
      forgeRoot,
      allowHistoricalTransformVersion: true
    });
    return null;
  } catch (error) {
    return `Wave A rejected transition integrity failed: ${error.message}`;
  }
}

export function inspectApprovalTopology(approvalManifest, assetManifest) {
  try {
    const byGeneration = new Map();
    const byPath = new Map();
    for (const approval of approvalManifest.approvals) {
      if (byGeneration.has(approval.generationId)) {
        throw new Error(`duplicate approval generation id: ${approval.generationId}`);
      }
      if (byPath.has(approval.approvedPath)) {
        throw new Error(`duplicate approval path: ${approval.approvedPath}`);
      }
      byGeneration.set(approval.generationId, approval);
      byPath.set(approval.approvedPath, approval);
    }
    const superseded = new Set();
    const replacements = new Set();
    const next = new Map();
    for (const relation of approvalManifest.supersessions ?? []) {
      if (superseded.has(relation.supersededGenerationId)
        || replacements.has(relation.replacementGenerationId)) {
        throw new Error('duplicate approval supersession key');
      }
      const previous = byGeneration.get(relation.supersededGenerationId);
      const replacement = byGeneration.get(relation.replacementGenerationId);
      if (!previous || !replacement || relation.supersededGenerationId === relation.replacementGenerationId
        || previous.assetId !== relation.assetId || replacement.assetId !== relation.assetId
        || previous.approvedPath !== relation.supersededApprovedPath
        || previous.approvedSha256 !== relation.supersededApprovedSha256
        || replacement.approvedPath !== relation.replacementApprovedPath
        || replacement.approvedSha256 !== relation.replacementApprovedSha256
        || replacement.reviewer !== relation.reviewer || replacement.note !== relation.note
        || replacement.approvedAt !== relation.supersededAt) {
        throw new Error(`invalid approval supersession: ${relation.assetId}`);
      }
      superseded.add(relation.supersededGenerationId);
      replacements.add(relation.replacementGenerationId);
      next.set(relation.supersededGenerationId, relation.replacementGenerationId);
    }
    for (const start of next.keys()) {
      const seen = new Set();
      let cursor = start;
      while (next.has(cursor)) {
        if (seen.has(cursor)) throw new Error('cyclic approval supersession');
        seen.add(cursor);
        cursor = next.get(cursor);
      }
    }
    const activeByAsset = new Map();
    for (const approval of approvalManifest.approvals) {
      if (superseded.has(approval.generationId)) continue;
      if (activeByAsset.has(approval.assetId)) {
        throw new Error(`multiple active approvals: ${approval.assetId}`);
      }
      activeByAsset.set(approval.assetId, approval);
    }
    const manifestByAsset = new Map();
    for (const entry of assetManifest.assets) {
      if (manifestByAsset.has(entry.assetId)) throw new Error(`duplicate asset manifest id: ${entry.assetId}`);
      manifestByAsset.set(entry.assetId, entry);
    }
    for (const [assetId, approval] of activeByAsset) {
      const entry = manifestByAsset.get(assetId);
      if (!entry || !['approved', 'exported'].includes(entry.status)
        || entry.approvedPath !== approval.approvedPath) {
        throw new Error(`active approval is not the current asset pointer: ${assetId}`);
      }
    }
    for (const entry of assetManifest.assets.filter((asset) => ['approved', 'exported'].includes(asset.status))) {
      const approval = activeByAsset.get(entry.assetId);
      if (!approval || approval.approvedPath !== entry.approvedPath) {
        throw new Error(`current asset pointer is not the terminal active approval: ${entry.assetId}`);
      }
    }
    return { problem: null, activeByAsset, supersededGenerationIds: superseded };
  } catch (error) {
    return { problem: error.message, activeByAsset: new Map(), supersededGenerationIds: new Set() };
  }
}

function generationReferenceProblem(asset, generation, referenceById, validReferenceIds) {
  const expectedIds = asset.defaultReferenceIds ?? [];
  const expectedHashes = expectedIds.map((id) => referenceById.get(id)?.sha256);
  if (expectedIds.some((id) => !validReferenceIds.has(id))) return 'current reference file/hash is invalid';
  if (!sameValues(generation?.referenceImageIds, expectedIds)) return 'reference ids are missing, reordered, or changed';
  if (!sameValues(generation?.referenceImageHashes, expectedHashes)) return 'reference hashes are missing or changed';
  return null;
}

export async function historicalGenerationReferenceProblem(forgeRoot, generation) {
  try {
    if (!Array.isArray(generation?.referenceImageIds)
      || !Array.isArray(generation?.referenceImageHashes)
      || generation.referenceImageIds.length !== generation.referenceImageHashes.length
      || new Set(generation.referenceImageIds).size !== generation.referenceImageIds.length) {
      return 'recorded reference ids/hashes are incomplete or duplicated';
    }
    const manifestPath = path.join(pathsFor(forgeRoot).manifests, 'references.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const validation = validateWith('reference-image.schema.json', manifest);
    if (!validation.ok) return 'historical reference manifest is invalid';
    if (new Set(manifest.references.map((entry) => entry.id)).size !== manifest.references.length) {
      return 'historical reference manifest contains duplicate ids';
    }
    const byId = new Map(manifest.references.map((entry) => [entry.id, entry]));
    for (const [index, id] of generation.referenceImageIds.entries()) {
      const expectedHash = generation.referenceImageHashes[index];
      const reference = byId.get(id);
      if (!reference || reference.sha256 !== expectedHash || reference.status !== 'approved') {
        return `recorded reference evidence is missing or changed: ${id}`;
      }
      const actual = await assertExistingFileWithin(forgeRoot, reference.path);
      if (await hashFile(actual) !== expectedHash) return `recorded reference bytes changed: ${id}`;
      const provenanceProblem = await referenceGenerationProvenanceProblem(forgeRoot, reference, byId);
      if (provenanceProblem) return `recorded reference provenance changed: ${id}: ${provenanceProblem}`;
    }
  } catch (error) {
    return `recorded reference evidence could not be verified: ${error.message}`;
  }
  return null;
}

export async function inspectHistoricalApprovedArtifact(root, approval, {
  forgeRoot = root,
  category
} = {}) {
  try {
    if (!approval || typeof category !== 'string') throw new Error('approval/category is missing');
    if (approval.sourceSha256 !== approval.approvedSha256) {
      throw new Error('approval source hash does not match its immutable approved copy');
    }
    const actual = await assertExistingStateFile(root, category, 'approved', approval.approvedPath);
    const bytes = await readFile(actual);
    if (sha256(bytes) !== approval.approvedSha256) throw new Error('approved history hash changed');
    const metadataPath = await assertExistingFileWithin(
      path.dirname(actual),
      `${path.basename(actual, '.png')}.json`
    );
    const generation = JSON.parse(await readFile(metadataPath, 'utf8'));
    const generationValidation = validateWith('generation-result.schema.json', generation);
    if (!generationValidation.ok || generation.id !== approval.generationId
      || generation.assetId !== approval.assetId || generation.category !== category
      || generation.status !== 'approved'
      || generation.outputPath !== approval.approvedPath
      || generation.outputSha256 !== approval.approvedSha256
      || generation.approval?.reviewer !== approval.reviewer
      || generation.approval?.note !== approval.note
      || generation.approval?.approvedAt !== approval.approvedAt
      || generation.approval?.approvedPath !== approval.approvedPath
      || generation.approval?.approvedSha256 !== approval.approvedSha256) {
      throw new Error('approved history metadata does not match its immutable approval record');
    }
    const referenceProblem = await historicalGenerationReferenceProblem(forgeRoot, generation);
    if (referenceProblem) throw new Error(referenceProblem);
    const recipeProblem = await productionRecipeProblem(root, generation, {
      forgeRoot,
      outputBytes: bytes,
      requirePersistentSourceSnapshot: Boolean(generation.productionRecipe)
    });
    if (recipeProblem) throw new Error(recipeProblem);
    return { problem: null, generation, bytes };
  } catch (error) {
    return { problem: error.message };
  }
}

function sameRect(left, right) {
  return left?.x === right?.x && left?.y === right?.y
    && left?.width === right?.width && left?.height === right?.height;
}

async function referenceGenerationProvenanceProblem(root, reference, referenceById) {
  const provenance = reference.generationProvenance;
  const candidate = reference.candidateProvenance;
  if (!provenance && !candidate) return null;
  try {
    if (candidate) {
      const promptPath = await assertExistingFileWithin(root, candidate.promptSnapshot.path);
      if (await hashFile(promptPath) !== candidate.promptSnapshot.sha256) {
        return 'reference candidate prompt snapshot hash does not match';
      }
      if (candidate.transformation !== 'none' || candidate.sourceOriginal.path !== reference.path
        || candidate.sourceOriginal.sha256 !== reference.sha256) {
        return 'reference candidate source path/hash does not match the pending reference';
      }
      const sourcePath = await assertExistingFileWithin(root, candidate.sourceOriginal.path);
      const source = await readExternalImage(sourcePath);
      if (sha256(source.buffer) !== candidate.sourceOriginal.sha256
        || source.metadata.width !== candidate.sourceOriginal.width
        || source.metadata.height !== candidate.sourceOriginal.height) {
        return 'reference candidate original source hash/dimensions do not match';
      }
      for (const input of candidate.inputReferences) {
        const declared = referenceById.get(input.id);
        if (!declared || declared.status !== 'approved' || declared.sha256 !== input.sha256) {
          return `reference candidate input does not match approved manifest entry: ${input.id}`;
        }
        const inputPath = await assertExistingFileWithin(root, declared.path);
        if (await hashFile(inputPath) !== input.sha256) {
          return `reference candidate input bytes do not match approved manifest entry: ${input.id}`;
        }
      }
      return null;
    }
    const promptPath = await assertExistingFileWithin(root, provenance.promptSnapshot.path);
    if (await hashFile(promptPath) !== provenance.promptSnapshot.sha256) return 'reference prompt snapshot hash does not match';
    const sourcePath = await assertExistingFileWithin(root, provenance.sourceOriginal.path);
    const source = await readExternalImage(sourcePath);
    if (sha256(source.buffer) !== provenance.sourceOriginal.sha256
      || source.metadata.width !== provenance.sourceOriginal.width
      || source.metadata.height !== provenance.sourceOriginal.height) {
      return 'reference original source hash/dimensions do not match';
    }
    const normalizedPath = await assertExistingFileWithin(root, provenance.normalizedReference.path);
    const normalized = await readExternalImage(normalizedPath);
    if (provenance.normalizedReference.path !== reference.path
      || provenance.normalizedReference.sha256 !== reference.sha256
      || sha256(normalized.buffer) !== provenance.normalizedReference.sha256
      || normalized.metadata.width !== provenance.normalizedReference.width
      || normalized.metadata.height !== provenance.normalizedReference.height) {
      return 'reference normalized image provenance does not match the approved reference';
    }
    for (const input of provenance.inputReferences) {
      const declared = referenceById.get(input.id);
      if (!declared || declared.status !== 'approved' || declared.sha256 !== input.sha256) {
        return `reference provenance input does not match approved manifest entry: ${input.id}`;
      }
      const inputPath = await assertExistingFileWithin(root, declared.path);
      if (await hashFile(inputPath) !== input.sha256) {
        return `reference provenance input bytes do not match approved manifest entry: ${input.id}`;
      }
    }
    const decisionPath = await assertExistingFileWithin(root, provenance.decision.path);
    const decisionBytes = await readFile(decisionPath);
    if (sha256(decisionBytes) !== provenance.decision.sha256) return 'reference Lead decision hash does not match';
    const decision = JSON.parse(decisionBytes);
    if (decision.referenceId !== reference.id || decision.decision !== 'approved-reference'
      || decision.reviewer !== provenance.decision.reviewer
      || decision.approvedAt !== provenance.decision.approvedAt
      || decision.candidateSha256 !== reference.sha256
      || decision.actualPromptExactMatch !== provenance.actualPromptExactMatch) {
      return 'reference Lead decision content does not match the manifest';
    }
  } catch (error) {
    return `reference generation provenance could not be verified: ${error.message}`;
  }
  return null;
}

const OUTPUT_INSPECTION_KEYS = Object.freeze(['format', 'width', 'height', 'channels', 'frames', 'bytes']);

async function generationOutputPath(root, generation) {
  if (generation.status === 'pending') {
    return assertExistingPendingCandidate(root, generation.category, generation.outputPath);
  }
  if (['approved', 'rejected'].includes(generation.status)) {
    return assertExistingStateFile(root, generation.category, generation.status, generation.outputPath);
  }
  throw new Error('generation does not have an inspectable image state');
}

export async function inspectGenerationOutput(root, generation, {
  definition,
  outputBytes
} = {}) {
  try {
    const bytes = outputBytes ?? await readFile(await generationOutputPath(root, generation));
    if (!Buffer.isBuffer(bytes)) throw new Error('output bytes are not a Buffer');
    if (sha256(bytes) !== generation.outputSha256) throw new Error('output file hash does not match generation');
    const actual = inspectPng(bytes);
    for (const key of OUTPUT_INSPECTION_KEYS) {
      if (actual[key] !== generation.outputInspection?.[key]) {
        throw new Error(`decoded PNG ${key} does not match generation outputInspection`);
      }
    }
    if (definition) {
      const contract = outputContractFor(definition);
      if (actual.width !== contract.width || actual.height !== contract.height) {
        throw new Error(
          `decoded PNG dimensions do not match production output contract: ${definition.id} `
          + `(got ${actual.width}x${actual.height}, expected ${contract.width}x${contract.height})`
        );
      }
    }
    const alphaAudit = await auditTransparentPng(bytes);
    if (definition?.visualContractVersion === 2) {
      if (definition.category === 'building') {
        const artifacts = generation.outputArtifacts ?? [];
        if (artifacts.length !== 2 || artifacts[0]?.role !== 'base' || artifacts[1]?.role !== 'roof') {
          throw new Error('v2 layered building generation is missing its ordered base/roof artifact bundle');
        }
        const auditedArtifacts = [];
        for (const artifact of artifacts) {
          const artifactPath = await assertExistingFileWithin(root, artifact.path);
          const artifactBytes = await readFile(artifactPath);
          const artifactInspection = inspectPng(artifactBytes);
          if (sha256(artifactBytes) !== artifact.sha256
            || OUTPUT_INSPECTION_KEYS.some((key) => artifactInspection[key] !== artifact.inspection?.[key])) {
            throw new Error(`v2 layered building ${artifact.role} artifact integrity failed`);
          }
          auditedArtifacts.push({ role: artifact.role, bytes: artifactBytes });
        }
        const rejectedWaveA = generation.status === 'rejected' && isExplicitWaveAAssembly(generation);
        if ((!rejectedWaveA && generation.outputPath !== artifacts[0].path)
          || generation.outputSha256 !== artifacts[0].sha256) {
          throw new Error('v2 layered building primary pointer must identify its base artifact');
        }
        const bundleAudit = await auditBuildingBundleV2(auditedArtifacts, definition, {
          sourceArtifacts: auditedArtifacts
        });
        if (!bundleAudit.ok) throw new Error(`v2 layered building technical gates failed: ${bundleAudit.problems.join('; ')}`);
      } else {
        const contractAudit = await auditVisualAssetV2(bytes, definition, { verifyResize: false });
        if (!contractAudit.ok) throw new Error(`v2 technical gates failed: ${contractAudit.problems.join('; ')}`);
        if (!generation.technicalInspection || (!isExplicitWaveAAssembly(generation)
          && !generation.processedFromGenerationId)) {
          throw new Error('v2 generation has not passed the required process technical-gate step');
        }
        const recorded = generation.technicalInspection;
        const observed = contractAudit.technicalInspection;
        if (recorded.visualContractVersion !== 2
          || !sameRect(recorded.alpha?.subjectBbox, observed.alpha.subjectBbox)
          || recorded.alpha?.partialAlphaPixels !== observed.alpha.partialAlphaPixels
          || recorded.alpha?.borderVisiblePixels !== observed.alpha.borderVisiblePixels
          || !sameValues(recorded.exactSeams?.checkedTileIndices, observed.exactSeams.checkedTileIndices)
          || recorded.exactSeams?.mismatchCount !== 0
          || recorded.resize?.kernel !== 'nearest'
          || recorded.resize?.enlarged !== false
          || recorded.resize?.output?.width !== actual.width
          || recorded.resize?.output?.height !== actual.height
          || recorded.resize?.source?.width < actual.width
          || recorded.resize?.source?.height < actual.height) {
          throw new Error('v2 technical inspection record does not match recomputed output gates');
        }
      }
    }
    return { problem: null, bytes, inspection: actual, alphaAudit };
  } catch (error) {
    return { problem: `generation output integrity failed: ${error.message}` };
  }
}

export async function productionRecipeProblem(root, generation, {
  forgeRoot = root,
  definition,
  outputBytes,
  requirePersistentSourceSnapshot = Boolean(definition?.required)
} = {}) {
  if (generation.status === 'job-pack') return null;
  if (isExplicitWaveAAssembly(generation) && generation.status === 'pending') {
    try {
      await verifyPersistedWaveAUnitAssembly(generation, { root, forgeRoot });
      return null;
    } catch (error) {
      return `Wave A unit assembly integrity failed: ${error.message}`;
    }
  }
  const recipe = generation.productionRecipe;
  let outputAudit = null;
  if (recipe || ['pending', 'approved', 'rejected'].includes(generation.status)) {
    outputAudit = await inspectGenerationOutput(root, generation, { definition, outputBytes });
    if (outputAudit.problem) return outputAudit.problem;
  }
  if (isExplicitWaveAAssembly(generation) && generation.status === 'rejected') {
    return rejectedWaveATransitionProblem(root, generation, forgeRoot);
  }
  if (!recipe) return definition?.required ? 'required asset is missing its production recipe' : null;
  if (requirePersistentSourceSnapshot && !recipe.sourceSnapshot) {
    return 'required asset recipe is missing its verified persistent original source snapshot';
  }
  if (recipe.assetId !== generation.assetId) return 'recipe assetId does not match generation';
  if (recipe.outputSha256 !== generation.outputSha256) return 'recipe output hash does not match generation';
  if (!sameValues(recipe.referenceImages?.map((entry) => entry.id), generation.referenceImageIds)
    || !sameValues(recipe.referenceImages?.map((entry) => entry.sha256), generation.referenceImageHashes)) {
    return 'recipe references do not match generation references';
  }
  if (recipe.method === 'imagegen') {
    const expectedRoles = ['global-style', 'primary-subject'];
    if (!sameValues(recipe.inputReferences?.map((entry) => entry.id), generation.referenceImageIds)
      || !sameValues(recipe.inputReferences?.map((entry) => entry.sha256), generation.referenceImageHashes)
      || !sameValues(recipe.inputReferences?.map((entry) => entry.role), expectedRoles)) {
      return 'recipe input references/roles do not match generation references';
    }
    if (recipe.toolMode !== 'built-in') return 'recipe tool mode is not built-in';
    try {
      const promptPath = await assertExistingFileWithin(forgeRoot, recipe.generationPromptPath);
      if (await hashFile(promptPath) !== recipe.generationPromptSha256) return 'recipe generation prompt file hash does not match';
    } catch (error) {
      return `recipe generation prompt could not be verified: ${error.message}`;
    }
    if (recipe.generationPromptSha256 === generation.promptHash) {
      return 'recipe generation prompt incorrectly aliases the canonical manual-import prompt';
    }
  } else if (recipe.method === 'direct-extraction'
    && (!recipe.source?.cropRect || !recipe.transformSteps?.includes('crop'))) {
    return 'direct-extraction recipe is missing its crop transform';
  }
  if (recipe.canvas?.width !== generation.outputInspection?.width
    || recipe.canvas?.height !== generation.outputInspection?.height) {
    return 'recipe canvas does not match output inspection';
  }
  if (definition?.visualContractVersion === 2) {
    if (recipe.backgroundRemoval?.cleanup?.resizeKernel !== 'nearest'
      || recipe.spriteContract?.resizeKernel && recipe.spriteContract.resizeKernel !== 'nearest'
      || recipe.effectContract?.resizeKernel && recipe.effectContract.resizeKernel !== 'nearest') {
      return 'v2 production recipe is not nearest-resize-only';
    }
    if (recipe.source?.width < recipe.canvas.width || recipe.source?.height < recipe.canvas.height) {
      return 'v2 production recipe would enlarge its source';
    }
  }
  const bbox = recipe.subjectBbox;
  if (!bbox || bbox.x + bbox.width > recipe.canvas.width || bbox.y + bbox.height > recipe.canvas.height
    || recipe.canvas.baselineY < bbox.y || recipe.canvas.baselineY >= bbox.y + bbox.height) {
    return 'recipe subject bbox/baseline is outside its canvas';
  }
  try {
    const sourceRecord = generation.status === 'approved' ? recipe.sourceSnapshot : recipe.source;
    if (!sourceRecord) return 'approved recipe is missing its persistent original source snapshot';
    const sourcePath = await assertExistingFileWithin(generation.status === 'approved' ? root : forgeRoot, sourceRecord.path);
    const source = await readExternalImage(sourcePath);
    if (sha256(source.buffer) !== sourceRecord.sha256
      || source.metadata.width !== sourceRecord.width
      || source.metadata.height !== sourceRecord.height) {
      return 'recipe source file hash/dimensions do not match';
    }
    if (generation.status === 'approved' && (sourceRecord.sha256 !== recipe.source.sha256
      || sourceRecord.width !== recipe.source.width || sourceRecord.height !== recipe.source.height)) {
      return 'persistent original source snapshot does not match the pending source record';
    }
    if (generation.status !== 'approved' && recipe.sourceSnapshot) {
      const snapshotPath = await assertExistingFileWithin(root, recipe.sourceSnapshot.path);
      const snapshot = await readExternalImage(snapshotPath);
      if (sha256(snapshot.buffer) !== recipe.sourceSnapshot.sha256
        || snapshot.metadata.width !== recipe.sourceSnapshot.width
        || snapshot.metadata.height !== recipe.sourceSnapshot.height
        || recipe.sourceSnapshot.sha256 !== recipe.source.sha256
        || recipe.sourceSnapshot.width !== recipe.source.width
        || recipe.sourceSnapshot.height !== recipe.source.height) {
        return 'persistent original source snapshot does not match the pending source record';
      }
    }
    if (recipe.compositeMask) {
      const maskPath = await assertExistingFileWithin(forgeRoot, recipe.compositeMask.path);
      const mask = await readExternalImage(maskPath);
      if (sha256(mask.buffer) !== recipe.compositeMask.sha256
        || mask.metadata.width !== recipe.compositeMask.width
        || mask.metadata.height !== recipe.compositeMask.height) {
        return 'recipe composite mask file hash/dimensions do not match';
      }
      const backgroundPath = await assertExistingFileWithin(forgeRoot, recipe.compositeMask.backgroundPath);
      const background = await readExternalImage(backgroundPath);
      if (sha256(background.buffer) !== recipe.compositeMask.backgroundSha256) {
        return 'recipe composite background file hash does not match';
      }
    }
    if (!outputAudit) return 'recipe is attached to a generation without an inspectable image state';
    if (!sameRect(outputAudit.alphaAudit.subjectBbox, bbox)) return 'recipe subject bbox does not match output alpha bounds';
  } catch (error) {
    return `recipe output could not be verified: ${error.message}`;
  }
  return null;
}

export async function validateRepository({ root = FORGE_ROOT } = {}) {
  const paths = pathsFor(root);
  const issues = [];
  const catalogs = [];
  let definitionNames = [];
  try {
    definitionNames = (await readdir(paths.definitions)).filter((item) => item.endsWith('.json')).sort();
  } catch (error) {
    issues.push({ code: 'READ_FAILED', path: 'data/asset-definitions', message: error.message });
  }
  for (const name of definitionNames) {
    const value = await loadJson(path.join(paths.definitions, name), issues, `data/asset-definitions/${name}`);
    schemaCheck('asset-catalog.schema.json', value, `data/asset-definitions/${name}`, issues);
    if (value) catalogs.push(value);
  }

  const assets = catalogs.flatMap((catalog) => catalog.assets ?? []);
  const ids = assets.map((asset) => asset.id);
  const assetIds = new Set(ids);
  let waveADefinitions = [];
  let waveAReferenceAuthorization = null;
  let bundleLedger = null;
  let hasFable5V2 = false;
  try {
    await readFile(path.join(root, 'data', 'v2', 'waves.json'));
    hasFable5V2 = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      issues.push({ code: 'READ_FAILED', path: 'data/v2/waves.json', message: error.message });
    }
  }
  if (hasFable5V2) {
    try {
      waveADefinitions = await readWaveADefinitions({ root });
      if (waveADefinitions.length !== 109) throw new Error(`expected 109 definitions, found ${waveADefinitions.length}`);
      for (const definition of waveADefinitions) {
        for (const prompt of definition.promptFiles) {
          if (!prompt.startsWith('prompts/')) throw new Error(`unsafe prompt path for ${definition.id}: ${prompt}`);
          await assertExistingFileWithin(paths.prompts, prompt.slice('prompts/'.length));
        }
      }
    } catch (error) {
      issues.push({ code: 'INVALID_FABLE5_WAVE_A_DEFINITIONS', message: error.message });
    }
    try {
      waveAReferenceAuthorization = await inspectWaveAReferenceAuthorization({ root });
      if (!waveAReferenceAuthorization.ok) {
        issues.push({
          code: 'FABLE5_WAVE_A_REFERENCE_AUTHORIZATION_NOT_READY',
          status: waveAReferenceAuthorization.status,
          problems: waveAReferenceAuthorization.problems
        });
      }
    } catch (error) {
      issues.push({ code: 'INVALID_FABLE5_WAVE_A_REFERENCE_AUTHORIZATION', message: error.message });
    }
    try {
      bundleLedger = await readBundleLedger({ root });
      const inspection = assertBundleLedger(bundleLedger);
      const currentById = new Map(waveADefinitions.map((definition) => [definition.id, definition]));
      for (const [assetId, approval] of inspection.activeByAsset) {
        const definition = currentById.get(assetId);
        if (!definition) throw new Error(`v3 ledger contains an asset outside current Wave A: ${assetId}`);
        if (approval.definitionSha256 !== sha256(canonicalJson(definition))) {
          throw new Error(`v3 ledger definition hash is stale: ${assetId}`);
        }
      }
    } catch (error) {
      issues.push({ code: 'INVALID_FABLE5_V3_BUNDLE_LEDGER', message: error.message });
    }
  }
  for (const id of duplicateValues(ids)) issues.push({ code: 'DUPLICATE_ID', id });
  for (const catalog of catalogs) {
    for (const asset of catalog.assets ?? []) {
      if (asset.category !== catalog.category || !asset.id?.startsWith(`${catalog.category}.`)) {
        issues.push({ code: 'CATEGORY_MISMATCH', id: asset.id, catalogCategory: catalog.category, assetCategory: asset.category });
      }
      for (const message of visualContractV2Problems(asset)) {
        issues.push({ code: 'INVALID_VISUAL_CONTRACT_V2', id: asset.id, message });
      }
      for (const prompt of asset.promptFiles ?? []) {
        try {
          if (!prompt.startsWith('prompts/')) throw new Error('prompt is outside prompts root');
          await assertExistingFileWithin(paths.prompts, prompt.slice('prompts/'.length));
        } catch (error) {
          issues.push({ code: 'MISSING_OR_UNSAFE_PROMPT', id: asset.id, path: prompt, message: error.message });
        }
      }
    }
  }

  const manifestSpecifications = [
    ['assets.json', 'asset-manifest.schema.json'],
    ['approvals.json', 'approval-manifest.schema.json'],
    ['references.json', 'reference-image.schema.json'],
    ['runtime-coverage.json', 'runtime-coverage.schema.json'],
    ['generations.template.json', 'generation-manifest.schema.json']
  ];
  const manifests = new Map();
  for (const [file, schema] of manifestSpecifications) {
    const value = await loadJson(path.join(paths.manifests, file), issues, `data/manifests/${file}`);
    schemaCheck(schema, value, `data/manifests/${file}`, issues);
    if (value) manifests.set(file, value);
  }

  const referenceManifest = manifests.get('references.json');
  const references = referenceManifest?.references ?? [];
  for (const id of duplicateValues(references.map((reference) => reference.id))) {
    issues.push({ code: 'DUPLICATE_REFERENCE_ID', id });
  }
  const referenceIds = new Set(references.map((reference) => reference.id));
  for (const reference of references) {
    for (const targetAssetId of reference.targetAssetIds ?? []) {
      if (!assetIds.has(targetAssetId)) {
        issues.push({ code: 'UNKNOWN_REFERENCE_TARGET', id: reference.id, targetAssetId });
      }
    }
  }
  const validReferenceIds = new Set();
  const referenceById = new Map(references.map((reference) => [reference.id, reference]));
  for (const reference of references) {
    if (!['approved', 'pending'].includes(reference.status)) continue;
    try {
      if (!reference.sha256) throw new Error('hash is required for a present reference');
      const expectedPrefix = `references/${reference.status}/`;
      if (!reference.path.startsWith(expectedPrefix)) throw new Error('reference path does not match status');
      const actual = await assertExistingFileWithin(paths.references, reference.path.slice('references/'.length));
      const snapshot = await readExternalImage(actual);
      const actualHash = sha256(snapshot.buffer);
      if (actualHash !== reference.sha256) throw new Error(`hash mismatch: expected ${reference.sha256}, observed ${actualHash}`);
      const provenanceProblem = await referenceGenerationProvenanceProblem(root, reference, referenceById);
      if (provenanceProblem) throw new Error(provenanceProblem);
      validReferenceIds.add(reference.id);
    } catch (error) {
      issues.push({ code: 'INVALID_REFERENCE_FILE', id: reference.id, path: reference.path, message: error.message });
    }
  }
  for (const asset of assets) {
    for (const referenceId of asset.defaultReferenceIds ?? []) {
      if (!referenceIds.has(referenceId)) issues.push({ code: 'MISSING_REFERENCE_DECLARATION', id: asset.id, referenceId });
    }
    for (const referenceId of asset.defaultReferenceIds ?? []) {
      if (!referenceById.get(referenceId)?.targetAssetIds?.includes(asset.id)) {
        issues.push({ code: 'REFERENCE_TARGET_MAPPING_MISMATCH', id: asset.id, referenceId });
      }
    }
    if (!asset.required) continue;
    if (!(asset.defaultReferenceIds ?? []).includes('world_visual_master')
      || (asset.category === 'character'
        ? !sameValues(asset.defaultReferenceIds, ['world_visual_master', 'character_visual_master'])
        : (asset.defaultReferenceIds ?? []).every((id) => id === 'world_visual_master'))) {
      issues.push({ code: 'REQUIRED_REFERENCE_LAYERS_MISSING', id: asset.id });
    }
    for (const referenceId of asset.defaultReferenceIds ?? []) {
      const reference = referenceById.get(referenceId);
      if (!reference || reference.status !== 'approved' || !validReferenceIds.has(referenceId)
        || !reference.targetAssetIds?.includes(asset.id)) {
        issues.push({ code: 'INVALID_REQUIRED_REFERENCE', id: asset.id, referenceId });
      }
    }
  }

  const assetManifest = manifests.get('assets.json');
  const approvalManifest = manifests.get('approvals.json');
  for (const generationId of duplicateValues((approvalManifest?.approvals ?? []).map((entry) => entry.generationId))) {
    issues.push({ code: 'DUPLICATE_APPROVAL_GENERATION_ID', generationId });
  }
  for (const approvedPath of duplicateValues((approvalManifest?.approvals ?? []).map((entry) => entry.approvedPath))) {
    issues.push({ code: 'DUPLICATE_APPROVAL_PATH', approvedPath });
  }
  for (const generationId of duplicateValues((approvalManifest?.supersessions ?? []).map((entry) => entry.supersededGenerationId))) {
    issues.push({ code: 'DUPLICATE_SUPERSEDED_GENERATION_ID', generationId });
  }
  for (const generationId of duplicateValues((approvalManifest?.supersessions ?? []).map((entry) => entry.replacementGenerationId))) {
    issues.push({ code: 'DUPLICATE_REPLACEMENT_GENERATION_ID', generationId });
  }
  const approvalByPath = new Map((approvalManifest?.approvals ?? []).map((approval) => [approval.approvedPath, approval]));
  const approvalByGeneration = new Map((approvalManifest?.approvals ?? []).map((approval) => [approval.generationId, approval]));
  const supersededGenerationIds = new Set();
  const replacementGenerationIds = new Set();
  for (const supersession of approvalManifest?.supersessions ?? []) {
    const previous = approvalByGeneration.get(supersession.supersededGenerationId);
    const replacement = approvalByGeneration.get(supersession.replacementGenerationId);
    if (supersededGenerationIds.has(supersession.supersededGenerationId)
      || replacementGenerationIds.has(supersession.replacementGenerationId)
      || supersession.supersededGenerationId === supersession.replacementGenerationId
      || !previous || !replacement
      || previous.assetId !== supersession.assetId || replacement.assetId !== supersession.assetId
      || previous.approvedPath !== supersession.supersededApprovedPath
      || previous.approvedSha256 !== supersession.supersededApprovedSha256
      || replacement.approvedPath !== supersession.replacementApprovedPath
      || replacement.approvedSha256 !== supersession.replacementApprovedSha256
      || replacement.reviewer !== supersession.reviewer
      || replacement.note !== supersession.note
      || replacement.approvedAt !== supersession.supersededAt) {
      issues.push({
        code: 'INVALID_APPROVAL_SUPERSESSION',
        assetId: supersession.assetId,
        generationId: supersession.replacementGenerationId
      });
    }
    supersededGenerationIds.add(supersession.supersededGenerationId);
    replacementGenerationIds.add(supersession.replacementGenerationId);
  }
  const replacementBySuperseded = new Map((approvalManifest?.supersessions ?? [])
    .map((entry) => [entry.supersededGenerationId, entry.replacementGenerationId]));
  for (const start of replacementBySuperseded.keys()) {
    const seen = new Set();
    let current = start;
    while (replacementBySuperseded.has(current)) {
      if (seen.has(current)) {
        issues.push({ code: 'CYCLIC_APPROVAL_SUPERSESSION', generationId: start });
        break;
      }
      seen.add(current);
      current = replacementBySuperseded.get(current);
    }
  }
  const manifestAssets = assetManifest?.assets ?? [];
  for (const id of duplicateValues(manifestAssets.map((entry) => entry.assetId))) {
    issues.push({ code: 'DUPLICATE_ASSET_MANIFEST_ID', id });
  }
  const definitionById = new Map(assets.map((asset) => [asset.id, asset]));
  const manifestById = new Map(manifestAssets.map((entry) => [entry.assetId, entry]));
  for (const asset of assets) {
    const entry = manifestById.get(asset.id);
    if (!entry) issues.push({ code: 'MISSING_ASSET_MANIFEST_ENTRY', id: asset.id });
    else if (entry.category !== asset.category) issues.push({ code: 'ASSET_MANIFEST_CATEGORY_MISMATCH', id: asset.id });
  }
  for (const entry of manifestAssets) {
    if (!definitionById.has(entry.assetId)) issues.push({ code: 'UNKNOWN_ASSET_MANIFEST_ENTRY', id: entry.assetId });
    if (['approved', 'exported'].includes(entry.status)) {
      try {
        if (!entry.approvedPath) throw new Error('approvedPath is required');
        const actual = await assertExistingStateFile(root, entry.category, 'approved', entry.approvedPath);
        const approval = approvalByPath.get(entry.approvedPath);
        if (!approval || approval.assetId !== entry.assetId) throw new Error('approval ledger record is missing');
        const selfContained = await inspectHistoricalApprovedArtifact(root, approval, {
          forgeRoot: root,
          category: entry.category
        });
        if (selfContained.problem) throw new Error(selfContained.problem);
        if (await hashFile(actual) !== approval.approvedSha256) throw new Error('approved hash does not match ledger');
        const definition = definitionById.get(entry.assetId);
        if (!definition) throw new Error('asset definition is missing');
        const metadataPath = await assertExistingFileWithin(path.dirname(actual), `${path.basename(actual, '.png')}.json`);
        const generation = JSON.parse(await readFile(metadataPath, 'utf8'));
        const generationValidation = validateWith('generation-result.schema.json', generation);
        if (!generationValidation.ok) throw new Error('approved generation metadata schema is invalid');
        if (generation.id !== approval.generationId || generation.assetId !== entry.assetId
          || generation.status !== 'approved' || generation.outputPath !== entry.approvedPath
          || generation.outputSha256 !== approval.approvedSha256
          || generation.approval?.reviewer !== approval.reviewer
          || generation.approval?.note !== approval.note
          || generation.approval?.approvedAt !== approval.approvedAt
          || generation.approval?.approvedPath !== approval.approvedPath
          || generation.approval?.approvedSha256 !== approval.approvedSha256) {
          throw new Error('approved generation metadata does not match asset/approval ledgers');
        }
        const referenceProblem = generationReferenceProblem(definition, generation, referenceById, validReferenceIds);
        if (referenceProblem) throw new Error(referenceProblem);
        const recipeProblem = await productionRecipeProblem(root, generation, { definition });
        if (recipeProblem) throw new Error(recipeProblem);
      } catch (error) {
        issues.push({ code: 'INVALID_APPROVED_ASSET', id: entry.assetId, message: error.message });
      }
    }
  }
  for (const approval of approvalManifest?.approvals ?? []) {
    if (supersededGenerationIds.has(approval.generationId)) {
      try {
        const assetEntry = manifestById.get(approval.assetId);
        if (!assetEntry) throw new Error('asset manifest history is missing');
        const historical = await inspectHistoricalApprovedArtifact(root, approval, {
          forgeRoot: root,
          category: assetEntry.category
        });
        if (historical.problem) throw new Error(historical.problem);
      } catch (error) {
        issues.push({
          code: 'INVALID_SUPERSEDED_APPROVAL_HISTORY',
          generationId: approval.generationId,
          assetId: approval.assetId,
          message: error.message
        });
      }
      continue;
    }
    const assetEntry = manifestById.get(approval.assetId);
    if (!assetEntry || assetEntry.approvedPath !== approval.approvedPath || !['approved', 'exported'].includes(assetEntry.status)) {
      issues.push({ code: 'ORPHAN_APPROVAL_RECORD', generationId: approval.generationId, assetId: approval.assetId });
    }
  }

  let localGenerations = null;
  try {
    localGenerations = JSON.parse(await readFile(paths.localGenerationManifest, 'utf8'));
    schemaCheck('generation-manifest.schema.json', localGenerations, 'data/local/generations.json', issues);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      issues.push({
        code: error instanceof SyntaxError ? 'MALFORMED_JSON' : 'READ_FAILED',
        path: 'data/local/generations.json',
        message: error.message
      });
    }
  }
  const waveADefinitionById = new Map(waveADefinitions.map((definition) => [definition.id, definition]));
  for (const generation of localGenerations?.results ?? []) {
    const isFable5V2Generation = generation.requiredSetId === 'fable5-v2';
    const definition = isFable5V2Generation
      ? waveADefinitionById.get(generation.assetId)
      : definitionById.get(generation.assetId);
    if (!definition) {
      issues.push({ code: 'UNKNOWN_GENERATION_ASSET', generationId: generation.id, assetId: generation.assetId });
      continue;
    }
    if (isFable5V2Generation && (generation.visualContractVersion !== 2
      || generation.waveId !== 'A'
      || generation.definitionSha256 !== sha256(canonicalJson(definition)))) {
      issues.push({
        code: 'STALE_OR_MISROUTED_FABLE5_GENERATION',
        generationId: generation.id,
        assetId: generation.assetId
      });
    }
    const historical = supersededGenerationIds.has(generation.id);
    const problem = historical
      ? await historicalGenerationReferenceProblem(root, generation)
      : generationReferenceProblem(definition, generation, referenceById, validReferenceIds);
    if (problem) {
      issues.push({ code: 'INVALID_GENERATION_REFERENCES', generationId: generation.id, assetId: generation.assetId, message: problem });
    }
    const recipeProblem = await productionRecipeProblem(root, generation, historical
      ? {
          forgeRoot: root,
          requirePersistentSourceSnapshot: Boolean(generation.productionRecipe)
        }
      : { definition });
    if (recipeProblem) {
      issues.push({ code: 'INVALID_PRODUCTION_RECIPE', generationId: generation.id, assetId: generation.assetId, message: recipeProblem });
    }
  }

  const coverage = manifests.get('runtime-coverage.json');
  if (coverage) {
    const bound = new Set();
    for (const asset of assets) {
      for (const binding of asset.gameBinding?.runtimeBindings ?? []) {
        const vocabularyValues = coverage.vocabularies?.[binding.vocabulary];
        if (!Array.isArray(vocabularyValues) || !vocabularyValues.includes(binding.id)) {
          issues.push({ code: 'UNKNOWN_RUNTIME_BINDING', id: asset.id, binding });
        } else {
          bound.add(`${binding.vocabulary}\0${binding.id}`);
        }
      }
    }
    for (const runtimeState of Object.values(coverage.stateMap ?? {})) {
      bound.add(`BUILDING_STATES\0${runtimeState}`);
    }
    const declaredUncovered = new Set((coverage.uncovered ?? []).map((entry) => `${entry.vocabulary}\0${entry.runtimeId}`));
    for (const [vocabulary, values] of Object.entries(coverage.vocabularies ?? {})) {
      for (const runtimeId of values) {
        const key = `${vocabulary}\0${runtimeId}`;
        if (!bound.has(key) && !declaredUncovered.has(key)) {
          issues.push({ code: 'UNREPORTED_RUNTIME_GAP', vocabulary, runtimeId });
        }
      }
    }
    for (const key of declaredUncovered) {
      if (bound.has(key)) {
        const [vocabulary, runtimeId] = key.split('\0');
        issues.push({ code: 'STALE_RUNTIME_GAP', vocabulary, runtimeId });
      }
    }
  }

  return {
    ok: issues.length === 0,
    assetCount: assets.length,
    requiredAssetCount: assets.filter((asset) => asset.required).length,
    issues
  };
}
