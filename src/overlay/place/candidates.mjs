import { KEEPER_BOX } from '../../../web/config.js';
// 距離順の候補と人の足元を共有し、門用の切断点は必要なときだけ調べる。
export function cutCandidates(world) {
  // Candidate filter only; reach.cutTile verifies each cut on the full pixel graph.
  const n = world.cols * world.rows, time = new Int32Array(n), low = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1), child = new Int32Array(n), cuts = new Set();
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let stamp = 0;
  for (let root = 0; root < n; root++) {
    if (world.nav[root] || time[root]) continue;
    time[root] = low[root] = ++stamp;
    const stack = [[root, 0]];
    while (stack.length) {
      const frame = stack[stack.length - 1], [v, d] = frame;
      if (d < 8) {
        frame[1]++;
        if (!(world.edges[v] & (1 << d))) continue;
        const u = v + dirs[d][0] + dirs[d][1] * world.cols;
        if (!time[u]) {
          parent[u] = v; child[v]++; time[u] = low[u] = ++stamp; stack.push([u, 0]);
        } else if (u !== parent[v]) low[v] = Math.min(low[v], time[u]);
      } else {
        stack.pop();
        const p = parent[v];
        if (p >= 0) {
          low[p] = Math.min(low[p], low[v]);
          if (parent[p] >= 0 && low[v] >= time[p]) cuts.add(p);
        } else if (child[v] > 1) cuts.add(v);
      }
    }
  }
  return [...cuts].map((k) => ({ x: k % world.cols + .5, y: Math.floor(k / world.cols) + 1 }));
}

export function prepareCandidates(S) {
  const { town, world, reach, cellOK, clearRects, accessible, addedRects } = S;
  const nearby = (target, radius = 6) => {
    const out = [];
    for (let y = Math.max(0, Math.floor(target.y) - radius); y <= Math.min(town.rows - 1, Math.floor(target.y) + radius); y++) {
      for (let x = Math.max(0, Math.floor(target.x) - radius); x <= Math.min(town.cols - 1, Math.floor(target.x) + radius); x++) {
        out.push({ x: x + .5, y: y + 1 });
      }
    }
    return out.sort((a, b) => (a.x - target.x) ** 2 + (a.y - target.y) ** 2 -
      (b.x - target.x) ** 2 - (b.y - target.y) ** 2 || a.y - b.y || a.x - b.x);
  };
  const personSpot = (target, extra = [], commit = true) => {
    for (const p of nearby(target)) {
      p.y -= 5 / 16; // same standing feet as the runtime navPoint
      if (!cellOK(Math.floor(p.x), Math.floor(p.y))) continue;
      const r = { x: p.x * 16 + KEEPER_BOX[0], y: p.y * 16 + KEEPER_BOX[1], w: KEEPER_BOX[2], h: KEEPER_BOX[3] };
      if (!clearRects([r]) || !reach.seen[Math.round(p.y * 16) * reach.W + Math.round(p.x * 16)]) continue;
      if (reach.attempt([r], (seen) => accessible(seen, [...extra, p]), commit)) {
        if (commit) addedRects.push(r);
        return p;
      }
    }
    return null;
  };
  const doorSpots = (b) => {
    const wb = world.buildings.find((w) => w.id === b.id), out = [];
    for (let dy = 0; dy <= 1; dy++) for (let offset = 0; offset <= 2; offset++) {
      out.push({ x: wb.doorX0 - 1.5 - offset, y: b.y + b.h + 1 + dy });
      out.push({ x: wb.doorX1 + 1.5 + offset, y: b.y + b.h + 1 + dy });
    }
    return out.filter((p) => p.x >= b.x - 2 && p.x <= b.x + b.w + 2);
  };
  Object.assign(S, { nearby, personSpot, doorSpots });
}
