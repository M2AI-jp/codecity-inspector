// Keep deterministic ground generators together so their random draw order remains local.
import { hash2, mulberry32 } from '../../util.js';
import { mk, rgb } from './shared.js';

export function noiseTex(size, base, amp, seed, speck) {
  const c = mk(size, size), g = c.getContext('2d');
  const id = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = (hash2(x, y, seed) - 0.5) * amp + (hash2(x >> 2, y >> 2, seed + 1) - 0.5) * amp * 0.8;
    let k = 1 + n / 100;
    if (speck && hash2(x, y, seed + 2) < speck) k *= 1.25;
    const i = (y * size + x) * 4;
    id.data[i] = base[0] * k; id.data[i + 1] = base[1] * k; id.data[i + 2] = base[2] * k; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}

export function stoneTex(size, rowH, minW, maxW, base, mortar, seed) {
  const c = mk(size, size), g = c.getContext('2d');
  g.fillStyle = rgb(...mortar); g.fillRect(0, 0, size, size);
  const rng = mulberry32(seed);
  for (let y = 0; y < size; y += rowH) {
    const widths = []; let sum = 0;
    while (sum < size) { let w = minW + Math.floor(rng() * (maxW - minW + 1)); if (size - sum - w < minW && size - sum - w !== 0) w = size - sum; widths.push(w); sum += w; }
    let x = Math.floor(rng() * size);
    for (const w of widths) {
      const k = 0.82 + rng() * 0.3;
      const col = [base[0] * k, base[1] * k, base[2] * k];
      for (let yy = 1; yy < rowH; yy++) for (let xx = 1; xx < w; xx++) {
        const px = (x + xx) % size, py = y + yy;
        let kk = 1;
        if (yy === 1 || xx === 1) kk = 1.14; else if (yy === rowH - 1 || xx === w - 1) kk = 0.8;
        if ((yy === 1 && xx === 1) || (yy === 1 && xx === w - 1) || (yy === rowH - 1 && xx === 1) || (yy === rowH - 1 && xx === w - 1)) continue;
        kk *= 1 + (hash2(px, py, seed) - 0.5) * 0.12;
        g.fillStyle = rgb(col[0] * kk, col[1] * kk, col[2] * kk); g.fillRect(px, py, 1, 1);
      }
      x = (x + w) % size;
    }
  }
  return c;
}
