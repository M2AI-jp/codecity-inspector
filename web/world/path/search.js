// A*の作業配列とヒープを一緒に扱い、比較と更新の順序を保つ。
import { DIR_AT } from '../navigation.js';

// tileの格子を8方向のA*で探す。角を横切らず、[[tx,ty],...]かnullを返す。
export function findPath(world, sx, sy, gx, gy, opts = {}) {
  if (!world.navFree(sx, sy)) { const s = world.nearestFree(sx, sy, 2); if (!s) return null; [sx, sy] = s; }
  if (!world.navFree(gx, gy)) return null;
  const cols = world.cols, n = cols * world.rows;
  const start = sy * cols + sx, goal = gy * cols + gx;
  if (start === goal) return [[gx, gy]];
  const gen = ++world.gen;
  const { g, f, from, stamp, closed, heap, nav, cost, edges } = world;
  const useCost = opts.useCost !== false;
  const avoid = opts.avoid; // 指定されていれば、このtile番号をふさがっているものとして扱う
  let hn = 0;
  const push = (k) => {
    let i = hn++; heap[i] = k;
    while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[k]) break; heap[i] = heap[p]; i = p; }
    heap[i] = k;
  };
  const pop = () => {
    const top = heap[0]; const last = heap[--hn];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= hn) break;
      if (c + 1 < hn && f[heap[c + 1]] < f[heap[c]]) c++;
      if (f[heap[c]] >= f[last]) break;
      heap[i] = heap[c]; i = c;
    }
    heap[i] = last;
    return top;
  };
  const h = (k) => { const x = k % cols, y = (k / cols) | 0; const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return (dx + dy + (1.4142 - 2) * Math.min(dx, dy)); };
  stamp[start] = gen; g[start] = 0; f[start] = h(start); from[start] = -1; push(start);
  let iter = 0;
  while (hn > 0 && iter++ < n * 4) {
    const cur = pop();
    if (cur === goal) break;
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    const cx = cur % cols, cy = (cur / cols) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= world.rows) continue;
      const nk = ny * cols + nx;
      if (nav[nk] || nk === avoid || closed[nk] === gen) continue;
      if (!(edges[cur] & (1 << DIR_AT[(dy + 1) * 3 + dx + 1]))) continue;
      const step = (dx && dy ? 1.4142 : 1) * (useCost ? cost[nk] : 1);
      const ng = g[cur] + step;
      if (stamp[nk] !== gen || ng < g[nk]) {
        stamp[nk] = gen; g[nk] = ng; f[nk] = ng + h(nk); from[nk] = cur;
        if (hn < heap.length) push(nk);
      }
    }
  }
  if (stamp[goal] !== gen) return null;
  const path = [];
  for (let k = goal; k !== -1 && path.length < n; k = from[k]) path.push([k % cols, (k / cols) | 0]);
  path.reverse();
  return path;
}
