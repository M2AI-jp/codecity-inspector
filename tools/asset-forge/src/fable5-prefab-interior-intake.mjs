import path from 'node:path';
import { readFile } from 'node:fs/promises';

import sharp from 'sharp';

import { FORGE_ROOT, pathsFor } from './config.mjs';
import { atomicWriteFile, atomicWriteJson, withFileLock } from './fs-safe.mjs';
import { canonicalJson, hashApprovedTree, sha256 } from './hashing.mjs';
import { readExternalImage } from './images/inspect-image.mjs';
import { assertExistingFileWithin, toPosixRelative } from './paths.mjs';
import { validateWith } from './schemas.mjs';
import { buildFable5PrefabInteriorJob } from './fable5-prefab-interior-jobs.mjs';

function projectRootFor(forgeRoot, projectRoot) {
  return path.resolve(projectRoot ?? path.join(forgeRoot, '..', '..'));
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function requireJobPackPath(jobPackPath) {
  if (typeof jobPackPath !== 'string' || !/^generated\/jobs\/[a-z0-9_]+\/job-pack\.json$/.test(jobPackPath)) {
    throw new Error('Fable5 interior intake requires generated/jobs/<job-id>/job-pack.json');
  }
  return jobPackPath;
}

async function readJsonWithin(root, relativePath, label) {
  const sourcePath = await assertExistingFileWithin(root, relativePath);
  try {
    return JSON.parse(await readFile(sourcePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

async function readTextWithin(root, relativePath, label) {
  const sourcePath = await assertExistingFileWithin(root, relativePath);
  try {
    return readFile(sourcePath, 'utf8');
  } catch (error) {
    throw new Error(`${label} could not be read`, { cause: error });
  }
}

export async function verifyFable5PrefabInteriorJobPack({ assetId, jobPackPath }, {
  forgeRoot = FORGE_ROOT,
  projectRoot = undefined
} = {}) {
  const canonicalForgeRoot = path.resolve(forgeRoot);
  const canonicalProjectRoot = projectRootFor(canonicalForgeRoot, projectRoot);
  const requestedPackPath = requireJobPackPath(jobPackPath);
  const pack = await readJsonWithin(canonicalForgeRoot, requestedPackPath, 'Fable5 interior job pack');
  const validation = validateWith('job-pack.schema.json', pack);
  if (!validation.ok) throw new Error(`Invalid Fable5 interior job pack: ${JSON.stringify(validation.errors)}`);
  if (pack.assetId !== assetId) throw new Error('Fable5 interior job pack asset does not match requested asset');

  const expected = await buildFable5PrefabInteriorJob({ assetId }, {
    forgeRoot: canonicalForgeRoot,
    projectRoot: canonicalProjectRoot
  });
  if (pack.jobId !== expected.job.id || !sameJson(pack, expected.pack)) {
    throw new Error('Fable5 interior job pack is stale, tampered, or belongs to a different contract');
  }
  const job = await readJsonWithin(canonicalForgeRoot, expected.pack.promptPath.replace(/prompt\.md$/, 'job.json'), 'Fable5 interior job');
  const outputContract = await readJsonWithin(canonicalForgeRoot, expected.pack.outputContractPath, 'Fable5 interior output contract');
  const references = await readJsonWithin(
    canonicalForgeRoot,
    expected.pack.promptPath.replace(/prompt\.md$/, 'references.json'),
    'Fable5 interior reference receipts'
  );
  const prompt = await readTextWithin(canonicalForgeRoot, expected.pack.promptPath, 'Fable5 interior prompt');
  const intakeGuide = await readTextWithin(canonicalForgeRoot, expected.pack.importCommandPath, 'Fable5 interior intake guide');
  if (!sameJson(job, expected.job)
    || !sameJson(outputContract, expected.job.outputContract)
    || !sameJson(references, { ledger: 'art/contracts/user-provided-images.json', references: expected.job.references })
    || prompt !== expected.promptText
    || !intakeGuide.includes('human')
    || !intakeGuide.includes('never transforms')) {
    throw new Error('Fable5 interior job-pack members do not match their verified preflight');
  }
  return Object.freeze({ jobPackPath: requestedPackPath, job: expected.job, pack: expected.pack });
}

function validOutputContract(outputContract) {
  const dimensionsValid = Number.isInteger(outputContract?.width) && Number.isInteger(outputContract?.height)
    && outputContract.width > 0 && outputContract.height > 0;
  const source = outputContract?.composition?.semanticSource;
  const semanticValid = typeof source?.minimumOpaqueCoverage === 'number'
    && source.minimumOpaqueCoverage > 0 && source.minimumOpaqueCoverage <= 1
    && Array.isArray(source.requiredOpaqueRects) && source.requiredOpaqueRects.length > 0;
  if (!dimensionsValid || outputContract?.kind !== 'interior-kit' || outputContract?.alphaChannelRequired !== true || !semanticValid) {
    throw new Error('Fable5 interior output contract is invalid');
  }
  for (const rect of source.requiredOpaqueRects) {
    if (!Number.isInteger(rect?.x) || !Number.isInteger(rect?.y) || !Number.isInteger(rect?.width) || !Number.isInteger(rect?.height)
      || rect.width < 1 || rect.height < 1 || rect.x < 0 || rect.y < 0
      || rect.x + rect.width > outputContract.width || rect.y + rect.height > outputContract.height) {
      throw new Error('Fable5 interior semantic source bound is invalid');
    }
  }
}

function pixelAt(rgba, width, x, y) {
  const offset = (y * width + x) * 4;
  return [rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]];
}

function opaqueChromaKey(red, green, blue, alpha) {
  // A deliberately narrow magenta-key rule avoids treating legitimate dark
  // purple wood/shadow pixels as keying residue while still rejecting the
  // standard generated-board #ff00ff family before it enters pending.
  return alpha > 0 && red >= 245 && green <= 20 && blue >= 220;
}

export async function inspectFable5PrefabInteriorCandidate(buffer, outputContract) {
  validOutputContract(outputContract);
  const image = sharp(buffer, { animated: false, failOn: 'error', sequentialRead: true });
  const decoded = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: rgba, info } = decoded;
  const problems = [];
  if (info.width !== outputContract.width || info.height !== outputContract.height) {
    problems.push(`candidate dimensions must be ${outputContract.width}x${outputContract.height}`);
    return Object.freeze({ ok: false, problems: Object.freeze(problems), checks: Object.freeze({}) });
  }
  let opaquePixels = 0;
  let opaqueChromaPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const [red, green, blue, alpha] = pixelAt(rgba, info.width, x, y);
      if (alpha >= 250) opaquePixels += 1;
      if (opaqueChromaKey(red, green, blue, alpha)) opaqueChromaPixels += 1;
    }
  }
  const opaqueCoverage = opaquePixels / (info.width * info.height);
  if (opaqueCoverage < outputContract.composition.semanticSource.minimumOpaqueCoverage) {
    problems.push(`candidate opaque coverage ${opaqueCoverage.toFixed(4)} is below ${outputContract.composition.semanticSource.minimumOpaqueCoverage}`);
  }
  if (opaqueChromaPixels > 0) problems.push('candidate retains opaque chroma-key pixels');
  const requiredOpaqueRects = [];
  for (const rect of outputContract.composition.semanticSource.requiredOpaqueRects) {
    let transparentPixels = 0;
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        if (pixelAt(rgba, info.width, x, y)[3] < 250) transparentPixels += 1;
      }
    }
    if (transparentPixels > 0) {
      problems.push(`semantic source bound ${rect.id} contains ${transparentPixels} non-opaque pixels`);
    }
    requiredOpaqueRects.push(Object.freeze({ id: rect.id, opaque: transparentPixels === 0 }));
  }
  return Object.freeze({
    ok: problems.length === 0,
    problems: Object.freeze(problems),
    checks: Object.freeze({
      exactDimensions: true,
      rgbaDecoded: true,
      opaqueCoverageAtLeastMinimum: opaqueCoverage >= outputContract.composition.semanticSource.minimumOpaqueCoverage,
      opaqueCoverage,
      opaqueChromaKeyPixels: opaqueChromaPixels,
      noOpaqueChromaKeyPixels: opaqueChromaPixels === 0,
      requiredOpaqueRects: Object.freeze(requiredOpaqueRects),
      semanticSourceBoundsOpaque: requiredOpaqueRects.every(({ opaque }) => opaque)
    })
  });
}

function pendingPaths(forgeRoot, assetId, candidateSha256) {
  const stem = `fable5_${assetId.replaceAll('.', '_')}_${candidateSha256.slice(0, 20)}`;
  const directory = path.join(pathsFor(forgeRoot).generated, 'interiors', 'pending');
  return Object.freeze({ candidate: path.join(directory, `${stem}.png`), metadata: path.join(directory, `${stem}.json`) });
}

export async function importFable5PrefabInteriorCandidate({ assetId, file, jobPackPath, dryRun = false }, dependencies = {}) {
  if (typeof file !== 'string' || file.length === 0) throw new Error('--file is required');
  const forgeRoot = path.resolve(dependencies.forgeRoot ?? FORGE_ROOT);
  const projectRoot = projectRootFor(forgeRoot, dependencies.projectRoot);
  const [jobPack, candidate] = await Promise.all([
    verifyFable5PrefabInteriorJobPack({ assetId, jobPackPath }, { forgeRoot, projectRoot }),
    readExternalImage(file)
  ]);
  if (candidate.sourceFormat !== 'png') throw new Error('Fable5 interior candidates must be PNG files');
  if (candidate.metadata.channels !== 4) throw new Error('Fable5 interior candidates must carry an RGBA alpha channel');
  const inspection = await inspectFable5PrefabInteriorCandidate(candidate.buffer, jobPack.job.outputContract);
  if (!inspection.ok) throw new Error(`Fable5 interior candidate failed mechanical intake: ${inspection.problems.join('; ')}`);
  const candidateSha256 = sha256(candidate.buffer);
  const output = pendingPaths(forgeRoot, assetId, candidateSha256);
  const metadata = Object.freeze({
    format: 'fable5-prefab-interior-pending-candidate-v1',
    id: `fable5_pending_${assetId.replaceAll('.', '_')}_${candidateSha256.slice(0, 20)}`,
    assetId,
    category: 'interior',
    status: 'pending-inspection',
    origin: Object.freeze({ kind: 'external-candidate-unverified', toolName: null }),
    custody: Object.freeze({ kind: 'workshop-produced', userDirect: false }),
    jobPack: Object.freeze({
      jobId: jobPack.job.id,
      path: requireJobPackPath(jobPackPath),
      provenanceKey: jobPack.job.provenanceKey,
      referenceBindings: jobPack.job.references
    }),
    source: Object.freeze({
      path: candidate.actualPath,
      sha256: candidateSha256,
      format: candidate.sourceFormat,
      dimensions: Object.freeze({ width: candidate.metadata.width, height: candidate.metadata.height }),
      channels: candidate.metadata.channels,
      bytes: candidate.metadata.bytes
    }),
    pendingPath: toPosixRelative(forgeRoot, output.candidate),
    outputContract: jobPack.job.outputContract,
    mechanicalChecks: inspection.checks,
    approval: Object.freeze({ status: 'not-yet-submitted', humanOnly: true }),
    export: Object.freeze({ allowed: false }),
    runtime: Object.freeze({ allowed: false }),
    observed: Object.freeze([
      'Candidate bytes were decoded without transformation and passed exact Fable5 interior mechanical checks.',
      'The matching job pack, contract, prompts, current-town reference, and building reference commitments were re-verified.'
    ]),
    inferred: Object.freeze([
      'Passing alpha and semantic-source checks does not establish visual cutaway quality or route legibility.'
    ]),
    unknown: Object.freeze([
      'visual fit to the target-town reference',
      'cutaway continuity and furniture readability',
      'player and NPC clearance in the live renderer',
      'human review decision',
      'runtime behavior'
    ])
  });
  if (dryRun) return Object.freeze({ status: 'dry-run', metadata, inspection, output });

  return withFileLock(forgeRoot, pathsFor(forgeRoot).requiredPromotionLock, async () => {
    const approvedBefore = await hashApprovedTree(forgeRoot);
    const rechecked = await verifyFable5PrefabInteriorJobPack({ assetId, jobPackPath }, { forgeRoot, projectRoot });
    if (rechecked.job.id !== jobPack.job.id) throw new Error('Fable5 interior job pack changed during intake');
    await atomicWriteFile(forgeRoot, output.candidate, candidate.buffer);
    await atomicWriteJson(forgeRoot, output.metadata, metadata);
    const approvedAfter = await hashApprovedTree(forgeRoot);
    if (approvedBefore !== approvedAfter) throw new Error('Approved tree changed during Fable5 interior pending intake');
    return Object.freeze({
      status: 'pending-inspection',
      metadata,
      inspection,
      output,
      approvedTreeSha256Before: approvedBefore,
      approvedTreeSha256After: approvedAfter
    });
  });
}
