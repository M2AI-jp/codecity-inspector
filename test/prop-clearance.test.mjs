import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPropsContext } from '../src/layout/props/context.mjs';
import { GRASS, OUT } from '../src/layout/constants.mjs';
import { checkSeed } from '../tools/seed-fuzz.mjs';

test('小物のsolidと壁寄せ後の位置も、隣の予約と細い通路を守る', () => {
  const context = (corridor = false) => {
    const cols = 7, rows = 7, N = cols * rows, id = (x, y) => y * cols + x;
    const g = new Uint8Array(N).fill(corridor ? OUT : GRASS);
    if (corridor) {
      for (let y = 0; y < rows; y++) g[id(3, y)] = GRASS;
      g[id(2, 3)] = GRASS;
    }
    return createPropsContext({
      cols, N, id, foot: new Int32Array(N).fill(-1), front: new Uint8Array(N),
      roofZ: new Uint8Array(N), plazaM: new Uint8Array(N), placed: [], terraces: [],
    }, { g, crop: { x0: 0, y0: 0, x1: 6, y1: 6 } }, () => 0.5, { x: 3, y: 1 }, {
      propArt: { bush: { solid: [-9, -4, 18, 4] }, scaffold: { solid: [-6, -4, 12, 4] } },
    });
  };
  const narrow = context(true);
  assert.equal(narrow.tryProp('bush', 2, 3), false, '隣の唯一の通路まで当たりがはみ出す');
  const wide = context();
  wide.reserved[wide.id(5, 5)] = 1;
  assert.equal(wide.tryProp('bush', 4, 5), false);
  assert.equal(wide.tryProp('scaffold', 4, 5, false, 'scaffold', [1, 1], 5 / 16), false);
  assert.equal(wide.tryProp('scaffold', 4, 5, false, 'scaffold', [1, 1]), true);
});

test('工事中の足場と植え込みが通路を切った2種でも全戸へ歩ける', () => {
  const modules = [
    ['.', 'house', 4, 192, 1], ['config', 'workshop', 14, 1567, 6],
    ['docs', 'house', 10, 867, 1], ['gas1', 'house', 11, 850],
    ['gas2-ledger', 'house', 12, 1714], ['luna', 'house', 17, 3019],
    ['skills', 'house', 2, 54], ['tools', 'workshop', 3, 657],
  ].map(([path, kind, files, lines, dirty]) => ({
    path, kind, files, lines, bytes: 0, ...(dirty ? { works: { dirty } } : {}),
  }));
  const facilities = ['repair', 'town_hall', 'warehouse'].map((archetype) => ({
    archetype, merged: [], evidence: [], evidenceCount: 1, facts: {},
  }));
  const manifest = JSON.parse(readFileSync(new URL('../art/game/manifest.json', import.meta.url)));
  for (const head of ['000001d', '000004a']) {
    const result = checkSeed({ name: 'meet-transcript-production', head, modules, facilities,
      readme: { title: 'fixture' } }, manifest);
    assert.deepEqual(result.problems, [], head);
    assert.equal(result.town.buildings.length, 11);
  }
});
