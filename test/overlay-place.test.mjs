import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOverlay, defaultManifest } from '../src/overlay/place.mjs';
import { artFrom, buildWorld, checkPlay } from '../tools/check-play.mjs';
import { propCells } from '../src/town-grid.mjs';
import { loadProps } from '../src/layout/manifest.mjs';
import { overlayGround } from '../src/overlay/terrain.mjs';
import { simpleTown, record, parsed } from './helpers/overlay-fixtures.mjs';

const manifest = defaultManifest();

test('overlay: one object per doorway, overflow within district, protected door front, deterministic positions', () => {
  const base = simpleTown(), before = JSON.stringify(base);
  const ov = parsed({ markers: [record('one'), record('two'), record('three'), { ...record('alien'), kind: 'castle' }] });
  const town = placeOverlay(base, ov, manifest);
  assert.equal(town.overlay.markers.length, 2);
  assert.deepEqual(town.overlay.markers.map((m) => m.building), ['b1', 'b2']);
  assert.ok(town.unplaced.some((u) => u.id === 'three' && u.reason));
  assert.ok(town.unplaced.some((u) => u.id === 'alien' && u.reason === 'unknown kind'));
  const { world } = buildWorld(town, artFrom(manifest));
  for (const prop of town.overlay.props) for (const [x, y] of propCells(prop, loadProps(manifest))) {
    assert.ok(!world.buildings.some((b) => x >= b.doorX0 - 1 && x <= b.doorX1 && y >= b.y + b.h && y <= b.y + b.h + 1));
  }
  assert.equal(JSON.stringify(placeOverlay(base, ov, manifest)), JSON.stringify(town));
  assert.equal(JSON.stringify(base), before);
  assert.equal(checkPlay(town, manifest).failed, 0);
});

test('overlay: record replaces dojo sign without changing repository state; removing it restores the sign', () => {
  const base = simpleTown();
  base.props.push({ type: 'sign-failed', x: 28.5, y: 20 });
  const ov = parsed({ markers: [record('record')] });
  const town = placeOverlay(base, ov, manifest);
  assert.equal(town.props.filter((p) => p.type.startsWith('sign-')).length, 1);
  assert.equal(town.props.find((p) => p.type.startsWith('sign-')).type, 'sign-unverified');
  const noRecords = placeOverlay(base, parsed(), manifest);
  assert.equal(noRecords.props.find((p) => p.type.startsWith('sign-')).type, 'sign-failed');
  assert.equal(base.props[0].type, 'sign-failed');
});

test('overlay: people, goal, absent groups and unresolved marker are accounted for', () => {
  const ov = parsed({ markers: [{ id: 'board', kind: 'board', label: '広場', at: { group: 'absent' } }],
    people: [{ id: 'person', name: '住人', at: { marker: 'board' } },
      { id: 'plaza', name: '広場の人', at: { group: 'absent' } },
      { id: 'missing', name: '未配置', at: { marker: 'missing' } }],
    goal: { label: '終点', at: { landmark: 'town_hall' } } });
  const town = placeOverlay(simpleTown(), ov, manifest), result = checkPlay(town, manifest);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.overlay.markers, { reachable: 1, total: 1 });
  assert.deepEqual(result.overlay.people, { reachable: 2, total: 2 });
  assert.deepEqual(result.overlay.goal, { reachable: 1, total: 1 });
  assert.equal(town.overlay.people[0].look, placeOverlay(simpleTown(), ov, manifest).overlay.people[0].look);
  assert.ok(town.unplaced.some((u) => u.id === 'missing' && u.reason === 'marker not placed'));
});

test('overlay: a gate needs an actual walkable cut point and a reachable guard', () => {
  const ov = parsed({ markers: [{ id: 'gate', kind: 'gate', label: '門', at: { landmark: 'gate' } }] });
  const open = placeOverlay(simpleTown(), ov, manifest);
  assert.equal(open.overlay.markers.length, 0);
  assert.match(open.unplaced[0].reason, /cut point/);
  const town = simpleTown(); town.buildings = []; town.cols = 24; town.rows = 20; town.spawn = { x: 10, y: 15 };
  const ground = Array.from({ length: 20 }, () => Array(24).fill(' '));
  for (let y = 1; y <= 18; y++) for (let x = 2; x <= 21; x++) {
    if (y <= 5 || y >= 10 || x === 10) ground[y][x] = '+';
  }
  for (const x of [7, 8, 12, 13]) ground[7][x] = '.';
  town.ground = ground.map((row) => row.join(''));
  const placed = placeOverlay(town, ov, manifest);
  assert.equal(placed.overlay.markers.length, 1, JSON.stringify(placed.unplaced));
  assert.ok(placed.overlay.markers[0].keeper);
  const checked = checkPlay(placed, manifest);
  assert.equal(checked.failed, 0, checked.lines.join('\n'));
});

test('overlay: isolated canal-side dirt is restored without moving a road or changing collisions', () => {
  const town = simpleTown(), ground = town.ground.map((row) => [...row]);
  for (let y = 10; y < 24; y++) { ground[y][25] = '~'; ground[y][26] = '~'; }
  ground[14][27] = ':'; ground[13][27] = ground[15][27] = ground[14][28] = '.';
  ground[18][27] = ground[18][28] = ':'; // connected path must remain
  town.ground = ground.map((row) => row.join(''));
  town.canal = { cells: Array.from({ length: 14 }, (_, i) => [[25, i + 10], [26, i + 10]]).flat(), crossings: [] };
  const fixed = overlayGround(town);
  assert.equal(fixed[14][27], '.'); assert.equal(fixed[18][27], ':');
  assert.equal(town.ground[14][27], ':');
  const before = buildWorld(town, artFrom(manifest)).world;
  const after = buildWorld({ ...town, ground: fixed }, artFrom(manifest)).world;
  assert.deepEqual(after.tileSolid, before.tileSolid);
  assert.deepEqual(after.rects, before.rects);
  assert.equal(overlayGround({ ...town, canal: undefined }), town.ground);
});
