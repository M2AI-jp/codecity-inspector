// PNG filters: share Paeth prediction while preserving row reconstruction and adaptive scoring.
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Reverse filters of one (sub)image in place-ish; returns array of row Buffers.
export function unfilter(raw, offset, stride, rows, bpp) {
  const out = [];
  let prev = new Uint8Array(stride);
  let p = offset;
  for (let y = 0; y < rows; y++) {
    const ft = raw[p++];
    const line = new Uint8Array(raw.subarray(p, p + stride));
    if (line.length !== stride) throw new Error('PNG: truncated image data');
    p += stride;
    switch (ft) {
      case 0: break;
      case 1: for (let i = bpp; i < stride; i++) line[i] = (line[i] + line[i - bpp]) & 255; break;
      case 2: for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 255; break;
      case 3: for (let i = 0; i < stride; i++) line[i] = (line[i] + (((i >= bpp ? line[i - bpp] : 0) + prev[i]) >> 1)) & 255; break;
      case 4: for (let i = 0; i < stride; i++) line[i] = (line[i] + paeth(i >= bpp ? line[i - bpp] : 0, prev[i], i >= bpp ? prev[i - bpp] : 0)) & 255; break;
      default: throw new Error(`PNG: bad filter type ${ft}`);
    }
    out.push(line);
    prev = line;
  }
  return { rows: out, next: p };
}

export function filterRows(px, pw, ph, bpp) {
  // px: Uint8Array of pw*ph*bpp bytes. Adaptive filter per row (min sum of |signed byte|).
  const stride = pw * bpp;
  const out = Buffer.alloc(ph * (stride + 1));
  const cand = Array.from({ length: 5 }, () => new Uint8Array(stride));
  let prev = new Uint8Array(stride);
  for (let y = 0; y < ph; y++) {
    const line = px.subarray(y * stride, (y + 1) * stride);
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], cc = i >= bpp ? prev[i - bpp] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, cc);
        const v = (line[i] - pred) & 255;
        c[i] = v;
        score += v < 128 ? v : 256 - v;
        if (score >= bestScore) break;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    // recompute chosen row fully (loop above may have broken early)
    const o = y * (stride + 1);
    out[o] = best;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], cc = i >= bpp ? prev[i - bpp] : 0;
      const pred = best === 0 ? 0 : best === 1 ? a : best === 2 ? b : best === 3 ? (a + b) >> 1 : paeth(a, b, cc);
      out[o + 1 + i] = (line[i] - pred) & 255;
    }
    prev = line;
  }
  return out;
}
