import { DIRT, GRASS, STREET, WATER } from '../constants.mjs';
import { findEdgeKeeper } from './keeper.mjs';
import { writeEdgeGate } from './write.mjs';

// 最後に外縁を試す。出口候補を使い切った後だけ、従来の塗り替えと復元を行う。
export function placeEdgeGate(S) {
  const { n, op, solids, ctx } = S;
  const { inC, foot, g, crop, id, blocked, reserved, flood } = ctx;
  // 密な格子では、出口の通りの周囲を建物の前庭が埋めて通常候補が
  // 全滅することがある。空いた草地の端に土道を通してから同じ門の
  // 開口・柱・番人の到達性を検査する最後の候補を持つ。
  const edgeRows = [];
  for (let r = crop.y0 + 2; r <= crop.y1 - 2; r++) edgeRows.push(r);
  edgeRows.sort((u, v) => Math.min(u - crop.y0, crop.y1 - u) - Math.min(v - crop.y0, crop.y1 - v) || u - v);
  for (const r of edgeRows) for (let c0 = crop.x0 + 2; c0 <= crop.x1 - n - 3; c0++) {
    const fx = c0 * 16 - op[0], fy = (r + 1) * 16;
    const opCols = new Set(Array.from({ length: n }, (_, i) => c0 + i));
    const pillar = [];
    for (const sb of solids) {
      const tx0 = Math.floor((fx + sb[0]) / 16), tx1 = Math.floor((fx + sb[0] + sb[2] - 1) / 16);
      const ty0 = Math.floor((fy + sb[1]) / 16), ty1 = Math.floor((fy + sb[1] + sb[3] - 1) / 16);
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++)
        if (!opCols.has(x) && !pillar.some(([px, py]) => px === x && py === y)) pillar.push([x, y]);
    }
    const paint = [];
    for (let y = r - 1; y <= r + 1; y++) for (let x = c0; x < c0 + n; x++) paint.push([x, y]);
    if (!pillar.length || pillar.some(([x, y]) => !inC(x, y) || foot[id(x, y)] >= 0 || blocked[id(x, y)] || reserved[id(x, y)] ||
      ![GRASS, STREET, DIRT].includes(g[id(x, y)])) || paint.some(([x, y]) => !inC(x, y) || foot[id(x, y)] >= 0 || g[id(x, y)] === WATER)) continue;
    const saved = paint.map(([x, y]) => g[id(x, y)]);
    paint.forEach(([x, y]) => { if (g[id(x, y)] === GRASS) g[id(x, y)] = DIRT; });
    pillar.forEach(([x, y]) => { g[id(x, y)] = GRASS; blocked[id(x, y)] = 1; });
    const before = flood().count;
    const C = { c0, r, fx, fy, paint, before };
    const keeper = findEdgeKeeper(S, C);
    if (!keeper) {
      for (const [x, y] of pillar) blocked[id(x, y)] = 0;
      for (const [[x, y], old] of paint.map((p, i) => [p, saved[i]])) g[id(x, y)] = old;
      continue;
    }
    return writeEdgeGate(S, C, keeper);
  }
  return null;
}
