import { doorClearanceConflicts } from '../door-clearance.mjs';
import { stairClearanceConflicts } from '../stair-clearance.mjs';
import { hash32 } from './util.mjs';

// The distance between footprint rectangles, including diagonally adjacent buildings.
export function footprintGap(a, b) {
  const dx = Math.max(0, a.x - b.x - b.w, b.x - a.x - a.w);
  const dy = Math.max(0, a.y - b.y - b.h, b.y - a.y - a.h);
  return Math.hypot(dx, dy);
}

// A doorway retry freezes every variant before moving buildings. Revisit nearby duplicates
// after that move, for every archetype, without obstructing a doorway or stair.
export function separateNearbyVariants(placed, variantOf, art, stairs = []) {
  const ordered = [...placed].sort((a, b) => a.yb - b.yb || a.x - b.x || a.spec.id.localeCompare(b.spec.id));
  const neighbours = new Map(ordered.map((p) => [p, ordered.filter((q) =>
    q !== p && q.spec.archetype === p.spec.archetype && footprintGap(p, q) <= 2)]));
  const building = (p, v = variantOf.get(p)) => ({
    ...p, id: p.spec.id, archetype: p.spec.archetype, variant: v?.id,
    door: { x: p.x + Math.max(0, Math.min(p.w - 1, v?.doorX ?? p.spec.doorDx)), y: p.yb },
  });
  let changed;
  do {
    changed = false;
    for (const p of ordered) {
      const vs = art[p.spec.archetype]?.variants || [], current = variantOf.get(p);
      if (vs.length < 2 || !current) continue;
      const score = (v) => neighbours.get(p).filter((q) => variantOf.get(q)?.id === v.id).length;
      const before = score(current);
      if (!before) continue;
      const start = hash32(`near-variant:${p.spec.id}`) % vs.length;
      const candidates = vs.map((_, k) => vs[(start + k) % vs.length]).filter((v) => score(v) < before)
        .sort((a, b) => score(a) - score(b));
      for (const v of candidates) {
        const buildings = ordered.map((q) => building(q, q === p ? v : variantOf.get(q)));
        if (doorClearanceConflicts({ buildings }, art).some((c) => c.door.id === p.spec.id || c.object.id === p.spec.id)) continue;
        if (stairClearanceConflicts({ buildings, stairs }, art, {}).some((c) => c.object.id === p.spec.id)) continue;
        variantOf.set(p, v);
        changed = true;
        break;
      }
    }
  } while (changed); // Each change strictly reduces the total number of equal neighbouring pairs.
}
