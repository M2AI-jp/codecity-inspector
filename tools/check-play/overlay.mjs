// Check overlay markers, people, goal labels and the solid castle's clear front.
import { TILE as T } from '../../web/config.js';
import { overlayPeople } from '../../web/overlay-world.js';
import { GOAL_ART, goalGeometry } from '../../src/overlay/goal.mjs';
import { nearSeen } from './reach.mjs';

const NEAR_NOTICE_OVERLAY = 36;

export function checkOverlay(town, manifest, world, seen, log) {
  let failed = 0;
  const overlay = town.overlay ? {} : null;
  if (overlay) {
    for (const [kind, items] of [['markers', town.overlay.markers], ['people', overlayPeople(town.overlay)],
      ['goal', town.overlay.goal ? [town.overlay.goal] : []]]) {
      const bad = (items || []).filter((p) => kind === 'goal' && p.look
        ? seen[Math.round(p.y * T) * world.W + Math.round(p.x * T)] !== 1
        : !nearSeen(world, seen, p.x * T, p.y * T, NEAR_NOTICE_OVERLAY));
      overlay[kind] = { reachable: (items || []).length - bad.length, total: (items || []).length };
      failed += bad.length;
      for (const p of bad) log(`  x overlay ${kind} ${p.id} cannot be reached`);
    }
    if (town.overlay.goal?.look) {
      const g = town.overlay.goal, prop = town.props.find((p) => p.overlayId === `goal:${g.id}`), def = manifest.props?.[GOAL_ART[g.look]];
      let frontOK = false, solidOK = false, clearOK = false, frontReachable = 0, frontTotal = 1;
      if (prop && def?.solid && !def.deck && g.landmark?.x === prop.x && g.landmark?.y === prop.y && g.landmark?.look === prop.look) {
        const geo = goalGeometry(prop, def);
        const points = geo.cells(geo.front);
        frontTotal = points.length;
        frontReachable = points.filter(([x, y]) => seen[(y * T + 11) * world.W + x * T + 8] === 1).length;
        frontOK = frontReachable === frontTotal;
        solidOK = world.rects.some((r) => r.overlayProp === prop.overlayId &&
          ['x', 'y', 'w', 'h'].every((k) => r[k] === geo.foot[k]));
        clearOK = [geo.front, ...geo.sides].every((r) => !world.boxHits(r.x, r.y, r.x + r.w, r.y + r.h));
        if (JSON.stringify(g.front) !== JSON.stringify({ x: geo.front.x / T, y: geo.front.y / T, w: geo.front.w / T, h: geo.front.h / T })) {
          frontOK = false;
        }
      }
      overlay.goalFront = { reachable: frontReachable, total: frontTotal };
      if (!frontOK || !solidOK || !clearOK) {
        failed++;
        log(`  x overlay goal ${g.id} landmark: front reachable=${frontOK}, solid=${solidOK}, clearance=${clearOK}`);
      }
      log(`overlay goal front: ${overlay.goalFront.reachable}/${overlay.goalFront.total} cells reachable; solid=${solidOK}, clearance=${clearOK}`);
    }
    overlay.unplaced = (town.unplaced || []).filter((u) => u.overlay).length;
    const unexplained = (town.unplaced || []).filter((u) => u.overlay && !u.reason?.trim());
    failed += unexplained.length;
    for (const u of unexplained) log(`  x overlay ${u.id} unplaced without reason`);
    log(`overlay: markers ${overlay.markers.reachable}/${overlay.markers.total}, people (including gate keepers) ${overlay.people.reachable}/${overlay.people.total}, goal ${overlay.goal.reachable}/${overlay.goal.total} reachable; unplaced ${overlay.unplaced}, unexplained ${unexplained.length}`);
  }
  return { overlay, failed };
}
