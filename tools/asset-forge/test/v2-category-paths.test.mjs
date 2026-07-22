import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWith } from '../src/schemas.mjs';
import { AUTHORING_CATEGORIES, CATEGORY_DIRS } from '../src/config.mjs';
import { assetFileStem, categoryDirectory, validateAssetId } from '../src/paths.mjs';

const V2_CATEGORIES = Object.freeze({
  terrain: 'terrains',
  overlay: 'overlays',
  structure: 'structures',
  interior: 'interiors',
  prop: 'props'
});

test('v2 authoring categories have stable isolated state directories', () => {
  for (const [category, directory] of Object.entries(V2_CATEGORIES)) {
    assert.ok(AUTHORING_CATEGORIES.includes(category));
    assert.equal(CATEGORY_DIRS[category], directory);
    assert.equal(categoryDirectory(category), directory);
    assert.equal(validateAssetId(`${category}.sample`), `${category}.sample`);
    assert.equal(assetFileStem(`${category}.sample.variant`), `${category}_sample_variant`);
  }
  assert.equal(new Set(Object.values(CATEGORY_DIRS)).size, AUTHORING_CATEGORIES.length);
});

test('legacy category paths remain valid while unknown categories fail closed', () => {
  assert.equal(categoryDirectory('field'), 'fields');
  assert.equal(validateAssetId('character.mob.traveler'), 'character.mob.traveler');
  assert.throws(() => categoryDirectory('tiles'), /Unknown asset category/);
  assert.throws(() => validateAssetId('tiles.grass'), /Invalid asset id/);
});

test('manifests accept v2 category paths without weakening direct PNG constraints', () => {
  const assetManifest = {
    schemaVersion: 1,
    assets: [{
      assetId: 'terrain.grass',
      category: 'terrain',
      status: 'approved',
      approvedPath: 'generated/terrains/approved/terrain_grass-0123456789abcdef.png',
      pendingGenerationIds: [],
      rejectedGenerationIds: [],
      lastUpdated: '2026-07-16T00:00:00.000Z'
    }]
  };
  assert.equal(validateWith('asset-manifest.schema.json', assetManifest).ok, true);
  assetManifest.assets[0].approvedPath = 'generated/terrains/approved/nested/terrain_grass.png';
  assert.equal(validateWith('asset-manifest.schema.json', assetManifest).ok, false);
});
