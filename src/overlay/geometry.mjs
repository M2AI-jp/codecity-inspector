// Shared geometry: identical to the browser and check-play, without loading images.
import { World } from '../../web/world.js';
import { parseGround } from '../../web/ground.js';
import { createResidents } from '../../web/residents.js';
import { KEEPER_BOX } from '../../web/config.js';

export function artFrom(m) {
  const stubSheet = { stub: true };
  const art = { tile: m.tile || 16, player: stubSheet, keepers: {}, townsfolk: [], archetypes: {}, props: {}, ground: {} };
  const ch = m.characters || {};
  for (const kind of Object.keys(ch.keepers || {})) art.keepers[kind] = stubSheet;
  for (const [key, a] of Object.entries(m.archetypes || {})) {
    const defs = Array.isArray(a.variants) && a.variants.length ? a.variants : [a];
    art.archetypes[key] = {
      key,
      variants: defs.map((v, i) => ({
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
      })),
    };
  }
  for (const [key, p] of Object.entries(m.props || {})) {
    art.props[key] = { key, image: null, origin: p.origin || [0, 0], solid: p.solid || null, light: p.light || null, flicker: p.flicker !== false,
      deck: Array.isArray(p.deck) ? p.deck : null, layer: p.layer === 'ground' ? 'ground' : null,
      ...(Array.isArray(p.solids) ? { solids: p.solids } : {}), ...(Array.isArray(p.lights) ? { lights: p.lights } : {}),
      ...(Array.isArray(p.opening) ? { opening: p.opening } : {}) };
  }
  return art;
}

export function buildWorld(town, art) {
  const warns = [];
  const ow = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let world, npcs;
  try {
    world = new World(town, art, parseGround(town));
    npcs = createResidents(town, world, art, false);
    for (const k of npcs.keepers) world.addRect(k.x + KEEPER_BOX[0], k.y + KEEPER_BOX[1], KEEPER_BOX[2], KEEPER_BOX[3], 'npc');
    if (npcs.keepers.length || town.overlay) world.computeNav();
  } finally { console.warn = ow; }
  const spawn = town.spawn || { x: town.cols / 2, y: town.rows / 2 };
  let [sx, sy] = [Math.floor(spawn.x), Math.floor(spawn.y)];
  const free = world.nearestFree(sx, sy, 20);
  if (free) [sx, sy] = free;
  const p = world.navPoint(sx, sy);
  return { world, npcs, start: { x: Math.round(p.x), y: Math.round(p.y) }, warns };
}

