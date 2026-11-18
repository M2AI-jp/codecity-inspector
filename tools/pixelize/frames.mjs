// frames: Find surviving figure bounds and one sheet-wide scale before placing any frame.
import { components } from './components.mjs';
export function collectFrames(img, mask, cols, rows, stretch, report) {
  const W = img.width, H = img.height;
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
  return { frames, live };
}

export function sheetScale(frames, live, o, sheet1, cellW, cellH, stretch, report) {
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
  return { sx, sy };
}
