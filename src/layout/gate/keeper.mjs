import { OUT } from '../constants.mjs';
import { hash32 } from '../util.mjs';

// 門番の位置を確かめる。柱や門番が歩行領域を切断しないときだけ採用する。
export function findGateKeeper(S, C) {
  const { lm, ctx } = S;
  const { g, id, blocked, reserved, flood, walk } = ctx;
  const { e, r, c0, pillar, vx0, vx1, paint, before } = C;
  let keeper = null;
  if (flood().count === before - pillar.length) {
    // 門番: 街の内側（門の手前）の柱のわき。通り（門の幅の道）には立たない
    const inside = r - e.dir;
    const px = pillar.map(([x]) => x), pl = Math.min(...px), pr = Math.max(...px);
    const left = hash32(`gate:${lm.data.id}:${c0}`) % 2 === 0;
    const sides = left ? [[pl, -1], [pr, 1]] : [[pr, 1], [pl, -1]];
    const cands = e.dir < 0
      ? [...sides.map(([x]) => [x, inside]), ...sides.map(([x, s]) => [x + s, inside]), ...sides.map(([x, s]) => [x + s, r])]
      : [...sides.map(([, s]) => [s < 0 ? vx0 - 1 : vx1 + 1, inside]), ...sides.map(([, s]) => [s < 0 ? vx0 - 1 : vx1 + 1, r])];   // 南の門は絵の陰に入らない所
    const cnt = flood().count;
    for (const [kx, ky] of cands) {
      if (!walk(kx, ky) || reserved[id(kx, ky)] || g[id(kx, ky)] === OUT || paint.some(([x, y]) => x === kx && y === ky)) continue;
      blocked[id(kx, ky)] = 1;
      if (flood().count === cnt - 1) { keeper = { x: kx + 0.5, y: ky + 0.6875 }; break; }
      blocked[id(kx, ky)] = 0;
    }
  }
  return keeper;
}

// 外縁候補は、従来の固定順で四つの位置を試す。
export function findEdgeKeeper(S, C) {
  const { id, blocked, reserved, flood, walk } = S.ctx;
  const { c0, r, paint, before } = C;
  const { n } = S;
  let keeper = null;
  for (const [kx, ky] of [[c0 - 1, r + 1], [c0 + n, r + 1], [c0 - 1, r - 1], [c0 + n, r - 1]]) {
    if (!walk(kx, ky) || reserved[id(kx, ky)] || paint.some(([x, y]) => x === kx && y === ky)) continue;
    blocked[id(kx, ky)] = 1;
    if (flood().count === before - 1) { keeper = { x: kx + 0.5, y: ky + 0.6875 }; break; }
    blocked[id(kx, ky)] = 0;
  }
  return keeper;
}
