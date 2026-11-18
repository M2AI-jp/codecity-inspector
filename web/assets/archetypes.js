// Queue archetypes without awaiting so the manifest keeps its original parallel loading order.
import { loadImage, resolve } from './loading.js';

export function enqueueArchetypes(m, base, art, jobs) {
  // Archetypes: each has one or more visual variants with their own footprint / door / blockers /
  // lights / smoke. (A manifest entry without `variants` is treated as a single variant.)
  for (const [key, a] of Object.entries(m.archetypes || {})) {
    const defs = Array.isArray(a.variants) && a.variants.length ? a.variants : [a];
    const variants = defs.map((v, i) => {
      const entry = {
        key, id: v.id || `${key}-${i + 1}`,
        footprint: v.footprint || a.footprint || null,
        exterior: null, cutaway: null,
        exteriorOrigin: (v.exterior && v.exterior.origin) || [0, 0],
        cutawayOrigin: (v.cutaway && v.cutaway.origin) || (v.exterior && v.exterior.origin) || [0, 0],
        door: v.door || null,
        floor: Array.isArray(v.floor) ? v.floor : null,
        blockers: Array.isArray(v.blockers) ? v.blockers : [],
        lights: Array.isArray(v.lights) ? v.lights : [],
        interiorLights: Array.isArray(v.interiorLights) ? v.interiorLights : [],
        smoke: Array.isArray(v.smoke) ? v.smoke : [],
      };
      if (v.exterior && v.exterior.src) jobs.push(loadImage(resolve(v.exterior.src, base)).then((img) => { entry.exterior = img; }));
      if (v.cutaway && v.cutaway.src) jobs.push(loadImage(resolve(v.cutaway.src, base)).then((img) => { entry.cutaway = img; }));
      return entry;
    });
    art.archetypes[key] = { key, variants };
  }
}
