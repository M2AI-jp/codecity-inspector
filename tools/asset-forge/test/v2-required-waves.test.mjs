import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateWith } from '../src/schemas.mjs';
import { canonicalJson, sha256 } from '../src/hashing.mjs';

const manifest = JSON.parse(await readFile(
  new URL('../data/v2/waves.json', import.meta.url),
  'utf8'
));

test('Fable5 required waves pin the canonical 109 plus 49 unique asset IDs', () => {
  const validation = validateWith('required-waves.schema.json', manifest);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.deepEqual(manifest.waves.map(({ id, requiredAssetCount, minimumOutputPngCount }) => ({
    id, requiredAssetCount, minimumOutputPngCount
  })), [
    { id: 'A', requiredAssetCount: 109, minimumOutputPngCount: 128 },
    { id: 'B', requiredAssetCount: 49, minimumOutputPngCount: 49 }
  ]);
  for (const wave of manifest.waves) {
    assert.equal(wave.assetIds.length, wave.requiredAssetCount);
    assert.equal(new Set(wave.assetIds).size, wave.requiredAssetCount);
    assert.equal(sha256(canonicalJson(wave.assetIds)), wave.assetIdsSha256);
  }
  const allIds = manifest.waves.flatMap((wave) => wave.assetIds);
  assert.equal(allIds.length, 158);
  assert.equal(new Set(allIds).size, 158);
  assert.equal(manifest.waves[0].assetIds.filter((id) => id.startsWith('building.')).length, 19);
});

test('the required wave schema rejects duplicate IDs and count drift', () => {
  const duplicate = structuredClone(manifest);
  duplicate.waves[0].assetIds[1] = duplicate.waves[0].assetIds[0];
  assert.equal(validateWith('required-waves.schema.json', duplicate).ok, false);

  const drift = structuredClone(manifest);
  drift.waves[0].requiredAssetCount = 108;
  assert.equal(validateWith('required-waves.schema.json', drift).ok, false);

  const replaced = structuredClone(manifest);
  replaced.waves[0].assetIds[0] = 'terrain.survey_blank';
  replaced.waves[0].assetIdsSha256 = sha256(canonicalJson(replaced.waves[0].assetIds));
  assert.equal(validateWith('required-waves.schema.json', replaced).ok, false);
});
