// Load creature sheets and select animation frames.
import { loadImage, toCanvas, cleanMagenta } from '../assets.js';

export async function loadCreatureArt(manifest, manifestUrl) {
  const defs = (manifest && manifest.creatures) || {};
  const base = new URL(manifestUrl, location.href).href;
  const sheets = {};
  await Promise.all(Object.entries(defs).map(async ([name, d]) => {
    const img = d && d.src ? await loadImage(new URL(d.src, base).href) : null;
    if (!img) return;
    const c = toCanvas(img);
    cleanMagenta(c);
    const [fw, fh] = d.frame || [16, 16];
    const [px, py] = d.pivot || [fw >> 1, fh - 1];
    sheets[name] = { image: c, fw, fh, px, py, cols: Math.max(1, Math.floor(c.width / fw)), anims: d.anims || {} };
  }));
  return sheets;
}

export function frameOf(sheet, anim, dir, t, fps) {
  const a = sheet.anims[anim] || sheet.anims.idle || {};
  const list = a[dir] || a[dir === 'up' || dir === 'down' ? 'left' : 'down'] || a.left || Object.values(a)[0];
  if (!list || !list.length) return null;
  const i = list[Math.floor(t * fps) % list.length];
  return { sx: (i % sheet.cols) * sheet.fw, sy: Math.floor(i / sheet.cols) * sheet.fh };
}
