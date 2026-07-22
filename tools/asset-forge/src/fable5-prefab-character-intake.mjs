import path from 'node:path';
import { readFile } from 'node:fs/promises';

import sharp from 'sharp';

import { FORGE_ROOT, pathsFor } from './config.mjs';
import { atomicWriteFile, atomicWriteJson, withFileLock } from './fs-safe.mjs';
import { canonicalJson, hashApprovedTree, sha256 } from './hashing.mjs';
import { readExternalImage } from './images/inspect-image.mjs';
import { assertExistingFileWithin, toPosixRelative } from './paths.mjs';
import { validateWith } from './schemas.mjs';
import {
  FABLE5_PREFAB_CHARACTER_JOB_VERSION,
  buildFable5PrefabCharacterJob
} from './fable5-prefab-character-jobs.mjs';

const FRAME = Object.freeze({ width: 64, height: 128, rows: 4, cols: 10, pivotX: 32, pivotY: 120 });

function projectRootFor(forgeRoot, projectRoot) {
  return path.resolve(projectRoot ?? path.join(forgeRoot, '..', '..'));
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function requireJobPackPath(jobPackPath) {
  if (typeof jobPackPath !== 'string'
    || !/^generated\/jobs\/[a-z0-9_]+\/job-pack\.json$/.test(jobPackPath)) {
    throw new Error('Fable5 character intake requires generated/jobs/<job-id>/job-pack.json');
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

export async function verifyFable5PrefabCharacterJobPack({ assetId, jobPackPath }, {
  forgeRoot = FORGE_ROOT,
  projectRoot = undefined
} = {}) {
  const canonicalForgeRoot = path.resolve(forgeRoot);
  const canonicalProjectRoot = projectRootFor(canonicalForgeRoot, projectRoot);
  const requestedPackPath = requireJobPackPath(jobPackPath);
  const pack = await readJsonWithin(canonicalForgeRoot, requestedPackPath, 'Fable5 character job pack');
  const validation = validateWith('job-pack.schema.json', pack);
  if (!validation.ok) throw new Error(`Invalid Fable5 character job pack: ${JSON.stringify(validation.errors)}`);
  if (pack.assetId !== assetId) throw new Error('Fable5 character job pack asset does not match requested asset');

  const expected = await buildFable5PrefabCharacterJob({ assetId }, {
    forgeRoot: canonicalForgeRoot,
    projectRoot: canonicalProjectRoot
  });
  if (pack.jobId !== expected.job.id || !sameJson(pack, expected.pack)) {
    throw new Error('Fable5 character job pack is stale, tampered, or belongs to a different contract');
  }

  const job = await readJsonWithin(canonicalForgeRoot, expected.pack.promptPath.replace(/prompt\.md$/, 'job.json'), 'Fable5 character job');
  const outputContract = await readJsonWithin(canonicalForgeRoot, expected.pack.outputContractPath, 'Fable5 output contract');
  const references = await readJsonWithin(
    canonicalForgeRoot,
    expected.pack.promptPath.replace(/prompt\.md$/, 'references.json'),
    'Fable5 reference receipts'
  );
  const prompt = await readTextWithin(canonicalForgeRoot, expected.pack.promptPath, 'Fable5 character prompt');
  const intakeGuide = await readTextWithin(
    canonicalForgeRoot,
    expected.pack.importCommandPath,
    'Fable5 character intake guide'
  );
  if (!sameJson(job, expected.job)
    || !sameJson(outputContract, expected.job.outputContract)
    || !sameJson(references, { ledger: 'art/contracts/user-provided-images.json', references: expected.job.references })
    || prompt !== expected.promptText
    || !intakeGuide.includes('Do not use the legacy')) {
    throw new Error('Fable5 character job-pack members do not match their verified preflight');
  }
  return Object.freeze({
    jobPackPath: requestedPackPath,
    job: expected.job,
    pack: expected.pack
  });
}

function pixelAt(rgba, width, x, y) {
  const offset = (y * width + x) * 4;
  return [rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]];
}

function frameDigest(rgba, width, row, col) {
  const bytes = Buffer.allocUnsafe(FRAME.width * FRAME.height * 4);
  let offset = 0;
  const originX = col * FRAME.width;
  const originY = row * FRAME.height;
  for (let y = 0; y < FRAME.height; y += 1) {
    const start = ((originY + y) * width + originX) * 4;
    rgba.copy(bytes, offset, start, start + FRAME.width * 4);
    offset += FRAME.width * 4;
  }
  return sha256(bytes);
}

function pivotProblem(rgba, width, row, col) {
  const originX = col * FRAME.width;
  const originY = row * FRAME.height;
  let count = 0;
  let sumX = 0;
  let pivotRowCount = 0;
  for (let y = 112; y < FRAME.height; y += 1) {
    for (let x = 0; x < FRAME.width; x += 1) {
      if (pixelAt(rgba, width, originX + x, originY + y)[3] === 0) continue;
      count += 1;
      sumX += x;
      if (y === FRAME.pivotY) pivotRowCount += 1;
    }
  }
  if (count === 0 || pivotRowCount === 0) return 'no opaque sole pixels at the pivot row';
  const centroid = sumX / count;
  return Math.abs(centroid - FRAME.pivotX) <= 2 ? null : `lower-band centroid ${centroid.toFixed(2)} is not 32±2`;
}

function eastIsExactMirrorOfWest(rgba, width, row, col) {
  const westOriginX = col * FRAME.width;
  const eastOriginX = col * FRAME.width;
  for (let y = 0; y < FRAME.height; y += 1) {
    for (let x = 0; x < FRAME.width; x += 1) {
      const west = pixelAt(rgba, width, westOriginX + x, row * FRAME.height + y);
      const east = pixelAt(rgba, width, eastOriginX + (FRAME.width - 1 - x), 2 * FRAME.height + y);
      if (west[0] !== east[0] || west[1] !== east[1] || west[2] !== east[2] || west[3] !== east[3]) return false;
    }
  }
  return true;
}

export async function inspectFable5PrefabCharacterCandidate(buffer, outputContract) {
  const image = sharp(buffer, { animated: false, failOn: 'error', sequentialRead: true });
  const decoded = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: rgba, info } = decoded;
  const problems = [];
  if (info.width !== outputContract.width || info.height !== outputContract.height) {
    problems.push(`candidate dimensions must be ${outputContract.width}x${outputContract.height}`);
  }
  if (info.width !== FRAME.width * FRAME.cols || info.height !== FRAME.height * FRAME.rows) {
    problems.push('candidate does not contain the exact 4x10 64x128 Fable5 grid');
  }
  if (info.width !== FRAME.width * FRAME.cols || info.height !== FRAME.height * FRAME.rows) {
    return Object.freeze({ ok: false, problems: Object.freeze(problems), checks: Object.freeze({}) });
  }

  const cornersTransparent = [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]
    .every(([x, y]) => pixelAt(rgba, info.width, x, y)[3] === 0);
  if (!cornersTransparent) problems.push('candidate must have transparent sheet corners');

  let opaqueMagentaPixels = 0;
  const pivotFailures = [];
  const emptyFrames = [];
  const walkDuplicateRows = [];
  const mirroredEastColumns = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const [red, green, blue, alpha] = pixelAt(rgba, info.width, x, y);
      if (alpha > 0 && red === 255 && green === 0 && blue === 255) opaqueMagentaPixels += 1;
    }
  }
  if (opaqueMagentaPixels > 0) problems.push('candidate retains opaque chroma-key pixels');

  for (let row = 0; row < FRAME.rows; row += 1) {
    const walkDigests = new Set();
    for (let col = 0; col < FRAME.cols; col += 1) {
      const digest = frameDigest(rgba, info.width, row, col);
      if (col >= 2 && col <= 7) walkDigests.add(digest);
      let opaquePixels = 0;
      const originX = col * FRAME.width;
      const originY = row * FRAME.height;
      for (let y = 0; y < FRAME.height; y += 1) {
        for (let x = 0; x < FRAME.width; x += 1) {
          if (pixelAt(rgba, info.width, originX + x, originY + y)[3] > 0) opaquePixels += 1;
        }
      }
      if (opaquePixels === 0) emptyFrames.push(`${row},${col}`);
      const pivot = pivotProblem(rgba, info.width, row, col);
      if (pivot) pivotFailures.push(`${row},${col}: ${pivot}`);
    }
    if (walkDigests.size !== 6) walkDuplicateRows.push(String(row));
  }
  for (let col = 0; col < FRAME.cols; col += 1) {
    if (eastIsExactMirrorOfWest(rgba, info.width, 1, col)) mirroredEastColumns.push(String(col));
  }
  if (emptyFrames.length) problems.push(`empty frame cells: ${emptyFrames.join(', ')}`);
  if (pivotFailures.length) problems.push(`pivot failures: ${pivotFailures.join('; ')}`);
  if (walkDuplicateRows.length) problems.push(`walk frames repeat exactly in row(s): ${walkDuplicateRows.join(', ')}`);
  if (mirroredEastColumns.length) problems.push(`east frames are exact west mirrors in column(s): ${mirroredEastColumns.join(', ')}`);

  return Object.freeze({
    ok: problems.length === 0,
    problems: Object.freeze(problems),
    checks: Object.freeze({
      exactDimensions: info.width === outputContract.width && info.height === outputContract.height,
      exactGrid: info.width === FRAME.width * FRAME.cols && info.height === FRAME.height * FRAME.rows,
      transparentCorners: cornersTransparent,
      opaqueChromaKeyPixels: opaqueMagentaPixels,
      nonEmptyFrames: emptyFrames.length === 0,
      pivotAt32_120AllFrames: pivotFailures.length === 0,
      sixDistinctWalkFramesPerDirection: walkDuplicateRows.length === 0,
      eastNotExactMirrorOfWest: mirroredEastColumns.length === 0
    })
  });
}

function pendingPaths(forgeRoot, assetId, candidateSha256) {
  const stem = `fable5_${assetId}_${candidateSha256.slice(0, 20)}`;
  const directory = path.join(pathsFor(forgeRoot).generated, 'characters', 'pending');
  return Object.freeze({
    candidate: path.join(directory, `${stem}.png`),
    metadata: path.join(directory, `${stem}.json`)
  });
}

export async function importFable5PrefabCharacterCandidate({ assetId, file, jobPackPath, dryRun = false }, dependencies = {}) {
  if (typeof file !== 'string' || file.length === 0) throw new Error('--file is required');
  const forgeRoot = path.resolve(dependencies.forgeRoot ?? FORGE_ROOT);
  const projectRoot = projectRootFor(forgeRoot, dependencies.projectRoot);
  const [jobPack, candidate] = await Promise.all([
    verifyFable5PrefabCharacterJobPack({ assetId, jobPackPath }, { forgeRoot, projectRoot }),
    readExternalImage(file)
  ]);
  if (candidate.sourceFormat !== 'png') throw new Error('Fable5 character candidates must be PNG files');
  if (candidate.metadata.channels !== 4) throw new Error('Fable5 character candidates must carry an alpha channel');
  const inspection = await inspectFable5PrefabCharacterCandidate(candidate.buffer, jobPack.job.outputContract);
  if (!inspection.ok) throw new Error(`Fable5 character candidate failed mechanical intake: ${inspection.problems.join('; ')}`);
  const candidateSha256 = sha256(candidate.buffer);
  const output = pendingPaths(forgeRoot, assetId, candidateSha256);
  const metadata = Object.freeze({
    format: 'fable5-prefab-character-pending-candidate-v1',
    id: `fable5_pending_${assetId}_${candidateSha256.slice(0, 20)}`,
    assetId,
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
    mechanicalChecks: inspection.checks,
    approval: Object.freeze({ status: 'not-yet-submitted', humanOnly: true }),
    export: Object.freeze({ allowed: false }),
    runtime: Object.freeze({ allowed: false }),
    observed: Object.freeze([
      'Candidate bytes were decoded without transformation and passed the Fable5 mechanical intake checks.',
      'The matching job pack, current draft contract, prompts, and ledger reference commitments were re-verified.'
    ]),
    inferred: Object.freeze([]),
    unknown: Object.freeze([
      'visual identity continuity',
      'artistic quality and target-town shading compatibility',
      'human review decision',
      'runtime behavior'
    ])
  });
  if (dryRun) return Object.freeze({ status: 'dry-run', metadata, inspection, output });

  return withFileLock(forgeRoot, pathsFor(forgeRoot).requiredPromotionLock, async () => {
    const approvedBefore = await hashApprovedTree(forgeRoot);
    const reverified = await verifyFable5PrefabCharacterJobPack({ assetId, jobPackPath }, { forgeRoot, projectRoot });
    if (reverified.job.id !== jobPack.job.id) throw new Error('Fable5 character job pack changed during intake');
    await atomicWriteFile(forgeRoot, output.candidate, candidate.buffer);
    await atomicWriteJson(forgeRoot, output.metadata, metadata);
    const approvedAfter = await hashApprovedTree(forgeRoot);
    if (approvedBefore !== approvedAfter) throw new Error('Approved tree changed during Fable5 character pending intake');
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
