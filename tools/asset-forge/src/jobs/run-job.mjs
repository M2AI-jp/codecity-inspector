import path from 'node:path';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { atomicWriteFile, atomicWriteJson } from '../fs-safe.mjs';
import { hashApprovedTree, hashFile, sha256 } from '../hashing.mjs';
import { appendGenerationResult } from '../manifests/local-generations.mjs';
import { assetFileStem, resolveWithin, toPosixRelative } from '../paths.mjs';
import { inspectPng } from '../png-core.mjs';
import { providerFor } from '../providers/index.mjs';
import { validateWith } from '../schemas.mjs';
import { buildJob } from './build-job.mjs';

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500) || 'Unknown provider failure';
}

function baseResult({ asset, job, metadataPath, now }) {
  return {
    id: `gen_${job.provenanceKey.slice(0, 20)}`,
    jobId: job.id,
    assetId: asset.id,
    category: asset.category,
    provider: job.provider,
    metadataPath,
    promptHash: job.promptHash,
    provenanceKey: job.provenanceKey,
    referenceImageIds: job.referenceImageIds,
    referenceImageHashes: job.referenceImageHashes,
    dryRun: false,
    subscriptionRun: job.subscriptionRun,
    manualImport: false,
    warnings: [...job.warnings],
    createdAt: now(),
    inspection: {
      status: 'pending-inspection',
      observed: [],
      inferred: [],
      unknown: ['visual suitability', 'human approval', 'runtime integration']
    }
  };
}

function assertValidResult(result) {
  const validation = validateWith('generation-result.schema.json', result);
  if (!validation.ok) throw new Error(`Invalid generation result: ${JSON.stringify(validation.errors)}`);
}

export class GenerationRunError extends Error {
  constructor(message, result, options) {
    super(message, options);
    this.name = 'GenerationRunError';
    this.result = result;
  }
}

export async function runJob(options, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  now = () => new Date().toISOString(),
  providerOverrides = {},
  manifestHooks = {}
} = {}) {
  const { asset, job } = await buildJob(options, { forgeRoot });
  if (job.dryRun) return { status: 'dry-run', job, wrote: [] };

  const approvedBefore = await hashApprovedTree(root);
  const outputDir = resolveWithin(root, job.outputDir);
  const base = `${assetFileStem(asset.id)}-${job.id}`;
  const outputPath = path.join(outputDir, `${base}.png`);
  const metadataPath = path.join(outputDir, `${base}.json`);
  const relativeMetadataPath = toPosixRelative(root, metadataPath);
  let provider;
  let png;
  try {
    provider = providerFor(job.provider, { overrides: providerOverrides });
    png = await provider.generate(job, options);
  } catch (error) {
    const paths = pathsFor(root);
    const failedMetadataPath = path.join(paths.local, 'failures', `${base}.json`);
    const failed = {
      ...baseResult({
        asset,
        job,
        metadataPath: toPosixRelative(root, failedMetadataPath),
        now
      }),
      status: 'failed',
      error: sanitizeError(error)
    };
    failed.inspection.observed.push('Provider did not produce an accepted output file.');
    failed.inspection.unknown.push('provider side effects outside Asset Forge');
    assertValidResult(failed);
    await atomicWriteJson(root, failedMetadataPath, failed);
    await appendGenerationResult(root, failed, manifestHooks);
    const approvedAfterFailure = await hashApprovedTree(root);
    if (approvedAfterFailure !== approvedBefore) throw new Error('Approved tree changed during failed generation');
    throw new GenerationRunError(`Generation failed: ${failed.error}`, failed, { cause: error });
  }

  const inspection = inspectPng(png);
  if (inspection.width !== job.outputContract.width || inspection.height !== job.outputContract.height) {
    throw new Error(`Provider output dimensions ${inspection.width}x${inspection.height} do not match ${job.outputContract.width}x${job.outputContract.height}`);
  }
  try {
    await atomicWriteFile(root, outputPath, png);
  } catch (error) {
    throw new Error('Generation output persistence failed; no successful result was recorded and candidate state is unknown.', { cause: error });
  }
  const outputSha256 = sha256(png);
  if (await hashFile(outputPath) !== outputSha256) throw new Error('Persisted generation output hash mismatch');
  const result = {
    ...baseResult({ asset, job, metadataPath: relativeMetadataPath, now }),
    status: 'pending',
    outputPath: toPosixRelative(root, outputPath),
    outputSha256,
    outputInspection: inspection
  };
  result.warnings.push('Mock output is a pending technical fixture, not approved game art.');
  result.inspection.observed.push(
    `PNG signature, ${inspection.width}x${inspection.height} dimensions, ${inspection.channels} channels, byte length, and SHA-256 were checked.`,
    'Candidate and metadata paths are inside generated pending state.'
  );
  result.inspection.inferred.push('The deterministic mock output is suitable for exercising the pipeline only.');
  assertValidResult(result);
  try {
    await atomicWriteJson(root, metadataPath, result);
    await appendGenerationResult(root, result, manifestHooks);
  } catch (error) {
    throw new Error('Generation metadata persistence failed; no successful result was returned and candidate state is incomplete.', { cause: error });
  }
  const approvedAfter = await hashApprovedTree(root);
  if (approvedAfter !== approvedBefore) throw new Error('Approved tree changed during generation');
  return {
    status: 'pending',
    job,
    result,
    approvedTreeSha256Before: approvedBefore,
    approvedTreeSha256After: approvedAfter,
    wrote: [outputPath, metadataPath, pathsFor(root).localGenerationManifest]
  };
}
