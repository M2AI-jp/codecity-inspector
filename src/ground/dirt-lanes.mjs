// 細い土路地の踏み面。分類と共有 rng を変えず、石垣より前に重ねる。
import { T, TG, TD, TO, DIRT, F_FOOT } from './constants.mjs';
import { hash2, vnoise, smooth } from './noise.mjs';
import { samp } from './fields.mjs';

export function paintDirtLanes(S) {
  const { cols, rows, tcl, tc, footT, N, W, H, cls, pud, flg, SEED, DH, DW, DD, DTONE, GH, GW, GD, LUSH, GRIME, out } = S;
  const { DMEAN, CMEAN } = S.X;
  // ---- 細い土の路地（幅1〜2マス）だけに、踏み面・草の縁・轍・小石を描く。
  // 分類・距離場・共用rngは変えない（離れた石の苔、水たまり、草の株の配置を保つ）。
  // 石垣・石段より先に描き、既存の石の画素はそのまま上に重ねる。
  {
    const wide = new Uint8Array(cols * rows), laneAt = new Array(cols * rows), lanes = [];
    const grassy = (t) => t === TG || t === TO;
    const addLane = (tx, ty, v, start, span) => {
      const a = start / T, b = (start + span) / T;
      const left = grassy(v ? tcl(a - 1, ty) : tcl(tx, a - 1));
      const right = grassy(v ? tcl(b, ty) : tcl(tx, b));
      const lane = { tx, ty, v, start, span, left, right };
      laneAt[ty * cols + tx] = lane; lanes.push(lane);
    };
    // 3×3以上の土の面は、端も含めて従来の描画を残す。
    for (let ty = 0; ty < rows - 2; ty++) for (let tx = 0; tx < cols - 2; tx++) {
      let full = true;
      for (let dy = 0; dy < 3 && full; dy++) for (let dx = 0; dx < 3; dx++) {
        if (tc[(ty + dy) * cols + tx + dx] !== TD) { full = false; break; }
      }
      if (full) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) wide[(ty + dy) * cols + tx + dx] = 1;
    }
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const ti = ty * cols + tx;
      if (tc[ti] !== TD || footT[ti] >= 0 || wide[ti]) continue;
      let x0 = tx, x1 = tx + 1, y0 = ty, y1 = ty + 1;
      while (x0 > 0 && tc[ty * cols + x0 - 1] === TD) x0--;
      while (x1 < cols && tc[ty * cols + x1] === TD) x1++;
      while (y0 > 0 && tc[(y0 - 1) * cols + tx] === TD) y0--;
      while (y1 < rows && tc[y1 * cols + tx] === TD) y1++;
      const w = x1 - x0, h = y1 - y0;
      if (Math.min(w, h) > 2 || Math.max(w, h) < 3) continue; // 点在する土は路地にしない
      const v = h > w, start = (v ? x0 : y0) * T, span = (v ? w : h) * T;
      addLane(tx, ty, v, start, span);
    }
    // 曲がり角・T字では縦横の走査が両方長くなる。接続する細い路地の幅を引き継ぐ。
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const ti = ty * cols + tx;
      if (tc[ti] !== TD || footT[ti] >= 0 || wide[ti] || laneAt[ti]) continue;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = laneAt[ny * cols + nx];
        if (!n || (n.v ? dx !== 0 : dy !== 0)) continue;
        addLane(tx, ty, n.v, n.start, n.span);
        break;
      }
    }
    const bare = new Uint8Array(N); // 小石とその影も、描き直した土の画素の内側だけ
    for (const { tx, ty, v, start, span, left, right } of lanes) {
      // ぼかしで幅の外へにじんだ土も草の縁に含める（明るい1pxの線を残さない）。
      // 幅2マスの内側は広げず、草に接する外側だけ最大3px描き直す。
      const lo = left && (v ? tx : ty) * T === start ? 3 : 0;
      const hi = right && ((v ? tx : ty) + 1) * T === start + span ? 3 : 0;
      const x0 = Math.max(0, tx * T - (v ? lo : 0)), x1 = Math.min(W, (tx + 1) * T + (v ? hi : 0));
      const y0 = Math.max(0, ty * T - (v ? 0 : lo)), y1 = Math.min(H, (ty + 1) * T + (v ? 0 : hi));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * W + x, o = i * 4;
        if (cls[i] !== DIRT || pud[i] || flg[i] & F_FOOT) continue; // 石・水たまり・建物の足元を残す
        if ((x >> 4) !== tx || (y >> 4) !== ty) {
          if (!grassy(tcl(x >> 4, y >> 4))) continue;
        }
        const along = v ? y : x, across = (v ? x : y) + 0.5 - start;
        const wander = Math.round((vnoise(along / 13, start / 19, SEED + 721) - 0.5) * 3);
        const centre = span / 2 + wander;
        const wear = 1 - smooth(span * 0.12, span * 0.5, Math.abs(across - centre));
        const q = ((y % DH) * DW + (x % DW)) * 4;
        // 元の土の色を使い、中央の細かな粒を踏み均す。縁は暗く、中央も元の土より一段暗い。
        const grain = 0.75 - 0.3 * wear;
        let tone = 0.63 + 0.19 * wear + 0.16 * (samp(DTONE, x, y) - 0.5)
          + 0.08 * (vnoise(along / 6, start / 11, SEED + 720) - 0.5);
        // 轍は別々に途切れ、横に1pxずつ揺れる。長い平行線やタイルごとの繰り返しにしない。
        for (const side of [-1, 1]) {
          const drift = Math.round((vnoise(along / 9, start + side * 7, SEED + 722) - 0.5) * 3);
          const d = Math.abs(across - centre - side * span * 0.18 - drift);
          const strength = smooth(0.38, 0.63, vnoise(along / 7, start + side * 31, SEED + 723));
          if (d < 1.25) tone *= 1 - (d < 0.65 ? 0.32 : 0.12) * strength;
        }
        let r = (DMEAN[0] + (DD[q] - DMEAN[0]) * grain) * tone;
        let g = (DMEAN[1] + (DD[q + 1] - DMEAN[1]) * grain) * tone * 0.99;
        let b = (DMEAN[2] + (DD[q + 2] - DMEAN[2]) * grain) * tone * 0.98;
        // 両岸で違う長さの草の塊。2px単位の段と1pxの葉先で直線を崩し、通る中央は残す。
        let grass = false, bankShade = false;
        for (const [enabled, d, bank] of [[left, across, start], [right, span - across, start + span]]) {
          if (!enabled) continue;
          const reach = 1 + Math.floor(vnoise(Math.floor(along / 2) / 3, bank, SEED + 724) * 4)
            + (hash2(Math.floor(along / 3), bank, SEED + 726) > 0.58 ? 2 : 0);
          const tip = d < reach + 1.5 && hash2(x >> 1, y >> 1, SEED + 725) < 0.25;
          if (d < reach || tip) grass = true;
          else if (d < reach + 2) bankShade = true;
        }
        if (grass) {
          const z = ((y % GH) * GW + (x % GW)) * 4, lush = samp(LUSH, x, y);
          const k = (0.93 + 0.14 * lush) * (1 + 0.18 * (samp(GRIME, x, y) - 0.5));
          // clsはDIRTのままなので、最後の夜の色調との差だけ先に補う。
          r = GD[z] * k * (1.04 - 0.08 * lush) * 0.92;
          g = GD[z + 1] * k * 0.96;
          b = GD[z + 2] * k * (0.96 + 0.06 * lush) * 1.08;
        } else {
          if (bankShade) { r *= 0.82; g *= 0.82; b *= 0.82; }
          bare[i] = 1;
        }
        out[o] = r; out[o + 1] = g; out[o + 2] = b;
      }
    }
    // 1〜4pxの小石。左上の面・暗い右下・地面へ落ちる1pxの影を、同じ土の系統で。
    const stone = [DMEAN[0] * 0.35 + CMEAN[0] * 0.65, DMEAN[1] * 0.35 + CMEAN[1] * 0.65, DMEAN[2] * 0.35 + CMEAN[2] * 0.65];
    const onBare = (x, y) => x >= 0 && y >= 0 && x < W && y < H && bare[y * W + x];
    for (const { tx, ty } of lanes) for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
      const gx = tx * 2 + cx, gy = ty * 2 + cy;
      if (hash2(gx, gy, SEED + 731) > 0.28) continue;
      const x = gx * 8 + 1 + Math.floor(hash2(gx, gy, SEED + 732) * 5);
      const y = gy * 8 + 1 + Math.floor(hash2(gx, gy, SEED + 733) * 5);
      const big = hash2(gx, gy, SEED + 734) > 0.76;
      const w = big ? 3 + (hash2(gx, gy, SEED + 735) > 0.5 ? 1 : 0) : 1 + (hash2(gx, gy, SEED + 735) > 0.5 ? 1 : 0);
      const h = big ? 2 : 1, k = 0.88 + hash2(gx, gy, SEED + 736) * 0.18;
      if (!onBare(x, y) || !onBare(x + w, y + h)) continue;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
        if (big && dy === 0 && dx === w - 1) continue;
        const sx = x + dx + 1, sy = y + dy + 1;
        if (onBare(sx, sy)) { const o = (sy * W + sx) * 4; out[o] *= 0.58; out[o + 1] *= 0.58; out[o + 2] *= 0.58; }
      }
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
        if (!onBare(x + dx, y + dy) || (big && dy === 0 && dx === w - 1)) continue;
        const o = ((y + dy) * W + x + dx) * 4;
        const light = dy === 0 && (dx < w - 1 || w === 1) ? 1.32 : dx === w - 1 ? 0.72 : 0.94;
        for (let c = 0; c < 3; c++) out[o + c] = stone[c] * k * light;
      }
    }
  }

}
