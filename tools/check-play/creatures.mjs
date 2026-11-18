// The browser creates creatures without DOM access; only bubble rendering needs the DOM.
import { createCreatures } from '../../web/creatures.js';
import { createNearby } from '../../web/nearby.js';
import { Overlay } from '../../web/overlay.js';
import { overlayPeople } from '../../web/overlay-world.js';
import { NEAR_RESIDENT } from '../../web/config.js';

export function checkCreatures(town, manifest, world, npcs, seen) {
  const sheets = Object.fromEntries(Object.entries(manifest.creatures || {})
    .filter(([, d]) => d?.src).map(([name]) => [name, { stub: true }]));
  const creatures = createCreatures(town, world, sheets);
  const player = { x: 0, y: 0 };
  let selected = null;
  // Use the actual speaker priority (keepers, walkers, creatures, overlay).
  // Only the DOM bubble/UI sinks are replaced; creation, positions and pick stay intact.
  const updateNearby = createNearby({
    town, world, player, movers: [...npcs.walkers, ...npcs.locals, ...npcs.contractors],
    outdoorKeepers: npcs.keepers.filter((k) => k.outdoor),
    creatures: { pick: creatures.pick, bubble(_view, _player, best) { selected = best; } },
    ui: { curKeeper: null, update() {} },
  });
  const overlay = town.overlay ? {
    data: town.overlay,
    markers: new Map((town.overlay.markers || []).map((m) => [m.id, m])),
    people: new Map(overlayPeople(town.overlay).map((p) => [p.runtimeId, { def: p }])),
    nearest: Overlay.prototype.nearest, update() {},
  } : null;

  function talkSpot(creature) {
    // The resident radius bounds the smaller creature radius. pick() itself decides
    // the exact distance, grounding and ties; do not duplicate its 26px rule.
    const r = NEAR_RESIDENT;
    for (let y = Math.max(0, Math.floor(creature.y - r)); y <= Math.min(world.H - 1, Math.ceil(creature.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(creature.x - r)); x <= Math.min(world.W - 1, Math.ceil(creature.x + r)); x++) {
        if (seen[y * world.W + x] !== 1) continue;
        player.x = x; player.y = y;
        updateNearby(world.buildingAtPx(x, y), null, 0, false, overlay);
        if (selected === creature) return { x, y };
      }
    }
    return null;
  }
  const entries = (town.creatures || []).map((def, index) => {
    const c = creatures.list.find((c) => c.d === def);
    const row = { id: index, kind: def?.kind, name: def?.name, home: def?.home, reasons: [] };
    if (!c) { row.reasons.push('browser did not create this creature (invalid home)'); return row; }
    row.x = c.x; row.y = c.y;
    if (!c.sheet) row.reasons.push('creature sprite missing');
    // free() is the runtime's 6x4px body collision + building exclusion; water without
    // a walkable deck also collides. Do not test with the larger player's feet.
    if (!c.free(c.x, c.y)) row.reasons.push('initial position is not free for this creature (water, solid or building)');
    const b = world.buildingAtPx(c.x, c.y);
    if (b) row.reasons.push(`initial position inside building ${b.id}`);
    row.talk = talkSpot(c);
    if (!row.talk) row.reasons.push('no reachable player position selects this creature for a talk');
    return row;
  });
  return { total: entries.length, created: creatures.list.length, failed: entries.filter((r) => r.reasons.length).length, entries };
}
