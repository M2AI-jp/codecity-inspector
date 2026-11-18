import { DIRT, GRASS, clamp } from '../constants.mjs';
import { hash32 } from '../util.mjs';

// 空いた街区にも下の通りから入れる小道を通す。
export function paintBlockPaths(S) {
  const { P, g, kept } = S;
  const { id, inG, road, placed, foot } = P;
  // 使わなかった街区（木立ち・緑地）を抜ける、曲がった土の小道。下の通りから上の通りへ（上が無ければ途中まで）
  for (const L of P.leaves) {
    if (L.flank) continue;
    const w = L.x1 - L.x0 + 1, h = L.y1 - L.y0 + 1;
    if (w < 7 || h < 5 || placed.some((p) => p.x <= L.x1 && p.x + p.w - 1 >= L.x0 && p.y <= L.y1 && p.yb >= L.y0)) continue;
    const hs = hash32(`path:${L.x0},${L.y0}`);
    let x = -1, from = -1;
    // 入口: 下の通りに出る列。通りの向こう側に同じ列で路地が続く所は避ける
    for (let t2 = 0; t2 < w - 4 && x < 0; t2++) {
      const c = L.x0 + 2 + ((hs + t2 * 5) % Math.max(1, w - 4));
      let f = -1;
      for (let y = L.y1 + 1; y <= L.y1 + 3; y++) if (inG(c, y) && kept[id(c, y)]) { f = y; break; }
      if (f < 0) continue;
      let y = f; while (inG(c, y) && kept[id(c, y)]) y++;
      if (inG(c, y) && road[id(c, y)] >= 0) continue;
      x = c; from = f;
    }
    if (from < 0) continue;
    const through = inG(x, L.y0 - 1) && kept[id(x, L.y0 - 1)] || (hs >> 8) % 3 > 0;
    const stop = through ? L.y0 : L.y0 + Math.floor(h / 2);
    let next = 2 + ((hs >> 4) % 2);
    for (let y = from - 1, k = 0; y >= stop; y--, k++) {
      if (foot[id(x, y)] >= 0 || g[id(x, y)] !== GRASS) break;
      g[id(x, y)] = DIRT;
      if (k >= next) {
        let nx = clamp(x + (hash32(`w:${x},${y}`) % 2 ? 1 : -1), L.x0 + 1, L.x1 - 1);
        if (nx === x) nx = clamp(x + (x <= L.x0 + 1 ? 1 : -1), L.x0 + 1, L.x1 - 1);     // 端なら内側へ
        if (nx !== x && g[id(nx, y)] === GRASS && foot[id(nx, y)] < 0) { g[id(nx, y)] = DIRT; x = nx; }
        next = k + 2 + (hash32(`n:${x},${y}`) % 3);
      }
    }
    // 上の通りの手前で止まったら、そこまでつなぐ（つながる通りがあるときだけ）
    if (through && inG(x, L.y0 - 1) && g[id(x, L.y0)] === DIRT && !kept[id(x, L.y0 - 1)]) {
      for (const dx of [1, -1, 2, -2]) if (inG(x + dx, L.y0 - 1) && kept[id(x + dx, L.y0 - 1)]) {
        for (let xx = Math.min(x, x + dx); xx <= Math.max(x, x + dx); xx++) if (g[id(xx, L.y0)] === GRASS && foot[id(xx, L.y0)] < 0) g[id(xx, L.y0)] = DIRT;
        break;
      }
    }
  }
}
