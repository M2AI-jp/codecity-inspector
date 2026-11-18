// PNG decoding: turn parsed samples into RGBA without changing validation or conversion order.
// decodePNG: bit depths 1/2/4/8/16, colour types 0/2/3/4/6, tRNS, Adam7.
import zlib from 'node:zlib';
import { SIG, CHANNELS, ADAM7 } from './format.mjs';
import { readChunks } from './chunks.mjs';
import { unfilter } from './filters.mjs';

export function decodePNG(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('PNG: bad signature');
  const { ihdr, palette, trns, idat } = readChunks(buf);
  if (!ihdr) throw new Error('PNG: missing IHDR');
  const { width: w, height: h, depth, ct, interlace } = ihdr;
  const ch = CHANNELS[ct];
  if (!ch) throw new Error(`PNG: unsupported colour type ${ct}`);
  if (ct === 3 && !palette) throw new Error('PNG: palette image without PLTE');
  const bitsPP = ch * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8ClampedArray(w * h * 4);
  const maxv = (1 << depth) - 1;
  const to8 = depth === 16 ? (v) => Math.round(v / 257) : depth === 8 ? (v) => v : (v) => Math.round((v * 255) / maxv);

  // tRNS key for grey / truecolour (raw sample values at native depth)
  let keyG = -1, keyR = -1, keyGg = -1, keyB = -1;
  if (trns && ct === 0) keyG = trns.readUInt16BE(0);
  if (trns && ct === 2) { keyR = trns.readUInt16BE(0); keyGg = trns.readUInt16BE(2); keyB = trns.readUInt16BE(4); }

  const sample = (line, i) => {
    if (depth === 8) return line[i];
    if (depth === 16) return (line[2 * i] << 8) | line[2 * i + 1];
    const bit = i * depth;
    return (line[bit >> 3] >> (8 - depth - (bit & 7))) & maxv;
  };

  const writeRows = (rows, pw, x0, y0, dx, dy) => {
    for (let ry = 0; ry < rows.length; ry++) {
      const line = rows[ry];
      const y = y0 + ry * dy;
      for (let rx = 0; rx < pw; rx++) {
        const x = x0 + rx * dx;
        const o = (y * w + x) * 4;
        const s = rx * ch;
        let r, g, b, a = 255;
        if (ct === 0) { const v = sample(line, s); r = g = b = to8(v); if (v === keyG) a = 0; }
        else if (ct === 2) {
          const vr = sample(line, s), vg = sample(line, s + 1), vb = sample(line, s + 2);
          r = to8(vr); g = to8(vg); b = to8(vb);
          if (vr === keyR && vg === keyGg && vb === keyB) a = 0;
        } else if (ct === 3) {
          const idx = sample(line, s);
          r = palette[idx * 3] ?? 0; g = palette[idx * 3 + 1] ?? 0; b = palette[idx * 3 + 2] ?? 0;
          if (trns && idx < trns.length) a = trns[idx];
        } else if (ct === 4) { r = g = b = to8(sample(line, s)); a = to8(sample(line, s + 1)); }
        else { r = to8(sample(line, s)); g = to8(sample(line, s + 1)); b = to8(sample(line, s + 2)); a = to8(sample(line, s + 3)); }
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
      }
    }
  };

  if (interlace === 0) {
    const stride = Math.ceil((w * bitsPP) / 8);
    writeRows(unfilter(raw, 0, stride, h, bpp).rows, w, 0, 0, 1, 1);
  } else {
    let p = 0;
    for (const [xs, ys, dx, dy] of ADAM7) {
      const pw = Math.ceil((w - xs) / dx), ph = Math.ceil((h - ys) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const stride = Math.ceil((pw * bitsPP) / 8);
      const r = unfilter(raw, p, stride, ph, bpp);
      p = r.next;
      writeRows(r.rows, pw, xs, ys, dx, dy);
    }
  }
  return { width: w, height: h, data: out };
}
