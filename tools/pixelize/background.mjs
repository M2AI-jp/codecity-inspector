// background: Keep alpha, chroma key and despill decisions in their original order.

// Spill of the key colour: how much the key's dominant channels exceed the others (0 = none).
export function makeSpill(key) {
  const dom = [0, 1, 2].filter((c) => key[c] >= 128), oth = [0, 1, 2].filter((c) => key[c] < 128);
  if (!dom.length || !oth.length) return { spill: () => 0, dom };
  return { dom, spill: (r, g, b) => { const p = [r, g, b]; return Math.min(...dom.map((c) => p[c])) - Math.max(...oth.map((c) => p[c])); } };
}

// ---------- stage 1: background removal / despill ----------
export function removeBackground(img, { key, tol, despill }) {
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

export function prepareBackground(src, o, stretch, report) {
  // stage 1
  const bgr = stretch ? { img: src, mask: new Uint8Array(src.width * src.height).fill(1), usedAlpha: false, keyed: 0, killed: 0, despilled: 0 }
    : removeBackground(src, o);
  if (stretch) for (let i = 0; i < src.width * src.height; i++) bgr.img.data[i * 4 + 3] = 255;
  report.background = stretch ? 'none (full-bleed)' : bgr.usedAlpha ? 'existing alpha' : `chroma key #${o.key.map((c) => c.toString(16).padStart(2, '0')).join('')} tol ${o.tol}`;
  Object.assign(report, { keyedPx: bgr.keyed, fringeKilledPx: bgr.killed, despilledPx: bgr.despilled });
  return bgr;
}
