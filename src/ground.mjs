// 地面の合成（Node側）: Town の ground（16px tile の文字）から、街全体で1枚の連続した地面画像をつくる。
//   '.' 草地  '#' 石畳の通り  ':' 土の路地  '+' 広場  '~' 水  ' ' 街の外（暗い下草 → 地図の端で闇へ）
// 水は art/game/ground/water.png（あれば。無ければ暗い色）。石畳の通りのすぐ下の水の行には
// quay.png（岸壁の石の帯、横に継ぎ目なし、上端が通りの下端）を重ねる。
// 光は焼き込まない: 石の左上の面取り、一段高い草地が右下に落とす影、夜のゆるい色調だけ。夜の照明はブラウザ側。
// 建物の footprint は無地の地面のまま（建物の絵が覆う）。footprint の下辺・右辺に薄い接地影を置く。
//
//   renderGround(town, artDir) → { width: cols*16, height: rows*16, data: RGBA }
//   groundPNG(town, { artDir, cacheDir }) → { buffer, file, cached, ms }   （os.tmpdir()/codecity-cache に保存して再利用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodePNG, encodePNG } from '../tools/png.mjs';

export const GROUND_VERSION = 10;          // 見た目を変えたら上げる（キャッシュの鍵に入る）
const T = 16;
const DEFAULT_ART = path.resolve(import.meta.dirname, '../art/game');
const TEX_NAMES = ['street', 'grass', 'dirt', 'plaza', 'moss'];
const OPT_TEX = ['water', 'quay', 'wall'];  // 無くてもよい texture（wall: 段の石垣の前面。高さ 16px、横に継ぎ目なし、上 4px が笠石）

// tile の種別
const TG = 0, TS = 1, TD = 2, TP = 3, TW = 4, TO = 5;
const TILE_OF = { '.': TG, '#': TS, ':': TD, '+': TP, '~': TW, ' ': TO };
// pixel の種別
const GRASS = 0, COBBLE = 1, DIRT = 2, SLAB = 3, WATER = 4, KERB = 5, FRAME = 6;
// pixel の印
const F_FOOT = 1, F_V = 2, F_GUTTER = 4, F_INFILL = 8, F_LOOSE = 16, F_RISER = 32, F_DIRTJ = 64, F_OUT = 128;
const ROTATE_SETTS = false;   // 南北の通りで石の texture を 90° 回すか
const KW = 3;          // 縁石の幅（px）
const FW = 6;          // 広場の縁石の幅（目地1 + 石4 + 目地1）

// ---------------------------------------------------------------- 乱数・ノイズ
function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 3) {
  let t = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { t += a * vnoise(x * f, y * f, s + i * 17); n += a; a *= 0.5; f *= 2; }
  return t / n;
}
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 粗い格子（cell px ごと）の値を双線形で引く場。低周波のノイズと、tile の所属をぼかしたもの。
function lattice(W, H, cell, fn) {
  const fw = Math.ceil(W / cell) + 2, fh = Math.ceil(H / cell) + 2, a = new Float32Array(fw * fh);
  for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) a[j * fw + i] = fn(i * cell + cell / 2, j * cell + cell / 2);
  return { a, fw, fh, cell, inv: 1 / cell };
}
function samp(F, x, y) {
  let u = (x + 0.5) * F.inv - 0.5, v = (y + 0.5) * F.inv - 0.5;
  if (u < 0) u = 0; if (v < 0) v = 0;
  const i = u | 0, j = v | 0, fu = u - i, fv = v - j, w = F.fw, a = F.a, o = j * w + i;
  const t = a[o] + (a[o + 1] - a[o]) * fu, b = a[o + w] + (a[o + w + 1] - a[o + w]) * fu;
  return t + (b - t) * fv;
}
function boxBlur(F, r) {
  const { fw, fh } = F, src = F.a, tmp = new Float32Array(fw * fh), out = new Float32Array(fw * fh), n = 2 * r + 1;
  for (let y = 0; y < fh; y++) {
    const row = y * fw; let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(fw - 1, Math.max(0, k))];
    for (let x = 0; x < fw; x++) { tmp[row + x] = acc / n; acc += src[row + Math.min(fw - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < fw; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(fh - 1, Math.max(0, k)) * fw + x];
    for (let y = 0; y < fh; y++) { out[y * fw + x] = acc / n; acc += tmp[Math.min(fh - 1, y + r + 1) * fw + x] - tmp[Math.max(0, y - r) * fw + x]; }
  }
  F.a = out;
  return F;
}

// チェス盤距離（上限255）。src[i] が 0 以外の pixel からの距離と、いちばん近い src の値。
function chess(W, H, src) {
  const d = new Uint8Array(W * H), tag = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (src[i]) { tag[i] = src[i]; } else d[i] = 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let m = d[i]; if (!m) continue; let t = tag[i];
    if (x > 0 && d[i - 1] + 1 < m) { m = d[i - 1] + 1; t = tag[i - 1]; }
    if (y > 0) {
      const u = i - W;
      if (d[u] + 1 < m) { m = d[u] + 1; t = tag[u]; }
      if (x > 0 && d[u - 1] + 1 < m) { m = d[u - 1] + 1; t = tag[u - 1]; }
      if (x < W - 1 && d[u + 1] + 1 < m) { m = d[u + 1] + 1; t = tag[u + 1]; }
    }
    d[i] = m; tag[i] = t;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let m = d[i]; if (!m) continue; let t = tag[i];
    if (x < W - 1 && d[i + 1] + 1 < m) { m = d[i + 1] + 1; t = tag[i + 1]; }
    if (y < H - 1) {
      const u = i + W;
      if (d[u] + 1 < m) { m = d[u] + 1; t = tag[u]; }
      if (x < W - 1 && d[u + 1] + 1 < m) { m = d[u + 1] + 1; t = tag[u + 1]; }
      if (x > 0 && d[u - 1] + 1 < m) { m = d[u - 1] + 1; t = tag[u - 1]; }
    }
    d[i] = m; tag[i] = t;
  }
  return { d, tag };
}

// ---------------------------------------------------------------- texture の下ごしらえ（artDir ごとに1回）
const lumOf = (d, o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
function stats(img) {
  const m = [0, 0, 0], s = [0, 0, 0], n = img.width * img.height;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) m[c] += img.data[i * 4 + c];
  for (let c = 0; c < 3; c++) m[c] /= n;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) s[c] += (img.data[i * 4 + c] - m[c]) ** 2;
  for (let c = 0; c < 3; c++) s[c] = Math.sqrt(s[c] / n);
  return { m, s };
}
function otsu(img) {
  const hist = new Array(256).fill(0), n = img.width * img.height;
  for (let i = 0; i < n; i++) hist[Math.round(lumOf(img.data, i * 4))]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}
// 石と目地を分ける: 明るい連結成分 = 石（端をまたいで連結）。各 pixel から石の重心までのずれを持つ。
function segment(img, thrBias = 0) {
  const w = img.width, h = img.height, thr = otsu(img) + thrBias;
  const label = new Int32Array(w * h).fill(-1), dcx = new Float32Array(w * h), dcy = new Float32Array(w * h);
  const isStone = (i) => lumOf(img.data, i * 4) >= thr;
  let nl = 0;
  for (let s = 0; s < w * h; s++) {
    if (label[s] !== -1 || !isStone(s)) continue;
    const q = [[s % w, (s / w) | 0]], pix = []; label[s] = nl;
    while (q.length) {
      const [ux, uy] = q.pop(); pix.push([ux, uy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ux + dx, ny = uy + dy, i = (((ny % h) + h) % h) * w + (((nx % w) + w) % w);
        if (label[i] === -1 && isStone(i)) { label[i] = nl; q.push([nx, ny]); }
      }
    }
    let cx = 0, cy = 0; for (const [x, y] of pix) { cx += x; cy += y; } cx /= pix.length; cy /= pix.length;
    for (const [x, y] of pix) {
      const i = (((y % h) + h) % h) * w + (((x % w) + w) % w);
      dcx[i] = cx - x; dcy[i] = cy - y;
      if (pix.length < 4) label[i] = -2;
    }
    nl++;
  }
  for (let i = 0; i < w * h; i++) if (label[i] === -2) label[i] = -1;   // 小さすぎる粒は目地
  return { label, dcx, dcy, count: nl };
}

// 詰め込んだ丸石の texture は、石どうしの隙間が細く、明るさのしきい値によっては隣の石とつながって大きな塊になる。
// つながった塊が無くなる（いちばん大きい石が 360px 以下になる）まで、しきい値を少しずつ上げる。
function segmentSeparated(img, thrBias = 0) {
  let s = segment(img, thrBias);
  for (let b = thrBias + 3; b <= thrBias + 36; b += 3) {
    const area = new Int32Array(s.count);
    for (let i = 0; i < s.label.length; i++) if (s.label[i] >= 0) area[s.label[i]]++;
    if (Math.max(0, ...area) <= 360) break;
    s = segment(img, b);
  }
  return s;
}

// 草の texture から、葉の株（明るい葉のかたまり）を切り出し、株を消した下地をつくる。
// 株は街の上で blue-noise に撒き直す（texture の繰り返しをそのまま見せない）。
function prepareGrass(img) {
  const W = img.width, H = img.height, N = W * H, d = img.data;
  const wrap = (x, y) => (((y % H) + H) % H) * W + (((x % W) + W) % W);
  const bright = new Uint8Array(N);
  for (let i = 0; i < N; i++) bright[i] = lumOf(d, i * 4) >= 62 ? 1 : 0;
  const reg = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!bright[y * W + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reg[wrap(x + dx, y + dy)] = 1;
  }
  const lab = new Int32Array(N).fill(-1), sprites = [];
  for (let s = 0; s < N; s++) {
    if (lab[s] >= 0 || !reg[s]) continue;
    const q = [[s % W, (s / W) | 0]], pix = []; lab[s] = 1;
    while (q.length) {
      const [x, y] = q.pop(); pix.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = wrap(x + dx, y + dy);
        if (lab[j] < 0 && reg[j]) { lab[j] = 1; q.push([x + dx, y + dy]); }
      }
    }
    let nb = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pix) { if (bright[wrap(x, y)]) nb++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (nb < 10 || w > 44 || h > 34) continue;
    const xs = new Int16Array(pix.length), ys = new Int16Array(pix.length), col = new Uint8Array(pix.length * 3);
    pix.forEach(([x, y], k) => { xs[k] = x - x0; ys[k] = y - y0; const o = wrap(x, y) * 4; col[k * 3] = d[o]; col[k * 3 + 1] = d[o + 1]; col[k * 3 + 2] = d[o + 2]; });
    sprites.push({ w, h, xs, ys, col, n: pix.length, big: nb >= 40 });
  }
  // 株の場所を、株の無い場所の色で埋める（決まったずれの候補から最初に空いているもの）
  const base = new Uint8ClampedArray(d);
  const OFFS = [[53, 29], [-41, 67], [97, -23], [-71, -53], [29, 113], [131, 47], [-17, -89], [61, 83], [-107, 11], [11, -131], [83, -67], [-29, 37]];
  for (let i = 0; i < N; i++) {
    if (!reg[i]) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of OFFS) {
      const s2 = wrap(x + dx, y + dy);
      if (!reg[s2]) { base[i * 4] = d[s2 * 4]; base[i * 4 + 1] = d[s2 * 4 + 1]; base[i * 4 + 2] = d[s2 * 4 + 2]; break; }
    }
  }
  return { base: { width: W, height: H, data: base }, sprites };
}

const texCache = new Map();
function texturePath(artDir, name) {
  const cands = [path.join(artDir, 'ground', `${name}.png`), path.join(artDir, `${name}.png`)];
  const p = cands.find((c) => fs.existsSync(c));
  if (!p) throw new Error(`地面の texture が見つからない: ${cands[0]}`);
  return p;
}
function loadTextures(artDir) {
  if (texCache.has(artDir)) return texCache.get(artDir);
  const rd = (n) => decodePNG(fs.readFileSync(texturePath(artDir, n)));
  const COB = rd('street'), GRS = rd('grass'), DRT = rd('dirt'), PLZ = rd('plaza'), MOSS = rd('moss');
  // 細かい苔の texture を草地の暗い色へ寄せる（平均・分散の移し替え）
  const a = stats(MOSS), b = stats(GRS);
  for (let i = 0; i < MOSS.width * MOSS.height; i++) for (let c = 0; c < 3; c++) {
    MOSS.data[i * 4 + c] = Math.max(0, Math.min(255, (MOSS.data[i * 4 + c] - a.m[c]) / a.s[c] * b.s[c] * 1.1 + b.m[c] * 1.3));
  }
  const grass = prepareGrass(GRS);
  const opt = (n) => { const f = path.join(artDir, 'ground', `${n}.png`); try { return fs.existsSync(f) ? decodePNG(fs.readFileSync(f)) : null; } catch { return null; } };
  const WAT = opt('water'), QUAY = opt('quay'), WALL = opt('wall');
  const t = {
    COB, GRS, DRT, PLZ, MOSS, GBASE: grass.base, sprites: grass.sprites, WAT, QUAY, WALL, WMEAN: WAT ? stats(WAT).m : null,
    segC: segmentSeparated(COB, 4), segP: segment(PLZ, 0),
    CMEAN: stats(COB).m, PMEAN: stats(PLZ).m, DMEAN: stats(DRT).m,
    GLUM: b.m[0] * 0.299 + b.m[1] * 0.587 + b.m[2] * 0.114,
  };
  texCache.set(artDir, t);
  return t;
}

// blue-noise（Bridson の Poisson-disc）
function poisson(W, H, r, rnd) {
  const cs = r / Math.SQRT2, gw = Math.ceil(W / cs), gh = Math.ceil(H / cs), grid = new Int32Array(gw * gh).fill(-1);
  const px = [], py = [], active = [], r2 = r * r;
  const add = (x, y) => { const k = px.length; px.push(x); py.push(y); active.push(k); grid[((y / cs) | 0) * gw + ((x / cs) | 0)] = k; };
  add(rnd() * W, rnd() * H);
  while (active.length) {
    const ai = (rnd() * active.length) | 0, k = active[ai];
    let found = false;
    for (let t = 0; t < 14 && !found; t++) {
      const ang = rnd() * 2 * Math.PI, rad = r * (1 + rnd());
      const x = px[k] + Math.cos(ang) * rad, y = py[k] + Math.sin(ang) * rad;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const gx = (x / cs) | 0, gy = (y / cs) | 0;
      let ok = true;
      for (let j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2) && ok; j++) {
        for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
          const q = grid[j * gw + i];
          if (q >= 0) { const dx = px[q] - x, dy = py[q] - y; if (dx * dx + dy * dy < r2) { ok = false; break; } }
        }
      }
      if (ok) { add(x, y); found = true; }
    }
    if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  return { px, py };
}

// ---------------------------------------------------------------- 本体
export function renderGround(town, artDir = DEFAULT_ART) {
  const X = loadTextures(artDir);
  const { COB, GRS, DRT, PLZ, MOSS, GBASE, segC, segP, CMEAN, PMEAN, DMEAN, GLUM, WAT, QUAY, WALL } = X;
  const cols = town.cols, rows = town.rows, W = cols * T, H = rows * T, N = W * H;
  const SEED = hashStr(`${town.repo?.name ?? ''}\n${town.ground.join('\n')}`) & 0xffffff;
  const rng = makeRng(SEED ^ 0x5bd1e995);

  // ---- tile の表
  const tc = new Uint8Array(cols * rows), footT = new Int32Array(cols * rows).fill(-1);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) tc[y * cols + x] = TILE_OF[town.ground[y]?.[x]] ?? TO;
  (town.buildings || []).forEach((b, k) => {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < cols && y < rows) footT[y * cols + x] = k;
  });
  const cx_ = (x) => (x < 0 ? 0 : x >= cols ? cols - 1 : x), cy_ = (y) => (y < 0 ? 0 : y >= rows ? rows - 1 : y);
  const tcl = (x, y) => tc[cy_(y) * cols + cx_(x)];
  const footAt = (x, y) => footT[cy_(y) * cols + cx_(x)] >= 0;
  // 通りの向き: 縦に長く続く通り（南北の大通り）は石の列も縦に揃える
  const orient = new Uint8Array(cols * rows), runAlong = new Int32Array(cols * rows);
  const crossStart = new Int32Array(cols * rows), crossLen = new Int32Array(cols * rows);
  {
    const hl = new Int32Array(cols * rows), vl = new Int32Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols;) {
      if (tc[y * cols + x] !== TS) { x++; continue; }
      let e = x; while (e < cols && tc[y * cols + e] === TS) e++;
      for (let k = x; k < e; k++) hl[y * cols + k] = e - x;
      x = e;
    }
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows;) {
      if (tc[y * cols + x] !== TS) { y++; continue; }
      let e = y; while (e < rows && tc[e * cols + x] === TS) e++;
      for (let k = y; k < e; k++) vl[k * cols + x] = e - y;
      y = e;
    }
    for (let i = 0; i < cols * rows; i++) if (tc[i] === TS) { orient[i] = vl[i] > hl[i] ? 1 : 0; runAlong[i] = orient[i] ? vl[i] : hl[i]; }
    // 轍のための横断方向の範囲（同じ向きの通り tile が続く範囲）
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows;) {
      const i = y * cols + x;
      if (tc[i] !== TS || orient[i] !== 0) { y++; continue; }
      let e = y; while (e < rows && tc[e * cols + x] === TS && orient[e * cols + x] === 0) e++;
      for (let k = y; k < e; k++) { crossStart[k * cols + x] = y * T; crossLen[k * cols + x] = (e - y) * T; }
      y = e;
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols;) {
      const i = y * cols + x;
      if (tc[i] !== TS || orient[i] !== 1) { x++; continue; }
      let e = x; while (e < cols && tc[y * cols + e] === TS && orient[y * cols + e] === 1) e++;
      for (let k = x; k < e; k++) { crossStart[y * cols + k] = x * T; crossLen[y * cols + k] = (e - x) * T; }
      x = e;
    }
  }
  // 周り8 tile のうち条件に合うもの（N S W E NW NE SW SE の bit）
  const nmask = (tx, ty, pred) =>
    (pred(tx, ty - 1) ? 1 : 0) | (pred(tx, ty + 1) ? 2 : 0) | (pred(tx - 1, ty) ? 4 : 0) | (pred(tx + 1, ty) ? 8 : 0) |
    (pred(tx - 1, ty - 1) ? 16 : 0) | (pred(tx + 1, ty - 1) ? 32 : 0) | (pred(tx - 1, ty + 1) ? 64 : 0) | (pred(tx + 1, ty + 1) ? 128 : 0);
  const kerbable = (x, y) => { const t = tcl(x, y); return (t === TG || t === TO || t === TW) && !footAt(x, y); };
  const notPlaza = (x, y) => tcl(x, y) !== TP;
  const isDirt = (x, y) => tcl(x, y) === TD;
  const isStreet = (x, y) => tcl(x, y) === TS && !footAt(x, y);
  const isWater = (x, y) => tcl(x, y) === TW;
  const kerbM = new Uint8Array(cols * rows), plazaM = new Uint8Array(cols * rows), dirtM = new Uint8Array(cols * rows);
  const streetM = new Uint8Array(cols * rows), waterM = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (tc[i] === TS) kerbM[i] = nmask(x, y, kerbable);
    if (tc[i] === TP) plazaM[i] = nmask(x, y, notPlaza);
    dirtM[i] = nmask(x, y, isDirt); streetM[i] = nmask(x, y, isStreet); waterM[i] = nmask(x, y, isWater);
  }
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

  // ---- tile の所属をぼかした場（2px 格子）
  const tileAtPx = (px, py) => tc[Math.min(rows - 1, (py / T) | 0) * cols + Math.min(cols - 1, (px / T) | 0)];
  const memb = (pred, radii) => { const F = lattice(W, H, 2, (px, py) => (pred(tileAtPx(px, py)) ? 1 : 0)); for (const r of radii) boxBlur(F, r); return F; };
  const Sm = memb((t) => t === TS, [2, 2]);
  const Dsm = memb((t) => t === TD, [2, 2]);
  const Gm = memb((t) => t === TG || t === TO, [3, 3, 2]);
  const Dm = memb((t) => t === TD, [3, 3, 2]);
  const Wm = memb((t) => t === TW, [3, 3, 2]);
  // 低周波のノイズ場
  const GRIME = lattice(W, H, 4, (x, y) => fbm(x / 46, y / 46, SEED + 51));
  const MOSSY = lattice(W, H, 4, (x, y) => fbm(x / 30, y / 30, SEED + 61));
  const DTONE = lattice(W, H, 4, (x, y) => fbm(x / 20, y / 20, SEED + 71));
  const STAIN = lattice(W, H, 2, (x, y) => fbm(x / 14, y / 14, SEED + 97));
  const JMOSS = lattice(W, H, 4, (x, y) => fbm(x / 36, y / 36, SEED + 98));
  const LUSH = lattice(W, H, 4, (x, y) => fbm(x / 70, y / 70, SEED + 23));
  const RUTF = lattice(W, H, 4, (x, y) => fbm(x / 90, y / 90, SEED + 131, 2));
  const EDGEM = lattice(W, H, 2, (x, y) => fbm(x / 5, y / 5, SEED + 91));

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
  // 1 そのまま, 0 向き違い（継ぎ目）, 2 側溝（縁石の帯・草地に重心）, 3 土に呑まれた, 4 ばらけた石
  const cobIn = (v) => {
    const ctx = Math.floor(SX / T), cty = Math.floor(SY / T);
    const ti = cy_(cty) * cols + cx_(ctx), t = tc[ti];
    if (t === TS) {
      if (footT[ti] >= 0) return 1;
      if (orient[ti] !== v) return 0;
      const km = kerbM[ti];
      if (km) { edge(km, SX - ctx * T, SY - cty * T); if (ED < KW - 0.5) return 2; }
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
      if (t === TD || t === TW || nearDirt || nearWater) cls[i] = soft(x, y);
      else cls[i] = GRASS;
      if (t === TO) flg[i] |= F_OUT;
    }
  }

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

  // ---- 2. 距離
  const softSrc = new Uint8Array(N), grassSrc = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (flg[i] & F_FOOT) continue;
    const c = cls[i];
    if (c === GRASS || c === DIRT || c === WATER) softSrc[i] = c + 1;
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

  // ---- 水たまり（通りの轍・路地にいくつか）
  const pud = new Uint8Array(N);       // 1 濡れた縁, 2 水, 3 水面のかすかな光
  {
    const cand = [];
    let paved = 0;
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const ti = ty * cols + tx;
      if (footT[ti] >= 0 || footAt(tx, ty - 1)) continue;
      if (tc[ti] === TS) { paved++; cand.push([tx, ty, runAlong[ti] >= 10 ? 2 : 1]); }
      else if (tc[ti] === TD) { paved++; cand.push([tx, ty, 1]); }
    }
    const want = Math.max(2, Math.min(16, Math.round(paved / 110)));
    const got = [];
    for (let tries = 0; tries < 4000 && got.length < want && cand.length; tries++) {
      const [tx, ty, wgt] = cand[(rng() * cand.length) | 0];
      if (wgt < 2 && rng() < 0.5) continue;
      if (got.some(([a, b]) => Math.hypot(a - tx, b - ty) < 9)) continue;
      // 轍の上を探す
      let px = tx * T + 2 + rng() * 12, py = ty * T + 2 + rng() * 12;
      for (let k = 0; k < 24; k++) {
        const qx = tx * T + 2 + ((rng() * 12) | 0), qy = ty * T + 2 + ((rng() * 12) | 0);
        if (rut[qy * W + qx] > 120) { px = qx; py = qy; break; }
      }
      const pc = cls[(py | 0) * W + (px | 0)];
      if (pc !== COBBLE && pc !== DIRT) continue;
      got.push([tx, ty]);
      const rx = 4 + rng() * 4.5, ry = 2.2 + rng() * 2, ps = SEED + 300 + got.length;
      const inside = (x, y) => { const dx = (x + 0.5 - px) / rx, dy = (y + 0.5 - py) / ry; return dx * dx + dy * dy + 0.55 * (vnoise(x / 2.5, y / 2.5, ps) - 0.5) < 1; };
      for (let y = Math.floor(py - ry - 3); y <= py + ry + 3; y++) for (let x = Math.floor(px - rx - 3); x <= px + rx + 3; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const i = y * W + x, c = cls[i];
        if ((c !== COBBLE && c !== DIRT) || flg[i] & F_FOOT) continue;
        if (inside(x, y)) pud[i] = !inside(x + 1, y + 1) || !inside(x, y + 1) ? 3 : y === Math.floor(py - ry * 0.35) && Math.abs(x + 0.5 - px + rx * 0.2) < rx * 0.35 ? 4 : 2;
        else if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1) || inside(x - 1, y - 1) || inside(x + 1, y + 1)) pud[i] = 1;
      }
    }
  }

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
        const mossy = samp(MOSSY, x, y) + 0.08 * (hash2(x, y, SEED + 62) - 0.5);
        if (mossy > (f & F_OUT ? 0.55 : 0.6)) {
          const q = (((y + 91) % MH) * MW + ((x + 37) % MW)) * 4;
          r = MD[q] * 0.78; g = MD[q + 1] * 0.78; b = MD[q + 2] * 0.78;
        }
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
      if (edgeN) { const k2 = 0.72 + 0.28 * (1 - Math.min(1, edgeN / 6)); r *= k2; g *= k2; b *= k2; }
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
        } else { r *= 0.8; g *= 0.8; b *= 0.8; }
        if (rw > 0) { const k = 1 + 0.15 * rw; r *= k; g *= k; b *= k; }      // 轍の目地は泥で埋まる
      } else {
        if (m === SLAB) {
          const k = 0.84 + 0.14 * h - (h2 > 0.88 ? 0.1 : 0);
          r = (PMEAN[0] + (r - PMEAN[0]) * 1.08) * k; g = (PMEAN[1] + (g - PMEAN[1]) * 1.08) * k; b = (PMEAN[2] + (b - PMEAN[2]) * 1.08) * k;
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
        if (lit && !shade) { const k = 1 + (m === SLAB ? 0.26 : m === FRAME ? 0.2 : 0.22) * bev; r *= k; g *= k; b *= k; }
        else if (shade && !lit) { const k = 1 - (m === SLAB ? 0.26 : m === FRAME ? 0.22 : 0.24) * bev; r *= k; g *= k; b *= k; }
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

  // ---- 4b. 岸壁: 石畳の通りのすぐ下の水の行に quay.png を重ねる（上端を通りの下端にそろえ、横は世界座標で繰り返す）
  if (QUAY) {
    const QW = QUAY.width, QH = QUAY.height, QD = QUAY.data;
    for (let ty = 1; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      if (tc[ty * cols + tx] !== TW || tc[(ty - 1) * cols + tx] !== TS || footT[(ty - 1) * cols + tx] >= 0) continue;
      // 岸の端（隣の列が岸でない）は 3px ずつ丸めて、地面へなじませる
      const endL = !(tx > 0 && tc[ty * cols + tx - 1] === TW && tc[(ty - 1) * cols + tx - 1] === TS);
      const endR = !(tx < cols - 1 && tc[ty * cols + tx + 1] === TW && tc[(ty - 1) * cols + tx + 1] === TS);
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

  // ---- 4c. 段（town.terraces / town.stairs）: 一段高い面の南の行（y+h）は石垣の前面、両端に柱。
  //      前面は 16px: 笠石 5px（光る上の縁・明るい上面・前の面・下の影）と、切り石 2 段（1 個ずつ、左上が明るく右下が暗い）、足もとの影。
  //      階段の列は石段 4 段（踏み面・段鼻・蹴上げ）と両脇の袖柱。東西の縁は笠石の縁石で、東の低い地面へ影を落とす。
  //      石の地の色と粒は wall.png（無ければ広場の石）。どの地面の文字の上でも描く（歩けるかどうかは web/world.js）。
  if ((town.terraces || []).length) {
    const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const mul = (x, y, k) => { if (!inMap(x, y) || flg[y * W + x] & F_FOOT) return; const o = (y * W + x) * 4; out[o] *= k; out[o + 1] *= k; out[o + 2] *= k; };
    const put = (x, y, c, k) => { if (!inMap(x, y) || flg[y * W + x] & F_FOOT) return; const o = (y * W + x) * 4; out[o] = c[0] * k; out[o + 1] = c[1] * k; out[o + 2] = c[2] * k; };
    // 石の地の色（平均）と粒（明るさの比、弱め）
    const SRC = WALL ?? PLZ, SM = stats(SRC).m, SL = 0.299 * SM[0] + 0.587 * SM[1] + 0.114 * SM[2];
    const BASE = [PMEAN[0] * 0.8, PMEAN[1] * 0.79, PMEAN[2] * 0.78];         // 石垣の石は広場の石と同じ色の系統（粒は wall.png）
    const grain = (x, y) => {
      const o = ((((y % SRC.height) + SRC.height) % SRC.height) * SRC.width + (((x % SRC.width) + SRC.width) % SRC.width)) * 4;
      return 1 + 0.55 * (lumOf(SRC.data, o) / SL - 1);
    };
    const grimeAt = (x, y) => 1 + 0.16 * (samp(GRIME, x, y) - 0.5);
    const tone = (key) => 0.72 + 0.42 * hash2(key, 7, SEED + 611);            // 石ごとの明るさ
    const warm = (key) => hash2(key, 8, SEED + 612);
    // 1 段の切り石: 世界の x を、長さ 7〜15px の石に区切る（段ごとにずらす）
    const blockAt = (x, course) => {
      x = Math.floor(x);
      const L = 11, sh = course * 37, cell = Math.floor((x + sh) / L);
      const st = (c) => c * L - sh + ((hash2(c, course, SEED + 613) * 8) | 0) - 4;   // 継ぎ目の位置を前後にずらす
      let c = cell; if (x < st(c)) c--; else if (x >= st(c + 1)) c++;
      const a = st(c), b = st(c + 1);
      return { key: c * 7 + course, lx: x - a, len: b - a };
    };
    const STONE = (x, y, key, k) => { const w = warm(key) * 0.5; put(x, y, [BASE[0] * (1 + 0.05 * w), BASE[1], BASE[2] * (1 - 0.08 * w)], k * tone(key) * grain(x, y) * grimeAt(x, y)); };
    const MORTAR = [BASE[0] * 0.26, BASE[1] * 0.245, BASE[2] * 0.23];
    // 前面の 1 画素（ly 0..15）
    const wallPx = (x, y, ly) => {
      if (ly <= 4) {                                                            // 笠石
        const b = blockAt(x * 0.62, 9);
        if (b.lx === 0 && ly <= 3) { put(x, y, MORTAR, 1.2); return; }
        const k = ly === 0 ? 1.42 : ly <= 2 ? 1.22 : ly === 3 ? 0.72 : 0.26;
        STONE(x, y, b.key + 900, k * (b.lx === 1 && ly < 3 ? 1.08 : 1));
        return;
      }
      if (ly === 15) { STONE(x, y, 5, 0.34); return; }                          // 足もとの暗い線
      const course = ly < 10 ? 0 : 1, r = ly - (course ? 10 : 5);              // 段の中の行 0..4
      const b = blockAt(x, course);
      if (r === 4 || b.lx === 0) { put(x, y, MORTAR, grimeAt(x, y)); return; }  // 目地
      let k = 1.0;
      if (r === 0) k = 1.32;                                                    // 上の縁
      else if (r === 3) k = 0.86;                                               // 下の縁
      if (b.lx === 1) k *= 1.18;                                                // 左の縁
      else if (b.lx === b.len - 1) k *= 0.82;                                   // 右の縁
      STONE(x, y, b.key, k * (course ? 0.92 : 1.0));
    };
    // 石段の 1 画素: 石垣から手前へ 8px 張り出す 4 段（6px ごとに 踏み面 3px・段鼻 1px・蹴上げ 2px）。ly は 0..23
    const SD = 24;
    const stairPx = (x, y, ly, sx0, sx1) => {
      const step = (ly / 6) | 0, k6 = ly % 6, b = blockAt((x - sx0) * 0.55 + step * 5, 20 + step);
      if (k6 < 4 && b.lx === 0) { put(x, y, MORTAR, 1.3); return; }
      let k = k6 < 3 ? 1.16 + 0.04 * k6 : k6 === 3 ? 1.4 : k6 === 4 ? 0.5 : 0.32;
      if (x - sx0 < 2 && ly < T) k *= 0.78;                                    // 左の袖柱の影
      if (ly >= T && (x === sx0 || x === sx1 - 1)) k *= 0.6;                   // 張り出した段の両端
      STONE(x, y, b.key + 400, k * (1 - 0.025 * step));
    };
    // 柱: 上に 4px 突き出た笠石、左の面は明るく右の面は暗い
    const post = (px0, w, fy) => {
      const key = px0 * 13 + 3;
      for (let y = fy - 4; y < fy + T; y++) for (let i = 0; i < w; i++) {
        const x = px0 + i, ly = y - fy;
        let k;
        if (ly < 0) k = (ly === -4 ? 1.45 : ly === -1 ? 0.9 : 1.26) * (i === 0 ? 1.06 : i === w - 1 ? 0.84 : 1);
        else if (ly === 0) k = 0.42;
        else if (ly === 15) k = 0.34;
        else { k = i === 0 ? 1.28 : i === w - 1 ? 0.6 : 1.04; if (ly === 7 || ly === 11) k *= 0.5; }
        if ((i === w - 1 && ly < 0) || (i === w - 1 && ly > 0)) k *= 0.85;
        STONE(x, y, key, k);
      }
      for (let y = fy - 3; y < fy + T; y++) mul(px0 + w, y, 0.66);         // 柱の右の影
    };
    const STAIRS = town.stairs || [];
    for (const t of town.terraces) {
      const fy = (t.y + t.h) * T, x0 = t.x * T, x1 = (t.x + t.w) * T;
      // 東西の縁（一段高い面の内側 3px の縁石）と、外の低い地面の影（光は左上から: 東へ落ちる）
      for (let y = t.y * T; y < fy + T; y++) {
        if (y < fy) for (let j = 0; j < 3; j++) {
          const bw = blockAt(y * 0.8, 30), be = blockAt(y * 0.8, 31);
          if (bw.lx === 0) put(x0 + j, y, MORTAR, 1.3); else STONE(x0 + j, y, bw.key + 700, [1.36, 1.2, 1.0][j]);
          if (be.lx === 0) put(x1 - 1 - j, y, MORTAR, 1.3); else STONE(x1 - 1 - j, y, be.key + 800, [0.62, 0.95, 1.15][j]);
        }
        mul(x0 - 1, y, 0.82);
        for (let d = 0; d < 4; d++) mul(x1 + d, y, [0.56, 0.66, 0.78, 0.9][d]);
      }
      // 前面の行
      const stairsHere = STAIRS.filter((s) => s.y === t.y + t.h && s.x < t.x + t.w && s.x + s.w > t.x);
      for (let x = x0; x < x1; x++) {
        const s = stairsHere.find((q) => x >= q.x * T && x < (q.x + q.w) * T);
        for (let ly = 0; ly < (s ? SD : T); ly++) {
          const y = fy + ly;
          if (!inMap(x, y)) continue;
          if (s) stairPx(x, y, ly, s.x * T, (s.x + s.w) * T); else wallPx(x, y, ly);
        }
        // 足もとの影（低い地面）
        const fb = fy + (s ? SD : T);
        mul(x, fb, 0.55); mul(x, fb + 1, 0.72); mul(x, fb + 2, 0.88);
      }
      for (let x = x1; x < x1 + 3; x++) { mul(x, fy + T, 0.55); mul(x, fy + T + 1, 0.72); mul(x, fy + T + 2, 0.88); }
      // 張り出した石段の右の影
      for (const s of stairsHere) for (let y = fy + T; y < fy + SD + 2; y++) { mul((s.x + s.w) * T, y, 0.6); mul((s.x + s.w) * T + 1, y, 0.8); }
      // 柱: 前面の両端と、階段の両脇
      post(x0, 5, fy);
      post(x1 - 5, 5, fy);
      for (const s of stairsHere) {
        const sx0 = s.x * T, sx1 = (s.x + s.w) * T;
        if (sx0 - 5 >= x0) post(sx0 - 5, 5, fy);
        if (sx1 + 5 <= x1) post(sx1, 5, fy);
      }
    }
  }

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
    else if (c6 === SLAB || c6 === FRAME) { r = r * 1.21; g = g * 1.12 + 1 * cool; b = b * 0.95 + 7 * cool; }   // 広場は texture がもともと明るい暖色
    else { r = r * 1.3; g = g * 1.18 + 1 * cool; b = b * 0.9 + 7 * cool; }
    const dEdge = Math.min(x + 0.5, y + 0.5, W - x - 0.5, H - y - 0.5);
    let k = 0.3 + 0.7 * smooth(0, 44, dEdge);
    if (flg[i] & F_OUT || tc[((y / T) | 0) * cols + ((x / T) | 0)] === TO) {
      const dOut = Math.max(0, samp(outF, x, y) - 6);
      k = Math.min(k, 1 - 0.86 * smooth(0, 1, dOut / (dOut + dEdge + 1)));
    }
    out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k;
  }
  return { width: W, height: H, data: out };
}

// ---------------------------------------------------------------- キャッシュ
function textureDigest(artDir) {
  const h = crypto.createHash('sha1');
  for (const n of TEX_NAMES) h.update(fs.readFileSync(texturePath(artDir, n)));
  for (const n of OPT_TEX) { const f = path.join(artDir, 'ground', `${n}.png`); if (fs.existsSync(f)) h.update(n).update(fs.readFileSync(f)); }
  return h.digest('hex');
}
export function groundCacheFile(town, { artDir = DEFAULT_ART, cacheDir = path.join(os.tmpdir(), 'codecity-cache') } = {}) {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify({
    v: GROUND_VERSION, tex: textureDigest(artDir), cols: town.cols, rows: town.rows, ground: town.ground,
    b: (town.buildings || []).map((b) => [b.x, b.y, b.w, b.h]),
    t: town.terraces || [], s: town.stairs || [],
  }));
  const safe = (s) => String(s ?? 'repo').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
  return path.join(cacheDir, `${safe(town.repo?.name)}-${safe(town.repo?.head ?? 'worktree')}-${h.digest('hex').slice(0, 12)}.png`);
}
export function groundPNG(town, opts = {}) {
  const artDir = opts.artDir ?? DEFAULT_ART;
  const file = groundCacheFile(town, { ...opts, artDir });
  if (!opts.noCache) {
    try { return { buffer: fs.readFileSync(file), file, cached: true, ms: 0 }; } catch { /* まだ無い */ }
  }
  const t0 = performance.now();
  const buffer = encodePNG(renderGround(town, artDir), { level: 6 });
  const ms = Math.round(performance.now() - t0);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, file);
  } catch (e) { console.warn(`地面のキャッシュを書けなかった: ${e.message}`); }
  return { buffer, file, cached: false, ms };
}
