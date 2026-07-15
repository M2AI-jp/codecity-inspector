import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { atomicWriteFile, atomicWriteJson, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, hashApprovedTree, hashFile, sha256 } from '../hashing.mjs';
import { auditTransparentPng } from '../images/audit-alpha.mjs';
import { readExternalImage, normalizeImportedImage } from '../images/inspect-image.mjs';
import { appendGenerationResultUnlocked } from '../manifests/local-generations.mjs';
import { assertExistingFileWithin, assetFileStem, resolveWithin, toPosixRelative } from '../paths.mjs';
import { inspectPng } from '../png-core.mjs';
import { validateWith } from '../schemas.mjs';
import { buildJob } from './build-job.mjs';

function sameReferenceImages(recipeReferences, job) {
  return Array.isArray(recipeReferences)
    && recipeReferences.length === job.referenceImageIds.length
    && recipeReferences.every((reference, index) => reference.id === job.referenceImageIds[index]
      && reference.sha256 === job.referenceImageHashes[index]);
}

function sameInputReferences(inputReferences, job) {
  const expectedRoles = ['global-style', 'primary-subject'];
  return Array.isArray(inputReferences)
    && inputReferences.length === job.referenceImageIds.length
    && inputReferences.every((reference, index) => reference.id === job.referenceImageIds[index]
      && reference.sha256 === job.referenceImageHashes[index]
      && reference.role === expectedRoles[index]);
}

function sameRect(left, right) {
  return left?.x === right?.x && left?.y === right?.y
    && left?.width === right?.width && left?.height === right?.height;
}

async function verifyProductionRecipeDraft(recipe, { assetId, job, forgeRoot }) {
  if (!recipe) return null;
  if (recipe.outputSha256 !== undefined) throw new Error('Recipe outputSha256 is assigned by canonical import');
  if (recipe.assetId !== assetId) throw new Error('Production recipe assetId mismatch');
  if (!sameReferenceImages(recipe.referenceImages, job)) throw new Error('Production recipe reference ids/hashes mismatch');
  if (recipe.method === 'imagegen') {
    if (recipe.toolMode !== 'built-in') throw new Error('Production recipe must identify built-in imagegen mode');
    if (!sameInputReferences(recipe.inputReferences, job)) throw new Error('Production recipe input reference ids/hashes/roles mismatch');
    const promptPath = await assertExistingFileWithin(forgeRoot, recipe.generationPromptPath);
    const promptSha256 = sha256(await readFile(promptPath));
    if (promptSha256 !== recipe.generationPromptSha256) throw new Error('Production recipe generation prompt snapshot mismatch');
    if (promptSha256 === job.promptHash) {
      throw new Error('Imagegen generation prompt must be distinct from the canonical manual-import prompt');
    }
  } else if (recipe.method === 'direct-extraction') {
    if (!recipe.source?.cropRect || !recipe.transformSteps?.includes('crop')) {
      throw new Error('Direct-extraction recipe must record its crop transform');
    }
  }
  if (recipe.canvas?.width !== job.outputContract.width || recipe.canvas?.height !== job.outputContract.height) {
    throw new Error('Production recipe canvas does not match output contract');
  }
  const originalPath = resolveWithin(forgeRoot, recipe.source?.path);
  const original = await readExternalImage(originalPath);
  if (sha256(original.buffer) !== recipe.source?.sha256
    || original.metadata.width !== recipe.source?.width
    || original.metadata.height !== recipe.source?.height) {
    throw new Error('Production recipe source snapshot mismatch');
  }
  if (recipe.compositeMask) {
    const mask = await readExternalImage(resolveWithin(forgeRoot, recipe.compositeMask.path));
    const background = await readExternalImage(resolveWithin(forgeRoot, recipe.compositeMask.backgroundPath));
    if (sha256(mask.buffer) !== recipe.compositeMask.sha256
      || mask.metadata.width !== recipe.compositeMask.width
      || mask.metadata.height !== recipe.compositeMask.height) {
      throw new Error('Production recipe composite mask snapshot mismatch');
    }
    if (sha256(background.buffer) !== recipe.compositeMask.backgroundSha256) {
      throw new Error('Production recipe composite background snapshot mismatch');
    }
  }
  return structuredClone(recipe);
}

export async function importCandidate({ assetId, file, seed = '', allowPendingReferences = false, productionRecipe = null }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  now = () => new Date().toISOString()
} = {}) {
  if (!file) throw new Error('--file is required');
  return withFileLock(root, pathsFor(root).requiredPromotionLock, () => importCandidateLocked({
    assetId, file, seed, allowPendingReferences, productionRecipe
  }, { root, forgeRoot, now }));
}

async function importCandidateLocked({ assetId, file, seed, allowPendingReferences, productionRecipe }, {
  root, forgeRoot, now
}) {
  const approvedBefore = await hashApprovedTree(root);
  const source = await readExternalImage(file);
  const { asset, job } = await buildJob({
    assetId, provider: 'manual-import', seed, allowPendingReferences
  }, { forgeRoot });
  const verifiedRecipe = await verifyProductionRecipeDraft(productionRecipe, { assetId, job, forgeRoot });
  const sourceSha256 = sha256(source.buffer);
  const importProvenanceKey = sha256(canonicalJson({
    jobProvenanceKey: job.provenanceKey,
    sourceSha256,
    sourceFormat: source.sourceFormat,
    productionRecipe: verifiedRecipe
  }));
  if (asset.required && (source.metadata.width < job.outputContract.width
    || source.metadata.height < job.outputContract.height)) {
    throw new Error(`Required production source is smaller than its output contract: ${assetId}`);
  }
  const normalized = await normalizeImportedImage(source.buffer, job.outputContract);
  const inspection = inspectPng(normalized);
  const suffix = sourceSha256.slice(0, 16);
  const outputDir = resolveWithin(root, job.outputDir);
  const stem = `${assetFileStem(assetId)}-${suffix}`;
  const sourceExt = source.sourceFormat === 'jpeg' ? 'jpg' : source.sourceFormat;
  const sourcePath = path.join(outputDir, `${stem}.source.${sourceExt}`);
  const outputPath = path.join(outputDir, `${stem}.png`);
  const metadataPath = path.join(outputDir, `${stem}.json`);
  await atomicWriteFile(root, sourcePath, source.buffer);
  await atomicWriteFile(root, outputPath, normalized);
  const outputSha256 = sha256(normalized);
  let completedRecipe;
  if (verifiedRecipe) {
    const alphaAudit = await auditTransparentPng(normalized);
    if (!alphaAudit.subjectBbox || !sameRect(alphaAudit.subjectBbox, verifiedRecipe.subjectBbox)) {
      throw new Error('Production recipe subject bbox does not match normalized output');
    }
    completedRecipe = { ...verifiedRecipe, outputSha256 };
  }
  if (await hashFile(sourcePath) !== sourceSha256 || await hashFile(outputPath) !== outputSha256) {
    throw new Error('Persisted import snapshot hash mismatch');
  }
  const result = {
    id: `gen_import_${importProvenanceKey.slice(0, 20)}`,
    jobId: job.id,
    assetId,
    category: asset.category,
    status: 'pending',
    provider: 'manual-import',
    outputPath: toPosixRelative(root, outputPath),
    outputSha256,
    metadataPath: toPosixRelative(root, metadataPath),
    promptHash: job.promptHash,
    provenanceKey: importProvenanceKey,
    referenceImageIds: job.referenceImageIds,
    referenceImageHashes: job.referenceImageHashes,
    dryRun: false,
    subscriptionRun: false,
    manualImport: true,
    sourcePath: toPosixRelative(root, sourcePath),
    sourceSha256,
    sourceFormat: source.sourceFormat,
    outputInspection: inspection,
    ...(completedRecipe ? { productionRecipe: completedRecipe } : {}),
    warnings: [...job.warnings, 'Imported candidate remains pending until explicit human approval.'],
    createdAt: now(),
    inspection: {
      status: 'pending-inspection',
      observed: [`${source.sourceFormat.toUpperCase()} signature and bounded Sharp decode succeeded.`, `Normalized PNG is ${inspection.width}x${inspection.height}.`],
      inferred: ['The normalized image satisfies the technical output dimensions.'],
      unknown: ['source license confirmation', 'visual suitability', 'human approval', 'runtime integration']
    }
  };
  const validation = validateWith('generation-result.schema.json', result);
  if (!validation.ok) throw new Error(`Invalid import result: ${JSON.stringify(validation.errors)}`);
  await atomicWriteJson(root, metadataPath, result);
  await appendGenerationResultUnlocked(root, result);
  const approvedAfter = await hashApprovedTree(root);
  if (approvedAfter !== approvedBefore) throw new Error('Approved tree changed during manual import');
  return { status: 'pending', result, approvedTreeSha256Before: approvedBefore, approvedTreeSha256After: approvedAfter };
}
