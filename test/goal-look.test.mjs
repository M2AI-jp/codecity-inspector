import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateOverlay } from '../src/overlay/read.mjs';
import { placeOverlay, defaultManifest, layoutKey } from '../src/overlay/place.mjs';
import { goalGeometry } from '../src/overlay/goal.mjs';
import { layoutTown, loadArt, loadProps, loadGround } from '../src/layout.mjs';
import { artFrom, buildWorld, checkPlay } from '../tools/check-play.mjs';
import { checkSeed, fuzzSeeds } from '../tools/seed-fuzz.mjs';
import { propCells } from '../src/town-grid.mjs';

const manifest = defaultManifest();
const goal = { at: { landmark: 'town_hall' }, label: '完了', lines: ['城の候補'], look: 'castle' };
const overlay = (g = goal, extra = {}) => validateOverlay({ version: 1, goal: g, ...extra });
const openTown = () => ({
  version: 1, repo: { name: 'castle-test' }, cols: 40, rows: 34,
  ground: Array(34).fill('+'.repeat(40)), props: [], buildings: [], landmarks: [],
  residents: [], crowd: [], terraces: [], stairs: [], spawn: { x: 20, y: 28 },
});

test('goal.look: omitted stays absent; unknown strings and invalid types are diagnosed', () => {
  const { look, ...plain } = goal;
  assert.equal(Object.hasOwn(overlay(plain).goal, 'look'), false);
  for (const value of ['unknown', '__proto__', 'constructor', '', 2, null, {}]) {
    const result = overlay({ ...goal, look: value });
    assert.equal(result.goal, undefined);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /look/);
    const placed = placeOverlay(openTown(), result, manifest);
    assert.equal(placed.overlay.goal, null);
    assert.equal(placed.props.length, 0);
    assert.equal(placed.overlay.unplaced[0].scope, 'goal');
  }
  assert.notEqual(layoutKey(overlay(plain)), layoutKey(overlay()));
  assert.equal(layoutKey(overlay()), layoutKey(overlay({ ...goal, label: '別の名札' })));
});

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

test('goal.look: missing art, insufficient space and terrace edges remain explained unplaced', () => {
  const noArt = structuredClone(manifest); delete noArt.props['castle-1'];
  const missing = placeOverlay(openTown(), overlay(), noArt);
  assert.equal(missing.overlay.goal, null);
  assert.match(missing.overlay.unplaced[0].reason, /missing solid goal art/);
  const tiny = openTown(); tiny.cols = 10; tiny.rows = 10; tiny.ground = Array(10).fill('+'.repeat(10)); tiny.spawn = { x: 5, y: 5 };
  const narrow = placeOverlay(tiny, overlay(), manifest);
  assert.equal(narrow.overlay.goal, null);
  assert.match(narrow.overlay.unplaced[0].reason, /no safe level space/);
  const stepped = openTown();
  // Every six-row footprint crosses a raised edge.
  stepped.terraces = Array.from({ length: 16 }, (_, i) => ({ x: 0, y: i * 2, w: 40, h: 1 }));
  stepped.stairs = stepped.terraces.map((t) => ({ x: 0, y: t.y + 1, w: 40 }));
  const result = placeOverlay(stepped, overlay(), manifest);
  assert.equal(result.overlay.goal, null);
  assert.match(result.overlay.unplaced[0].reason, /no safe level space/);
});

test('goal.look: layout reserves a plot without introducing an enterable castle; fuzz counts fronts', () => {
  const repo = {
    name: 'goal-layout', head: 'abc1234', modules: [
      { path: 'src', kind: 'house', files: 5, lines: 120, bytes: 1000, recent: 0, commits: 0, authors: [], topFiles: [], languages: {} },
    ], facilities: [], contributors: [],
  };
  const input = overlay(goal, { seed: 'memo' });
  const opts = { art: loadArt(manifest), props: loadProps(manifest), ground: loadGround(manifest), seed: input.seed };
  const plain = layoutTown(repo, opts);
  assert.equal(Object.hasOwn(plain, 'goalSite'), false);
  assert.equal(JSON.stringify(plain), JSON.stringify(layoutTown(repo, { ...opts, goalLook: undefined })));
  const result = checkSeed(repo, manifest, { overlay: input });
  assert.equal(result.problems.length, 0, result.problems.join('\n'));
  assert.ok(result.town.overlay.goal, JSON.stringify(result.town.unplaced));
  assert.equal(result.town.buildings.length, plain.buildings.length);
  assert.ok(result.town.buildings.every((b) => b.archetype !== 'goal-site' && b.archetype !== 'castle'));
  const fuzz = fuzzSeeds(repo, manifest, { count: 3, overlay: input });
  assert.equal(fuzz.failed, 0, JSON.stringify(fuzz.results));
  assert.ok(fuzz.results.some((r) => r.overlay?.goalFront?.reachable === 28));
});

test('goal.look: sidecar and generated manifest keep the supplied candidate as a non-walkable landmark', () => {
  const side = JSON.parse(readFileSync(new URL('../art/game/landmarks/castle-1.json', import.meta.url)));
  assert.equal(Object.hasOwn(side, 'deck'), false);
  assert.deepEqual(manifest.props['castle-1'].solid, side.solid);
  assert.equal(manifest.props['castle-1'].src, 'landmarks/castle-1.png');
  assert.deepEqual(manifest.props['castle-1'].size, [192, 224]);
});
