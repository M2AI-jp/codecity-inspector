import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { doorClearance, doorClearanceConflicts } from '../src/door-clearance.mjs';
import { layoutTown, loadArt } from '../src/layout.mjs';

const manifest = JSON.parse(readFileSync(new URL('../art/game/manifest.json', import.meta.url)));
const b = { id: 'door', archetype: 'room', variant: 'wide', x: 8, y: 5, w: 6, h: 5, door: { x: 10, y: 9 } };
const art = { room: { variants: [
  { id: 'narrow', door: { x: 2, w: 1 }, cover: [0, 0, 0, 0, 0, 0] },
  { id: 'wide', door: { x: 2, w: 3 }, cover: [0, 0, 0, 0, 0, 0] },
] }, flat: { variants: [{ id: 'flat', cover: [0] }] } };

test('扉前2行・選択版の扉幅＋左右1マスを確保し、外側と自分を含めない', () => {
  assert.deepEqual(doorClearance(b, art), { x0: 9, x1: 13, y0: 10, y1: 11 });
  for (let x = 8; x <= 14; x++) for (let y = 9; y <= 12; y++) {
    const other = { id: 'other', archetype: 'flat', x, y, w: 1, h: 1, door: { x, y } };
    const hits = doorClearanceConflicts({ buildings: [b, other] }, art).filter((h) => h.door === b);
    assert.equal(hits.length, x >= 9 && x <= 13 && y >= 10 && y <= 11 ? 1 : 0, `${x},${y}`);
  }
  assert.deepEqual(doorClearanceConflicts({ buildings: [b] }, art), []);
  const normalized = loadArt({ archetypes: { room: { footprint: [6, 5], ...art.room } } });
  assert.deepEqual(doorClearance(b, normalized), doorClearance(b, art));
});

test('列別の屋根coverを選択版で調べ、0行と既定2行を区別する', () => {
  const roof = { id: 'roof', archetype: 'roof', variant: 'tall', x: 9, y: 13, w: 3, h: 3, door: { x: 10, y: 15 } };
  const defs = { ...art, roof: { variants: [
    { id: 'flat', cover: [0, 0, 0] }, { id: 'tall', cover: [3, 0, 2] }, { id: 'unknown' },
  ] } };
  const hits = () => doorClearanceConflicts({ buildings: [b, roof] }, defs)
    .filter((h) => h.door === b).map(({ x, y, kind }) => [x, y, kind]);
  assert.deepEqual(hits(), [[9, 10, 'cover'], [9, 11, 'cover'], [11, 11, 'cover']]);
  roof.variant = 'flat';
  assert.deepEqual(hits(), []);
  roof.variant = 'unknown';
  assert.deepEqual(hits(), [[9, 11, 'cover'], [10, 11, 'cover'], [11, 11, 'cover']]);
});

test('ASCII CLIは戸口前を覆う建物を示してexit 1、離せばexit 0', (t) => {
  const root = new URL('../', import.meta.url).pathname, base = join(root, 'compare');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'door-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = { id: 'pub', archetype: 'pub', variant: 'pub-1', x: 8, y: 8, w: 7, h: 5,
    door: { x: 11, y: 12 }, module: { kind: 'pub' } };
  const second = { id: 'shop', archetype: 'shop', variant: 'shop-1', x: 8, y: 14, w: 6, h: 4,
    door: { x: 10, y: 17 }, module: { kind: 'shop' } };
  const town = { repo: { name: 'door-overlap' }, cols: 35, rows: 30, ground: Array(30).fill('+'.repeat(35)), spawn: { x: 20, y: 20 },
    buildings: [first, second], props: [], residents: [] };
  const file = join(dir, 'town.json');
  const check = () => {
    writeFileSync(file, JSON.stringify(town));
    return spawnSync(process.execPath, [join(root, 'tools/ascii-town.mjs'), file, '--check'],
      { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: base } });
  };
  const bad = check();
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /pub の戸口前.*shop.*cover/);
  second.x = 24; second.door.x = 26;
  const good = check();
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /check: OK.*戸口前2行/);
});

test('施設と一般住宅の全戸口を確保し、再配置も決定的', () => {
  const repo = { name: 'door-town', head: '0000013',
    modules: Array.from({ length: 16 }, (_, i) => ({ path: `src/part${i}`, kind: 'house', files: 3, lines: 100 + i * 20 })),
    facilities: ['town_hall', 'pub', 'inn'].map((archetype) => ({ archetype, merged: [], evidence: [], evidenceCount: 1, facts: {} })),
  };
  const town = layoutTown(repo);
  assert.deepEqual(doorClearanceConflicts(town, manifest.archetypes), []);
  assert.deepEqual(layoutTown(repo), town);
  assert.equal(town.buildings.length, 19);
});
