// tileで表せない細道のため、1px単位の探索と曲がり角の短縮をまとめる。
export function feetPath(world, sx, sy, gx, gy) {
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
