import { readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { FORGE_ROOT, IMAGE_LIMITS, pathsFor } from '../config.mjs';
import { atomicWriteFile, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, hashApprovedTree, hashFile, sha256 } from '../hashing.mjs';
import { readExternalImage } from '../images/inspect-image.mjs';
import { auditBuildingBundleV2, auditVisualAssetV2 } from '../images/visual-contract-v2.mjs';
import {
  appendGenerationResultUnlocked,
  readLocalGenerationManifest
} from '../manifests/local-generations.mjs';
import {
  assetFileStem,
  assertNoSymlinkPath,
  assertExistingFileWithin,
  categoryDirectory,
  resolveWithin,
  toPosixRelative
} from '../paths.mjs';
import { inspectPng } from '../png-core.mjs';
import { validateWith } from '../schemas.mjs';
import {
  buildWaveAJob,
  CURRENT_BACKGROUND_REMOVAL_METHOD,
  WAVE_A_SOURCE_LIMITS
} from './build-job.mjs';
import {
  composeTerrainAtlas,
  TERRAIN_COMPOSER_ALGORITHM,
  TERRAIN_COMPOSER_CONFIG_SHA256,
  TERRAIN_COMPOSER_MASK_SET_SHA256,
  TERRAIN_COMPOSER_UNIT_STEP,
  TERRAIN_COMPOSER_VERSION,
  terrainDerivationSha256,
  terrainCompositionPlanFor
} from './compose-terrain-atlas.mjs';
import {
  PROVIDER_KEY_NORMALIZE_STEP,
  normalizeProviderKey,
  providerKeyNormalizationSourceKindForJob
} from './provider-key-normalize.mjs';
import {
  CHARACTER_DIRECTION_STRIP_COLUMNS,
  CHARACTER_DIRECTION_STRIP_DIRECTIONS,
  CHARACTER_DIRECTION_STRIP_MODE,
  characterDirectionStripPlanFor
} from './character-direction-strips.mjs';

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;
const INPUT_KEYS = new Set(['unitId', 'sourceOriginal', 'cropRect']);
const IDENTITY_INPUT_KEYS = new Set(['sourceOriginal', 'cropRect']);
const TERRAIN_COMPOSITION_KEYS = new Set([
  'originKind', 'composerVersion', 'algorithm', 'configSha256', 'maskSetSha256', 'inputs'
]);
const TERRAIN_COMPOSITION_INPUT_KEYS = new Set(['role', 'sourceOriginal', 'cropRect']);
const IDENTITY_BINDING_PATH = /^generated\/jobs\/v2\/fable5-v2\/wave-a\/[a-z0-9_-]+-job_v2_[a-f0-9]{20}\/identity-bindings\/identity_binding_[a-f0-9]{20}\/unit-execution\.json$/;
const CHARACTER_ATLAS_COLUMNS = 10;
const CHARACTER_ATLAS_ROWS = 4;
const CHARACTER_ATLAS_UNIT_COUNT = CHARACTER_ATLAS_COLUMNS * CHARACTER_ATLAS_ROWS;
const CHARACTER_ATLAS_LAYOUT = 'character-row-major-directions-by-row-frames-by-column';
const CHARACTER_DIRECTION_STRIP_LAYOUT = 'character-direction-strip-frames-by-column';
const LEGACY_TRANSFORM_STEPS = Object.freeze([
  'crop', 'chroma-key-remove', 'nearest-downscale', 'hard-alpha'
]);
const AUTO_BORDER_TRANSFORM_STEPS = Object.freeze([
  'auto-border-key-detect',
  'crop',
  'soft-matte-despill',
  'zero-hidden-rgb',
  'nearest-downscale',
  'hard-alpha-zero-hidden-rgb'
]);
const PROVIDER_KEY_NORMALIZE_TRANSFORM_STEPS = Object.freeze([
  PROVIDER_KEY_NORMALIZE_STEP,
  ...AUTO_BORDER_TRANSFORM_STEPS
]);
const LEGACY_ASSEMBLY_ALGORITHM = 'crop-key-nearest-hard-alpha/raw-copy-v2';
const AUTO_BORDER_ASSEMBLY_ALGORITHMS = Object.freeze({
  'auto-border-soft-matte-v1': 'auto-border-crop-soft-matte-nearest-hard-alpha/raw-copy-v3',
  'auto-border-soft-matte-v2':
    'auto-border-connected-fringe-soft-matte-nearest-hard-alpha/raw-copy-v4',
  'auto-border-soft-matte-v3':
    'auto-border-connected-fringe-soft-matte-nearest-hard-alpha/raw-copy-v5'
});
const PROVIDER_KEY_NORMALIZE_ASSEMBLY_ALGORITHM =
  'provider-key-normalize-v1/auto-border-connected-fringe-soft-matte-nearest-hard-alpha/raw-copy-v1';
const ISSUED_SOURCE_BUDGETS = new WeakSet();

function canonicalBackgroundRemoval(job) {
  return job.technicalGates.inputPolicy.canonicalBackgroundRemoval ?? null;
}

function providerKeyNormalizationPlan(job) {
  return job.providerKeyNormalizationPlan ?? null;
}

async function normalizedProviderSource(job, source, sourceKind) {
  const plan = providerKeyNormalizationPlan(job);
  if (!plan) return null;
  const primarySourceKind = providerKeyNormalizationSourceKindForJob(job);
  const allowedSourceKinds = primarySourceKind === 'monolithic-atlas'
    ? ['identity-master', 'monolithic-atlas']
    : ['single-unit'];
  if (!allowedSourceKinds.includes(sourceKind) || !plan.sourceKinds.includes(sourceKind)) {
    throw new Error('Provider-key normalization escaped its exact source contract');
  }
  const normalized = await normalizeProviderKey(source.image, plan);
  return {
    sourceKind,
    plan: structuredClone(plan),
    ...normalized,
    image: {
      buffer: normalized.normalizedPng,
      sourceFormat: 'png',
      metadata: {
        width: source.image.metadata.width,
        height: source.image.metadata.height
      }
    }
  };
}

function providerKeyNormalizationLedger(normalization, normalizedPath) {
  if (!normalization) return null;
  return {
    sourceKind: normalization.sourceKind,
    plan: structuredClone(normalization.plan),
    sourceOriginal: structuredClone(normalization.evidence.sourceOriginal),
    normalizedSnapshot: {
      path: normalizedPath,
      ...structuredClone(normalization.evidence.normalized)
    },
    preBorder: structuredClone(normalization.evidence.preBorder),
    eligibility: structuredClone(normalization.evidence.eligibility),
    outsideMaskBeforeRgbaSha256: normalization.evidence.outsideMaskBeforeRgbaSha256,
    outsideMaskAfterRgbaSha256: normalization.evidence.outsideMaskAfterRgbaSha256,
    outsideMaskPreserved: normalization.evidence.outsideMaskPreserved,
    postBorder: structuredClone(normalization.evidence.postBorder),
    providerInvocationEvidence: normalization.evidence.providerInvocationEvidence,
    derivationSha256: normalization.evidence.derivationSha256,
    replayPassed: true
  };
}

function transformStepsFor(job) {
  if (providerKeyNormalizationPlan(job)) return PROVIDER_KEY_NORMALIZE_TRANSFORM_STEPS;
  return canonicalBackgroundRemoval(job) ? AUTO_BORDER_TRANSFORM_STEPS : LEGACY_TRANSFORM_STEPS;
}

function assemblyAlgorithmFor(job) {
  if (job.generationMode === 'terrain-composed-atlas') return TERRAIN_COMPOSER_ALGORITHM;
  if (providerKeyNormalizationPlan(job)) return PROVIDER_KEY_NORMALIZE_ASSEMBLY_ALGORITHM;
  const method = canonicalBackgroundRemoval(job)?.method;
  return method ? AUTO_BORDER_ASSEMBLY_ALGORITHMS[method] : LEGACY_ASSEMBLY_ALGORITHM;
}

function sourceLimitsFor(job) {
  return job?.technicalGates?.inputPolicy?.sourceLimits ?? WAVE_A_SOURCE_LIMITS;
}

function sourceImageLimits(job) {
  return {
    ...IMAGE_LIMITS,
    maxInputPixels: sourceLimitsFor(job).maxSourcePixels
  };
}

function createUniqueSourceBudget(job) {
  const sourceBudget = {
    limits: Object.freeze({ ...sourceLimitsFor(job) }),
    uniqueBytes: 0,
    uniquePixels: 0,
    imagesBySha256: new Map()
  };
  ISSUED_SOURCE_BUDGETS.add(sourceBudget);
  return sourceBudget;
}

function retainUniqueSourceImage(sourceBudget, image, digest, label) {
  if (!ISSUED_SOURCE_BUDGETS.has(sourceBudget) || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error('Wave A source budget received invalid source evidence');
  }
  const sameDigest = sourceBudget.imagesBySha256.get(digest) ?? [];
  const identical = sameDigest.find((retained) => retained.buffer.equals(image.buffer));
  if (identical) return identical;

  const nextBytes = sourceBudget.uniqueBytes + image.buffer.length;
  const nextPixels = sourceBudget.uniquePixels
    + image.metadata.width * image.metadata.height;
  if (nextBytes > sourceBudget.limits.maxUniqueSourceBytes) {
    throw new Error(`Wave A aggregate unique source byte limit exceeded: ${label}`);
  }
  if (nextPixels > sourceBudget.limits.maxUniqueSourcePixels) {
    throw new Error(`Wave A aggregate unique source pixel limit exceeded: ${label}`);
  }

  sameDigest.push(image);
  sourceBudget.imagesBySha256.set(digest, sameDigest);
  sourceBudget.uniqueBytes = nextBytes;
  sourceBudget.uniquePixels = nextPixels;
  return image;
}

async function readBoundedWithin(root, relativePath, maximum = MAX_JSON_BYTES) {
  const absolute = await assertExistingFileWithin(root, relativePath);
  const bytes = await readFile(absolute);
  if (bytes.length > maximum) throw new Error(`Wave A job-pack member exceeds ${maximum} bytes`);
  return { absolute, bytes };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function withoutDigest(pack) {
  const copy = structuredClone(pack);
  delete copy.contentDigest;
  return copy;
}

function sameBytes(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right);
}

function requirePackMember(packDirectory, member, label) {
  if (!member || path.posix.dirname(member.path) !== packDirectory) {
    throw new Error(`Wave A ${label} escapes its job-pack directory`);
  }
  return member;
}

function requirePackReference(packDirectory, member) {
  if (!member?.path?.startsWith(`${packDirectory}/references/`)
    || path.posix.dirname(member.path) !== `${packDirectory}/references`) {
    throw new Error(`Wave A reference ${member?.id ?? 'unknown'} escapes its job-pack reference directory`);
  }
  return member;
}

function expectedUnitPlan(job) {
  return {
    schemaVersion: 2,
    requiredSetId: job.requiredSetId,
    waveId: job.waveId,
    assetId: job.assetId,
    generationMode: job.generationMode,
    generationUnitSetSha256: job.generationUnitSetSha256,
    generationExpectations: job.generationExpectations,
    generationUnits: job.generationUnits,
    ...(job.generationMode === 'terrain-composed-atlas' ? {
      terrainCompositionPlan: job.terrainCompositionPlan
    } : {}),
    ...(job.providerKeyNormalizationPlan ? {
      providerKeyNormalizationPlan: job.providerKeyNormalizationPlan
    } : {}),
    ...(job.characterAtlasLayoutPlan ? {
      characterAtlasLayoutPlan: job.characterAtlasLayoutPlan
    } : {}),
    ...(job.characterDirectionStripPlan ? {
      characterDirectionStripPlan: job.characterDirectionStripPlan
    } : {}),
    identityMasterPlan: job.identityMasterPlan
  };
}

export async function verifyWaveAJobPack(jobPackPath, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  allowHistoricalTransformVersion = false
} = {}) {
  if (path.resolve(root) !== path.resolve(forgeRoot)) {
    throw new Error('Wave A verification requires one canonical Forge root');
  }
  if (typeof jobPackPath !== 'string'
    || !/^generated\/jobs\/v2\/fable5-v2\/wave-a\/[a-z0-9_-]+-job_v2_[a-f0-9]{20}\/job-pack\.json$/.test(jobPackPath)) {
    throw new Error('Wave A import requires an explicit fable5-v2/A job-pack path');
  }
  const packRead = await readBoundedWithin(root, jobPackPath);
  const pack = parseJson(packRead.bytes, 'Wave A job pack');
  const packValidation = validateWith('job-pack-v2.schema.json', pack);
  if (!packValidation.ok) {
    throw new Error(`Invalid Wave A job pack: ${JSON.stringify(packValidation.errors)}`);
  }
  if (pack.requiredSetId !== 'fable5-v2' || pack.waveId !== 'A'
    || pack.contentDigest !== sha256(canonicalJson(withoutDigest(pack)))) {
    throw new Error('Wave A job-pack identity or content digest mismatch');
  }
  const packDirectory = path.posix.dirname(jobPackPath);
  const memberReads = {};
  for (const [name, member] of Object.entries(pack.members)) {
    requirePackMember(packDirectory, member, name);
    const read = await readBoundedWithin(root, member.path);
    if (sha256(read.bytes) !== member.sha256) throw new Error(`Wave A ${name} member hash mismatch`);
    memberReads[name] = read;
  }
  const packedJob = parseJson(memberReads.job.bytes, 'Wave A packed job');
  const jobValidation = validateWith('generation-job-v2.schema.json', packedJob);
  if (!jobValidation.ok) {
    throw new Error(`Invalid Wave A packed job: ${JSON.stringify(jobValidation.errors)}`);
  }
  if (packedJob.requiredSetId !== 'fable5-v2' || packedJob.waveId !== 'A'
    || packedJob.id !== pack.jobId || packedJob.assetId !== pack.assetId
    || packedJob.category !== pack.category) {
    throw new Error('Wave A pack and packed job identity mismatch');
  }
  const packedMethod = packedJob.technicalGates.inputPolicy.canonicalBackgroundRemoval?.method ?? null;
  if (packedJob.generationMode !== 'terrain-composed-atlas'
    && !allowHistoricalTransformVersion
    && packedMethod !== CURRENT_BACKGROUND_REMOVAL_METHOD) {
    throw new Error('Wave A job pack is stale relative to the current background-removal method');
  }
  const built = await buildWaveAJob({
    assetId: pack.assetId,
    seed: packedJob.seed,
    generationMode: packedJob.generationMode,
    providerKeyNormalization: packedJob.providerKeyNormalizationPlan?.version ?? null,
    characterAtlasLayout: packedJob.characterAtlasLayoutPlan?.version ?? null
  }, {
    forgeRoot,
    backgroundRemovalMethod: allowHistoricalTransformVersion
      ? packedMethod
      : CURRENT_BACKGROUND_REMOVAL_METHOD
  });
  if (canonicalJson(packedJob) !== canonicalJson(built.job)) {
    throw new Error('Wave A job pack is stale relative to the current approved hash-bound job');
  }
  if (!sameBytes(memberReads.prompt.bytes, Buffer.from(built.job.promptText))
    || sha256(memberReads.prompt.bytes) !== built.job.promptSha256
    || canonicalJson(parseJson(memberReads.definition.bytes, 'Wave A definition snapshot'))
      !== canonicalJson(built.asset)
    || sha256(memberReads.definition.bytes) !== built.job.definitionSha256
    || canonicalJson(parseJson(memberReads.authorization.bytes, 'Wave A authorization snapshot'))
      !== canonicalJson(built.authorization)
    || sha256(memberReads.authorization.bytes) !== built.job.referenceAuthorizationSha256
    || !sameBytes(memberReads.independentReview.bytes, built.independentReviewBytes)
    || sha256(memberReads.independentReview.bytes) !== built.job.independentReviewSha256) {
    throw new Error('Wave A job-pack prompt, definition, or authorization snapshot mismatch');
  }
  if (canonicalJson(parseJson(memberReads.unitPlan.bytes, 'Wave A unit plan'))
      !== canonicalJson(expectedUnitPlan(built.job))
    || pack.generationMode !== built.job.generationMode
    || pack.generationUnitSetSha256 !== built.job.generationUnitSetSha256
    || canonicalJson(pack.generationExpectations) !== canonicalJson(built.job.generationExpectations)
    || canonicalJson(pack.generationUnitIds)
      !== canonicalJson(built.job.generationUnits.map(({ unitId }) => unitId))
    || canonicalJson(pack.characterAtlasLayoutPlan ?? null)
      !== canonicalJson(built.job.characterAtlasLayoutPlan ?? null)
    || canonicalJson(pack.characterDirectionStripPlan ?? null)
      !== canonicalJson(built.job.characterDirectionStripPlan ?? null)
    || pack.identityMasterPlanId !== (built.job.identityMasterPlan?.planId ?? null)) {
    throw new Error('Wave A job-pack generation-unit plan mismatch');
  }
  if (pack.artifactRoles.length !== built.job.artifactContracts.length
    || pack.artifactRoles.some((role, index) => role !== built.job.artifactContracts[index].role)) {
    throw new Error('Wave A job-pack artifact roles do not match the current definition');
  }
  const referenceReads = [];
  for (const [index, member] of pack.references.entries()) {
    requirePackReference(packDirectory, member);
    const read = await readBoundedWithin(root, member.path, MAX_REFERENCE_BYTES);
    const expected = built.job.referenceImages[index];
    if (member.id !== expected.id || member.role !== expected.role
      || member.sha256 !== expected.sha256 || sha256(read.bytes) !== expected.sha256
      || !sameBytes(read.bytes, built.references[index].bytes)) {
      throw new Error(`Wave A reference snapshot mismatch: ${member.id}`);
    }
    referenceReads.push(read);
  }
  return { pack, job: packedJob, asset: built.asset, built, memberReads, referenceReads };
}

function parseHexColor(value) {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16)
  ];
}

async function decodedRgba(buffer) {
  return sharp(buffer, { animated: false, failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function cropRaw(current, crop) {
  if (!crop || ![crop.x, crop.y, crop.width, crop.height].every(Number.isInteger)
    || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1) {
    throw new Error('Wave A source cropRect is invalid');
  }
  if (crop.x + crop.width > current.info.width || crop.y + crop.height > current.info.height) {
    throw new Error('Wave A source cropRect escapes source-original pixels');
  }
  const channels = current.info.channels;
  const data = Buffer.alloc(crop.width * crop.height * channels);
  for (let y = 0; y < crop.height; y += 1) {
    const sourceStart = ((crop.y + y) * current.info.width + crop.x) * channels;
    current.data.copy(data, y * crop.width * channels, sourceStart, sourceStart + crop.width * channels);
  }
  return { data, info: { width: crop.width, height: crop.height, channels } };
}

function chromaKeyRaw(current, keyColor = '#FF00FF', tolerance = 0) {
  const key = parseHexColor(keyColor);
  const data = Buffer.from(current.data);
  for (let offset = 0; offset < data.length; offset += current.info.channels) {
    const distance = Math.max(
      Math.abs(data[offset] - key[0]),
      Math.abs(data[offset + 1] - key[1]),
      Math.abs(data[offset + 2] - key[2])
    );
    if (distance <= tolerance) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }
  return { data, info: { ...current.info } };
}

function colorDistance(left, right) {
  return Math.max(
    Math.abs(left[0] - right[0]),
    Math.abs(left[1] - right[1]),
    Math.abs(left[2] - right[2])
  );
}

function roundHalfEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, roundHalfEven(value)));
}

function channelMedian(samples, channel) {
  const values = [];
  for (let offset = channel; offset < samples.length; offset += 3) values.push(samples[offset]);
  values.sort((left, right) => left - right);
  const midpoint = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[midpoint]
    : roundHalfEven((values[midpoint - 1] + values[midpoint]) / 2);
}

function colorHex(color) {
  return `#${color.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function sampleBorderKey(current, policy) {
  const { width, height, channels } = current.info;
  const borderBand = Math.max(1, Math.min(width, height, policy.borderBandMax));
  const borderSampleStride = Math.max(
    1,
    Math.floor(Math.min(width, height) / policy.borderSampleStrideDivisor)
  );
  const samples = [];
  const append = (x, y) => {
    const offset = (y * width + x) * channels;
    samples.push(current.data[offset], current.data[offset + 1], current.data[offset + 2]);
  };
  for (let x = 0; x < width; x += borderSampleStride) {
    for (let y = 0; y < borderBand; y += 1) {
      append(x, y);
      append(x, height - 1 - y);
    }
  }
  for (let y = 0; y < height; y += borderSampleStride) {
    for (let x = 0; x < borderBand; x += 1) {
      append(x, y);
      append(width - 1 - x, y);
    }
  }
  const sampleBytes = Buffer.from(samples);
  const detectedKey = [0, 1, 2].map((channel) => channelMedian(sampleBytes, channel));
  const expectedKey = parseHexColor(policy.expectedKeyColor);
  const detectedKeyExpectedDistance = colorDistance(detectedKey, expectedKey);
  let borderInlierCount = 0;
  for (let offset = 0; offset < sampleBytes.length; offset += 3) {
    if (colorDistance([
      sampleBytes[offset], sampleBytes[offset + 1], sampleBytes[offset + 2]
    ], detectedKey) <= policy.borderInlierDistance) borderInlierCount += 1;
  }
  const borderSampleCount = sampleBytes.length / 3;
  const borderInlierPermille = Math.floor(borderInlierCount * 1000 / borderSampleCount);
  if (detectedKeyExpectedDistance > policy.expectedKeyMaxDistance) {
    throw new Error(
      `Wave A auto-border key ${colorHex(detectedKey)} is not close enough to required ${policy.expectedKeyColor}`
    );
  }
  if (borderInlierCount * 1000
    < borderSampleCount * policy.minimumBorderInlierPermille) {
    throw new Error('Wave A auto-border key sampling rejected a non-uniform source border');
  }
  return {
    detectedKey,
    evidence: {
      policy: structuredClone(policy),
      detectedKeyColor: colorHex(detectedKey),
      detectedKeyExpectedDistance,
      borderBand,
      borderSampleStride,
      borderSampleCount,
      borderSampleSha256: sha256(sampleBytes),
      borderInlierCount,
      borderInlierPermille
    }
  };
}

function spillChannels(key, policy) {
  const keyMaximum = Math.max(...key);
  if (keyMaximum < policy.spillChannelMinimum) return [];
  return key
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value >= keyMaximum - policy.spillChannelDelta
      && value >= policy.spillChannelMinimum)
    .map(({ index }) => index);
}

function keyChannelDominance(rgb, key, policy) {
  const spill = spillChannels(key, policy);
  if (spill.length === 0) return 0;
  const nonSpill = [0, 1, 2].filter((index) => !spill.includes(index));
  const keyStrength = spill.length > 1
    ? Math.min(...spill.map((index) => rgb[index]))
    : rgb[spill[0]];
  const nonKeyStrength = nonSpill.length > 0
    ? Math.max(...nonSpill.map((index) => rgb[index]))
    : 0;
  return keyStrength - nonKeyStrength;
}

function dominanceAlpha(rgb, key, policy) {
  const spill = spillChannels(key, policy);
  if (spill.length === 0) return 255;
  const nonSpill = [0, 1, 2].filter((index) => !spill.includes(index));
  const keyStrength = spill.length > 1
    ? Math.min(...spill.map((index) => rgb[index]))
    : rgb[spill[0]];
  const nonKeyStrength = nonSpill.length > 0
    ? Math.max(...nonSpill.map((index) => rgb[index]))
    : 0;
  const dominance = keyStrength - nonKeyStrength;
  if (dominance <= 0) return 255;
  const denominator = Math.max(1, Math.max(...key) - nonKeyStrength);
  return clampChannel((1 - Math.min(1, dominance / denominator)) * 255);
}

function softAlpha(distance, policy) {
  if (distance <= policy.transparentDistance) return 0;
  if (distance >= policy.opaqueDistance) return 255;
  const ratio = (distance - policy.transparentDistance)
    / (policy.opaqueDistance - policy.transparentDistance);
  const smooth = ratio * ratio * (3 - 2 * ratio);
  return clampChannel(255 * smooth);
}

function despillPixel(data, offset, key, outputAlpha, policy) {
  if (!policy.despill || outputAlpha >= policy.despillOpaqueFloor) return;
  const spill = spillChannels(key, policy);
  if (spill.length === 0) return;
  const nonSpill = [0, 1, 2].filter((index) => !spill.includes(index));
  if (nonSpill.length === 0) return;
  const anchor = Math.max(...nonSpill.map((index) => data[offset + index]));
  const cap = Math.max(0, anchor - policy.despillAnchorOffset);
  for (const index of spill) {
    if (data[offset + index] > cap) data[offset + index] = cap;
  }
}

function borderConnectedKeyFringe(current, key, policy, { diagonal }) {
  const { width, height, channels } = current.info;
  const pixelCount = width * height;
  const eligible = new Uint8Array(pixelCount);
  const connected = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  const fringeDistance = Math.min(policy.opaqueDistance, policy.keyLikeDistance * 3);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * channels;
    const rgb = [current.data[offset], current.data[offset + 1], current.data[offset + 2]];
    const distance = colorDistance(rgb, key);
    eligible[index] = Number(distance <= policy.keyLikeDistance
      || (distance <= fringeDistance
        && keyChannelDominance(rgb, key, policy) >= policy.keyDominanceThreshold));
  }

  let head = 0;
  let tail = 0;
  const appendBorderKey = (index) => {
    if (connected[index]) return;
    const offset = index * channels;
    const distance = colorDistance([
      current.data[offset], current.data[offset + 1], current.data[offset + 2]
    ], key);
    if (distance > policy.keyLikeDistance) return;
    connected[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    appendBorderKey(x);
    appendBorderKey((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    appendBorderKey(y * width);
    appendBorderKey(y * width + width - 1);
  }

  const appendEligible = (index) => {
    if (!eligible[index] || connected[index]) return;
    connected[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    appendEligible(y * width + Math.max(0, x - 1));
    appendEligible(y * width + Math.min(width - 1, x + 1));
    appendEligible(Math.max(0, y - 1) * width + x);
    appendEligible(Math.min(height - 1, y + 1) * width + x);
    if (diagonal) {
      appendEligible(Math.max(0, y - 1) * width + Math.max(0, x - 1));
      appendEligible(Math.max(0, y - 1) * width + Math.min(width - 1, x + 1));
      appendEligible(Math.min(height - 1, y + 1) * width + Math.max(0, x - 1));
      appendEligible(Math.min(height - 1, y + 1) * width + Math.min(width - 1, x + 1));
    }
  }
  return connected;
}

function autoBorderSoftMatteRaw(current, policy, { detectedKey, evidence }) {
  const data = Buffer.from(current.data);
  const connectedFringe = policy.method === 'auto-border-soft-matte-v1'
    ? null
    : borderConnectedKeyFringe(current, detectedKey, policy, {
        diagonal: policy.method === 'auto-border-soft-matte-v2'
      });
  let pixelIndex = 0;
  for (let offset = 0; offset < data.length; offset += current.info.channels) {
    const rgb = [data[offset], data[offset + 1], data[offset + 2]];
    const distance = colorDistance(rgb, detectedKey);
    const dominance = keyChannelDominance(rgb, detectedKey, policy);
    const keyLike = policy.method === 'auto-border-soft-matte-v1'
      ? distance <= policy.keyLikeDistance || dominance >= policy.keyDominanceThreshold
      : policy.method === 'auto-border-soft-matte-v2'
        ? distance <= policy.keyLikeDistance || (connectedFringe[pixelIndex] === 1
          && dominance >= policy.keyDominanceThreshold)
        : connectedFringe[pixelIndex] === 1;
    let outputAlpha = keyLike
      ? Math.min(softAlpha(distance, policy), dominanceAlpha(rgb, detectedKey, policy))
      : 255;
    outputAlpha = roundHalfEven(outputAlpha * (data[offset + 3] / 255));
    if (outputAlpha > 0 && outputAlpha <= policy.alphaNoiseFloor) outputAlpha = 0;
    if (keyLike) despillPixel(data, offset, detectedKey, outputAlpha, policy);
    data[offset + 3] = outputAlpha;
    pixelIndex += 1;
  }
  return { data, info: { ...current.info }, transformEvidence: evidence };
}

function zeroHiddenRgbRaw(current) {
  const data = Buffer.from(current.data);
  for (let offset = 0; offset < data.length; offset += current.info.channels) {
    if (data[offset + 3] !== 0) continue;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
  }
  return { data, info: { ...current.info } };
}

async function resizeNearestRaw(current, outputSize) {
  if (current.info.width < outputSize.width || current.info.height < outputSize.height) {
    throw new Error('Wave A canonical transform would enlarge source-original pixels');
  }
  if (current.info.width === outputSize.width && current.info.height === outputSize.height) {
    return { data: Buffer.from(current.data), info: { ...current.info } };
  }
  return sharp(current.data, {
    raw: {
      width: current.info.width,
      height: current.info.height,
      channels: current.info.channels
    }
  }).resize(outputSize.width, outputSize.height, {
    fit: 'fill',
    kernel: sharp.kernel.nearest
  }).raw().toBuffer({ resolveWithObject: true });
}

function hardAlphaAndZeroRaw(current, threshold = 127) {
  const data = Buffer.from(current.data);
  for (let offset = 0; offset < data.length; offset += current.info.channels) {
    if (data[offset + 3] <= threshold) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    } else data[offset + 3] = 255;
  }
  return { data, info: { ...current.info } };
}

async function canonicalUnitTransform(sourceOriginal, cropRect, outputSize, backgroundRemoval = null) {
  let current = await decodedRgba(sourceOriginal.buffer);
  const sampledKey = backgroundRemoval ? sampleBorderKey(current, backgroundRemoval) : null;
  if (cropRect) current = cropRaw(current, cropRect);
  let transformEvidence = null;
  if (backgroundRemoval) {
    const matte = autoBorderSoftMatteRaw(current, backgroundRemoval, sampledKey);
    transformEvidence = matte.transformEvidence;
    current = zeroHiddenRgbRaw(matte);
  } else {
    current = chromaKeyRaw(current, '#FF00FF', 0);
  }
  current = await resizeNearestRaw(current, outputSize);
  current = hardAlphaAndZeroRaw(
    current,
    backgroundRemoval?.hardAlphaThreshold ?? 127
  );
  return { ...current, transformEvidence };
}

async function encodeRawPng(raw, width, height) {
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png({ adaptiveFiltering: false, palette: false, compressionLevel: 9 })
    .toBuffer();
}

function pixelAudit(raw) {
  let visiblePixels = 0;
  let transparentPixels = 0;
  let partialAlphaPixels = 0;
  let hiddenRgbPixels = 0;
  let opaqueMagentaPixels = 0;
  for (let offset = 0; offset < raw.length; offset += 4) {
    const alpha = raw[offset + 3];
    if (alpha === 0) {
      transparentPixels += 1;
      if (raw[offset] !== 0 || raw[offset + 1] !== 0 || raw[offset + 2] !== 0) hiddenRgbPixels += 1;
    } else {
      visiblePixels += 1;
      if (alpha !== 255) partialAlphaPixels += 1;
      if (raw[offset] === 255 && raw[offset + 1] === 0 && raw[offset + 2] === 255) {
        opaqueMagentaPixels += 1;
      }
    }
  }
  return {
    visiblePixels,
    transparentPixels,
    partialAlphaPixels,
    hiddenRgbPixels,
    opaqueMagentaPixels
  };
}

function requireCleanNonemptyUnit(unit, audit) {
  const problems = [];
  if (audit.visiblePixels === 0) problems.push('is empty');
  if (audit.partialAlphaPixels !== 0) problems.push('contains partial alpha');
  if (audit.hiddenRgbPixels !== 0) problems.push('contains hidden RGB');
  if (audit.opaqueMagentaPixels !== 0) problems.push('contains opaque #FF00FF');
  if (problems.length > 0) throw new Error(`Wave A ${unit.unitId} ${problems.join(', ')}`);
}

function requireZeroTransparentUnit(unit, raw, audit) {
  if (unit.sourceRequired || audit.visiblePixels !== 0 || audit.transparentPixels * 4 !== raw.length
    || audit.partialAlphaPixels !== 0 || audit.hiddenRgbPixels !== 0
    || audit.opaqueMagentaPixels !== 0 || raw.some((byte) => byte !== 0)) {
    throw new Error(`Wave A ${unit.unitId} transparent contract is not exact zero RGBA`);
  }
}

function rawCell(raw, artifactSize, rect) {
  const data = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = ((rect.y + y) * artifactSize.width + rect.x) * 4;
    raw.copy(data, y * rect.width * 4, sourceStart, sourceStart + rect.width * 4);
  }
  return data;
}

function copyCell(target, targetSize, rect, cell) {
  if (cell.length !== rect.width * rect.height * 4) {
    throw new Error('Wave A transformed unit byte length does not match targetRect');
  }
  for (let y = 0; y < rect.height; y += 1) {
    const targetStart = ((rect.y + y) * targetSize.width + rect.x) * 4;
    cell.copy(target, targetStart, y * rect.width * 4, (y + 1) * rect.width * 4);
  }
}

function sameInputReferences(actual, expected) {
  return canonicalJson(actual) === canonicalJson(expected.map(({ id, sha256: digest, role }) => ({
    id, sha256: digest, role
  })));
}

export async function verifyWaveATransformReplay(sourceOriginal, artifact, production, outputSize) {
  if (production.transformSteps.length === 1 && production.transformSteps[0] === 'none') {
    if (sourceOriginal.sourceFormat !== 'png' || !sourceOriginal.buffer.equals(artifact.buffer)) {
      throw new Error('production none transform requires byte-identical PNG source-original and artifact');
    }
    return;
  }
  let current = await decodedRgba(sourceOriginal.buffer);
  for (const step of production.transformSteps) {
    if (step === 'crop') current = cropRaw(current, production.cropRect);
    else if (step === 'chroma-key-remove') {
      current = chromaKeyRaw(current, production.chromaKey.keyColor, production.chromaKey.tolerance);
    } else if (step === 'nearest-downscale') current = await resizeNearestRaw(current, outputSize);
    else if (step === 'hard-alpha') current = hardAlphaAndZeroRaw(current, production.alphaThreshold);
    else throw new Error(`production transform is not replayable: ${step}`);
  }
  if (current.info.width !== outputSize.width || current.info.height !== outputSize.height) {
    throw new Error('production transform replay does not end at the native output size');
  }
  const actual = await decodedRgba(artifact.buffer);
  if (actual.info.width !== current.info.width || actual.info.height !== current.info.height
    || !actual.data.equals(current.data)) {
    throw new Error('production transform replay does not reproduce the imported artifact pixels');
  }
}

function validRect(rect) {
  return rect && typeof rect === 'object' && !Array.isArray(rect)
    && Object.keys(rect).sort().join(',') === 'height,width,x,y'
    && [rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0;
}

function validateCallerInputs(unitSources, identityBindingPath, terrainComposition = null) {
  const hasUnitSources = unitSources !== undefined;
  const hasTerrainComposition = terrainComposition !== null && terrainComposition !== undefined;
  if (hasUnitSources === hasTerrainComposition) {
    throw new Error('Wave A import requires exactly one of unitSources or terrainComposition');
  }
  if (hasUnitSources) {
    if (!Array.isArray(unitSources) || unitSources.length === 0 || unitSources.length > 100) {
      throw new Error('Wave A import requires 1..100 ordered unitSources');
    }
    for (const source of unitSources) {
      if (!source || typeof source !== 'object' || Array.isArray(source)
        || Object.keys(source).some((key) => !INPUT_KEYS.has(key))
        || typeof source.unitId !== 'string'
        || typeof source.sourceOriginal !== 'string'
        || !path.isAbsolute(source.sourceOriginal)
        || (source.cropRect !== undefined && !validRect(source.cropRect))) {
        throw new Error('Wave A unit source may declare only unitId, absolute sourceOriginal, and valid cropRect');
      }
    }
  } else {
    if (!terrainComposition || typeof terrainComposition !== 'object'
      || Array.isArray(terrainComposition)
      || Object.keys(terrainComposition).some((key) => !TERRAIN_COMPOSITION_KEYS.has(key))
      || Object.keys(terrainComposition).length !== TERRAIN_COMPOSITION_KEYS.size
      || terrainComposition.originKind !== 'deterministic-derived'
      || terrainComposition.composerVersion !== TERRAIN_COMPOSER_VERSION
      || terrainComposition.algorithm !== TERRAIN_COMPOSER_ALGORITHM
      || terrainComposition.configSha256 !== TERRAIN_COMPOSER_CONFIG_SHA256
      || terrainComposition.maskSetSha256 !== TERRAIN_COMPOSER_MASK_SET_SHA256
      || !Array.isArray(terrainComposition.inputs)
      || terrainComposition.inputs.length < 1 || terrainComposition.inputs.length > 6) {
      throw new Error('Wave A terrain composition declaration is incomplete or drifted');
    }
    for (const input of terrainComposition.inputs) {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => !TERRAIN_COMPOSITION_INPUT_KEYS.has(key))
        || Object.keys(input).length !== TERRAIN_COMPOSITION_INPUT_KEYS.size
        || typeof input.role !== 'string'
        || typeof input.sourceOriginal !== 'string'
        || !path.isAbsolute(input.sourceOriginal)
        || !validRect(input.cropRect)) {
        throw new Error('Terrain composition input may declare only role, absolute sourceOriginal, and cropRect');
      }
    }
    if (identityBindingPath !== null) {
      throw new Error('Terrain composition forbids identityBindingPath');
    }
  }
  if (identityBindingPath !== null
    && (typeof identityBindingPath !== 'string' || !IDENTITY_BINDING_PATH.test(identityBindingPath))) {
    throw new Error('Wave A identity binding must be a canonical issued unit-execution path or null');
  }
}

function exactSourceCoverage(job, unitSources) {
  const required = job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  const requiredIds = required.map(({ unitId }) => unitId);
  const actualIds = unitSources.map(({ unitId }) => unitId);
  const requiredSet = new Set(requiredIds);
  const duplicates = [...new Set(actualIds.filter((id, index) => actualIds.indexOf(id) !== index))];
  const missing = requiredIds.filter((id) => !actualIds.includes(id));
  const extra = actualIds.filter((id) => !requiredSet.has(id));
  if (missing.length > 0 || duplicates.length > 0 || extra.length > 0) {
    throw new Error(`Wave A unit coverage mismatch: missing=${missing.join(',') || 'none'}; duplicate=${duplicates.join(',') || 'none'}; extra=${extra.join(',') || 'none'}`);
  }
  if (canonicalJson(actualIds) !== canonicalJson(requiredIds)) {
    throw new Error('Wave A unit source order/frame binding does not match the canonical job');
  }
  return { required, missing, duplicates, extra };
}

async function cachedExternalSource(sourcePath, cache, job, sourceBudget) {
  let canonicalPathBefore;
  try {
    canonicalPathBefore = await realpath(sourcePath);
  } catch (error) {
    throw new Error(`Wave A source-original could not be resolved: ${sourcePath}`, { cause: error });
  }
  const requestedPath = path.resolve(sourcePath);
  let source = cache.get(requestedPath);
  if (!source) {
    // Read the caller's exact requested path so the safe reader's lstat/O_NOFOLLOW
    // checks cannot be bypassed by handing it a pre-resolved symlink target.
    let image = await readExternalImage(sourcePath, { limits: sourceImageLimits(job) });
    const digest = sha256(image.buffer);
    image = retainUniqueSourceImage(sourceBudget, image, digest, sourcePath);
    source = {
      canonicalPath: canonicalPathBefore,
      image,
      sha256: digest
    };
    cache.set(requestedPath, source);
  }
  const canonicalPathAfter = await realpath(sourcePath);
  if (canonicalPathAfter !== canonicalPathBefore) {
    throw new Error('Wave A source path changed while resolving alias identity');
  }
  if (source.canonicalPath !== canonicalPathAfter) {
    throw new Error('Wave A cached source path changed while resolving alias identity');
  }
  return source;
}

async function preflightUnitSources(job, unitSources) {
  const cache = new Map();
  const sourceBudget = createUniqueSourceBudget(job);
  for (const input of unitSources) {
    await cachedExternalSource(input.sourceOriginal, cache, job, sourceBudget);
  }
  return { cache, sourceBudget };
}

function requireTerrainCompositionRequest(job, terrainComposition) {
  if (job.generationMode !== 'terrain-composed-atlas' || job.category !== 'terrain'
    || !terrainComposition) {
    throw new Error('Terrain composition requires a new explicit terrain-composed-atlas job');
  }
  const currentPlan = terrainCompositionPlanFor(job.assetDefinition);
  requireCanonicalEqual(job.terrainCompositionPlan, currentPlan, 'terrain composition job plan');
  const expectedRequestAuthority = {
    originKind: currentPlan.originKind,
    composerVersion: currentPlan.composerVersion,
    algorithm: currentPlan.algorithm,
    configSha256: currentPlan.configSha256,
    maskSetSha256: currentPlan.maskSetSha256
  };
  requireCanonicalEqual(
    Object.fromEntries(Object.keys(expectedRequestAuthority).map((key) => [key, terrainComposition[key]])),
    expectedRequestAuthority,
    'terrain composition request authority'
  );
}

async function preflightTerrainInputs(job, terrainComposition) {
  requireTerrainCompositionRequest(job, terrainComposition);
  const cache = new Map();
  const sourceBudget = createUniqueSourceBudget(job);
  const inputs = [];
  for (const input of terrainComposition.inputs) {
    const source = await cachedExternalSource(
      input.sourceOriginal,
      cache,
      job,
      sourceBudget
    );
    inputs.push({
      role: input.role,
      requestedPath: path.resolve(input.sourceOriginal),
      cropRect: structuredClone(input.cropRect),
      source
    });
  }
  return { cache, sourceBudget, inputs };
}

function sourceFormatExtension(format) {
  return format === 'jpeg' ? 'jpg' : format;
}

function providerKeyNormalizedSnapshotPath(job, outputRoot, stem) {
  const sourceKind = providerKeyNormalizationSourceKindForJob(job);
  return sourceKind
    ? path.join(outputRoot, 'sources', `${stem}-${sourceKind}.provider-key-normalized.png`)
    : null;
}

function canonicalCharacterAtlasUnits(job) {
  if (job.category !== 'character' || job.generationMode !== 'monolithic-atlas'
    || job.generationUnits.length !== CHARACTER_ATLAS_UNIT_COUNT
    || job.artifactContracts.length !== 1
    || job.artifactContracts[0].role !== 'primary') {
    throw new Error('Wave A character monolithic atlas requires one canonical 40-unit primary job');
  }
  const first = job.generationUnits[0];
  const cellWidth = first.targetRect.width;
  const cellHeight = first.targetRect.height;
  const outputSize = job.artifactContracts[0].outputSize;
  if (cellWidth !== 48 || cellHeight !== 96
    || outputSize.width !== cellWidth * CHARACTER_ATLAS_COLUMNS
    || outputSize.height !== cellHeight * CHARACTER_ATLAS_ROWS) {
    throw new Error('Wave A character monolithic atlas requires the canonical 10-column x 4-row 48x96 layout');
  }
  for (const [index, unit] of job.generationUnits.entries()) {
    const column = index % CHARACTER_ATLAS_COLUMNS;
    const row = Math.floor(index / CHARACTER_ATLAS_COLUMNS);
    const expectedRect = {
      x: column * cellWidth,
      y: row * cellHeight,
      width: cellWidth,
      height: cellHeight
    };
    if (unit.cellIndex !== index || canonicalJson(unit.targetRect) !== canonicalJson(expectedRect)
      || !unit.sourceRequired || unit.expectation !== 'expected-nonempty') {
      throw new Error(`Wave A character monolithic atlas unit ${unit.unitId} is not in canonical row-major order`);
    }
  }
  return job.generationUnits;
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width && right.x < left.x + left.width
    && left.y < right.y + right.height && right.y < left.y + left.height;
}

function validateCharacterMonolithicCropLayout(job, records) {
  const units = canonicalCharacterAtlasUnits(job);
  if (records.length !== units.length) {
    throw new Error('Wave A character monolithic atlas requires exactly 40 ordered crop claims');
  }
  const firstCrop = records[0]?.input?.cropRect;
  if (!validRect(firstCrop)) {
    throw new Error('Wave A character monolithic atlas requires one explicit cropRect per unit');
  }
  if (firstCrop.width * 96 !== firstCrop.height * 48) {
    throw new Error('Wave A character monolithic atlas crops require the exact 48:96 cell aspect ratio');
  }
  for (const [index, record] of records.entries()) {
    const crop = record.input?.cropRect;
    if (!validRect(crop)) {
      throw new Error(`Wave A character monolithic atlas ${units[index].unitId} is missing a valid cropRect`);
    }
    if (record.unit.unitId !== units[index].unitId) {
      throw new Error('Wave A character monolithic atlas crop order does not match the formal unit order');
    }
    if (crop.width !== firstCrop.width || crop.height !== firstCrop.height) {
      throw new Error('Wave A character monolithic atlas requires 40 equal-size cropRects');
    }
    if (crop.width * units[index].targetRect.height
      !== crop.height * units[index].targetRect.width) {
      throw new Error(`Wave A ${units[index].unitId} source/crop aspect ratio does not match targetRect`);
    }
  }
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      if (rectanglesOverlap(records[left].input.cropRect, records[right].input.cropRect)) {
        throw new Error('Wave A character monolithic atlas cropRects must not overlap');
      }
    }
  }
  for (const [index, record] of records.entries()) {
    const column = index % CHARACTER_ATLAS_COLUMNS;
    const row = Math.floor(index / CHARACTER_ATLAS_COLUMNS);
    const expected = {
      x: firstCrop.x + column * firstCrop.width,
      y: firstCrop.y + row * firstCrop.height,
      width: firstCrop.width,
      height: firstCrop.height
    };
    if (canonicalJson(record.input.cropRect) !== canonicalJson(expected)) {
      throw new Error('Wave A character monolithic atlas cropRects must form one canonical row-major 10-column x 4-row grid');
    }
  }
}

function canonicalCharacterDirectionStripUnits(job) {
  if (job.category !== 'character' || job.generationMode !== CHARACTER_DIRECTION_STRIP_MODE
    || job.generationUnits.length !== CHARACTER_ATLAS_UNIT_COUNT
    || job.artifactContracts.length !== 1
    || job.artifactContracts[0].role !== 'primary') {
    throw new Error('Wave A character direction strips require one canonical 40-unit primary job');
  }
  requireCanonicalEqual(
    job.characterDirectionStripPlan,
    characterDirectionStripPlanFor(job.assetDefinition, job.generationMode),
    'character direction-strip job plan'
  );
  const first = job.generationUnits[0];
  const cellWidth = first.targetRect.width;
  const cellHeight = first.targetRect.height;
  const outputSize = job.artifactContracts[0].outputSize;
  if (cellWidth !== 48 || cellHeight !== 96
    || outputSize.width !== cellWidth * CHARACTER_DIRECTION_STRIP_COLUMNS
    || outputSize.height !== cellHeight * CHARACTER_DIRECTION_STRIP_DIRECTIONS.length) {
    throw new Error('Wave A character direction strips require the canonical 10x4 48x96 runtime layout');
  }
  for (const [index, unit] of job.generationUnits.entries()) {
    const directionIndex = Math.floor(index / CHARACTER_DIRECTION_STRIP_COLUMNS);
    const column = index % CHARACTER_DIRECTION_STRIP_COLUMNS;
    const expectedRect = {
      x: column * cellWidth,
      y: directionIndex * cellHeight,
      width: cellWidth,
      height: cellHeight
    };
    if (unit.cellIndex !== index
      || unit.direction !== CHARACTER_DIRECTION_STRIP_DIRECTIONS[directionIndex]
      || canonicalJson(unit.targetRect) !== canonicalJson(expectedRect)
      || !unit.sourceRequired || unit.expectation !== 'expected-nonempty') {
      throw new Error(`Wave A character direction-strip unit ${unit.unitId} is not canonical`);
    }
  }
  return job.generationUnits;
}

function validateCharacterDirectionStripCropLayout(job, records) {
  const units = canonicalCharacterDirectionStripUnits(job);
  if (records.length !== units.length) {
    throw new Error('Wave A character direction strips require exactly 40 ordered crop claims');
  }
  for (const [directionIndex, direction] of CHARACTER_DIRECTION_STRIP_DIRECTIONS.entries()) {
    const start = directionIndex * CHARACTER_DIRECTION_STRIP_COLUMNS;
    const group = records.slice(start, start + CHARACTER_DIRECTION_STRIP_COLUMNS);
    const firstCrop = group[0]?.input?.cropRect;
    if (!validRect(firstCrop)) {
      throw new Error(`Wave A ${direction} direction strip requires ten explicit cropRects`);
    }
    if (firstCrop.width * 2 !== firstCrop.height
      || firstCrop.width * CHARACTER_DIRECTION_STRIP_COLUMNS !== firstCrop.height * 5) {
      throw new Error(`Wave A ${direction} direction strip requires a 5:1 row of portrait 1:2 cells`);
    }
    for (const [column, record] of group.entries()) {
      const crop = record?.input?.cropRect;
      const unit = units[start + column];
      const expected = {
        x: firstCrop.x + column * firstCrop.width,
        y: firstCrop.y,
        width: firstCrop.width,
        height: firstCrop.height
      };
      if (record?.unit?.unitId !== unit.unitId || record?.unit?.direction !== direction
        || !validRect(crop) || canonicalJson(crop) !== canonicalJson(expected)) {
        throw new Error(`Wave A ${direction} direction-strip crops must be ten equal contiguous cells in canonical order`);
      }
      if (crop.width * unit.targetRect.height !== crop.height * unit.targetRect.width) {
        throw new Error(`Wave A ${unit.unitId} direction-strip crop aspect does not match targetRect`);
      }
    }
  }
}

function validateSourceSharing(job, records, identity) {
  const { generationMode } = job;
  const realPaths = records.map(({ source }) => source.canonicalPath);
  const hashes = records.map(({ source }) => source.sha256);
  if (generationMode === 'per-unit') {
    if (new Set(realPaths).size !== records.length || new Set(hashes).size !== records.length) {
      throw new Error('Wave A per-unit mode requires a unique primary source path and bytes for every unit');
    }
  } else if (generationMode === CHARACTER_DIRECTION_STRIP_MODE) {
    validateCharacterDirectionStripCropLayout(job, records);
    const directionPaths = [];
    const directionHashes = [];
    for (let index = 0; index < CHARACTER_DIRECTION_STRIP_DIRECTIONS.length; index += 1) {
      const start = index * CHARACTER_DIRECTION_STRIP_COLUMNS;
      const group = records.slice(start, start + CHARACTER_DIRECTION_STRIP_COLUMNS);
      const paths = new Set(group.map(({ source }) => source.canonicalPath));
      const groupHashes = new Set(group.map(({ source }) => source.sha256));
      if (paths.size !== 1 || groupHashes.size !== 1) {
        throw new Error(`Wave A ${CHARACTER_DIRECTION_STRIP_DIRECTIONS[index]} direction strip requires one shared provider-original source`);
      }
      directionPaths.push([...paths][0]);
      directionHashes.push([...groupHashes][0]);
    }
    if (new Set(directionPaths).size !== 4 || new Set(directionHashes).size !== 4) {
      throw new Error('Wave A character direction strips require four distinct source paths and four distinct source hashes');
    }
  } else {
    if (new Set(realPaths).size !== 1 || new Set(hashes).size !== 1
      || records.some(({ input }) => !input.cropRect)
      || new Set(records.map(({ input }) => canonicalJson(input.cropRect))).size !== records.length) {
      throw new Error('Wave A monolithic-atlas mode requires one shared source and a unique cropRect for every unit');
    }
    if (job.category === 'character') validateCharacterMonolithicCropLayout(job, records);
  }
  if (identity && (realPaths.includes(identity.source.canonicalPath)
    || hashes.includes(identity.source.sha256)
    || hashes.includes(identity.transformedSha256))) {
    throw new Error('Wave A identity master cannot alias or duplicate a primary unit source');
  }
}

async function readIdentityMaster(identityMasterSource, job, cache, sourceBudget) {
  if (!job.identityMasterPlan) {
    if (identityMasterSource !== null) throw new Error('Non-character Wave A jobs forbid identityMasterSource');
    return null;
  }
  if (!identityMasterSource) throw new Error('Character Wave A jobs require identityMasterSource');
  const source = await cachedExternalSource(
    identityMasterSource.sourceOriginal,
    cache,
    job,
    sourceBudget
  );
  const { image } = source;
  const plan = job.identityMasterPlan;
  if (!identityMasterSource.cropRect
    && (image.metadata.width !== plan.outputSize.width
      || image.metadata.height !== plan.outputSize.height)) {
    throw new Error('Wave A large identity source requires an explicit 2:1 cropRect');
  }
  const effectiveCrop = identityMasterSource.cropRect ?? {
    x: 0,
    y: 0,
    width: image.metadata.width,
    height: image.metadata.height
  };
  if (effectiveCrop.width * plan.outputSize.height
    !== effectiveCrop.height * plan.outputSize.width) {
    throw new Error('Wave A identity master cropRect must have the exact 2:1 target aspect ratio');
  }
  const providerKeyNormalization = await normalizedProviderSource(
    job,
    source,
    'identity-master'
  );
  const transformed = await canonicalUnitTransform(
    providerKeyNormalization?.image ?? image,
    effectiveCrop,
    plan.outputSize,
    canonicalBackgroundRemoval(job)
  );
  const transformedPng = await encodeRawPng(
    transformed.data,
    plan.outputSize.width,
    plan.outputSize.height
  );
  const audit = pixelAudit(transformed.data);
  if (audit.visiblePixels === 0 || audit.transparentPixels === 0
    || audit.partialAlphaPixels !== 0 || audit.hiddenRgbPixels !== 0
    || audit.opaqueMagentaPixels !== 0) {
    throw new Error('Wave A transformed identity master must be visible, transparent, hard-alpha, zero-hidden-RGB, and magenta-free');
  }
  const cellHashes = [];
  for (let index = 0; index < 4; index += 1) {
    const cell = rawCell(transformed.data, plan.outputSize, {
      x: index * plan.cellSize.width,
      y: 0,
      ...plan.cellSize
    });
    if (pixelAudit(cell).visiblePixels === 0) throw new Error('Wave A identity master has an empty direction cell');
    cellHashes.push(sha256(cell));
  }
  if (new Set(cellHashes).size !== 4) {
    throw new Error('Wave A identity master direction cells must be byte-distinct');
  }
  return {
    input: identityMasterSource,
    source,
    providerKeyNormalization,
    effectiveCrop,
    raw: transformed.data,
    transformedPng,
    transformedSha256: sha256(transformedPng),
    transformEvidence: transformed.transformEvidence,
    audit,
    cellHashes
  };
}

function identityExecutionPrompt(job, unit, bindingContext) {
  return [
    unit.unitPromptText.trimEnd(),
    '',
    '# Issued identity consistency input',
    '',
    `Identity binding: ${bindingContext.bindingId}`,
    `Identity plan: ${job.identityMasterPlan.planId}`,
    `Canonical transformed identity PNG: ${bindingContext.transformedPath}`,
    `Canonical transformed identity SHA-256: ${bindingContext.transformedSha256}`,
    'Supply that exact 192x96 PNG as the identity-consistency image input together with the two',
    'authorized style/subject references. Preserve the matching direction, outfit, anatomy, palette,',
    'role tool, and baseline in this one semantic frame. Do not substitute or regenerate the identity',
    'master. This issued instruction binds this intended unit slot to those identity bytes, but Asset Forge has no',
    'provider-signed invocation receipt and therefore does not claim cryptographic proof of delivery.',
    ''
  ].join('\n');
}

function identityAtlasExecutionPrompt(job, bindingContext) {
  const units = canonicalCharacterAtlasUnits(job).map((unit, index) => ({
    index,
    row: Math.floor(index / CHARACTER_ATLAS_COLUMNS),
    column: index % CHARACTER_ATLAS_COLUMNS,
    unitId: unit.unitId,
    baseUnitPromptSha256: unit.unitPromptSha256,
    direction: unit.direction,
    frameId: unit.frameId,
    semanticRole: unit.semanticRole,
    targetRect: unit.targetRect,
    visualContent: unit.visualContent
  }));
  const layoutPlan = job.characterAtlasLayoutPlan ?? null;
  return [
    ...(layoutPlan ? [
      '# Mandatory character atlas layout guidance',
      '',
      `Character atlas layout policy: ${layoutPlan.version}.`,
      `Policy config SHA-256: ${layoutPlan.configSha256}.`,
      'Overall content grid must be exactly 5:4 (width:height).',
      'Use exactly ten columns and four rows.',
      'Every cell must be portrait 1:2 (width:height), never square and never a square-cell contact sheet.',
      'All 40 cells must be uniform, contiguous, and gapless; no gutters, padding bands, or uneven cells.',
      'Keep each subject opaque bounding box at or below 80% of its cell width and 88% of its cell height.',
      'Keep a continuous full outer margin of exact #FF00FF key background around the complete 10x4 grid.',
      'Every frame in row 1 (front) must face the viewer directly, including all walk frames; profile and three-quarter turns are forbidden.',
      'Every frame in row 2 (back) must face exactly away from the viewer, including all walk frames; profile and three-quarter turns are forbidden.',
      'Every frame in row 3 stays left-facing and every frame in row 4 stays right-facing; never swap or turn those directions.',
      ''
    ] : []),
    '# Issued identity-bound monolithic character atlas execution',
    '',
    `Canonical job ID: ${job.id}`,
    `Canonical job provenance key: ${job.provenanceKey}`,
    `Generation mode: ${job.generationMode}`,
    `Canonical generation-unit set SHA-256: ${job.generationUnitSetSha256}`,
    `Identity binding: ${bindingContext.bindingId}`,
    `Identity plan: ${job.identityMasterPlan.planId}`,
    `Canonical transformed identity PNG: ${bindingContext.transformedPath}`,
    `Canonical transformed identity SHA-256: ${bindingContext.transformedSha256}`,
    '',
    'Generate exactly one provider-native raster containing one contiguous row-major grid of 10 columns',
    'by 4 rows. Rows are front, back, left, right in that order. Columns are the ten canonical',
    'animation frames in formal unit order. Every cell must have the same 1:2 aspect ratio and size.',
    'Use exact flat #FF00FF throughout every cell background and around the full grid. Do not add gaps,',
    'labels, captions, borders, checkerboards, alternate layouts, neighboring examples, or extra cells.',
    ...(providerKeyNormalizationPlan(job) ? [
      `This exact job opts into ${providerKeyNormalizationPlan(job).version}; config SHA-256 ${providerKeyNormalizationPlan(job).configSha256}.`,
      'The requested key remains exact #FF00FF. A narrowly shifted fully opaque provider key may only be',
      'handled by preserving the provider-original PNG and deriving a separately hashed full-size canonical PNG.'
    ] : []),
    'Supply the exact transformed identity PNG above together with the two authorized references. Preserve',
    'identity, outfit, anatomy, palette, tool, direction, action, scale, and common foot baseline across all',
    '40 cells. This is the sole generation instruction; do not invoke the individual cell contracts.',
    '',
    `Layout: ${CHARACTER_ATLAS_LAYOUT}`,
    'Canonical 40-unit row-major layout:',
    canonicalJson(units).trimEnd(),
    '',
    'The importer accepts exactly one shared source with 40 equal-size, nonoverlapping crop rectangles that',
    'form this same contiguous 10-column x 4-row order. It replays every crop and rejects duplicate cells.',
    'Asset Forge has no provider-signed invocation receipt and therefore does not claim cryptographic proof',
    'that the provider received this prompt or the identity image.',
    ''
  ].join('\n');
}

function identityDirectionStripExecutionPrompt(job, direction, bindingContext) {
  const units = canonicalCharacterDirectionStripUnits(job)
    .filter((unit) => unit.direction === direction)
    .map((unit, column) => ({
      column,
      unitId: unit.unitId,
      baseUnitPromptSha256: unit.unitPromptSha256,
      direction: unit.direction,
      frameId: unit.frameId,
      semanticRole: unit.semanticRole,
      targetRect: unit.targetRect,
      visualContent: unit.visualContent
    }));
  if (units.length !== CHARACTER_DIRECTION_STRIP_COLUMNS) {
    throw new Error(`Wave A ${direction} identity direction strip requires exactly ten semantic units`);
  }
  const plan = job.characterDirectionStripPlan;
  return [
    '# Issued identity-bound character direction-strip execution',
    '',
    `Canonical job ID: ${job.id}`,
    `Canonical job provenance key: ${job.provenanceKey}`,
    `Generation mode: ${job.generationMode}`,
    `Direction-strip policy: ${plan.version}`,
    `Direction-strip config SHA-256: ${plan.configSha256}`,
    `Canonical generation-unit set SHA-256: ${job.generationUnitSetSha256}`,
    `Identity binding: ${bindingContext.bindingId}`,
    `Identity plan: ${job.identityMasterPlan.planId}`,
    `Identity master prompt SHA-256: ${job.identityMasterPlan.promptSha256}`,
    `Canonical transformed identity PNG: ${bindingContext.transformedPath}`,
    `Canonical transformed identity SHA-256: ${bindingContext.transformedSha256}`,
    `Canonical ${direction} identity cell SHA-256: ${bindingContext.directionCellSha256}`,
    `Required direction: ${direction}`,
    '',
    'Generate exactly one provider-native raster containing one horizontal content strip of exactly ten',
    'uniform contiguous cells and no other panels or figures. The content strip is exactly 5:1 overall;',
    'each of its ten cells is portrait 1:2, with no gutters, gaps, borders, padding bands, or extra cells.',
    'A normal landscape provider canvas may surround the 5:1 content strip, but a continuous full outer',
    'margin of exact flat #FF00FF must remain visible around the entire content strip.',
    `Every one of the ten frames, including every work frame, must face ${direction} and remain on that axis.`,
    ...(direction === 'front' || direction === 'back' ? [
      `${direction} means exactly ${direction === 'front' ? 'toward the viewer' : 'away from the viewer'}; profile and three-quarter turns are forbidden.`
    ] : [
      `Keep a strict ${direction}-facing side view in every cell; never swap, mirror, or turn toward another direction.`
    ]),
    'Keep identity, outfit, anatomy, palette, role tool, scale, and one common foot baseline consistent',
    'with the exact transformed identity PNG. Keep each subject at or below 80% of cell width and 88%',
    'of cell height. Use exact flat #FF00FF for all background. No labels, captions, checkerboards,',
    'scenes, shadows outside the cell, alternate directions, neighboring examples, or generated grid lines.',
    '',
    `Layout: ${CHARACTER_DIRECTION_STRIP_LAYOUT}`,
    `Canonical ${direction} ten-unit order:`,
    canonicalJson(units).trimEnd(),
    '',
    'This is the sole provider instruction for these ten units; do not invoke their individual contracts.',
    'The importer accepts exactly one provider-original source for this direction and ten equal contiguous',
    'nonoverlapping crop rectangles in this order. The other three directions require three different',
    'provider-original source paths and byte hashes. Asset Forge has no provider-signed invocation receipt.',
    ''
  ].join('\n');
}

function withoutContentDigest(record) {
  const copy = structuredClone(record);
  delete copy.contentDigest;
  return copy;
}

function requireCanonicalEqual(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`Wave A ${label} does not match canonical evidence`);
  }
}

async function readPersistedImage(root, snapshot, label, job = null, sourceBudget = null) {
  const absolute = resolveWithin(root, snapshot.path);
  await assertNoSymlinkPath(root, absolute);
  let image = await readExternalImage(absolute, { limits: sourceImageLimits(job) });
  const digest = sha256(image.buffer);
  if (digest !== snapshot.sha256 || image.sourceFormat !== snapshot.format
    || image.metadata.width !== snapshot.width || image.metadata.height !== snapshot.height) {
    throw new Error(`Wave A ${label} snapshot hash/format/dimensions mismatch`);
  }
  if (sourceBudget) {
    image = retainUniqueSourceImage(sourceBudget, image, digest, label);
  }
  return { absolute, image, sha256: digest };
}

function identityBindingKey(job, identity) {
  return sha256(canonicalJson({
    jobProvenanceKey: job.provenanceKey,
    identityPlanId: job.identityMasterPlan.planId,
    identityPlanPromptSha256: job.identityMasterPlan.promptSha256,
    sourceOriginalSha256: identity.source.sha256,
    sourceOriginalFormat: identity.source.image.sourceFormat,
    sourceOriginalSize: {
      width: identity.source.image.metadata.width,
      height: identity.source.image.metadata.height
    },
    cropRect: identity.effectiveCrop,
    ...(identity.providerKeyNormalization ? {
      providerKeyNormalizationDerivationSha256:
        identity.providerKeyNormalization.evidence.derivationSha256,
      providerKeyNormalizedSha256:
        identity.providerKeyNormalization.evidence.normalized.sha256
    } : {}),
    transformedSha256: identity.transformedSha256,
    directionCellSha256s: identity.cellHashes
  }));
}

function identityBindingPaths(root, verifiedPack, job, identity) {
  const key = identityBindingKey(job, identity);
  const bindingId = `identity_binding_${key.slice(0, 20)}`;
  const packDirectory = path.posix.dirname(verifiedPack.pack.members.job.path);
  const bindingRoot = `${packDirectory}/identity-bindings/${bindingId}`;
  const sourceExtension = sourceFormatExtension(identity.source.image.sourceFormat);
  return {
    key,
    bindingId,
    bindingRoot,
    sourcePath: `${bindingRoot}/identity-master.source-original.${sourceExtension}`,
    ...(identity.providerKeyNormalization ? {
      normalizedPath: `${bindingRoot}/identity-master.provider-key-normalized.png`
    } : {}),
    transformedPath: `${bindingRoot}/identity-master.png`,
    planPath: `${bindingRoot}/unit-execution.json`
  };
}

function identityBindingPlan(verifiedPack, identity, paths) {
  const { job } = verifiedPack;
  const monolithicAtlas = job.generationMode === 'monolithic-atlas';
  const directionStrips = job.generationMode === CHARACTER_DIRECTION_STRIP_MODE;
  const atlasExecutionPromptPath = monolithicAtlas
    ? `${paths.bindingRoot}/execution-prompts/monolithic-atlas.md`
    : null;
  const atlasExecutionPromptText = monolithicAtlas
    ? identityAtlasExecutionPrompt(job, {
        bindingId: paths.bindingId,
        transformedPath: paths.transformedPath,
        transformedSha256: identity.transformedSha256
      })
    : null;
  const atlasExecutionPromptSha256 = atlasExecutionPromptText
    ? sha256(atlasExecutionPromptText)
    : null;
  const directionStripPrompts = directionStrips
    ? CHARACTER_DIRECTION_STRIP_DIRECTIONS.map((direction, index) => {
        const executionPromptPath =
          `${paths.bindingRoot}/execution-prompts/direction-strip-${direction}.md`;
        const executionPromptText = identityDirectionStripExecutionPrompt(job, direction, {
          bindingId: paths.bindingId,
          transformedPath: paths.transformedPath,
          transformedSha256: identity.transformedSha256,
          directionCellSha256: identity.cellHashes[index]
        });
        return {
          direction,
          executionPromptPath,
          executionPromptSha256: sha256(executionPromptText),
          executionPromptText
        };
      })
    : [];
  const directionStripPromptByDirection = new Map(
    directionStripPrompts.map((record) => [record.direction, record])
  );
  const units = job.generationUnits.map((unit) => {
    const directionStripPrompt = directionStripPromptByDirection.get(unit.direction) ?? null;
    const executionPromptPath = monolithicAtlas
      ? atlasExecutionPromptPath
      : directionStrips
        ? directionStripPrompt.executionPromptPath
      : `${paths.bindingRoot}/execution-prompts/${unit.unitId}.md`;
    const executionPromptText = monolithicAtlas
      ? atlasExecutionPromptText
      : directionStrips
        ? directionStripPrompt.executionPromptText
      : identityExecutionPrompt(job, unit, {
          bindingId: paths.bindingId,
          transformedPath: paths.transformedPath,
          transformedSha256: identity.transformedSha256
        });
    return {
      unitId: unit.unitId,
      baseUnitPromptSha256: unit.unitPromptSha256,
      executionPromptPath,
      executionPromptSha256: sha256(executionPromptText),
      consistencyInputSha256: identity.transformedSha256,
      inputReferences: structuredClone(unit.inputReferences),
      executionPromptText
    };
  });
  const planWithoutDigest = {
    schemaVersion: 2,
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    status: 'identity-bound-unit-execution',
    bindingId: paths.bindingId,
    jobPackPath: verifiedPack.pack.members.job.path.replace(/\/job\.json$/, '/job-pack.json'),
    jobId: job.id,
    jobProvenanceKey: job.provenanceKey,
    assetId: job.assetId,
    definitionSha256: job.definitionSha256,
    promptSha256: job.promptSha256,
    referenceAuthorizationSha256: job.referenceAuthorizationSha256,
    generationUnitSetSha256: job.generationUnitSetSha256,
    generationMode: job.generationMode,
    ...(job.characterAtlasLayoutPlan ? {
      characterAtlasLayoutPlan: structuredClone(job.characterAtlasLayoutPlan)
    } : {}),
    ...(job.characterDirectionStripPlan ? {
      characterDirectionStripPlan: structuredClone(job.characterDirectionStripPlan)
    } : {}),
    ...(monolithicAtlas ? {
      atlasExecution: {
        layout: CHARACTER_ATLAS_LAYOUT,
        columns: CHARACTER_ATLAS_COLUMNS,
        rows: CHARACTER_ATLAS_ROWS,
        unitOrder: job.generationUnits.map(({ unitId }) => unitId),
        executionPromptPath: atlasExecutionPromptPath,
        executionPromptSha256: atlasExecutionPromptSha256
      }
    } : {}),
    ...(directionStrips ? {
      directionStripExecutions: directionStripPrompts.map((record) => ({
        direction: record.direction,
        layout: CHARACTER_DIRECTION_STRIP_LAYOUT,
        contentAspectRatio: '5:1',
        columns: CHARACTER_DIRECTION_STRIP_COLUMNS,
        rows: 1,
        unitOrder: job.generationUnits
          .filter(({ direction }) => direction === record.direction)
          .map(({ unitId }) => unitId),
        executionPromptPath: record.executionPromptPath,
        executionPromptSha256: record.executionPromptSha256
      }))
    } : {}),
    identityMaster: {
      planId: job.identityMasterPlan.planId,
      planPromptSha256: job.identityMasterPlan.promptSha256,
      inputReferences: structuredClone(job.identityMasterPlan.inputReferences),
      sourceOriginal: {
        sha256: identity.source.sha256,
        format: identity.source.image.sourceFormat,
        width: identity.source.image.metadata.width,
        height: identity.source.image.metadata.height,
        cropRect: structuredClone(identity.effectiveCrop)
      },
      sourceSnapshot: {
        path: paths.sourcePath,
        sha256: identity.source.sha256,
        format: identity.source.image.sourceFormat,
        width: identity.source.image.metadata.width,
        height: identity.source.image.metadata.height
      },
      ...(identity.providerKeyNormalization ? {
        providerKeyNormalization: providerKeyNormalizationLedger(
          identity.providerKeyNormalization,
          paths.normalizedPath
        )
      } : {}),
      transformedSnapshot: {
        path: paths.transformedPath,
        sha256: identity.transformedSha256,
        format: 'png',
        width: job.identityMasterPlan.outputSize.width,
        height: job.identityMasterPlan.outputSize.height
      },
      transformSteps: [...transformStepsFor(job)],
      ...(canonicalBackgroundRemoval(job) ? {
        transformEvidence: structuredClone(identity.transformEvidence)
      } : {}),
      consistencyInputSha256: identity.transformedSha256,
      directionCellSha256s: identity.cellHashes,
      auxiliary: true,
      semanticCell: false,
      approvedAsset: false
    },
    units: units.map(({ executionPromptText: omitted, ...unit }) => unit),
    issuanceSequence: 'identity-binding-before-unit-source-import',
    providerInvocationEvidence: 'unverified-no-provider-receipt'
  };
  return {
    plan: {
      ...planWithoutDigest,
      contentDigest: sha256(canonicalJson(planWithoutDigest))
    },
    units
  };
}

export async function prepareWaveAIdentityBinding({
  assetId,
  jobPackPath,
  identityMasterSource
}, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  if (path.resolve(root) !== path.resolve(forgeRoot)) {
    throw new Error('Wave A identity preparation requires one canonical Forge root');
  }
  if (!identityMasterSource || typeof identityMasterSource !== 'object'
    || Array.isArray(identityMasterSource)
    || Object.keys(identityMasterSource).some((key) => !IDENTITY_INPUT_KEYS.has(key))
    || typeof identityMasterSource.sourceOriginal !== 'string'
    || !path.isAbsolute(identityMasterSource.sourceOriginal)
    || (identityMasterSource.cropRect !== undefined && !validRect(identityMasterSource.cropRect))) {
    throw new Error('Wave A identity master source may declare only absolute sourceOriginal and valid cropRect');
  }
  const verifiedPack = await verifyWaveAJobPack(jobPackPath, { root, forgeRoot });
  const { job } = verifiedPack;
  if (assetId !== job.assetId || job.category !== 'character'
    || !['per-unit', 'monolithic-atlas', CHARACTER_DIRECTION_STRIP_MODE].includes(job.generationMode)
    || !job.identityMasterPlan
    || job.generationUnits.length !== 40) {
    throw new Error('Wave A identity binding requires an exact 40-unit character job pack');
  }
  const identity = await readIdentityMaster(
    identityMasterSource,
    job,
    new Map(),
    createUniqueSourceBudget(job)
  );
  const bindingPaths = identityBindingPaths(root, verifiedPack, job, identity);
  const { plan, units } = identityBindingPlan(verifiedPack, identity, bindingPaths);
  const validation = validateWith('identity-bound-execution-v2.schema.json', plan);
  if (!validation.ok) {
    throw new Error(`Invalid Wave A identity-bound execution plan: ${JSON.stringify(validation.errors)}`);
  }
  return withFileLock(root, pathsFor(root).requiredPromotionLock, async () => {
    const currentPack = await verifyWaveAJobPack(jobPackPath, { root, forgeRoot });
    if (canonicalJson(currentPack.job) !== canonicalJson(job)) {
      throw new Error('Wave A character job pack changed before identity binding write');
    }
    const approvedBefore = await hashApprovedTree(root);
    const executionPromptDestinations = [...new Map(units.map((unit) => [
      unit.executionPromptPath,
      {
        path: resolveWithin(root, unit.executionPromptPath),
        bytes: Buffer.from(unit.executionPromptText),
        label: job.generationMode === 'monolithic-atlas'
          ? 'identity-bound monolithic atlas execution prompt'
          : job.generationMode === CHARACTER_DIRECTION_STRIP_MODE
            ? 'identity-bound direction-strip execution prompt'
            : `${unit.unitId} identity-bound execution prompt`
      }
    ])).values()];
    const destinations = [
      {
        path: resolveWithin(root, bindingPaths.sourcePath),
        bytes: identity.source.image.buffer,
        label: 'identity source-original'
      },
      ...(identity.providerKeyNormalization ? [{
        path: resolveWithin(root, bindingPaths.normalizedPath),
        bytes: identity.providerKeyNormalization.normalizedPng,
        label: 'identity provider-key-normalized snapshot'
      }] : []),
      {
        path: resolveWithin(root, bindingPaths.transformedPath),
        bytes: identity.transformedPng,
        label: 'identity transformed snapshot'
      },
      ...executionPromptDestinations,
      {
        path: resolveWithin(root, bindingPaths.planPath),
        bytes: Buffer.from(canonicalJson(plan)),
        label: 'identity-bound unit execution plan'
      }
    ];
    const states = [];
    for (const destination of destinations) {
      const existing = await existingBytes(root, destination.path);
      if (existing && !existing.equals(destination.bytes)) {
        throw new Error(`Wave A ${destination.label} conflicts with prior identity binding debris`);
      }
      states.push(existing ? 'existing-identical' : 'missing');
    }
    const newlyWritten = [];
    try {
      for (const [index, destination] of destinations.entries()) {
        if (states[index] === 'existing-identical') continue;
        await writeOrVerify(root, destination.path, destination.bytes, destination.label);
        newlyWritten.push(destination.path);
      }
      const approvedAfter = await hashApprovedTree(root);
      if (approvedAfter !== approvedBefore) throw new Error('Approved tree changed during identity binding');
      const verified = await verifyWaveAIdentityBinding(bindingPaths.planPath, { root, forgeRoot });
      return {
        status: 'identity-bound-unit-execution',
        bindingPath: bindingPaths.planPath,
        bindingSha256: verified.bindingSha256,
        binding: verified.binding,
        resumed: states.some((state) => state !== 'missing'),
        approvedTreeSha256Before: approvedBefore,
        approvedTreeSha256After: approvedAfter
      };
    } catch (error) {
      for (const destination of newlyWritten.reverse()) await rm(destination, { force: true }).catch(() => {});
      throw error;
    }
  });
}

export async function verifyWaveAIdentityBinding(bindingPath, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  verifiedPack = null,
  sourceBudget = null
} = {}) {
  if (typeof bindingPath !== 'string' || !IDENTITY_BINDING_PATH.test(bindingPath)) {
    throw new Error('Wave A character import requires an issued identity-bound unit execution plan');
  }
  const planRead = await readBoundedWithin(root, bindingPath);
  const binding = parseJson(planRead.bytes, 'Wave A identity-bound execution plan');
  const validation = validateWith('identity-bound-execution-v2.schema.json', binding);
  if (!validation.ok) {
    throw new Error(`Invalid Wave A identity-bound execution plan: ${JSON.stringify(validation.errors)}`);
  }
  if (binding.contentDigest !== sha256(canonicalJson(withoutContentDigest(binding)))) {
    throw new Error('Wave A identity-bound execution content digest mismatch');
  }
  const verified = verifiedPack ?? await verifyWaveAJobPack(binding.jobPackPath, { root, forgeRoot });
  const { job } = verified;
  const effectiveSourceBudget = sourceBudget ?? createUniqueSourceBudget(job);
  if (job.category !== 'character'
    || !['per-unit', 'monolithic-atlas', CHARACTER_DIRECTION_STRIP_MODE].includes(job.generationMode)
    || job.generationUnits.length !== 40 || !job.identityMasterPlan) {
    throw new Error('Wave A identity binding is not attached to a canonical 40-unit character job');
  }
  const canonicalJobPackPath = verified.pack.members.job.path.replace(/\/job\.json$/, '/job-pack.json');
  const expectedBindings = {
    jobPackPath: canonicalJobPackPath,
    jobId: job.id,
    jobProvenanceKey: job.provenanceKey,
    assetId: job.assetId,
    definitionSha256: job.definitionSha256,
    promptSha256: job.promptSha256,
    referenceAuthorizationSha256: job.referenceAuthorizationSha256,
    generationUnitSetSha256: job.generationUnitSetSha256,
    generationMode: job.generationMode
  };
  requireCanonicalEqual(Object.fromEntries(Object.keys(expectedBindings).map((key) => [key, binding[key]])), expectedBindings, 'identity binding job authority');
  const source = await readPersistedImage(
    root,
    binding.identityMaster.sourceSnapshot,
    'identity source',
    job,
    effectiveSourceBudget
  );
  requireCanonicalEqual(binding.identityMaster.sourceOriginal, {
    sha256: source.sha256,
    format: source.image.sourceFormat,
    width: source.image.metadata.width,
    height: source.image.metadata.height,
    cropRect: binding.identityMaster.sourceOriginal.cropRect
  }, 'identity source record');
  const providerKeyNormalization = await normalizedProviderSource(
    job,
    { image: source.image, sha256: source.sha256, canonicalPath: source.absolute },
    'identity-master'
  );
  if (providerKeyNormalization) {
    const expectedNormalization = providerKeyNormalizationLedger(
      providerKeyNormalization,
      binding.identityMaster.providerKeyNormalization?.normalizedSnapshot.path
    );
    requireCanonicalEqual(
      binding.identityMaster.providerKeyNormalization,
      expectedNormalization,
      'identity provider-key normalization evidence'
    );
    const persistedNormalized = await readPersistedImage(
      root,
      binding.identityMaster.providerKeyNormalization.normalizedSnapshot,
      'identity provider-key-normalized',
      job
    );
    if (!persistedNormalized.image.buffer.equals(providerKeyNormalization.normalizedPng)) {
      throw new Error('Wave A identity provider-key-normalized PNG is not the byte-identical replay');
    }
  } else if (binding.identityMaster.providerKeyNormalization !== undefined) {
    throw new Error('Wave A legacy identity binding cannot claim provider-key normalization');
  }
  const identityCrop = binding.identityMaster.sourceOriginal.cropRect;
  if (identityCrop.width * job.identityMasterPlan.outputSize.height
    !== identityCrop.height * job.identityMasterPlan.outputSize.width) {
    throw new Error('Wave A identity binding crop must keep the exact 2:1 target aspect ratio');
  }
  const transformedRaw = await canonicalUnitTransform(
    providerKeyNormalization?.image ?? source.image,
    identityCrop,
    job.identityMasterPlan.outputSize,
    canonicalBackgroundRemoval(job)
  );
  if (canonicalBackgroundRemoval(job)) {
    requireCanonicalEqual(
      binding.identityMaster.transformEvidence,
      transformedRaw.transformEvidence,
      'identity transform evidence'
    );
  }
  const transformedPng = await encodeRawPng(
    transformedRaw.data,
    job.identityMasterPlan.outputSize.width,
    job.identityMasterPlan.outputSize.height
  );
  const transformed = await readPersistedImage(
    root,
    binding.identityMaster.transformedSnapshot,
    'identity transformed',
    job
  );
  if (!transformed.image.buffer.equals(transformedPng)) {
    throw new Error('Wave A identity transformed snapshot is not the byte-identical canonical replay');
  }
  const audit = pixelAudit(transformedRaw.data);
  if (audit.visiblePixels === 0 || audit.transparentPixels === 0
    || audit.partialAlphaPixels !== 0 || audit.hiddenRgbPixels !== 0
    || audit.opaqueMagentaPixels !== 0) {
    throw new Error('Wave A identity replay failed alpha/visibility gates');
  }
  const cellHashes = job.identityMasterPlan.directions.map((direction, index) => {
    const cell = rawCell(transformedRaw.data, job.identityMasterPlan.outputSize, {
      x: index * job.identityMasterPlan.cellSize.width,
      y: 0,
      ...job.identityMasterPlan.cellSize
    });
    if (pixelAudit(cell).visiblePixels === 0) throw new Error(`Wave A identity ${direction} cell is empty`);
    return sha256(cell);
  });
  if (new Set(cellHashes).size !== 4) throw new Error('Wave A identity direction cells are not distinct');
  const identity = {
    source: { canonicalPath: source.absolute, image: source.image, sha256: source.sha256 },
    providerKeyNormalization,
    effectiveCrop: structuredClone(binding.identityMaster.sourceOriginal.cropRect),
    raw: transformedRaw.data,
    transformedPng,
    transformedSha256: sha256(transformedPng),
    transformEvidence: transformedRaw.transformEvidence,
    audit,
    cellHashes
  };
  const derivedPaths = identityBindingPaths(root, verified, job, identity);
  if (binding.bindingId !== derivedPaths.bindingId || bindingPath !== derivedPaths.planPath
    || binding.identityMaster.sourceSnapshot.path !== derivedPaths.sourcePath
    || (providerKeyNormalization
      && binding.identityMaster.providerKeyNormalization.normalizedSnapshot.path
        !== derivedPaths.normalizedPath)
    || binding.identityMaster.transformedSnapshot.path !== derivedPaths.transformedPath) {
    throw new Error('Wave A identity binding paths are not canonical content-addressed paths');
  }
  const rebuilt = identityBindingPlan(verified, identity, derivedPaths);
  requireCanonicalEqual(binding, rebuilt.plan, 'identity-bound execution plan');
  for (const unit of rebuilt.units) {
    const promptRead = await readBoundedWithin(root, unit.executionPromptPath);
    if (!promptRead.bytes.equals(Buffer.from(unit.executionPromptText))
      || sha256(promptRead.bytes) !== unit.executionPromptSha256
      || !promptRead.bytes.includes(Buffer.from(derivedPaths.transformedPath))
      || !promptRead.bytes.includes(Buffer.from(identity.transformedSha256))) {
      throw new Error(`Wave A ${unit.unitId} identity-bound execution prompt mismatch`);
    }
  }
  return {
    binding,
    bindingPath,
    bindingSha256: sha256(planRead.bytes),
    identity,
    verifiedPack: verified,
    executionUnits: rebuilt.units
  };
}

export async function verifyPersistedWaveAUnitAssembly(result, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  allowHistoricalTransformVersion = false
} = {}) {
  if (path.resolve(root) !== path.resolve(forgeRoot)) {
    throw new Error('Wave A persisted assembly verification requires one canonical Forge root');
  }
  const resultValidation = validateWith('generation-result.schema.json', result);
  if (!resultValidation.ok) {
    throw new Error(`Invalid persisted Wave A result: ${JSON.stringify(resultValidation.errors)}`);
  }
  if (result.requiredSetId !== 'fable5-v2' || result.waveId !== 'A'
    || result.visualContractVersion !== 2 || result.status !== 'pending'
    || result.provider !== 'manual-import' || !result.manualImport
    || !result.unitAssemblyV2) {
    throw new Error('Persisted result is not an explicit pending Fable5 Wave A unit assembly');
  }
  const assemblyValidation = validateWith('unit-assembly-v2.schema.json', result.unitAssemblyV2);
  if (!assemblyValidation.ok) {
    throw new Error(`Invalid persisted Wave A unit assembly: ${JSON.stringify(assemblyValidation.errors)}`);
  }
  const verifiedPack = await verifyWaveAJobPack(result.sourceJobPackPathV2, {
    root,
    forgeRoot,
    allowHistoricalTransformVersion
  });
  const { asset, job } = verifiedPack;
  const expectedResultAuthority = {
    assetId: job.assetId,
    category: job.category,
    jobId: job.id,
    definitionSha256: job.definitionSha256,
    assetDefinitionSha256: job.assetDefinitionSha256,
    promptHash: job.promptSha256,
    referenceAuthorizationSha256: job.referenceAuthorizationSha256,
    referenceImageIds: job.referenceImages.map(({ id }) => id),
    referenceImageHashes: job.referenceImages.map(({ sha256: digest }) => digest)
  };
  requireCanonicalEqual(Object.fromEntries(Object.keys(expectedResultAuthority).map((key) => [key, result[key]])), expectedResultAuthority, 'persisted result authority');

  const sourceCache = new Map();
  const sourceBudget = createUniqueSourceBudget(job);
  const transformedCache = new Map();
  const sourceRecords = [];
  const unitRecords = [];
  const pendingRoot = `generated/${categoryDirectory(asset.category)}/pending`;
  const composedTerrain = job.generationMode === 'terrain-composed-atlas';
  if (result.unitAssemblyV2.units.length !== job.generationUnits.length) {
    throw new Error('Persisted unit ledger length does not match the canonical job');
  }
  let replayedTerrain = null;
  if (composedTerrain) {
    const evidence = result.unitAssemblyV2.terrainComposition;
    if (!evidence) throw new Error('Persisted terrain composition evidence is missing');
    const plan = terrainCompositionPlanFor(job.assetDefinition);
    requireCanonicalEqual(job.terrainCompositionPlan, plan, 'persisted terrain composition job plan');
    requireCanonicalEqual(
      Object.fromEntries([
        'originKind', 'composerVersion', 'algorithm', 'configSha256', 'maskSetSha256', 'seamBand'
      ].map((key) => [key, evidence[key]])),
      {
        originKind: plan.originKind,
        composerVersion: plan.composerVersion,
        algorithm: plan.algorithm,
        configSha256: plan.configSha256,
        maskSetSha256: plan.maskSetSha256,
        seamBand: plan.seamBand
      },
      'persisted terrain composition authority'
    );
    const inputs = [];
    for (const input of evidence.inputs) {
      if (!input.sourceSnapshot.path.startsWith(`${pendingRoot}/sources/`)) {
        throw new Error(`Terrain composition ${input.role} provider-original path is not pending evidence`);
      }
      let source = sourceCache.get(input.sourceSnapshot.path);
      if (!source) {
        source = await readPersistedImage(
          root,
          input.sourceSnapshot,
          `${input.role} provider-original`,
          job,
          sourceBudget
        );
        sourceCache.set(input.sourceSnapshot.path, source);
      }
      requireCanonicalEqual(input.sourceOriginal, {
        sha256: source.sha256,
        format: source.image.sourceFormat,
        width: source.image.metadata.width,
        height: source.image.metadata.height,
        cropRect: input.sourceOriginal.cropRect
      }, `${input.role} provider-original record`);
      requireCanonicalEqual(input.sourceSnapshot, {
        path: input.sourceSnapshot.path,
        sha256: source.sha256,
        format: source.image.sourceFormat,
        width: source.image.metadata.width,
        height: source.image.metadata.height
      }, `${input.role} provider-original snapshot`);
      inputs.push({
        role: input.role,
        requestedPath: source.absolute,
        cropRect: structuredClone(input.sourceOriginal.cropRect),
        source: {
          canonicalPath: source.absolute,
          image: source.image,
          sha256: source.sha256
        }
      });
    }
    replayedTerrain = await assembleComposedTerrain(job, inputs);
  } else {
    for (const [index, unit] of job.generationUnits.entries()) {
      if (!unit.sourceRequired) continue;
      const ledger = result.unitAssemblyV2.units[index];
      if (!ledger?.sourceSnapshot
        || !ledger.sourceSnapshot.path.startsWith(`${pendingRoot}/sources/`)) {
        throw new Error(`Wave A ${unit.unitId} source snapshot path is not pending evidence`);
      }
      if (!sourceCache.has(ledger.sourceSnapshot.path)) {
        sourceCache.set(ledger.sourceSnapshot.path, await readPersistedImage(
          root,
          ledger.sourceSnapshot,
          `${unit.unitId} source-original`,
          job,
          sourceBudget
        ));
      }
    }
  }

  let identityAuthority = null;
  if (job.category === 'character') {
    if (!result.unitAssemblyV2.identityMaster) {
      throw new Error('Persisted character assembly omits its issued identity binding');
    }
    identityAuthority = await verifyWaveAIdentityBinding(
      result.unitAssemblyV2.identityMaster.unitExecutionPlanPath,
      {
        root,
        forgeRoot,
        verifiedPack,
        sourceBudget
      }
    );
    if (identityAuthority.bindingSha256
      !== result.unitAssemblyV2.identityMaster.unitExecutionPlanSha256
      || identityAuthority.binding.jobPackPath !== result.sourceJobPackPathV2) {
      throw new Error('Persisted character assembly identity binding hash/job mismatch');
    }
  } else if (result.unitAssemblyV2.identityMaster !== null) {
    throw new Error('Persisted non-character assembly contains identity evidence');
  }

  let replayedProviderKeyNormalization = null;
  if (providerKeyNormalizationPlan(job)) {
    const evidence = result.unitAssemblyV2.providerKeyNormalization;
    if (!evidence || !evidence.normalizedSnapshot.path.startsWith(`${pendingRoot}/sources/`)
      || sourceCache.size !== 1) {
      throw new Error('Persisted provider-key normalization evidence is missing or noncanonical');
    }
    const source = [...sourceCache.values()][0];
    replayedProviderKeyNormalization = await normalizedProviderSource(
      job,
      { image: source.image, sha256: source.sha256, canonicalPath: source.absolute },
      providerKeyNormalizationSourceKindForJob(job)
    );
    requireCanonicalEqual(
      evidence,
      providerKeyNormalizationLedger(
        replayedProviderKeyNormalization,
        evidence.normalizedSnapshot.path
      ),
      'persisted monolithic atlas provider-key normalization evidence'
    );
    const persistedNormalized = await readPersistedImage(
      root,
      evidence.normalizedSnapshot,
      'provider-key-normalized',
      job
    );
    if (!persistedNormalized.image.buffer.equals(
      replayedProviderKeyNormalization.normalizedPng
    )) {
      throw new Error('Persisted provider-key-normalized PNG differs from replay');
    }
  } else if (result.unitAssemblyV2.providerKeyNormalization !== undefined) {
    throw new Error('Persisted legacy assembly cannot claim provider-key normalization');
  }

  const executionById = new Map((identityAuthority?.executionUnits ?? []).map((unit) => [unit.unitId, unit]));
  for (const [index, unit] of job.generationUnits.entries()) {
    const ledger = result.unitAssemblyV2.units[index];
    const execution = executionById.get(unit.unitId) ?? null;
    const expectedPromptSha256 = execution?.executionPromptSha256 ?? unit.unitPromptSha256;
    const expectedCore = {
      unitId: unit.unitId,
      artifactRole: unit.artifactRole,
      frameId: unit.frameId,
      ...(unit.direction ? { direction: unit.direction } : {}),
      semanticRole: unit.semanticRole,
      targetRect: unit.targetRect,
      expectation: unit.expectation,
      sourceRequired: unit.sourceRequired,
      unitPromptSha256: expectedPromptSha256,
      inputReferences: unit.inputReferences,
      consistencyPlanId: unit.consistencyPlanId ?? null,
      consistencyInputSha256: identityAuthority?.identity.transformedSha256 ?? null
    };
    requireCanonicalEqual(Object.fromEntries(Object.keys(expectedCore).map((key) => [key, ledger[key]])), expectedCore, `${unit.unitId} canonical binding`);
    const effectiveUnit = { ...unit, effectiveUnitPromptSha256: expectedPromptSha256 };
    if (composedTerrain) {
      const replayRecord = replayedTerrain.unitRecords[index];
      if (ledger.sourceOriginal !== null || ledger.sourceSnapshot !== null
        || (unit.sourceRequired
          ? (!ledger.transformedSnapshot
            || !ledger.transformedSnapshot.path.startsWith(`${pendingRoot}/unit-cells/`)
            || canonicalJson(ledger.transformSteps) !== canonicalJson([TERRAIN_COMPOSER_UNIT_STEP]))
          : (ledger.transformedSnapshot !== null || ledger.transformSteps.length !== 0))) {
        throw new Error(`Wave A ${unit.unitId} deterministic-derived source claims are invalid`);
      }
      if (unit.sourceRequired) {
        const transformedPng = await encodeRawPng(
          replayRecord.raw,
          unit.targetRect.width,
          unit.targetRect.height
        );
        const persistedTransform = await readPersistedImage(
          root,
          ledger.transformedSnapshot,
          `${unit.unitId} deterministic-derived`,
          job
        );
        if (!persistedTransform.image.buffer.equals(transformedPng)) {
          throw new Error(`Wave A ${unit.unitId} deterministic-derived snapshot differs from raw replay`);
        }
      }
      if (ledger.outputCellSha256 !== sha256(replayRecord.raw)) {
        throw new Error(`Wave A ${unit.unitId} deterministic-derived cell hash mismatch`);
      }
      requireCanonicalEqual(ledger.pixelAudit, replayRecord.audit, `${unit.unitId} derived pixel audit`);
      requireCanonicalEqual(
        result.unitAssemblyV2.terrainComposition.unitDerivations[index],
        replayRecord.derivation,
        `${unit.unitId} terrain derivation`
      );
      unitRecords.push({ ...replayRecord, unit: effectiveUnit });
      continue;
    }
    if (!unit.sourceRequired) {
      if (ledger.sourceOriginal !== null || ledger.sourceSnapshot !== null
        || ledger.transformedSnapshot !== null || ledger.transformSteps.length !== 0) {
        throw new Error(`Wave A ${unit.unitId} transparent cell falsely claims source evidence`);
      }
      const raw = Buffer.alloc(unit.targetRect.width * unit.targetRect.height * 4);
      const audit = pixelAudit(raw);
      requireZeroTransparentUnit(unit, raw, audit);
      if (ledger.outputCellSha256 !== sha256(raw)) {
        throw new Error(`Wave A ${unit.unitId} zero-cell hash mismatch`);
      }
      requireCanonicalEqual(ledger.pixelAudit, audit, `${unit.unitId} zero-cell audit`);
      unitRecords.push({ unit: effectiveUnit, sourceRecord: null, raw, audit });
      continue;
    }
    if (!ledger.sourceOriginal || !ledger.sourceSnapshot || !ledger.transformedSnapshot
      || !ledger.sourceSnapshot.path.startsWith(`${pendingRoot}/sources/`)
      || !ledger.transformedSnapshot.path.startsWith(`${pendingRoot}/unit-cells/`)) {
      throw new Error(`Wave A ${unit.unitId} source/transformed snapshot path is not pending evidence`);
    }
    const source = sourceCache.get(ledger.sourceSnapshot.path);
    requireCanonicalEqual(ledger.sourceSnapshot, {
      path: ledger.sourceSnapshot.path,
      sha256: source.sha256,
      format: source.image.sourceFormat,
      width: source.image.metadata.width,
      height: source.image.metadata.height
    }, `${unit.unitId} shared source snapshot`);
    requireCanonicalEqual(ledger.sourceOriginal, {
      sha256: source.sha256,
      format: source.image.sourceFormat,
      width: source.image.metadata.width,
      height: source.image.metadata.height,
      cropRect: ledger.sourceOriginal.cropRect
    }, `${unit.unitId} source record`);
    const crop = ledger.sourceOriginal.cropRect;
    if (!validRect(crop)
      || crop.width * unit.targetRect.height !== crop.height * unit.targetRect.width) {
      throw new Error(`Wave A ${unit.unitId} persisted crop has the wrong target aspect ratio`);
    }
    const transformed = await canonicalUnitTransform(
      replayedProviderKeyNormalization?.image ?? source.image,
      crop,
      {
      width: unit.targetRect.width,
      height: unit.targetRect.height
      },
      canonicalBackgroundRemoval(job)
    );
    if (canonicalBackgroundRemoval(job)) {
      requireCanonicalEqual(
        ledger.transformEvidence,
        transformed.transformEvidence,
        `${unit.unitId} transform evidence`
      );
    }
    const transformedPng = await encodeRawPng(
      transformed.data,
      unit.targetRect.width,
      unit.targetRect.height
    );
    let persistedTransform = transformedCache.get(ledger.transformedSnapshot.path);
    if (!persistedTransform) {
      persistedTransform = await readPersistedImage(
        root,
        ledger.transformedSnapshot,
        `${unit.unitId} transformed`,
        job
      );
      transformedCache.set(ledger.transformedSnapshot.path, persistedTransform);
    }
    if (!persistedTransform.image.buffer.equals(transformedPng)) {
      throw new Error(`Wave A ${unit.unitId} transformed snapshot is not the byte-identical canonical replay`);
    }
    requireCanonicalEqual(
      ledger.transformSteps,
      [...transformStepsFor(job)],
      `${unit.unitId} transform steps`
    );
    const audit = pixelAudit(transformed.data);
    requireCleanNonemptyUnit(unit, audit);
    if (ledger.outputCellSha256 !== sha256(transformed.data)) {
      throw new Error(`Wave A ${unit.unitId} output cell hash mismatch`);
    }
    requireCanonicalEqual(ledger.pixelAudit, audit, `${unit.unitId} pixel audit`);
    const sourceRecord = {
      source: {
        canonicalPath: source.absolute,
        image: source.image,
        sha256: source.sha256
      },
      effectiveCrop: structuredClone(crop),
      transformEvidence: transformed.transformEvidence
    };
    sourceRecords.push({ unit: effectiveUnit, source: sourceRecord.source, input: { cropRect: crop } });
    unitRecords.push({ unit: effectiveUnit, sourceRecord, raw: transformed.data, audit });
  }

  if (!composedTerrain) {
    validateSourceSharing(job, sourceRecords, identityAuthority?.identity ?? null);
  }
  const nonemptyHashes = unitRecords.filter(({ unit }) => unit.sourceRequired).map(({ raw }) => sha256(raw));
  if (new Set(nonemptyHashes).size !== nonemptyHashes.length) {
    throw new Error('Persisted expected-nonempty unit cells are byte-identical');
  }
  const rawByRole = new Map(job.artifactContracts.map((contract) => [
    contract.role,
    Buffer.alloc(contract.outputSize.width * contract.outputSize.height * 4)
  ]));
  for (const record of unitRecords) {
    const contract = job.artifactContracts.find(({ role }) => role === record.unit.artifactRole);
    copyCell(rawByRole.get(record.unit.artifactRole), contract.outputSize, record.unit.targetRect, record.raw);
  }
  const artifactRecords = [];
  for (const contract of job.artifactContracts) {
    const raw = rawByRole.get(contract.role);
    artifactRecords.push({
      contract,
      raw,
      png: await encodeRawPng(raw, contract.outputSize.width, contract.outputSize.height)
    });
  }
  const assembled = {
    identity: identityAuthority?.identity ?? null,
    unitRecords,
    artifactRecords,
    ...(replayedProviderKeyNormalization ? {
      providerKeyNormalization: replayedProviderKeyNormalization
    } : {}),
    ...(replayedTerrain ? { terrainComposition: replayedTerrain.terrainComposition } : {})
  };
  await replayAssembly(job, assembled);
  finalCellAudit(job, assembled);
  const auditedArtifacts = await auditArtifacts(asset, assembled);
  assembled.artifactRecords = auditedArtifacts;
  const { provenanceKey } = importProvenance(job, assembled);
  const generationId = `gen_v2_import_${provenanceKey.slice(0, 20)}`;
  if (result.provenanceKey !== provenanceKey || result.id !== generationId) {
    throw new Error('Persisted Wave A provenanceKey/generationId is not canonical');
  }
  const stem = `${assetFileStem(asset.id)}-${provenanceKey.slice(0, 16)}`;
  const outputRoot = path.join(root, 'generated', categoryDirectory(asset.category), 'pending');
  const monolithicSourcePath = job.generationMode === 'monolithic-atlas'
    ? path.join(
        outputRoot,
        'sources',
        `${stem}-monolithic-atlas.source-original.${sourceFormatExtension(sourceRecords[0].source.image.sourceFormat)}`
      )
    : null;
  const directionStripSourcePaths = job.generationMode === CHARACTER_DIRECTION_STRIP_MODE
    ? new Map(CHARACTER_DIRECTION_STRIP_DIRECTIONS.map((direction) => {
        const record = sourceRecords.find(({ unit }) => unit.direction === direction);
        return [direction, path.join(
          outputRoot,
          'sources',
          `${stem}-direction-strip-${direction}.source-original.${sourceFormatExtension(record.source.image.sourceFormat)}`
        )];
      }))
    : new Map();
  const providerNormalizedPath = replayedProviderKeyNormalization
    ? providerKeyNormalizedSnapshotPath(job, outputRoot, stem)
    : null;
  const compositionInputPersistence = composedTerrain
    ? terrainInputPersistence(root, outputRoot, stem, assembled.terrainComposition)
    : [];
  const expectedUnits = await Promise.all(unitRecords.map(async (record) => {
    const sourcePath = record.sourceRecord
      ? (monolithicSourcePath ?? directionStripSourcePaths.get(record.unit.direction) ?? path.join(
          outputRoot,
          'sources',
          `${stem}-${record.unit.unitId}.source-original.${sourceFormatExtension(record.sourceRecord.source.image.sourceFormat)}`
        ))
      : null;
    const transformedPath = (record.sourceRecord || (composedTerrain && record.unit.sourceRequired))
      ? path.join(outputRoot, 'unit-cells', `${stem}-${record.unit.unitId}.png`)
      : null;
    return {
      unitId: record.unit.unitId,
      artifactRole: record.unit.artifactRole,
      frameId: record.unit.frameId,
      ...(record.unit.direction ? { direction: record.unit.direction } : {}),
      semanticRole: record.unit.semanticRole,
      targetRect: structuredClone(record.unit.targetRect),
      expectation: record.unit.expectation,
      sourceRequired: record.unit.sourceRequired,
      unitPromptSha256: record.unit.effectiveUnitPromptSha256 ?? record.unit.unitPromptSha256,
      inputReferences: structuredClone(record.unit.inputReferences),
      consistencyPlanId: record.unit.consistencyPlanId ?? null,
      consistencyInputSha256: identityAuthority?.identity.transformedSha256 ?? null,
      sourceOriginal: record.sourceRecord ? {
        sha256: record.sourceRecord.source.sha256,
        format: record.sourceRecord.source.image.sourceFormat,
        width: record.sourceRecord.source.image.metadata.width,
        height: record.sourceRecord.source.image.metadata.height,
        cropRect: structuredClone(record.sourceRecord.effectiveCrop)
      } : null,
      sourceSnapshot: record.sourceRecord ? {
        path: toPosixRelative(root, sourcePath),
        sha256: record.sourceRecord.source.sha256,
        format: record.sourceRecord.source.image.sourceFormat,
        width: record.sourceRecord.source.image.metadata.width,
        height: record.sourceRecord.source.image.metadata.height
      } : null,
      transformedSnapshot: transformedPath ? {
        path: toPosixRelative(root, transformedPath),
        sha256: sha256(await encodeRawPng(
          record.raw,
          record.unit.targetRect.width,
          record.unit.targetRect.height
        )),
        format: 'png',
        width: record.unit.targetRect.width,
        height: record.unit.targetRect.height
      } : null,
      transformSteps: composedTerrain
        ? (record.unit.sourceRequired ? [TERRAIN_COMPOSER_UNIT_STEP] : [])
        : (record.sourceRecord ? [...transformStepsFor(job)] : []),
      ...(canonicalBackgroundRemoval(job) ? {
        transformEvidence: record.sourceRecord
          ? structuredClone(record.sourceRecord.transformEvidence)
          : null
      } : {}),
      outputCellSha256: sha256(record.raw),
      pixelAudit: record.audit
    };
  }));
  const resultArtifacts = asset.category === 'building'
    ? result.outputArtifacts
    : [{
        role: 'primary',
        path: result.outputPath,
        sha256: result.outputSha256,
        inspection: result.outputInspection
      }];
  const expectedArtifactLedger = [];
  const recipeRecords = [];
  const expectedOutputRecords = [];
  for (const [index, artifact] of auditedArtifacts.entries()) {
    const suffix = artifact.contract.role === 'primary' ? '' : `-${artifact.contract.role}`;
    const outputPath = toPosixRelative(root, path.join(outputRoot, `${stem}${suffix}.png`));
    const assemblySourcePath = toPosixRelative(root, path.join(
      outputRoot,
      'sources',
      composedTerrain
        ? `${stem}-${artifact.contract.role}.derived-composition.png`
        : `${stem}-${artifact.contract.role}.source-original.png`
    ));
    const persisted = resultArtifacts[index];
    const expectedInspection = inspectPng(artifact.png);
    requireCanonicalEqual(persisted, {
      role: artifact.contract.role,
      path: outputPath,
      sha256: sha256(artifact.png),
      inspection: expectedInspection
    }, `${artifact.contract.role} result artifact`);
    const persistedArtifact = await readPersistedImage(root, {
      path: outputPath,
      sha256: sha256(artifact.png),
      format: 'png',
      width: artifact.contract.outputSize.width,
      height: artifact.contract.outputSize.height
    }, `${artifact.contract.role} final artifact`, job);
    if (!persistedArtifact.image.buffer.equals(artifact.png)) {
      throw new Error(`Wave A ${artifact.contract.role} final atlas is not byte-identical reconstruction`);
    }
    const assemblySource = await readPersistedImage(root, {
      path: assemblySourcePath,
      sha256: sha256(artifact.png),
      format: 'png',
      width: artifact.contract.outputSize.width,
      height: artifact.contract.outputSize.height
    }, `${artifact.contract.role} assembly source`, job);
    if (!assemblySource.image.buffer.equals(artifact.png)) {
      throw new Error(`Wave A ${artifact.contract.role} assembly-source compatibility snapshot differs`);
    }
    expectedArtifactLedger.push({
      role: artifact.contract.role,
      path: outputPath,
      sha256: sha256(artifact.png),
      width: artifact.contract.outputSize.width,
      height: artifact.contract.outputSize.height,
      unitIds: job.generationUnits
        .filter(({ artifactRole }) => artifactRole === artifact.contract.role)
        .map(({ unitId }) => unitId)
    });
    recipeRecords.push({
      contract: artifact.contract,
      assemblySourcePath,
      outputPath,
      outputSha256: sha256(artifact.png)
    });
    expectedOutputRecords.push({
      ...artifact,
      outputPath,
      outputSha256: sha256(artifact.png),
      outputInspection: expectedInspection
    });
  }
  const expectedRecipes = recipeRecords.map((record) => assemblyRecipe(
    record,
    job,
    verifiedPack.pack.members.prompt.path,
    assembled.terrainComposition ?? null
  ));
  requireCanonicalEqual(result.productionRecipesV2, expectedRecipes, 'production recipes');
  const expectedIdentityLedger = identityAuthority ? {
    planId: job.identityMasterPlan.planId,
    promptSha256: job.identityMasterPlan.promptSha256,
    inputReferences: structuredClone(job.identityMasterPlan.inputReferences),
    sourceOriginal: structuredClone(identityAuthority.binding.identityMaster.sourceOriginal),
    sourceSnapshot: structuredClone(identityAuthority.binding.identityMaster.sourceSnapshot),
    ...(identityAuthority.binding.identityMaster.providerKeyNormalization ? {
      providerKeyNormalization: structuredClone(
        identityAuthority.binding.identityMaster.providerKeyNormalization
      )
    } : {}),
    transformedSnapshot: structuredClone(identityAuthority.binding.identityMaster.transformedSnapshot),
    transformSteps: [...transformStepsFor(job)],
    ...(canonicalBackgroundRemoval(job) ? {
      transformEvidence: structuredClone(identityAuthority.identity.transformEvidence)
    } : {}),
    consistencyInputSha256: identityAuthority.identity.transformedSha256,
    directionCellSha256s: identityAuthority.identity.cellHashes,
    auxiliary: true,
    semanticCell: false,
    approvedAsset: false,
    unitExecutionPlanPath: identityAuthority.bindingPath,
    unitExecutionPlanSha256: identityAuthority.bindingSha256,
    issuanceSequence: identityAuthority.binding.issuanceSequence,
    providerInvocationEvidence: identityAuthority.binding.providerInvocationEvidence
  } : null;
  const expectedAssembly = {
    jobId: job.id,
    jobProvenanceKey: job.provenanceKey,
    definitionSha256: job.definitionSha256,
    promptSha256: job.promptSha256,
    referenceAuthorizationSha256: job.referenceAuthorizationSha256,
    referenceImageHashes: job.referenceImages.map(({ sha256: digest }) => digest),
    identityMasterPlanSha256: job.identityMasterPlan
      ? sha256(canonicalJson(job.identityMasterPlan))
      : null,
    assemblyAlgorithm: assemblyAlgorithmFor(job),
    ...(job.technicalGates.inputPolicy.sourceLimits ? {
      sourceLimits: structuredClone(job.technicalGates.inputPolicy.sourceLimits)
    } : {}),
    generationMode: job.generationMode,
    generationUnitSetSha256: job.generationUnitSetSha256,
    expectations: structuredClone(job.generationExpectations),
    sourceRequiredCount: job.generationUnits.filter(({ sourceRequired }) => sourceRequired).length,
    identityMaster: expectedIdentityLedger,
    ...(replayedProviderKeyNormalization ? {
      providerKeyNormalization: providerKeyNormalizationLedger(
        replayedProviderKeyNormalization,
        toPosixRelative(root, providerNormalizedPath)
      )
    } : {}),
    ...(composedTerrain ? {
      terrainComposition: terrainCompositionLedger(
        assembled.terrainComposition,
        compositionInputPersistence,
        expectedOutputRecords
      )
    } : {}),
    units: expectedUnits,
    artifacts: expectedArtifactLedger,
    missingUnitIds: [],
    duplicateUnitIds: [],
    extraUnitIds: [],
    replayPassed: true,
    finalCellAuditPassed: true
  };
  requireCanonicalEqual(result.unitAssemblyV2, expectedAssembly, 'complete persisted unit assembly ledger');
  if (asset.category === 'building') {
    const expectedBundle = {
      visualContractVersion: 2,
      atomicPair: true,
      roles: ['base', 'roof'],
      artifacts: auditedArtifacts.map(({ contract, technical }) => ({
        role: contract.role,
        technicalInspection: technical.technicalInspection
      })),
      passed: true
    };
    requireCanonicalEqual(result.bundleTechnicalInspection, expectedBundle, 'building technical inspection');
  } else {
    requireCanonicalEqual(result.technicalInspection, auditedArtifacts[0].technical.technicalInspection, 'technical inspection');
  }
  const expectedMetadataPath = toPosixRelative(root, path.join(outputRoot, `${stem}.json`));
  const canonicalJobPackPath = verifiedPack.pack.members.job.path.replace(/\/job\.json$/, '/job-pack.json');
  const expectedResult = pendingUnitAssemblyResult({
    asset,
    job,
    jobPackPath: canonicalJobPackPath,
    provenanceKey,
    generationId,
    metadataPath: expectedMetadataPath,
    recipes: expectedRecipes,
    unitAssemblyV2: expectedAssembly,
    outputRecords: expectedOutputRecords,
    sourceRequiredCount: job.generationUnits.filter(({ sourceRequired }) => sourceRequired).length,
    createdAt: result.createdAt
  });
  requireCanonicalEqual(result, expectedResult, 'complete pending result and truth labels');
  const metadataRead = await readBoundedWithin(root, expectedMetadataPath);
  if (!metadataRead.bytes.equals(Buffer.from(canonicalJson(result)))) {
    throw new Error('Persisted Wave A metadata bytes differ from the generation ledger result');
  }
  return {
    asset,
    job,
    result,
    identityAuthority,
    artifactRoles: auditedArtifacts.map(({ contract }) => contract.role),
    provenanceKey,
    generationId
  };
}

async function assembleUnits(job, unitSources, boundIdentity, cache, sourceBudget) {
  const sourceById = new Map(unitSources.map((source) => [source.unitId, source]));
  const identity = boundIdentity;
  if (job.identityMasterPlan && !identity) {
    throw new Error('Wave A character units require a previously issued identity binding');
  }
  if (!job.identityMasterPlan && identity) {
    throw new Error('Non-character Wave A jobs forbid identity binding evidence');
  }
  const sourceRecords = [];
  let providerKeyNormalization = null;
  for (const unit of job.generationUnits.filter(({ sourceRequired }) => sourceRequired)) {
    const input = sourceById.get(unit.unitId);
    const source = await cachedExternalSource(
      input.sourceOriginal,
      cache,
      job,
      sourceBudget
    );
    const targetSize = {
      width: unit.targetRect.width,
      height: unit.targetRect.height
    };
    const effectiveCrop = input.cropRect ?? {
      x: 0,
      y: 0,
      width: source.image.metadata.width,
      height: source.image.metadata.height
    };
    if (effectiveCrop.width * targetSize.height !== effectiveCrop.height * targetSize.width) {
      throw new Error(`Wave A ${unit.unitId} source/crop aspect ratio does not match targetRect`);
    }
    if (providerKeyNormalizationPlan(job) && !providerKeyNormalization) {
      providerKeyNormalization = await normalizedProviderSource(
        job,
        source,
        providerKeyNormalizationSourceKindForJob(job)
      );
    }
    const transformed = await canonicalUnitTransform(
      providerKeyNormalization?.image ?? source.image,
      effectiveCrop,
      targetSize,
      canonicalBackgroundRemoval(job)
    );
    const audit = pixelAudit(transformed.data);
    requireCleanNonemptyUnit(unit, audit);
    sourceRecords.push({
      unit,
      input,
      effectiveCrop,
      source,
      raw: transformed.data,
      transformEvidence: transformed.transformEvidence,
      audit
    });
  }
  validateSourceSharing(job, sourceRecords, identity);
  if (providerKeyNormalization && identity) {
    const identityHashes = new Set([
      identity.source.sha256,
      identity.transformedSha256,
      identity.providerKeyNormalization?.evidence.normalized.sha256
    ].filter(Boolean));
    if (identityHashes.has(sourceRecords[0].source.sha256)
      || identityHashes.has(providerKeyNormalization.evidence.normalized.sha256)) {
      throw new Error('Wave A identity and monolithic atlas normalization evidence must not alias');
    }
  }
  const nonemptyHashes = sourceRecords.map(({ raw }) => sha256(raw));
  if (new Set(nonemptyHashes).size !== nonemptyHashes.length) {
    throw new Error('Wave A expected-nonempty generation units must not be byte-identical');
  }
  const sourceRecordById = new Map(sourceRecords.map((record) => [record.unit.unitId, record]));
  const rawByRole = new Map(job.artifactContracts.map((contract) => [
    contract.role,
    Buffer.alloc(contract.outputSize.width * contract.outputSize.height * 4)
  ]));
  const unitRecords = [];
  for (const unit of job.generationUnits) {
    const sourceRecord = sourceRecordById.get(unit.unitId) ?? null;
    const raw = sourceRecord?.raw ?? Buffer.alloc(unit.targetRect.width * unit.targetRect.height * 4);
    const audit = pixelAudit(raw);
    if (unit.sourceRequired) requireCleanNonemptyUnit(unit, audit);
    else requireZeroTransparentUnit(unit, raw, audit);
    const contract = job.artifactContracts.find(({ role }) => role === unit.artifactRole);
    copyCell(rawByRole.get(unit.artifactRole), contract.outputSize, unit.targetRect, raw);
    unitRecords.push({ unit, sourceRecord, raw, audit });
  }
  const artifactRecords = [];
  for (const contract of job.artifactContracts) {
    const raw = rawByRole.get(contract.role);
    artifactRecords.push({
      contract,
      raw,
      png: await encodeRawPng(raw, contract.outputSize.width, contract.outputSize.height)
    });
  }
  return {
    identity,
    unitRecords,
    artifactRecords,
    ...(providerKeyNormalization ? { providerKeyNormalization } : {})
  };
}

async function assembleComposedTerrain(job, inputs) {
  const composition = await composeTerrainAtlas(job, inputs);
  const unitRecords = composition.unitRecords.map((record) => {
    const audit = pixelAudit(record.raw);
    if (record.unit.sourceRequired) requireCleanNonemptyUnit(record.unit, audit);
    else requireZeroTransparentUnit(record.unit, record.raw, audit);
    return {
      unit: record.unit,
      sourceRecord: null,
      raw: record.raw,
      audit,
      derivation: record.derivation
    };
  });
  const contract = job.artifactContracts[0];
  if (job.artifactContracts.length !== 1 || contract.role !== 'primary'
    || contract.outputSize.width !== 320 || contract.outputSize.height !== 320) {
    throw new Error('Terrain composition requires one canonical 320x320 primary artifact');
  }
  return {
    identity: null,
    unitRecords,
    artifactRecords: [{
      contract,
      raw: composition.atlasRaw,
      png: await encodeRawPng(
        composition.atlasRaw,
        contract.outputSize.width,
        contract.outputSize.height
      )
    }],
    terrainComposition: composition
  };
}

async function replayAssembly(job, assembled) {
  if (assembled.terrainComposition) {
    const replay = await assembleComposedTerrain(job, assembled.terrainComposition.inputs);
    if (canonicalJson(replay.terrainComposition.descriptor)
        !== canonicalJson(assembled.terrainComposition.descriptor)
      || replay.terrainComposition.inputSetSha256
        !== assembled.terrainComposition.inputSetSha256
      || replay.terrainComposition.unitDerivationSetSha256
        !== assembled.terrainComposition.unitDerivationSetSha256
      || replay.terrainComposition.atlasRawSha256
        !== assembled.terrainComposition.atlasRawSha256
      || replay.terrainComposition.derivationSha256
        !== assembled.terrainComposition.derivationSha256
      || replay.unitRecords.some((record, index) =>
        !record.raw.equals(assembled.unitRecords[index].raw)
        || canonicalJson(record.derivation)
          !== canonicalJson(assembled.unitRecords[index].derivation))
      || !replay.artifactRecords[0].png.equals(assembled.artifactRecords[0].png)) {
      throw new Error('Wave A terrain composition replay is not byte-identical');
    }
    return;
  }
  if (assembled.identity) {
    const replayIdentityNormalization = await normalizedProviderSource(
      job,
      assembled.identity.source,
      'identity-master'
    );
    if (Boolean(replayIdentityNormalization) !== Boolean(assembled.identity.providerKeyNormalization)
      || (replayIdentityNormalization
        && (!replayIdentityNormalization.normalizedPng.equals(
          assembled.identity.providerKeyNormalization.normalizedPng
        )
        || canonicalJson(replayIdentityNormalization.evidence)
          !== canonicalJson(assembled.identity.providerKeyNormalization.evidence)))) {
      throw new Error('Wave A identity provider-key normalization replay differs');
    }
    const replayIdentity = await canonicalUnitTransform(
      replayIdentityNormalization?.image ?? assembled.identity.source.image,
      assembled.identity.effectiveCrop,
      job.identityMasterPlan.outputSize,
      canonicalBackgroundRemoval(job)
    );
    const replayIdentityPng = await encodeRawPng(
      replayIdentity.data,
      job.identityMasterPlan.outputSize.width,
      job.identityMasterPlan.outputSize.height
    );
    if (!replayIdentity.data.equals(assembled.identity.raw)
      || !replayIdentityPng.equals(assembled.identity.transformedPng)) {
      throw new Error('Wave A identity master replay differs from the canonical consistency input');
    }
    if (canonicalBackgroundRemoval(job)) {
      requireCanonicalEqual(
        replayIdentity.transformEvidence,
        assembled.identity.transformEvidence,
        'identity replay transform evidence'
      );
    }
  }
  const replayByRole = new Map(job.artifactContracts.map((contract) => [
    contract.role,
    Buffer.alloc(contract.outputSize.width * contract.outputSize.height * 4)
  ]));
  let replayProviderKeyNormalization = null;
  const firstSourceRecord = assembled.unitRecords.find(({ sourceRecord }) => sourceRecord)?.sourceRecord;
  if (providerKeyNormalizationPlan(job)) {
    replayProviderKeyNormalization = await normalizedProviderSource(
      job,
      firstSourceRecord.source,
      providerKeyNormalizationSourceKindForJob(job)
    );
    if (!assembled.providerKeyNormalization
      || !replayProviderKeyNormalization.normalizedPng.equals(
        assembled.providerKeyNormalization.normalizedPng
      )
      || canonicalJson(replayProviderKeyNormalization.evidence)
        !== canonicalJson(assembled.providerKeyNormalization.evidence)) {
      throw new Error('Wave A monolithic atlas provider-key normalization replay differs');
    }
  } else if (assembled.providerKeyNormalization) {
    throw new Error('Wave A legacy assembly cannot claim provider-key normalization');
  }
  for (const record of assembled.unitRecords) {
    const { unit, sourceRecord } = record;
    const replay = sourceRecord
      ? await canonicalUnitTransform(
          replayProviderKeyNormalization?.image ?? sourceRecord.source.image,
          sourceRecord.effectiveCrop,
          { width: unit.targetRect.width, height: unit.targetRect.height },
          canonicalBackgroundRemoval(job)
        )
      : { data: Buffer.alloc(unit.targetRect.width * unit.targetRect.height * 4) };
    if (!replay.data.equals(record.raw)) {
      throw new Error(`Wave A replay differs for ${unit.unitId}`);
    }
    if (sourceRecord && canonicalBackgroundRemoval(job)) {
      requireCanonicalEqual(
        replay.transformEvidence,
        sourceRecord.transformEvidence,
        `${unit.unitId} replay transform evidence`
      );
    }
    const contract = job.artifactContracts.find(({ role }) => role === unit.artifactRole);
    copyCell(replayByRole.get(unit.artifactRole), contract.outputSize, unit.targetRect, replay.data);
  }
  for (const artifact of assembled.artifactRecords) {
    const replayRaw = replayByRole.get(artifact.contract.role);
    const replayPng = await encodeRawPng(
      replayRaw,
      artifact.contract.outputSize.width,
      artifact.contract.outputSize.height
    );
    if (!replayRaw.equals(artifact.raw) || !replayPng.equals(artifact.png)) {
      throw new Error(`Wave A assembly replay differs for ${artifact.contract.role}`);
    }
  }
}

function finalCellAudit(job, assembled) {
  const artifactByRole = new Map(assembled.artifactRecords.map((record) => [record.contract.role, record]));
  for (const record of assembled.unitRecords) {
    const artifact = artifactByRole.get(record.unit.artifactRole);
    const cell = rawCell(artifact.raw, artifact.contract.outputSize, record.unit.targetRect);
    if (!cell.equals(record.raw)) throw new Error(`Wave A final cell audit differs for ${record.unit.unitId}`);
    const audit = pixelAudit(cell);
    if (record.unit.sourceRequired) requireCleanNonemptyUnit(record.unit, audit);
    else requireZeroTransparentUnit(record.unit, cell, audit);
  }
}

async function auditArtifacts(asset, assembled) {
  const audited = [];
  for (const artifact of assembled.artifactRecords) {
    const technical = await auditVisualAssetV2(artifact.png, asset, { verifyResize: false });
    if (!technical.ok) {
      throw new Error(`Wave A ${artifact.contract.role} technical gates rejected the assembled candidate: ${technical.problems.join('; ')}`);
    }
    audited.push({ ...artifact, technical });
  }
  if (asset.category === 'building') {
    const bundle = await auditBuildingBundleV2(
      audited.map(({ contract, png }) => ({ role: contract.role, bytes: png })),
      asset
    );
    if (!bundle.ok) {
      throw new Error(`Wave A building bundle gates rejected the assembled candidate: ${bundle.problems.join('; ')}`);
    }
  }
  return audited;
}

async function existingBytes(root, absolutePath) {
  try {
    return await readFile(await assertExistingFileWithin(root, toPosixRelative(root, absolutePath)));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeOrVerify(root, destination, bytes, label) {
  const existing = await existingBytes(root, destination);
  if (existing) {
    if (!existing.equals(bytes)) throw new Error(`${label} conflicts with an incomplete prior Wave A import`);
    return 'existing-identical';
  }
  await atomicWriteFile(root, destination, bytes);
  return 'written';
}

function uniqueDestinations(destinations) {
  const byPath = new Map();
  for (const destination of destinations) {
    const existing = byPath.get(destination.path);
    if (existing && !existing.bytes.equals(destination.bytes)) {
      throw new Error(`Wave A destination collision: ${destination.path}`);
    }
    if (!existing) byPath.set(destination.path, destination);
  }
  return [...byPath.values()];
}

function terrainInputPersistence(root, outputRoot, stem, composition) {
  const byCanonicalPath = new Map();
  return composition.inputs.map((input) => {
    let sourcePath = byCanonicalPath.get(input.source.canonicalPath);
    if (!sourcePath) {
      sourcePath = path.join(
        outputRoot,
        'sources',
        `${stem}-provider-${input.source.sha256.slice(0, 16)}.provider-original.${sourceFormatExtension(input.source.image.sourceFormat)}`
      );
      byCanonicalPath.set(input.source.canonicalPath, sourcePath);
    }
    return {
      ...input,
      sourcePath,
      sourceRelativePath: toPosixRelative(root, sourcePath)
    };
  });
}

function terrainCompositionLedger(composition, inputPersistence, outputRecords) {
  const inputs = composition.inputDescriptors.map((descriptor, index) => {
    const persisted = inputPersistence[index];
    return {
      role: descriptor.role,
      originKind: 'provider-original',
      providerInvocationEvidence: 'unverified-no-provider-receipt',
      sourceOriginal: {
        sha256: descriptor.sha256,
        format: descriptor.format,
        width: descriptor.width,
        height: descriptor.height,
        cropRect: structuredClone(descriptor.cropRect)
      },
      sourceSnapshot: {
        path: persisted.sourceRelativePath,
        sha256: descriptor.sha256,
        format: descriptor.format,
        width: descriptor.width,
        height: descriptor.height
      },
      normalizedCellSha256: descriptor.normalizedCellSha256
    };
  });
  const outputArtifacts = outputRecords.map((record) => ({
    role: record.contract.role,
    originKind: 'deterministic-derived',
    path: record.outputPath,
    sha256: record.outputSha256,
    width: record.contract.outputSize.width,
    height: record.contract.outputSize.height
  }));
  return {
    ...structuredClone(composition.descriptor),
    inputs,
    inputSetSha256: composition.inputSetSha256,
    unitDerivations: structuredClone(composition.unitDerivations),
    unitDerivationSetSha256: composition.unitDerivationSetSha256,
    atlasRawSha256: composition.atlasRawSha256,
    derivationSha256: terrainDerivationSha256(composition),
    outputArtifacts,
    outputArtifactSetSha256: sha256(canonicalJson(outputArtifacts)),
    replayPassed: true
  };
}

function assemblyRecipe(record, job, promptPath, terrainComposition = null) {
  const composed = job.generationMode === 'terrain-composed-atlas';
  if (composed !== Boolean(terrainComposition)) {
    throw new Error('Terrain composition recipe evidence does not match the job mode');
  }
  return {
    role: record.contract.role,
    method: composed ? 'terrain-composition' : 'unit-assembly',
    generator: composed ? 'codecity-terrain-composer-v1' : 'codecity-unit-assembler-v2',
    toolMode: 'built-in',
    transformSteps: ['none'],
    promptSnapshot: { path: promptPath, sha256: job.promptSha256 },
    inputReferences: job.referenceImages.map(({ id, sha256: digest, role }) => ({
      id, sha256: digest, role
    })),
    sourceOriginal: {
      path: record.assemblySourcePath,
      sha256: record.outputSha256,
      format: 'png',
      width: record.contract.outputSize.width,
      height: record.contract.outputSize.height,
      ...(composed ? {
        originKind: 'deterministic-derived',
        derivedFromSha256s: [...new Set(
          terrainComposition.inputDescriptors.map(({ sha256: digest }) => digest)
        )],
        derivationSha256: terrainDerivationSha256(terrainComposition)
      } : {})
    },
    artifact: {
      path: record.outputPath,
      sha256: record.outputSha256,
      width: record.contract.outputSize.width,
      height: record.contract.outputSize.height
    }
  };
}

function importProvenance(job, assembled) {
  const sourceEvidence = assembled.unitRecords.map(({ unit, sourceRecord, raw }) => ({
    unitId: unit.unitId,
    expectation: unit.expectation,
    sourceRequired: unit.sourceRequired,
    unitPromptSha256: unit.effectiveUnitPromptSha256 ?? unit.unitPromptSha256,
    sourceOriginalSha256: sourceRecord?.source.sha256 ?? null,
    cropRect: sourceRecord?.effectiveCrop ?? null,
    outputCellSha256: sha256(raw),
    consistencyInputSha256: assembled.identity?.transformedSha256 ?? null
  }));
  const provenanceKey = sha256(canonicalJson({
    jobProvenanceKey: job.provenanceKey,
    generationMode: job.generationMode,
    generationUnitSetSha256: job.generationUnitSetSha256,
    identityMasterSourceSha256: assembled.identity?.source.sha256 ?? null,
    ...(assembled.identity?.providerKeyNormalization ? {
      identityMasterProviderKeyNormalizedSha256:
        assembled.identity.providerKeyNormalization.evidence.normalized.sha256,
      identityMasterProviderKeyNormalizationDerivationSha256:
        assembled.identity.providerKeyNormalization.evidence.derivationSha256
    } : {}),
    identityMasterTransformedSha256: assembled.identity?.transformedSha256 ?? null,
    identityMasterCropRect: assembled.identity?.effectiveCrop ?? null,
    ...(assembled.providerKeyNormalization ? {
      providerKeyNormalization: {
        sourceOriginalSha256: assembled.providerKeyNormalization.evidence.sourceOriginal.sha256,
        normalizedSha256: assembled.providerKeyNormalization.evidence.normalized.sha256,
        normalizedDecodedRgbaSha256:
          assembled.providerKeyNormalization.evidence.normalized.decodedRgbaSha256,
        maskSha256: assembled.providerKeyNormalization.evidence.eligibility.maskSha256,
        derivationSha256: assembled.providerKeyNormalization.evidence.derivationSha256
      }
    } : {}),
    ...(assembled.terrainComposition ? {
      terrainComposition: {
        descriptor: assembled.terrainComposition.descriptor,
        inputDescriptors: assembled.terrainComposition.inputDescriptors,
        inputSetSha256: assembled.terrainComposition.inputSetSha256,
        unitDerivations: assembled.terrainComposition.unitDerivations,
        unitDerivationSetSha256: assembled.terrainComposition.unitDerivationSetSha256,
        atlasRawSha256: assembled.terrainComposition.atlasRawSha256,
        derivationSha256: assembled.terrainComposition.derivationSha256
      }
    } : {}),
    sourceEvidence,
    outputArtifacts: assembled.artifactRecords.map(({ contract, png }) => ({
      role: contract.role,
      sha256: sha256(png)
    }))
  }));
  return { sourceEvidence, provenanceKey };
}

function pendingUnitAssemblyResult({
  asset,
  job,
  jobPackPath,
  provenanceKey,
  generationId,
  metadataPath,
  recipes,
  unitAssemblyV2,
  outputRecords,
  sourceRequiredCount,
  createdAt
}) {
  const common = {
    visualContractVersion: 2,
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    definitionSha256: job.definitionSha256,
    assetDefinitionSha256: job.assetDefinitionSha256,
    referenceAuthorizationSha256: job.referenceAuthorizationSha256,
    id: generationId,
    jobId: job.id,
    assetId: asset.id,
    category: asset.category,
    status: 'pending',
    provider: 'manual-import',
    metadataPath,
    promptHash: job.promptSha256,
    provenanceKey,
    referenceImageIds: job.referenceImages.map(({ id }) => id),
    referenceImageHashes: job.referenceImages.map(({ sha256: digest }) => digest),
    dryRun: false,
    subscriptionRun: false,
    manualImport: true,
    sourceJobPackPathV2: jobPackPath,
    productionRecipesV2: recipes,
    unitAssemblyV2,
    warnings: [
      'Imported Fable5 Wave A unit assembly remains pending until explicit human visual approval.',
      'Semantic-transparent and reserved-transparent cells are zero-RGBA contracts, not generated accomplishments.',
      ...(job.generationMode === 'terrain-composed-atlas' ? [
        'Terrain semantic cells are deterministic-derived outputs; only terrainComposition inputs are provider-original byte claims.'
      ] : []),
      ...(job.identityMasterPlan ? [
        'The identity master is auxiliary consistency evidence, not a semantic runtime cell or approved asset.',
        'The importer associated submitted unit IDs and source hashes with a pre-existing issued plan that names exact prompt and identity hashes; this is record-level binding, not proof of provider delivery, execution, or generation order.'
      ] : [])
    ],
    createdAt,
    inspection: {
      status: 'pending-inspection',
      observed: [
        job.generationMode === 'terrain-composed-atlas'
          ? `${sourceRequiredCount} expected-nonempty terrain cells were deterministically derived from separately persisted provider-original inputs with no missing, duplicate, or extra unit IDs.`
          : `${sourceRequiredCount} expected-nonempty source units were transformed and assembled with no missing, duplicate, or extra unit IDs.`,
        `${job.generationExpectations['semantic-transparent']} semantic-transparent and ${job.generationExpectations['reserved-transparent']} reserved-transparent cells were assembled as zero RGBA without source claims.`,
        'Every unit transform and final atlas replayed byte-identically from persisted source evidence.'
      ],
      inferred: [
        'The candidate is technically eligible for independent visual inspection.'
      ],
      unknown: [
        'visual suitability', 'character identity quality', 'human approval', 'ensemble quality',
        'runtime integration',
        ...(job.identityMasterPlan ? [
          'actual source generation after identity-binding issuance',
          'actual provider use of the issued unit prompts',
          'actual identity image delivery to the provider invocation'
        ] : [])
      ]
    }
  };
  return asset.category === 'building' ? {
    ...common,
    outputArtifacts: outputRecords.map((record) => ({
      role: record.contract.role,
      path: record.outputPath,
      sha256: record.outputSha256,
      inspection: record.outputInspection
    })),
    bundleTechnicalInspection: {
      visualContractVersion: 2,
      atomicPair: true,
      roles: ['base', 'roof'],
      artifacts: outputRecords.map((record) => ({
        role: record.contract.role,
        technicalInspection: record.technical.technicalInspection
      })),
      passed: true
    }
  } : {
    ...common,
    outputPath: outputRecords[0].outputPath,
    outputSha256: outputRecords[0].outputSha256,
    outputInspection: outputRecords[0].outputInspection,
    technicalInspection: outputRecords[0].technical.technicalInspection
  };
}

export async function importWaveACandidate({
  assetId,
  jobPackPath,
  unitSources,
  terrainComposition = null,
  identityBindingPath = null
}, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  if (path.resolve(root) !== path.resolve(forgeRoot)) {
    throw new Error('Wave A import requires one canonical Forge root');
  }
  validateCallerInputs(unitSources, identityBindingPath, terrainComposition);
  return withFileLock(root, pathsFor(root).requiredPromotionLock, () =>
    importWaveACandidateLocked({
      assetId, jobPackPath, unitSources, terrainComposition, identityBindingPath
    }, { root, forgeRoot }));
}

async function importWaveACandidateLocked({
  assetId, jobPackPath, unitSources, terrainComposition, identityBindingPath
}, {
  root, forgeRoot
}) {
  const approvedBefore = await hashApprovedTree(root);
  const verifiedPack = await verifyWaveAJobPack(jobPackPath, { root, forgeRoot });
  const { asset, job } = verifiedPack;
  if (assetId !== asset.id || job.requiredSetId !== 'fable5-v2' || job.waveId !== 'A') {
    throw new Error('Wave A import identity does not match explicit fable5-v2/A job pack');
  }
  const composedTerrain = job.generationMode === 'terrain-composed-atlas';
  if (composedTerrain) requireTerrainCompositionRequest(job, terrainComposition);
  else if (terrainComposition !== null) {
    throw new Error('Terrain composition input cannot be used with an existing Wave A job mode');
  }
  const coverage = composedTerrain
    ? {
        required: job.generationUnits.filter(({ sourceRequired }) => sourceRequired),
        missing: [], duplicates: [], extra: []
      }
    : exactSourceCoverage(job, unitSources);
  if (job.category === 'character' && job.generationMode === 'monolithic-atlas') {
    validateCharacterMonolithicCropLayout(job, coverage.required.map((unit, index) => ({
      unit,
      input: unitSources[index]
    })));
  }
  if (job.category === 'character' && job.generationMode === CHARACTER_DIRECTION_STRIP_MODE) {
    validateCharacterDirectionStripCropLayout(job, coverage.required.map((unit, index) => ({
      unit,
      input: unitSources[index]
    })));
  }
  const preflight = composedTerrain
    ? await preflightTerrainInputs(job, terrainComposition)
    : await preflightUnitSources(job, unitSources);
  const { cache: sourceCache, sourceBudget } = preflight;
  let identityAuthority = null;
  if (job.category === 'character') {
    if (!identityBindingPath) {
      throw new Error('Wave A character import rejects atomic identity afterthoughts; issue an identity binding first');
    }
    identityAuthority = await verifyWaveAIdentityBinding(identityBindingPath, {
      root,
      forgeRoot,
      verifiedPack,
      sourceBudget
    });
    if (identityAuthority.binding.jobPackPath !== jobPackPath) {
      throw new Error('Wave A identity binding belongs to a different job pack');
    }
  } else if (identityBindingPath !== null) {
    throw new Error('Non-character Wave A jobs forbid identityBindingPath');
  }
  const assembled = composedTerrain
    ? await assembleComposedTerrain(job, preflight.inputs)
    : await assembleUnits(
        job,
        unitSources,
        identityAuthority?.identity ?? null,
        sourceCache,
        sourceBudget
      );
  if (identityAuthority) {
    const executionById = new Map(identityAuthority.executionUnits.map((unit) => [unit.unitId, unit]));
    for (const record of assembled.unitRecords) {
      const execution = executionById.get(record.unit.unitId);
      if (!execution) throw new Error(`Wave A identity execution plan omits ${record.unit.unitId}`);
      record.unit = {
        ...record.unit,
        effectiveUnitPromptSha256: execution.executionPromptSha256
      };
    }
  }
  await replayAssembly(job, assembled);
  finalCellAudit(job, assembled);
  const auditedArtifacts = await auditArtifacts(asset, assembled);
  const { provenanceKey } = importProvenance(job, {
    ...assembled,
    artifactRecords: auditedArtifacts
  });
  const generationId = `gen_v2_import_${provenanceKey.slice(0, 20)}`;
  const outputRoot = path.join(root, 'generated', categoryDirectory(asset.category), 'pending');
  const stem = `${assetFileStem(asset.id)}-${provenanceKey.slice(0, 16)}`;
  const outputRecords = auditedArtifacts.map((record) => {
    const roleSuffix = record.contract.role === 'primary' ? '' : `-${record.contract.role}`;
    const outputAbsolute = path.join(outputRoot, `${stem}${roleSuffix}.png`);
    const assemblySourceAbsolute = path.join(
      outputRoot,
      'sources',
      composedTerrain
        ? `${stem}-${record.contract.role}.derived-composition.png`
        : `${stem}-${record.contract.role}.source-original.png`
    );
    return {
      ...record,
      outputAbsolute,
      outputPath: toPosixRelative(root, outputAbsolute),
      outputSha256: sha256(record.png),
      outputInspection: inspectPng(record.png),
      assemblySourceAbsolute,
      assemblySourcePath: toPosixRelative(root, assemblySourceAbsolute)
    };
  });
  const monolithicSourcePath = job.generationMode === 'monolithic-atlas'
    ? path.join(
        outputRoot,
        'sources',
        `${stem}-monolithic-atlas.source-original.${sourceFormatExtension(
          assembled.unitRecords.find(({ sourceRecord }) => sourceRecord)?.sourceRecord.source.image.sourceFormat
        )}`
      )
    : null;
  const directionStripSourcePaths = job.generationMode === CHARACTER_DIRECTION_STRIP_MODE
    ? new Map(CHARACTER_DIRECTION_STRIP_DIRECTIONS.map((direction) => {
        const record = assembled.unitRecords.find(
          ({ unit, sourceRecord }) => unit.direction === direction && sourceRecord
        );
        return [direction, path.join(
          outputRoot,
          'sources',
          `${stem}-direction-strip-${direction}.source-original.${sourceFormatExtension(record.sourceRecord.source.image.sourceFormat)}`
        )];
      }))
    : new Map();
  const providerNormalizedPath = assembled.providerKeyNormalization
    ? providerKeyNormalizedSnapshotPath(job, outputRoot, stem)
    : null;
  const unitPersistence = assembled.unitRecords.map((record) => {
    if (composedTerrain) {
      const transformedPath = record.unit.sourceRequired
        ? path.join(
            outputRoot,
            'unit-cells',
            `${stem}-${record.unit.unitId}.png`
          )
        : null;
      return { ...record, sourcePath: null, transformedPath };
    }
    if (!record.sourceRecord) return { ...record, sourcePath: null, transformedPath: null };
    const sourcePath = monolithicSourcePath ?? directionStripSourcePaths.get(record.unit.direction) ?? path.join(
      outputRoot,
      'sources',
      `${stem}-${record.unit.unitId}.source-original.${sourceFormatExtension(record.sourceRecord.source.image.sourceFormat)}`
    );
    const transformedPath = path.join(
      outputRoot,
      'unit-cells',
      `${stem}-${record.unit.unitId}.png`
    );
    return { ...record, sourcePath, transformedPath };
  });
  const identityPersistence = assembled.identity ? {
    ...assembled.identity,
    sourceOriginalPath: resolveWithin(root, identityAuthority.binding.identityMaster.sourceSnapshot.path),
    ...(identityAuthority.binding.identityMaster.providerKeyNormalization ? {
      providerKeyNormalizedPath: resolveWithin(
        root,
        identityAuthority.binding.identityMaster.providerKeyNormalization.normalizedSnapshot.path
      )
    } : {}),
    transformedPath: resolveWithin(root, identityAuthority.binding.identityMaster.transformedSnapshot.path)
  } : null;
  const compositionInputPersistence = composedTerrain
    ? terrainInputPersistence(root, outputRoot, stem, assembled.terrainComposition)
    : [];
  const transformedBytes = new Map();
  for (const record of unitPersistence.filter(({ transformedPath }) => transformedPath)) {
    transformedBytes.set(record.unit.unitId, await encodeRawPng(
      record.raw,
      record.unit.targetRect.width,
      record.unit.targetRect.height
    ));
  }
  const terrainCompositionV2 = composedTerrain
    ? terrainCompositionLedger(
        assembled.terrainComposition,
        compositionInputPersistence,
        outputRecords
      )
    : null;
  const unitAssemblyV2 = {
    jobId: job.id,
    jobProvenanceKey: job.provenanceKey,
    definitionSha256: job.definitionSha256,
    promptSha256: job.promptSha256,
    referenceAuthorizationSha256: job.referenceAuthorizationSha256,
    referenceImageHashes: job.referenceImages.map(({ sha256: digest }) => digest),
    identityMasterPlanSha256: job.identityMasterPlan
      ? sha256(canonicalJson(job.identityMasterPlan))
      : null,
    assemblyAlgorithm: assemblyAlgorithmFor(job),
    ...(job.technicalGates.inputPolicy.sourceLimits ? {
      sourceLimits: structuredClone(job.technicalGates.inputPolicy.sourceLimits)
    } : {}),
    generationMode: job.generationMode,
    generationUnitSetSha256: job.generationUnitSetSha256,
    expectations: structuredClone(job.generationExpectations),
    sourceRequiredCount: coverage.required.length,
    identityMaster: identityPersistence ? {
      planId: job.identityMasterPlan.planId,
      promptSha256: job.identityMasterPlan.promptSha256,
      inputReferences: structuredClone(job.identityMasterPlan.inputReferences),
      sourceOriginal: {
        sha256: identityPersistence.source.sha256,
        format: identityPersistence.source.image.sourceFormat,
        width: identityPersistence.source.image.metadata.width,
        height: identityPersistence.source.image.metadata.height,
        cropRect: structuredClone(identityPersistence.effectiveCrop)
      },
      sourceSnapshot: {
        path: toPosixRelative(root, identityPersistence.sourceOriginalPath),
        sha256: identityPersistence.source.sha256,
        format: identityPersistence.source.image.sourceFormat,
        width: identityPersistence.source.image.metadata.width,
        height: identityPersistence.source.image.metadata.height
      },
      ...(identityPersistence.providerKeyNormalization ? {
        providerKeyNormalization: providerKeyNormalizationLedger(
          identityPersistence.providerKeyNormalization,
          toPosixRelative(root, identityPersistence.providerKeyNormalizedPath)
        )
      } : {}),
      transformedSnapshot: {
        path: toPosixRelative(root, identityPersistence.transformedPath),
        sha256: identityPersistence.transformedSha256,
        format: 'png',
        width: job.identityMasterPlan.outputSize.width,
        height: job.identityMasterPlan.outputSize.height
      },
      transformSteps: [...transformStepsFor(job)],
      ...(canonicalBackgroundRemoval(job) ? {
        transformEvidence: structuredClone(identityPersistence.transformEvidence)
      } : {}),
      consistencyInputSha256: identityPersistence.transformedSha256,
      directionCellSha256s: identityPersistence.cellHashes,
      auxiliary: true,
      semanticCell: false,
      approvedAsset: false,
      unitExecutionPlanPath: identityAuthority.bindingPath,
      unitExecutionPlanSha256: identityAuthority.bindingSha256,
      issuanceSequence: identityAuthority.binding.issuanceSequence,
      providerInvocationEvidence: identityAuthority.binding.providerInvocationEvidence
    } : null,
    ...(assembled.providerKeyNormalization ? {
      providerKeyNormalization: providerKeyNormalizationLedger(
        assembled.providerKeyNormalization,
        toPosixRelative(root, providerNormalizedPath)
      )
    } : {}),
    ...(terrainCompositionV2 ? { terrainComposition: terrainCompositionV2 } : {}),
    units: unitPersistence.map((record) => ({
      unitId: record.unit.unitId,
      artifactRole: record.unit.artifactRole,
      frameId: record.unit.frameId,
      ...(record.unit.direction ? { direction: record.unit.direction } : {}),
      semanticRole: record.unit.semanticRole,
      targetRect: structuredClone(record.unit.targetRect),
      expectation: record.unit.expectation,
      sourceRequired: record.unit.sourceRequired,
      unitPromptSha256: record.unit.effectiveUnitPromptSha256 ?? record.unit.unitPromptSha256,
      inputReferences: structuredClone(record.unit.inputReferences),
      consistencyPlanId: record.unit.consistencyPlanId ?? null,
      consistencyInputSha256: identityPersistence?.transformedSha256 ?? null,
      sourceOriginal: record.sourceRecord ? {
        sha256: record.sourceRecord.source.sha256,
        format: record.sourceRecord.source.image.sourceFormat,
        width: record.sourceRecord.source.image.metadata.width,
        height: record.sourceRecord.source.image.metadata.height,
        cropRect: structuredClone(record.sourceRecord.effectiveCrop)
      } : null,
      sourceSnapshot: record.sourceRecord ? {
        path: toPosixRelative(root, record.sourcePath),
        sha256: record.sourceRecord.source.sha256,
        format: record.sourceRecord.source.image.sourceFormat,
        width: record.sourceRecord.source.image.metadata.width,
        height: record.sourceRecord.source.image.metadata.height
      } : null,
      transformedSnapshot: record.transformedPath ? {
        path: toPosixRelative(root, record.transformedPath),
        sha256: sha256(transformedBytes.get(record.unit.unitId)),
        format: 'png',
        width: record.unit.targetRect.width,
        height: record.unit.targetRect.height
      } : null,
      transformSteps: composedTerrain
        ? (record.unit.sourceRequired ? [TERRAIN_COMPOSER_UNIT_STEP] : [])
        : (record.sourceRecord ? [...transformStepsFor(job)] : []),
      ...(canonicalBackgroundRemoval(job) ? {
        transformEvidence: record.sourceRecord
          ? structuredClone(record.sourceRecord.transformEvidence)
          : null
      } : {}),
      outputCellSha256: sha256(record.raw),
      pixelAudit: record.audit
    })),
    artifacts: outputRecords.map((record) => ({
      role: record.contract.role,
      path: record.outputPath,
      sha256: record.outputSha256,
      width: record.contract.outputSize.width,
      height: record.contract.outputSize.height,
      unitIds: job.generationUnits
        .filter(({ artifactRole }) => artifactRole === record.contract.role)
        .map(({ unitId }) => unitId)
    })),
    missingUnitIds: [],
    duplicateUnitIds: [],
    extraUnitIds: [],
    replayPassed: true,
    finalCellAuditPassed: true
  };
  const promptPath = verifiedPack.pack.members.prompt.path;
  const recipes = outputRecords.map((record) => assemblyRecipe(
    record,
    job,
    promptPath,
    assembled.terrainComposition ?? null
  ));
  const metadataAbsolute = path.join(outputRoot, `${stem}.json`);
  const metadataPath = toPosixRelative(root, metadataAbsolute);
  const manifest = await readLocalGenerationManifest(root);
  const existingResult = manifest.results.find(({ id }) => id === generationId) ?? null;
  const existingMetadataBytes = await existingBytes(root, metadataAbsolute);
  const existingMetadata = existingMetadataBytes
    ? parseJson(existingMetadataBytes, 'Wave A import metadata')
    : null;
  const result = pendingUnitAssemblyResult({
    asset,
    job,
    jobPackPath,
    provenanceKey,
    generationId,
    metadataPath,
    recipes,
    unitAssemblyV2,
    outputRecords,
    sourceRequiredCount: coverage.required.length,
    createdAt: existingResult?.createdAt ?? existingMetadata?.createdAt ?? new Date().toISOString()
  });
  const validation = validateWith('generation-result.schema.json', result);
  if (!validation.ok) throw new Error(`Invalid Wave A import result: ${JSON.stringify(validation.errors)}`);
  if (existingResult && canonicalJson(existingResult) !== canonicalJson(result)) {
    throw new Error('Existing Wave A import ledger entry conflicts with deterministic provenance');
  }
  if (existingMetadata && canonicalJson(existingMetadata) !== canonicalJson(result)) {
    throw new Error('Existing Wave A import metadata conflicts with deterministic provenance');
  }
  const destinations = uniqueDestinations([
    ...compositionInputPersistence.map((input) => ({
      path: input.sourcePath,
      bytes: input.source.image.buffer,
      label: `${input.role} provider-original`
    })),
    ...unitPersistence.filter(({ sourceRecord }) => sourceRecord).flatMap((record) => [
      {
        path: record.sourcePath,
        bytes: record.sourceRecord.source.image.buffer,
        label: `${record.unit.unitId} source-original`
      },
      {
        path: record.transformedPath,
        bytes: transformedBytes.get(record.unit.unitId),
        label: `${record.unit.unitId} transformed unit`
      }
    ]),
    ...(assembled.providerKeyNormalization ? [{
      path: providerNormalizedPath,
      bytes: assembled.providerKeyNormalization.normalizedPng,
      label: 'provider-key-normalized'
    }] : []),
    ...unitPersistence.filter((record) => composedTerrain && record.transformedPath).map((record) => ({
      path: record.transformedPath,
      bytes: transformedBytes.get(record.unit.unitId),
      label: `${record.unit.unitId} deterministic-derived unit`
    })),
    ...outputRecords.flatMap((record) => [
      {
        path: record.assemblySourceAbsolute,
        bytes: record.png,
        label: `${record.contract.role} replay assembly source`
      },
      {
        path: record.outputAbsolute,
        bytes: record.png,
        label: `${record.contract.role} pending artifact`
      }
    ]),
    { path: metadataAbsolute, bytes: Buffer.from(canonicalJson(result)), label: 'Wave A import metadata' }
  ]);
  const states = [];
  for (const destination of destinations) {
    const bytes = await existingBytes(root, destination.path);
    if (bytes && !bytes.equals(destination.bytes)) {
      throw new Error(`${destination.label} conflicts with an incomplete prior Wave A import`);
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
    for (const destination of destinations) {
      if (await hashFile(destination.path) !== sha256(destination.bytes)) {
        throw new Error(`Persisted Wave A import snapshot hash mismatch: ${destination.label}`);
      }
    }
    const approvedAfter = await hashApprovedTree(root);
    if (approvedAfter !== approvedBefore) throw new Error('Approved tree changed during Wave A import');
    if (!existingResult) await appendGenerationResultUnlocked(root, result);
    return {
      status: 'pending',
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
