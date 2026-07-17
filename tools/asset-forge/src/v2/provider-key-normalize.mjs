import sharp from 'sharp';
import { canonicalJson, sha256 } from '../hashing.mjs';

export const PROVIDER_KEY_NORMALIZE_VERSION = 'provider-key-normalize-v1';
export const PROVIDER_KEY_NORMALIZE_ALGORITHM =
  'provider-key-normalize/outer-connected-exact-magenta-v1';
export const PROVIDER_KEY_NORMALIZE_STEP = 'provider-key-normalize-v1';

const TARGET = Object.freeze([255, 0, 255]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CONFIG = Object.freeze({
  schemaVersion: 1,
  version: PROVIDER_KEY_NORMALIZE_VERSION,
  algorithm: PROVIDER_KEY_NORMALIZE_ALGORITHM,
  sourceFormat: 'png',
  sourceAlpha: 'fully-opaque',
  targetKeyColor: '#FF00FF',
  colorDistance: 'chebyshev-rgb',
  rawKeyMaximumDistance: 32,
  rawKeyRedMinimum: 223,
  rawKeyBlueMinimum: 223,
  rawKeyGreenMaximum: 32,
  rawKeyMinimumDominance: 191,
  rawKeyRedBlueMaximumDelta: 32,
  borderBandMax: 6,
  borderSampleStrideDivisor: 256,
  borderStatistic: 'per-channel-median-nearest-ties-to-even',
  eligibilityRadius: 12,
  minimumBorderInlierPermille: 995,
  connectivity: 'four-neighbor-outer-connected',
  connectedPixelMinimumPermille: 100,
  connectedPixelMaximumPermille: 900,
  disconnectedEligibleMaximumPermille: 1,
  replacement: 'connected-eligible-rgb-to-exact-ff00ff-alpha-unchanged',
  outsideMaskPolicy: 'decoded-rgba-byte-identical',
  postBorderKey: 'exact-ff00ff',
  postMinimumExactInlierPermille: 995,
  canonicalPng: Object.freeze({
    adaptiveFiltering: false,
    palette: false,
    compressionLevel: 9
  }),
  providerInvocationEvidence: 'unverified-no-provider-receipt'
});

export const PROVIDER_KEY_NORMALIZE_CONFIG_SHA256 = sha256(canonicalJson(CONFIG));

function normalizationPlan(sourceKinds) {
  return {
    schemaVersion: 1,
    originKind: 'deterministic-derived',
    version: PROVIDER_KEY_NORMALIZE_VERSION,
    algorithm: PROVIDER_KEY_NORMALIZE_ALGORITHM,
    configSha256: PROVIDER_KEY_NORMALIZE_CONFIG_SHA256,
    sourceKinds,
    sourceFormat: 'png',
    providerInvocationEvidence: CONFIG.providerInvocationEvidence
  };
}

function exactSingleUnitScope(asset, generationMode, generationUnits, artifactContracts) {
  if (!asset || asset.category === 'character' || asset.category === 'building'
    || asset.category === 'terrain' || generationMode !== 'per-unit'
    || (asset.category === 'ui' && asset.sprites?.grid)
    || !Array.isArray(generationUnits) || generationUnits.length !== 1
    || generationUnits.filter(({ sourceRequired }) => sourceRequired).length !== 1
    || !Array.isArray(artifactContracts) || artifactContracts.length !== 1) return false;
  const unit = generationUnits[0];
  const artifact = artifactContracts[0];
  return unit.sourceRequired === true
    && unit.expectation === 'expected-nonempty'
    && unit.artifactRole === 'primary'
    && artifact.role === 'primary'
    && unit.targetRect?.x === 0
    && unit.targetRect?.y === 0
    && unit.targetRect?.width === artifact.outputSize?.width
    && unit.targetRect?.height === artifact.outputSize?.height;
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

function borderSamples(raw, width, height) {
  const borderBand = Math.max(1, Math.min(width, height, CONFIG.borderBandMax));
  const borderSampleStride = Math.max(
    1,
    Math.floor(Math.min(width, height) / CONFIG.borderSampleStrideDivisor)
  );
  const samples = [];
  const append = (x, y) => {
    const offset = (y * width + x) * 4;
    samples.push(raw[offset], raw[offset + 1], raw[offset + 2]);
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
  return {
    borderBand,
    borderSampleStride,
    samples: Buffer.from(samples)
  };
}

function sampleEvidence(raw, width, height, { post = false } = {}) {
  const sampled = borderSamples(raw, width, height);
  const detectedKey = [0, 1, 2].map((channel) => channelMedian(sampled.samples, channel));
  let inlierCount = 0;
  for (let offset = 0; offset < sampled.samples.length; offset += 3) {
    const color = [sampled.samples[offset], sampled.samples[offset + 1], sampled.samples[offset + 2]];
    if (colorDistance(color, post ? TARGET : detectedKey) <= (post ? 0 : CONFIG.eligibilityRadius)) {
      inlierCount += 1;
    }
  }
  const sampleCount = sampled.samples.length / 3;
  return {
    detectedKey,
    evidence: {
      detectedKeyColor: colorHex(detectedKey),
      detectedKeyExpectedDistance: colorDistance(detectedKey, TARGET),
      borderBand: sampled.borderBand,
      borderSampleStride: sampled.borderSampleStride,
      borderSampleCount: sampleCount,
      borderSampleSha256: sha256(sampled.samples),
      inlierRadius: post ? 0 : CONFIG.eligibilityRadius,
      borderInlierCount: inlierCount,
      borderInlierPermille: Math.floor(inlierCount * 1000 / sampleCount)
    }
  };
}

function validRawKey(color) {
  return colorDistance(color, TARGET) <= CONFIG.rawKeyMaximumDistance
    && color[0] >= CONFIG.rawKeyRedMinimum
    && color[2] >= CONFIG.rawKeyBlueMinimum
    && color[1] <= CONFIG.rawKeyGreenMaximum
    && Math.min(color[0], color[2]) - color[1] >= CONFIG.rawKeyMinimumDominance
    && Math.abs(color[0] - color[2]) <= CONFIG.rawKeyRedBlueMaximumDelta;
}

function eligibleMask(raw, width, height, detectedKey) {
  const pixelCount = width * height;
  const eligible = Buffer.alloc(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const color = [raw[offset], raw[offset + 1], raw[offset + 2]];
    if (validRawKey(color) && colorDistance(color, detectedKey) <= CONFIG.eligibilityRadius) {
      eligible[index] = 1;
    }
  }
  return eligible;
}

function outerConnectedMask(eligible, width, height) {
  const connected = Buffer.alloc(eligible.length);
  const queue = new Uint32Array(eligible.length);
  let head = 0;
  let tail = 0;
  const append = (index) => {
    if (!eligible[index] || connected[index]) return;
    connected[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    append(x);
    append((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    append(y * width);
    append(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) append(index - 1);
    if (x + 1 < width) append(index + 1);
    if (y > 0) append(index - width);
    if (y + 1 < height) append(index + width);
  }
  return connected;
}

function countMask(mask) {
  let count = 0;
  for (const value of mask) count += value;
  return count;
}

function outsideMaskBytes(raw, mask) {
  const output = Buffer.alloc((mask.length - countMask(mask)) * 4);
  let cursor = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) continue;
    raw.copy(output, cursor, index * 4, index * 4 + 4);
    cursor += 4;
  }
  return output;
}

export function providerKeyNormalizationPlanFor(asset, generationMode, {
  generationUnits = null,
  artifactContracts = null
} = {}) {
  if (asset?.category === 'character' && generationMode === 'monolithic-atlas') {
    return normalizationPlan(['identity-master', 'monolithic-atlas']);
  }
  if (['building', 'overlay', 'structure', 'interior', 'prop', 'ui', 'effect']
    .includes(asset?.category)
    && generationMode === 'monolithic-atlas') {
    return normalizationPlan(['monolithic-atlas']);
  }
  if (!exactSingleUnitScope(asset, generationMode, generationUnits, artifactContracts)) {
    throw new Error(
      'provider-key-normalize-v1 requires character or non-terrain monolithic-atlas, or exact single-unit non-character per-unit scope'
    );
  }
  return normalizationPlan(['single-unit']);
}

export function providerKeyNormalizationSourceKindForJob(job) {
  const plan = job?.providerKeyNormalizationPlan;
  if (!plan) return null;
  if (job.category !== job.assetDefinition?.category) {
    throw new Error('provider-key-normalize-v1 job category does not match its asset definition');
  }
  const expected = providerKeyNormalizationPlanFor(job.assetDefinition, job.generationMode, {
    generationUnits: job.generationUnits,
    artifactContracts: job.artifactContracts
  });
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error('provider-key-normalize-v1 job plan escaped its exact source contract');
  }
  return job.generationMode === 'monolithic-atlas' ? 'monolithic-atlas' : 'single-unit';
}

export async function normalizeProviderKey(image, plan) {
  const exactPlan = [
    normalizationPlan(['identity-master', 'monolithic-atlas']),
    normalizationPlan(['monolithic-atlas']),
    normalizationPlan(['single-unit'])
  ].some((candidate) => canonicalJson(plan) === canonicalJson(candidate));
  if (!image?.buffer || image.sourceFormat !== 'png' || !image.metadata
    || image.buffer.length < PNG_SIGNATURE.length
    || !image.buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || !exactPlan) {
    throw new Error('provider-key-normalize-v1 requires its exact plan and a provider-original PNG');
  }
  const decoded = await sharp(image.buffer, { animated: false, failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.channels !== 4 || decoded.info.width !== image.metadata.width
    || decoded.info.height !== image.metadata.height) {
    throw new Error('provider-key-normalize-v1 source metadata does not match decoded RGBA');
  }
  for (let offset = 3; offset < decoded.data.length; offset += 4) {
    if (decoded.data[offset] !== 255) {
      throw new Error('provider-key-normalize-v1 requires alpha 255 for every provider-original pixel');
    }
  }
  const pre = sampleEvidence(decoded.data, decoded.info.width, decoded.info.height);
  if (!validRawKey(pre.detectedKey)) {
    throw new Error('provider-key-normalize-v1 detected raw key is outside the safe magenta envelope');
  }
  if (pre.evidence.borderInlierCount * 1000
    < pre.evidence.borderSampleCount * CONFIG.minimumBorderInlierPermille) {
    throw new Error('provider-key-normalize-v1 pre-normalization border inliers are below 995 permille');
  }

  const eligible = eligibleMask(decoded.data, decoded.info.width, decoded.info.height, pre.detectedKey);
  const connected = outerConnectedMask(eligible, decoded.info.width, decoded.info.height);
  const eligiblePixelCount = countMask(eligible);
  const connectedPixelCount = countMask(connected);
  const disconnectedEligiblePixelCount = eligiblePixelCount - connectedPixelCount;
  const pixelCount = decoded.info.width * decoded.info.height;
  if (plan.sourceKinds.length === 1 && plan.sourceKinds[0] === 'single-unit') {
    for (let index = 0; index < connected.length; index += 1) {
      if (connected[index]) continue;
      const offset = index * 4;
      if (validRawKey([
        decoded.data[offset], decoded.data[offset + 1], decoded.data[offset + 2]
      ])) {
        throw new Error(
          'provider-key-normalize-v1 single-unit source contains disconnected or subject magenta'
        );
      }
    }
  }
  if (connectedPixelCount * 1000 < pixelCount * CONFIG.connectedPixelMinimumPermille
    || connectedPixelCount * 1000 > pixelCount * CONFIG.connectedPixelMaximumPermille) {
    throw new Error('provider-key-normalize-v1 connected key fraction is outside 100..900 permille');
  }
  if (disconnectedEligiblePixelCount * 1000
    > pixelCount * CONFIG.disconnectedEligibleMaximumPermille) {
    throw new Error('provider-key-normalize-v1 disconnected eligible pixels exceed 1 permille');
  }

  const normalizedRaw = Buffer.from(decoded.data);
  let changedPixelCount = 0;
  for (let index = 0; index < connected.length; index += 1) {
    if (!connected[index]) continue;
    const offset = index * 4;
    if (normalizedRaw[offset] !== 255 || normalizedRaw[offset + 1] !== 0
      || normalizedRaw[offset + 2] !== 255) changedPixelCount += 1;
    normalizedRaw[offset] = 255;
    normalizedRaw[offset + 1] = 0;
    normalizedRaw[offset + 2] = 255;
  }
  const rawOutsideMask = outsideMaskBytes(decoded.data, connected);
  const normalizedOutsideMask = outsideMaskBytes(normalizedRaw, connected);
  if (!rawOutsideMask.equals(normalizedOutsideMask)) {
    throw new Error('provider-key-normalize-v1 changed decoded RGBA outside the replacement mask');
  }
  const post = sampleEvidence(normalizedRaw, decoded.info.width, decoded.info.height, { post: true });
  if (post.evidence.detectedKeyColor !== '#FF00FF'
    || post.evidence.borderInlierCount * 1000
      < post.evidence.borderSampleCount * CONFIG.postMinimumExactInlierPermille) {
    throw new Error('provider-key-normalize-v1 post-normalization border is not exact #FF00FF at 995 permille');
  }
  const normalizedPng = await sharp(normalizedRaw, {
    raw: {
      width: decoded.info.width,
      height: decoded.info.height,
      channels: 4
    }
  }).png(CONFIG.canonicalPng).toBuffer();
  const evidenceWithoutDigest = {
    originKind: 'deterministic-derived',
    version: PROVIDER_KEY_NORMALIZE_VERSION,
    algorithm: PROVIDER_KEY_NORMALIZE_ALGORITHM,
    configSha256: PROVIDER_KEY_NORMALIZE_CONFIG_SHA256,
    providerInvocationEvidence: CONFIG.providerInvocationEvidence,
    sourceOriginal: {
      originKind: 'provider-original',
      sha256: sha256(image.buffer),
      decodedRgbaSha256: sha256(decoded.data),
      format: 'png',
      width: decoded.info.width,
      height: decoded.info.height
    },
    normalized: {
      originKind: 'deterministic-derived',
      derivedFromSha256: sha256(image.buffer),
      sha256: sha256(normalizedPng),
      decodedRgbaSha256: sha256(normalizedRaw),
      format: 'png',
      width: decoded.info.width,
      height: decoded.info.height
    },
    preBorder: pre.evidence,
    eligibility: {
      eligiblePixelCount,
      connectedPixelCount,
      connectedPixelPermille: Math.floor(connectedPixelCount * 1000 / pixelCount),
      disconnectedEligiblePixelCount,
      disconnectedEligiblePermille: Math.floor(disconnectedEligiblePixelCount * 1000 / pixelCount),
      maskSha256: sha256(connected),
      maskPixelCount: connectedPixelCount,
      changedPixelCount
    },
    outsideMaskBeforeRgbaSha256: sha256(rawOutsideMask),
    outsideMaskAfterRgbaSha256: sha256(normalizedOutsideMask),
    outsideMaskPreserved: true,
    postBorder: post.evidence,
    replayPassed: true
  };
  return {
    normalizedRaw,
    normalizedPng,
    mask: connected,
    evidence: {
      ...evidenceWithoutDigest,
      derivationSha256: sha256(canonicalJson(evidenceWithoutDigest))
    }
  };
}
