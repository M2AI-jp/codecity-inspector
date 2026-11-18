// 草の株と葉の影。水たまりが使った後の同じ rng を受け取る。
import { GRASS, F_FOOT, F_OUT } from './constants.mjs';
import { hash2 } from './noise.mjs';
import { samp } from './fields.mjs';
import { poisson } from './poisson.mjs';

export function scatterGrass(S) {
  const { X, W, H, rng, N, cls, flg, LUSH, MOSSY, SEED, dGrass, GRIME, out } = S;
  // ---- 4. 草の株を blue-noise で撒く（ばらばらの株・向き・明るさ）
  {
    const sprites = X.sprites, bigs = sprites.filter((s) => s.big), smalls = sprites.filter((s) => !s.big);
    const pts = poisson(W, H, 9, rng);
    const order = pts.px.map((_, k) => k).sort((a, b) => pts.py[a] - pts.py[b]);
    const over = new Uint8Array(N);
    for (const k of order) {
      const ax = pts.px[k] | 0, ay = pts.py[k] | 0, ai = ay * W + ax;
      if (cls[ai] !== GRASS || flg[ai] & F_FOOT) continue;
      const out_ = flg[ai] & F_OUT;
      const lush = samp(LUSH, ax, ay), mossy = samp(MOSSY, ax, ay);
      let pBig = (out_ ? 0.17 : 0.1) * (0.5 + lush), pSmall = (out_ ? 0.3 : 0.2) * (0.6 + lush * 0.8);
      if (mossy > 0.6) { pBig *= 0.45; pSmall *= 0.6; }
      const u = hash2(ax, ay, SEED + 401);
      const pool = u < pBig ? bigs : u < pBig + pSmall ? smalls : null;
      if (!pool || !pool.length) continue;
      const sp = pool[(hash2(ax, ay, SEED + 402) * pool.length) | 0];
      const flip = hash2(ax, ay, SEED + 403) < 0.5;
      const ox = ax - (sp.w >> 1), oy = ay - sp.h + 1;
      // 地面からはみ出す株は置かない（草地の縁で少しだけ石に掛かるのはよい）
      let bad = 0;
      for (let q = 0; q < sp.n; q++) {
        const X2 = ox + (flip ? sp.w - 1 - sp.xs[q] : sp.xs[q]), Y2 = oy + sp.ys[q];
        if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) { bad++; continue; }
        const j = Y2 * W + X2;
        if (flg[j] & F_FOOT || (cls[j] !== GRASS && dGrass[j] > 2)) bad++;
      }
      if (bad > sp.n * 0.12) continue;
      const h1 = hash2(ax, ay, SEED + 404), h2 = hash2(ax, ay, SEED + 405);
      let kr = 0.7 + 0.36 * h1, kg = kr, kb = kr;
      if (h2 < 0.18) { kr *= 1.1; kg *= 1.04; kb *= 0.82; } else if (h2 > 0.84) { kr *= 0.86; kg *= 0.95; kb *= 1.04; }
      if (out_) { kr *= 0.8; kg *= 0.84; kb *= 0.86; }
      for (let q = 0; q < sp.n; q++) {
        const X2 = ox + (flip ? sp.w - 1 - sp.xs[q] : sp.xs[q]), Y2 = oy + sp.ys[q];
        if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
        const j = Y2 * W + X2;
        if (flg[j] & F_FOOT || (cls[j] !== GRASS && dGrass[j] > 2)) continue;
        const gr = 1 + 0.18 * (samp(GRIME, X2, Y2) - 0.5);
        out[j * 4] = sp.col[q * 3] * kr * gr; out[j * 4 + 1] = sp.col[q * 3 + 1] * kg * gr; out[j * 4 + 2] = sp.col[q * 3 + 2] * kb * gr;
        over[j] = 1;
      }
    }
    // 石に掛かった葉の、右下への小さな影
    for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
      const i = y * W + x;
      if (over[i] || cls[i] === GRASS || !over[i - W - 1]) continue;
      out[i * 4] *= 0.78; out[i * 4 + 1] *= 0.78; out[i * 4 + 2] *= 0.78;
    }
  }

}
