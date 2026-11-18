// palette: Build fine colours and voting groups once for the whole sheet.
import { oklab } from './colour.mjs';
import { kmeans, nearest } from './kmeans.mjs';
// ---------- stage 2: working palette (fine colours grouped into coarse vote classes) ----------
export function buildPalette(img, mask, fineK, groupK) {
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
