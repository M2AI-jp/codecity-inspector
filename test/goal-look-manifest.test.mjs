import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultManifest } from '../src/overlay/place.mjs';

const manifest = defaultManifest();

test('goal.look: sidecar and generated manifest keep the supplied candidate as a non-walkable landmark', () => {
  const side = JSON.parse(readFileSync(new URL('../art/game/landmarks/castle-1.json', import.meta.url)));
  assert.equal(Object.hasOwn(side, 'deck'), false);
  assert.deepEqual(manifest.props['castle-1'].solid, side.solid);
  assert.equal(manifest.props['castle-1'].src, 'landmarks/castle-1.png');
  assert.deepEqual(manifest.props['castle-1'].size, [192, 224]);
});
