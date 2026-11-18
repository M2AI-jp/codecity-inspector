// Reachable feet positions use the same collision boxes as the browser player.
import { FEET_W, FEET_H, FEET_UP } from '../../web/config.js';

// 1px flood fill of feet positions (4-neighbour, the player's sub-steps are <= 1 px per axis)
export function flood(world, start) {
  const W = world.W, H = world.H;
  const seen = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  const s = start.y * W + start.x;
  if (world.feetHit(start.x, start.y)) return { seen, count: 0 };
  seen[s] = 1; q[qt++] = s;
  while (qh < qt) {
    const k = q[qh++];
    const x = k % W, y = (k / W) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = d === 0 ? x + 1 : d === 1 ? x - 1 : x;
      const ny = d === 2 ? y + 1 : d === 3 ? y - 1 : y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (seen[n]) continue;
      seen[n] = 2;                                   // tested
      if (world.feetHit(nx, ny)) continue;
      seen[n] = 1; q[qt++] = n;
    }
  }
  return { seen, count: qt };
}

// is a reachable feet position within r px of (x, y)?
export function nearSeen(world, seen, x, y, r) {
  const W = world.W;
  for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(world.H - 1, Math.ceil(y + r)); yy++) {
    for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(W - 1, Math.ceil(x + r)); xx++) {
      if (seen[yy * W + xx] === 1 && Math.hypot(xx - x, yy - y) < r) return true;
    }
  }
  return false;
}
// does a reachable feet box stand fully on deck rect d?
export function onDeckSeen(world, seen, d) {
  const W = world.W, hw = FEET_W / 2;
  for (let y = Math.ceil(d.y + FEET_UP); y <= Math.floor(d.y + d.h - FEET_H + FEET_UP); y++) {
    for (let x = Math.ceil(d.x + hw); x <= Math.floor(d.x + d.w - hw); x++) if (seen[y * W + x] === 1) return true;
  }
  return false;
}
