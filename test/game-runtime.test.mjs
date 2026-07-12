import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetForBinding, buildingOccupiesTile, canPlayerEnter, findPlayerSpawn,
  indexGameAssets, loadGameAssets, movePlayer, validateGameAssetManifest
} from '../public/game-runtime.mjs';

const manifest = {
  schemaVersion: 1,
  generatedAt: '2026-07-13T00:00:00.000Z',
  complete: false,
  missingBindings: [{ vocabulary: 'TILE_TYPES', runtimeId: 'water' }],
  assets: [{
    assetId: 'field.grass', category: 'field', sha256: 'a'.repeat(64),
    publicPath: '/assets/forge/v1/aaaaaaaaaaaaaaaa/field_grass.png',
    gameBinding: {
      rendererCategory: 'tile', semanticKind: 'grass', drawLayer: 'ground', coverage: 'exact',
      runtimeBindings: [{ vocabulary: 'TILE_TYPES', id: 'grass' }]
    }
  }]
};

const layout = {
  map: {
    widthTiles: 4, heightTiles: 3,
    terrain: [
      ['water', 'grass', 'grass', 'cliff'],
      ['road', 'road', 'grass', 'grass'],
      ['water', 'bridge', 'stairs', 'grass']
    ]
  },
  buildings: [{ x: 2, y: 0, footprint: { widthTiles: 1, heightTiles: 2 } }]
};

test('approved asset manifest validates and indexes exact runtime bindings', () => {
  assert.equal(validateGameAssetManifest(manifest), manifest);
  const index = indexGameAssets(manifest);
  assert.equal(assetForBinding(index, 'TILE_TYPES', 'grass').assetId, 'field.grass');
  assert.equal(assetForBinding(index, 'TILE_TYPES', 'water'), null);
  assert.throws(() => validateGameAssetManifest({ ...manifest, assets: [{ ...manifest.assets[0], publicPath: '/../secret.png' }] }), /Invalid/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, generatedAt: 'sometime' }), /Unsupported/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, extra: true }), /Unsupported/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, complete: true }), /completeness/);
  assert.throws(() => validateGameAssetManifest({
    ...manifest,
    assets: [{ ...manifest.assets[0], publicPath: '/assets/forge/v1/bbbbbbbbbbbbbbbb/field_grass.png' }]
  }), /content-addressed/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, missingBindings: [{ vocabulary: 'UNKNOWN', runtimeId: 'water' }] }), /Invalid/);
  const variant = {
    ...structuredClone(manifest.assets[0]), assetId: 'field.other', sha256: 'b'.repeat(64),
    publicPath: '/assets/forge/v1/bbbbbbbbbbbbbbbb/field_other.png'
  };
  const variants = { ...manifest, assets: [variant, manifest.assets[0]] };
  assert.equal(validateGameAssetManifest(variants), variants);
  const variantIndex = indexGameAssets(variants);
  assert.equal(assetForBinding(variantIndex, 'TILE_TYPES', 'grass').assetId, 'field.grass');
  assert.deepEqual(variantIndex.variantsByBinding.get('TILE_TYPES\0grass').map(({ assetId }) => assetId), ['field.grass', 'field.other']);
});

test('player spawn, walkability, bounds, facing, and building collision are deterministic', () => {
  assert.equal(buildingOccupiesTile(layout.buildings, 2, 1), true);
  assert.equal(canPlayerEnter(layout, 0, 0), false);
  assert.equal(canPlayerEnter(layout, 2, 1), false);
  assert.deepEqual(findPlayerSpawn(layout), { x: 0, y: 1, facing: 'down' });
  const start = { x: 0, y: 1, facing: 'down' };
  assert.deepEqual(movePlayer(layout, start, 'right'), { x: 1, y: 1, facing: 'right' });
  assert.deepEqual(movePlayer(layout, start, 'up'), { x: 0, y: 1, facing: 'up' });
  assert.deepEqual(movePlayer(layout, start, 'left'), { x: 0, y: 1, facing: 'left' });
});

test('incomplete approved manifests remain visibly partial instead of silently claiming loaded', async () => {
  const createImage = () => ({
    onload: null,
    onerror: null,
    set src(_value) { queueMicrotask(() => this.onload()); }
  });
  const runtime = await loadGameAssets({
    fetchImpl: async () => ({ ok: true, json: async () => manifest }),
    createImage
  });
  assert.equal(runtime.status, 'partial');
  assert.match(runtime.reason, /runtime binding/);
  assert.equal(runtime.images.size, 1);
});
