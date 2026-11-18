import { DIRT } from '../constants.mjs';

// 道の塗り替えを準備する。門の前後をつなぎ、門の脇を抜ける元の道だけを戻す。
export function prepareGatePath(S, C) {
  const { n, paveable, ctx } = S;
  const { inC, foot, g, crop, id, blocked } = ctx;
  const { e, pathCol, r, c0, isPillar, vy0 } = C;
  let ok = true;
  // 塗る所（門の絵は南を向くので、北側の道は屋根の上に出る所で元の道につなぐ）:
  //   門の行と、その北の2行・南の行（北の門なら手前の2行、南の門なら外の1行）は門の幅。
  //   北へは屋根の陰の間（絵のかかる行）をまん中の1列でのばし、屋根の上の1行で元の道へ横につなぐ。
  //   南の端の行でも元の道へ横につなぐ。通りの端に届くときは、通りの列へつなぐ
  const rowCol = (y) => (y === e.end ? (Math.abs(e.x - (c0 + 1)) <= Math.abs(e.x + 1 - (c0 + 1)) ? e.x : e.x + 1) : pathCol(e, y));
  const north = e.dir < 0 ? crop.y0 + 1 : e.end + 1, south = e.dir < 0 ? e.end - 1 : crop.y1 - 1;
  const B = Math.max(vy0 - 1, north);                         // 北のつなぎの行
  const Fr = Math.min(e.dir < 0 ? r + 2 : r + 1, south);      // 南のつなぎの行
  if (B > r - 1 || Fr < r) return false;
  const mid = c0 + Math.floor(n / 2);
  const paint = [];
  for (let y = B; y <= Fr; y++) {
    if (y >= r - 2) for (let x = c0; x < c0 + n; x++) paint.push([x, y]);
    else paint.push([mid, y]);
  }
  const link = (y, to, from0, from1) => {
    if (to < 0 || (to >= from0 && to <= from1)) return;
    const [p, q] = to < from0 ? [to, from0 - 1] : [from1 + 1, to];
    for (let x = p; x <= q; x++) paint.push([x, y]);
  };
  if (B < r - 2) link(B, rowCol(B - 1), mid, mid); else link(B, rowCol(B - 1), c0, c0 + n - 1);
  link(Fr, rowCol(Fr + 1), c0, c0 + n - 1);
  for (const [x, y] of paint) if (!paveable(x, y) || blocked[id(x, y)] || isPillar(x, y)) ok = false;
  if (!ok) return false;
  // 元の道で門の幅の外に残る所（門のわきを抜ける土）は草に戻す（つなぎの行はそのまま）
  const erase = [];
  const painted = (x, y) => paint.some(([px, py]) => px === x && py === y);
  for (let y = B + 1; y < Fr; y++) {
    const x0 = pathCol(e, y);
    if (x0 < 0) continue;
    // その行の道のひと続き（段々の道の横のつなぎも）
    for (const d of [-1, 1]) for (let x = d < 0 ? x0 : x0 + 1; Math.abs(x - x0) <= 3 && inC(x, y) && g[id(x, y)] === DIRT && foot[id(x, y)] < 0; x += d) {
      if (!painted(x, y)) erase.push([x, y]);
    }
  }
  Object.assign(C, { paint, erase });
  return true;
}
