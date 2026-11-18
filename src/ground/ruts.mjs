// 長い石畳の轍。分類を読んで着色と水たまり用の帯を記録する。
import { T, TS, COBBLE } from './constants.mjs';
import { smooth } from './noise.mjs';
import { samp } from './fields.mjs';

export function prepareRuts(S) {
  const { rows, cols, tc, footT, runAlong, crossLen, orient, W, cls, RUTF, crossStart, rut } = S;
  // 轍: 長い通りの、車輪の通る2本の帯（ところどころ）
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const ti = ty * cols + tx;
    if (tc[ti] !== TS || footT[ti] >= 0 || runAlong[ti] < 10 || crossLen[ti] < 32) continue;
    const v = orient[ti], cl = crossLen[ti], off = cl >= 48 ? 9.5 : 7;
    for (let ly = 0; ly < T; ly++) for (let lx = 0; lx < T; lx++) {
      const x = tx * T + lx, y = ty * T + ly, i = y * W + x;
      if (cls[i] !== COBBLE) continue;
      const amt = smooth(0.47, 0.6, samp(RUTF, x, y));
      if (amt <= 0) continue;
      const c = (v ? x : y) + 0.5 - crossStart[ti] - cl / 2;
      const dd = Math.min(Math.abs(c - off), Math.abs(c + off));
      const q = dd / 3.2, w = q < 1 ? (1 - q * q) * amt : 0;
      if (w > 0) rut[i] = Math.min(255, w * 255) | 0;
    }
  }

}
