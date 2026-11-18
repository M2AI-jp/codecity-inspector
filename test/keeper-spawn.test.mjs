import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutTown } from '../src/layout.mjs';
import { validateOverlay } from '../src/overlay/read.mjs';
import { placeOverlay, defaultManifest } from '../src/overlay/place.mjs';
import { overlayLayoutOptions } from '../src/overlay/layout-options.mjs';
import { checkPlay } from '../tools/check-play.mjs';

// 番人は歩く人より先に作られ、当たりも先に入る。外に立つ番人と同じ所に町の人を出さない。
// 以前は番人の当たりが歩く人を作った後に入り、gridhub の城つき overlay の種 0x1d などで、
// 常連 c24 が番人 b19 と重なって現れ、動けなかった。
const fixture = JSON.parse(readFileSync(new URL('./fixtures/overlay-fuzz.json', import.meta.url)));
const manifest = defaultManifest();

for (const index of [0x1d, 0x2c, 0x41, 0xc2]) test(`walkers never start on a standing keeper (castle ${index.toString(16)})`, () => {
  const overlay = validateOverlay({ ...fixture.overlay, seed: `gridhub@fuzz:${index.toString(16).padStart(7, '0')}`,
    goal: { ...fixture.overlay.goal, look: 'castle' } });
  const town = placeOverlay(layoutTown(fixture.model, overlayLayoutOptions(overlay)), overlay, manifest);
  const checked = checkPlay(town, manifest);
  assert.equal(checked.failed, 0, checked.problems.join('\n'));
});
