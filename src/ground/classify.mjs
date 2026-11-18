// 画素の材質と石の所属。edge と石の重心の可変値をこの走査内に閉じる。
import { T, TG, TS, TD, TP, TW, TO, GRASS, COBBLE, DIRT, SLAB, WATER, KERB, FRAME, F_FOOT, F_V, F_GUTTER, F_INFILL, F_LOOSE, F_RISER, F_DIRTJ, F_OUT, ROTATE_SETTS, KW, FW } from './constants.mjs';
import { hash2, vnoise, fbm } from './noise.mjs';
import { samp } from './fields.mjs';

export function classifyPixels(S) {
  const { SEED, N, W, cols, rows, tc, footT, canalTile, orient, kerbM, plazaM, dirtM, grassM, streetM, waterM, cx_, cy_, Sm, Gm, Dm, Wm, Dsm } = S;
  const { COB, PLZ, segC, segP } = S.X;
  // tile 内の (lx, ly) から、bit の立った隣 tile までの距離。ED: 距離、ES: 0N 1S 2W 3E 4角
  let ED = 0, ES = 0;
  const edge = (m, lx, ly) => {
    let d = 99, s = -1;
    if (m & 1 && ly < d) { d = ly; s = 0; }
    if (m & 2 && 15 - ly < d) { d = 15 - ly; s = 1; }
    if (m & 4 && lx < d) { d = lx; s = 2; }
    if (m & 8 && 15 - lx < d) { d = 15 - lx; s = 3; }
    if (m & 16 && !(m & 5)) { const c = Math.max(lx, ly); if (c < d) { d = c; s = 4; } }
    if (m & 32 && !(m & 9)) { const c = Math.max(15 - lx, ly); if (c < d) { d = c; s = 4; } }
    if (m & 64 && !(m & 6)) { const c = Math.max(lx, 15 - ly); if (c < d) { d = c; s = 4; } }
    if (m & 128 && !(m & 10)) { const c = Math.max(15 - lx, 15 - ly); if (c < d) { d = c; s = 4; } }
    ED = d; ES = s;
  };
  // 縁に沿って長さ L 前後で切れる石。目地なら -1、そうでなければ石の番号。
  const seg = (along, line, L, salt) => {
    const a = along + 4096;
    let k = Math.floor(a / L);
    const j = k * L + Math.floor(hash2(k, line, SEED + salt) * 4);
    if (a === j) return -1;
    if (a < j) k--;
    return k;
  };

  // ---- 1. pixel ごとの分類
  const cls = new Uint8Array(N), flg = new Uint8Array(N), key = new Int32Array(N).fill(-1);
  const srnd = new Uint8Array(N), srnd2 = new Uint8Array(N), rut = new Uint8Array(N);
  const COX = 7 + (SEED % 131), COY = 3 + ((SEED >>> 8) % 127);
  const CW = COB.width, CH = COB.height, PW = PLZ.width, PH = PLZ.height;
  let SL = -1, SX = 0, SY = 0;
  // 石の向き: 見下ろし 3/4 の絵では丸い石はどの通りでも横長の楕円に見える（基準 target-town.png も同じ）。
  // 南北の通りでも texture を回さない（v は継ぎ目と轍の判定にだけ使う）
  const cob = (x, y, v) => {
    let i;
    if (v && ROTATE_SETTS) { i = ((x + COY) % CH) * CW + ((y + COX) % CW); SL = segC.label[i]; SX = x + segC.dcy[i]; SY = y + segC.dcx[i]; }
    else { i = ((y + COY) % CH) * CW + ((x + COX) % CW); SL = segC.label[i]; SX = x + segC.dcx[i]; SY = y + segC.dcy[i]; }
  };
  // 通りと土の境目: 石の重心で判定するので、石は丸ごと残るか丸ごと土になる
  const xField = (x, y) => samp(Sm, x, y) - 1.6 * samp(Dm, x, y) + 0.7 * (fbm(x / 9, y / 9, SEED + 11) - 0.5) + 0.2 * (vnoise(x / 3, y / 3, SEED + 12) - 0.5);
  // 通りと草の境: 正なら石、負なら草。境は 1 マスの半分ほどうねり、草が通りへせり出し、石が草へこぼれる
  const gField = (x, y) => samp(Sm, x, y) - samp(Gm, x, y) + 0.55 * (fbm(x / 9, y / 9, SEED + 15) - 0.5) + 0.18 * (vnoise(x / 3, y / 3, SEED + 16) - 0.5);
  // 1 そのまま, 0 向き違い（継ぎ目）, 2 側溝（縁石の帯・草地に重心）, 3 土に呑まれた, 4 ばらけた石
  const cobIn = (v) => {
    const ctx = Math.floor(SX / T), cty = Math.floor(SY / T);
    const ti = cy_(cty) * cols + cx_(ctx), t = tc[ti];
    if (t === TS) {
      if (footT[ti] >= 0) return 1;
      if (orient[ti] !== v) return 0;
      const km = kerbM[ti];
      if (km) { edge(km, SX - ctx * T, SY - cty * T); if (ED < KW - 0.5) return 2; }
      if (grassM[ti]) {
        const gv = gField(SX, SY);
        if (gv > 0.04) return 1;
        if (gv > -0.08) return hash2(Math.round(SX), Math.round(SY), SEED + 17) < 0.45 ? 4 : 3;
        return 3;
      }
      if (dirtM[ti]) {
        const xv = xField(SX, SY);
        if (xv > 0) return 1;
        return xv > -0.1 && hash2(Math.round(SX), Math.round(SY), SEED + 14) < 0.35 ? 4 : 3;
      }
      return 1;
    }
    if (t === TD) {
      const xv = xField(SX, SY);
      if (xv > 0) return 1;
      return xv > -0.12 && hash2(Math.round(SX), Math.round(SY), SEED + 14) < 0.3 ? 4 : 3;
    }
    if (t === TP || footT[ti] >= 0) return 1;
    if (t === TG && streetM[ti]) { const gv = gField(SX, SY); return gv > 0.1 ? 1 : gv > 0.02 && hash2(Math.round(SX), Math.round(SY), SEED + 18) < 0.4 ? 4 : 3; }
    return 2;
  };
  const setStone = (i, k, salt) => {
    key[i] = k;
    srnd[i] = (hash2(Math.round(SX), Math.round(SY), SEED + salt) * 255) | 0;
    srnd2[i] = (hash2(Math.round(SX), Math.round(SY), SEED + 83) * 255) | 0;
  };
  // 柔らかい地面（草・土・水）のどれか: ぼかした所属 + ノイズ の大きいほう
  const soft = (x, y) => {
    const g = samp(Gm, x, y), d = samp(Dm, x, y), w = samp(Wm, x, y);
    if (d < 0.004 && w < 0.004) return GRASS;
    if (g < 0.004 && w < 0.004) return DIRT;
    const gg = g + 0.42 * (fbm(x / 8, y / 8, SEED + 31) - 0.5) + 0.07 * (vnoise(x / 2.2, y / 2.2, SEED + 32) - 0.5);
    // 土の小道の縁は大きくうねる（草が道へせり出し、道が草へ食い込む）
    const dd = d + 0.62 * (fbm(x / 11, y / 11, SEED + 41) - 0.5) + 0.1 * (vnoise(x / 2.2, y / 2.2, SEED + 42) - 0.5);
    const ww = w > 0.004 ? w + 0.22 * (fbm(x / 10, y / 10, SEED + 45) - 0.5) : -1;
    return ww > gg && ww > dd ? WATER : dd > gg ? DIRT : GRASS;
  };

  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const ti = ty * cols + tx, t = tc[ti], foot = footT[ti] >= 0;
    const km = kerbM[ti], pm = plazaM[ti], nearDirt = dirtM[ti] || t === TD, nearWater = waterM[ti] || t === TW;
    for (let ly = 0; ly < T; ly++) for (let lx = 0; lx < T; lx++) {
      const x = tx * T + lx, y = ty * T + ly, i = y * W + x;
      if (foot) {                                   // 建物の下: 無地
        flg[i] = F_FOOT;
        if (t === TS || t === TP) { cob(x, y, 0); cls[i] = COBBLE; if (SL >= 0) setStone(i, SL, 82); }
        else cls[i] = t === TD ? DIRT : t === TW ? WATER : GRASS;
        continue;
      }
      if (t === TW && canalTile[ti]) {             // 水路は tile 全体を水に固定する
        cls[i] = WATER;
        continue;
      }
      if (t === TS) {
        if (km) {
          edge(km, lx, ly);
          if (ED < KW) {
            cls[i] = KERB;
            const conv = (km & 1 && km & 4 && ly < KW && lx < KW) || (km & 1 && km & 8 && ly < KW && 15 - lx < KW) ||
              (km & 2 && km & 4 && 15 - ly < KW && lx < KW) || (km & 2 && km & 8 && 15 - ly < KW && 15 - lx < KW);
            let joint = false, riser = false;
            if (km & 1 && ly === KW - 1) riser = true;
            if ((km & 2 && 15 - ly === KW - 1) || (km & 4 && lx === KW - 1) || (km & 8 && 15 - lx === KW - 1)) joint = true;
            if (ES === 4 && ED === KW - 1) joint = true;
            let k;
            if (conv || ES === 4) k = 2000000 + ti * 4 + (lx < 8 ? 0 : 1) + (ly < 8 ? 0 : 2);
            else {
              const horiz = ES <= 1, s = seg(horiz ? x : y, horiz ? ty * 2 + ES : 50000 + tx * 2 + ES, 11, 7);
              if (s < 0) joint = true;
              k = 1000000 + (((horiz ? ty * 2 + ES : 50000 + tx * 2 + ES) * 977 + s) & 0xfffff);
            }
            if (joint) flg[i] = F_GUTTER;
            else {
              key[i] = k;
              srnd[i] = (hash2(k, 1, SEED + 84) * 255) | 0; srnd2[i] = (hash2(k, 2, SEED + 85) * 255) | 0;
              if (riser) flg[i] = F_RISER;
            }
            continue;
          }
        }
        const v = orient[ti];
        cob(x, y, v);
        if (SL >= 0) {
          let r = cobIn(v), vv = v;
          if (r === 0) { cob(x, y, 1 - v); vv = 1 - v; r = SL >= 0 ? cobIn(vv) : 5; if (r === 0) r = 5; }
          if (r === 1 || r === 4) { cls[i] = COBBLE; setStone(i, SL + (vv ? 100000 : 0), 82); flg[i] = (vv ? F_V : 0) | (r === 4 ? F_LOOSE : 0); }
          else if (r === 3) cls[i] = soft(x, y);
          else { cls[i] = COBBLE; flg[i] = (v ? F_V : 0) | (r === 2 ? F_GUTTER : 0); }
        } else {
          cls[i] = COBBLE; flg[i] = v ? F_V : 0;
          if (grassM[ti] && gField(x, y) < -0.02) { cls[i] = soft(x, y); continue; }
          if (nearDirt) {
            const xv = xField(x, y);
            if (xv < -0.06) cls[i] = soft(x, y);
            else if (samp(Dsm, x, y) > 0.18) flg[i] |= F_DIRTJ;
          }
        }
        continue;
      }
      if (t === TP) {
        if (pm) {
          edge(pm, lx, ly);
          if (ED < FW) {
            cls[i] = FRAME;
            const conv = (pm & 1 && pm & 4 && ly < FW && lx < FW) || (pm & 1 && pm & 8 && ly < FW && 15 - lx < FW) ||
              (pm & 2 && pm & 4 && 15 - ly < FW && lx < FW) || (pm & 2 && pm & 8 && 15 - ly < FW && 15 - lx < FW);
            let joint = ED === 0 || ED === FW - 1;
            if (conv) {   // 角石: 両方向の目地だけを残す
              const dy = ly < FW ? ly : 15 - ly, dx = lx < FW ? lx : 15 - lx;
              joint = dx === 0 || dy === 0 || (dx === FW - 1 && dy <= FW - 1) || (dy === FW - 1 && dx <= FW - 1);
            }
            let k;
            if (conv || ES === 4) k = 4000000 + ti * 4 + (lx < 8 ? 0 : 1) + (ly < 8 ? 0 : 2);
            else {
              const horiz = ES <= 1, line = horiz ? ty * 2 + ES : 50000 + tx * 2 + ES, s = seg(horiz ? x : y, line, 17, 9);
              if (s < 0) joint = true;
              k = 3000000 + ((line * 977 + s) & 0xfffff);
            }
            if (!joint) { key[i] = k; srnd[i] = (hash2(k, 1, SEED + 86) * 255) | 0; srnd2[i] = (hash2(k, 2, SEED + 87) * 255) | 0; }
            continue;
          }
        }
        const pi = (y % PH) * PW + (x % PW), l = segP.label[pi];
        if (l >= 0) {
          SX = x + segP.dcx[pi]; SY = y + segP.dcy[pi];
          const ctx = Math.floor(SX / T), cty = Math.floor(SY / T), cti = cy_(cty) * cols + cx_(ctx);
          let inside = tc[cti] === TP;
          if (inside && plazaM[cti]) { edge(plazaM[cti], SX - ctx * T, SY - cty * T); inside = ED >= FW + 1.5; }
          if (inside) { cls[i] = SLAB; setStone(i, 300000 + l, 81); continue; }
          // 縁石の内側に半端に残る板石は、小さな石の詰め物にする
          cob(x, y, 0);
          cls[i] = COBBLE; flg[i] = F_INFILL;
          if (SL >= 0) setStone(i, 200000 + SL, 82);
        } else cls[i] = SLAB;
        continue;
      }
      if (t === TD && streetM[ti]) {               // 路地の口: 通りの石がこぼれる
        const v = streetM[ti] & 3 ? orient[cy_(ty + (streetM[ti] & 1 ? -1 : 1)) * cols + tx] : orient[ty * cols + cx_(tx + (streetM[ti] & 4 ? -1 : 1))];
        cob(x, y, v);
        if (SL >= 0) {
          const r = cobIn(v);
          if (r === 1 || r === 4) { cls[i] = COBBLE; setStone(i, SL + (v ? 100000 : 0), 82); flg[i] = (v ? F_V : 0) | (r === 4 ? F_LOOSE : 0); continue; }
        } else if (samp(Sm, x, y) > 0.05) {
          if (xField(x, y) > 0.06) { cls[i] = COBBLE; flg[i] = (v ? F_V : 0) | F_DIRTJ; continue; }
        }
        cls[i] = soft(x, y);
        continue;
      }
      if (t === TG && streetM[ti]) {
        const v = streetM[ti] & 3 ? orient[cy_(ty + (streetM[ti] & 1 ? -1 : 1)) * cols + tx] : orient[ty * cols + cx_(tx + (streetM[ti] & 4 ? -1 : 1))];
        cob(x, y, v);
        if (SL >= 0) {
          const r = cobIn(v);
          if (r === 1 || r === 4) { cls[i] = COBBLE; setStone(i, SL + (v ? 100000 : 0), 82); flg[i] = (v ? F_V : 0) | (r === 4 ? F_LOOSE : 0); continue; }
        } else if (gField(x, y) > 0.12) { cls[i] = COBBLE; flg[i] = v ? F_V : 0; continue; }
      }
      if (t === TD || t === TW || nearDirt || nearWater) cls[i] = soft(x, y);
      else cls[i] = GRASS;
      if (t === TO) flg[i] |= F_OUT;
    }
  }

  Object.assign(S, { cls, flg, key, srnd, srnd2, rut, COX, COY, CW, CH, PW, PH });
}
