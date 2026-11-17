import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../web/world.js';
import { parseGround } from '../web/ground.js';
import { Player } from '../web/player.js';
import { SIM_DT } from '../web/config.js';
import { artFrom, buildWorld } from '../tools/check-play.mjs';

const worldOf = (cols, rows) => {
  const town = { cols, rows, ground: Array(rows).fill('+'.repeat(cols)), buildings: [], props: [] };
  return new World(town, artFrom({}), parseGround(town));
};

function follow(world, start, route) {
  assert.ok(route, 'クリック先への経路がある');
  const player = new Player(start.x, start.y, null);
  player.setPath(route.points, route.target);
  const input = { slow: false, axis(o) { o.x = o.y = 0; return o; } };
  for (let n = 0; n < 1200 && player.path; n++) player.update(SIM_DT, input, world);
  assert.ok(Math.hypot(player.x - route.target.x, player.y - route.target.y) < 1,
    `目標 (${route.target.x},${route.target.y}) に到着する: (${player.x},${player.y})`);
  return player;
}

test('役場の室内で、格子がつながらない床もクリックした実座標まで歩ける', () => {
  const manifest = JSON.parse(readFileSync(new URL('../art/game/manifest.json', import.meta.url)));
  const town = {
    cols: 32, rows: 32, ground: Array(32).fill('+'.repeat(32)), props: [], spawn: { x: 21, y: 24 },
    buildings: [{ id: 'f1', archetype: 'town_hall', variant: 'town_hall-1',
      x: 17, y: 17, w: 8, h: 5, door: { x: 20, y: 21 }, module: { kind: 'town_hall', path: '.' } }],
  };
  const { world } = buildWorld(town, artFrom(manifest));
  let start = { x: 336, y: 324.5 };
  assert.equal(world.findPath(21, 20, 18, 20, { useCost: false }), null,
    '報告された開始点と目標点のtile代表点はつながっていない');
  for (const target of [{ x: 300, y: 324.5 }, { x: 336, y: 324.5 }, { x: 360, y: 316 }]) {
    assert.equal(world.feetHit(target.x, target.y), false);
    const route = world.pathTo(start.x, start.y, target.x, target.y);
    assert.deepEqual(route?.target, target, '空いている床はtile代表点へ吸着させない');
    start = follow(world, start, route);
  }
});

test('床クリックも細い曲がり角を歩け、閉じた通路は通らない', () => {
  const world = worldOf(8, 8);
  world.addRect(27, 0, 8, 35, 'wall');
  world.addRect(48, 27, 8, 101, 'wall');
  world.computeNav();
  const start = { x: 16, y: 16 }, target = { x: 112, y: 112 };
  assert.equal(world.findPath(1, 0, 7, 6), null);
  follow(world, start, world.pathTo(start.x, start.y, target.x, target.y));
  world.addRect(35, 27, 13, 8, 'wall');
  world.computeNav();
  assert.equal(world.pathTo(start.x, start.y, target.x, target.y), null);
});

test('経路の検査点の間で小物の角に足元が触れる場合も横切らない', () => {
  const world = worldOf(8, 20);
  world.addRect(31, 268, 18, 4, 'prop');
  // 3px間隔の点はどれも空いていたが、(54.99,266.9)付近で足が角に触れる。
  assert.equal(world.feetHit(54.99, 266.9), true);
  assert.equal(world.sweepFree(56, 283, 40, 27), false);
  assert.equal(world.sweepFree(60, 283, 60, 27), true);
});

test('1tile内で折り返す13pxの通路をクリック移動でき、閉じた通路は通らない', () => {
  const world = worldOf(8, 8);
  world.addRect(27, 0, 8, 35, 'wall');
  world.addRect(48, 27, 8, 101, 'wall');
  world.computeNav();
  const start = { x: 16, y: 16 }, target = { x: 112, y: 112 };
  const building = { doorInside: target, doorX0: 7, doorX1: 8, doorY: 6 };
  assert.equal(world.findPath(1, 0, 7, 6), null, '1tileに1点の格子だけでは曲がり角を表せない');
  const route = world.pathInto(building, start.x, start.y);
  assert.ok(route);
  const player = new Player(start.x, start.y, null);
  player.setPath(route.points, target);
  const input = { slow: false, axis(o) { o.x = o.y = 0; return o; } };
  for (let n = 0; n < 1200 && player.path; n++) player.update(SIM_DT, input, world);
  assert.ok(Math.hypot(player.x - target.x, player.y - target.y) < 1);
  world.addRect(35, 27, 13, 8, 'wall');
  world.computeNav();
  assert.equal(world.pathInto(building, start.x, start.y), null);
});

test('足元と同じ高さの通路へ曲がるとき、途中の点を端数だけ残して飛ばさない', () => {
  const world = worldOf(8, 8);
  world.addRect(48, 0, 48, 44, 'wall');
  world.addRect(48, 52, 48, 76, 'wall');
  const player = new Player(24.17, 20.31, null);
  const target = { x: 112, y: 50 };
  player.setPath([{ x: 40, y: 50 }, target], target);
  const input = { slow: false, axis(o) { o.x = o.y = 0; return o; } };
  for (let n = 0; n < 1200 && player.path; n++) player.update(SIM_DT, input, world);
  assert.ok(Math.hypot(player.x - target.x, player.y - target.y) < 1);
});

test('扉内の目標を格子の点へ差し替えた最後の区間も、家具に触れずに歩く', () => {
  const world = worldOf(8, 8);
  for (const r of [[0, 49, 32, 15], [64, 49, 32, 15], [20, 43, 20, 4], [66, 45, 12, 4], [56, 44, 9, 4]]) {
    world.addRect(...r, 'wall');
  }
  world.computeNav();
  const start = { x: 40, y: 59 }, target = { x: 48, y: 46 };
  const route = world.pathInto({ doorInside: target, doorX0: 2, doorX1: 4, doorY: 4 }, start.x, start.y);
  assert.ok(route);
  let previous = start;
  for (const p of route.points) {
    assert.ok(world.sweepFree(previous.x, previous.y, p.x, p.y));
    previous = p;
  }
  const player = new Player(start.x, start.y, null);
  player.setPath(route.points, target);
  const input = { slow: false, axis(o) { o.x = o.y = 0; return o; } };
  for (let n = 0; n < 1200 && player.path; n++) player.update(SIM_DT, input, world);
  assert.ok(Math.hypot(player.x - target.x, player.y - target.y) < 1);
});
