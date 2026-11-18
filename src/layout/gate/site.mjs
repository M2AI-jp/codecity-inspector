import { DIRT, GRASS, OUT, PLAZA, STREET } from '../constants.mjs';

// 柱と絵の範囲を検査する。開口を歩けるまま残し、建物・屋根・予約を避ける。
export function prepareGateSite(S, C) {
  const { op, n, solids, ox, oy, iw, ctx } = S;
  const { inC, foot, roofZ, g, crop, id, blocked, reserved } = ctx;
  const { e, pathCol, r, out1, c0 } = C;
  const fx = c0 * 16 - op[0], fy = (r + 1) * 16;
  const opCols = new Set(Array.from({ length: n }, (_, i) => c0 + i));
  // 柱の tile（くぐれる所の列は除く）
  const pillar = [];
  for (const sb of solids) {
    const tx0 = Math.floor((fx + sb[0]) / 16), tx1 = Math.floor((fx + sb[0] + sb[2] - 1) / 16);
    const ty0 = Math.floor((fy + sb[1]) / 16), ty1 = Math.floor((fy + sb[1] + sb[3] - 1) / 16);
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) if (!opCols.has(x) && !pillar.some(([px, py]) => px === x && py === y)) pillar.push([x, y]);
  }
  if (!pillar.length) return false;
  const isPillar = (x, y) => pillar.some(([px, py]) => px === x && py === y);
  // 絵のかかる範囲（tile。左右の端の 6px は軒・灯の張り出しなので数えない）: 建物・屋根の陰にかからない
  const vx0 = Math.floor((fx - ox + 6) / 16), vx1 = Math.floor((fx - ox + iw - 7) / 16), vy0 = Math.floor((fy - oy) / 16);
  let ok = vx0 >= crop.x0 && vx1 <= crop.x1 && vy0 >= crop.y0;
  for (let y = vy0; y <= r + 1 && ok; y++) for (let x = vx0; x <= vx1; x++) if (inC(x, y) && (foot[id(x, y)] >= 0 || roofZ[id(x, y)])) { ok = false; break; }
  if (!ok) return false;
  // 門の外は建物・広場が無い所。密な街では出口の土道が石畳の
  // 端へつながることがあるので、石畳そのものは通過可能な外側
  // の道として許し、建物と広場だけを候補から除く。
  const yEnd = e.dir < 0 ? crop.y0 : crop.y1;
  // compact な街では隣家や別の縦道が絵の端に来る。門の絵の幅だけを
  // 外へ空ければよく、周囲の余白まで要求すると門候補を失う。
  for (let y = out1; ok && (y - yEnd) * e.dir <= 0; y += e.dir) for (let x = vx0; x <= vx1; x++) {
    if (!inC(x, y)) continue;
    const k2 = id(x, y);
    if (foot[k2] >= 0 || g[k2] === PLAZA) { ok = false; break; }
  }
  if (!ok) return false;
  // 柱は草地・街の外・土道の上。石畳の端にしか候補が残らない
  // 密な街では、石畳にも置ける（歩行到達性は下で再確認する）。
  for (const [x, y] of pillar) if (!inC(x, y) || foot[id(x, y)] >= 0 ||
    (g[id(x, y)] !== GRASS && g[id(x, y)] !== OUT && g[id(x, y)] !== STREET && !(g[id(x, y)] === DIRT && x === pathCol(e, y))) ||
    blocked[id(x, y)] || reserved[id(x, y)]) ok = false;
  if (!ok) return false;
  Object.assign(C, { fx, fy, pillar, isPillar, vx0, vx1, vy0 });
  return true;
}
