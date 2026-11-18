import fs from 'node:fs';
import { decodePNG } from '../png.mjs';

// Bounds of the opaque pixels in a landmark, relative to the image's top left.
export function landmarkBounds(abs) {
  const im = decodePNG(fs.readFileSync(abs));
  let x0 = im.width, y0 = im.height, x1 = -1, y1 = -1;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    if (!im.data[(y * im.width + x) * 4 + 3]) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
