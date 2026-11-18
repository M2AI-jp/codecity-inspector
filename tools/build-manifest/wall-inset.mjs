import fs from 'node:fs';
import { decodePNG } from '../png.mjs';

// How far the drawn walls sit inside the footprint's left / right edge (px): the median first /
// last opaque column over the lower wall rows of the exterior image (props such as a scaffold are
// pushed against the wall by this much).
export function wallInset(abs, footH) {
  try {
    const im = decodePNG(fs.readFileSync(abs));
    const W = im.width, H = im.height, L = [], R = [];
    for (let y = Math.max(0, H - Math.min(40, footH * 16 - 4)); y < H - 4; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < W; x++) if (im.data[(y * W + x) * 4 + 3] > 128) { if (l < 0) l = x; r = x; }
      if (l >= 0) { L.push(l); R.push(W - 1 - r); }
    }
    if (!L.length) return null;
    const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    return [med(L), med(R)];
  } catch { return null; }
}
