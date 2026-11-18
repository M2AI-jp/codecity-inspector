import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutTown, loadProps } from '../src/layout.mjs';
import { validateOverlay } from '../src/overlay/read.mjs';
import { placeOverlay, defaultManifest } from '../src/overlay/place.mjs';
import { checkAscii } from '../tools/check-ascii.mjs';
import { checkPlay } from '../tools/check-play.mjs';
import { largestRectangle, visibleLawn } from '../src/lawn.mjs';

// Geometry/counts only: no repository, author, commit text, service facts or files.
// Groups are already resolved, so this fixture needs no external checkout.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/overlay-fuzz.json', import.meta.url)));
const manifest = defaultManifest();
function generate(index, castle = false) {
  const overlay = validateOverlay({ ...fixture.overlay, seed: `gridhub@fuzz:${index.toString(16).padStart(7, '0')}`,
    goal: { ...fixture.overlay.goal, ...(castle ? { look: 'castle' } : {}) } });
  const base = layoutTown(fixture.model, { overlay: true, seed: overlay.seed, goalLook: overlay.goal?.look, goalAt: overlay.goal?.at });
  return { base, overlay, town: placeOverlay(base, overlay, manifest) };
}
for (const index of [0x22, 0x25]) test(`overlay: hiding the dojo sign preserves tile paths (${index.toString(16)})`, () => {
  const { town } = generate(index);
  assert.deepEqual(checkAscii(town, manifest).problems, []);
  assert.equal(checkPlay(town, manifest).failed, 0);
});
for (const [index, castle] of [[0x48, false], [0x0b, true]]) test(`overlay: lawn does not depend on a removable dojo sign (${index.toString(16)})`, () => {
  const { base, overlay, town } = generate(index, castle);
  const lawn = largestRectangle(visibleLawn(town, manifest.archetypes, loadProps(manifest)), town.cols, town.rows)?.a ?? 0;
  assert.ok(lawn <= 8, `visible lawn is ${lawn}`);
  // Live record removal uses the same base and restores every native sign.
  const restored = placeOverlay(base, { ...overlay, markers: [] }, manifest);
  const signs = (ps) => ps.filter((p) => /^sign-(passed|failed|unverified)$/.test(p.type));
  assert.ok(signs(base.props).length > 0);
  assert.equal(signs(restored.props).length, signs(base.props).length);
  assert.deepEqual(checkAscii(restored, manifest).problems, []);
});
for (const index of [1, 8]) test(`overlay: later solids cannot overhang the castle front (${index})`, () => {
  const { town } = generate(index, true);
  assert.equal(town.overlay.goal?.look, 'castle', 'a feasible castle must remain placed');
  const checked = checkPlay(town, manifest);
  assert.equal(checked.failed, 0, checked.lines.join('\n'));
  assert.deepEqual(checked.overlay.goalFront, { reachable: 28, total: 28 });
});
