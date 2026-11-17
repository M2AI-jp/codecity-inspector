import { propCells, deckTiles, facesOf } from '../town-grid.mjs';

// ASCII's conservative whole-tile walking surface is an additional placement
// constraint. Pixel reachability alone can leave a visually closed one-tile lane.
export function tileReach(town, propArt) {
  const { cols: W, rows: H } = town, free = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) free[y * W + x] = '.#:+'.includes(town.ground[y][x]) ? 1 : 0;
  for (const p of town.props) {
    const deck = deckTiles(p, propArt);
    for (const [x, y] of deck || propCells(p, propArt)) if (x >= 0 && y >= 0 && x < W && y < H) free[y * W + x] = deck ? 1 : 0;
  }
  for (const b of town.buildings) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) free[y * W + x] = 0;
  for (const [x, y] of facesOf(town)) if (x >= 0 && y >= 0 && x < W && y < H) free[y * W + x] = 0;
  const flood = () => {
    const seen = new Uint8Array(free.length), q = [];
    const s = town.spawn.y * W + town.spawn.x;
    if (free[s]) { seen[s] = 1; q.push(s); }
    const visit = (k) => { if (free[k] && !seen[k]) { seen[k] = 1; q.push(k); } };
    for (let i = 0; i < q.length; i++) {
      const k = q[i], x = k % W;
      if (x) visit(k - 1);
      if (x + 1 < W) visit(k + 1);
      if (k >= W) visit(k - W);
      if (k + W < free.length) visit(k + W);
    }
    return { seen, count: q.length };
  };
  let current = flood();
  return (cells, commit = false) => {
    const removed = [];
    let reachableRemoved = 0;
    for (const [x, y] of cells) {
      const k = y * W + x;
      if (free[k]) { free[k] = 0; removed.push(k); reachableRemoved += current.seen[k]; }
    }
    const next = flood(), ok = next.count > 0 && next.count === current.count - reachableRemoved;
    if (ok && commit) current = next;
    else for (const k of removed) free[k] = 1;
    return ok;
  };
}
