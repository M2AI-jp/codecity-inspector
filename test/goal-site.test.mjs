import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTown } from '../src/layout.mjs';
import { validateOverlay } from '../src/overlay/read.mjs';
import { defaultManifest, placeOverlay } from '../src/overlay/place.mjs';

const manifest = defaultManifest();

test('goal site: the castle meets its paved frontage at the foot of the artwork', () => {
  const repo = {
    name: 'goal-site', head: 'fixture', facilities: [], contributors: [],
    modules: [{ path: 'src', kind: 'house', files: 5, lines: 120, bytes: 1000,
      recent: 0, commits: 0, authors: [], topFiles: [], languages: {} }],
  };
  const input = validateOverlay({ version: 1, seed: 'memo',
    goal: { at: { landmark: 'town_hall' }, label: '城', look: 'castle' } });
  const base = layoutTown(repo, { overlay: true, seed: input.seed,
    goalLook: input.goal.look, goalAt: input.goal.at });
  const town = placeOverlay(base, input, manifest);
  const castle = town.props.find((p) => p.type === 'castle');
  assert.ok(castle, 'this small town must have room for the castle');
  assert.equal(castle.x, town.goalSite?.x, 'use the site reserved by layout');
  assert.equal(castle.y, town.goalSite?.y, 'use the site reserved by layout');

  // CONTRACTS.md separates the solid foot from the front garden. Check the
  // visible paving against the artwork, without reading the layout's plot spec.
  const [sx, sy, width, height] = manifest.props[castle.look].solid;
  const left = castle.x + sx / town.tile, right = left + width / town.tile;
  const frontY = castle.y + (sy + height) / town.tile;
  const frontage = town.ground[frontY].slice(left - 1, right + 1);
  assert.equal(frontage.length, (right - left) + 2, 'both side clearances stay inside the town');
  assert.match(frontage, /^[#:+]+$/,
    'paving must meet the castle across its front and both side clearances; no grass band');
  assert.doesNotMatch(town.ground[frontY - 1].slice(left, right), /^[#:+]+$/,
    'the continuous frontage must begin outside the solid foot, not run underneath it');
});
