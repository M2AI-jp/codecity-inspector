// 最後の夜色と地図の端の闇。前段の Uint8ClampedArray を読んで仕上げる。
import { T, TO, GRASS, SLAB, WATER, FRAME, F_OUT } from './constants.mjs';
import { smooth } from './noise.mjs';
import { samp } from './fields.mjs';

export function paintNight(S) {
  const { W, H, out, cls, flg, tc, cols, outF } = S;
  // ---- 6. 夜の色調（暗部に青、石は暖かい灰色のまま）と、街の外・地図の端の闇
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    let r = out[o], g = out[o + 1], b = out[o + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * 0.9; g = l + (g - l) * 0.9; b = l + (b - l) * 0.9;
    const cool = Math.max(0, 1 - l / 110);
    // 基準 target-town.png の夜は、地面の石と土が月明かりで読める（通りの明るさの中央値 59・赤−青 13、広場 85・26、草 31）。
    // 環境光（web/config.js の青み）は建物にも掛かるので、地面だけここで明るく暖かく寄せる。暗い目地にだけ青を残す
    const c6 = cls[i];
    if (c6 === GRASS) { r = r * 1.2; g = g * 1.13 + 2 * cool; b = b * 1.0 + 8 * cool; }
    else if (c6 === WATER) { r = r * 0.86; g = g * 0.84 + 2 * cool; b = b * 0.8 + 12 * cool; }
    else if (c6 === SLAB || c6 === FRAME) { r = r * 1.1; g = g * 1.08 + 1 * cool; b = b * 1.06 + 7 * cool; }   // 広場は灰色がかった敷石（基準の広場の平均 113,99,83）。光だまりが暖色を足す
    else { r = r * 1.3; g = g * 1.18 + 1 * cool; b = b * 0.9 + 7 * cool; }
    const dEdge = Math.min(x + 0.5, y + 0.5, W - x - 0.5, H - y - 0.5);
    let k = 0.3 + 0.7 * smooth(0, 44, dEdge);
    if (flg[i] & F_OUT || tc[((y / T) | 0) * cols + ((x / T) | 0)] === TO) {
      const dOut = Math.max(0, samp(outF, x, y) - 6);
      k = Math.min(k, 1 - 0.86 * smooth(0, 1, dOut / (dOut + dEdge + 1)));
    }
    out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k;
  }
}
