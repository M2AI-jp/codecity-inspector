import assert from 'node:assert/strict';
import sharp from 'sharp';
import test from 'node:test';
import { sha256 } from '../src/hashing.mjs';
import { auditVisualAssetV2 } from '../src/images/visual-contract-v2.mjs';
import {
  composeTerrainAtlas,
  TERRAIN_COMPOSER_CONFIG_SHA256,
  TERRAIN_COMPOSER_MASK_SET_SHA256,
  terrainDerivationSha256,
  terrainCompositionPlanFor
} from '../src/v2/compose-terrain-atlas.mjs';
import { enumerateWaveAGenerationUnits } from '../src/v2/generation-units.mjs';
import { terrainV2Definition } from './phase0b-visual-contract.test.mjs';

function jobFor(id) {
  const asset = terrainV2Definition(id);
  return {
    assetId: id,
    category: 'terrain',
    generationMode: 'terrain-composed-atlas',
    assetDefinition: asset,
    terrainCompositionPlan: terrainCompositionPlanFor(asset),
    artifactContracts: [{ role: 'primary', outputSize: { width: 320, height: 320 } }],
    generationUnits: enumerateWaveAGenerationUnits(asset)
  };
}

async function opaqueProvider(width = 128, height = 128, seed = 0) {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      raw[offset] = 30 + ((x * 5 + y * 3 + seed * 17) % 140);
      raw[offset + 1] = 55 + ((x * 2 + y * 7 + seed * 11) % 130);
      raw[offset + 2] = 20 + ((x * 11 + y * 5 + seed * 13) % 90);
      raw[offset + 3] = 255;
    }
  }
  const buffer = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png({ adaptiveFiltering: false, palette: false, compressionLevel: 9 })
    .toBuffer();
  return {
    canonicalPath: `/provider/source-${seed}.png`,
    image: { buffer, sourceFormat: 'png', metadata: { width, height } },
    sha256: sha256(buffer)
  };
}

function input(role, source, cropRect, requestedPath = source.canonicalPath) {
  return { role, source, cropRect, requestedPath };
}

async function encodedAtlas(composed) {
  return sharp(composed.atlasRaw, { raw: { width: 320, height: 320, channels: 4 } })
    .png({ adaptiveFiltering: false, palette: false, compressionLevel: 9 })
    .toBuffer();
}

test('terrain composer descriptor and canonical mask bytes are golden and stable', () => {
  assert.equal(
    TERRAIN_COMPOSER_CONFIG_SHA256,
    '275deeef07eea53a17cef836c2d9e090a0f629aeef2680e95ff8ad7067d688bd'
  );
  assert.equal(
    TERRAIN_COMPOSER_MASK_SET_SHA256,
    '7b9f3869d3eabec7a12da208c0fb7843d559b4af1a58177e39332658c3491987'
  );
});

test('one opaque provider texture deterministically produces a valid exact-seam grass atlas', async () => {
  const job = jobFor('terrain.grass');
  const source = await opaqueProvider();
  const inputs = [input('base-0', source, { x: 0, y: 0, width: 128, height: 128 })];
  const first = await composeTerrainAtlas(job, inputs);
  const second = await composeTerrainAtlas(job, inputs);
  assert.equal(
    first.atlasRawSha256,
    '725a0598d5bcbf315c9ac9f55ea3ad075a47e7c834e54b94ec810d8aced1eb58'
  );
  assert.equal(
    first.unitDerivationSetSha256,
    '3630b174bc665e0470b5caee2c76305320a00ddbd096920c167667166a1d21cc'
  );
  assert.equal(
    first.derivationSha256,
    '3f8e18cf001ea95ee734b97a0926c03b0dc3e3a4a80eaa43d99e2b119a411438'
  );
  assert.equal(first.derivationSha256, terrainDerivationSha256(first));
  assert.equal(first.atlasRawSha256, second.atlasRawSha256);
  assert.equal(first.unitDerivationSetSha256, second.unitDerivationSetSha256);
  assert.deepEqual(first.unitDerivations, second.unitDerivations);
  const audit = await auditVisualAssetV2(await encodedAtlas(first), job.assetDefinition, {
    verifyResize: false
  });
  assert.equal(audit.ok, true, audit.problems.join('; '));
  assert.equal(audit.technicalInspection.exactSeams.mismatchCount, 0);
  assert.equal(first.unitRecords[3].raw.every((byte) => byte === 0), true);
  assert.equal(first.unitRecords.slice(19).every(({ raw }) => raw.every((byte) => byte === 0)), true);
  assert.equal(first.unitDerivations[3].sourceRoles.length, 0);
  assert.equal(first.unitDerivations[19].sourceRoles.length, 0);
});

test('water motion is composed and cliff fails closed pending directional inputs', async () => {
  const waterJob = jobFor('terrain.water');
  const waterSource = await opaqueProvider(128, 128, 1);
  const water = await composeTerrainAtlas(waterJob, [
    input('base-0', waterSource, { x: 0, y: 0, width: 128, height: 128 })
  ]);
  const waterAudit = await auditVisualAssetV2(await encodedAtlas(water), waterJob.assetDefinition, {
    verifyResize: false
  });
  assert.equal(waterAudit.ok, true, waterAudit.problems.join('; '));
  assert.equal(new Set([0, 1, 2, 19, 20, 21]
    .map((index) => sha256(water.unitRecords[index].raw))).size, 6);
  assert.throws(
    () => jobFor('terrain.cliff'),
    /excludes terrain\.cliff until directional face inputs are defined/
  );
});

test('terrain composer rejects config drift, aliases, overlap, mixed roles, enlargement, and alpha', async () => {
  const source = await opaqueProvider(256, 128, 3);
  const job = jobFor('terrain.grass');
  const base = input('base-0', source, { x: 0, y: 0, width: 128, height: 128 });
  const drifted = structuredClone(job);
  drifted.terrainCompositionPlan.configSha256 = 'f'.repeat(64);
  await assert.rejects(() => composeTerrainAtlas(drifted, [base]), /plan drifted/);
  await assert.rejects(() => composeTerrainAtlas(job, [
    base,
    input('base-1', source, { x: 128, y: 0, width: 128, height: 128 }, '/provider/alias.png')
  ]), /path aliases/);
  await assert.rejects(() => composeTerrainAtlas(job, [
    base,
    input('base-1', source, { x: 64, y: 0, width: 128, height: 128 })
  ]), /must not overlap/);
  await assert.rejects(() => composeTerrainAtlas(job, [
    base,
    input('water-motion-0', source, { x: 128, y: 0, width: 128, height: 128 })
  ]), /role not allowed/);
  await assert.rejects(() => composeTerrainAtlas(job, [
    input('base-0', source, { x: 0, y: 0, width: 32, height: 32 })
  ]), /at least 64px/);

  const transparentBytes = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 30, g: 60, b: 40, alpha: 0.5 } }
  }).png().toBuffer();
  const transparent = {
    canonicalPath: '/provider/transparent.png',
    image: {
      buffer: transparentBytes,
      sourceFormat: 'png',
      metadata: { width: 128, height: 128 }
    },
    sha256: sha256(transparentBytes)
  };
  await assert.rejects(() => composeTerrainAtlas(job, [
    input('base-0', transparent, { x: 0, y: 0, width: 128, height: 128 })
  ]), /not fully opaque/);

  const isolatedRaw = Buffer.alloc(128 * 128 * 4);
  for (let offset = 0; offset < isolatedRaw.length; offset += 4) {
    isolatedRaw[offset] = 30;
    isolatedRaw[offset + 1] = 60;
    isolatedRaw[offset + 2] = 40;
    isolatedRaw[offset + 3] = 255;
  }
  isolatedRaw[3] = 0;
  const isolatedAlphaBytes = await sharp(isolatedRaw, {
    raw: { width: 128, height: 128, channels: 4 }
  }).png().toBuffer();
  const isolatedAlpha = {
    canonicalPath: '/provider/isolated-alpha.png',
    image: {
      buffer: isolatedAlphaBytes,
      sourceFormat: 'png',
      metadata: { width: 128, height: 128 }
    },
    sha256: sha256(isolatedAlphaBytes)
  };
  await assert.rejects(() => composeTerrainAtlas(job, [
    input('base-0', isolatedAlpha, { x: 0, y: 0, width: 128, height: 128 })
  ]), /not fully opaque/);

  isolatedRaw[0] = 255;
  isolatedRaw[1] = 0;
  isolatedRaw[2] = 255;
  isolatedRaw[3] = 255;
  const isolatedMagentaBytes = await sharp(isolatedRaw, {
    raw: { width: 128, height: 128, channels: 4 }
  }).png().toBuffer();
  const isolatedMagenta = {
    canonicalPath: '/provider/isolated-magenta.png',
    image: {
      buffer: isolatedMagentaBytes,
      sourceFormat: 'png',
      metadata: { width: 128, height: 128 }
    },
    sha256: sha256(isolatedMagentaBytes)
  };
  await assert.rejects(() => composeTerrainAtlas(job, [
    input('base-0', isolatedMagenta, { x: 0, y: 0, width: 128, height: 128 })
  ]), /contains opaque #FF00FF/);
});
