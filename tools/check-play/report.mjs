// Keep the CLI and imported check's diagnostic text and ordering in one place.
import { TILE as T, FEET_W, FEET_H } from '../../web/config.js';
import { floorBox } from './buildings.mjs';

// what sits in the door corridor: rects overlapping the strip from the door up to the floor
function corridorReport(world, b) {
  const f = floorBox(b);
  const x0 = b.doorX0 * T - FEET_W / 2, x1 = b.doorX1 * T + FEET_W / 2;
  const y0 = f.y1 - FEET_H - 4, y1 = b.bottomPx + 16;
  const hits = [];
  world.rects.forEach((r) => {
    if (r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0) {
      hits.push(`${r.kind}[${r.x - b.px},${r.y - b.py},${r.w},${r.h}]`);
    }
  });
  const tiles = [];
  for (let ty = Math.floor(y0 / T); ty <= Math.floor(y1 / T); ty++) for (let tx = Math.floor(x0 / T); tx <= Math.floor(x1 / T); tx++) {
    if (world.inGrid(tx, ty) && world.tileSolid[ty * world.cols + tx]) tiles.push(`(${tx - b.x},${ty - b.y})`);
  }
  return `door cols ${b.doorX0 - b.x}..${b.doorX1 - b.x - 1}, floor y ${f.y0 - b.py}..${f.y1 - b.py}; ` +
    `rects near corridor (footprint px): ${hits.join(' ') || '-'}; solid tiles: ${tiles.join(' ') || '-'}`;
}

export function reportMissingKeepers(log, { lmCount, outdoor }) {
  if (outdoor.length < lmCount) log(`  x ${lmCount - outdoor.length} landmark keeper(s) were not created (town.landmarks has ${lmCount})`);
}

export function reportPlay(log, { town, world, target, verbose, warns, count, ms,
  buildings: { bad, soft }, keepers: { noKeeper, outdoor, farKeepers },
  terrain: { ters, strs, dryTer, dryStair, pierDecks, dryDecks, bridgeDecks, shutBridges, bridgePropGap, gates, shutGates },
  outdoor: { unplacedOutdoor, evidenceMissing, gatePropGap, canalUnplaced, canalMissing },
}) {
  log(`${town.repo?.name ?? target}: ${world.buildings.length} buildings, ${bad.length} not enterable, ` +
    `${soft.length} only from part of the door front, ${noKeeper.length} without a keeper; ` +
    `outdoor keepers ${outdoor.length - farKeepers.length}/${outdoor.length} reachable; piers ${pierDecks.length - dryDecks.length}/${pierDecks.length} walkable; ` +
    `gates ${gates.length - shutGates.length}/${gates.length} passable both ways; unplaced outdoor ${unplacedOutdoor.length + evidenceMissing.length + gatePropGap}; ` +
    `bridges ${bridgeDecks.length - shutBridges.length}/${bridgeDecks.length} passable both ways; ` +
    `canal ${town.canal ? `${town.canal.cells?.length || 0} cells/${town.canal.crossings?.length || 0} crossings` : 'none'}, unplaced canal ${canalUnplaced.length + (canalMissing ? 1 : 0)}; ` +
    `terraces ${ters.length - dryTer.length}/${ters.length} reachable, stairs ${strs.length - dryStair.length}/${strs.length} climbable; ` +
    `reachable feet px ${count} (${ms} ms)`);
  for (const b of noKeeper) log(`  x ${b.id} ${b.arch ? b.arch.id : b.archetype} at (${b.x},${b.y}) has no keeper (no spot inside)`);
  for (const k of farKeepers) log(`  x outdoor keeper ${k.name} of ${k.building.id} at (${(k.x / T).toFixed(2)},${(k.y / T).toFixed(2)}) cannot be reached for a talk`);
  for (const d of dryDecks) log(`  x pier deck at px (${d.x},${d.y},${d.w},${d.h}) cannot be stepped onto`);
  for (const { p, r } of shutGates) log(`  x ${p.type} at (${(p.x / T).toFixed(2)},${(p.y / T).toFixed(2)}): reach south=${r.southReach} north=${r.northReach}, walk south->north=${r.up} north->south=${r.down}`);
  for (const { d, r } of shutBridges) log(`  x ${d.prop?.data?.type || d.prop?.type} at px (${d.x},${d.y},${d.w},${d.h}): sides=${!!r.sideA}/${!!r.sideB}, forward=${r.forward}, backward=${r.backward}`);
  if (bridgePropGap) log(`  x ${bridgePropGap} canal crossing(s) have no bridge deck`);
  for (const u of unplacedOutdoor) log(`  x unplaced ${u.archetype} ${u.name || ''}: ${u.reason}`);
  for (const x of evidenceMissing) log(`  x missing ${x.archetype}: ${x.reason}`);
  if (gatePropGap) log(`  x ${gatePropGap} gate landmark(s) have no passable gate prop`);
  for (const u of canalUnplaced) log(`  x unplaced canal ${u.name || '水路'}: ${u.reason}`);
  if (canalMissing) log('  x well evidence exists, but town.canal and unplaced canal are both missing');
  for (const t of dryTer) log(`  x terrace top (${t.x},${t.y},${t.w},${t.h}) cannot be reached`);
  for (const s2 of dryStair) log(`  x stair (${s2.x},${s2.y},${s2.w}) cannot be stood on`);
  for (const x of [...bad, ...(verbose ? soft : [])]) {
    const b = x.b;
    log(`  ${x.ok ? '~' : 'x'} ${b.id} ${b.arch ? b.arch.id : b.archetype} at (${b.x},${b.y}) ${b.module?.path ?? ''} [${b.module?.kind ?? ''}]` +
      `  reach: inside=${x.r.inside} floor=${x.r.floor} talk=${x.r.talk}  walk-in(-6,0,+6)=${x.w.map((v) => (v.ok ? 'ok' : `no@${v.end ?? v.why}`)).join(',')}` +
      `  click=${x.c.ok ? 'ok' : x.c.why}`);
    if (!x.ok || verbose) log(`      ${corridorReport(world, b)}; nearest reachable to door: ${x.r.nearest ? `${x.r.nearest[0] - b.px},${x.r.nearest[1] - b.py}` : 'none'}`);
  }
  if (verbose) for (const w of new Set(warns)) log(`  warn: ${w}`);
}
