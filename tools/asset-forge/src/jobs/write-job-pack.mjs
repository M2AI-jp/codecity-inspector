import path from 'node:path';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { atomicWriteFile, atomicWriteJson, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, hashApprovedTree } from '../hashing.mjs';
import { appendGenerationResultUnlocked } from '../manifests/local-generations.mjs';
import { assetFileStem, toPosixRelative } from '../paths.mjs';
import { validateWith } from '../schemas.mjs';
import { buildJob } from './build-job.mjs';

export async function writeJobPack({ assetId, seed = '', allowPendingReferences = false }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  now = () => new Date().toISOString()
} = {}) {
  return withFileLock(root, pathsFor(root).requiredPromotionLock, () => writeJobPackLocked({
    assetId, seed, allowPendingReferences
  }, { root, forgeRoot, now }));
}

async function writeJobPackLocked({ assetId, seed, allowPendingReferences }, {
  root, forgeRoot, now
}) {
  const approvedBefore = await hashApprovedTree(root);
  const { asset, job, references } = await buildJob({
    assetId, provider: 'job-pack', seed, allowPendingReferences, requireReferences: !allowPendingReferences
  }, { forgeRoot });
  const packRoot = path.join(pathsFor(root).jobs, `${assetFileStem(assetId)}-${job.id}`);
  const files = {
    job: path.join(packRoot, 'job.json'),
    prompt: path.join(packRoot, 'prompt.md'),
    contract: path.join(packRoot, 'output-contract.json'),
    command: path.join(packRoot, 'import-command.txt'),
    readme: path.join(packRoot, 'README.md'),
    manifest: path.join(packRoot, 'job-pack.json')
  };
  await atomicWriteJson(root, files.job, job);
  await atomicWriteFile(root, files.prompt, job.promptText);
  await atomicWriteJson(root, files.contract, job.outputContract);
  await atomicWriteFile(root, files.command, `npm run import -- --asset ${assetId} --file /absolute/path/to/candidate.png\n`);
  const copiedReferences = [];
  for (const reference of references) {
    const destination = path.join(packRoot, 'references', path.basename(reference.absolutePath));
    await atomicWriteFile(root, destination, reference.bytes);
    copiedReferences.push({ id: reference.id, sha256: reference.sha256, path: toPosixRelative(root, destination) });
  }
  await atomicWriteFile(root, files.readme, `# Asset Forge job pack\n\nAsset: ${assetId}\n\nThis pack generates no image. Return an image through the manual import command. Every imported result remains pending.\n`);
  const pack = {
    schemaVersion: 1,
    jobId: job.id,
    assetId,
    promptPath: toPosixRelative(root, files.prompt),
    referenceIds: copiedReferences.map(({ id }) => id),
    outputContractPath: toPosixRelative(root, files.contract),
    importCommandPath: toPosixRelative(root, files.command),
    status: 'job-pack'
  };
  const packValidation = validateWith('job-pack.schema.json', pack);
  if (!packValidation.ok) throw new Error(`Invalid job pack: ${JSON.stringify(packValidation.errors)}`);
  await atomicWriteJson(root, files.manifest, pack);
  const metadataPath = path.join(packRoot, 'result.json');
  const result = {
    id: `gen_pack_${job.provenanceKey.slice(0, 20)}`,
    jobId: job.id,
    assetId,
    category: asset.category,
    status: 'job-pack',
    provider: 'job-pack',
    metadataPath: toPosixRelative(root, metadataPath),
    promptHash: job.promptHash,
    provenanceKey: job.provenanceKey,
    referenceImageIds: job.referenceImageIds,
    referenceImageHashes: job.referenceImageHashes,
    dryRun: false,
    subscriptionRun: false,
    manualImport: false,
    jobPackPath: toPosixRelative(root, files.manifest),
    warnings: [...job.warnings],
    createdAt: now(),
    inspection: {
      status: 'pending-inspection',
      observed: ['Job, prompt, output contract, import command, and reference hash list were written.', `Pack canonical hash input: ${canonicalJson(pack).length} bytes.`],
      inferred: ['The pack is self-contained for the declared references.'],
      unknown: ['external generator behavior', 'visual suitability', 'human approval']
    }
  };
  const validation = validateWith('generation-result.schema.json', result);
  if (!validation.ok) throw new Error(`Invalid job-pack result: ${JSON.stringify(validation.errors)}`);
  await atomicWriteJson(root, metadataPath, result);
  await appendGenerationResultUnlocked(root, result);
  const approvedAfter = await hashApprovedTree(root);
  if (approvedAfter !== approvedBefore) throw new Error('Approved tree changed during job-pack creation');
  return { status: 'job-pack', job, pack, result, approvedTreeSha256Before: approvedBefore, approvedTreeSha256After: approvedAfter };
}
