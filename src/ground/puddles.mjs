// 水たまりの位置。草株より先に共有 rng を消費する順番を保つ。
import { T, TS, TD, COBBLE, DIRT, F_FOOT } from './constants.mjs';
import { vnoise } from './noise.mjs';

export function preparePuddles(S) {
  const { N, cols, rows, tc, footT, footAt, runAlong, rng, W, H, rut, cls, flg, SEED } = S;
  // ---- 水たまり（通りの轍・路地にいくつか）
  const pud = new Uint8Array(N);       // 1 濡れた縁, 2 水, 3 水面のかすかな光
  {
    const cand = [];
    let paved = 0;
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const ti = ty * cols + tx;
      if (footT[ti] >= 0 || footAt(tx, ty - 1)) continue;
      if (tc[ti] === TS) { paved++; cand.push([tx, ty, runAlong[ti] >= 10 ? 2 : 1]); }
      else if (tc[ti] === TD) { paved++; cand.push([tx, ty, 1]); }
    }
    const want = Math.max(2, Math.min(16, Math.round(paved / 110)));
    const got = [];
    for (let tries = 0; tries < 4000 && got.length < want && cand.length; tries++) {
      const [tx, ty, wgt] = cand[(rng() * cand.length) | 0];
      if (wgt < 2 && rng() < 0.5) continue;
      if (got.some(([a, b]) => Math.hypot(a - tx, b - ty) < 9)) continue;
      // 轍の上を探す
      let px = tx * T + 2 + rng() * 12, py = ty * T + 2 + rng() * 12;
      for (let k = 0; k < 24; k++) {
        const qx = tx * T + 2 + ((rng() * 12) | 0), qy = ty * T + 2 + ((rng() * 12) | 0);
        if (rut[qy * W + qx] > 120) { px = qx; py = qy; break; }
      }
      const pc = cls[(py | 0) * W + (px | 0)];
      if (pc !== COBBLE && pc !== DIRT) continue;
      got.push([tx, ty]);
      const rx = 4 + rng() * 4.5, ry = 2.2 + rng() * 2, ps = SEED + 300 + got.length;
      const inside = (x, y) => { const dx = (x + 0.5 - px) / rx, dy = (y + 0.5 - py) / ry; return dx * dx + dy * dy + 0.55 * (vnoise(x / 2.5, y / 2.5, ps) - 0.5) < 1; };
      for (let y = Math.floor(py - ry - 3); y <= py + ry + 3; y++) for (let x = Math.floor(px - rx - 3); x <= px + rx + 3; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const i = y * W + x, c = cls[i];
        if ((c !== COBBLE && c !== DIRT) || flg[i] & F_FOOT) continue;
        if (inside(x, y)) pud[i] = !inside(x + 1, y + 1) || !inside(x, y + 1) ? 3 : y === Math.floor(py - ry * 0.35) && Math.abs(x + 0.5 - px + rx * 0.2) < rx * 0.35 ? 4 : 2;
        else if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1) || inside(x - 1, y - 1) || inside(x + 1, y + 1)) pud[i] = 1;
      }
    }
  }

  Object.assign(S, { pud });
}
