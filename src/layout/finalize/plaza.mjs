import { GRASS, PLAZA } from '../constants.mjs';
import { makeRng } from '../util.mjs';

// 通りを残した後に広場を塗り、戸口を避けて角に植え込みを作る。
export function paintPlaza(S) {
  const { P, g, setG } = S;
  const { N, id, inG, plazaM, plaza, foot } = P;
  for (let k = 0; k < N; k++) if (plazaM[k]) g[k] = PLAZA;
  // 広場の角の植え込み（大きさは角ごとに違う）
  const crng = makeRng(P.cx * 7919 + plaza.y0);
  plaza.cuts = [];
  const corners = [[plaza.x0, plaza.y0, 1, 1], [plaza.x1, plaza.y0, -1, 1], [plaza.x0, plaza.y1, 1, -1], [plaza.x1, plaza.y1, -1, -1]];
  corners.forEach(([x, y, dx, dy], i) => {
    const r = crng();
    const shape = i >= 2 ? (r < 0.5 ? [[0, 0]] : r < 0.8 ? [[0, 0], [dx, 0]] : []) : r < 0.35 ? [[0, 0], [dx, 0], [0, dy]] : r < 0.7 ? [[0, 0], [dx, 0], [0, dy], [dx, dy]] : [[0, 0], [dx, 0], [2 * dx, 0], [0, dy]];
    // 広場に面する建物の扉の前の行には植え込みを作らない
    for (const [ox, oy] of shape) if (!(inG(x + ox, y + oy - 1) && foot[id(x + ox, y + oy - 1)] >= 0)) plaza.cuts.push([x + ox, y + oy, shape.length]);
  });
  for (const [x, y] of plaza.cuts) { setG(x, y, GRASS); plazaM[id(x, y)] = 0; }
}
