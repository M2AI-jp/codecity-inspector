import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutTown } from '../src/layout.mjs';
import { validateOverlay } from '../src/overlay/read.mjs';
import { placeOverlay, defaultManifest } from '../src/overlay/place.mjs';
import { overlayLayoutOptions } from '../src/overlay/layout-options.mjs';
import { artFrom, buildWorld } from '../src/overlay/geometry.mjs';
import { navGuard } from '../src/overlay/nav-guard.mjs';
import { simpleTown } from './helpers/overlay-fixtures.mjs';

// 町の人とクリックで歩く主人公は、tile の道案内の格子（world.navComp）で道を引く。
// overlay の人・物は、1px の足元だけでなく、この格子でも出発点からの道を切り離さない。
const fixture = JSON.parse(readFileSync(new URL('./fixtures/overlay-fuzz.json', import.meta.url)));
const manifest = defaultManifest();
const T = 16;

function routable(town) {
  const { world, start } = buildWorld(town, artFrom(manifest));
  return { world, comp: world.navComp[Math.floor((start.y - 3) / T) * world.cols + Math.floor(start.x / T)] };
}

test('overlay nav guard: rejects a rect that cuts the only tile route and leaves the world as it was', () => {
  const town = simpleTown();
  // 12 行目は 1 マスだけ渡れる水。北の家（戸口は 8 行目）へは (14,12) を通るしかない。
  town.ground = town.ground.map((row, y) => (y === 12 ? `${'~'.repeat(14)}+${'~'.repeat(17)}` : row));
  const keepNav = navGuard(town, manifest);
  const corridor = { x: 14 * T, y: 12 * T, w: T, h: T }, harmless = { x: 5 * T, y: 18 * T, w: T, h: T };
  assert.equal(keepNav([corridor], false), false, 'blocking the corridor cuts the northern houses off');
  assert.equal(keepNav([harmless], false), true, 'a rect away from the corridor keeps every route');
  assert.equal(keepNav([corridor], false), false, 'a rejected attempt is undone, so the result does not change');
  assert.equal(keepNav([harmless], true), true);
  assert.equal(keepNav([corridor], true), false, 'a committed rect does not hide a later cut');
});

for (const [index, castle] of [[0x22, false], [0x25, false], [1, true], [8, true]]) {
  test(`overlay: people and markers keep every routable tile routable (${index.toString(16)}${castle ? ', castle' : ''})`, () => {
    const overlay = validateOverlay({ ...fixture.overlay, seed: `gridhub@fuzz:${index.toString(16).padStart(7, '0')}`,
      goal: { ...fixture.overlay.goal, ...(castle ? { look: 'castle' } : {}) } });
    const base = layoutTown(fixture.model, overlayLayoutOptions(overlay));
    const before = routable(JSON.parse(JSON.stringify(base)));
    const town = placeOverlay(base, overlay, manifest);
    const after = routable(town), cols = after.world.cols, cut = [];
    for (let k = 0; k < before.world.navComp.length; k++) {
      if (before.world.navComp[k] === before.comp && !after.world.nav[k] && after.world.navComp[k] !== after.comp) cut.push([k % cols, Math.floor(k / cols)]);
    }
    assert.deepEqual(cut, [], 'tiles that became unreachable on the route grid');
  });
}
