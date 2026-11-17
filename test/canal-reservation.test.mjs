import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canalReservationProblem } from '../src/layout/canal/validate.mjs';

test('水セルが船着場を避けていても、橋の両岸が前庭を奪う候補を再探索する', () => {
  const S = {
    placed: [{ x: 8, y: 5, w: 6, yb: 8, spec: { facility: true, roofRows: 2 } }],
    bridgeProps: [{ type: 'bridge-h', x: 5, y: 11 }],
    deckBounds: () => ({ x0: 3, x1: 6, y0: 9, y1: 10 }),
    canalCells: [[4, 8], [5, 8], [4, 9], [5, 9], [4, 10], [5, 10], [4, 11], [5, 11]],
  };
  const problem = canalReservationProblem(S);
  assert.ok(problem, '橋から2マス先にある船着場の前庭を守る');
  assert.deepEqual(problem.cells, [[4, 9], [5, 9], [4, 10], [5, 10]],
    '問題の交差部だけを除外し、水路全体を捨てない');
  S.placed[0].spec.facility = false;
  assert.equal(canalReservationProblem(S), null, '通常の建物は予約帯の外へ再配置できる');
  S.placed[0].spec.facility = true;
  S.placed[0].x = 9;
  assert.equal(canalReservationProblem(S), null, '両岸と前庭を両立できる橋は残す');
});

test('南北の橋も固定施設の屋根の予約を奪わない', () => {
  const S = {
    placed: [{ x: 4, y: 14, w: 6, yb: 17, spec: { facility: true, roofRows: 2 } }],
    bridgeProps: [{ type: 'bridge-v', x: 5, y: 10 }],
    deckBounds: () => ({ x0: 4, x1: 5, y0: 7, y1: 10 }),
    canalCells: [[3, 8], [4, 8], [5, 8], [6, 8]],
  };
  assert.ok(canalReservationProblem(S), '両岸の2行先にある屋根も予約済み');
  S.placed[0].y++;
  assert.equal(canalReservationProblem(S), null);
});
