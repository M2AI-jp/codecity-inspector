// Check floor access, keeper conversations, keyboard entry and click entry.
import { TILE as T, FEET_W, FEET_H, FEET_UP, SIM_DT, NEAR_KEEPER } from '../../web/config.js';
import { Player } from '../../web/player.js';

// feet positions whose box stands fully on the building's floor
export function floorBox(b) {
  if (b.floor) return b.floor;
  return { x0: b.px + T, y0: b.py + 2 * T, x1: b.px + b.pw - T, y1: b.bottomPx - T };
}
const onFloor = (b, x, y) => {
  const f = floorBox(b), hw = FEET_W / 2;
  return x - hw >= f.x0 && x + hw <= f.x1 && y - FEET_UP >= f.y0 && y - FEET_UP + FEET_H <= f.y1;
};

function reachOf(world, seen, b) {
  const W = world.W;
  let floor = false, talk = !b.keeper, inside = false;
  let best = null, bestD = Infinity;
  const k = b.keeper;
  const y0 = Math.max(0, b.py - 8), y1 = Math.min(world.H - 1, b.bottomPx + 24);
  for (let y = y0; y <= y1; y++) for (let x = b.px; x < b.px + b.pw; x++) {
    if (seen[y * W + x] !== 1) continue;
    const inB = world.buildingAtPx(x, y) === b;
    if (inB) inside = true;
    if (inB && onFloor(b, x, y)) floor = true;
    if (inB && k && Math.hypot(k.x - x, k.y - y) < NEAR_KEEPER) talk = true;
    // closest reachable point to the door (for the diagnosis)
    const d = Math.hypot(x - b.doorPx, y - (b.bottomPx - 4));
    if (d < bestD) { bestD = d; best = [x, y]; }
  }
  return { inside, floor, talk, nearest: best };
}

// the player holding "up" from just outside the door, with the runtime's Player physics
function walkIn(world, b, dx) {
  const p = new Player(b.doorPx + dx, b.bottomPx + 9, null);
  if (world.feetHit(p.x, p.y)) return { ok: false, why: 'start blocked' };
  const input = { slow: false, axis(o) { o.x = 0; o.y = -1; return o; } };
  let ok = false;
  for (let t = 0; t < 1.5 && !ok; t += SIM_DT) {
    p.update(SIM_DT, input, world);
    if (world.buildingAtPx(p.x, p.y) === b && onFloor(b, p.x, p.y)) ok = true;
  }
  return { ok, end: [Math.round(p.x - b.px), Math.round(p.y - b.py)] };
}

// click on the building from the spawn: web/main.js walkToWorld() for a building target
function clickIn(world, b, start) {
  const route = world.pathInto(b, start.x, start.y);
  if (!route) return { ok: false, why: 'no path' };
  const p = new Player(start.x, start.y, null);
  p.setPath(route.points, route.target);
  const input = { slow: false, axis(o) { o.x = 0; o.y = 0; return o; } };
  for (let t = 0; t < 120 && p.path; t += SIM_DT) {
    p.update(SIM_DT, input, world);
    if (world.buildingAtPx(p.x, p.y) === b && onFloor(b, p.x, p.y)) return { ok: true };
  }
  return { ok: false, why: `stuck@${Math.round(p.x - b.px)},${Math.round(p.y - b.py)}` };
}

export function checkBuildings(world, seen, start) {
  const rows = [];
  for (const b of world.buildings) {
    const r = reachOf(world, seen, b);
    const w = [-6, 0, 6].map((dx) => walkIn(world, b, dx));
    const walkOk = w.filter((x) => x.ok).length;
    const c = clickIn(world, b, start);
    const ok = r.floor && r.talk && walkOk >= 1 && c.ok;
    rows.push({ b, r, w, c, walkOk, ok });
  }
  const bad = rows.filter((x) => !x.ok);
  const soft = rows.filter((x) => x.ok && x.walkOk < 3);
  return { bad, soft, failed: bad.length };
}
