import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { atomicWriteFile, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, hashApprovedTree, sha256 } from '../hashing.mjs';
import {
  appendGenerationResultUnlocked,
  readLocalGenerationManifest
} from '../manifests/local-generations.mjs';
import { assertExistingFileWithin, assetFileStem, toPosixRelative } from '../paths.mjs';
import { validateWith } from '../schemas.mjs';
import { buildWaveAJob } from './build-job.mjs';

async function existingFile(root, absolutePath) {
  try {
    return await readFile(await assertExistingFileWithin(root, toPosixRelative(root, absolutePath)));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeOrVerify(root, absolutePath, bytes, label) {
  const existing = await existingFile(root, absolutePath);
  if (existing) {
    if (!existing.equals(bytes)) throw new Error(`${label} conflicts with an incomplete prior Wave A job pack`);
    return 'existing-identical';
  }
  await atomicWriteFile(root, absolutePath, bytes);
  return 'written';
}

function resultForPack({ job, asset, packPath, metadataPath, warnings, createdAt }) {
  return {
    visualContractVersion: 2,
    requiredSetId: job.requiredSetId,
    waveId: job.waveId,
    definitionSha256: job.definitionSha256,
    assetDefinitionSha256: job.assetDefinitionSha256,
    referenceAuthorizationSha256: job.referenceAuthorizationSha256,
    id: `gen_v2_pack_${job.provenanceKey.slice(0, 20)}`,
    jobId: job.id,
    assetId: job.assetId,
    category: asset.category,
    status: 'job-pack',
    provider: 'job-pack',
    metadataPath,
    promptHash: job.promptSha256,
    provenanceKey: job.provenanceKey,
    referenceImageIds: job.referenceImages.map(({ id }) => id),
    referenceImageHashes: job.referenceImages.map(({ sha256: digest }) => digest),
    dryRun: false,
    subscriptionRun: false,
    manualImport: false,
    jobPackPath: packPath,
    warnings: [
      ...warnings,
      'This pack creates no asset bytes; all future imports remain pending until separate human approval.'
    ],
    createdAt,
    inspection: {
      status: 'pending-inspection',
      observed: [
        'The exact Wave A definition, rendered per-asset prompt, canonical generation-unit plan, and two authorized reference byte snapshots were written.',
        `The canonical definition hash is ${job.definitionSha256}; the separate prompt hash is ${job.promptSha256}.`
      ],
      inferred: ['The pack is self-contained for its declared generation inputs.'],
      unknown: ['generator output', 'visual suitability', 'human approval', 'runtime integration']
    }
  };
}

export async function writeWaveAJobPack({ assetId, seed = '', generationMode = 'per-unit' }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  if (path.resolve(root) !== path.resolve(forgeRoot)) {
    throw new Error('Wave A job-pack writes require one canonical Forge root');
  }
  // Resolve and validate every authorization/definition/prompt/reference input before
  // acquiring a write lock. A failed production gate therefore leaves no pack debris.
  const built = await buildWaveAJob({ assetId, seed, generationMode }, { forgeRoot });
  return withFileLock(root, pathsFor(root).requiredPromotionLock, () =>
    writeWaveAJobPackLocked(built, { root }));
}

async function writeWaveAJobPackLocked({
  asset, job, references, definitionSnapshot, authorization, independentReviewBytes, warnings
}, {
  root
}) {
  const approvedBefore = await hashApprovedTree(root);
  const packRoot = path.join(
    pathsFor(root).jobs,
    'v2',
    'fable5-v2',
    'wave-a',
    `${assetFileStem(job.assetId)}-${job.id}`
  );
  const memberPaths = {
    job: path.join(packRoot, 'job.json'),
    prompt: path.join(packRoot, 'prompt.md'),
    definition: path.join(packRoot, 'definition.json'),
    unitPlan: path.join(packRoot, 'unit-plan.json'),
    authorization: path.join(packRoot, 'authorization.json'),
    independentReview: path.join(packRoot, 'independent-review.json'),
    manifest: path.join(packRoot, 'job-pack.json'),
    result: path.join(packRoot, 'result.json')
  };
  const memberBytes = {
    job: Buffer.from(canonicalJson(job)),
    prompt: Buffer.from(job.promptText),
    definition: Buffer.from(canonicalJson(definitionSnapshot)),
    unitPlan: Buffer.from(canonicalJson({
      schemaVersion: 2,
      requiredSetId: job.requiredSetId,
      waveId: job.waveId,
      assetId: job.assetId,
      generationMode: job.generationMode,
      generationUnitSetSha256: job.generationUnitSetSha256,
      generationExpectations: job.generationExpectations,
      generationUnits: job.generationUnits,
      identityMasterPlan: job.identityMasterPlan
    })),
    authorization: Buffer.from(canonicalJson(authorization)),
    independentReview: independentReviewBytes
  };
  if (sha256(memberBytes.definition) !== job.definitionSha256
    || sha256(memberBytes.authorization) !== job.referenceAuthorizationSha256
    || sha256(memberBytes.independentReview) !== job.independentReviewSha256) {
    throw new Error('Wave A job-pack snapshots do not match the job provenance');
  }
  const referenceMembers = references.map((reference, index) => {
    const contract = job.referenceImages[index];
    const filename = `${String(index + 1).padStart(2, '0')}-${contract.role}-${contract.id.replaceAll('.', '_')}.${contract.extension}`;
    const absolutePath = path.join(packRoot, 'references', filename);
    return {
      id: contract.id,
      role: contract.role,
      path: toPosixRelative(root, absolutePath),
      sha256: contract.sha256,
      absolutePath,
      bytes: reference.bytes
    };
  });
  const packWithoutDigest = {
    schemaVersion: 2,
    requiredSetId: job.requiredSetId,
    waveId: job.waveId,
    status: 'job-pack',
    jobId: job.id,
    assetId: job.assetId,
    category: job.category,
    generationMode: job.generationMode,
    generationUnitSetSha256: job.generationUnitSetSha256,
    generationExpectations: job.generationExpectations,
    generationUnitIds: job.generationUnits.map(({ unitId }) => unitId),
    identityMasterPlanId: job.identityMasterPlan?.planId ?? null,
    members: {
      job: { path: toPosixRelative(root, memberPaths.job), sha256: sha256(memberBytes.job) },
      prompt: { path: toPosixRelative(root, memberPaths.prompt), sha256: sha256(memberBytes.prompt) },
      definition: { path: toPosixRelative(root, memberPaths.definition), sha256: sha256(memberBytes.definition) },
      unitPlan: { path: toPosixRelative(root, memberPaths.unitPlan), sha256: sha256(memberBytes.unitPlan) },
      authorization: {
        path: toPosixRelative(root, memberPaths.authorization),
        sha256: sha256(memberBytes.authorization)
      },
      independentReview: {
        path: toPosixRelative(root, memberPaths.independentReview),
        sha256: sha256(memberBytes.independentReview)
      }
    },
    references: referenceMembers.map(({ id, role, path: relativePath, sha256: digest }) => ({
      id, role, path: relativePath, sha256: digest
    })),
    artifactRoles: job.artifactContracts.map(({ role }) => role)
  };
  const pack = {
    ...packWithoutDigest,
    contentDigest: sha256(canonicalJson(packWithoutDigest))
  };
  const packValidation = validateWith('job-pack-v2.schema.json', pack);
  if (!packValidation.ok) {
    throw new Error(`Invalid Fable5 Wave A job pack: ${JSON.stringify(packValidation.errors)}`);
  }
  const packBytes = Buffer.from(canonicalJson(pack));
  const packPath = toPosixRelative(root, memberPaths.manifest);
  const metadataPath = toPosixRelative(root, memberPaths.result);
  const manifest = await readLocalGenerationManifest(root);
  const resultId = `gen_v2_pack_${job.provenanceKey.slice(0, 20)}`;
  const existingResult = manifest.results.find(({ id }) => id === resultId);
  const existingMetadataBytes = await existingFile(root, memberPaths.result);
  let existingMetadata = null;
  if (existingMetadataBytes) {
    try { existingMetadata = JSON.parse(existingMetadataBytes.toString('utf8')); }
    catch (error) { throw new Error('Incomplete Wave A job-pack metadata is malformed', { cause: error }); }
  }
  const result = resultForPack({
    job,
    asset,
    packPath,
    metadataPath,
    warnings,
    createdAt: existingResult?.createdAt ?? existingMetadata?.createdAt ?? new Date().toISOString()
  });
  const resultValidation = validateWith('generation-result.schema.json', result);
  if (!resultValidation.ok) {
    throw new Error(`Invalid Fable5 Wave A job-pack result: ${JSON.stringify(resultValidation.errors)}`);
  }
  const resultBytes = Buffer.from(canonicalJson(result));
  if (existingResult && canonicalJson(existingResult) !== canonicalJson(result)) {
    throw new Error('Existing Wave A job-pack ledger entry conflicts with deterministic provenance');
  }
  if (existingMetadata && canonicalJson(existingMetadata) !== canonicalJson(result)) {
    throw new Error('Existing Wave A job-pack metadata conflicts with deterministic provenance');
  }

  // Validate every destination before the first write.  Existing identical files
  // are crash debris and make the operation resumable; conflicts fail closed.
  const destinations = [
    ...Object.entries(memberBytes).map(([name, bytes]) => ({
      path: memberPaths[name], bytes, label: `Wave A ${name} snapshot`
    })),
    ...referenceMembers.map((reference) => ({
      path: reference.absolutePath,
      bytes: reference.bytes,
      label: `Wave A reference ${reference.id}`
    })),
    { path: memberPaths.manifest, bytes: packBytes, label: 'Wave A pack manifest' },
    { path: memberPaths.result, bytes: resultBytes, label: 'Wave A pack result' }
  ];
  const states = [];
  for (const destination of destinations) {
    const bytes = await existingFile(root, destination.path);
    if (bytes && !bytes.equals(destination.bytes)) {
      throw new Error(`${destination.label} conflicts with an incomplete prior Wave A job pack`);
    }
    states.push(bytes ? 'existing-identical' : 'missing');
  }

  const newlyWritten = [];
  try {
    for (const [index, destination] of destinations.entries()) {
      if (states[index] === 'existing-identical') continue;
      await writeOrVerify(root, destination.path, destination.bytes, destination.label);
      newlyWritten.push(destination.path);
    }
    const approvedAfter = await hashApprovedTree(root);
    if (approvedAfter !== approvedBefore) {
      throw new Error('Approved tree changed during Wave A job-pack creation');
    }
    if (!existingResult) await appendGenerationResultUnlocked(root, result);
    return {
      status: 'job-pack',
      job,
      pack,
      result: existingResult ?? result,
      resumed: Boolean(existingResult || existingMetadata || states.some((state) => state !== 'missing')),
      approvedTreeSha256Before: approvedBefore,
      approvedTreeSha256After: approvedAfter
    };
  } catch (error) {
    for (const destination of newlyWritten.reverse()) await rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}
