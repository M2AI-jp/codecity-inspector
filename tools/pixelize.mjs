#!/usr/bin/env node
// Turn AI "pseudo pixel art" (blurry, unaligned art-pixel blocks) into exact native-resolution sprites.
// See README.md for usage. Exported: pixelize(img, opts) -> { image, report }.
import { readPNG, writePNG, createImage } from './png.mjs';
import { fileURLToPath } from 'node:url';

// ---------- colour helpers ----------
const LIN = Float64Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
export function oklab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => { c = Math.min(1, Math.max(0, c)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); });
}
const hexRgb = (s) => { const v = parseInt(String(s).replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

// Spill of the key colour: how much the key's dominant channels exceed the others (0 = none).
function makeSpill(key) {
  const dom = [0, 1, 2].filter((c) => key[c] >= 128), oth = [0, 1, 2].filter((c) => key[c] < 128);
  if (!dom.length || !oth.length) return { spill: () => 0, dom };
  return { dom, spill: (r, g, b) => { const p = [r, g, b]; return Math.min(...dom.map((c) => p[c])) - Math.max(...oth.map((c) => p[c])); } };
}

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Weighted k-means in Oklab. pts: array of [L,a,b]; w: weights; fixed: centroids that never move.
export function kmeans(pts, w, k, { fixed = [], iters = 24, seed = 7 } = {}) {
  const n = pts.length;
  k = Math.min(k, n + fixed.length);
  const C = fixed.map((c) => [...c]);
  const rand = rng(seed);
  const dist = new Float64Array(n).fill(Infinity);
  const upd = (c) => { for (let i = 0; i < n; i++) dist[i] = Math.min(dist[i], d2(pts[i], c)); };
  C.forEach(upd);
  if (!C.length) { let tot = 0; for (let i = 0; i < n; i++) tot += w[i]; let t = rand() * tot, i = 0; for (; i < n - 1 && (t -= w[i]) > 0; i++); C.push([...pts[i]]); upd(C[0]); }
  while (C.length < k) { // k-means++
    let tot = 0; for (let i = 0; i < n; i++) tot += w[i] * dist[i];
    if (tot <= 0) break;
    let t = rand() * tot, i = 0; for (; i < n - 1 && (t -= w[i] * dist[i]) > 0; i++);
    C.push([...pts[i]]); upd(C[C.length - 1]);
  }
  const asg = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < C.length; j++) { const dd = d2(pts[i], C[j]); if (dd < bd) { bd = dd; best = j; } }
      if (asg[i] !== best) moved++;
      asg[i] = best;
      const a = acc[best]; a[0] += pts[i][0] * w[i]; a[1] += pts[i][1] * w[i]; a[2] += pts[i][2] * w[i]; a[3] += w[i];
    }
    for (let j = fixed.length; j < C.length; j++) if (acc[j][3] > 0) C[j] = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]];
    if (it > 0 && moved === 0) break;
  }
  return { centroids: C, assign: asg };
}
const nearest = (C, p) => { let best = 0, bd = Infinity; for (let j = 0; j < C.length; j++) { const dd = d2(p, C[j]); if (dd < bd) { bd = dd; best = j; } } return best; };

// Connected components (8-conn) over a boolean mask restricted to a rectangle. Returns label array + sizes.
function components(mask, W, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0, lab = new Int32Array(w * h).fill(-1), sizes = [], stack = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (lab[y * w + x] !== -1 || !mask[(y + y0) * W + x + x0]) continue;
    const id = sizes.length; let n = 0;
    stack.push(y * w + x); lab[y * w + x] = id;
    while (stack.length) {
      const p = stack.pop(), px = p % w, py = (p / w) | 0; n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx, qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = qy * w + qx;
        if (lab[q] === -1 && mask[(qy + y0) * W + qx + x0]) { lab[q] = id; stack.push(q); }
      }
    }
    sizes.push(n);
  }
  return { lab, sizes, w, h };
}

// ---------- stage 1: background removal / despill ----------
function removeBackground(img, { key, tol, despill }) {
  const { width: W, height: H } = img, d = new Uint8ClampedArray(img.data), N = W * H;
  let transparent = 0;
  for (let i = 0; i < N; i++) if (d[i * 4 + 3] < 128) transparent++;
  const usedAlpha = transparent / N > 0.005;
  const { spill } = makeSpill(key);
  let keyed = 0, killed = 0, despilled = 0;
  if (!usedAlpha) {
    for (let i = 0; i < N; i++) {
      const o = i * 4, dist = Math.hypot(d[o] - key[0], d[o + 1] - key[1], d[o + 2] - key[2]);
      if (dist < tol) { d[o + 3] = 0; keyed++; } else d[o + 3] = 255;
    }
  }
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  if (despill) {
    // distance (in px, up to R) to the nearest transparent pixel, via two-pass chamfer
    const R = 3, dist = new Uint8Array(N).fill(R + 1);
    for (let i = 0; i < N; i++) if (!mask[i]) dist[i] = 0;
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < N; k++) {
      const i = pass ? N - 1 - k : k, x = i % W, y = (i / W) | 0; if (!dist[i]) continue;
      const s = pass ? 1 : -1;
      let m = dist[i];
      if (x + s >= 0 && x + s < W) m = Math.min(m, dist[i + s] + 1);
      if (y + s >= 0 && y + s < H) m = Math.min(m, dist[i + s * W] + 1);
      dist[i] = m;
    }
    for (let i = 0; i < N; i++) {
      if (!mask[i] || dist[i] > R) continue;
      const o = i * 4, sp = spill(d[o], d[o + 1], d[o + 2]);
      if (sp <= 0) continue;
      if (sp > 70 && dist[i] <= 2) { mask[i] = 0; d[o + 3] = 0; killed++; continue; } // magenta fringe: kill outright
      for (let c = 0; c < 3; c++) if (key[c] >= 128) d[o + c] -= sp; // neutralise tint
      despilled++;
    }
  }
  return { img: { width: W, height: H, data: d }, mask, usedAlpha, keyed, killed, despilled };
}

// ---------- stage 2: working palette (fine colours grouped into coarse vote classes) ----------
function buildPalette(img, mask, fineK, groupK) {
  const { width: W, height: H, data } = img, N = W * H;
  let count = 0; for (let i = 0; i < N; i++) count += mask[i];
  const stride = Math.max(1, Math.floor(count / 60000));
  const pts = [], w = [];
  for (let i = 0, c = 0; i < N; i++) if (mask[i] && c++ % stride === 0) { pts.push(oklab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])); w.push(1); }
  const fine = kmeans(pts, w, fineK).centroids;
  // group fine colours into coarse classes for robust majority voting
  const fw = new Float64Array(fine.length); for (let i = 0; i < pts.length; i++) fw[nearest(fine, pts[i])]++;
  const grp = kmeans(fine, fw, Math.min(groupK, fine.length), { seed: 11 });
  const cls = new Int16Array(N).fill(-1), cache = new Map();
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], key = (r << 16) | (g << 8) | b;
    let id = cache.get(key);
    if (id === undefined) { id = nearest(fine, oklab(r, g, b)); cache.set(key, id); }
    cls[i] = id;
  }
  const darkest = fine.reduce((bi, c, i) => (c[0] < fine[bi][0] ? i : bi), 0);
  return { fine, group: grp.assign, groupCount: grp.centroids.length, cls, darkGroup: grp.assign[darkest], groupL: grp.centroids.map((c) => c[0]) };
}

// ---------- stage 3: block-majority sampling ----------
// Samples output pixels (i,j) whose source footprint is [ox+i*sx, ox+(i+1)*sx) x [oy+j*sy, ...), clipped to clip rect.
function sampleBlock(src, pal, { ox, oy, sx, sy, ow, oh, clip, wrap, darkBoost, scoreOnly }) {
  const { width: W } = src, cls = pal.cls, G = pal.groupCount;
  const out = scoreOnly ? null : new Int16Array(ow * oh).fill(-1);
  const darkShare = scoreOnly ? null : new Float32Array(ow * oh), darkFine = scoreOnly ? null : new Int16Array(ow * oh).fill(-1);
  const gv = new Float64Array(G), fv = new Float64Array(pal.fine.length);
  let score = 0;
  for (let j = 0; j < oh; j++) {
    const fy0 = oy + j * sy, fy1 = fy0 + sy;
    const py0 = Math.ceil(fy0 - 0.5), py1 = Math.ceil(fy1 - 0.5); // pixel centres inside [fy0, fy1)
    for (let i = 0; i < ow; i++) {
      const fx0 = ox + i * sx, fx1 = fx0 + sx;
      const px0 = Math.ceil(fx0 - 0.5), px1 = Math.ceil(fx1 - 0.5);
      gv.fill(0); if (!scoreOnly) fv.fill(0);
      let tot = 0, opq = 0;
      for (let py = py0; py < py1; py++) {
        const v = (py + 0.5 - fy0) / sy, wy = 1 - 0.6 * Math.abs(2 * v - 1);
        let yy = py;
        if (wrap) yy = ((py - clip[1]) % (clip[3] - clip[1]) + (clip[3] - clip[1])) % (clip[3] - clip[1]) + clip[1];
        for (let px = px0; px < px1; px++) {
          const u = (px + 0.5 - fx0) / sx, wgt = wy * (1 - 0.6 * Math.abs(2 * u - 1));
          tot += wgt;
          let xx = px;
          if (wrap) xx = ((px - clip[0]) % (clip[2] - clip[0]) + (clip[2] - clip[0])) % (clip[2] - clip[0]) + clip[0];
          if (xx < clip[0] || yy < clip[1] || xx >= clip[2] || yy >= clip[3]) continue;
          const c = cls[yy * W + xx];
          if (c < 0) continue;
          opq += wgt;
          const g = pal.group[c];
          gv[g] += g === pal.darkGroup ? wgt * darkBoost : wgt;
          if (!scoreOnly) fv[c] += wgt;
        }
      }
      if (tot === 0) continue;
      const cov = opq / tot;
      let bg = 0, bs = 0, gsum = 0;
      for (let g = 0; g < G; g++) { gsum += gv[g]; if (gv[g] > bs) { bs = gv[g]; bg = g; } }
      score += Math.min(cov, 1 - cov) + (opq > 0 ? cov * (1 - bs / gsum) : 0);
      if (scoreOnly || cov <= 0.5) continue;
      let bf = -1, bfs = 0, df = -1, dfs = 0;
      for (let f = 0; f < fv.length; f++) {
        if (pal.group[f] === bg && fv[f] > bfs) { bfs = fv[f]; bf = f; }
        if (pal.group[f] === pal.darkGroup && fv[f] > dfs) { dfs = fv[f]; df = f; }
      }
      out[j * ow + i] = bf;
      darkShare[j * ow + i] = dfs / opq; darkFine[j * ow + i] = df;
    }
  }
  return { out, score, darkShare, darkFine };
}

// Remove tiny opaque islands (<= maxSize px, 8-conn) from an index image.
function despeckle(idx, w, h, maxSize) {
  const mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = idx[i] >= 0 ? 1 : 0;
  const { lab, sizes } = components(mask, w, 0, 0, w, h);
  let removed = 0;
  for (let i = 0; i < w * h; i++) if (lab[i] >= 0 && sizes[lab[i]] <= maxSize) { idx[i] = -1; removed++; }
  return removed;
}

function smoothIsolated(img, cw, ch, maxDelta) {
  const { width: W, height: H, data: D } = img, src = new Uint8ClampedArray(D);
  const col = (x, y) => { const i = (y * W + x) * 4; return src[i + 3] ? (src[i] << 16) | (src[i + 1] << 8) | src[i + 2] : -1; };
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = col(x, y); if (c < 0) continue;
    const cx0 = Math.floor(x / cw) * cw, cy0 = Math.floor(y / ch) * ch, counts = new Map();
    let same = 0, opaque = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const X = x + dx, Y = y + dy;
      if (X < cx0 || Y < cy0 || X >= cx0 + cw || Y >= cy0 + ch) continue;
      const q = col(X, Y); if (q < 0) continue;
      opaque++; if (q === c) same++;
      counts.set(q, (counts.get(q) || 0) + 1);
    }
    if (same || opaque < 7) continue; // keep silhouette pixels and anything with company
    let m = -1, mc = 0; for (const [q, k] of counts) if (k > mc) { mc = k; m = q; }
    if (mc < 3) continue;
    const a = oklab(c >> 16, (c >> 8) & 255, c & 255), b = oklab(m >> 16, (m >> 8) & 255, m & 255);
    if (Math.sqrt(d2(a, b)) > maxDelta) continue; // high-contrast singles (eyes, buttons) are detail, keep
    const i = (y * W + x) * 4; D[i] = m >> 16; D[i + 1] = (m >> 8) & 255; D[i + 2] = m & 255; n++;
  }
  return n;
}

// ---------- tileable: min-error cut quilting of the wrap seam (no ghosting, crops the overlap) ----------
function seamlessAxis(img, frac, vertical) {
  const { width: W, height: H, data } = img;
  const L = vertical ? H : W, M = vertical ? W : H, ov = Math.max(4, Math.round(L * frac));
  const at = (u, v) => (vertical ? (u * W + v) : (v * W + u)) * 4; // u along the axis, v across
  const err = new Float64Array(M * ov);
  for (let v = 0; v < M; v++) for (let u = 0; u < ov; u++) {
    const a = at(u, v), b = at(L - ov + u, v);
    err[v * ov + u] = (data[a] - data[b]) ** 2 + (data[a + 1] - data[b + 1]) ** 2 + (data[a + 2] - data[b + 2]) ** 2;
  }
  // DP for a cut path c(v) in [1, ov-1], |c(v)-c(v-1)| <= 1
  const cost = new Float64Array(M * ov).fill(Infinity), from = new Int8Array(M * ov);
  for (let u = 1; u < ov; u++) cost[u] = err[u];
  for (let v = 1; v < M; v++) for (let u = 1; u < ov; u++) {
    let best = Infinity, bd = 0;
    for (let dd = -1; dd <= 1; dd++) { const p = u + dd; if (p >= 1 && p < ov && cost[(v - 1) * ov + p] < best) { best = cost[(v - 1) * ov + p]; bd = dd; } }
    cost[v * ov + u] = best + err[v * ov + u]; from[v * ov + u] = bd;
  }
  const cut = new Int32Array(M);
  let u = 1; for (let k = 2; k < ov; k++) if (cost[(M - 1) * ov + k] < cost[(M - 1) * ov + u]) u = k;
  for (let v = M - 1; v >= 0; v--) { cut[v] = u; u += from[v * ov + u]; }
  const NL = L - ov, out = createImage(vertical ? W : NL, vertical ? NL : H);
  for (let v = 0; v < M; v++) for (let uu = 0; uu < NL; uu++) {
    const su = uu < cut[v] ? L - ov + uu : uu, s = at(su, v);
    const d = (vertical ? uu * W + v : v * NL + uu) * 4;
    for (let c = 0; c < 4; c++) out.data[d + c] = data[s + c];
  }
  return out;
}

// Remove a linear lighting ramp (least-squares plane per channel): a ramp can never wrap, whatever the cut.
function detrend(img) {
  const { width: W, height: H, data } = img, out = createImage(W, H), cx = (W - 1) / 2, cy = (H - 1) / 2;
  let sxx = 0, syy = 0; for (let x = 0; x < W; x++) sxx += (x - cx) ** 2; for (let y = 0; y < H; y++) syy += (y - cy) ** 2;
  sxx *= H; syy *= W;
  for (let c = 0; c < 3; c++) {
    let bx = 0, by = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = data[(y * W + x) * 4 + c]; bx += v * (x - cx); by += v * (y - cy); }
    bx /= sxx; by /= syy;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4 + c; out.data[i] = data[i] - bx * (x - cx) - by * (y - cy); }
  }
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = data[i];
  return out;
}

// Wrap-seam quality: mean Oklab delta across the wrap edges / mean delta between interior neighbours (≈1 is seamless).
export function seamRatio(img) {
  const { width: W, height: H, data } = img, lab = (x, y) => { const o = (y * W + x) * 4; return oklab(data[o], data[o + 1], data[o + 2]); };
  let inner = 0, ni = 0, seam = 0, ns = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = lab(x, y), r = lab((x + 1) % W, y), b = lab(x, (y + 1) % H);
    const dr = Math.sqrt(d2(p, r)), db = Math.sqrt(d2(p, b));
    if (x === W - 1) { seam += dr; ns++; } else { inner += dr; ni++; }
    if (y === H - 1) { seam += db; ns++; } else { inner += db; ni++; }
  }
  return (seam / ns) / (inner / ni || 1e-9);
}

// ---------- main ----------
export function pixelize(input, opts = {}) {
  const o = {
    grid: [1, 1], cell: 32, size: null, charHeight: 26, anchor: 'bottom-center', key: [255, 0, 255], tol: 120,
    colors: 0, fit: 'contain', tileable: false, despill: true, fineColors: 64, voteGroups: 16, darkBoost: 1.35,
    phases: 6, centerBy: null, despeckle: 2, outlineShare: 0.25, smooth: 0.09, ...opts,
  };
  const [cols, rows] = o.grid;
  const report = { input: `${input.width}x${input.height}` };
  const sheet1 = cols === 1 && rows === 1 && o.size;
  const cellW = sheet1 ? o.size[0] : o.cell, cellH = sheet1 ? o.size[1] : o.cell;
  const centerBy = o.centerBy ?? (sheet1 ? 'bbox' : 'centroid');
  const stretch = o.fit === 'stretch';

  let src = input;
  if (stretch && o.tileable) {
    src = seamlessAxis(seamlessAxis(detrend(src), 0.125, false), 0.125, true);
    report.seamlessSource = `${src.width}x${src.height} (seam ratio ${seamRatio(src).toFixed(2)})`;
  }
  // stage 1
  const bgr = stretch ? { img: src, mask: new Uint8Array(src.width * src.height).fill(1), usedAlpha: false, keyed: 0, killed: 0, despilled: 0 }
    : removeBackground(src, o);
  if (stretch) for (let i = 0; i < src.width * src.height; i++) bgr.img.data[i * 4 + 3] = 255;
  report.background = stretch ? 'none (full-bleed)' : bgr.usedAlpha ? 'existing alpha' : `chroma key #${o.key.map((c) => c.toString(16).padStart(2, '0')).join('')} tol ${o.tol}`;
  Object.assign(report, { keyedPx: bgr.keyed, fringeKilledPx: bgr.killed, despilledPx: bgr.despilled });
  const { img, mask } = bgr, W = img.width, H = img.height;

  // stage 2: cells + figure boxes (ignore specks smaller than 0.2% of the cell's main figure)
  const scw = W / cols, sch = H / rows, frames = [];
  let speckPx = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = Math.round(c * scw), y0 = Math.round(r * sch), x1 = Math.round((c + 1) * scw), y1 = Math.round((r + 1) * sch);
    const f = { r, c, clip: [x0, y0, x1, y1], empty: true };
    if (stretch) { Object.assign(f, { bx0: x0, by0: y0, bx1: x1 - 1, by1: y1 - 1, empty: false }); frames.push(f); continue; }
    const { lab, sizes, w } = components(mask, W, x0, y0, x1, y1);
    const maxS = Math.max(0, ...sizes), keep = sizes.map((s) => s >= Math.max(30, maxS * 0.002));
    let bx0 = Infinity, by0 = Infinity, bx1 = -1, by1 = -1;
    for (let k = 0; k < lab.length; k++) {
      if (lab[k] < 0) continue;
      const x = x0 + (k % w), y = y0 + ((k / w) | 0);
      if (!keep[lab[k]]) { mask[y * W + x] = 0; speckPx++; continue; }
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
    }
    if (bx1 >= 0) Object.assign(f, { bx0, by0, bx1, by1, empty: false });
    frames.push(f);
  }
  report.sourceSpecksRemovedPx = speckPx;
  const live = frames.filter((f) => !f.empty);
  if (!live.length) throw new Error('no opaque figure found');

  const pal = buildPalette(img, mask, o.fineColors, o.voteGroups);

  // stage 3: one uniform scale for the whole sheet
  let sx, sy;
  if (stretch) { sx = (frames[0].clip[2] - frames[0].clip[0]) / cellW; sy = (frames[0].clip[3] - frames[0].clip[1]) / cellH; }
  else if (sheet1) { const f = live[0]; sx = sy = Math.max((f.bx1 - f.bx0 + 1) / cellW, (f.by1 - f.by0 + 1) / cellH); }
  else {
    const hs = live.map((f) => f.by1 - f.by0 + 1).sort((a, b) => a - b);
    const med = hs.length % 2 ? hs[hs.length >> 1] : (hs[hs.length / 2 - 1] + hs[hs.length / 2]) / 2;
    sx = sy = med / o.charHeight;
    report.medianSourceHeight = med;
  }
  report.sourcePxPerOutputPx = +sx.toFixed(3);

  // stage 4: per-frame phase search + majority sampling
  const out = createImage(cols * cellW, rows * cellH);
  const placed = [];
  let outlineFixed = 0;
  for (const f of live) {
    let ow, oh, ox, oy, phases;
    if (stretch) { ow = cellW; oh = cellH; ox = f.clip[0]; oy = f.clip[1]; phases = o.tileable ? o.phases : 1; }
    else {
      ow = Math.ceil((f.bx1 - f.bx0 + 1) / sx) + 3; oh = Math.ceil((f.by1 - f.by0 + 1) / sy) + 2;
      ox = (f.bx0 + f.bx1 + 1) / 2 - (ow * sx) / 2; oy = f.by1 + 1 - (oh - 1) * sy; phases = o.phases;
    }
    const args = { sx, sy, ow, oh, clip: f.clip, wrap: stretch && o.tileable, darkBoost: o.darkBoost };
    let best = { score: Infinity, dx: 0, dy: 0 };
    for (let a = 0; a < phases; a++) for (let b = 0; b < phases; b++) {
      const dx = phases > 1 ? ((a / phases) - 0.5) * sx : 0, dy = phases > 1 ? ((b / phases) - 0.5) * sy : 0;
      const { score } = sampleBlock(img, pal, { ...args, ox: ox + dx, oy: oy + dy, scoreOnly: true });
      if (score < best.score - 1e-9) best = { score, dx, dy };
    }
    const smp = sampleBlock(img, pal, { ...args, ox: ox + best.dx, oy: oy + best.dy }), idx = smp.out;
    if (!stretch && o.despeckle) f.speckles = despeckle(idx, ow, oh, o.despeckle);
    if (!stretch && o.outlineShare > 0) { // silhouette pixels that saw enough outline colour become outline
      const edgeFix = [];
      for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
        const k = j * ow + i; if (idx[k] < 0 || pal.group[idx[k]] === pal.darkGroup || smp.darkShare[k] < o.outlineShare) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = i + dx, Y = j + dy; return X < 0 || Y < 0 || X >= ow || Y >= oh || idx[Y * ow + X] < 0; });
        if (edge) edgeFix.push(k);
      }
      for (const k of edgeFix) idx[k] = smp.darkFine[k];
      outlineFixed += edgeFix.length;
    }
    // anchor
    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) if (idx[j * ow + i] >= 0) { minX = Math.min(minX, i); maxX = Math.max(maxX, i); minY = Math.min(minY, j); maxY = Math.max(maxY, j); }
    if (maxX < 0) continue;
    let tx = 0, ty = 0;
    if (!stretch) {
      let cx = (minX + maxX + 1) / 2;
      if (centerBy === 'centroid') { // centroid of head+torso (top 60%) — limbs swing, the upper body is stable
        const lim = minY + Math.max(1, Math.round((maxY - minY + 1) * 0.6));
        let s = 0, n = 0;
        for (let j = minY; j < lim; j++) for (let i = 0; i < ow; i++) if (idx[j * ow + i] >= 0) { s += i + 0.5; n++; }
        cx = s / n;
      }
      const a = o.anchor;
      tx = a.endsWith('left') ? -minX : Math.round(cellW / 2 - cx);
      ty = a.startsWith('bottom') ? cellH - 1 - maxY : a.startsWith('top') ? -minY : Math.round(cellH / 2 - (minY + maxY + 1) / 2);
      if (maxX - minX + 1 > cellW || maxY - minY + 1 > cellH) report.warning = `figure ${maxX - minX + 1}x${maxY - minY + 1} exceeds cell ${cellW}x${cellH}; clipped`;
    }
    placed.push({ f, h: maxY - minY + 1, w: maxX - minX + 1, phase: [+(best.dx / sx).toFixed(2), +(best.dy / sy).toFixed(2)] });
    for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
      const id = idx[j * ow + i], X = i + tx, Y = j + ty;
      if (id < 0 || X < 0 || Y < 0 || X >= cellW || Y >= cellH) continue;
      const rgb = oklabToRgb(...pal.fine[id]), d = ((f.r * cellH + Y) * out.width + f.c * cellW + X) * 4;
      out.data[d] = rgb[0]; out.data[d + 1] = rgb[1]; out.data[d + 2] = rgb[2]; out.data[d + 3] = 255;
    }
  }
  report.outlineFixedPx = outlineFixed;
  report.frameHeights = placed.map((p) => p.h).join(' ');
  report.frameWidths = placed.map((p) => p.w).join(' ');

  // stage 5: optional sheet-wide palette reduction (keeps the darkest outline colour exact)
  const D = out.data, NO = out.width * out.height;
  if (o.colors > 0) {
    const uniq = new Map();
    for (let i = 0; i < NO; i++) if (D[i * 4 + 3]) { const k = (D[i * 4] << 16) | (D[i * 4 + 1] << 8) | D[i * 4 + 2]; uniq.set(k, (uniq.get(k) || 0) + 1); }
    const keys = [...uniq.keys()], pts = keys.map((k) => oklab(k >> 16, (k >> 8) & 255, k & 255)), w = keys.map((k) => uniq.get(k));
    // outline colour = most frequent colour among the darkest 10% of pixels
    const order = keys.map((_, i) => i).sort((a, b) => pts[a][0] - pts[b][0]);
    const total = w.reduce((s, v) => s + v, 0);
    let acc = 0, dark = order[0];
    for (const i of order) { if (acc > total * 0.1) break; acc += w[i]; if (w[i] > w[dark]) dark = i; }
    const { centroids } = kmeans(pts, w, o.colors, { fixed: [pts[dark]] });
    const rgbC = centroids.map((c, i) => (i === 0 ? [keys[dark] >> 16, (keys[dark] >> 8) & 255, keys[dark] & 255] : oklabToRgb(...c)));
    const map = new Map(keys.map((k, i) => [k, rgbC[nearest(centroids, pts[i])]]));
    for (let i = 0; i < NO; i++) if (D[i * 4 + 3]) { const m = map.get((D[i * 4] << 16) | (D[i * 4 + 1] << 8) | D[i * 4 + 2]); D[i * 4] = m[0]; D[i * 4 + 1] = m[1]; D[i * 4 + 2] = m[2]; }
    report.outlineColour = '#' + keys[dark].toString(16).padStart(6, '0');
  }
  // isolated low-contrast pixels (colour shared with no 8-neighbour, close to the local majority) -> majority
  if (!stretch && o.smooth > 0) report.smoothedPx = smoothIsolated(out, cellW, cellH, o.smooth);
  // final guard: no key-coloured fringe may survive on silhouette edges
  if (!stretch && o.despill) {
    const { spill } = makeSpill(o.key);
    let fr = 0;
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
      const i = (y * out.width + x) * 4; if (!D[i + 3]) continue;
      const sp = spill(D[i], D[i + 1], D[i + 2]);
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X < 0 || Y < 0 || X >= out.width || Y >= out.height || !D[(Y * out.width + X) * 4 + 3]; });
      if (edge && sp > 40) { D[i + 3] = 0; D[i] = D[i + 1] = D[i + 2] = 0; fr++; }
    }
    report.outputFringeRemovedPx = fr;
  }
  const cs = new Set(); for (let i = 0; i < NO; i++) if (D[i * 4 + 3]) cs.add((D[i * 4] << 16) | (D[i * 4 + 1] << 8) | D[i * 4 + 2]);
  report.colours = cs.size;
  report.output = `${out.width}x${out.height}`;
  if (stretch && o.tileable) report.outputSeamRatio = +seamRatio(out).toFixed(2);
  return { image: out, report };
}

// ---------- CLI ----------
function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2), nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) opt[k] = true; else { opt[k] = nxt; i++; }
  }
  return { pos, opt };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  if (pos.length < 2) {
    console.error('usage: node pixelize.mjs in.png out.png --grid CxR --cell 32 [--char-height 26] [--anchor bottom-center|center|top-center|bottom-left|top-left]\n'
      + '       [--key ff00ff] [--tol 120] [--colors N] [--no-despill] [--dark-boost 1.35] [--phases 6]\n'
      + '       node pixelize.mjs in.png out.png --grid 1x1 --size WxH [--fit contain|stretch] [--tileable]');
    process.exit(1);
  }
  const xy = (s) => String(s).toLowerCase().split('x').map(Number);
  const o = {};
  if (opt.grid) o.grid = xy(opt.grid);
  if (opt.cell) o.cell = +opt.cell;
  if (opt.size) o.size = xy(opt.size);
  if (opt['char-height']) o.charHeight = +opt['char-height'];
  if (opt.anchor) o.anchor = opt.anchor;
  if (opt.key) o.key = hexRgb(opt.key);
  if (opt.tol) o.tol = +opt.tol;
  if (opt.colors) o.colors = +opt.colors;
  if (opt.fit) o.fit = opt.fit;
  if (opt.tileable) o.tileable = true;
  if (opt['no-despill']) o.despill = false;
  if (opt['dark-boost']) o.darkBoost = +opt['dark-boost'];
  if (opt.phases) o.phases = +opt.phases;
  if (opt['center-by']) o.centerBy = opt['center-by'];
  if (opt['outline-share'] !== undefined) o.outlineShare = +opt['outline-share'];
  if (opt.smooth !== undefined) o.smooth = +opt.smooth;
  const t0 = Date.now();
  const { image, report } = pixelize(readPNG(pos[0]), o);
  writePNG(pos[1], image);
  console.log(JSON.stringify({ ...report, ms: Date.now() - t0, wrote: pos[1] }, null, 1));
}
