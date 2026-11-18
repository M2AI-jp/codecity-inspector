// cleanup: Keep island removal and low-contrast smoothing separate from sampling.
import { oklab, d2 } from './colour.mjs';
import { components } from './components.mjs';
// Remove tiny opaque islands (<= maxSize px, 8-conn) from an index image.
export function despeckle(idx, w, h, maxSize) {
  const mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = idx[i] >= 0 ? 1 : 0;
  const { lab, sizes } = components(mask, w, 0, 0, w, h);
  let removed = 0;
  for (let i = 0; i < w * h; i++) if (lab[i] >= 0 && sizes[lab[i]] <= maxSize) { idx[i] = -1; removed++; }
  return removed;
}

export function smoothIsolated(img, cw, ch, maxDelta) {
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
