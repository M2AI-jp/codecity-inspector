import { FEET_W, FEET_H, FEET_UP } from '../../web/config.js';

// Integer feet positions and 4-neighbour edges, as in check-play's 1px flood.
// Rasterise once, then test added rectangles without rebuilding the town.
export function reachGrid(world, start) {
  const W = world.W, H = world.H, free = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) free[y * W + x] = world.feetHit(x, y) ? 0 : 1;
  const q = new Int32Array(W * H);
  const flood = (mask = free) => {
    const seen = new Uint8Array(mask.length);
    const s = start.y * W + start.x;
    if (!mask[s]) return { seen, count: 0 };
    let head = 0, tail = 1; q[0] = s; seen[s] = 1;
    const visit = (n) => { if (mask[n] && !seen[n]) { seen[n] = 1; q[tail++] = n; } };
    while (head < tail) {
      const k = q[head++], x = k % W;
      if (x) visit(k - 1);
      if (x + 1 < W) visit(k + 1);
      if (k >= W) visit(k - W);
      if (k + W < mask.length) visit(k + W);
    }
    return { seen, count: tail };
  };
  let current = flood();
  function attempt(rects, test = () => true, commit = true) {
    const removed = [];
    let reachableRemoved = 0;
    for (const r of rects) {
      // Strict box intersection, with exactly the runtime FEET_* constants.
      const x0 = Math.max(0, Math.floor(r.x - FEET_W / 2) + 1);
      const x1 = Math.min(W - 1, Math.ceil(r.x + r.w + FEET_W / 2) - 1);
      const y0 = Math.max(0, Math.floor(r.y + FEET_UP - FEET_H) + 1);
      const y1 = Math.min(H - 1, Math.ceil(r.y + r.h + FEET_UP) - 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const k = y * W + x;
        if (free[k]) { free[k] = 0; removed.push(k); reachableRemoved += current.seen[k]; }
      }
    }
    const next = flood();
    const ok = next.count > 0 && next.count === current.count - reachableRemoved && test(next.seen);
    if (ok && commit) current = next;
    else for (const k of removed) free[k] = 1;
    return ok;
  }
  const near = (seen, x, y, radius = 36) => {
    for (let yy = Math.max(0, Math.floor(y - radius)); yy <= Math.min(H - 1, Math.ceil(y + radius)); yy++) {
      for (let xx = Math.max(0, Math.floor(x - radius)); xx <= Math.min(W - 1, Math.ceil(x + radius)); xx++) {
        if (seen[yy * W + xx] && (xx - x) ** 2 + (yy - y) ** 2 < radius ** 2) return true;
      }
    }
    return false;
  };
  // A tile is a cut point only if deleting its feet positions actually disconnects
  // previously reachable positions elsewhere. No tile-graph approximation is accepted.
  const cutTile = (tx, ty) => {
    const removed = [];
    for (let y = ty * 16; y < (ty + 1) * 16; y++) for (let x = tx * 16; x < (tx + 1) * 16; x++) {
      const k = y * W + x;
      if (current.seen[k] && free[k]) { removed.push(k); free[k] = 0; }
    }
    const next = removed.length ? flood() : current;
    for (const k of removed) free[k] = 1;
    return next.count > 0 && current.count - removed.length > next.count;
  };
  return { W, H, free, get seen() { return current.seen; }, near, attempt, cutTile };
}
