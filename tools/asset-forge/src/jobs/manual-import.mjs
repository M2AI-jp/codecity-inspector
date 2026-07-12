import path from 'node:path';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { atomicWriteFile, atomicWriteJson } from '../fs-safe.mjs';
import { canonicalJson, hashApprovedTree, hashFile, sha256 } from '../hashing.mjs';
import { readExternalImage, normalizeImportedImage } from '../images/inspect-image.mjs';
import { appendGenerationResult } from '../manifests/local-generations.mjs';
import { assetFileStem, resolveWithin, toPosixRelative } from '../paths.mjs';
import { inspectPng } from '../png-core.mjs';
import { validateWith } from '../schemas.mjs';
import { buildJob } from './build-job.mjs';

export async function importCandidate({ assetId, file, seed = '', allowPendingReferences = false }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  now = () => new Date().toISOString()
} = {}) {
  if (!file) throw new Error('--file is required');
  const approvedBefore = await hashApprovedTree(root);
  const source = await readExternalImage(file);
  const { asset, job } = await buildJob({
    assetId, provider: 'manual-import', seed, allowPendingReferences
  }, { forgeRoot });
  const sourceSha256 = sha256(source.buffer);
  const importProvenanceKey = sha256(canonicalJson({
    jobProvenanceKey: job.provenanceKey, sourceSha256, sourceFormat: source.sourceFormat
  }));
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
  await appendGenerationResult(root, result);
  const approvedAfter = await hashApprovedTree(root);
  if (approvedAfter !== approvedBefore) throw new Error('Approved tree changed during manual import');
  return { status: 'pending', result, approvedTreeSha256Before: approvedBefore, approvedTreeSha256After: approvedAfter };
}
