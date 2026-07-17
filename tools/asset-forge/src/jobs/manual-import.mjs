import path from 'node:path';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { atomicWriteFile, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, hashApprovedTree, hashFile, sha256 } from '../hashing.mjs';
import { auditTransparentPng } from '../images/audit-alpha.mjs';
import { readExternalImage, normalizeImportedImage } from '../images/inspect-image.mjs';
import { appendGenerationResultUnlocked, readLocalGenerationManifest } from '../manifests/local-generations.mjs';
import { assertExistingFileWithin, assetFileStem, resolveWithin, toPosixRelative } from '../paths.mjs';
import { inspectPng } from '../png-core.mjs';
import { validateWith } from '../schemas.mjs';
import { buildJob } from './build-job.mjs';

const MAX_RECIPE_BYTES = 1024 * 1024;

async function readBoundedFile(absolute, maximumBytes = MAX_RECIPE_BYTES) {
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Operator input must be a regular file');
    if (stat.size > maximumBytes) throw new Error('Operator input exceeds the 1 MiB limit');
    const bytes = await handle.readFile();
    if (bytes.length > maximumBytes) throw new Error('Operator input exceeds the 1 MiB limit');
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readBoundedFileWithin(root, relativePath) {
  return readBoundedFile(await assertExistingFileWithin(root, relativePath));
}

async function existingBytes(root, absolute, maximumBytes) {
  try {
    const relative = toPosixRelative(root, absolute);
    return await readBoundedFile(await assertExistingFileWithin(root, relative), maximumBytes);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertAbsentOrExact(root, absolute, expectedBytes, label) {
  const existing = await existingBytes(root, absolute, Math.max(expectedBytes.length, MAX_RECIPE_BYTES));
  if (existing && !existing.equals(expectedBytes)) throw new Error(`${label} conflicts with an incomplete prior import`);
  return existing ? 'existing-identical' : 'missing';
}

async function writeFileOrVerify(root, absolute, bytes, label) {
  try {
    await atomicWriteFile(root, absolute, bytes);
    return 'written';
  } catch (error) {
    const existing = await existingBytes(root, absolute, Math.max(bytes.length, MAX_RECIPE_BYTES));
    if (!existing?.equals(bytes)) throw error;
    return 'existing-identical';
  }
}

export async function readProductionRecipeDraft(recipePath, { forgeRoot = FORGE_ROOT } = {}) {
  if (!recipePath) throw new Error('--recipe is required');
  const absolute = await assertExistingFileWithin(forgeRoot, recipePath);
  const bytes = await readBoundedFile(absolute);
  let recipe;
  try {
    recipe = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Production recipe is not valid JSON', { cause: error });
  }
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw new Error('Production recipe must be a JSON object');
  }
  return recipe;
}

async function verifyJobPack(jobPackPath, { root, assetId, manualJob }) {
  if (!jobPackPath) return null;
  if (!/^generated\/jobs\/[a-z0-9_-]+\/job-pack\.json$/.test(jobPackPath)) {
    throw new Error('Job pack path must identify a Forge job-pack.json');
  }
  const pack = JSON.parse((await readBoundedFileWithin(root, jobPackPath)).toString('utf8'));
  const validation = validateWith('job-pack.schema.json', pack);
  if (!validation.ok) throw new Error(`Invalid job pack: ${JSON.stringify(validation.errors)}`);
  const packDirectory = path.posix.dirname(jobPackPath);
  for (const relative of [pack.promptPath, pack.outputContractPath, pack.importCommandPath]) {
    if (path.posix.dirname(relative) !== packDirectory) throw new Error('Job pack member escapes its pack directory');
    await assertExistingFileWithin(root, relative);
  }
  const jobPath = `${packDirectory}/job.json`;
  const job = JSON.parse((await readBoundedFileWithin(root, jobPath)).toString('utf8'));
  const jobValidation = validateWith('generation-job.schema.json', job);
  if (!jobValidation.ok) throw new Error(`Invalid packed generation job: ${JSON.stringify(jobValidation.errors)}`);
  const contract = JSON.parse((await readBoundedFileWithin(root, pack.outputContractPath)).toString('utf8'));
  const prompt = await readBoundedFileWithin(root, pack.promptPath);
  if (pack.assetId !== assetId || job.assetId !== assetId || pack.jobId !== job.id || job.provider !== 'job-pack'
    || pack.referenceIds.length !== job.referenceImageIds.length
    || pack.referenceIds.some((id, index) => id !== job.referenceImageIds[index])
    || sha256(prompt) !== job.promptHash || job.promptHash !== manualJob.promptHash
    || canonicalJson(contract) !== canonicalJson(job.outputContract)
    || canonicalJson(contract) !== canonicalJson(manualJob.outputContract)
    || canonicalJson(job.referenceImageIds) !== canonicalJson(manualJob.referenceImageIds)
    || canonicalJson(job.referenceImageHashes) !== canonicalJson(manualJob.referenceImageHashes)) {
    throw new Error('Job pack does not match the current asset job contract');
  }
  return { path: jobPackPath, jobId: pack.jobId };
}

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
    const promptSha256 = sha256(await readBoundedFile(promptPath));
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
  const originalPath = await assertExistingFileWithin(forgeRoot, recipe.source?.path);
  const original = await readExternalImage(originalPath);
  if (sha256(original.buffer) !== recipe.source?.sha256
    || original.metadata.width !== recipe.source?.width
    || original.metadata.height !== recipe.source?.height) {
    throw new Error('Production recipe source snapshot mismatch');
  }
  if (recipe.compositeMask) {
    const mask = await readExternalImage(await assertExistingFileWithin(forgeRoot, recipe.compositeMask.path));
    const background = await readExternalImage(await assertExistingFileWithin(forgeRoot, recipe.compositeMask.backgroundPath));
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

export async function importCandidate({
  assetId, file, seed = '', allowPendingReferences = false,
  productionRecipe = null, jobPackPath = null
}, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  now = () => new Date().toISOString(),
  hooks = {}
} = {}) {
  if (!file) throw new Error('--file is required');
  return withFileLock(root, pathsFor(root).requiredPromotionLock, () => importCandidateLocked({
    assetId, file, seed, allowPendingReferences, productionRecipe, jobPackPath
  }, { root, forgeRoot, now, hooks }));
}

async function importCandidateLocked({
  assetId, file, seed, allowPendingReferences, productionRecipe, jobPackPath
}, {
  root, forgeRoot, now, hooks
}) {
  const approvedBefore = await hashApprovedTree(root);
  const source = await readExternalImage(file);
  const { asset, job } = await buildJob({
    assetId, provider: 'manual-import', seed, allowPendingReferences
  }, { forgeRoot });
  const verifiedPack = await verifyJobPack(jobPackPath, { root, assetId, manualJob: job });
  const verifiedRecipe = await verifyProductionRecipeDraft(productionRecipe, { assetId, job, forgeRoot });
  const sourceSha256 = sha256(source.buffer);
  const importProvenanceKey = sha256(canonicalJson({
    jobProvenanceKey: job.provenanceKey,
    sourceSha256,
    sourceFormat: source.sourceFormat,
    productionRecipe: verifiedRecipe,
    jobPackId: verifiedPack?.jobId ?? null
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
  const outputSha256 = sha256(normalized);
  let completedRecipe;
  if (verifiedRecipe) {
    const alphaAudit = await auditTransparentPng(normalized);
    if (!alphaAudit.subjectBbox || !sameRect(alphaAudit.subjectBbox, verifiedRecipe.subjectBbox)) {
      throw new Error('Production recipe subject bbox does not match normalized output');
    }
    completedRecipe = { ...verifiedRecipe, outputSha256 };
  }
  const generationId = `gen_import_${importProvenanceKey.slice(0, 20)}`;
  const existingMetadataBytes = await existingBytes(root, metadataPath, MAX_RECIPE_BYTES);
  let existingMetadata = null;
  if (existingMetadataBytes) {
    try { existingMetadata = JSON.parse(existingMetadataBytes.toString('utf8')); }
    catch (error) { throw new Error('Incomplete prior import metadata is malformed', { cause: error }); }
  }
  const manifest = await readLocalGenerationManifest(root);
  const existingResult = manifest.results.find((entry) => entry.id === generationId) ?? null;
  const createdAt = existingResult?.createdAt ?? existingMetadata?.createdAt ?? now();
  const result = {
    id: generationId,
    jobId: verifiedPack?.jobId ?? job.id,
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
    warnings: [
      ...job.warnings,
      ...(verifiedPack ? [`Imported through verified job pack ${verifiedPack.path}.`] : []),
      'Imported candidate remains pending until explicit human approval.'
    ],
    createdAt,
    inspection: {
      status: 'pending-inspection',
      observed: [`${source.sourceFormat.toUpperCase()} signature and bounded Sharp decode succeeded.`, `Normalized PNG is ${inspection.width}x${inspection.height}.`],
      inferred: ['The normalized image satisfies the technical output dimensions.'],
      unknown: ['source license confirmation', 'visual suitability', 'human approval', 'runtime integration']
    }
  };
  const validation = validateWith('generation-result.schema.json', result);
  if (!validation.ok) throw new Error(`Invalid import result: ${JSON.stringify(validation.errors)}`);
  const metadataBytes = Buffer.from(canonicalJson(result));
  if (existingResult && canonicalJson(existingResult) !== canonicalJson(result)) {
    throw new Error('Existing generation result conflicts with retry provenance');
  }
  if (existingMetadata && canonicalJson(existingMetadata) !== canonicalJson(result)) {
    throw new Error('Existing generation metadata conflicts with retry provenance');
  }
  const preflight = {
    source: await assertAbsentOrExact(root, sourcePath, source.buffer, 'Import source'),
    output: await assertAbsentOrExact(root, outputPath, normalized, 'Import output'),
    metadata: await assertAbsentOrExact(root, metadataPath, metadataBytes, 'Import metadata')
  };
  await writeFileOrVerify(root, sourcePath, source.buffer, 'Import source');
  await hooks.afterSource?.();
  await writeFileOrVerify(root, outputPath, normalized, 'Import output');
  await hooks.afterOutput?.();
  await writeFileOrVerify(root, metadataPath, metadataBytes, 'Import metadata');
  await hooks.afterMetadata?.();
  if (await hashFile(sourcePath) !== sourceSha256 || await hashFile(outputPath) !== outputSha256) {
    throw new Error('Persisted import snapshot hash mismatch');
  }
  if (!existingResult) await appendGenerationResultUnlocked(root, result);
  await hooks.afterLedger?.();
  const approvedAfter = await hashApprovedTree(root);
  if (approvedAfter !== approvedBefore) throw new Error('Approved tree changed during manual import');
  return {
    status: 'pending',
    result: existingResult ?? result,
    resumed: Boolean(existingResult || existingMetadata || Object.values(preflight).some((state) => state !== 'missing')),
    approvedTreeSha256Before: approvedBefore,
    approvedTreeSha256After: approvedAfter
  };
}
