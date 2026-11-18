// 港の岸壁。運河の笠石より先に texture を合成する。
import { T, TS, TW } from './constants.mjs';

export function paintQuay(S) {
  const { rows, cols, tc, footT, canalTile, H, W, out } = S;
  const { QUAY } = S.X;
  // ---- 4c. 岸壁: 石畳の通りのすぐ下の水の行に quay.png を重ねる（上端を通りの下端にそろえ、横は世界座標で繰り返す）
  if (QUAY) {
    const QW = QUAY.width, QH = QUAY.height, QD = QUAY.data;
    for (let ty = 1; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      if (tc[ty * cols + tx] !== TW || tc[(ty - 1) * cols + tx] !== TS || footT[(ty - 1) * cols + tx] >= 0) continue;
      // 港の水路口では quay の端を丸めない。水路の石垣と岸壁を角でつなぐ。
      const canalOpening = canalTile[ty * cols + tx] !== 0;
      const endL = !canalOpening && !(tx > 0 && tc[ty * cols + tx - 1] === TW && tc[(ty - 1) * cols + tx - 1] === TS);
      const endR = !canalOpening && !(tx < cols - 1 && tc[ty * cols + tx + 1] === TW && tc[(ty - 1) * cols + tx + 1] === TS);
      for (let ly = 0; ly < QH; ly++) {
        const y = ty * T + ly;
        if (y >= H) break;
        if (ly >= T && tc[Math.min(rows - 1, (y / T) | 0) * cols + tx] !== TW) break;
        for (let lx = 0; lx < T; lx++) {
          if ((endL && lx < 3 && ly > QH - 4 + lx) || (endR && lx > 12 && ly > QH - 4 + (15 - lx))) continue;
          const x = tx * T + lx, q = ((ly * QW) + (x % QW)) * 4, a = QD[q + 3] / 255;
          if (!a) continue;
          const o = (y * W + x) * 4;
          out[o] = out[o] * (1 - a) + QD[q] * a; out[o + 1] = out[o + 1] * (1 - a) + QD[q + 1] * a; out[o + 2] = out[o + 2] * (1 - a) + QD[q + 2] * a;
        }
      }
    }
  }

}
