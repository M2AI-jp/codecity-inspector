// Creature direction, free ground, and collision-aware movement.
export const dirOf = (dx, dy, cur) => (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 ? cur
  : Math.abs(dx) >= Math.abs(dy) * 0.8 ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down');

export function free(creature, px, py) {
  const w = creature.world;
  return !w.boxHits(px - 3, py - 3, px + 3, py + 1) && !w.buildingAtPx(px, py);
}

// a free spot within r px of (cx, cy), at least away px from (ax, ay)
export function spot(creature, cx, cy, r, ax, ay, away = 0) {
  for (let i = 0; i < 16; i++) {
    const a = creature.rand() * Math.PI * 2, d = Math.sqrt(creature.rand()) * r;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (away && Math.hypot(x - ax, y - ay) < away) continue;
    if (creature.free(x, y)) return { x, y };
  }
  return null;
}

// walk toward the target at speed; slides along blockers; returns true on arrival / when stuck
export function moveTo(creature, tx, ty, speed, dt) {
  const dx = tx - creature.x, dy = ty - creature.y, dist = Math.hypot(dx, dy);
  if (dist < 1) return true;
  const s = Math.min(dist, speed * dt);
  const nx = creature.x + (dx / dist) * s, ny = creature.y + (dy / dist) * s;
  creature.facing = dirOf(dx, dy, creature.facing);
  if (creature.free(nx, ny)) { creature.x = nx; creature.y = ny; return false; }
  if (creature.free(nx, creature.y)) { creature.x = nx; return false; }
  if (creature.free(creature.x, ny)) { creature.y = ny; return false; }
  return true;
}
