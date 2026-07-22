// Static contract coverage for the prefab table exported by site-runtime.mjs.
// This intentionally verifies only the data hand-off from manifest/files to
// WORLD_PREFABS; it does not execute or make a claim about renderer integration.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_ASSETS, WORLD_PREFABS } from '../../public/fable5-v2/site-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'public/fable5-v2/assets/prefabs/manifest.json');
const SITE_RUNTIME_PATH = path.join(REPO_ROOT, 'public/fable5-v2/site-runtime.mjs');
const RUNTIME_PREFAB_COUNT = 45;

const SPECIAL_HANDLING = [
  {
    id: 'target-town-route-streetlamp-foreground-v1',
    productionAsset: 'routeStreetlamp',
    documentation: ['PRODUCTION_ASSETS.routeStreetlamp', 'playerBehindStreetlamp']
  },
  {
    id: 'target-town-inn-entrance-foreground-v1',
    productionAsset: 'entranceForeground',
    documentation: ['PRODUCTION_ASSETS.entranceForeground', 'drawn only in interior mode']
  },
  {
    id: 'target-town-inn-bartender-source-visible-v1',
    productionAsset: null,
    documentation: ['not loaded at all', 'PRODUCTION_ASSETS.innCounterClean']
  }
];

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const siteRuntimeSource = await readFile(SITE_RUNTIME_PATH, 'utf8');
const manifestById = new Map(manifest.prefabs.map((record) => [record.assetId, record]));

function runtimeUrlFor(manifestPath) {
  assert.ok(manifestPath.startsWith('public/'), `manifest path must start with public/: ${manifestPath}`);
  return `/${manifestPath.slice('public/'.length)}`;
}

function pngDimensionsFromBuffer(buffer) {
  assert.ok(buffer.length >= 24, 'PNG is too short to contain an IHDR chunk');
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'bad PNG signature');
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR', 'missing PNG IHDR chunk');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function contractFields(asset) {
  return {
    url: asset.url,
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256
  };
}

function manifestContractFields(record) {
  return {
    url: runtimeUrlFor(record.path),
    width: record.dimensions.width,
    height: record.dimensions.height,
    sha256: record.sha256
  };
}

function drawOrderIsAscending(previous, current) {
  return current.zIndex > previous.zIndex
    || (current.zIndex === previous.zIndex && current.id > previous.id);
}

test('WORLD_PREFABS has 45 unique ids, each backed by a unique manifest record', () => {
  assert.equal(WORLD_PREFABS.length, RUNTIME_PREFAB_COUNT);

  const runtimeIds = WORLD_PREFABS.map(({ id }) => id);
  const manifestIds = manifest.prefabs.map(({ assetId }) => assetId);
  assert.equal(new Set(runtimeIds).size, runtimeIds.length, 'WORLD_PREFABS ids must be unique');
  assert.equal(new Set(manifestIds).size, manifestIds.length, 'manifest prefab assetIds must be unique');

  for (const id of runtimeIds) {
    assert.ok(manifestById.has(id), `WORLD_PREFABS id has no manifest record: ${id}`);
  }
});

test('every runtime prefab exactly maps its manifest crop and its PNG file', async () => {
  for (const runtimePrefab of WORLD_PREFABS) {
    const record = manifestById.get(runtimePrefab.id);
    assert.ok(record, `missing manifest record for ${runtimePrefab.id}`);
    assert.equal(record.provenance, 'this-manifest', `${runtimePrefab.id} must be a runtime-managed record`);
    assert.equal(typeof runtimePrefab.role, 'string', `${runtimePrefab.id}: runtime role`);
    assert.ok(runtimePrefab.role.length > 0, `${runtimePrefab.id}: runtime role must not be empty`);

    assert.deepEqual(contractFields(runtimePrefab), manifestContractFields(record), runtimePrefab.id);
    assert.deepEqual(
      record.cropBoxWorld,
      {
        x: runtimePrefab.x,
        y: runtimePrefab.y,
        width: runtimePrefab.width,
        height: runtimePrefab.height
      },
      `${runtimePrefab.id}: runtime image must use the manifest's exact crop`
    );
    assert.deepEqual(
      {
        layer: runtimePrefab.layer,
        zIndex: runtimePrefab.zIndex,
        x: runtimePrefab.x,
        y: runtimePrefab.y
      },
      {
        layer: record.layer,
        zIndex: record.zIndex,
        x: record.cropOriginWorld.x,
        y: record.cropOriginWorld.y
      },
      runtimePrefab.id
    );

    const absoluteAssetPath = path.join(REPO_ROOT, record.path);
    const [fileInfo, buffer] = await Promise.all([stat(absoluteAssetPath), readFile(absoluteAssetPath)]);
    assert.equal(runtimePrefab.bytes, fileInfo.size, `${runtimePrefab.id}: runtime byte count`);
    assert.equal(buffer.byteLength, fileInfo.size, `${runtimePrefab.id}: bytes read from disk`);
    assert.deepEqual(pngDimensionsFromBuffer(buffer), record.dimensions, `${runtimePrefab.id}: PNG dimensions`);
    assert.equal(
      createHash('sha256').update(buffer).digest('hex'),
      record.sha256,
      `${runtimePrefab.id}: manifest hash must match the file`
    );
  }
});

test('WORLD_PREFABS is pre-sorted in ascending draw order', () => {
  for (let index = 1; index < WORLD_PREFABS.length; index += 1) {
    const previous = WORLD_PREFABS[index - 1];
    const current = WORLD_PREFABS[index];
    assert.ok(
      drawOrderIsAscending(previous, current),
      `draw order regressed: ${previous.id} (${previous.zIndex}) before ${current.id} (${current.zIndex})`
    );
  }
});

test('the only three non-runtime manifest records have explicit, matching special handling', () => {
  const runtimeIds = new Set(WORLD_PREFABS.map(({ id }) => id));
  const nonRuntimeRecords = manifest.prefabs.filter(({ assetId }) => !runtimeIds.has(assetId));
  const expectedIds = SPECIAL_HANDLING.map(({ id }) => id).sort();

  assert.equal(manifest.prefabs.length, RUNTIME_PREFAB_COUNT + SPECIAL_HANDLING.length);
  assert.deepEqual(nonRuntimeRecords.map(({ assetId }) => assetId).sort(), expectedIds);
  assert.deepEqual(
    manifest.prefabs
      .filter(({ provenance }) => provenance === 'pre-existing')
      .map(({ assetId }) => assetId)
      .sort(),
    expectedIds,
    'pre-existing manifest records are the only deliberate WORLD_PREFABS omissions'
  );

  const specialHandlingCommentStart = siteRuntimeSource.indexOf('// 3 of the master decomposition');
  const worldPrefabsDeclaration = siteRuntimeSource.indexOf('export const WORLD_PREFABS');
  assert.ok(specialHandlingCommentStart >= 0, 'site runtime must document the deliberate omissions');
  assert.ok(worldPrefabsDeclaration > specialHandlingCommentStart, 'WORLD_PREFABS must follow its omission documentation');
  const specialHandlingComment = siteRuntimeSource.slice(specialHandlingCommentStart, worldPrefabsDeclaration);

  for (const specialCase of SPECIAL_HANDLING) {
    const record = manifestById.get(specialCase.id);
    assert.equal(record.provenance, 'pre-existing', `${specialCase.id}: provenance`);
    assert.equal(runtimeIds.has(specialCase.id), false, `${specialCase.id} must not be duplicated in WORLD_PREFABS`);
    assert.ok(record.lineagePath, `${specialCase.id} must retain its pre-existing lineage`);
    assert.ok(specialHandlingComment.includes(specialCase.id), `${specialCase.id} needs runtime documentation`);
    for (const text of specialCase.documentation) {
      assert.ok(specialHandlingComment.includes(text), `${specialCase.id} documentation must mention ${text}`);
    }

    if (specialCase.productionAsset) {
      assert.deepEqual(
        contractFields(PRODUCTION_ASSETS[specialCase.productionAsset]),
        manifestContractFields(record),
        `${specialCase.id} must retain its existing production asset contract`
      );
    } else {
      assert.equal(
        Object.values(PRODUCTION_ASSETS).some(({ id }) => id === specialCase.id),
        false,
        `${specialCase.id} must remain absent from direct asset loading`
      );
    }
  }
});
