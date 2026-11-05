// Dependency-free PNG decode/encode (Node stdlib only).
// decodePNG: bit depths 1/2/4/8/16, colour types 0/2/3/4/6, tRNS, Adam7.
// encodePNG: 8-bit RGBA, per-row adaptive filter, optional Adam7.
import zlib from 'node:zlib';
import fs from 'node:fs';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

let CRC_TABLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Reverse filters of one (sub)image in place-ish; returns array of row Buffers.
function unfilter(raw, offset, stride, rows, bpp) {
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

export function decodePNG(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('PNG: bad signature');
  let pos = 8, ihdr = null, palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], ct: data[9], interlace: data[12] };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
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

function filterRows(px, pw, ph, bpp) {
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

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

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

export const readPNG = (path) => decodePNG(fs.readFileSync(path));
export const writePNG = (path, img, opts) => fs.writeFileSync(path, encodePNG(img, opts));
export const createImage = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
