// postprocess: Apply sheet-wide reduction, smoothing and the final fringe guard after all frames.
import { oklab, oklabToRgb } from './colour.mjs';
import { kmeans, nearest } from './kmeans.mjs';
import { smoothIsolated } from './cleanup.mjs';
import { makeSpill } from './background.mjs';
export function postprocess(out, o, cellW, cellH, stretch, report) {
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
}
