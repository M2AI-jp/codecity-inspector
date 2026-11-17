import { resolveAt } from '../../overlay/resolve.mjs';

// Reserve the optional landmark before ordinary buildings consume its frontage.
// Use the same anchor and distance as placeOverlay; never send it to an outer row.
export function placeGoal(S) {
  const spec = S.pending.early.find((s) => s.goalSite);
  if (!spec) return true;
  const hall = S.terraces.find((t) => t.hall);
  const target = resolveAt({
    buildings: S.placed.map((p) => ({ ...p, ...p.spec,
      door: { x: p.x + (S.C.doorVariants?.get(p.spec.id)?.doorX ?? p.spec.doorDx), y: p.yb } })),
    landmarks: [], ground: [],
    spawn: { x: S.cx, y: hall ? hall.y + hall.h + 1 : S.plaza.y0 + 2 },
  }, S.C.goalAt || { landmark: 'town_hall' }, { kind: 'goal' });
  // A referenced ordinary building/group may not have been placed yet.
  const anchor = target.reason ? { x: S.cx, y: S.plaza.y0 + 2 } : target;
  const candidates = [];
  for (const track of S.tracks) {
    if (track.innOnly) continue;
    for (let x = track.x0; x <= track.x1 - spec.w + 1; x++) {
      for (const setback of [0, 1, 2]) {
        const pos = S.fit(track, x, spec, setback, !!track.dense);
        if (!pos) continue;
        const distance = Math.hypot(pos.x + spec.w / 2 - anchor.x, pos.y + spec.h - anchor.y);
        if (distance <= 24) candidates.push({ track, pos, distance });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  if (!candidates.length) return false;
  const { track, pos } = candidates[0];
  S.commit(spec, track, pos, '\u0000goal-site');
  S.pending.early.splice(S.pending.early.indexOf(spec), 1);
  return true;
}
