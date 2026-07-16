import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { main, parseArgs } from '../src/cli.mjs';
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
import {
  CHARACTER_ATLAS_LAYOUT_CONFIG_SHA256,
  CHARACTER_ATLAS_LAYOUT_VERSION
} from '../src/v2/character-atlas-layout.mjs';
import {
  CHARACTER_DIRECTION_STRIP_CONFIG_SHA256,
  CHARACTER_DIRECTION_STRIP_DIRECTIONS,
  CHARACTER_DIRECTION_STRIP_MODE,
  CHARACTER_DIRECTION_STRIP_VERSION
} from '../src/v2/character-direction-strips.mjs';
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

async function providerSource(width, height, color, {
  inset = 8,
  alpha = 1,
  background = '#ff00ffff'
} = {}) {
  return sharp({
    create: { width, height, channels: 4, background }
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
], background = '#ff00ffff') {
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
    create: { width, height, channels: 4, background }
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
  prefix = 'character-atlas',
  background = '#ff00ffff'
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
    create: { width, height, channels: 4, background }
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

async function directionStripSourcesForJob(root, job, {
  scale = 2,
  prefix = 'character-direction-strip',
  background = '#fa05faff'
} = {}) {
  assert.equal(job.generationMode, CHARACTER_DIRECTION_STRIP_MODE);
  const required = job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  assert.equal(required.length, 40);
  const padding = 8;
  const cellWidth = 48 * scale;
  const cellHeight = 96 * scale;
  const records = [];
  for (const [directionIndex, direction] of CHARACTER_DIRECTION_STRIP_DIRECTIONS.entries()) {
    const units = required.filter((unit) => unit.direction === direction);
    assert.equal(units.length, 10);
    const composites = [];
    for (const [column, unit] of units.entries()) {
      const index = directionIndex * 10 + column;
      const bodyWidth = (30 + (index % 8)) * scale;
      const bodyHeight = (66 + (index % 13)) * scale;
      composites.push({
        input: await sharp({
          create: {
            width: bodyWidth,
            height: bodyHeight,
            channels: 4,
            background: {
              r: 35 + (index * 47) % 200,
              g: 70 + (index * 53) % 170,
              b: 15 + (index * 29) % 80,
              alpha: 1
            }
          }
        }).png().toBuffer(),
        left: padding + column * cellWidth + Math.floor((cellWidth - bodyWidth) / 2),
        top: padding + cellHeight - bodyHeight
      });
    }
    const bytes = await sharp({
      create: {
        width: cellWidth * 10 + padding * 2,
        height: cellHeight + padding * 2,
        channels: 4,
        background
      }
    }).composite(composites).png({ adaptiveFiltering: false, palette: false }).toBuffer();
    const sourceOriginal = await writeInput(root, `${prefix}-${direction}.png`, bytes);
    for (const [column, unit] of units.entries()) {
      records.push({
        unitId: unit.unitId,
        sourceOriginal,
        cropRect: {
          x: padding + column * cellWidth,
          y: padding,
          width: cellWidth,
          height: cellHeight
        }
      });
    }
  }
  return records;
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
  assert.equal(Object.hasOwn(characterAtlas.job, 'characterAtlasLayoutPlan'), false);
  assert.equal(characterAtlas.job.generationUnitSetSha256, '822f04e2e101dea2aae5485b5db7accc055e7ae24721874aef7e9c9281182924');
  assert.equal(characterAtlas.job.generationUnits[0].unitPromptSha256, 'f6af2437c1a78c687fb1607f119ef7c1edc406e3ec520c1ab4d5604bd9e4b3e7');
  assert.equal(characterAtlas.job.generationUnits[39].unitPromptSha256, '60eef89f35e72f2360659e983977cf12ecd35d774f64f2216e8ea49e567580cb');
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
    'make-job-v2 --asset <character-asset-id> --mode character-direction-strips [--seed <seed>]'
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
    () => buildWaveAJob({
      assetId: 'terrain.grass', generationMode: CHARACTER_DIRECTION_STRIP_MODE
    }, { forgeRoot: root }),
    /available only for Wave A character/
  );
  await assert.rejects(
    () => buildWaveAJob({
      assetId: 'character.player', generationMode: CHARACTER_DIRECTION_STRIP_MODE,
      providerKeyNormalization: 'provider-key-normalize-v1'
    }, { forgeRoot: root }),
    /only for character monolithic-atlas/
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
  assert.equal(Object.hasOwn(pack.job, 'characterAtlasLayoutPlan'), false);
  assert.equal(Object.hasOwn(pack.pack, 'characterAtlasLayoutPlan'), false);
  assert.equal(Object.hasOwn(bound.binding, 'characterAtlasLayoutPlan'), false);
  const legacyBindingKey = sha256(canonicalJson({
    jobProvenanceKey: pack.job.provenanceKey,
    identityPlanId: pack.job.identityMasterPlan.planId,
    identityPlanPromptSha256: pack.job.identityMasterPlan.promptSha256,
    sourceOriginalSha256: bound.binding.identityMaster.sourceOriginal.sha256,
    sourceOriginalFormat: bound.binding.identityMaster.sourceOriginal.format,
    sourceOriginalSize: {
      width: bound.binding.identityMaster.sourceOriginal.width,
      height: bound.binding.identityMaster.sourceOriginal.height
    },
    cropRect: bound.binding.identityMaster.sourceOriginal.cropRect,
    transformedSha256: bound.binding.identityMaster.transformedSnapshot.sha256,
    directionCellSha256s: bound.binding.identityMaster.directionCellSha256s
  }));
  assert.equal(bound.binding.bindingId, `identity_binding_${legacyBindingKey.slice(0, 20)}`);
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

test('character direction strips issue four identity-bound prompts and fail closed to four 10-cell sources', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({
    assetId: 'character.player',
    generationMode: CHARACTER_DIRECTION_STRIP_MODE,
    seed: 'four-direction-strips'
  }, { root, forgeRoot: root });
  assert.equal(pack.job.category, 'character');
  assert.equal(pack.job.generationUnits.length, 40);
  assert.equal(pack.job.characterDirectionStripPlan.version, CHARACTER_DIRECTION_STRIP_VERSION);
  assert.equal(
    pack.job.characterDirectionStripPlan.configSha256,
    CHARACTER_DIRECTION_STRIP_CONFIG_SHA256
  );
  assert.equal(Object.hasOwn(pack.job, 'providerKeyNormalizationPlan'), false);
  assert.deepEqual(pack.pack.characterDirectionStripPlan, pack.job.characterDirectionStripPlan);
  const unitPlan = JSON.parse(await readFile(path.join(root, pack.pack.members.unitPlan.path), 'utf8'));
  assert.deepEqual(unitPlan.characterDirectionStripPlan, pack.job.characterDirectionStripPlan);
  assert.match(pack.job.promptText, /one identity-bound direction strip/);
  assert.match(pack.job.promptText, /exactly ten contiguous portrait 1:2 cells/);
  assert.match(pack.job.generationUnits[39].unitPromptText, /including work frames/);

  const identity = await identitySource(root, 'direction-strip-identity.png');
  const bound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  assert.deepEqual(bound.binding.characterDirectionStripPlan, pack.job.characterDirectionStripPlan);
  assert.deepEqual(
    bound.binding.directionStripExecutions.map(({ direction }) => direction),
    CHARACTER_DIRECTION_STRIP_DIRECTIONS
  );
  assert.equal(bound.binding.directionStripExecutions.length, 4);
  assert.equal(new Set(bound.binding.units.map(({ executionPromptPath }) => executionPromptPath)).size, 4);
  assert.equal(new Set(bound.binding.units.map(({ executionPromptSha256 }) => executionPromptSha256)).size, 4);
  for (const [index, execution] of bound.binding.directionStripExecutions.entries()) {
    const direction = CHARACTER_DIRECTION_STRIP_DIRECTIONS[index];
    assert.deepEqual(execution.unitOrder, pack.job.generationUnits
      .filter((unit) => unit.direction === direction)
      .map(({ unitId }) => unitId));
    assert.equal(execution.unitOrder.length, 10);
    const promptBytes = await readFile(path.join(root, execution.executionPromptPath));
    assert.equal(sha256(promptBytes), execution.executionPromptSha256);
    const prompt = promptBytes.toString('utf8');
    for (const required of [
      pack.job.id,
      pack.job.generationUnitSetSha256,
      pack.job.identityMasterPlan.promptSha256,
      bound.binding.identityMaster.consistencyInputSha256,
      bound.binding.identityMaster.directionCellSha256s[index],
      'exactly 5:1 overall',
      `Required direction: ${direction}`,
      'including every work frame'
    ]) assert.ok(prompt.includes(required));
    for (const unit of pack.job.generationUnits.filter((record) => record.direction === direction)) {
      assert.ok(prompt.includes(unit.unitId));
      assert.ok(prompt.includes(unit.unitPromptSha256));
    }
  }
  const tamperedPrompt = bound.binding.directionStripExecutions[1];
  const promptAbsolute = path.join(root, tamperedPrompt.executionPromptPath);
  const promptBytes = await readFile(promptAbsolute);
  await writeFile(promptAbsolute, 'tampered direction strip prompt');
  await assert.rejects(() => verifyWaveAIdentityBinding(bound.bindingPath, {
    root, forgeRoot: root
  }), /prompt mismatch/);
  await writeFile(promptAbsolute, promptBytes);

  const unitSources = await directionStripSourcesForJob(root, pack.job);
  const manifestBeforeFailures = await readFile(path.join(root, 'data/local/generations.json'));
  await assert.rejects(() => importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  }, { root, forgeRoot: root }), /issue an identity binding first/);
  const gap = structuredClone(unitSources);
  gap[1].cropRect.x += 1;
  await assert.rejects(() => importWaveACandidate({
    assetId: 'character.player', jobPackPath: pack.result.jobPackPath,
    unitSources: gap, identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root }), /ten equal contiguous cells/);
  const mixedDirection = structuredClone(unitSources);
  mixedDirection[9].sourceOriginal = mixedDirection[10].sourceOriginal;
  await assert.rejects(() => importWaveACandidate({
    assetId: 'character.player', jobPackPath: pack.result.jobPackPath,
    unitSources: mixedDirection, identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root }), /front direction strip requires one shared/);
  const aliasedDirection = structuredClone(unitSources);
  for (let index = 10; index < 20; index += 1) {
    aliasedDirection[index].sourceOriginal = unitSources[0].sourceOriginal;
  }
  await assert.rejects(() => importWaveACandidate({
    assetId: 'character.player', jobPackPath: pack.result.jobPackPath,
    unitSources: aliasedDirection, identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root }), /four distinct source paths and four distinct source hashes/);
  const duplicateBytesPath = await writeInput(
    root,
    'duplicate-front-strip.png',
    await readFile(unitSources[0].sourceOriginal)
  );
  const duplicateHash = structuredClone(unitSources);
  for (let index = 10; index < 20; index += 1) {
    duplicateHash[index].sourceOriginal = duplicateBytesPath;
  }
  await assert.rejects(() => importWaveACandidate({
    assetId: 'character.player', jobPackPath: pack.result.jobPackPath,
    unitSources: duplicateHash, identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root }), /four distinct source paths and four distinct source hashes/);
  assert.ok((await readFile(path.join(root, 'data/local/generations.json')))
    .equals(manifestBeforeFailures));

  const imported = await importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root });
  const assembly = imported.result.unitAssemblyV2;
  assert.equal(assembly.generationMode, CHARACTER_DIRECTION_STRIP_MODE);
  assert.equal(Object.hasOwn(assembly, 'providerKeyNormalization'), false);
  assert.equal(new Set(assembly.units.map(({ sourceSnapshot }) => sourceSnapshot.path)).size, 4);
  assert.equal(new Set(assembly.units.map(({ sourceOriginal }) => sourceOriginal.sha256)).size, 4);
  assert.equal(new Set(assembly.units.map(({ outputCellSha256 }) => outputCellSha256)).size, 40);
  for (const direction of CHARACTER_DIRECTION_STRIP_DIRECTIONS) {
    const units = assembly.units.filter((unit) => unit.direction === direction);
    assert.equal(new Set(units.map(({ sourceSnapshot }) => sourceSnapshot.path)).size, 1);
    assert.match(units[0].sourceSnapshot.path, new RegExp(`direction-strip-${direction}`));
  }
  assert.deepEqual(assembly.units[0].transformSteps, [
    'auto-border-key-detect', 'crop', 'soft-matte-despill', 'zero-hidden-rgb',
    'nearest-downscale', 'hard-alpha-zero-hidden-rgb'
  ]);
  assert.equal(assembly.units[0].transformEvidence.detectedKeyColor, '#FA05FA');
  await assert.doesNotReject(() => verifyPersistedWaveAUnitAssembly(imported.result, {
    root, forgeRoot: root
  }));
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
});

test('explicit character-atlas-layout-v1 binds exact portrait-grid guidance without changing 40 semantic units', async (t) => {
  const root = await fixtureRoot(t);
  const legacy = await buildWaveAJob({
    assetId: 'character.player',
    generationMode: 'monolithic-atlas',
    seed: 'layout-guidance'
  }, { forgeRoot: root });
  const pack = await makeWaveAJob({
    assetId: 'character.player',
    generationMode: 'monolithic-atlas',
    characterAtlasLayout: CHARACTER_ATLAS_LAYOUT_VERSION,
    seed: 'layout-guidance'
  }, { root, forgeRoot: root });
  assert.notEqual(pack.job.id, legacy.job.id);
  assert.deepEqual(pack.job.generationUnits, legacy.job.generationUnits);
  assert.equal(pack.job.generationUnitSetSha256, legacy.job.generationUnitSetSha256);
  assert.equal(pack.job.characterAtlasLayoutPlan.version, CHARACTER_ATLAS_LAYOUT_VERSION);
  assert.equal(
    pack.job.characterAtlasLayoutPlan.configSha256,
    CHARACTER_ATLAS_LAYOUT_CONFIG_SHA256
  );
  assert.deepEqual(pack.pack.characterAtlasLayoutPlan, pack.job.characterAtlasLayoutPlan);
  const unitPlan = JSON.parse(await readFile(path.join(root, pack.pack.members.unitPlan.path), 'utf8'));
  assert.deepEqual(unitPlan.characterAtlasLayoutPlan, pack.job.characterAtlasLayoutPlan);
  assert.equal(
    (await verifyWaveAJobPack(pack.result.jobPackPath, { root, forgeRoot: root })).job.id,
    pack.job.id
  );

  const identity = await identitySource(root, 'layout-guidance-identity.png');
  const bound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  assert.deepEqual(
    bound.binding.characterAtlasLayoutPlan,
    pack.job.characterAtlasLayoutPlan
  );
  const promptPath = path.join(root, bound.binding.atlasExecution.executionPromptPath);
  const prompt = await readFile(promptPath, 'utf8');
  assert.ok(prompt.startsWith('# Mandatory character atlas layout guidance\n'));
  for (const required of [
    'exactly 5:4 (width:height)',
    'exactly ten columns and four rows',
    'portrait 1:2 (width:height), never square',
    'uniform, contiguous, and gapless',
    'at or below 80% of its cell width and 88% of its cell height',
    'continuous full outer margin of exact #FF00FF',
    'row 1 (front) must face the viewer directly, including all walk frames',
    'row 2 (back) must face exactly away from the viewer, including all walk frames',
    'profile and three-quarter turns are forbidden',
    'row 3 stays left-facing and every frame in row 4 stays right-facing'
  ]) assert.match(prompt, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const semanticLayout = pack.job.generationUnits.map((unit, index) => ({
    index,
    row: Math.floor(index / 10),
    column: index % 10,
    unitId: unit.unitId,
    baseUnitPromptSha256: unit.unitPromptSha256,
    direction: unit.direction,
    frameId: unit.frameId,
    semanticRole: unit.semanticRole,
    targetRect: unit.targetRect,
    visualContent: unit.visualContent
  }));
  assert.ok(prompt.includes(canonicalJson(semanticLayout).trimEnd()));
  await assert.doesNotReject(() => verifyWaveAIdentityBinding(bound.bindingPath, {
    root, forgeRoot: root
  }));

  const bindingBytes = await readFile(path.join(root, bound.bindingPath));
  const missingBindingPlan = structuredClone(bound.binding);
  delete missingBindingPlan.characterAtlasLayoutPlan;
  delete missingBindingPlan.contentDigest;
  missingBindingPlan.contentDigest = sha256(canonicalJson(missingBindingPlan));
  await writeFile(path.join(root, bound.bindingPath), canonicalJson(missingBindingPlan));
  await assert.rejects(() => verifyWaveAIdentityBinding(bound.bindingPath, {
    root, forgeRoot: root
  }), /canonical evidence/);
  await writeFile(path.join(root, bound.bindingPath), bindingBytes);

  const unitSources = await monolithicCharacterSourcesForJob(root, pack.job, {
    prefix: 'layout-guidance-player'
  });
  const imported = await importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root });
  assert.deepEqual(imported.result.unitAssemblyV2.units[0].transformSteps, [
    'auto-border-key-detect', 'crop', 'soft-matte-despill', 'zero-hidden-rgb',
    'nearest-downscale', 'hard-alpha-zero-hidden-rgb'
  ]);
  await assert.doesNotReject(() => verifyPersistedWaveAUnitAssembly(imported.result, {
    root, forgeRoot: root
  }));
});

test('character-atlas-layout-v1 rejects invalid scope and version before any job-pack write', async (t) => {
  const root = await fixtureRoot(t);
  assert.deepEqual(parseArgs([
    'make-job-v2', '--asset', 'character.player', '--mode', 'monolithic-atlas',
    '--character-atlas-layout', CHARACTER_ATLAS_LAYOUT_VERSION
  ]), {
    command: 'make-job-v2',
    options: {
      asset: 'character.player',
      mode: 'monolithic-atlas',
      characterAtlasLayout: CHARACTER_ATLAS_LAYOUT_VERSION
    }
  });
  const generatedBefore = await hashTree(path.join(root, 'generated'));
  const manifestBefore = await readFile(path.join(root, 'data', 'local', 'generations.json'));
  for (const request of [
    {
      assetId: 'character.player', generationMode: 'per-unit',
      characterAtlasLayout: CHARACTER_ATLAS_LAYOUT_VERSION
    },
    {
      assetId: 'terrain.grass', generationMode: 'terrain-composed-atlas',
      characterAtlasLayout: CHARACTER_ATLAS_LAYOUT_VERSION
    },
    {
      assetId: 'character.player', generationMode: 'monolithic-atlas',
      characterAtlasLayout: 'character-atlas-layout-v2'
    }
  ]) await assert.rejects(
    () => writeWaveAJobPack(request, { root, forgeRoot: root }),
    /only for Wave A character monolithic-atlas|Unsupported character atlas layout policy/
  );
  assert.equal(await hashTree(path.join(root, 'generated')), generatedBefore);
  assert.ok((await readFile(path.join(root, 'data', 'local', 'generations.json')))
    .equals(manifestBefore));
});

test('explicit provider-key-normalize-v1 preserves raw character PNGs and deep-replays identity plus atlas', async (t) => {
  const root = await fixtureRoot(t);
  const legacy = await buildWaveAJob({
    assetId: 'character.player',
    generationMode: 'monolithic-atlas',
    seed: 'normalized-key'
  }, { forgeRoot: root });
  const pack = await makeWaveAJob({
    assetId: 'character.player',
    generationMode: 'monolithic-atlas',
    providerKeyNormalization: 'provider-key-normalize-v1',
    seed: 'normalized-key'
  }, { root, forgeRoot: root });
  assert.notEqual(pack.job.id, legacy.job.id);
  assert.equal(pack.job.providerKeyNormalizationPlan.version, 'provider-key-normalize-v1');
  assert.equal(
    pack.job.identityMasterPlan.providerKeyNormalizationPlan.configSha256,
    pack.job.providerKeyNormalizationPlan.configSha256
  );
  assert.equal(
    (await verifyWaveAJobPack(pack.result.jobPackPath, { root, forgeRoot: root })).job.id,
    pack.job.id
  );

  const shiftedKey = '#f506e2ff'; // safe envelope, Chebyshev distance 29 from #FF00FF
  const identity = await identitySource(
    root,
    'normalized-identity.png',
    ['#b04040ff', '#4070b0ff', '#40a060ff', '#a08030ff'],
    shiftedKey
  );
  const identityBytes = await readFile(identity);
  const bound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  const identityEvidence = bound.binding.identityMaster.providerKeyNormalization;
  assert.equal(identityEvidence.sourceKind, 'identity-master');
  assert.equal(identityEvidence.preBorder.detectedKeyExpectedDistance, 29);
  assert.equal(identityEvidence.postBorder.detectedKeyColor, '#FF00FF');
  assert.ok((await readFile(path.join(root, bound.binding.identityMaster.sourceSnapshot.path)))
    .equals(identityBytes));
  assert.equal(
    sha256(await readFile(path.join(root, identityEvidence.normalizedSnapshot.path))),
    identityEvidence.normalizedSnapshot.sha256
  );

  const unitSources = await monolithicCharacterSourcesForJob(root, pack.job, {
    prefix: 'normalized-player-atlas',
    background: shiftedKey
  });
  const atlasBytes = await readFile(unitSources[0].sourceOriginal);
  const imported = await importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root });
  const atlasEvidence = imported.result.unitAssemblyV2.providerKeyNormalization;
  assert.equal(atlasEvidence.sourceKind, 'monolithic-atlas');
  assert.equal(atlasEvidence.preBorder.detectedKeyExpectedDistance, 29);
  assert.equal(atlasEvidence.postBorder.detectedKeyColor, '#FF00FF');
  const rawAtlasPath = imported.result.unitAssemblyV2.units[0].sourceSnapshot.path;
  assert.ok((await readFile(path.join(root, rawAtlasPath))).equals(atlasBytes));
  const normalizedAtlasPath = path.join(root, atlasEvidence.normalizedSnapshot.path);
  const normalizedAtlasBytes = await readFile(normalizedAtlasPath);
  assert.equal(sha256(normalizedAtlasBytes), atlasEvidence.normalizedSnapshot.sha256);
  assert.equal(new Set(imported.result.unitAssemblyV2.units
    .map(({ transformSteps }) => canonicalJson(transformSteps))).size, 1);
  assert.equal(imported.result.unitAssemblyV2.units[0].transformSteps[0], 'provider-key-normalize-v1');
  await assert.doesNotReject(() => verifyPersistedWaveAUnitAssembly(imported.result, {
    root, forgeRoot: root
  }));
  await assert.doesNotReject(() => verifyPendingGenerationForWaveApproval({
    assetId: 'character.player',
    generationId: imported.result.id
  }, { root, forgeRoot: root }));

  await writeFile(normalizedAtlasPath, Buffer.from('tampered normalized atlas'));
  await assert.rejects(
    () => verifyPersistedWaveAUnitAssembly(imported.result, { root, forgeRoot: root }),
    /provider-key-normalized|snapshot|image signature/
  );
  await writeFile(normalizedAtlasPath, normalizedAtlasBytes);
  const evidenceTamper = structuredClone(imported.result);
  evidenceTamper.unitAssemblyV2.providerKeyNormalization.eligibility.maskSha256 = '0'.repeat(64);
  await assert.rejects(
    () => verifyPersistedWaveAUnitAssembly(evidenceTamper, { root, forgeRoot: root }),
    /normalization evidence/
  );
});

test('single-unit provider-key normalization preserves raw PNG and deep-replays pending/V3 evidence', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({
    assetId: 'prop.practice_target',
    generationMode: 'per-unit',
    providerKeyNormalization: 'provider-key-normalize-v1',
    seed: 'single-unit-normalized-key'
  }, { root, forgeRoot: root });
  assert.deepEqual(pack.job.providerKeyNormalizationPlan.sourceKinds, ['single-unit']);
  assert.equal(pack.job.generationUnits.length, 1);
  assert.equal(pack.job.generationUnits[0].sourceRequired, true);
  assert.equal(pack.job.artifactContracts[0].role, 'primary');
  const unit = pack.job.generationUnits[0];
  const sourceBytes = await providerSource(
    unit.targetRect.width * 2,
    unit.targetRect.height * 2,
    { r: 120, g: 90, b: 40 },
    { inset: 16, background: '#fa07e6ff' }
  );
  const sourceOriginal = await writeInput(root, 'practice-target-shifted-key.png', sourceBytes);
  const sourceAlias = path.join(root, 'operator-input', 'practice-target-shifted-key-alias.png');
  await symlink(sourceOriginal, sourceAlias);
  await assert.rejects(() => importWaveACandidate({
    assetId: pack.job.assetId,
    jobPackPath: pack.result.jobPackPath,
    unitSources: [{ unitId: unit.unitId, sourceOriginal: sourceAlias }],
    identityBindingPath: null
  }, { root, forgeRoot: root }), /non-symlink file/);
  const imported = await importWaveACandidate({
    assetId: pack.job.assetId,
    jobPackPath: pack.result.jobPackPath,
    unitSources: [{ unitId: unit.unitId, sourceOriginal }],
    identityBindingPath: null
  }, { root, forgeRoot: root });
  const assembly = imported.result.unitAssemblyV2;
  assert.equal(assembly.providerKeyNormalization.sourceKind, 'single-unit');
  assert.equal(
    assembly.providerKeyNormalization.preBorder.detectedKeyExpectedDistance,
    25
  );
  assert.equal(assembly.providerKeyNormalization.outsideMaskPreserved, true);
  assert.deepEqual(assembly.units[0].transformSteps, [
    'provider-key-normalize-v1', 'auto-border-key-detect', 'crop',
    'soft-matte-despill', 'zero-hidden-rgb', 'nearest-downscale',
    'hard-alpha-zero-hidden-rgb'
  ]);
  const rawPath = path.join(root, assembly.units[0].sourceSnapshot.path);
  const normalizedPath = path.join(
    root,
    assembly.providerKeyNormalization.normalizedSnapshot.path
  );
  assert.ok((await readFile(rawPath)).equals(sourceBytes));
  assert.notEqual(rawPath, normalizedPath);
  assert.equal(
    sha256(await readFile(normalizedPath)),
    assembly.providerKeyNormalization.normalizedSnapshot.sha256
  );
  await assert.doesNotReject(() => verifyPersistedWaveAUnitAssembly(imported.result, {
    root, forgeRoot: root
  }));
  await assert.doesNotReject(() => verifyPendingGenerationForWaveApproval({
    assetId: pack.job.assetId,
    generationId: imported.result.id
  }, { root, forgeRoot: root }));
});

test('single-unit provider-key normalization rejects unsupported scopes before job-pack writes', async (t) => {
  const root = await fixtureRoot(t);
  const generatedBefore = await hashTree(path.join(root, 'generated'));
  const ledgerBefore = await readFile(path.join(root, 'data', 'local', 'generations.json'));
  for (const request of [
    { assetId: 'character.player', generationMode: 'per-unit' },
    { assetId: 'character.player', generationMode: CHARACTER_DIRECTION_STRIP_MODE },
    { assetId: 'building.inn', generationMode: 'per-unit' },
    { assetId: 'terrain.grass', generationMode: 'per-unit' },
    { assetId: 'ui.footstep', generationMode: 'per-unit' },
    { assetId: 'prop.lamp', generationMode: 'monolithic-atlas' }
  ]) {
    await assert.rejects(() => writeWaveAJobPack({
      ...request,
      providerKeyNormalization: 'provider-key-normalize-v1'
    }, { root, forgeRoot: root }), /exact single-unit non-character per-unit/);
  }
  assert.equal(await hashTree(path.join(root, 'generated')), generatedBefore);
  assert.ok((await readFile(path.join(root, 'data', 'local', 'generations.json')))
    .equals(ledgerBefore));
});

test('provider-key normalization rejects unsafe, alpha, legacy, per-unit, and terrain use before candidate writes', async (t) => {
  const root = await fixtureRoot(t);
  const optInPack = await makeWaveAJob({
    assetId: 'character.player',
    generationMode: 'monolithic-atlas',
    providerKeyNormalization: 'provider-key-normalize-v1',
    seed: 'normalization-negative'
  }, { root, forgeRoot: root });
  const unsafeIdentity = await identitySource(
    root,
    'unsafe-normalized-identity.png',
    undefined,
    '#f506deff'
  );
  const generatedBeforeUnsafe = await hashTree(path.join(root, 'generated'));
  await assert.rejects(() => prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: optInPack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: unsafeIdentity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root }), /safe magenta envelope/);
  assert.equal(await hashTree(path.join(root, 'generated')), generatedBeforeUnsafe);

  const opaqueIdentity = await identitySource(
    root,
    'alpha-source-base.png',
    undefined,
    '#f506e2ff'
  );
  const decoded = await sharp(await readFile(opaqueIdentity)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  decoded.data[3] = 254;
  const alphaIdentity = await writeInput(
    root,
    'alpha-normalized-identity.png',
    await sharp(decoded.data, {
      raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 }
    }).png({ adaptiveFiltering: false, palette: false, compressionLevel: 9 }).toBuffer()
  );
  const generatedBeforeAlpha = await hashTree(path.join(root, 'generated'));
  await assert.rejects(() => prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: optInPack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: alphaIdentity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root }), /alpha 255 for every/);
  assert.equal(await hashTree(path.join(root, 'generated')), generatedBeforeAlpha);

  const legacyPack = await makeWaveAJob({
    assetId: 'character.player',
    generationMode: 'monolithic-atlas',
    seed: 'legacy-rejects-shift'
  }, { root, forgeRoot: root });
  const safeShiftIdentity = await identitySource(
    root,
    'legacy-shifted-identity.png',
    undefined,
    '#f506e2ff'
  );
  const generatedBeforeLegacy = await hashTree(path.join(root, 'generated'));
  await assert.rejects(() => prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: legacyPack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: safeShiftIdentity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root }), /required #FF00FF|expected #FF00FF|detected key/);
  assert.equal(await hashTree(path.join(root, 'generated')), generatedBeforeLegacy);

  await assert.rejects(
    () => buildWaveAJob({
      assetId: 'character.player',
      generationMode: 'per-unit',
      providerKeyNormalization: 'provider-key-normalize-v1'
    }, { forgeRoot: root }),
    /only for character monolithic-atlas/
  );
  await assert.rejects(
    () => buildWaveAJob({
      assetId: 'terrain.grass',
      generationMode: 'terrain-composed-atlas',
      providerKeyNormalization: 'provider-key-normalize-v1'
    }, { forgeRoot: root }),
    /only for character monolithic-atlas/
  );
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
