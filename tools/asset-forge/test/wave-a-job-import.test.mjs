import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { main } from '../src/cli.mjs';
import { FORGE_ROOT } from '../src/config.mjs';
import { canonicalJson, hashApprovedTree, hashTree, sha256 } from '../src/hashing.mjs';
import { processCandidate } from '../src/jobs/process-candidate.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';
import { buildWaveAJob } from '../src/v2/build-job.mjs';
import {
  importWaveACandidate,
  prepareWaveAIdentityBinding,
  verifyPersistedWaveAUnitAssembly,
  verifyWaveATransformReplay,
  verifyWaveAIdentityBinding,
  verifyWaveAJobPack
} from '../src/v2/import-candidate.mjs';
import {
  importWaveARequest,
  makeWaveAJob,
  prepareWaveAIdentity,
  readWaveAImportRequest
} from '../src/v2/operator.mjs';
import { writeWaveAJobPack } from '../src/v2/write-job-pack.mjs';
import {
  TERRAIN_COMPOSER_ALGORITHM,
  TERRAIN_COMPOSER_CONFIG_SHA256,
  TERRAIN_COMPOSER_MASK_SET_SHA256,
  TERRAIN_COMPOSER_VERSION
} from '../src/v2/compose-terrain-atlas.mjs';
import { verifyPendingGenerationForWaveApproval } from '../src/v3/provenance.mjs';

const NOW = '2026-07-16T02:00:00.000Z';

async function fixtureRoot(t, { approvedAuthorization = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-wave-a-v2-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const relative of ['data/v2', 'data/manifests', 'references', 'prompts/v2']) {
    await cp(path.join(FORGE_ROOT, relative), path.join(root, relative), { recursive: true });
  }
  await mkdir(path.join(root, 'data', 'local'), { recursive: true });
  await writeFile(path.join(root, 'data', 'local', 'generations.json'), canonicalJson({
    schemaVersion: 1,
    tracked: false,
    results: []
  }));
  const authorizationPath = path.join(root, 'data', 'v2', 'reference-authorization-wave-a.json');
  const authorization = JSON.parse(await readFile(authorizationPath, 'utf8'));
  if (approvedAuthorization) {
    const review = {
      schemaVersion: 1,
      reviewType: 'fable5-wave-reference-rights',
      requiredSetId: 'fable5-v2',
      waveId: 'A',
      status: 'pass',
      reviewer: 'independent-read-only',
      reviewedAt: NOW,
      ownerAuthorizationSha256: authorization.ownerAuthorizationSha256,
      assetReferenceMapSha256: authorization.assetReferenceMapSha256,
      authorizedReferenceIds: authorization.allowedReferenceIds,
      forbiddenReferenceIds: authorization.forbiddenReferenceIds,
      observed: ['Fixture checked the exact hash-bound reference set.'],
      limitations: ['Fixture approval is local to this isolated root.']
    };
    const reviewBytes = Buffer.from(canonicalJson(review));
    const reviewPath = 'review/wave-a-rights.json';
    await mkdir(path.join(root, 'review'), { recursive: true });
    await writeFile(path.join(root, reviewPath), reviewBytes);
    await writeFile(authorizationPath, canonicalJson({
      ...authorization,
      status: 'approved',
      independentReview: {
        status: 'pass',
        reviewPath,
        reviewSha256: sha256(reviewBytes),
        reviewedAt: NOW
      }
    }));
  } else {
    await writeFile(authorizationPath, canonicalJson({
      ...authorization,
      status: 'pending-independent-review',
      independentReview: { status: 'pending' }
    }));
  }
  return root;
}

async function providerSource(width, height, color, { inset = 8, alpha = 1 } = {}) {
  return sharp({
    create: { width, height, channels: 4, background: '#ff00ffff' }
  }).composite([{
    input: await sharp({
      create: {
        width: width - inset * 2,
        height: height - inset * 2,
        channels: 4,
        background: { ...color, alpha }
      }
    }).png().toBuffer(),
    left: inset,
    top: inset
  }]).png({ adaptiveFiltering: false, palette: false }).toBuffer();
}

async function writeInput(root, name, bytes) {
  const target = path.join(root, 'operator-input', name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return target;
}

async function terrainCompositionRequest(root, job, {
  name = 'terrain-material.png',
  width = 128,
  height = 128
} = {}) {
  const actualWidth = width;
  const raw = Buffer.alloc(actualWidth * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < actualWidth; x += 1) {
      const offset = (y * actualWidth + x) * 4;
      raw[offset] = 25 + ((x * 5 + y * 3) % 150);
      raw[offset + 1] = 45 + ((x * 2 + y * 7) % 140);
      raw[offset + 2] = 15 + ((x * 11 + y * 5) % 100);
      raw[offset + 3] = 255;
    }
  }
  const bytes = await sharp(raw, { raw: { width: actualWidth, height, channels: 4 } })
    .png({ adaptiveFiltering: false, palette: false, compressionLevel: 9 })
    .toBuffer();
  const sourceOriginal = await writeInput(root, name, bytes);
  const inputs = [{
    role: 'base-0',
    sourceOriginal,
    cropRect: { x: 0, y: 0, width, height }
  }];
  return {
    originKind: 'deterministic-derived',
    composerVersion: TERRAIN_COMPOSER_VERSION,
    algorithm: TERRAIN_COMPOSER_ALGORITHM,
    configSha256: TERRAIN_COMPOSER_CONFIG_SHA256,
    maskSetSha256: TERRAIN_COMPOSER_MASK_SET_SHA256,
    inputs
  };
}

async function writeLargeUniquePngs(root, count, {
  prefix,
  relativeDirectory = 'operator-input'
}) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const marker = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: 20 + index, g: 80, b: 40, alpha: 1 }
      }
    }).png().toBuffer();
    const bytes = await sharp({
      create: { width: 2048, height: 2048, channels: 4, background: '#ff00ffff' }
    }).composite([{ input: marker, left: 1022, top: 1022 }])
      .png({ adaptiveFiltering: false, palette: false })
      .toBuffer();
    const absolute = path.join(root, relativeDirectory, `${prefix}-${index}.png`);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
    records.push({
      absolute,
      relative: path.relative(root, absolute).split(path.sep).join('/'),
      bytes,
      sha256: sha256(bytes)
    });
  }
  return records;
}

async function sourcesForJob(root, job, { scale = 2, prefix = 'source', shared = false } = {}) {
  const required = job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  if (shared) {
    const maxX = Math.max(...required.map(({ targetRect }) => targetRect.x + targetRect.width));
    const maxY = Math.max(...required.map(({ targetRect }) => targetRect.y + targetRect.height));
    const source = await writeInput(root, `${prefix}-atlas.png`, await providerSource(
      maxX * scale,
      maxY * scale,
      { r: 80, g: 120, b: 180 },
      { inset: 2 }
    ));
    return required.map((unit) => ({
      unitId: unit.unitId,
      sourceOriginal: source,
      cropRect: {
        x: unit.targetRect.x * scale,
        y: unit.targetRect.y * scale,
        width: unit.targetRect.width * scale,
        height: unit.targetRect.height * scale
      }
    }));
  }
  const records = [];
  for (const [index, unit] of required.entries()) {
    const color = {
      r: 40 + (index * 47) % 190,
      g: 80 + (index * 71) % 150,
      b: 20 + (index * 31) % 50
    };
    const sourceWidth = unit.targetRect.width * scale;
    const sourceHeight = unit.targetRect.height * scale;
    const bytes = job.category === 'character'
      ? await sharp({
          create: { width: sourceWidth, height: sourceHeight, channels: 4, background: '#ff00ffff' }
        }).composite([{
          input: await sharp({
            create: {
              width: (32 + (index % 8)) * scale,
              height: (68 + (index % 11)) * scale,
              channels: 4,
              background: { ...color, alpha: 1 }
            }
          }).png().toBuffer(),
          left: Math.floor((sourceWidth - (32 + (index % 8)) * scale) / 2),
          top: sourceHeight - (68 + (index % 11)) * scale
        }]).png({ adaptiveFiltering: false, palette: false }).toBuffer()
      : await providerSource(
          sourceWidth,
          sourceHeight,
          color,
          { inset: Math.max(8, scale * 4) }
        );
    records.push({
      unitId: unit.unitId,
      sourceOriginal: await writeInput(root, `${prefix}-${String(index).padStart(3, '0')}.png`, bytes)
    });
  }
  return records;
}

async function identitySource(root, name = 'identity.png', colors = [
  '#b04040ff', '#4070b0ff', '#40a060ff', '#a08030ff'
]) {
  const width = 384;
  const height = 192;
  const cells = [];
  for (let index = 0; index < 4; index += 1) {
    cells.push({
      input: await sharp({
        create: { width: 72, height: 160, channels: 4, background: colors[index] }
      }).png().toBuffer(),
      left: index * 96 + 12,
      top: 16
    });
  }
  const bytes = await sharp({
    create: { width, height, channels: 4, background: '#ff00ffff' }
  }).composite(cells).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  return writeInput(root, name, bytes);
}

async function monolithicSourcesForJob(root, job, { scale = 2, prefix = 'atlas' } = {}) {
  const required = job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  const padding = 8;
  const width = job.artifactContracts[0].outputSize.width * scale + padding * 2;
  const height = job.artifactContracts[0].outputSize.height * scale + padding * 2;
  const composites = [];
  for (const [index, unit] of required.entries()) {
    const cellWidth = unit.targetRect.width * scale;
    const cellHeight = unit.targetRect.height * scale;
    composites.push({
      input: await sharp({
        create: {
          width: cellWidth,
          height: cellHeight,
          channels: 4,
          background: { r: 62, g: 110, b: 58, alpha: 1 }
        }
      }).png().toBuffer(),
      left: padding + unit.targetRect.x * scale,
      top: padding + unit.targetRect.y * scale
    });
    composites.push({
      input: await sharp({
        create: {
          width: 8 * scale,
          height: 8 * scale,
          channels: 4,
          background: {
            r: 20 + (index * 37) % 220,
            g: 80 + (index * 61) % 150,
            b: 10 + (index * 19) % 60,
            alpha: 1
          }
        }
      }).png().toBuffer(),
      left: padding + unit.targetRect.x * scale + Math.floor((cellWidth - 8 * scale) / 2),
      top: padding + unit.targetRect.y * scale + Math.floor((cellHeight - 8 * scale) / 2)
    });
  }
  const bytes = await sharp({
    create: { width, height, channels: 4, background: '#ff00ffff' }
  }).composite(composites).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const sourceOriginal = await writeInput(root, `${prefix}.png`, bytes);
  return required.map((unit) => ({
    unitId: unit.unitId,
    sourceOriginal,
    cropRect: {
      x: padding + unit.targetRect.x * scale,
      y: padding + unit.targetRect.y * scale,
      width: unit.targetRect.width * scale,
      height: unit.targetRect.height * scale
    }
  }));
}

async function monolithicCharacterSourcesForJob(root, job, {
  scale = 2,
  prefix = 'character-atlas'
} = {}) {
  const required = job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  assert.equal(required.length, 40);
  const padding = 8;
  const output = job.artifactContracts[0].outputSize;
  const width = output.width * scale + padding * 2;
  const height = output.height * scale + padding * 2;
  const composites = [];
  for (const [index, unit] of required.entries()) {
    const cellWidth = unit.targetRect.width * scale;
    const cellHeight = unit.targetRect.height * scale;
    const bodyWidth = (32 + (index % 8)) * scale;
    const bodyHeight = (68 + (index % 11)) * scale;
    const color = {
      r: 40 + (index * 47) % 190,
      g: 80 + (index * 71) % 150,
      b: 20 + (index * 31) % 50,
      alpha: 1
    };
    composites.push({
      input: await sharp({
        create: { width: bodyWidth, height: bodyHeight, channels: 4, background: color }
      }).png().toBuffer(),
      left: padding + unit.targetRect.x * scale + Math.floor((cellWidth - bodyWidth) / 2),
      top: padding + unit.targetRect.y * scale + cellHeight - bodyHeight
    });
  }
  const bytes = await sharp({
    create: { width, height, channels: 4, background: '#ff00ffff' }
  }).composite(composites).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const sourceOriginal = await writeInput(root, `${prefix}.png`, bytes);
  return required.map((unit) => ({
    unitId: unit.unitId,
    sourceOriginal,
    cropRect: {
      x: padding + unit.targetRect.x * scale,
      y: padding + unit.targetRect.y * scale,
      width: unit.targetRect.width * scale,
      height: unit.targetRect.height * scale
    }
  }));
}

async function persistResultMutation(root, originalId, nextResult) {
  const manifestPath = path.join(root, 'data', 'local', 'generations.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.results = manifest.results.map((result) => result.id === originalId ? nextResult : result);
  await writeFile(manifestPath, canonicalJson(manifest));
  await writeFile(path.join(root, nextResult.metadataPath), canonicalJson(nextResult));
}

test('Wave A job packs bind 109 definitions to 771 generation units and honest provider-native prompts', async (t) => {
  const root = await fixtureRoot(t);
  const first = await writeWaveAJobPack({ assetId: 'prop.lamp', seed: 'stable' }, {
    root, forgeRoot: root
  });
  assert.deepEqual(Object.keys(first.pack.members).sort(), [
    'authorization', 'definition', 'independentReview', 'job', 'prompt', 'unitPlan'
  ]);
  assert.match(first.job.generationUnits[0].unitPromptText, /provider-native raster/);
  assert.match(first.job.generationUnits[0].unitPromptText, /one semantic unit/);
  assert.doesNotMatch(first.job.generationUnits[0].unitPromptText, /Generate an exact 32x64 image/);
  assert.equal(first.job.promptSha256, 'fb6e1fdd0d701f15d218ed71809e2cb8b6cb3461be717a58986ba254119bbd9a');
  assert.equal(first.job.generationUnits[0].unitPromptSha256, 'febe039d66e3844caec6357d5120ccd0cc59e04d0e19e96949aa73b23a93a488');
  assert.equal(first.job.generationUnitSetSha256, 'f2c3ffc4384b2ac557ba86be2d842b90ae3dde5573b3d0ad7668247ee0685cc7');
  assert.equal(
    first.pack.members.unitPlan.sha256,
    '44a0b43a8f2ffa8112a714e76621d18b33e7488b019672ac4aa20b19143db5f7'
  );
  assert.equal(first.job.technicalGates.inputPolicy.chromaKeyTolerance, 0);
  assert.equal(
    first.job.technicalGates.inputPolicy.canonicalBackgroundRemoval.method,
    'auto-border-soft-matte-v3'
  );
  assert.deepEqual(first.job.technicalGates.inputPolicy.sourceLimits, {
    maxSourcePixels: 4_194_304,
    maxUniqueSourcePixels: 67_108_864,
    maxUniqueSourceBytes: 209_715_200
  });
  assert.equal((await verifyWaveAJobPack(first.result.jobPackPath, { root, forgeRoot: root })).job.id, first.job.id);
  const repeat = await writeWaveAJobPack({ assetId: 'prop.lamp', seed: 'stable' }, {
    root, forgeRoot: root
  });
  assert.equal(repeat.resumed, true);
  assert.deepEqual(repeat.result, first.result);
  const characterPerUnit = await buildWaveAJob({ assetId: 'character.player' }, { forgeRoot: root });
  assert.equal(characterPerUnit.job.generationMode, 'per-unit');
  assert.equal(characterPerUnit.job.promptSha256, '6db80c1f42eb8a24092240029bc511148b0266924e5853d6da93face622598e4');
  assert.equal(characterPerUnit.job.generationUnitSetSha256, 'aaf4d2a77560d33c585aeafa0441816a18609cb1a0d0e24c58086690f34a7bfc');
  assert.equal(characterPerUnit.job.generationUnits[0].unitPromptSha256, '16e85ad4b4d47f4846e2c19f57f680f1f92fca3c0dd2749d14779ae54ed33b74');
  assert.equal(characterPerUnit.job.generationUnits[39].unitPromptSha256, '5b4eaba1b07499ed9b01a2326ec6c66fee837d02bb4eb6a51a71fbca01dd80af');
  const characterAtlas = await buildWaveAJob({
    assetId: 'character.player', generationMode: 'monolithic-atlas'
  }, { forgeRoot: root });
  assert.equal(characterAtlas.job.generationMode, 'monolithic-atlas');
  assert.notEqual(characterAtlas.job.id, characterPerUnit.job.id);
  assert.notEqual(characterAtlas.job.provenanceKey, characterPerUnit.job.provenanceKey);
  assert.notEqual(characterAtlas.job.generationUnitSetSha256, characterPerUnit.job.generationUnitSetSha256);
  assert.match(characterAtlas.job.generationUnits[0].unitPromptText, /10-column x 4-row monolithic character atlas/);
  assert.doesNotMatch(characterAtlas.job.generationUnits[0].unitPromptText, /Generate exactly one semantic unit/);
  const terrainPerUnit = await buildWaveAJob({ assetId: 'terrain.grass' }, { forgeRoot: root });
  const terrainComposed = await buildWaveAJob({
    assetId: 'terrain.grass', generationMode: 'terrain-composed-atlas'
  }, { forgeRoot: root });
  assert.notEqual(terrainComposed.job.id, terrainPerUnit.job.id);
  assert.notEqual(terrainComposed.job.generationUnitSetSha256, terrainPerUnit.job.generationUnitSetSha256);
  assert.equal(terrainComposed.job.terrainCompositionPlan.configSha256, TERRAIN_COMPOSER_CONFIG_SHA256);
  assert.match(terrainComposed.job.promptText, /one material crop image for the requested input role/);
  assert.match(terrainComposed.job.promptText, /Accepted provider source formats: PNG, JPEG, or WebP/);
  assert.doesNotMatch(terrainComposed.job.promptText, /Generation background key:/);
  assert.deepEqual(terrainComposed.job.technicalGates.inputPolicy, {
    format: 'png-jpeg-webp',
    nativeOutputSize: false,
    resizeKernel: 'nearest',
    allowEnlargement: false,
    allowImportMutation: false,
    expectedGenerator: 'codex-imagegen-built-in',
    chromaKeyColor: null,
    chromaKeyTolerance: null,
    sourceLimits: {
      maxSourcePixels: 4_194_304,
      maxUniqueSourcePixels: 67_108_864,
      maxUniqueSourceBytes: 209_715_200
    },
    hardAlphaThreshold: null,
    hiddenRgbPolicy: 'not-applicable-fully-opaque-input',
    transparentUnitPolicy: 'zero-rgba',
    assemblyKernel: TERRAIN_COMPOSER_ALGORITHM,
    terrainMaterialInputs: {
      acceptedFormats: ['png', 'jpeg', 'webp'],
      cropShape: 'square',
      minimumCropSize: 64,
      sourceAlpha: 'fully-opaque',
      forbiddenOpaqueRgb: '#FF00FF',
      outputOrigin: 'deterministic-derived',
      providerInvocationEvidence: 'unverified-no-provider-receipt'
    }
  });
  assert.match(terrainComposed.job.generationUnits[0].unitPromptText, /deterministic-derived output/);
  assert.doesNotMatch(terrainComposed.job.generationUnits[0].unitPromptText, /Generate exactly one semantic unit/);
  const help = await main(['help']);
  assert.ok(help.commands.includes(
    'make-job-v2 --asset <character-asset-id> --mode monolithic-atlas [--seed <seed>]'
  ));
  assert.ok(help.commands.includes(
    'make-job-v2 --asset <terrain-asset-id> --mode terrain-composed-atlas [--seed <seed>]'
  ));
  await assert.rejects(
    () => buildWaveAJob({
      assetId: 'character.player', generationMode: 'terrain-composed-atlas'
    }, { forgeRoot: root }),
    /available only for Wave A terrain/
  );
  await assert.rejects(
    () => buildWaveAJob({
      assetId: 'terrain.cliff', generationMode: 'terrain-composed-atlas'
    }, { forgeRoot: root }),
    /excludes terrain\.cliff until directional face inputs are defined/
  );
  await assert.rejects(
    () => main(['make-job-v2', '--asset', 'character.player', '--mode', 'unsupported']),
    /Unsupported Wave A generation mode/
  );
});

test('legacy exact-key replay keeps tolerance zero and does not treat near-magenta as transparent', async () => {
  const sourceRaw = Buffer.from([
    255, 0, 255, 255,
    251, 3, 249, 255,
    1, 2, 3, 255,
    9, 8, 7, 100
  ]);
  const sourceBytes = await sharp(sourceRaw, {
    raw: { width: 2, height: 2, channels: 4 }
  }).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const expectedRaw = Buffer.from([
    0, 0, 0, 0,
    251, 3, 249, 255,
    1, 2, 3, 255,
    0, 0, 0, 0
  ]);
  const artifactBytes = await sharp(expectedRaw, {
    raw: { width: 2, height: 2, channels: 4 }
  }).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  await assert.doesNotReject(() => verifyWaveATransformReplay(
    { buffer: sourceBytes, sourceFormat: 'png' },
    { buffer: artifactBytes },
    {
      transformSteps: ['crop', 'chroma-key-remove', 'nearest-downscale', 'hard-alpha'],
      cropRect: { x: 0, y: 0, width: 2, height: 2 },
      chromaKey: { keyColor: '#FF00FF', tolerance: 0 },
      alphaThreshold: 127
    },
    { width: 2, height: 2 }
  ));
});

test('v3 auto-border matte removes only four-neighbor-connected key fringe and preserves isolated purple', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const width = 32;
  const height = 64;
  const raw = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < raw.length; offset += 4) {
    raw[offset] = 251;
    raw[offset + 1] = 3;
    raw[offset + 2] = 249;
    raw[offset + 3] = 255;
  }
  for (let y = 12; y < 56; y += 1) {
    for (let x = 8; x < 24; x += 1) {
      const offset = (y * width + x) * 4;
      raw[offset] = 40;
      raw[offset + 1] = 90;
      raw[offset + 2] = 120;
      raw[offset + 3] = 255;
    }
  }
  for (let y = 20; y < 28; y += 1) {
    const fringeOffset = (y * width + 7) * 4;
    raw[fringeOffset] = 205;
    raw[fringeOffset + 1] = 50;
    raw[fringeOffset + 2] = 203;
    raw[fringeOffset + 3] = 255;
  }
  for (let y = 30; y < 34; y += 1) {
    for (let x = 14; x < 18; x += 1) {
      const purpleOffset = (y * width + x) * 4;
      raw[purpleOffset] = 128;
      raw[purpleOffset + 1] = 0;
      raw[purpleOffset + 2] = 128;
      raw[purpleOffset + 3] = 255;
    }
  }
  const disconnectedNearKeyOffset = (36 * width + 13) * 4;
  raw[disconnectedNearKeyOffset] = 216;
  raw[disconnectedNearKeyOffset + 1] = 4;
  raw[disconnectedNearKeyOffset + 2] = 196;
  raw[disconnectedNearKeyOffset + 3] = 255;
  const isolatedExactNearKeyOffset = (36 * width + 18) * 4;
  raw[isolatedExactNearKeyOffset] = 240;
  raw[isolatedExactNearKeyOffset + 1] = 3;
  raw[isolatedExactNearKeyOffset + 2] = 238;
  raw[isolatedExactNearKeyOffset + 3] = 255;
  const connectedExactNearKeyOffset = (24 * width + 7) * 4;
  raw[connectedExactNearKeyOffset] = 240;
  raw[connectedExactNearKeyOffset + 1] = 3;
  raw[connectedExactNearKeyOffset + 2] = 238;
  raw[connectedExactNearKeyOffset + 3] = 255;
  const sourceBytes = await sharp(raw, {
    raw: { width, height, channels: 4 }
  }).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  for (let offset = 0; offset < raw.length; offset += 4) {
    assert.notDeepEqual([...raw.subarray(offset, offset + 3)], [255, 0, 255]);
  }
  const sourceOriginal = await writeInput(root, 'near-magenta-lamp.png', sourceBytes);
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: pack.result.jobPackPath,
    unitSources: [{ unitId: pack.job.generationUnits[0].unitId, sourceOriginal }],
    identityBindingPath: null
  }, { root, forgeRoot: root });
  const unit = imported.result.unitAssemblyV2.units[0];
  assert.equal(
    imported.result.unitAssemblyV2.assemblyAlgorithm,
    'auto-border-connected-fringe-soft-matte-nearest-hard-alpha/raw-copy-v5'
  );
  assert.deepEqual(
    imported.result.unitAssemblyV2.sourceLimits,
    pack.job.technicalGates.inputPolicy.sourceLimits
  );
  assert.equal(unit.transformEvidence.detectedKeyColor, '#FB03F9');
  assert.equal(unit.transformEvidence.detectedKeyExpectedDistance, 6);
  assert.equal(unit.transformEvidence.borderInlierPermille, 1000);
  assert.deepEqual(unit.transformSteps, [
    'auto-border-key-detect', 'crop', 'soft-matte-despill',
    'zero-hidden-rgb', 'nearest-downscale', 'hard-alpha-zero-hidden-rgb'
  ]);
  const persistedRawBytes = await readFile(path.join(root, unit.sourceSnapshot.path));
  assert.deepEqual(persistedRawBytes, sourceBytes);
  assert.equal(unit.sourceSnapshot.sha256, sha256(sourceBytes));
  const transformedBytes = await readFile(path.join(root, unit.transformedSnapshot.path));
  const transformed = await sharp(transformedBytes).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...transformed.subarray(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual(
    [...transformed.subarray(connectedExactNearKeyOffset, connectedExactNearKeyOffset + 4)],
    [0, 0, 0, 0]
  );
  for (let y = 30; y < 34; y += 1) {
    for (let x = 14; x < 18; x += 1) {
      const purpleOffset = (y * width + x) * 4;
      assert.deepEqual(
        [...transformed.subarray(purpleOffset, purpleOffset + 4)],
        [128, 0, 128, 255]
      );
    }
  }
  assert.deepEqual(
    [...transformed.subarray(disconnectedNearKeyOffset, disconnectedNearKeyOffset + 4)],
    [216, 4, 196, 255]
  );
  assert.deepEqual(
    [...transformed.subarray(isolatedExactNearKeyOffset, isolatedExactNearKeyOffset + 4)],
    [240, 3, 238, 255]
  );
  for (let offset = 0; offset < transformed.length; offset += 4) {
    assert.ok(transformed[offset + 3] === 0 || transformed[offset + 3] === 255);
    if (transformed[offset + 3] === 0) {
      assert.deepEqual([...transformed.subarray(offset, offset + 3)], [0, 0, 0]);
    }
  }
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
});

test('auto-border policy rejects wrong and non-uniform provider borders before pending writes', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const ledgerCountBefore = (await readLocalGenerationManifest(root)).results.length;
  const width = 32;
  const height = 64;
  const wrongBytes = await sharp({
    create: { width, height, channels: 4, background: '#0060ffff' }
  }).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const mixedRaw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const color = x < Math.ceil(width * 0.6) ? [251, 3, 249] : [0, 255, 0];
      mixedRaw[offset] = color[0];
      mixedRaw[offset + 1] = color[1];
      mixedRaw[offset + 2] = color[2];
      mixedRaw[offset + 3] = 255;
    }
  }
  const mixedBytes = await sharp(mixedRaw, {
    raw: { width, height, channels: 4 }
  }).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const cases = [
    [await writeInput(root, 'wrong-border.png', wrongBytes), /not close enough/],
    [await writeInput(root, 'mixed-border.png', mixedBytes), /non-uniform source border/]
  ];
  for (const [sourceOriginal, pattern] of cases) {
    await assert.rejects(() => importWaveACandidate({
      assetId: 'prop.lamp',
      jobPackPath: pack.result.jobPackPath,
      unitSources: [{ unitId: pack.job.generationUnits[0].unitId, sourceOriginal }],
      identityBindingPath: null
    }, { root, forgeRoot: root }), pattern);
  }
  assert.equal((await readLocalGenerationManifest(root)).results.length, ledgerCountBefore);
});

test('Wave A source pixel budgets reject single and aggregate oversized input before pending writes', async (t) => {
  const root = await fixtureRoot(t);
  const lamp = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const grass = await makeWaveAJob({ assetId: 'terrain.grass' }, { root, forgeRoot: root });
  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const ledgerBefore = await readFile(ledgerPath);
  const lampPending = path.join(root, 'generated', 'props', 'pending');
  const grassPending = path.join(root, 'generated', 'terrains', 'pending');
  const lampTreeBefore = await hashTree(lampPending);
  const grassTreeBefore = await hashTree(grassPending);

  const oversized = await writeInput(root, 'oversized-single.png', await sharp({
    create: { width: 2049, height: 2048, channels: 4, background: '#ff00ffff' }
  }).png({ adaptiveFiltering: false, palette: false }).toBuffer());
  await assert.rejects(() => importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: lamp.result.jobPackPath,
    unitSources: [{ unitId: lamp.job.generationUnits[0].unitId, sourceOriginal: oversized }],
    identityBindingPath: null
  }, { root, forgeRoot: root }), /pixel|limit/i);

  const required = grass.job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  const unique = await writeLargeUniquePngs(root, 17, { prefix: 'aggregate' });
  const aggregateSources = required.map((unit, index) => ({
    unitId: unit.unitId,
    sourceOriginal: index < unique.length
      ? unique[index].absolute
      : path.join(root, 'operator-input', 'must-not-be-read-invalid.png')
  }));
  await assert.rejects(() => importWaveACandidate({
    assetId: 'terrain.grass',
    jobPackPath: grass.result.jobPackPath,
    unitSources: aggregateSources,
    identityBindingPath: null
  }, { root, forgeRoot: root }), /aggregate unique source pixel limit exceeded/);

  assert.deepEqual(await readFile(ledgerPath), ledgerBefore);
  assert.equal(await hashTree(lampPending), lampTreeBefore);
  assert.equal(await hashTree(grassPending), grassTreeBefore);
});

test('persisted replay stops on the 17th unique source budget crossing before an invalid 18th snapshot', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({
    assetId: 'terrain.grass',
    generationMode: 'monolithic-atlas'
  }, { root, forgeRoot: root });
  const unitSources = await monolithicSourcesForJob(root, pack.job, { prefix: 'replay-base' });
  const imported = await importWaveACandidate({
    assetId: 'terrain.grass',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  }, { root, forgeRoot: root });
  const large = await writeLargeUniquePngs(root, 17, {
    prefix: 'replay-budget',
    relativeDirectory: 'generated/terrains/pending/sources/rolling-budget'
  });
  const forged = structuredClone(imported.result);
  const sourceLedgers = forged.unitAssemblyV2.units.filter(({ sourceRequired }) => sourceRequired);
  for (let index = 0; index < 17; index += 1) {
    sourceLedgers[index].sourceSnapshot = {
      path: large[index].relative,
      sha256: large[index].sha256,
      format: 'png',
      width: 2048,
      height: 2048
    };
  }
  sourceLedgers[17].sourceSnapshot = {
    path: 'generated/terrains/pending/sources/rolling-budget/must-not-be-read-invalid.png',
    sha256: '0'.repeat(64),
    format: 'png',
    width: 2048,
    height: 2048
  };
  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const ledgerBefore = await readFile(ledgerPath);
  const pendingRoot = path.join(root, 'generated', 'terrains', 'pending');
  const pendingBefore = await hashTree(pendingRoot);
  await assert.rejects(
    () => verifyPersistedWaveAUnitAssembly(forged, { root, forgeRoot: root }),
    /aggregate unique source pixel limit exceeded/
  );
  assert.deepEqual(await readFile(ledgerPath), ledgerBefore);
  assert.equal(await hashTree(pendingRoot), pendingBefore);
});

test('identity source joins the same rolling budget before transform or pending writes', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'character.player' }, { root, forgeRoot: root });
  const identity = await identitySource(root, 'rolling-budget-identity.png');
  const bound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  const large = await writeLargeUniquePngs(root, 16, { prefix: 'identity-budget' });
  const required = pack.job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  const duplicatePaths = [];
  for (let index = 0; index < required.length - large.length; index += 1) {
    duplicatePaths.push(await writeInput(
      root,
      `identity-budget-duplicate-${index}.png`,
      large[large.length - 1].bytes
    ));
  }
  const unitSources = required.map((unit, index) => ({
    unitId: unit.unitId,
    sourceOriginal: index < large.length
      ? large[index].absolute
      : duplicatePaths[index - large.length]
  }));
  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const ledgerBefore = await readFile(ledgerPath);
  const pendingRoot = path.join(root, 'generated', 'characters', 'pending');
  const pendingBefore = await hashTree(pendingRoot);
  await assert.rejects(() => importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root }), /aggregate unique source pixel limit exceeded: identity source/);
  assert.deepEqual(await readFile(ledgerPath), ledgerBefore);
  assert.equal(await hashTree(pendingRoot), pendingBefore);
});

test('non-character per-unit import transforms a provider-native source, persists evidence, and stays pending', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'lamp' });
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  }, { root, forgeRoot: root });
  assert.equal(imported.status, 'pending');
  assert.equal(imported.result.unitAssemblyV2.sourceRequiredCount, 1);
  assert.equal(imported.result.unitAssemblyV2.units[0].sourceSnapshot.width, 64);
  assert.equal(imported.result.unitAssemblyV2.units[0].transformedSnapshot.width, 32);
  assert.equal(imported.result.unitAssemblyV2.identityMaster, null);
  assert.equal(imported.approvedTreeSha256Before, imported.approvedTreeSha256After);
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  const repeat = await importWaveACandidate({
    assetId: 'prop.lamp', jobPackPath: pack.result.jobPackPath,
    unitSources, identityBindingPath: null
  }, { root, forgeRoot: root });
  assert.equal(repeat.resumed, true);
  assert.deepEqual(repeat.result, imported.result);
  const requestPath = 'review/import-requests/v2/prop-lamp.json';
  const request = {
    schemaVersion: 2,
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    assetId: 'prop.lamp',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  };
  await mkdir(path.join(root, 'review', 'import-requests', 'v2'), { recursive: true });
  await writeFile(path.join(root, requestPath), canonicalJson(request));
  assert.deepEqual(await readWaveAImportRequest(requestPath, { root }), request);
  assert.equal((await importWaveARequest({ requestPath }, {
    root, forgeRoot: root
  })).resumed, true);
  await writeFile(path.join(root, requestPath), canonicalJson({
    ...request,
    identityMasterSource: { sourceOriginal: unitSources[0].sourceOriginal }
  }));
  await assert.rejects(
    () => readWaveAImportRequest(requestPath, { root }),
    /Invalid Wave A import request/
  );
});

test('character identity is prepared first, bound into 40 issued prompts, then imported as auxiliary evidence', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'character.player' }, { root, forgeRoot: root });
  const identity = await identitySource(root);
  await assert.rejects(
    () => importWaveACandidate({
      assetId: 'character.player',
      jobPackPath: pack.result.jobPackPath,
      unitSources: [],
      identityMasterSource: { sourceOriginal: identity }
    }, { root, forgeRoot: root }),
    /unitSources|identity binding/
  );
  const bound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  assert.equal(bound.binding.units.length, 40);
  assert.equal(Object.hasOwn(bound.binding, 'atlasExecution'), false);
  assert.equal(new Set(bound.binding.units.map(({ executionPromptPath }) => executionPromptPath)).size, 40);
  assert.equal(new Set(bound.binding.units.map(({ consistencyInputSha256 }) => consistencyInputSha256)).size, 1);
  assert.equal(bound.binding.providerInvocationEvidence, 'unverified-no-provider-receipt');
  const verifiedBinding = await verifyWaveAIdentityBinding(bound.bindingPath, { root, forgeRoot: root });
  assert.equal(verifiedBinding.identity.cellHashes.length, 4);
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'player' });
  const imported = await importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root });
  assert.equal(imported.result.unitAssemblyV2.units.length, 40);
  assert.equal(imported.result.unitAssemblyV2.identityMaster.unitExecutionPlanSha256, bound.bindingSha256);
  assert.equal(imported.result.unitAssemblyV2.identityMaster.approvedAsset, false);
  assert.ok(imported.result.inspection.unknown.includes('actual identity image delivery to the provider invocation'));
  assert.ok(imported.result.inspection.unknown.includes('actual source generation after identity-binding issuance'));
  assert.deepEqual(imported.result.inspection.inferred, [
    'The candidate is technically eligible for independent visual inspection.'
  ]);
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
});

test('character monolithic atlas issues one identity-bound 10x4 prompt and replays 40 canonical crops', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({
    assetId: 'character.player', generationMode: 'monolithic-atlas'
  }, { root, forgeRoot: root });
  const identity = await identitySource(root, 'atlas-identity.png');
  const bound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  assert.equal(bound.binding.generationMode, 'monolithic-atlas');
  assert.deepEqual({
    layout: bound.binding.atlasExecution.layout,
    columns: bound.binding.atlasExecution.columns,
    rows: bound.binding.atlasExecution.rows,
    unitCount: bound.binding.atlasExecution.unitOrder.length
  }, {
    layout: 'character-row-major-directions-by-row-frames-by-column',
    columns: 10,
    rows: 4,
    unitCount: 40
  });
  assert.deepEqual(
    bound.binding.atlasExecution.unitOrder,
    pack.job.generationUnits.map(({ unitId }) => unitId)
  );
  assert.equal(new Set(bound.binding.units.map(({ executionPromptPath }) => executionPromptPath)).size, 1);
  assert.equal(new Set(bound.binding.units.map(({ executionPromptSha256 }) => executionPromptSha256)).size, 1);
  const atlasPromptBytes = await readFile(path.join(
    root,
    bound.binding.atlasExecution.executionPromptPath
  ));
  assert.equal(sha256(atlasPromptBytes), bound.binding.atlasExecution.executionPromptSha256);
  const atlasPrompt = atlasPromptBytes.toString('utf8');
  assert.match(atlasPrompt, new RegExp(pack.job.id));
  assert.match(atlasPrompt, new RegExp(pack.job.generationUnitSetSha256));
  assert.match(atlasPrompt, new RegExp(bound.binding.identityMaster.consistencyInputSha256));
  assert.match(atlasPrompt, /10 columns/);
  assert.match(atlasPrompt, /4 rows/);
  const atlasPromptAbsolute = path.join(root, bound.binding.atlasExecution.executionPromptPath);
  await writeFile(atlasPromptAbsolute, Buffer.from('tampered atlas execution prompt'));
  await assert.rejects(() => verifyWaveAIdentityBinding(bound.bindingPath, {
    root, forgeRoot: root
  }), /prompt mismatch/);
  await writeFile(atlasPromptAbsolute, atlasPromptBytes);
  await assert.doesNotReject(() => verifyWaveAIdentityBinding(bound.bindingPath, {
    root, forgeRoot: root
  }));

  const unitSources = await monolithicCharacterSourcesForJob(root, pack.job, {
    prefix: 'player-monolithic'
  });
  const imported = await importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root });
  assert.equal(imported.status, 'pending');
  assert.equal(imported.result.unitAssemblyV2.generationMode, 'monolithic-atlas');
  assert.equal(imported.result.unitAssemblyV2.units.length, 40);
  assert.equal(new Set(imported.result.unitAssemblyV2.units
    .map(({ sourceSnapshot }) => sourceSnapshot.path)).size, 1);
  assert.equal(new Set(imported.result.unitAssemblyV2.units
    .map(({ sourceOriginal }) => sourceOriginal.sha256)).size, 1);
  assert.equal(new Set(imported.result.unitAssemblyV2.units
    .map(({ sourceOriginal }) => canonicalJson(sourceOriginal.cropRect))).size, 40);
  assert.equal(new Set(imported.result.unitAssemblyV2.units
    .map(({ outputCellSha256 }) => outputCellSha256)).size, 40);
  assert.notEqual(
    imported.result.unitAssemblyV2.units[0].sourceOriginal.sha256,
    imported.result.unitAssemblyV2.identityMaster.sourceOriginal.sha256
  );
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');

  const original = structuredClone(imported.result);
  const forged = structuredClone(original);
  [forged.unitAssemblyV2.units[0].sourceOriginal.cropRect,
    forged.unitAssemblyV2.units[1].sourceOriginal.cropRect] = [
    forged.unitAssemblyV2.units[1].sourceOriginal.cropRect,
    forged.unitAssemblyV2.units[0].sourceOriginal.cropRect
  ];
  await persistResultMutation(root, original.id, forged);
  await assert.rejects(
    () => processCandidate({ generationId: original.id }, { root, forgeRoot: root }),
    /canonical replay|canonical row-major/
  );
  await persistResultMutation(root, original.id, original);
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
});

test('character atlas rejects retroactive sharing and malformed crop or source claims without writes', async (t) => {
  const root = await fixtureRoot(t);
  const perUnitPack = await makeWaveAJob({ assetId: 'character.player' }, {
    root, forgeRoot: root
  });
  const monolithicPack = await makeWaveAJob({
    assetId: 'character.player', generationMode: 'monolithic-atlas'
  }, { root, forgeRoot: root });
  assert.notEqual(perUnitPack.job.id, monolithicPack.job.id);
  const identity = await identitySource(root, 'negative-atlas-identity.png');
  const identityMasterSource = {
    sourceOriginal: identity,
    cropRect: { x: 0, y: 0, width: 384, height: 192 }
  };
  const perUnitBound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: perUnitPack.result.jobPackPath,
    identityMasterSource
  }, { root, forgeRoot: root });
  const monolithicBound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: monolithicPack.result.jobPackPath,
    identityMasterSource
  }, { root, forgeRoot: root });
  const valid = await monolithicCharacterSourcesForJob(root, monolithicPack.job, {
    prefix: 'negative-player-monolithic'
  });
  const atlasBytes = await readFile(valid[0].sourceOriginal);
  const mixedPath = await writeInput(root, 'negative-player-mixed-copy.png', atlasBytes);
  const aliasBound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: monolithicPack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: valid[0].sourceOriginal,
      cropRect: { x: 8, y: 8, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });

  const swapped = structuredClone(valid);
  [swapped[0].cropRect, swapped[1].cropRect] = [swapped[1].cropRect, swapped[0].cropRect];
  const overlapping = structuredClone(valid);
  overlapping[1].cropRect = { ...overlapping[0].cropRect, x: overlapping[0].cropRect.x + 1 };
  const unequal = structuredClone(valid);
  unequal[39].cropRect.width += 2;
  unequal[39].cropRect.height += 4;
  const mixed = structuredClone(valid);
  mixed[39].sourceOriginal = mixedPath;
  const extra = [...structuredClone(valid), {
    unitId: 'unit_999_primary_extra',
    sourceOriginal: valid[0].sourceOriginal,
    cropRect: structuredClone(valid[0].cropRect)
  }];
  const cases = [
    ['old per-unit shared source', valid, perUnitPack, perUnitBound.bindingPath, /unique primary source path and bytes/],
    ['swapped crops', swapped, monolithicPack, monolithicBound.bindingPath, /canonical row-major/],
    ['partially overlapping crops', overlapping, monolithicPack, monolithicBound.bindingPath, /must not overlap/],
    ['unequal crop size', unequal, monolithicPack, monolithicBound.bindingPath, /equal-size cropRects/],
    ['missing crop claim', valid.slice(0, 39), monolithicPack, monolithicBound.bindingPath, /coverage mismatch/],
    ['extra crop claim', extra, monolithicPack, monolithicBound.bindingPath, /coverage mismatch/],
    ['mixed source', mixed, monolithicPack, monolithicBound.bindingPath, /one shared source/],
    ['identity source alias', valid, monolithicPack, aliasBound.bindingPath, /identity master cannot alias/]
  ];
  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const pendingRoot = path.join(root, 'generated', 'characters', 'pending');
  const approvedBefore = await hashApprovedTree(root);
  const ledgerBefore = await readFile(ledgerPath);
  const pendingBefore = await hashTree(pendingRoot);
  for (const [label, unitSources, pack, identityBindingPath, pattern] of cases) {
    await assert.rejects(() => importWaveACandidate({
      assetId: 'character.player',
      jobPackPath: pack.result.jobPackPath,
      unitSources,
      identityBindingPath
    }, { root, forgeRoot: root }), pattern, label);
    assert.deepEqual(await readFile(ledgerPath), ledgerBefore, `${label}: ledger changed`);
    assert.equal(await hashTree(pendingRoot), pendingBefore, `${label}: pending tree changed`);
    assert.equal(await hashApprovedTree(root), approvedBefore, `${label}: approved tree changed`);
  }
});

test('monolithic atlas mode requires one source with exact unique crops and preserves semantic zero cells', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({
    assetId: 'terrain.grass', generationMode: 'monolithic-atlas'
  }, { root, forgeRoot: root });
  const unitSources = await monolithicSourcesForJob(root, pack.job, { prefix: 'grass-atlas' });
  const imported = await importWaveACandidate({
    assetId: 'terrain.grass',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  }, { root, forgeRoot: root });
  assert.equal(imported.result.unitAssemblyV2.sourceRequiredCount, 18);
  assert.equal(imported.result.unitAssemblyV2.expectations['semantic-transparent'], 1);
  assert.equal(imported.result.unitAssemblyV2.expectations['reserved-transparent'], 6);
  assert.equal(new Set(imported.result.unitAssemblyV2.units
    .filter(({ sourceRequired }) => sourceRequired)
    .map(({ sourceSnapshot }) => sourceSnapshot.path)).size, 1);
  assert.ok(imported.result.unitAssemblyV2.units
    .filter(({ sourceRequired }) => !sourceRequired)
    .every(({ sourceSnapshot, transformedSnapshot, pixelAudit }) =>
      sourceSnapshot === null && transformedSnapshot === null && pixelAudit.visiblePixels === 0));
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  const original = structuredClone(imported.result);
  const zeroIndex = original.unitAssemblyV2.units.findIndex(
    ({ expectation }) => expectation === 'semantic-transparent'
  );
  const mutations = [
    (value) => {
      value.unitAssemblyV2.units[zeroIndex].outputCellSha256 = 'f'.repeat(64);
    },
    (value) => {
      value.unitAssemblyV2.units[zeroIndex].pixelAudit.visiblePixels = 1;
    },
    (value) => {
      [value.unitAssemblyV2.units[0], value.unitAssemblyV2.units[1]] =
        [value.unitAssemblyV2.units[1], value.unitAssemblyV2.units[0]];
    }
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(original);
    mutate(forged);
    await persistResultMutation(root, original.id, forged);
    await assert.rejects(
      () => processCandidate({ generationId: original.id }, { root, forgeRoot: root })
    );
    await persistResultMutation(root, original.id, original);
  }
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
});

test('terrain-composed-atlas persists provider originals separately and deep-replays every derived cell', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({
    assetId: 'terrain.grass', generationMode: 'terrain-composed-atlas', seed: 'compose-v1'
  }, { root, forgeRoot: root });
  const unitPlan = JSON.parse(await readFile(
    path.join(root, pack.pack.members.unitPlan.path),
    'utf8'
  ));
  assert.deepEqual(unitPlan.terrainCompositionPlan, pack.job.terrainCompositionPlan);
  const terrainComposition = await terrainCompositionRequest(root, pack.job);
  const request = {
    schemaVersion: 2,
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    assetId: 'terrain.grass',
    jobPackPath: pack.result.jobPackPath,
    terrainComposition,
    identityBindingPath: null
  };
  const requestPath = 'review/import-requests/v2/terrain-grass-compose.json';
  await mkdir(path.join(root, path.dirname(requestPath)), { recursive: true });
  await writeFile(path.join(root, requestPath), canonicalJson(request));
  assert.deepEqual(await readWaveAImportRequest(requestPath, { root }), request);
  const approvedBefore = await hashApprovedTree(root);
  const imported = await importWaveARequest({ requestPath }, { root, forgeRoot: root });
  assert.equal(imported.approvedTreeSha256Before, approvedBefore);
  assert.equal(imported.approvedTreeSha256After, approvedBefore);
  const result = imported.result;
  assert.equal(result.unitAssemblyV2.generationMode, 'terrain-composed-atlas');
  assert.equal(result.unitAssemblyV2.assemblyAlgorithm, TERRAIN_COMPOSER_ALGORITHM);
  assert.equal(result.unitAssemblyV2.terrainComposition.originKind, 'deterministic-derived');
  assert.equal(result.unitAssemblyV2.terrainComposition.configSha256, TERRAIN_COMPOSER_CONFIG_SHA256);
  assert.equal(result.unitAssemblyV2.terrainComposition.maskSetSha256, TERRAIN_COMPOSER_MASK_SET_SHA256);
  assert.equal(result.unitAssemblyV2.terrainComposition.inputs.length, 1);
  assert.equal(result.unitAssemblyV2.terrainComposition.inputs[0].originKind, 'provider-original');
  assert.equal(
    result.unitAssemblyV2.terrainComposition.inputs[0].providerInvocationEvidence,
    'unverified-no-provider-receipt'
  );
  assert.match(
    result.unitAssemblyV2.terrainComposition.inputs[0].sourceSnapshot.path,
    /\.provider-original\.png$/
  );
  assert.equal(result.productionRecipesV2[0].method, 'terrain-composition');
  assert.equal(result.productionRecipesV2[0].generator, 'codecity-terrain-composer-v1');
  assert.equal(result.productionRecipesV2[0].sourceOriginal.originKind, 'deterministic-derived');
  assert.deepEqual(
    result.productionRecipesV2[0].sourceOriginal.derivedFromSha256s,
    [result.unitAssemblyV2.terrainComposition.inputs[0].sourceSnapshot.sha256]
  );
  assert.equal(
    result.productionRecipesV2[0].sourceOriginal.derivationSha256,
    result.unitAssemblyV2.terrainComposition.derivationSha256
  );
  const nonempty = result.unitAssemblyV2.units.filter(({ sourceRequired }) => sourceRequired);
  assert.equal(nonempty.length, 18);
  assert.ok(nonempty.every((unit) => unit.sourceOriginal === null
    && unit.sourceSnapshot === null
    && unit.transformedSnapshot
    && canonicalJson(unit.transformSteps) === canonicalJson(['deterministic-terrain-compose-v1'])));
  assert.ok(result.unitAssemblyV2.units.filter(({ sourceRequired }) => !sourceRequired)
    .every((unit) => unit.sourceOriginal === null && unit.sourceSnapshot === null
      && unit.transformedSnapshot === null && unit.transformSteps.length === 0));
  assert.equal((await verifyPersistedWaveAUnitAssembly(result, {
    root, forgeRoot: root
  })).generationId, result.id);
  assert.equal((await verifyPendingGenerationForWaveApproval({
    assetId: result.assetId,
    generationId: result.id
  }, { root, forgeRoot: root })).generation.id, result.id);
  assert.equal((await processCandidate({ generationId: result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');

  const original = structuredClone(result);
  const mutations = [
    (value) => { value.unitAssemblyV2.terrainComposition.configSha256 = 'f'.repeat(64); },
    (value) => { value.unitAssemblyV2.terrainComposition.unitDerivations[4].outputCellSha256 = 'e'.repeat(64); },
    (value) => { value.productionRecipesV2[0].sourceOriginal.originKind = 'provider-original'; },
    (value) => { value.productionRecipesV2[0].sourceOriginal.derivationSha256 = 'd'.repeat(64); },
    (value) => {
      value.unitAssemblyV2.terrainComposition.inputs[0].providerInvocationEvidence = 'claimed';
    }
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(original);
    mutate(forged);
    await persistResultMutation(root, original.id, forged);
    await assert.rejects(
      () => processCandidate({ generationId: original.id }, { root, forgeRoot: root })
    );
    await assert.rejects(
      () => verifyPendingGenerationForWaveApproval({
        assetId: original.assetId,
        generationId: original.id
      }, { root, forgeRoot: root })
    );
    await persistResultMutation(root, original.id, original);
  }
  const providerPath = path.join(
    root,
    original.unitAssemblyV2.terrainComposition.inputs[0].sourceSnapshot.path
  );
  const providerBytes = await readFile(providerPath);
  const damaged = Buffer.from(providerBytes);
  damaged[Math.floor(damaged.length / 2)] ^= 1;
  await writeFile(providerPath, damaged);
  await assert.rejects(
    () => processCandidate({ generationId: original.id }, { root, forgeRoot: root })
  );
  await assert.rejects(
    () => verifyPendingGenerationForWaveApproval({
      assetId: original.assetId,
      generationId: original.id
    }, { root, forgeRoot: root })
  );
  await writeFile(providerPath, providerBytes);
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  assert.equal((await verifyPendingGenerationForWaveApproval({
    assetId: original.assetId,
    generationId: original.id
  }, { root, forgeRoot: root })).generation.id, original.id);
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('terrain composition invalid overlap and config drift fail before ledger, pending, or approved writes', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({
    assetId: 'terrain.grass', generationMode: 'terrain-composed-atlas', seed: 'no-write'
  }, { root, forgeRoot: root });
  const terrainComposition = await terrainCompositionRequest(root, pack.job, {
    name: 'overlap-material.png', width: 128, height: 128
  });
  terrainComposition.inputs.push({
    role: 'base-1',
    sourceOriginal: terrainComposition.inputs[0].sourceOriginal,
    cropRect: { x: 0, y: 0, width: 128, height: 128 }
  });
  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const pendingRoot = path.join(root, 'generated', 'terrains', 'pending');
  const ledgerBefore = await readFile(ledgerPath);
  const pendingBefore = await hashTree(pendingRoot);
  const approvedBefore = await hashApprovedTree(root);
  await assert.rejects(() => importWaveACandidate({
    assetId: 'terrain.grass',
    jobPackPath: pack.result.jobPackPath,
    terrainComposition,
    identityBindingPath: null
  }, { root, forgeRoot: root }), /must not overlap/);
  assert.deepEqual(await readFile(ledgerPath), ledgerBefore);
  assert.equal(await hashTree(pendingRoot), pendingBefore);
  assert.equal(await hashApprovedTree(root), approvedBefore);

  const drifted = structuredClone(terrainComposition);
  drifted.inputs.pop();
  drifted.configSha256 = 'd'.repeat(64);
  await assert.rejects(() => importWaveACandidate({
    assetId: 'terrain.grass',
    jobPackPath: pack.result.jobPackPath,
    terrainComposition: drifted,
    identityBindingPath: null
  }, { root, forgeRoot: root }), /incomplete or drifted/);
  assert.deepEqual(await readFile(ledgerPath), ledgerBefore);
  assert.equal(await hashTree(pendingRoot), pendingBefore);
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('coverage, order, source alias, aspect, and caller leaf symlink failures write no pending result', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'building.inn' }, { root, forgeRoot: root });
  const lamp = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const sources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'inn' });
  const approvedBefore = await hashApprovedTree(root);
  const ledgerBefore = await readFile(path.join(root, 'data', 'local', 'generations.json'));
  const pendingRoot = path.join(root, 'generated', 'buildings', 'pending');
  const treeBefore = await hashTree(pendingRoot);
  const failures = [
    [sources.slice(0, 1), /coverage mismatch/],
    [[sources[0], sources[0]], /coverage mismatch/],
    [[...sources, { unitId: 'unit_999_base_extra', sourceOriginal: sources[0].sourceOriginal }], /coverage mismatch/],
    [[sources[1], sources[0]], /source order\/frame binding/],
    [[sources[0], { ...sources[1], sourceOriginal: sources[0].sourceOriginal }], /unique primary source path and bytes/]
  ];
  for (const [unitSources, pattern] of failures) {
    await assert.rejects(() => importWaveACandidate({
      assetId: 'building.inn',
      jobPackPath: pack.result.jobPackPath,
      unitSources,
      identityBindingPath: null
    }, { root, forgeRoot: root }), pattern);
  }
  const wrongAspect = await writeInput(root, 'wrong-aspect.png', await providerSource(
    64, 100, { r: 100, g: 80, b: 40 }, { inset: 4 }
  ));
  await assert.rejects(() => importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: lamp.result.jobPackPath,
    unitSources: [{ unitId: lamp.job.generationUnits[0].unitId, sourceOriginal: wrongAspect }],
    identityBindingPath: null
  }, { root, forgeRoot: root }), /aspect ratio/);
  await assert.rejects(() => importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: lamp.result.jobPackPath,
    unitSources: [{
      unitId: lamp.job.generationUnits[0].unitId,
      sourceOriginal: wrongAspect,
      cropRect: { x: 0, y: 0, width: 60, height: 100 }
    }],
    identityBindingPath: null
  }, { root, forgeRoot: root }), /aspect ratio/);
  const valid = await writeInput(root, 'valid-symlink-target.png', await providerSource(
    64, 128, { r: 100, g: 80, b: 40 }, { inset: 4 }
  ));
  const leafLink = path.join(root, 'operator-input', 'leaf-link.png');
  await symlink(valid, leafLink);
  await assert.rejects(() => importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: lamp.result.jobPackPath,
    unitSources: [{ unitId: lamp.job.generationUnits[0].unitId, sourceOriginal: leafLink }],
    identityBindingPath: null
  }, { root, forgeRoot: root }), /non-symlink file/);
  assert.equal(await hashApprovedTree(root), approvedBefore);
  assert.deepEqual(await readFile(path.join(root, 'data', 'local', 'generations.json')), ledgerBefore);
  assert.equal(await hashTree(pendingRoot), treeBefore);
});

test('deep process audit rejects coordinated ledger+metadata truth and unit provenance tampering', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'tamper-lamp' });
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  }, { root, forgeRoot: root });
  const original = structuredClone(imported.result);
  const approvedBefore = await hashApprovedTree(root);
  const mutations = [
    ['warnings human-approval claim', (value) => {
      value.warnings = ['human approved and complete'];
    }],
    ['unknown evidence removed', (value) => {
      value.inspection.unknown = [];
    }],
    ['observed human approval claim', (value) => {
      value.inspection.observed = ['human approved'];
    }],
    ['dry run truth changed', (value) => {
      value.dryRun = true;
    }],
    ['subscription truth changed', (value) => {
      value.subscriptionRun = true;
    }],
    ['legacy optional field injected', (value) => {
      value.processedFromGenerationId = 'gen_forged';
    }],
    ['unit target rect changed', (value) => {
      value.unitAssemblyV2.units[0].targetRect.x += 1;
    }],
    ['unit frame changed', (value) => {
      value.unitAssemblyV2.units[0].frameId = 'forged_frame';
    }],
    ['unit prompt hash changed', (value) => {
      value.unitAssemblyV2.units[0].unitPromptSha256 = '0'.repeat(64);
    }],
    ['transform policy changed', (value) => {
      value.unitAssemblyV2.units[0].transformEvidence.policy.transparentDistance = 13;
    }],
    ['detected border key changed', (value) => {
      value.unitAssemblyV2.units[0].transformEvidence.detectedKeyColor = '#FA03F9';
    }],
    ['border sample digest removed', (value) => {
      delete value.unitAssemblyV2.units[0].transformEvidence.borderSampleSha256;
    }],
    ['source budget evidence changed', (value) => {
      value.unitAssemblyV2.sourceLimits.maxSourcePixels -= 1;
    }],
    ['artifact role changed', (value) => {
      value.unitAssemblyV2.units[0].artifactRole = 'base';
    }],
    ['provenance changed', (value) => {
      value.provenanceKey = '1'.repeat(64);
    }],
    ['production recipe changed', (value) => {
      value.productionRecipesV2[0].promptSnapshot.sha256 = '2'.repeat(64);
    }]
  ];
  for (const [label, mutate] of mutations) {
    const forged = structuredClone(original);
    mutate(forged);
    await persistResultMutation(root, original.id, forged);
    await assert.rejects(
      () => processCandidate({ generationId: original.id }, { root, forgeRoot: root }),
      undefined,
      label
    );
    await persistResultMutation(root, original.id, original);
    assert.equal(await hashApprovedTree(root), approvedBefore, label);
  }
  const metadataForged = structuredClone(original);
  metadataForged.inspection.observed = ['metadata-only forged approval'];
  await writeFile(path.join(root, original.metadataPath), canonicalJson(metadataForged));
  await assert.rejects(
    () => processCandidate({ generationId: original.id }, { root, forgeRoot: root }),
    /metadata bytes differ/
  );
  await writeFile(path.join(root, original.metadataPath), canonicalJson(original));
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('deep process audit rejects source, transformed, assembly-source, artifact, and persisted symlink tampering', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'file-tamper-lamp' });
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp', jobPackPath: pack.result.jobPackPath,
    unitSources, identityBindingPath: null
  }, { root, forgeRoot: root });
  const result = imported.result;
  const unit = result.unitAssemblyV2.units[0];
  const paths = [
    unit.sourceSnapshot.path,
    unit.transformedSnapshot.path,
    result.productionRecipesV2[0].sourceOriginal.path,
    result.outputPath
  ];
  const approvedBefore = await hashApprovedTree(root);
  for (const relative of paths) {
    const absolute = path.join(root, relative);
    const originalBytes = await readFile(absolute);
    await writeFile(absolute, Buffer.from('not a valid persisted image'));
    await assert.rejects(
      () => processCandidate({ generationId: result.id }, { root, forgeRoot: root })
    );
    await writeFile(absolute, originalBytes);
    assert.equal(await hashApprovedTree(root), approvedBefore);
  }
  const sourceAbsolute = path.join(root, unit.sourceSnapshot.path);
  const backup = `${sourceAbsolute}.regular-backup`;
  await rename(sourceAbsolute, backup);
  await symlink(backup, sourceAbsolute);
  await assert.rejects(
    () => processCandidate({ generationId: result.id }, { root, forgeRoot: root }),
    /Symbolic links|non-symlink/
  );
  await rm(sourceAbsolute);
  await rename(backup, sourceAbsolute);
  assert.equal((await processCandidate({ generationId: result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('deep replay rejects empty, partial-alpha, hidden-RGB, and magenta transformed snapshots even with coordinated hashes', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'pixel-contract-lamp' });
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp', jobPackPath: pack.result.jobPackPath,
    unitSources, identityBindingPath: null
  }, { root, forgeRoot: root });
  const original = structuredClone(imported.result);
  const snapshotPath = original.unitAssemblyV2.units[0].transformedSnapshot.path;
  const snapshotAbsolute = path.join(root, snapshotPath);
  const originalBytes = await readFile(snapshotAbsolute);
  const rawVariant = (kind) => {
    const raw = Buffer.alloc(32 * 64 * 4);
    if (kind === 'hidden-rgb') {
      raw[0] = 12;
      raw[1] = 34;
      raw[2] = 56;
    }
    if (kind !== 'empty') {
      for (let y = 8; y < 56; y += 1) {
        for (let x = 6; x < 26; x += 1) {
          const offset = (y * 32 + x) * 4;
          raw[offset] = kind === 'magenta' ? 255 : 120;
          raw[offset + 1] = kind === 'magenta' ? 0 : 80;
          raw[offset + 2] = kind === 'magenta' ? 255 : 40;
          raw[offset + 3] = kind === 'partial-alpha' ? 128 : 255;
        }
      }
    }
    return raw;
  };
  for (const kind of ['empty', 'partial-alpha', 'hidden-rgb', 'magenta']) {
    const bytes = await sharp(rawVariant(kind), {
      raw: { width: 32, height: 64, channels: 4 }
    }).png({ adaptiveFiltering: false, palette: false }).toBuffer();
    const forged = structuredClone(original);
    forged.unitAssemblyV2.units[0].transformedSnapshot.sha256 = sha256(bytes);
    await writeFile(snapshotAbsolute, bytes);
    await persistResultMutation(root, original.id, forged);
    await assert.rejects(
      () => processCandidate({ generationId: original.id }, { root, forgeRoot: root }),
      undefined,
      kind
    );
    await writeFile(snapshotAbsolute, originalBytes);
    await persistResultMutation(root, original.id, original);
  }
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
});

test('identity preparation rejects afterthought/raw shortcuts, bad crops, duplicate views, and caller symlinks', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'character.player' }, { root, forgeRoot: root });
  const identity = await identitySource(root, 'identity-negative.png');
  await assert.rejects(() => prepareWaveAIdentityBinding({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: { sourceOriginal: identity }
  }, { root, forgeRoot: root }), /requires an explicit 2:1 cropRect/);
  await assert.rejects(() => prepareWaveAIdentityBinding({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 300, height: 192 }
    }
  }, { root, forgeRoot: root }), /exact 2:1 target aspect ratio/);
  const duplicateCell = await sharp({
    create: { width: 72, height: 160, channels: 4, background: '#506478ff' }
  }).png().toBuffer();
  const duplicateBytes = await sharp({
    create: { width: 384, height: 192, channels: 4, background: '#ff00ffff' }
  }).composite([0, 1, 2, 3].map((index) => ({
    input: duplicateCell,
    left: index * 96 + 12,
    top: 16
  }))).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const duplicate = await writeInput(root, 'identity-duplicate.png', duplicateBytes);
  await assert.rejects(() => prepareWaveAIdentityBinding({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: duplicate,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root }), /direction cells must be byte-distinct/);
  const link = path.join(root, 'operator-input', 'identity-leaf-link.png');
  await symlink(identity, link);
  await assert.rejects(() => prepareWaveAIdentityBinding({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: link,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root }), /non-symlink file/);
  const sources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'afterthought-player' });
  await assert.rejects(() => importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources: sources,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root }), /issue an identity binding first/);
});

test('deep identity audit rejects valid alternate-binding substitution and post-issuance identity evidence tampering', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'character.player' }, { root, forgeRoot: root });
  const firstRaw = await identitySource(root, 'identity-first.png');
  const first = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: firstRaw,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'identity-tamper-player' });
  const imported = await importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: first.bindingPath
  }, { root, forgeRoot: root });
  const original = structuredClone(imported.result);
  const secondRaw = await identitySource(root, 'identity-second.png', [
    '#d05050ff', '#5080c0ff', '#50b070ff', '#b09040ff'
  ]);
  const second = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: secondRaw,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  assert.notEqual(second.bindingSha256, first.bindingSha256);
  const substituted = structuredClone(original);
  substituted.unitAssemblyV2.identityMaster.unitExecutionPlanPath = second.bindingPath;
  substituted.unitAssemblyV2.identityMaster.unitExecutionPlanSha256 = second.bindingSha256;
  await persistResultMutation(root, original.id, substituted);
  await assert.rejects(
    () => processCandidate({ generationId: original.id }, { root, forgeRoot: root })
  );
  await persistResultMutation(root, original.id, original);
  const ledgerBeforeEvidenceTamper = await readFile(path.join(root, 'data', 'local', 'generations.json'));

  const evidencePaths = [
    first.binding.identityMaster.sourceSnapshot.path,
    first.binding.identityMaster.transformedSnapshot.path,
    first.binding.units[0].executionPromptPath,
    first.bindingPath
  ];
  const approvedBefore = await hashApprovedTree(root);
  for (const relative of evidencePaths) {
    const absolute = path.join(root, relative);
    const bytes = await readFile(absolute);
    await writeFile(absolute, Buffer.from('tampered identity authority evidence'));
    await assert.rejects(() => verifyWaveAIdentityBinding(first.bindingPath, {
      root, forgeRoot: root
    }));
    await writeFile(absolute, bytes);
    assert.equal(await hashApprovedTree(root), approvedBefore);
  }
  const identitySourceAbsolute = path.join(root, first.binding.identityMaster.sourceSnapshot.path);
  const backup = `${identitySourceAbsolute}.regular-backup`;
  await rename(identitySourceAbsolute, backup);
  await symlink(backup, identitySourceAbsolute);
  await assert.rejects(() => verifyWaveAIdentityBinding(first.bindingPath, {
    root, forgeRoot: root
  }), /Symbolic links|non-symlink/);
  await rm(identitySourceAbsolute);
  await rename(backup, identitySourceAbsolute);
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  assert.deepEqual(
    await readFile(path.join(root, 'data', 'local', 'generations.json')),
    ledgerBeforeEvidenceTamper
  );
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('reference review still fails closed before any production write', async (t) => {
  const root = await fixtureRoot(t, { approvedAuthorization: false });
  const approvedBefore = await hashApprovedTree(root);
  await assert.rejects(
    () => writeWaveAJobPack({ assetId: 'prop.lamp' }, { root, forgeRoot: root }),
    /reference authorization is not production-ready/
  );
  await assert.rejects(() => access(path.join(root, 'generated')), /ENOENT/);
  assert.equal((await readLocalGenerationManifest(root)).results.length, 0);
  assert.equal(await hashApprovedTree(root), approvedBefore);
});
