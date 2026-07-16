import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import { FORGE_ROOT } from '../config.mjs';
import { readJson } from '../fs-safe.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { readLocalGenerationManifest } from '../manifests/local-generations.mjs';
import { assertExistingFileWithin } from '../paths.mjs';
import { validateWith } from '../schemas.mjs';
import { readExternalImage } from '../images/inspect-image.mjs';
import {
  verifyPersistedWaveAUnitAssembly,
  verifyWaveAJobPack
} from '../v2/import-candidate.mjs';
import { resolveWaveAAssetReferences } from '../v2/reference-authorization.mjs';
import { inspectGenerationOutput } from '../validate.mjs';
import { prepareBundleApproval, prepareWaveBundleApproval } from './bundle-ledger.mjs';

function requireGenerationId(generationId) {
  if (typeof generationId !== 'string' || !/^gen_[a-z0-9][a-z0-9_-]{0,127}$/.test(generationId)) {
    throw new Error('Invalid v3 generation id');
  }
}

function approvedArtifactPrefix(category) {
  const directory = {
    character: 'characters', building: 'buildings', terrain: 'terrains', overlay: 'overlays',
    structure: 'structures', interior: 'interiors', prop: 'props', ui: 'ui', effect: 'effects'
  }[category];
  if (!directory) throw new Error(`Unsupported v3 category: ${category}`);
  return `generated/${directory}/approved/`;
}

async function assertGenerationMetadataMatches(root, generation) {
  const metadataPath = await assertExistingFileWithin(root, generation.metadataPath);
  const metadata = await readJson(metadataPath);
  const validation = validateWith('generation-result.schema.json', metadata);
  if (!validation.ok) throw new Error(`Invalid approved generation metadata: ${JSON.stringify(validation.errors)}`);
  if (!isDeepStrictEqual(metadata, generation)) {
    throw new Error('Approved generation metadata does not match the local generation ledger');
  }
}

function requireCurrentV2Markers(generation, definition, authorization) {
  const currentAssetDefinitionSha256 = sha256(canonicalJson(definition));
  const currentReferenceAuthorizationSha256 = sha256(canonicalJson(authorization));
  if (generation.visualContractVersion !== 2
    || generation.requiredSetId !== 'fable5-v2'
    || generation.waveId !== 'A'
    || generation.assetDefinitionSha256 !== currentAssetDefinitionSha256
    || generation.definitionSha256 !== currentAssetDefinitionSha256
    || generation.referenceAuthorizationSha256 !== currentReferenceAuthorizationSha256) {
    throw new Error('Approved generation is stale or is not bound to the current Fable5 Wave A definition and authorization');
  }
  return { currentAssetDefinitionSha256 };
}

function requireApprovedLifecycle(generation) {
  if (generation.status !== 'approved' || generation.approval?.reviewer !== 'human') {
    throw new Error('V3 bundle approval requires an already human-approved lifecycle generation');
  }
  if (generation.dryRun || ['mock', 'job-pack'].includes(generation.provider)) {
    throw new Error('Dry-run, mock, and job-pack results cannot enter the v3 approval ledger');
  }
}

function requirePendingWaveLifecycle(generation) {
  if (generation.status !== 'pending' || generation.provider !== 'manual-import'
    || generation.manualImport !== true || generation.dryRun !== false
    || generation.approval !== undefined) {
    throw new Error('Wave A bulk approval requires an exact pending manual-import generation');
  }
}

function expectedReferenceEvidence(resolvedReferences) {
  return {
    ids: resolvedReferences.references.map(({ id }) => id),
    hashes: resolvedReferences.references.map(({ sha256: hash }) => hash)
  };
}

async function decodedRgba(buffer) {
  return sharp(buffer, { animated: false, failOn: 'error' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function cropRaw(current, crop) {
  if (crop.x + crop.width > current.info.width || crop.y + crop.height > current.info.height) {
    throw new Error('V3 production crop escapes source-original pixels');
  }
  const channels = current.info.channels;
  const data = Buffer.alloc(crop.width * crop.height * channels);
  for (let y = 0; y < crop.height; y += 1) {
    const start = ((crop.y + y) * current.info.width + crop.x) * channels;
    current.data.copy(data, y * crop.width * channels, start, start + crop.width * channels);
  }
  return { data, info: { width: crop.width, height: crop.height, channels } };
}

function chromaKeyRaw(current, chromaKey) {
  const key = [1, 3, 5].map((offset) => Number.parseInt(chromaKey.keyColor.slice(offset, offset + 2), 16));
  const data = Buffer.from(current.data);
  for (let offset = 0; offset < data.length; offset += current.info.channels) {
    const distance = Math.max(...key.map((value, channel) => Math.abs(data[offset + channel] - value)));
    if (distance <= chromaKey.tolerance) data.fill(0, offset, offset + 4);
  }
  return { data, info: { ...current.info } };
}

function hardAlphaRaw(current, threshold) {
  const data = Buffer.from(current.data);
  for (let offset = 0; offset < data.length; offset += current.info.channels) {
    if (data[offset + 3] <= threshold) data.fill(0, offset, offset + 4);
    else data[offset + 3] = 255;
  }
  return { data, info: { ...current.info } };
}

async function nearestResizeRaw(current, width, height) {
  if (current.info.width < width || current.info.height < height) {
    throw new Error('V3 production replay would enlarge source-original pixels');
  }
  return sharp(current.data, { raw: current.info })
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .raw().toBuffer({ resolveWithObject: true });
}

async function replayRecipe(recipe, source, artifact) {
  if (recipe.transformSteps.length === 1 && recipe.transformSteps[0] === 'none') {
    if (recipe.sourceOriginal.format !== 'png' || !source.buffer.equals(artifact.buffer)) {
      throw new Error('V3 none transform is not byte-identical to source-original');
    }
    return;
  }
  let current = await decodedRgba(source.buffer);
  for (const step of recipe.transformSteps) {
    if (step === 'crop') current = cropRaw(current, recipe.cropRect);
    else if (step === 'chroma-key-remove') current = chromaKeyRaw(current, recipe.chromaKey);
    else if (step === 'nearest-downscale') {
      current = await nearestResizeRaw(current, recipe.artifact.width, recipe.artifact.height);
    } else if (step === 'hard-alpha') current = hardAlphaRaw(current, recipe.alphaThreshold);
    else throw new Error(`V3 production replay has an unsupported step: ${step}`);
  }
  const actual = await decodedRgba(artifact.buffer);
  if (actual.info.width !== current.info.width || actual.info.height !== current.info.height
    || !actual.data.equals(current.data)) {
    throw new Error('V3 production replay does not reproduce the pending artifact pixels');
  }
}

async function verifyProductionRecipeV2(root, recipe, output, expectedReferences, promptHash) {
  if (recipe.role !== output.role
    || recipe.artifact?.sha256 !== output.sha256
    || recipe.artifact?.width !== output.inspection?.width
    || recipe.artifact?.height !== output.inspection?.height) {
    throw new Error(`V3 ${output.role} recipe does not bind its exact artifact record`);
  }
  if (recipe.promptSnapshot?.sha256 !== promptHash) {
    throw new Error(`V3 ${output.role} recipe prompt snapshot does not match the generation prompt hash`);
  }
  if (!isDeepStrictEqual(recipe.inputReferences, expectedReferences)) {
    throw new Error(`V3 ${output.role} recipe does not match the current authorized reference inputs`);
  }
  const promptPath = await assertExistingFileWithin(root, recipe.promptSnapshot.path);
  if (sha256(await readFile(promptPath)) !== recipe.promptSnapshot.sha256) {
    throw new Error(`V3 ${output.role} recipe prompt snapshot hash mismatch`);
  }
  const sourcePath = await assertExistingFileWithin(root, recipe.sourceOriginal.path);
  const source = await readExternalImage(sourcePath);
  if (sha256(source.buffer) !== recipe.sourceOriginal.sha256
    || source.metadata.width !== recipe.sourceOriginal.width
    || source.metadata.height !== recipe.sourceOriginal.height) {
    throw new Error(`V3 ${output.role} recipe original source provenance mismatch`);
  }
  const pendingArtifactPath = await assertExistingFileWithin(root, recipe.artifact.path);
  const pendingArtifact = await readExternalImage(pendingArtifactPath);
  if (sha256(pendingArtifact.buffer) !== recipe.artifact.sha256
    || pendingArtifact.metadata.width !== recipe.artifact.width
    || pendingArtifact.metadata.height !== recipe.artifact.height) {
    throw new Error(`V3 ${output.role} pending recipe artifact provenance mismatch`);
  }
  await replayRecipe(recipe, source, pendingArtifact);
}

async function verifyProduction(root, generation, definition, expectedReferences) {
  const outputs = definition.category === 'building'
    ? (generation.outputArtifacts ?? [])
    : [{
        role: 'primary',
        path: generation.outputPath,
        sha256: generation.outputSha256,
        inspection: generation.outputInspection
      }];
  const expectedRoles = definition.category === 'building' ? ['base', 'roof'] : ['primary'];
  if (outputs.length !== expectedRoles.length
    || outputs.some((output, index) => output?.role !== expectedRoles[index])) {
    throw new Error(definition.category === 'building'
      ? 'V3 building approval requires one ordered base/roof generation bundle'
      : 'V3 ordinary approval requires one primary generation artifact');
  }
  const recipes = generation.productionRecipesV2 ?? [];
  if (recipes.length !== expectedRoles.length
    || recipes.some((recipe, index) => recipe?.role !== expectedRoles[index])) {
    throw new Error('V3 bundle requires one exact v2 production recipe per ordered artifact');
  }
  const auditGeneration = definition.category === 'building' && !generation.outputPath
    ? {
        ...generation,
        outputPath: outputs[0].path,
        outputSha256: outputs[0].sha256,
        outputInspection: outputs[0].inspection
      }
    : (generation.requiredSetId === 'fable5-v2' && generation.status === 'pending'
        && !generation.processedFromGenerationId
      ? { ...generation, processedFromGenerationId: generation.id }
      : generation);
  const outputAudit = await inspectGenerationOutput(root, auditGeneration, { definition });
  if (outputAudit.problem) {
    throw new Error(`V3 bundle technical provenance failed: ${outputAudit.problem}`);
  }
  for (let index = 0; index < outputs.length; index += 1) {
    await verifyProductionRecipeV2(
      root, recipes[index], outputs[index], expectedReferences, generation.promptHash
    );
  }
  return outputs;
}

/**
 * Re-resolve every mutable input used by a v3 approval. This is intentionally
 * not dependency-injectable: callers may not substitute a mock verifier on a
 * path that can later become a persisted approval or public export.
 */
async function verifyGeneration({ assetId, generationId }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  requiredStatus
} = {}) {
  requireGenerationId(generationId);
  const resolvedReferences = await resolveWaveAAssetReferences(assetId, { root: forgeRoot });
  const definition = resolvedReferences.asset;
  if (definition.visualContractVersion !== 2 || definition.required !== true) {
    throw new Error('V3 bundle approval requires a current required VisualAssetContract v2 definition');
  }
  const review = resolvedReferences.authorization.independentReview;
  if (resolvedReferences.authorization.requiredSetId !== 'fable5-v2'
    || resolvedReferences.authorization.waveId !== 'A'
    || resolvedReferences.authorization.status !== 'approved'
    || review?.status !== 'pass') {
    throw new Error('V3 bundle approval requires approved Wave A reference authorization');
  }

  const manifest = await readLocalGenerationManifest(root);
  const generation = manifest.results.find((entry) => entry.id === generationId);
  if (!generation) throw new Error(`Unknown generation result: ${generationId}`);
  if (requiredStatus === 'approved') requireApprovedLifecycle(generation);
  else if (requiredStatus === 'pending') requirePendingWaveLifecycle(generation);
  else throw new Error('V3 generation verification requires an explicit lifecycle status');
  if (generation.assetId !== assetId || generation.category !== definition.category) {
    throw new Error('Approved generation does not match the current v2 asset definition');
  }
  const { currentAssetDefinitionSha256 } = requireCurrentV2Markers(
    generation, definition, resolvedReferences.authorization
  );
  await assertGenerationMetadataMatches(root, generation);
  const deepAssembly = await verifyPersistedWaveAUnitAssembly(generation, { root, forgeRoot });
  if (deepAssembly.asset.id !== assetId || deepAssembly.job.id !== generation.jobId
    || deepAssembly.generationId !== generation.id) {
    throw new Error('V3 deep unit-assembly verifier returned mismatched generation authority');
  }
  const verifiedPack = await verifyWaveAJobPack(generation.sourceJobPackPathV2, {
    root,
    forgeRoot
  });
  if (verifiedPack.job.id !== generation.jobId
    || verifiedPack.job.assetId !== generation.assetId
    || verifiedPack.job.definitionSha256 !== generation.definitionSha256
    || verifiedPack.job.assetDefinitionSha256 !== generation.assetDefinitionSha256
    || verifiedPack.job.promptSha256 !== generation.promptHash
    || verifiedPack.job.referenceAuthorizationSha256 !== generation.referenceAuthorizationSha256) {
    throw new Error('V3 generation no longer matches its current canonical Wave A job pack');
  }

  const expectedReferences = expectedReferenceEvidence(resolvedReferences);
  if (!isDeepStrictEqual(generation.referenceImageIds, expectedReferences.ids)
    || !isDeepStrictEqual(generation.referenceImageHashes, expectedReferences.hashes)) {
    throw new Error('Approved generation does not match its authorized Wave A reference set');
  }
  const recipeReferences = resolvedReferences.references.map((reference, index) => ({
    id: reference.id,
    sha256: reference.sha256,
    role: index === 0 ? 'global-style' : 'primary-subject'
  }));
  const outputs = await verifyProduction(root, generation, definition, recipeReferences);

  const prefix = approvedArtifactPrefix(definition.category);
  let artifacts;
  if (requiredStatus === 'pending') {
    artifacts = outputs.map((artifact) => ({
      role: artifact.role,
      generationId: generation.id,
      pendingPath: artifact.path,
      sha256: artifact.sha256,
      inspection: structuredClone(artifact.inspection)
    }));
  } else if (definition.category === 'building') {
    if (outputs.some(({ path: outputPath }) => !outputPath.startsWith(prefix))) {
      throw new Error('V3 building base and roof must both already be in approved state');
    }
    if (outputs[0].path === outputs[1].path || outputs[0].sha256 === outputs[1].sha256) {
      throw new Error('V3 building base and roof must be distinct approved artifacts');
    }
    artifacts = outputs.map((artifact) => ({
      role: artifact.role,
      generationId: generation.id,
      approvedPath: artifact.path,
      sha256: artifact.sha256
    }));
  } else {
    if (!generation.outputPath.startsWith(prefix)
      || generation.outputPath !== generation.approval.approvedPath
      || generation.outputSha256 !== generation.approval.approvedSha256) {
      throw new Error('V3 asset output does not match its human-approved category state');
    }
    artifacts = [{
      role: 'primary',
      generationId: generation.id,
      approvedPath: generation.outputPath,
      sha256: generation.outputSha256
    }];
  }

  return {
    definition,
    definitionSha256: currentAssetDefinitionSha256,
    generation,
    generationRecordDigest: sha256(canonicalJson(generation)),
    artifacts
  };
}

export async function verifyApprovedGenerationForBundle(input, options = {}) {
  return verifyGeneration(input, { ...options, requiredStatus: 'approved' });
}

export async function verifyPendingGenerationForWaveApproval(input, options = {}) {
  return verifyGeneration(input, { ...options, requiredStatus: 'pending' });
}

export async function verifyBundleApprovalForExport(approval, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  const generationIds = [...new Set(approval.artifacts.map(({ generationId }) => generationId))];
  if (generationIds.length !== 1) {
    throw new Error(`V3 bundle approval must resolve to one lifecycle generation: ${approval.assetId}`);
  }
  const waveDirectories = [...new Set(approval.artifacts.map(({ approvedPath }) => {
    const match = /^(generated\/v3\/wave-bundles\/[a-f0-9]{64})\/[a-z0-9][a-z0-9_.-]*\.png$/.exec(approvedPath);
    return match?.[1] ?? null;
  }))];
  const isWaveBundle = waveDirectories.length === 1 && waveDirectories[0] !== null;
  if (waveDirectories.some((directory) => directory === null) && waveDirectories.some(Boolean)) {
    throw new Error(`V3 bundle approval mixes lifecycle and Wave A bundle paths: ${approval.assetId}`);
  }
  const verified = await (isWaveBundle
    ? verifyPendingGenerationForWaveApproval({
        assetId: approval.assetId,
        generationId: generationIds[0]
      }, { root, forgeRoot })
    : verifyApprovedGenerationForBundle({
        assetId: approval.assetId,
        generationId: generationIds[0]
      }, { root, forgeRoot }));
  const reconstructedArtifacts = isWaveBundle
    ? verified.artifacts.map((artifact, index) => ({
        role: artifact.role,
        generationId: artifact.generationId,
        approvedPath: approval.artifacts[index]?.approvedPath,
        sha256: artifact.sha256
      }))
    : verified.artifacts;
  if (isWaveBundle) {
    for (const artifact of reconstructedArtifacts) {
      const materializedPath = await assertExistingFileWithin(root, artifact.approvedPath);
      if (sha256(await readFile(materializedPath)) !== artifact.sha256) {
        throw new Error(`Wave A materialized bundle artifact hash mismatch: ${artifact.approvedPath}`);
      }
    }
  }
  const input = {
    assetId: approval.assetId,
    category: verified.definition.category,
    definitionSha256: verified.definitionSha256,
    generationRecordDigest: verified.generationRecordDigest,
    artifacts: reconstructedArtifacts,
    reviewer: approval.reviewer,
    note: approval.note,
    approvedAt: approval.approvedAt
  };
  const reconstructed = isWaveBundle
    ? prepareWaveBundleApproval(input, { bundleDirectory: waveDirectories[0] })
    : prepareBundleApproval(input);
  if (!isDeepStrictEqual(reconstructed, approval)) {
    throw new Error(`V3 bundle approval no longer matches verified provenance: ${approval.assetId}`);
  }
  return {
    assetId: approval.assetId,
    definitionSha256: verified.definitionSha256,
    generationRecordDigest: verified.generationRecordDigest,
    artifacts: structuredClone(reconstructedArtifacts)
  };
}
