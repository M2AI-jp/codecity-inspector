// seamless: Keep source quilting before sampling and measure wrap edges with the same colour metric.
import { createImage } from '../png.mjs';
import { oklab, d2 } from './colour.mjs';
// ---------- tileable: min-error cut quilting of the wrap seam (no ghosting, crops the overlap) ----------
export function seamlessAxis(img, frac, vertical) {
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
export function detrend(img) {
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

export function prepareSource(input, o, stretch, report) {
  let src = input;
  if (stretch && o.tileable) {
    src = seamlessAxis(seamlessAxis(detrend(src), 0.125, false), 0.125, true);
    report.seamlessSource = `${src.width}x${src.height} (seam ratio ${seamRatio(src).toFixed(2)})`;
  }
  return src;
}
