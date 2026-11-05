#!/usr/bin/env node
// Nearest-neighbour previews and side-by-side contact sheets for judging sprite consistency.
//   node preview.mjs up   in.png out.png [--scale 4] [--bg 1c1c24] [--grid 32]
//   node preview.mjs side ref.png new.png out.png [--scale 4] [--bg 1c1c24] [--grid 32] [--crop-ref x,y,w,h] [--crop-new x,y,w,h]
//   node preview.mjs tile in.png out.png [--n 2] [--scale 4]        (wrap check for tileable textures)
import { readPNG, writePNG, createImage } from './png.mjs';
import { fileURLToPath } from 'node:url';

const hex = (s) => { const v = parseInt(String(s).replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

export function crop(img, x, y, w, h) {
  const out = createImage(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx = x + i, sy = y + j;
    if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
    const s = (sy * img.width + sx) * 4, d = (j * w + i) * 4;
    for (let c = 0; c < 4; c++) out.data[d + c] = img.data[s + c];
  }
  return out;
}

// Alpha-composite `img` scaled by integer `scale` onto `dst` at (ox, oy).
export function blitScaled(dst, img, ox, oy, scale) {
  for (let y = 0; y < img.height * scale; y++) for (let x = 0; x < img.width * scale; x++) {
    const dx = ox + x, dy = oy + y;
    if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
    const s = (((y / scale) | 0) * img.width + ((x / scale) | 0)) * 4, d = (dy * dst.width + dx) * 4;
    const a = img.data[s + 3] / 255;
    for (let c = 0; c < 3; c++) dst.data[d + c] = img.data[s + c] * a + dst.data[d + c] * (1 - a);
    dst.data[d + 3] = 255;
  }
}

function fill(img, rgb, x0 = 0, y0 = 0, w = img.width, h = img.height) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const d = (y * img.width + x) * 4;
    img.data[d] = rgb[0]; img.data[d + 1] = rgb[1]; img.data[d + 2] = rgb[2]; img.data[d + 3] = 255;
  }
}

// Faint cell grid + a baseline marker on each cell's bottom row so alignment is easy to judge.
function gridLines(img, ox, oy, w, h, cell, scale, rgb) {
  if (!cell) return;
  for (let gx = 0; gx <= w; gx += cell) fill(img, rgb, ox + gx * scale - (gx === w ? 1 : 0), oy, 1, h * scale);
  for (let gy = 0; gy <= h; gy += cell) fill(img, rgb, ox, oy + gy * scale - (gy === h ? 1 : 0), w * scale, 1);
}

export function upscale(img, { scale = 4, bg = '1c1c24', grid = 0 } = {}) {
  const out = createImage(img.width * scale, img.height * scale);
  fill(out, hex(bg));
  blitScaled(out, img, 0, 0, scale);
  gridLines(out, 0, 0, img.width, img.height, grid, scale, [60, 60, 76]);
  return out;
}

export function sideBySide(imgs, { scale = 4, bg = '1c1c24', grid = 32, gap = 8 } = {}) {
  const pad = gap * scale;
  const W = imgs.reduce((s, im) => s + im.width * scale, 0) + pad * (imgs.length + 1);
  const H = Math.max(...imgs.map((im) => im.height)) * scale + pad * 2;
  const out = createImage(W, H);
  fill(out, hex(bg));
  let x = pad;
  for (const im of imgs) {
    fill(out, [40, 40, 52], x, pad, im.width * scale, im.height * scale);
    gridLines(out, x, pad, im.width, im.height, grid, scale, [70, 70, 90]);
    blitScaled(out, im, x, pad, scale);
    x += im.width * scale + pad;
  }
  return out;
}

export function tile(img, n = 2) {
  const out = createImage(img.width * n, img.height * n);
  for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++)
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4, d = ((ty * img.height + y) * out.width + tx * img.width + x) * 4;
      for (let c = 0; c < 4; c++) out.data[d + c] = img.data[s + c];
    }
  return out;
}

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parse(rest);
  const scale = +(opt.scale ?? 4), bg = opt.bg ?? '1c1c24', grid = +(opt.grid ?? 0);
  const cropOpt = (img, c) => (c ? crop(img, ...c.split(',').map(Number)) : img);
  if (cmd === 'up') writePNG(pos[1], upscale(readPNG(pos[0]), { scale, bg, grid }));
  else if (cmd === 'side') {
    const ref = cropOpt(readPNG(pos[0]), opt['crop-ref']), neu = cropOpt(readPNG(pos[1]), opt['crop-new']);
    writePNG(pos[2], sideBySide([ref, neu], { scale, bg, grid: +(opt.grid ?? 32) }));
  } else if (cmd === 'tile') writePNG(pos[1], upscale(tile(readPNG(pos[0]), +(opt.n ?? 2)), { scale, bg }));
  else { console.error('usage: preview.mjs up|side|tile ... (see header)'); process.exit(1); }
  console.log(`wrote ${pos[pos.length - 1]}`);
}
