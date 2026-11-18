// sample-block: Keep weighted majority sampling and phase scoring on the identical pixel traversal.

// ---------- stage 3: block-majority sampling ----------
// Samples output pixels (i,j) whose source footprint is [ox+i*sx, ox+(i+1)*sx) x [oy+j*sy, ...), clipped to clip rect.
export function sampleBlock(src, pal, { ox, oy, sx, sy, ow, oh, clip, wrap, darkBoost, scoreOnly }) {
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
