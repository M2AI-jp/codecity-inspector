// 建物の接地影。材質・岸・段を描いた画素に順に掛ける。
import { T, F_FOOT } from './constants.mjs';

export function paintBuildingShadows(S) {
  const { town, W, H, flg, out } = S;
  // ---- 5. 建物の接地影（footprint の下辺と右辺、右下へ 2〜3px）
  for (const bd of town.buildings || []) {
    const x0 = bd.x * T, x1 = (bd.x + bd.w) * T, y0 = bd.y * T, y1 = (bd.y + bd.h) * T;
    for (let y = y0 + 4; y < y1 + 3; y++) for (let x = x0 + 2; x < x1 + 3; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (flg[i] & F_FOOT) continue;
      const dy = y - y1, dx = x - x1;
      let s = 0;
      if (dy >= 0) s = [0.3, 0.17, 0.07][dy] * Math.min(1, (x - x0 - 1) / 3) * (dx >= 0 ? [0.75, 0.45, 0.2][dx] : 1);
      else if (dx >= 0) s = [0.24, 0.13, 0.05][dx] * Math.min(1, (y - y0 - 3) / 8);
      if (s > 0) { out[i * 4] *= 1 - s; out[i * 4 + 1] *= 1 - s; out[i * 4 + 2] *= 1 - s; }
    }
  }

}
