// Composes the whole town ground once into an offscreen canvas.
// Textures are sampled by world coordinate (no per-tile stamping); material borders are
// domain-warped with low-frequency noise so they read as worn, organic edges, and paved
// surfaces get a dark curb line where they meet grass or dirt.

import { TILE } from './config.js';
import { fbm, hash2 } from './util.js';
import { warnOnce } from './assets.js';

export const MAT = { OUT: 0, GRASS: 1, DIRT: 2, STREET: 3, PLAZA: 4, WATER: 5 };
const CHAR_MAT = { ' ': MAT.OUT, '.': MAT.GRASS, ':': MAT.DIRT, '#': MAT.STREET, '+': MAT.PLAZA, '~': MAT.WATER };
const MAT_KEY = ['outside', 'grass', 'dirt', 'street', 'plaza', 'water'];
const FALLBACK = [
  [9, 11, 15], [50, 70, 46], [92, 76, 56], [88, 88, 94], [104, 99, 98], [20, 36, 56],
];
const isPaved = (m) => m === MAT.STREET || m === MAT.PLAZA;
const isSoft = (m) => m === MAT.GRASS || m === MAT.DIRT || m === MAT.WATER;

export function parseGround(town) {
  const cols = town.cols | 0, rows = town.rows | 0;
  const grid = new Uint8Array(cols * rows);
  const lines = Array.isArray(town.ground) ? town.ground : [];
  for (let y = 0; y < rows; y++) {
    const line = lines[y] || '';
    for (let x = 0; x < cols; x++) {
      const ch = line[x];
      const m = ch === undefined ? MAT.OUT : CHAR_MAT[ch];
      grid[y * cols + x] = m === undefined ? MAT.GRASS : m;
    }
  }
  return grid;
}

export function composeGround(town, grid, textures) {
  const cols = town.cols, rows = town.rows;
  const W = cols * TILE, H = rows * TILE;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(W, H);
  const o = out.data;

  const tex = [];
  for (let m = 0; m < MAT_KEY.length; m++) {
    let t = textures[MAT_KEY[m]] || null;
    if (!t && m === MAT.PLAZA) t = textures.street || null;
    if (!t && m !== MAT.OUT && m !== MAT.WATER) warnOnce(`ground:${MAT_KEY[m]}`, `地面テクスチャ "${MAT_KEY[m]}" が manifest にありません（単色で代用表示）`);
    tex[m] = t;
  }

  const matAt = (px, py) => {
    if (px < 0 || py < 0) return MAT.OUT;
    const tx = (px / TILE) | 0, ty = (py / TILE) | 0;
    if (tx >= cols || ty >= rows) return MAT.OUT;
    return grid[ty * cols + tx];
  };

  // Low-resolution warp + tone fields, bilinearly interpolated per pixel.
  const STEP = 4;
  const gw = Math.ceil(W / STEP) + 2, gh = Math.ceil(H / STEP) + 2;
  const fx = new Float32Array(gw * gh), fy = new Float32Array(gw * gh), tone = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = i * STEP, y = j * STEP;
      fx[j * gw + i] = fbm(x / 26, y / 26, 11, 3) * 2 - 1;
      fy[j * gw + i] = fbm(x / 26, y / 26, 29, 3) * 2 - 1;
      tone[j * gw + i] = fbm(x / 110, y / 110, 53, 3) * 2 - 1;
    }
  }
  const sample = (f, x, y) => {
    const gx = x / STEP, gy = y / STEP;
    const i = gx | 0, j = gy | 0, u = gx - i, v = gy - j;
    const k = j * gw + i;
    const a = f[k], b = f[k + 1], c = f[k + gw], d = f[k + gw + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  const mat = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = sample(fx, x, y), dy = sample(fy, x, y);
      let m = matAt(x + dx * 3.2, y + dy * 3.2);
      if (isSoft(m)) {
        const jx = (hash2(x, y, 5) - 0.5) * 2.4, jy = (hash2(x, y, 6) - 0.5) * 2.4;
        const m2 = matAt(x + dx * 6 + jx, y + dy * 6 + jy);
        if (isSoft(m2)) m = m2;
      }
      mat[y * W + x] = m;
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const m = mat[p];
      let r, g, b;
      const t = tex[m];
      if (t) {
        const ti = (((y % t.height) * t.width) + (x % t.width)) * 4;
        r = t.data[ti]; g = t.data[ti + 1]; b = t.data[ti + 2];
      } else {
        const f = FALLBACK[m];
        const n = (hash2(x >> 1, y >> 1, m) - 0.5) * 10;
        r = f[0] + n; g = f[1] + n; b = f[2] + n;
      }
      // large-scale tone variation breaks texture periodicity
      let k = 1 + sample(tone, x, y) * (m === MAT.GRASS || m === MAT.DIRT ? 0.09 : 0.05);
      if (isPaved(m)) {
        // curb: dark line on the paved side where it meets soft ground, faint lip one px in
        const n1 = (x > 0 ? mat[p - 1] : m), n2 = (x < W - 1 ? mat[p + 1] : m);
        const n3 = (y > 0 ? mat[p - W] : m), n4 = (y < H - 1 ? mat[p + W] : m);
        if (isSoft(n1) || isSoft(n2) || isSoft(n3) || isSoft(n4)) k *= 0.52;
        else {
          const f1 = x > 1 ? mat[p - 2] : m, f2 = x < W - 2 ? mat[p + 2] : m;
          const f3 = y > 1 ? mat[p - 2 * W] : m, f4 = y < H - 2 ? mat[p + 2 * W] : m;
          if (isSoft(f1) || isSoft(f2) || isSoft(f3) || isSoft(f4)) k *= 1.07;
          else if (m === MAT.STREET && (n1 === MAT.PLAZA || n2 === MAT.PLAZA || n3 === MAT.PLAZA || n4 === MAT.PLAZA)) k *= 0.82;
        }
      } else if (m === MAT.GRASS || m === MAT.DIRT) {
        // soft ground right next to paving is trodden darker
        const n1 = (x > 0 ? mat[p - 1] : m), n2 = (x < W - 1 ? mat[p + 1] : m);
        const n3 = (y > 0 ? mat[p - W] : m), n4 = (y < H - 1 ? mat[p + W] : m);
        if (isPaved(n1) || isPaved(n2) || isPaved(n3) || isPaved(n4)) k *= 0.8;
        else if (m === MAT.GRASS && (n1 === MAT.DIRT || n2 === MAT.DIRT || n3 === MAT.DIRT || n4 === MAT.DIRT)) k *= 0.9;
      } else if (m === MAT.WATER) {
        const n3 = (y > 0 ? mat[p - W] : m);
        if (n3 !== MAT.WATER && n3 !== MAT.OUT) k *= 0.6;          // bank shadow
        else if (!t) k *= 0.9 + 0.2 * hash2(x >> 2, y, 9);
      }
      o[p * 4] = r * k; o[p * 4 + 1] = g * k; o[p * 4 + 2] = b * k; o[p * 4 + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return { canvas, mat, width: W, height: H };
}
