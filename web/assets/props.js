// Queue props without awaiting so the manifest keeps its original parallel loading order.
import { loadImage, resolve } from './loading.js';

export function enqueueProps(m, base, art, jobs) {
  // Props
  for (const [key, p] of Object.entries(m.props || {})) {
    const entry = { key, image: null, origin: p.origin || [0, 0], solid: p.solid || null, light: p.light || null, flicker: p.flicker !== false,
      deck: Array.isArray(p.deck) ? p.deck : null, layer: p.layer === 'ground' ? 'ground' : null };
    // several boxes / lights and a walkable opening (the gate: two pillars, two lanterns, the gap between)
    for (const f of ['solids', 'lights', 'opening']) if (Array.isArray(p[f])) entry[f] = p[f];
    art.props[key] = entry;
    if (p.src) jobs.push(loadImage(resolve(p.src, base)).then((img) => { entry.image = img; }));
  }
}
