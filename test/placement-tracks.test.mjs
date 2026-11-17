import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeBuildings } from '../src/layout/grid/buildings.mjs';

test('面の切替は全候補の近さを比べ、岸と広場北辺の家並みは先に確保する', () => {
  for (const priority of [undefined, 'dense', 'harbour', 'plaza']) {
    const track = (r) => ({ r, x0: 0, x1: 9, cursor: 0, dir: 1, items: [],
      sd: new Int16Array(10).fill(20) });
    const far = track(100), near = track(1);
    if (priority) far[priority] = true;
    const spec = { w: 4, h: 3, module: { kind: 'house' } };
    const S = {
      tracks: [far, near], denseTracks: priority ? [far] : [], placed: [],
      queues: [{ g: { a0: 0, a1: 2 * Math.PI, index: 0, key: 'district' }, items: [spec], ruins: [] }],
      pending: { early: [], late: [], inn: null }, fac: {},
      nominal: (t) => ({ r: t.r, theta: 0 }), trackAffinity: () => 0, rng: () => 0,
      fit: (t, x, s) => ({ x, y: 17, yb: 19, w: s.w, h: s.h }),
      advance: (t) => { t.closed = true; },
      commit: (s, t, pos) => { S.placed.push({ spec: s, track: t, ...pos }); },
    };
    assert.equal(placeBuildings(S), true);
    assert.equal(S.placed[0].track, ['harbour', 'plaza'].includes(priority) ? far : near, priority);
  }
});
