// Queue ground without awaiting so the manifest keeps its original parallel loading order.
import { loadImage, resolve } from './loading.js';
import { DEFAULT_GROUND } from './defaults.js';
import { toCanvas } from './canvas.js';

export function enqueueGround(m, base, opts, art, jobs) {
  // Ground textures -> ImageData for per-pixel sampling, only needed when the town carries no
  // pre-composed groundImage. Without a manifest ground section the shared textures are tried.
  const groundDefs = opts.needGround ? (m.ground || DEFAULT_GROUND) : {};
  for (const [key, src] of Object.entries(groundDefs)) {
    if (!src) continue;
    jobs.push(loadImage(resolve(src, base)).then((img) => {
      if (!img) return;
      const c = toCanvas(img);
      art.ground[key] = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    }));
  }
}
