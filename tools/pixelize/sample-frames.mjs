// sample-frames: Keep phase search, outline repair and anchoring together for each frame.
import { createImage } from '../png.mjs';
import { oklabToRgb } from './colour.mjs';
import { sampleBlock } from './sample-block.mjs';
import { despeckle } from './cleanup.mjs';
export function sampleFrames(img, pal, live, o, cols, rows, cellW, cellH, centerBy, stretch, sx, sy, report) {
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
  return out;
}
