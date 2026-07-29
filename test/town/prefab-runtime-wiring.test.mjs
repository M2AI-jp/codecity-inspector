// Integration guards for the browser-facing prefab renderer. The detailed
// manifest/file contract lives in world-prefabs-runtime-contract.test.mjs;
// these tests make sure the application actually consumes that contract.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PRODUCTION_ASSETS,
  WORLD_PREFABS,
  drawWorldPrefabs
} from '../../public/fable5-v2/site-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const APP_PATH = path.join(REPO_ROOT, 'public/fable5-v2/app.js');
const SITE_RUNTIME_PATH = path.join(REPO_ROOT, 'public/fable5-v2/site-runtime.mjs');

test('the browser asset contract has no whole-town master fallback', () => {
  assert.equal(Object.hasOwn(PRODUCTION_ASSETS, 'worldMaster'), false);
  assert.equal(WORLD_PREFABS.length, 45);
  assert.equal(
    Object.values(PRODUCTION_ASSETS).some(({ url }) => url.includes('/assets/world/')),
    false,
    'a browser-loaded production asset must never point at a whole-world PNG'
  );
  for (const prefab of WORLD_PREFABS) {
    assert.match(prefab.url, /^\/fable5-v2\/assets\/prefabs\//, prefab.id);
  }
});

test('drawWorldPrefabs preserves the verified pre-sorted native coordinates', () => {
  const calls = [];
  const context = {
    drawImage(...args) {
      calls.push(args);
    }
  };
  const prefabImages = Object.fromEntries(
    WORLD_PREFABS.map(({ id }) => [id, { token: id }])
  );

  drawWorldPrefabs(context, prefabImages);

  assert.deepEqual(calls, WORLD_PREFABS.map((prefab) => [
    prefabImages[prefab.id],
    prefab.x,
    prefab.y
  ]));
});

test('the app loads and draws the prefab collection instead of a worldMaster image', async () => {
  const [appSource, siteRuntimeSource] = await Promise.all([
    readFile(APP_PATH, 'utf8'),
    readFile(SITE_RUNTIME_PATH, 'utf8')
  ]);

  assert.match(appSource, /drawWorldPrefabs\(context, state\.assets\.worldPrefabs\)/);
  assert.doesNotMatch(appSource, /drawWorldImage\(/);
  assert.doesNotMatch(appSource, /state\.assets\.worldMaster/);
  assert.match(siteRuntimeSource, /const prefabEntries = WORLD_PREFABS\.map/);
  assert.match(siteRuntimeSource, /return Object\.freeze\(\{ \.\.\.productionAssets, worldPrefabs \}\)/);
  assert.doesNotMatch(siteRuntimeSource, /worldMaster/);
});
