import fs from 'node:fs';
import { decodePNG } from '../png.mjs';

// How many whole tile rows above the footprint's top the exterior image hides, per footprint tile
// column (the lowest opaque top over the column's 16 px). The roof of a workshop is drawn inside
// its footprint (0 rows); a watchtower hides 3. Layout does not count those rows as open lawn.
export function roofCover(abs, origin, footW) {
  try {
    const im = decodePNG(fs.readFileSync(abs));
    const W = im.width, H = im.height, out = [];
    for (let tx = 0; tx < footW; tx++) {
      let hid = 99;
      for (let px = origin[0] + tx * 16; px < origin[0] + tx * 16 + 16; px++) {
        if (px < 0 || px >= W) { hid = 0; continue; }
        let top = H;
        for (let y = 0; y < H; y++) if (im.data[(y * W + px) * 4 + 3] > 128) { top = y; break; }
        hid = Math.min(hid, Math.floor(Math.max(0, origin[1] - top) / 16));
      }
      out.push(hid === 99 ? 0 : hid);
    }
    return out;
  } catch { return null; }
}
