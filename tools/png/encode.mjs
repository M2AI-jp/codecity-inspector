// PNG encoding: assemble RGBA passes, then compress and frame them in the original order.
// encodePNG: 8-bit RGBA, per-row adaptive filter, optional Adam7.
import zlib from 'node:zlib';
import { SIG, ADAM7 } from './format.mjs';
import { chunk } from './chunks.mjs';
import { filterRows } from './filters.mjs';

export function encodePNG(img, { level = 9, interlace = false } = {}) {
  const { width: w, height: h } = img;
  const data = img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray ? new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length) : Uint8Array.from(img.data);
  if (data.length !== w * h * 4) throw new Error('encodePNG: data length must be width*height*4');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = interlace ? 1 : 0;
  let filtered;
  if (!interlace) filtered = filterRows(data, w, h, 4);
  else {
    const parts = [];
    for (const [xs, ys, dx, dy] of ADAM7) {
      const pw = Math.ceil((w - xs) / dx), ph = Math.ceil((h - ys) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const sub = new Uint8Array(pw * ph * 4);
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const s = ((ys + y * dy) * w + xs + x * dx) * 4, d = (y * pw + x) * 4;
        sub[d] = data[s]; sub[d + 1] = data[s + 1]; sub[d + 2] = data[s + 2]; sub[d + 3] = data[s + 3];
      }
      parts.push(filterRows(sub, pw, ph, 4));
    }
    filtered = Buffer.concat(parts);
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(filtered, { level })), chunk('IEND', Buffer.alloc(0))]);
}
