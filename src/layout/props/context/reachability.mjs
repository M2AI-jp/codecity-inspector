import { GRASS, OUT } from '../../constants.mjs';
// 局所の接続判定と全体探索を共有し、小物を置く前後の到達数を保つ。
export function preparePropReachability(C) {
  const { S, N, cols, id, spawn, walk, crop, g, foot, blocked } = C;
  const flood = (extraBlocked) => {
    const seen = new Uint8Array(N);
    const q = [id(spawn.x, spawn.y)];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const t = q[h], x = t % cols, y = (t / cols) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!walk(nx, ny)) continue;
        const n = id(nx, ny);
        if (extraBlocked?.[n]) continue;
        if (!seen[n]) { seen[n] = 1; q.push(n); }
      }
    }
    return { seen, count: q.length };
  };
  {
    const { seen } = flood();   // 広場から届かない草地は街の外に
    for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
      const t = id(x, y);
      if (g[t] === GRASS && foot[t] < 0 && !blocked[t] && !seen[t]) g[t] = OUT;
    }
  }
  S.reach = flood().count;
  const RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const locallySafe = (x, y, extraBlocked) => {
    const w = RING.map(([dx, dy]) => walk(x + dx, y + dy) && !extraBlocked?.[id(x + dx, y + dy)]);
    if (w.every(Boolean)) return true;
    let runs = 0;
    for (let i = 0; i < 8; i++) {
      if (!w[i] || w[(i + 7) % 8]) continue;
      let touches = false;
      for (let j = i; j < i + 8 && w[j % 8]; j++) if (j % 2 === 1) touches = true;
      if (touches) runs++;
    }
    return runs <= 1;
  };
  Object.assign(C, { flood, locallySafe });
}
