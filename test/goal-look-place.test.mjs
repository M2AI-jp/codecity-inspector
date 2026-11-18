import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOverlay, defaultManifest } from '../src/overlay/place.mjs';
import { goalGeometry } from '../src/overlay/goal.mjs';
import { loadProps } from '../src/layout.mjs';
import { artFrom, buildWorld, checkPlay } from '../tools/check-play.mjs';
import { propCells } from '../src/town-grid.mjs';
import { goal, overlay, openTown } from './helpers/goal-look-fixtures.mjs';

const manifest = defaultManifest();

test('goal.look: castle is solid, not a building or a deck, with reachable label and clear front', () => {
  const base = openTown(), before = JSON.stringify(base);
  const input = overlay(goal, {
    markers: [{ id: 'board', kind: 'board', label: '掲示板', at: { landmark: 'town_hall' } }],
    people: [{ id: 'person', name: '人', at: { landmark: 'town_hall' } }],
  });
  const town = placeOverlay(base, input, manifest), g = town.overlay.goal;
  assert.ok(g, JSON.stringify(town.unplaced));
  assert.equal(JSON.stringify(base), before);
  assert.deepEqual(town.buildings, base.buildings);
  assert.deepEqual(town.landmarks, base.landmarks);
  const prop = town.props.find((p) => p.overlayId === 'goal:$goal');
  assert.equal(prop.look, 'castle-1');
  const def = manifest.props[prop.look], geo = goalGeometry(prop, def);
  assert.equal(def.deck, undefined);
  assert.deepEqual(def.solid, [-96, -96, 192, 96]);
  const { world } = buildWorld(town, artFrom(manifest));
  assert.equal(world.feetHit(prop.x * 16, prop.y * 16 - 20), true);
  assert.equal(world.feetHit(g.x * 16, g.y * 16), false);
  for (const r of [geo.front, ...geo.sides]) assert.equal(world.boxHits(r.x, r.y, r.x + r.w, r.y + r.h), false);
  const reserved = new Set(geo.clearance.map(([x, y]) => `${x},${y}`));
  for (const p of town.props.filter((p) => p !== prop)) {
    assert.ok(propCells(p, loadProps(manifest)).every(([x, y]) => !reserved.has(`${x},${y}`)));
  }
  const checked = checkPlay(town, manifest);
  assert.equal(checked.failed, 0, checked.lines.join('\n'));
  assert.deepEqual(checked.overlay.goal, { reachable: 1, total: 1 });
  assert.deepEqual(checked.overlay.goalFront, { reachable: 28, total: 28 });
  assert.equal(JSON.stringify(placeOverlay(base, input, manifest)), JSON.stringify(town));
  const blocked = structuredClone(town);
  blocked.props.push({ type: 'barrel', x: g.x, y: prop.y + 1 });
  assert.ok(checkPlay(blocked, manifest).failed > 0, 'front obstruction must fail the check');
  const badLabel = structuredClone(town);
  badLabel.overlay.goal.y = prop.y - .5;
  assert.deepEqual(checkPlay(badLabel, manifest).overlay.goal, { reachable: 0, total: 1 }, 'the label must itself be on walkable ground');
});

test('goal.look: missing art, insufficient space and terrace edges preserve the plain label', () => {
  const { look, ...plain } = goal;
  const labelSurvives = (base, art = manifest) => {
    const result = placeOverlay(base, overlay(), art);
    assert.deepEqual(result.overlay.goal, placeOverlay(base, overlay(plain), art).overlay.goal);
    assert.ok(result.overlay.goal);
    assert.equal(Object.hasOwn(result.overlay.goal, 'look'), false);
    assert.equal(result.props.some((p) => p.overlayId === 'goal:$goal'), false);
    const diagnostic = result.overlay.unplaced.find((u) => u.scope === 'goal');
    assert.equal(diagnostic.id, result.overlay.goal.id);
    assert.equal(diagnostic.part, 'landmark');
    assert.equal(diagnostic.look, 'castle');
    assert.ok(result.unplaced.includes(diagnostic));
    assert.deepEqual(checkPlay(result, art).overlay.goal, { reachable: 1, total: 1 });
    return result;
  };
  const noArt = structuredClone(manifest); delete noArt.props['castle-1'];
  const missing = labelSurvives(openTown(), noArt);
  assert.match(missing.overlay.unplaced[0].reason, /missing solid goal art/);
  const tiny = openTown(); tiny.cols = 10; tiny.rows = 10; tiny.ground = Array(10).fill('+'.repeat(10)); tiny.spawn = { x: 5, y: 5 };
  const narrow = labelSurvives(tiny);
  assert.match(narrow.overlay.unplaced[0].reason, /no safe level space/);
  assert.equal(narrow.overlay.unplaced[0].site.stage, 'layout');
  assert.ok(narrow.overlay.unplaced[0].attempts.footprint > 0);
  const stepped = openTown();
  // Every six-row footprint crosses a raised edge.
  stepped.spawn.x = 35; // A narrow flat strip still has room for the plain label.
  stepped.terraces = Array.from({ length: 16 }, (_, i) => ({ x: 0, y: i * 2, w: 30, h: 1 }));
  stepped.stairs = stepped.terraces.map((t) => ({ x: 0, y: t.y + 1, w: 1 }));
  const result = labelSurvives(stepped);
  assert.match(result.overlay.unplaced[0].reason, /no safe level space/);
});

test('goal.look: an unreachable label is diagnosed separately from its missing landmark', () => {
  const town = openTown();
  town.ground = Array(town.rows).fill(' '.repeat(town.cols));
  const result = placeOverlay(town, overlay(), manifest);
  assert.equal(result.overlay.goal, null);
  assert.equal(result.overlay.unplaced.length, 2);
  const [landmark, label] = result.overlay.unplaced;
  assert.equal(landmark.part, 'landmark');
  assert.equal(Object.hasOwn(label, 'part'), false);
  assert.equal(label.reason, 'no reachable goal location');
  assert.equal(landmark.id, label.id);
});
