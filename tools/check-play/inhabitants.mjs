// Instantiate the browser's walkers, then use its routes and the existing player checks.
import { NEAR_RESIDENT, TILE } from '../../web/config.js';
import { nearSeen } from './reach.mjs';

// Geometry's artFrom deliberately omits moving sprites for overlay placement.
// Supply their manifest presence only here, without loading images or changing product code.
export function inhabitantArt(art, manifest) {
  const sheet = { stub: true };
  art.townsfolk = (manifest.characters?.townsfolk || []).map((d) => d?.src ? sheet : null);
  if (manifest.characters?.contractor?.src) art.contractor = sheet;
  return art;
}

function route(walker, from, to) {
  walker.x = from.x; walker.y = from.y;
  if (!walker.goTo(to.x, to.y, 'look') || !walker.path?.length) return false;
  let prev = from;
  for (const next of walker.path) {
    if (!walker.world.sweepFree(prev.x, prev.y, next.x, next.y)) return false;
    prev = next;
  }
  return Math.hypot(prev.x - to.x, prev.y - to.y) < 1;
}

export function checkInhabitants(town, world, npcs, seen, buildings) {
  const byId = new Map(world.buildings.map((b) => [b.id, b]));
  const badBuildings = new Set(buildings.bad.map(({ b }) => b.id));
  const result = {};
  for (const [kind, definitions, walkers] of [
    ['residents', town.residents || [], npcs.walkers],
    ['contractors', town.contractors || [], npcs.contractors],
    ['locals', town.crowd || [], npcs.locals],
  ]) {
    const entries = definitions.map((def) => {
      const walker = walkers.find((w) => w.def === def);
      const homes = kind === 'locals' ? [def.home] : def.homes || [];
      const row = { id: def.id, name: def.name || def.id, homes, reasons: [] };
      if (!homes.length) row.reasons.push('no home building');
      for (const id of homes) {
        if (!byId.has(id)) row.reasons.push(`home ${id} does not exist`);
        else if (badBuildings.has(id)) row.reasons.push(`home ${id} fails building entry/reach checks`);
      }
      if (!walker) {
        row.reasons.push('browser did not create this walker (home or sprite missing)');
        return row;
      }
      const start = { x: walker.x, y: walker.y };
      row.x = start.x; row.y = start.y;
      if (world.feetHit(start.x, start.y)) row.reasons.push('initial feet collide');
      if (!nearSeen(world, seen, start.x, start.y, 1)) row.reasons.push('initial position unreachable from player spawn');
      if (!nearSeen(world, seen, start.x, start.y, NEAR_RESIDENT)) row.reasons.push('cannot be approached for a talk');
      // Check spawn -> every home and every directed home pair, with Walker.goTo and
      // the same swept feet collision used by player navigation. No random stroll sampling.
      const destinations = homes.map((id) => byId.get(id)).filter((b) => b?.doorOutside);
      for (const to of destinations) {
        if (!route(walker, start, to.doorOutside)) row.reasons.push(`cannot walk from initial position to home ${to.id}`);
        for (const from of destinations) if (from !== to && !route(walker, from.doorOutside, to.doorOutside)) {
          row.reasons.push(`cannot walk from home ${from.id} to home ${to.id}`);
        }
      }
      walker.x = start.x; walker.y = start.y; walker.path = null;
      return row;
    });
    result[kind] = { total: definitions.length, created: walkers.length, failed: entries.filter((r) => r.reasons.length).length, entries };
  }
  return result;
}

export function reportInhabitants(log, inhabitants, verbose) {
  for (const [kind, group] of Object.entries(inhabitants)) {
    log(`${kind}: ${group.created}/${group.total} created, ${group.total - group.failed}/${group.total} checked`);
    for (const row of group.entries) {
      const at = Number.isFinite(row.x) ? ` at (${(row.x / TILE).toFixed(4)},${(row.y / TILE).toFixed(4)})` : '';
      const identity = `${kind} ${row.id ?? ''} ${row.kind ? `${row.kind} ` : ''}${row.name}`;
      if (row.reasons.length) log(`  x ${identity}${at}: ${row.reasons.join('; ')}`);
      else if (verbose) log(`  ok ${identity}${at}`);
    }
  }
}
