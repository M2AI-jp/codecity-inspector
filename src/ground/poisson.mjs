// 草株を撒く点の生成。呼び出し元の乱数状態をそのまま消費する。
// blue-noise（Bridson の Poisson-disc）
export function poisson(W, H, r, rnd) {
  const cs = r / Math.SQRT2, gw = Math.ceil(W / cs), gh = Math.ceil(H / cs), grid = new Int32Array(gw * gh).fill(-1);
  const px = [], py = [], active = [], r2 = r * r;
  const add = (x, y) => { const k = px.length; px.push(x); py.push(y); active.push(k); grid[((y / cs) | 0) * gw + ((x / cs) | 0)] = k; };
  add(rnd() * W, rnd() * H);
  while (active.length) {
    const ai = (rnd() * active.length) | 0, k = active[ai];
    let found = false;
    for (let t = 0; t < 14 && !found; t++) {
      const ang = rnd() * 2 * Math.PI, rad = r * (1 + rnd());
      const x = px[k] + Math.cos(ang) * rad, y = py[k] + Math.sin(ang) * rad;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const gx = (x / cs) | 0, gy = (y / cs) | 0;
      let ok = true;
      for (let j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2) && ok; j++) {
        for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
          const q = grid[j * gw + i];
          if (q >= 0) { const dx = px[q] - x, dy = py[q] - y; if (dx * dx + dy * dy < r2) { ok = false; break; } }
        }
      }
      if (ok) { add(x, y); found = true; }
    }
    if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  return { px, py };
}
