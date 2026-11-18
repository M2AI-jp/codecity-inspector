// 全材質の地色と境の陰影。丸めを保つため単一の画素走査で着色する。
import { GRASS, COBBLE, DIRT, SLAB, WATER, KERB, FRAME, F_FOOT, F_V, F_GUTTER, F_INFILL, F_LOOSE, F_RISER, F_DIRTJ, F_OUT, ROTATE_SETTS } from './constants.mjs';
import { hash2, vnoise } from './noise.mjs';
import { samp } from './fields.mjs';
import { lumOf } from './texture-analysis.mjs';

export function paintMaterials(S) {
  const { N, cls, flg, W, H, SEED, GRIME, LUSH, DTONE, dGrass, canalAtPx, key, srnd, srnd2, PH, PW, COY, CH, CW, COX, rut, STAIN, JMOSS, dist, near, EDGEM, pud } = S;
  const { GBASE, MOSS, GRS, DRT, COB, PLZ, GLUM, DMEAN, WAT, PMEAN, CMEAN } = S.X;
  // ---- 3. 色
  const out = new Uint8ClampedArray(N * 4);
  const JR = 30, JG = 26, JB = 22;
  const high = (j) => cls[j] === GRASS && !(flg[j] & F_FOOT);
  const low = (j) => cls[j] !== GRASS && !(flg[j] & F_FOOT);
  const GW = GBASE.width, GH = GBASE.height, GD = GBASE.data, MW = MOSS.width, MH = MOSS.height, MD = MOSS.data;
  const RW = GRS.width, RH = GRS.height, RD = GRS.data, DW = DRT.width, DH = DRT.height, DD = DRT.data;
  const CD = COB.data, PD = PLZ.data;
  const glumHi = GLUM * 1.2;
  const verge = (x, y, d, p1, p2) => {
    if (d > 2) return false;
    const o = ((y % RH) * RW + (x % RW)) * 4;
    return lumOf(RD, o) > glumHi && hash2(x, y, SEED + 93) < (d === 1 ? p1 : p2);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, m = cls[i], f = flg[i], foot = f & F_FOOT;
    let r, g, b;
    const grime = 1 + 0.18 * (samp(GRIME, x, y) - 0.5);
    if (m === GRASS) {
      const o = ((y % GH) * GW + (x % GW)) * 4;
      r = GD[o]; g = GD[o + 1]; b = GD[o + 2];
      {
        // 苔の texture は草地には重ねない（細かい粒が草の株の塊を消す。基準の草地は葉の塊が上から照らされて見える）。苔は石の目地と縁だけ
        const lush = samp(LUSH, x, y);
        const k = 0.93 + 0.14 * lush;
        r *= k * (1.04 - 0.08 * lush); g *= k; b *= k * (0.96 + 0.06 * lush);
        if (f & F_OUT) { r *= 0.84; g *= 0.86; b *= 0.86; }
      }
      r *= grime; g *= grime; b *= grime;
    } else if (m === DIRT) {
      const o = ((y % DH) * DW + (x % DW)) * 4;
      // 踏み固めた土は草地より明るい（基準 target-town.png の土の小道）。texture の細かさはそのまま、明暗は少しだけ強める
      r = DMEAN[0] + (DD[o] - DMEAN[0]) * 1.2; g = DMEAN[1] + (DD[o + 1] - DMEAN[1]) * 1.2; b = DMEAN[2] + (DD[o + 2] - DMEAN[2]) * 1.2;
      r *= 0.96; g *= 0.95; b *= 0.93;
      const k = 1 + 0.24 * (samp(DTONE, x, y) - 0.5);
      r *= k; g *= k; b *= k;
      if (!foot) {
        const d = dGrass[i];
        if (d <= 3) { const k2 = 1 - 0.22 * (1 - (d - 1) / 3); r *= k2; g *= k2; b *= k2; }
        if (verge(x, y, d, 0.55, 0.18)) { const q = ((y % RH) * RW + (x % RW)) * 4; r = RD[q]; g = RD[q + 1]; b = RD[q + 2]; }
      }
    } else if (m === WATER) {
      if (WAT) {
        const o = ((y % WAT.height) * WAT.width + (x % WAT.width)) * 4;
        r = WAT.data[o]; g = WAT.data[o + 1]; b = WAT.data[o + 2];
        const k = 0.94 + 0.12 * samp(DTONE, x, y);
        r *= k; g *= k; b *= k;
      } else {
        const n = vnoise(x / 7, y / 1.7, SEED + 141);
        r = 30; g = 40; b = 47;
        const k = 0.9 + 0.2 * samp(DTONE, x, y);
        r *= k; g *= k; b *= k;
        if (n > 0.74) { r += 16; g += 20; b += 22; }
      }
      let edgeN = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const X2 = x + dx, Y2 = y + dy;
        if (X2 >= 0 && Y2 >= 0 && X2 < W && Y2 < H && cls[Y2 * W + X2] !== WATER) edgeN++;
      }
      if (edgeN && !canalAtPx(x, y)) { const k2 = 0.72 + 0.28 * (1 - Math.min(1, edgeN / 6)); r *= k2; g *= k2; b *= k2; }
    } else {
      // 石: 通り・縁石・広場
      const sid = key[i], h = srnd[i] / 255, h2 = srnd2[i] / 255;
      let o;
      if (m === SLAB) { o = ((y % PH) * PW + (x % PW)) * 4; r = PD[o]; g = PD[o + 1]; b = PD[o + 2]; }
      else if (m === KERB || m === FRAME) { o = (((y + 41) % PH) * PW + ((x + 17) % PW)) * 4; r = PD[o]; g = PD[o + 1]; b = PD[o + 2]; }
      else {
        o = f & F_V && ROTATE_SETTS ? (((x + COY) % CH) * CW + ((y + COX) % CW)) * 4 : (((y + COY) % CH) * CW + ((x + COX) % CW)) * 4;
        r = CD[o]; g = CD[o + 1]; b = CD[o + 2];
      }
      const rw = rut[i] / 255;
      if (sid < 0) {
        if (m === KERB) { r = JR + 4; g = JG + 3; b = JB + 2; }
        else if (m === FRAME) { r = 38; g = 34; b = 30; }
        else if (f & F_GUTTER) {
          const q = ((y % DH) * DW + (x % DW)) * 4;
          const mq = ((y % MH) * MW + (x % MW)) * 4, t2 = hash2(x >> 1, y, SEED + 96) < 0.4 ? 0.6 : 0.2;
          r = DD[q] * 0.5 * (1 - t2) + MD[mq] * 0.8 * t2; g = DD[q + 1] * 0.5 * (1 - t2) + MD[mq + 1] * 0.8 * t2; b = DD[q + 2] * 0.5 * (1 - t2) + MD[mq + 2] * 0.8 * t2;
        } else if (f & F_DIRTJ) {
          const q = ((y % DH) * DW + (x % DW)) * 4;
          r = DD[q] * 0.62; g = DD[q + 1] * 0.6; b = DD[q + 2] * 0.58;
        } else { const kj = m === SLAB ? 0.95 : 0.8; r *= kj; g *= kj; b *= kj; }   // 広場の目地は texture の目地の濃さのまま（基準の広場は灰色の目地が線で見える）
        if (rw > 0) { const k = 1 + 0.15 * rw; r *= k; g *= k; b *= k; }      // 轍の目地は泥で埋まる
      } else {
        if (m === SLAB) {
          const k = 0.84 + 0.14 * h - (h2 > 0.88 ? 0.1 : 0);
          // 広場の石は平らな敷石: 石ごとの色の差を texture より少し抑える。街灯の光だまりの中では、この地の色がそのまま見える
          r = (PMEAN[0] + (r - PMEAN[0]) * 0.8) * k; g = (PMEAN[1] + (g - PMEAN[1]) * 0.8) * k; b = (PMEAN[2] + (b - PMEAN[2]) * 0.8) * k;
        } else if (m === KERB) {
          const k = 0.95 + 0.09 * h;
          r = (PMEAN[0] + (r - PMEAN[0]) * 0.4) * k * 0.97; g = (PMEAN[1] + (g - PMEAN[1]) * 0.4) * k * 0.96; b = (PMEAN[2] + (b - PMEAN[2]) * 0.4) * k * 0.93;
          if (f & F_RISER) { r *= 0.64; g *= 0.64; b *= 0.66; }
        } else if (m === FRAME) {
          const k = 1.06 * (0.94 + 0.08 * h);
          r = (PMEAN[0] + (r - PMEAN[0]) * 0.5) * k; g = (PMEAN[1] + (g - PMEAN[1]) * 0.5) * k; b = (PMEAN[2] + (b - PMEAN[2]) * 0.5) * k;
        } else {
          const ct = f & F_INFILL ? 0.85 : 1.15, k = f & F_INFILL ? 1.02 : 0.88 + 0.2 * h;
          r = (CMEAN[0] + (r - CMEAN[0]) * ct) * k; g = (CMEAN[1] + (g - CMEAN[1]) * ct) * k; b = (CMEAN[2] + (b - CMEAN[2]) * ct) * k;
          if (f & F_LOOSE) { r *= 0.86; g *= 0.86; b *= 0.85; }
        }
        // ほんのり暖かい石・黄土の石
        const wm = h2 * 0.6;
        r *= 1 + 0.04 * wm; b *= 1 - 0.08 * wm;
        if (rw > 0) {
          const mr = CMEAN[0] * 0.72, mg = CMEAN[1] * 0.72, mb = CMEAN[2] * 0.74;
          r += (mr + (r - mr) * 0.45 - r) * rw; g += (mg + (g - mg) * 0.45 - g) * rw; b += (mb + (b - mb) * 0.45 - b) * rw;
        }
        // 左上からの光: 石の左上の縁は明るく、右下の縁は暗く
        const other = (X2, Y2) => X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H ? false : key[Y2 * W + X2] !== sid;
        const lit = other(x - 1, y) || other(x, y - 1), shade = other(x + 1, y) || other(x, y + 1);
        const bev = 1 - 0.6 * rw;
        // 基準の石畳シート（art/references/user-provided/field_cobblestone_roads_sheet.png）の石は、左上の縁がはっきり明るく右下が暗い
        if (lit && !shade) { const k = 1 + (m === SLAB ? 0.12 : m === FRAME ? 0.2 : 0.22) * bev; r *= k; g *= k; b *= k; }
        else if (shade && !lit) { const k = 1 - (m === SLAB ? 0.12 : m === FRAME ? 0.22 : 0.24) * bev; r *= k; g *= k; b *= k; }
      }
      r *= grime; g *= grime; b *= grime;
      if (!foot) {
        if (m !== KERB && m !== FRAME && samp(STAIN, x, y) > 0.66) { r *= 0.88; g *= 0.88; b *= 0.88; }
        if (sid < 0 && m === COBBLE && !(f & F_GUTTER) && samp(JMOSS, x, y) + 0.5 * (hash2(x, y, SEED + 99) - 0.5) > 0.62) {
          const q = ((y % MH) * MW + (x % MW)) * 4; r = MD[q] * 0.95; g = MD[q + 1] * 0.95; b = MD[q + 2] * 0.95;
        }
        const d = dist[i], dressed = m === KERB || m === FRAME;
        if (d <= 4 && !(dressed && sid >= 0)) { const k = 1 - 0.2 * (1 - (d - 1) / 4); r *= k; g *= k; b *= k; }
        if (near[i] === GRASS + 1 && d <= 7 && !(dressed && sid >= 0)) {       // 草地に近い目地・石の縁に苔
          const jointish = sid < 0;
          let rimish = false;
          if (!jointish) {
            rimish = (x > 0 && key[i - 1] !== sid) || (x < W - 1 && key[i + 1] !== sid) || (y > 0 && key[i - W] !== sid) || (y < H - 1 && key[i + W] !== sid);
          }
          const p = (jointish ? 1.45 : rimish ? 0.7 : 0.18) * (1 - (d - 1) / 8) + (samp(EDGEM, x, y) - 0.5) * 0.8;
          if (p > 0.42) {
            const q = ((y % MH) * MW + (x % MW)) * 4, k = (jointish ? 1.0 : 1.2) * (0.9 + 0.25 * hash2(x >> 1, y >> 1, SEED + 95));
            r = MD[q] * k; g = MD[q + 1] * k; b = MD[q + 2] * k;
          }
          if (verge(x, y, d, 0.55, 0.18)) { const q = ((y % RH) * RW + (x % RW)) * 4; r = RD[q]; g = RD[q + 1]; b = RD[q + 2]; }
        }
        if (dressed && sid >= 0 && verge(x, y, d, 0.3, 0)) { const q = ((y % RH) * RW + (x % RW)) * 4; r = RD[q]; g = RD[q + 1]; b = RD[q + 2]; }
      }
    }
    // 水たまり
    const pu = pud[i];
    if (pu) {
      if (pu === 1) { r *= 0.8; g *= 0.8; b *= 0.8; }
      else {
        r = r * 0.22 + 20; g = g * 0.22 + 23; b = b * 0.22 + 28;
        if (pu === 3) { r += 26; g += 29; b += 32; }
        else if (pu === 4) { r += 14; g += 16; b += 18; }
      }
    }
    // 一段高い草地: 右下の低い地面に影を落とし、左上を向いた縁は少し明るく、南の縁は土の面が見える
    if (!foot) {
      if (m === KERB || m === FRAME) {
        // 縁石は草地とほぼ同じ高さ: 草の影は受けない
      } else if (m !== GRASS) {
        const s1 = (x > 0 && high(i - 1)) || (y > 0 && high(i - W)) || (x > 0 && y > 0 && high(i - W - 1));
        const s2 = (x > 1 && y > 0 && high(i - W - 2)) || (x > 0 && y > 1 && high(i - 2 * W - 1)) || (x > 1 && y > 1 && high(i - 2 * W - 2));
        if (s1) { r *= 0.76; g *= 0.76; b *= 0.76; } else if (s2) { r *= 0.91; g *= 0.91; b *= 0.91; }
        else if ((x > 0 && cls[i - 1] === KERB && key[i - 1] >= 0) || (y > 0 && cls[i - W] === KERB && key[i - W] >= 0)) { r *= 0.86; g *= 0.86; b *= 0.86; }
      } else {
        if (y < H - 1 && low(i + W)) { r += (26 - r) * 0.45; g += (24 - g) * 0.45; b += (14 - b) * 0.45; }
        else if ((x > 0 && low(i - 1)) || (y > 0 && low(i - W))) { r *= 1.07; g *= 1.07; b *= 1.07; }
      }
    }
    const o = i * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }

  Object.assign(S, { out, GW, GH, GD, DW, DH, DD });
}
