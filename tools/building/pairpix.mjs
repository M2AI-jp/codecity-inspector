// node pairpix.mjs A.png B.png outPrefix [--width 96] [--colors 48] [--dx 0 --dy 0]
// A and B must share canvas coordinates (B optionally shifted by dx,dy). Adds identical corner markers so
// tools/pixelize.mjs computes the SAME scale + anchor for both, then removes markers and crops both to one frame.
import { readPng, writePng, blank, scale } from './img.mjs';
import { execFileSync } from 'node:child_process';
const argv = process.argv.slice(2); const [pa, pb, outp] = argv; const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const TW = +opt('width', 96), COLORS = opt('colors', '48'), DX = +opt('dx', 0), DY = +opt('dy', 0);
const PIX = new URL('../pixelize.mjs', import.meta.url).pathname;
const A = readPng(pa), B0 = readPng(pb);
const W = Math.max(A.w, B0.w + Math.abs(DX)), H = Math.max(A.h, B0.h + Math.abs(DY));
const place = (src, dx, dy) => { const o = blank(W + 400, H + 400); for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const si = (y * src.w + x) * 4; if (src.data[si + 3] < 128) continue; o.data.set(src.data.subarray(si, si + 4), ((y + dy + 200) * o.w + x + dx + 200) * 4); o.data[((y + dy + 200) * o.w + x + dx + 200) * 4 + 3] = 255; } return o; };
const a = place(A, 0, 0), b = place(B0, DX, DY);
const bb = (im) => { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.data[(y * im.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, y0, x1, y1 }; };
const ba = bb(a), bbB = bb(b);
const U = { x0: Math.min(ba.x0, bbB.x0), y0: Math.min(ba.y0, bbB.y0), x1: Math.max(ba.x1, bbB.x1), y1: Math.max(ba.y1, bbB.y1) };
const S = 110, M = 60; // marker size, margin (source px)
const mk = [[U.x0 - M - S, U.y0 - M - S], [U.x1 + M, U.y1 + M]];
for (const im of [a, b]) for (const [mx, my] of mk) for (let y = my; y < my + S; y++) for (let x = mx; x < mx + S; x++) im.data.set([27, 20, 16, 255], (y * im.w + x) * 4);
const sOut = (ba.x1 - ba.x0 + 1) / TW; // src px per output px, from A's width
const fw = U.x1 - U.x0 + 1 + 2 * (M + S), fh = U.y1 - U.y0 + 1 + 2 * (M + S);
const OW = Math.round(fw / sOut), OH = Math.round(fh / sOut);
const reports = {};
for (const [k, im] of [['A', a], ['B', b]]) {
  writePng(`${outp}_${k}_marked.png`, im);
  const r = execFileSync('node', [PIX, `${outp}_${k}_marked.png`, `${outp}_${k}_pix_raw.png`, '--grid', '1x1', '--size', `${OW}x${OH}`, '--colors', COLORS, '--phases', '1']).toString();
  reports[k] = JSON.parse(r);
}
// remove markers: output frame maps fw x fh source onto OW x OH (bottom-center anchor); markers are the corner (M+S)/s cells
const outs = {};
const cut = Math.ceil((M + S) / sOut) - 1;
for (const k of ['A', 'B']) {
  const o = readPng(`${outp}_${k}_pix_raw.png`);
  // find marker components: bbox of all opaque pixels
  const q = bb(o);
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const inTL = x <= q.x0 + Math.ceil(S / sOut) + 1 && y <= q.y0 + Math.ceil(S / sOut) + 1; const inBR = x >= q.x1 - Math.ceil(S / sOut) - 1 && y >= q.y1 - Math.ceil(S / sOut) - 1; if (inTL || inBR) o.data[(y * o.w + x) * 4 + 3] = 0; }
  outs[k] = o;
}
// common crop
const qa = bb(outs.A), qb = bb(outs.B);
const C = { x0: Math.min(qa.x0, qb.x0), y0: Math.min(qa.y0, qb.y0), x1: Math.max(qa.x1, qb.x1), y1: Math.max(qa.y1, qb.y1) };
const cw = C.x1 - C.x0 + 1, ch = C.y1 - C.y0 + 1;
const crop = (im) => { const o = blank(cw, ch); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const si = ((y + C.y0) * im.w + x + C.x0) * 4; o.data.set(im.data.subarray(si, si + 4), (y * cw + x) * 4); } return o; };
const fa = crop(outs.A), fb = crop(outs.B);
writePng(`${outp}_A.png`, fa); writePng(`${outp}_B.png`, fb);
// preview: A | B | 50% blend, x4, on dark bg; and flipbook gif
const pad = 6; const P = blank(cw * 3 + pad * 2, ch, [34, 34, 44, 255]);
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = (y * cw + x) * 4; const ca = fa.data.subarray(i, i + 4), cb = fb.data.subarray(i, i + 4);
  if (ca[3]) P.data.set(ca, (y * P.w + x) * 4); if (cb[3]) P.data.set(cb, (y * P.w + cw + pad + x) * 4);
  const oi = (y * P.w + 2 * (cw + pad) + x) * 4; if (ca[3] && cb[3]) P.data.set([(ca[0] + cb[0]) >> 1, (ca[1] + cb[1]) >> 1, (ca[2] + cb[2]) >> 1, 255], oi); else if (ca[3]) P.data.set([255, 70, 70, 255], oi); else if (cb[3]) P.data.set([70, 200, 255, 255], oi); }
writePng(`${outp}_preview_x4.png`, scale(P, 4));
console.log(JSON.stringify({ size: [cw, ch], srcPxPerOut: +sOut.toFixed(2), outA: qa, outB: qb, colorsA: reports.A.colours, colorsB: reports.B.colours, phaseA: reports.A.frameWidths }));
