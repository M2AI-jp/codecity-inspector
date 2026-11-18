// 材質の境と街の外までの距離。縁の苔・影・闇に同じ場を渡す。
import { T, TO, GRASS, DIRT, WATER, F_FOOT } from './constants.mjs';
import { lattice, chess } from './fields.mjs';

export function prepareDistances(S) {
  const { N, flg, cls, W, H, canalTile, tc, cols } = S;
  // ---- 2. 距離
  const softSrc = new Uint8Array(N), grassSrc = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (flg[i] & F_FOOT) continue;
    const c = cls[i];
    const tx = ((i % W) / T) | 0, ty = ((i / W) / T) | 0;
    if ((c === GRASS || c === DIRT || c === WATER) && !(c === WATER && canalTile[ty * cols + tx])) softSrc[i] = c + 1;
    if (c === GRASS) grassSrc[i] = 1;
  }
  const { d: dist, tag: near } = chess(W, H, softSrc);
  const dGrass = chess(W, H, grassSrc).d;
  // 街の外の深さ（4px 格子、近似ユークリッド）
  const outF = (() => {
    const fw = W / 4, fh = H / 4, d = new Float32Array(fw * fh);
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) d[j * fw + i] = tc[((j * 4) >> 4) * cols + ((i * 4) >> 4)] === TO ? 1e9 : 0;
    const pass = (dirn) => {
      const ys = dirn > 0 ? 0 : fh - 1, xs = dirn > 0 ? 0 : fw - 1;
      for (let j = ys; j >= 0 && j < fh; j += dirn) for (let i = xs; i >= 0 && i < fw; i += dirn) {
        const k = j * fw + i; let m = d[k];
        const pj = j - dirn, pi = i - dirn;
        if (pi >= 0 && pi < fw) m = Math.min(m, d[j * fw + pi] + 3);
        if (pj >= 0 && pj < fh) {
          m = Math.min(m, d[pj * fw + i] + 3);
          if (pi >= 0 && pi < fw) m = Math.min(m, d[pj * fw + pi] + 4);
          const qi = i + dirn; if (qi >= 0 && qi < fw) m = Math.min(m, d[pj * fw + qi] + 4);
        }
        d[k] = m;
      }
    };
    pass(1); pass(-1);
    return lattice(W, H, 4, (x, y) => d[Math.min(fh - 1, (y / 4) | 0) * fw + Math.min(fw - 1, (x / 4) | 0)] * (4 / 3));
  })();

  Object.assign(S, { dist, near, dGrass, outF });
}
