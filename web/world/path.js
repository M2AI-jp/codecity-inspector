// 道案内。近い空き場所、建物への入口、A*と道筋の短縮。
import { TILE, FEET_W, FEET_H, FEET_UP } from '../config.js';
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
  const points = tiles && world.smoothPath(x, y, tiles, target.x, target.y);
  let previous = { x, y };
  const clear = points && points.every((p) => {
    const free = world.sweepFree(previous.x, previous.y, p.x, p.y);
    previous = p;
    return free;
  });
  if (!clear) {
    // 1tileに1点の道案内では、角を曲がる細い通路を表せないことがある。
    // 扉内の目標へ格子の点を差し替えた最終区間も同じ当たりで確かめる。
    const points = feetPath(world, x, y, target.x, target.y);
    return points ? { target, points } : null;
  }
  return { target, points };
}

function feetPath(world, sx, sy, gx, gy) {
  const W = world.W, H = world.H;
  const startX = Math.round(sx), startY = Math.round(sy), goalX = Math.round(gx), goalY = Math.round(gy);
  const valid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !world.feetHit(x, y);
  if (!valid(startX, startY) || !valid(goalX, goalY) ||
    !world.sweepFree(sx, sy, startX, startY) || !world.sweepFree(goalX, goalY, gx, gy)) return null;
  const from = new Int32Array(W * H).fill(-2), queue = new Int32Array(W * H);
  const start = startY * W + startX, goal = goalY * W + goalX;
  let head = 0, tail = 1;
  queue[0] = start; from[start] = -1;
  while (head < tail && from[goal] === -2) {
    const k = queue[head++], x = k % W, y = Math.floor(k / W);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (from[n] !== -2) continue;
      from[n] = -3;
      if (world.feetHit(nx, ny)) continue;
      from[n] = k; queue[tail++] = n;
    }
  }
  if (from[goal] < -1) return null;
  const turns = [];
  let direction = null;
  for (let k = goal; k !== start; k = from[k]) {
    const d = k - from[k];
    if (d !== direction) turns.push({ x: k % W, y: Math.floor(k / W) });
    direction = d;
  }
  turns.reverse();
  turns.push({ x: gx, y: gy });
  const points = [];
  let x = sx, y = sy;
  for (let i = 0; i < turns.length;) {
    let j = turns.length - 1;
    while (j > i && !world.sweepFree(x, y, turns[j].x, turns[j].y)) j--;
    points.push(turns[j]); x = turns[j].x; y = turns[j].y; i = j + 1;
  }
  return points;
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
  const steps = Math.max(1, Math.ceil(len));
  let px = ax, py = ay;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t, y = ay + dy * t;
    // 点の間で小物の角を横切る経路も拒む。Player の1px以下の
    // 軸別移動を包む矩形なので、丸めで通れると誤認しない。
    if (world.boxHits(Math.min(px, x) - FEET_W / 2, Math.min(py, y) - FEET_UP,
      Math.max(px, x) + FEET_W / 2, Math.max(py, y) - FEET_UP + FEET_H)) return false;
    px = x; py = y;
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
