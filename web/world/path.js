// 道案内。近い空き場所、建物への入口、A*と道筋の短縮。
import { TILE } from '../config.js';
import { DIR_AT } from './navigation.js';

const T = TILE;

// 足元(x, y)から建物bの扉の内側への道筋。届かなければnull。
// 内側のtileが道案内の格子につながらないときは、扉の隙間まで進み、そこからまっすぐ入る。
export function pathInto(world, b, x, y, opts = { useCost: false }) {
  const target = b.doorInside || b.doorOutside;
  const sx = Math.floor(x / T), sy = Math.floor((y - 3) / T);
  let tiles = world.findPath(sx, sy, Math.floor(target.x / T), Math.floor((target.y - 3) / T), opts);
  if (!tiles && b.doorInside) {
    let best = null;
    for (let c = b.doorX0; c < b.doorX1; c++) {
      const t = world.findPath(sx, sy, c, b.doorY, opts);
      if (t && (!best || t.length < best.length)) best = t;
    }
    if (best) tiles = [...best, [Math.floor(target.x / T), Math.floor((target.y - 3) / T)]];
  }
  if (!tiles) return null;
  return { target, points: world.smoothPath(x, y, tiles, target.x, target.y) };
}

export function nearestFree(world, tx, ty, maxR = 12) {
  if (world.navFree(tx, ty)) return [tx, ty];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (world.navFree(tx + dx, ty + dy)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [tx + dx, ty + dy]; } }
    }
    if (best) return best;
  }
  return null;
}

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

// 足元の矩形がaからbへ直進できるか、途中を刻んで確かめる。
export function sweepFree(world, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 3));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (world.feetHit(ax + dx * t, ay + dy * t)) return false;
  }
  return true;
}

// tileの経路をpxの通過点に変換し、直進できる区間をまとめて格子に沿った動きを減らす。
export function smoothPath(world, fromX, fromY, tiles, endX, endY) {
  const pts = tiles.map(([tx, ty]) => world.navPoint(tx, ty));
  if (endX !== undefined && pts.length) pts[pts.length - 1] = { x: endX, y: endY };
  const out = [];
  let cx = fromX, cy = fromY, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !world.sweepFree(cx, cy, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    cx = pts[j].x; cy = pts[j].y; i = j + 1;
  }
  return out;
}
