import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutTown, loadArt, loadProps } from '../src/layout.mjs';
import { stairClearance, stairClearanceConflicts, describeStairConflict } from '../src/stair-clearance.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const art = loadArt(), props = loadProps();
const conflicts = (town) => stairClearanceConflicts(town, art, props);
const sample = (name, head, count, kinds) => ({
  name, head,
  modules: Array.from({ length: count }, (_, i) => ({
    path: `src/part${i}`, kind: 'house', files: 3, lines: 100 + i * 20, bytes: 0, languages: {},
  })),
  facilities: kinds.map((archetype) => ({ archetype, merged: [], evidence: [], evidenceCount: 1, facts: {} })),
});

test('全階段の前後2行・左右1マスを確保し、そのすぐ外は含めない', () => {
  const s = { x: 10, y: 10, w: 3 };
  assert.deepEqual(stairClearance(s), { x0: 9, x1: 13, y0: 8, y1: 12 });
  for (let y = 7; y <= 13; y++) for (let x = 8; x <= 14; x++) {
    const expected = x >= 9 && x <= 13 && y >= 8 && y <= 12 ? 1 : 0;
    const b = { id: 'b1', archetype: 'flat', x, y, w: 1, h: 1 };
    assert.equal(stairClearanceConflicts({ stairs: [s], buildings: [b] },
      { flat: { variants: [{ id: 'flat', cover: [0] }] } }, {}).length, expected, `footprint ${x},${y}`);
    assert.equal(conflicts({ stairs: [s], props: [{ type: 'barrel', x: x + 0.5, y: y + 1 }] }).length,
      expected, `prop ${x},${y}`);
  }
  assert.deepEqual(conflicts({ buildings: [], props: [] }), []);
});

test('屋根は選んだ版の列別 cover を使い、0行・欠落時の2行も区別する', () => {
  const town = {
    stairs: [{ x: 10, y: 10, w: 2 }],
    buildings: [{ id: 'b1', archetype: 'house', variant: 'tall', x: 8, y: 14, w: 4, h: 2 }],
  };
  const a = { house: { variants: [{ id: 'flat', cover: [0, 0, 0, 0] }, { id: 'tall', cover: [4, 0, 1, 3] }] } };
  const hits = () => stairClearanceConflicts(town, a, {}).map(({ x, y, kind }) => [x, y, kind]);
  assert.deepEqual(hits(), [[11, 11, 'cover'], [11, 12, 'cover']]);
  town.buildings[0].variant = 'flat';
  assert.deepEqual(hits(), []);
  town.buildings[0].variant = 'missing';
  assert.deepEqual(hits(), [], 'coverOf と同じく未登録の版は先頭の版を使う');
  assert.deepEqual(stairClearanceConflicts(town, {}, {}).map(({ x, y }) => [x, y]),
    [[9, 12], [10, 12], [11, 12]], 'cover の無い列は2行');
});

test('広場・役場・緑地を区別せず、多マスの小物も端の重なりを検出する', () => {
  const stairs = [10, 20, 30].map((y) => ({ x: 10, y, w: 2 }));
  const town = { stairs, props: stairs.map((s) => ({ type: 'bench', x: 8.5, y: s.y + 3 })) };
  const hits = conflicts(town);
  assert.deepEqual(hits.map(({ index, x, y, kind }) => [index, x, y, kind]),
    [[0, 9, 12, 'prop'], [1, 9, 22, 'prop'], [2, 9, 32, 'prop']]);
  assert.match(describeStairConflict(hits[1]), /階段 2 \(10,20,幅2\).*\(9,22\).*小物 bench/);
});

test('ASCII の CI 検査は屋根に隠れた階段のマスと建物を示し exit 1、離せば exit 0', (t) => {
  const base = join(ROOT, 'compare');
  mkdirSync(base, { recursive: true });
  const temp = mkdtempSync(join(base, 'stair-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const b = { id: 'b12', archetype: 'house_m', variant: 'house_m-2', x: 19, y: 31, w: 6, h: 4,
    door: { x: 20, y: 34 }, module: { kind: 'house' } };
  const town = { repo: { name: 'stairs-overlap' }, cols: 50, rows: 45,
    ground: Array(45).fill('+'.repeat(50)), spawn: { x: 20, y: 25 },
    stairs: [{ x: 17, y: 28, w: 6 }], terraces: [{ x: 17, y: 22, w: 6, h: 6 }],
    buildings: [b], props: [], residents: [] };
  const file = join(temp, 'town.json');
  const check = () => {
    writeFileSync(file, JSON.stringify(town));
    const result = spawnSync(process.execPath, [join(ROOT, 'tools/ascii-town.mjs'), file, '--check'], {
      encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: base },
    });
    if (result.stderr) process.stderr.write(result.stderr);
    assert.ifError(result.error);
    return result;
  };
  const bad = check();
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /階段 1 \(17,28,幅6\).*\(20,29\).*建物 b12 \(house_m\) の cover/);
  b.x = 2; b.door.x = 3;
  const good = check();
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /check: OK（階段と前後2行/);
});

test('屋根が階段前を隠した配置候補を外して再配置し、役場の前庭2行も保つ', () => {
  const repo = sample('stairs-test', '0', 14, ['town_hall', 'inn', 'warehouse']);
  // main の同じ入力で b12 の cover が (20,29) を隠していた。実装のコピーは持たない。
  const bad = { stairs: [{ x: 17, y: 28, w: 6 }], buildings: [
    { id: 'b12', archetype: 'house_m', variant: 'house_m-2', x: 19, y: 31, w: 6, h: 4 },
  ] };
  assert.ok(conflicts(bad).some((c) => c.x === 20 && c.y === 29 && c.kind === 'cover'));
  const debug = {}, town = layoutTown(repo, { debug });
  assert.ok(debug.placementRetries > 0, '衝突を検出した候補だけを外す');
  assert.deepEqual(conflicts(town), []);
  assert.equal(JSON.stringify(layoutTown(repo)), JSON.stringify(town), '再試行も決定的');
  const hall = town.buildings.find((b) => b.archetype === 'town_hall');
  assert.equal(town.stairs[0].y - 2, hall.y + hall.h, '階段の後ろ2行は役場の前庭そのもの');
});
