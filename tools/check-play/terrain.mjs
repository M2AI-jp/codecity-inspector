// Check terraces, stairs, pier decks, and crossings with the real Player physics.
import { TILE as T, FEET_W, FEET_H, FEET_UP, SIM_DT } from '../../web/config.js';
import { Player } from '../../web/player.js';
import { nearSeen, onDeckSeen } from './reach.mjs';

// a prop with an opening (the gate): the player walks under it north -> south and south -> north,
// holding one key, with the runtime's Player physics; both ends must be reachable from the spawn
function throughGate(world, seen, p) {
  const op = p.def.opening;
  const cx = Math.round(p.x + op[0] + op[2] / 2), top = p.y + op[1], bottom = p.y + op[1] + op[3];
  const south = { x: cx, y: Math.round(bottom + 10) }, north = { x: cx, y: Math.round(top - 8) };
  const run = (from, dy, done) => {
    const pl = new Player(from.x, from.y, null);
    if (world.feetHit(pl.x, pl.y)) return false;
    const input = { slow: false, axis(o) { o.x = 0; o.y = dy; return o; } };
    for (let t = 0; t < 2; t += SIM_DT) { pl.update(SIM_DT, input, world); if (done(pl)) return true; }
    return false;
  };
  const r = {
    southReach: nearSeen(world, seen, south.x, south.y, 6), northReach: nearSeen(world, seen, north.x, north.y, 6),
    up: run(south, -1, (pl) => pl.y < top - 2), down: run(north, 1, (pl) => pl.y > bottom + 4),
  };
  r.ok = r.southReach && r.northReach && r.up && r.down;
  return r;
}

// 橋の板の長い向きに沿って、通りの片側から反対側へ Player の当たり判定で渡る。
function throughBridge(world, seen, d) {
  const type = d.prop?.data?.type || d.prop?.type;
  const horizontal = type === 'bridge-h';
  const vertical = type === 'bridge-v';
  if (!horizontal && !vertical) return { ok: false, reason: 'unknown orientation' };
  const hw = FEET_W / 2;
  const findSide = (side) => {
    const x0 = horizontal ? (side < 0 ? d.x - 22 : d.x + d.w + 22) : d.x + d.w / 2;
    const y0 = vertical ? (side < 0 ? d.y - 22 : d.y + d.h + 22) : d.y + d.h / 2 + FEET_UP - FEET_H / 2;
    const xMin = horizontal ? Math.floor(x0 - 10) : Math.floor(d.x + hw + 1);
    const xMax = horizontal ? Math.ceil(x0 + 10) : Math.floor(d.x + d.w - hw - 1);
    const yMin = vertical ? Math.floor(y0 - 10) : Math.ceil(d.y + FEET_UP);
    const yMax = vertical ? Math.ceil(y0 + 10) : Math.floor(d.y + d.h - FEET_H + FEET_UP);
    const points = [];
    for (let y = Math.max(0, yMin); y <= Math.min(world.H - 1, yMax); y++) {
      for (let x = Math.max(0, xMin); x <= Math.min(world.W - 1, xMax); x++) {
        if (seen[y * world.W + x] !== 1 || world.feetHit(x, y)) continue;
        points.push({ x, y, score: Math.abs(x - x0) + Math.abs(y - y0) });
      }
    }
    return points.sort((a, b) => a.score - b.score).slice(0, 16);
  };
  const run = (from, direction) => {
    if (!from) return false;
    const pl = new Player(from.x, from.y, null);
    if (world.feetHit(pl.x, pl.y)) return false;
    const input = { slow: false, axis(o) {
      if (horizontal) { o.x = direction; o.y = 0; }
      else { o.x = 0; o.y = direction; }
      return o;
    } };
    const crossed = horizontal
      ? (p) => direction > 0 ? p.x >= d.x + d.w - 3 : p.x <= d.x + 3
      : (p) => direction > 0 ? p.y >= d.y + d.h - 3 : p.y <= d.y + 3;
    for (let t = 0; t < 3; t += SIM_DT) { pl.update(SIM_DT, input, world); if (crossed(pl)) return true; }
    return false;
  };
  const sideA = findSide(-1), sideB = findSide(1);
  const forward = sideA.find((p) => run(p, 1)) || null;
  const backward = sideB.find((p) => run(p, -1)) || null;
  return { ok: !!(sideA.length && sideB.length && forward && backward), sideA: !!sideA.length, sideB: !!sideB.length, forward: !!forward, backward: !!backward };
}

export function checkTerrain(town, world, seen) {
  // terraces: the raised top can be reached, and every stair can be stood on (climbed from the square / street below)
  const ters = town.terraces || [], strs = town.stairs || [];
  const tileSeen = (tx0, ty0, tx1, ty1) => {
    for (let y = ty0 * T + FEET_UP; y <= (ty1 + 1) * T - FEET_H + FEET_UP; y++) for (let x = tx0 * T + FEET_W / 2; x <= (tx1 + 1) * T - FEET_W / 2; x++) if (seen[y * world.W + x] === 1) return true;
    return false;
  };
  const dryTer = ters.filter((t) => !tileSeen(t.x, t.y, t.x + t.w - 1, t.y + t.h - 1));
  const dryStair = strs.filter((s2) => !tileSeen(s2.x, s2.y, s2.x + s2.w - 1, s2.y));
  // pier decks: some reachable feet box stands fully on each deck
  const decks = world.decks || [];
  const bridgeDecks = decks.filter((d) => ['bridge-h', 'bridge-v'].includes(d.prop?.data?.type || d.prop?.type));
  const pierDecks = decks.filter((d) => !['bridge-h', 'bridge-v'].includes(d.prop?.data?.type || d.prop?.type));
  const dryDecks = pierDecks.filter((d) => !onDeckSeen(world, seen, d));
  const bridgeRuns = bridgeDecks.map((d) => ({ d, r: throughBridge(world, seen, d) }));
  const shutBridges = bridgeRuns.filter((x) => !x.r.ok);
  const expectedBridges = town.canal?.crossings?.length || 0;
  const bridgePropGap = Math.max(0, expectedBridges - bridgeDecks.length);
  // gates (a prop with an opening): walk under it both ways
  const gates = world.props.filter((p) => p.def && Array.isArray(p.def.opening)).map((p) => ({ p, r: throughGate(world, seen, p) }));
  const shutGates = gates.filter((x) => !x.r.ok);
  const failed = dryTer.length + dryStair.length + dryDecks.length +
    shutGates.length + shutBridges.length + bridgePropGap;
  return { ters, strs, dryTer, dryStair, pierDecks, dryDecks, bridgeDecks, shutBridges,
    bridgePropGap, gates, shutGates, failed };
}
