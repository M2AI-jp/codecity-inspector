// kmeans: Keep seeded draws and weighted accumulation together so palette selection stays deterministic.
import { d2 } from './colour.mjs';
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Weighted k-means in Oklab. pts: array of [L,a,b]; w: weights; fixed: centroids that never move.
export function kmeans(pts, w, k, { fixed = [], iters = 24, seed = 7 } = {}) {
  const n = pts.length;
  k = Math.min(k, n + fixed.length);
  const C = fixed.map((c) => [...c]);
  const rand = rng(seed);
  const dist = new Float64Array(n).fill(Infinity);
  const upd = (c) => { for (let i = 0; i < n; i++) dist[i] = Math.min(dist[i], d2(pts[i], c)); };
  C.forEach(upd);
  if (!C.length) { let tot = 0; for (let i = 0; i < n; i++) tot += w[i]; let t = rand() * tot, i = 0; for (; i < n - 1 && (t -= w[i]) > 0; i++); C.push([...pts[i]]); upd(C[0]); }
  while (C.length < k) { // k-means++
    let tot = 0; for (let i = 0; i < n; i++) tot += w[i] * dist[i];
    if (tot <= 0) break;
    let t = rand() * tot, i = 0; for (; i < n - 1 && (t -= w[i] * dist[i]) > 0; i++);
    C.push([...pts[i]]); upd(C[C.length - 1]);
  }
  const asg = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < C.length; j++) { const dd = d2(pts[i], C[j]); if (dd < bd) { bd = dd; best = j; } }
      if (asg[i] !== best) moved++;
      asg[i] = best;
      const a = acc[best]; a[0] += pts[i][0] * w[i]; a[1] += pts[i][1] * w[i]; a[2] += pts[i][2] * w[i]; a[3] += w[i];
    }
    for (let j = fixed.length; j < C.length; j++) if (acc[j][3] > 0) C[j] = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]];
    if (it > 0 && moved === 0) break;
  }
  return { centroids: C, assign: asg };
}
export const nearest = (C, p) => { let best = 0, bd = Infinity; for (let j = 0; j < C.length; j++) { const dd = d2(p, C[j]); if (dd < bd) { bd = dd; best = j; } } return best; };
