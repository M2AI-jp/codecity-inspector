// Assemble debug art in its original order so seeded drawings and manifest key order remain stable.
import { ARCH, building } from './buildings.js';
import { noiseTex, stoneTex } from './textures.js';
import { placeholderProps } from './props.js';
import { placeholderPeople } from './people.js';

export function placeholderManifest() {
  const archetypes = {};
  // two visual variants per archetype (second one with a different roof) to exercise variant choice
  for (const [k, a] of Object.entries(ARCH)) {
    const alt = { ...a, roof: [a.roof[2], a.roof[0], a.roof[1]] };
    archetypes[k] = { variants: [{ id: `${k}-1`, ...building(k, a) }, { id: `${k}-2`, ...building(k, alt) }] };
  }
  // hand-made test variant: explicit floor rect, door at column 4 (not where town.json puts it)
  {
    const a = { ...ARCH.house_m, door: { x: 4, w: 1 }, blockers: [[14, 32, 14, 10]], roof: [70, 96, 70] };
    const v = { id: 'house_m-2', ...building('house_m', a), floor: [10, 30, 76, 38] };
    archetypes.house_m.variants[1] = v;
  }
  const ground = {
    grass: noiseTex(64, [62, 88, 52], 22, 3, 0.04).toDataURL(),
    dirt: noiseTex(64, [112, 90, 64], 18, 5, 0.03).toDataURL(),
    street: stoneTex(64, 8, 7, 11, [118, 116, 122], [58, 56, 62], 7).toDataURL(),
    plaza: stoneTex(64, 16, 12, 20, [132, 124, 116], [70, 66, 64], 9).toDataURL(),
  };
  const props = placeholderProps();
  const characters = placeholderPeople();
  return { tile: 16, characters, archetypes, props, ground };
}
