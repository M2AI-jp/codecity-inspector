import { DIRT, GRASS, OUT, STREET } from '../constants.mjs';

// 出口候補を順に渡す。各試行後の地面を次の出口へ引き継ぐため、先に列挙し切らない。
export function* exitCandidates(S) {
  const { exitDefs, n, oy, ctx } = S;
  const { inC, foot, g, crop, id } = ctx;
  for (const e of exitDefs) {
    // 街の外へ出る土の道を、通りの端から外へたどる。土道が草地・外で途切れていても、
    // 建物・水・舗装で遮られない列を外まで延ばし、門の手前の道にする（段々の道は行ごとにずれる）。
    const trail = new Map();
    for (let y = e.end + e.dir, col = e.col; y >= crop.y0 && y <= crop.y1; y += e.dir) {
      // 北南の出口の直後に家の footprint が寄っていても、最大6マス以内の
      // 空いた列へ道を曲げて門候補まで届ける。
      const dxs = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6];
      const dx = dxs.find((d) => {
        if (!inC(col + d, y) || foot[id(col + d, y)] >= 0) return false;
        const tile = g[id(col + d, y)];
        return tile === STREET || tile === DIRT || tile === GRASS || tile === OUT;
      });
      if (dx === undefined) break;
      col += dx;
      trail.set(y, col);
    }
    const pathCol = (e2, y) => trail.get(y) ?? -1;
    for (const k of [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
      const r = e.end + e.dir * k;                    // 門の行（柱の足元の行）
      const out1 = r + e.dir;                         // 門の外の1行
      if (out1 < crop.y0 + 1 || out1 > crop.y1 - 1 || r - Math.ceil(oy / 16) < crop.y0) continue;
      const pcol = pathCol(e, r);
      if (pcol < 0) continue;
      // 道の列を門の幅で包む所を先に。だめなら門を道の脇へ少しずらし、門の前後で道をつなぎ直す
      const c = pcol - Math.floor((n - 1) / 2);
      const starts = [c, c + 1, c - 1, c - 2, c + 2, c - 3, c + 3];
      for (const c0 of starts) {
        yield { e, trail, pathCol, r, out1, c0 };
      }
    }
  }
}
