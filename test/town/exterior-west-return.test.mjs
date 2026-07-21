// test/town/exterior-west-return.test.mjs
//
// Regression coverage for three exterior-collision fixes identified by a
// prior code-audit + live playtest of public/fable5-v2 (see the
// WALKABLE_ROUTE_POLYGONS / EXTERIOR_BLOCKERS comments in world-runtime.mjs
// for the fix rationale at each site):
//
//   1. CIVIC_PLAZA <-> EAST_MARKET_ROAD used to leave a seam (~x:1090-1106,
//      y:495-520) that belonged to neither walkable polygon, so an actor
//      crossing that band with no north-south input could not get through.
//   2. The two east-market lamp bases ('east-road-west-lamp-base' at
//      1308,472 and 'east-road-east-lamp-base' at 1510,474) used to carry a
//      ground collider wide enough, once padded by the actor's own
//      footprint, to block the entire ~115px-tall road at that point.
//   3. 'plaza-south-planters' used to sit on open pavement ~30px south of
//      the actual planter art and blocked the natural approach to the well
//      investigation point (850,440), which real playtesting hit directly
//      ("here is impassable" repeatedly near the well).
//
// The capstone test at the bottom reproduces the audit's own method exactly
// end to end: from every walkable point on a grid inside the east market
// (x=1150/1300/1450, y=410..540 step 5, the same grid the audit used), hold
// a pure WEST input and run the real moveActor()/isExteriorWalkable() pair
// (imported, not ported) to see whether the actor reaches the inn door
// trigger. At audit time only 3 of 21 walkable starting rows got there.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTERIOR_BLOCKERS,
  INN_CONTRACT,
  WALKABLE_ROUTE_POLYGONS,
  isExteriorWalkable,
  moveActor,
  nearbyInteraction,
  pointInPolygon
} from '../../public/fable5-v2/world-runtime.mjs';

const FRAME_SECONDS = 1 / 60;
// 30s of simulated travel at 75px/s covers >2000px, well over the ~1600px
// world width; the worst passing case measured at fix time took ~17s.
const MAX_FRAMES = 1800;
const STUCK_FRAME_TOLERANCE = 3;

function insideRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function inSomeWalkablePolygon(x, y) {
  return WALKABLE_ROUTE_POLYGONS.some((polygon) => pointInPolygon(x, y, polygon));
}

/**
 * Holds a constant due-west input against the real moveActor()/
 * isExteriorWalkable() pair, frame by frame, until the actor enters the inn
 * door trigger, stops moving for more than STUCK_FRAME_TOLERANCE consecutive
 * frames, or MAX_FRAMES elapses. Mirrors the prior audit's own simulation
 * method (ported once from Python to confirm the diagnosis, now run
 * directly against the production functions as a permanent regression).
 */
function simulateWestOnlyReturn(startX, startY) {
  const trigger = INN_CONTRACT.door.triggerRect;
  let position = { x: startX, y: startY, facing: 'west' };
  let stuckStreak = 0;
  let frame = 0;
  for (; frame < MAX_FRAMES; frame += 1) {
    const next = moveActor(position, { x: -1, y: 0 }, FRAME_SECONDS, 'exterior');
    position = { x: next.x, y: next.y, facing: next.facing };
    if (insideRect(position.x, position.y, trigger)) {
      return { reached: true, endX: position.x, endY: position.y, frames: frame + 1 };
    }
    if (!next.moved) {
      stuckStreak += 1;
      if (stuckStreak > STUCK_FRAME_TOLERANCE) break;
    } else {
      stuckStreak = 0;
    }
  }
  return { reached: false, endX: position.x, endY: position.y, frames: frame };
}

test('moveActor never changes y while the held input is purely west', () => {
  // vector.y is exactly 0 for a pure west input, so nextY = y + 0*distance
  // is a no-op every frame. This is a load-bearing invariant for the
  // capstone simulation below: only starting rows whose y already sits
  // inside the door trigger's y-span can ever reach it under pure
  // west-only input, no matter how the walkable polygons are shaped.
  for (const y of [410, 452, 473, 488, 540]) {
    const next = moveActor({ x: 1000, y, facing: 'south' }, { x: -1, y: 0 }, FRAME_SECONDS, 'exterior');
    assert.equal(next.y, y, `y drifted from ${y} under a pure west input`);
  }
});

// --- item 1: CIVIC_PLAZA <-> EAST_MARKET_ROAD seam -------------------------

test('the CIVIC_PLAZA/EAST_MARKET_ROAD seam no longer leaves a gap outside every walkable polygon', () => {
  // These exact points sat outside the union of every WALKABLE_ROUTE_POLYGON
  // before the fix (verified against the pre-fix polygon data) and must be
  // inside it now.
  for (const [x, y] of [[1092, 505], [1095, 510], [1098, 515], [1090, 520], [1099, 519]]) {
    assert.equal(inSomeWalkablePolygon(x, y), true, `(${x},${y}) should join CIVIC_PLAZA/EAST_MARKET_ROAD with no seam`);
  }
  // A pure-west walk through the old seam's row band must now make it
  // measurably further west than the pre-fix dead stop. Before the fix,
  // moveActor().blocked at these rows landed around x=1106-1113 (measured);
  // the seam fix lets the same walk continue to x<=1103, past that old wall,
  // before running into the separately-scoped (unfixed) wider tree-line gap
  // further west. This only claims the specific seam is gone, not that the
  // whole plaza connects at this row.
  for (const startY of [498, 505, 510]) {
    let position = { x: 1110, y: startY, facing: 'west' };
    for (let frame = 0; frame < 60; frame += 1) {
      const next = moveActor(position, { x: -1, y: 0 }, FRAME_SECONDS, 'exterior');
      if (!next.moved) break;
      position = { x: next.x, y: next.y, facing: next.facing };
    }
    assert.ok(position.x <= 1103, `expected to pass the old seam dead-stop (~1106-1113) at y=${startY}, stalled at x=${position.x}`);
  }
});

// --- item 2: east-market lamp bases -----------------------------------------

test('the two east-market lamp bases no longer carry a road-blocking ground collider', () => {
  const blockerIds = new Set(EXTERIOR_BLOCKERS.map(({ id }) => id));
  assert.equal(blockerIds.has('east-road-west-lamp-base'), false);
  assert.equal(blockerIds.has('east-road-east-lamp-base'), false);

  // The lamp posts remain background/foreground art (unchanged); only their
  // ground collider is gone, so their own base position is now walkable.
  assert.equal(isExteriorWalkable(1308, 472), true, 'east-road-west-lamp-base position');
  assert.equal(isExteriorWalkable(1510, 474), true, 'east-road-east-lamp-base position');

  // A westbound actor holding a pure west input must be able to cross both
  // lamps' old x-span (~1286-1330 and ~1488-1532 padded) at a representative
  // door-trigger-height row without ever reporting blocked.
  for (const startY of [475, 480, 485]) {
    let position = { x: 1560, y: startY, facing: 'west' };
    for (let frame = 0; frame < 400 && position.x > 1200; frame += 1) {
      const next = moveActor(position, { x: -1, y: 0 }, FRAME_SECONDS, 'exterior');
      assert.equal(next.moved, true, `blocked crossing the lamps at y=${startY}, x=${position.x}`);
      position = { x: next.x, y: next.y, facing: next.facing };
    }
    assert.ok(position.x <= 1200, `expected to cross both lamps from x=1560 to x<=1200 at y=${startY}, stopped at x=${position.x}`);
  }
});

// --- item 3: plaza-south-planters -------------------------------------------

test('plaza-south-planters is resized to the planter art and no longer blocks the well approach', () => {
  const planter = EXTERIOR_BLOCKERS.find(({ id }) => id === 'plaza-south-planters');
  assert.ok(planter, 'plaza-south-planters should still exist as a (smaller) blocker');
  assert.ok(planter.radiusX < 18 && planter.radiusY < 14, 'planter collider should have shrunk from its old 18x14 radius');

  // The old collider (801,429, 18x14) sat on open pavement south of the
  // planter art and is walkable again now that the collider matches the art.
  assert.equal(isExteriorWalkable(801, 429), true);

  const wellPoint = { x: 850, y: 440 };
  assert.equal(isExteriorWalkable(wellPoint.x, wellPoint.y), true);

  // A natural west-to-east approach along the well's own interaction row
  // must reach the clue's interaction radius without ever getting blocked.
  let position = { x: 700, y: 440, facing: 'east' };
  let reachedWell = false;
  for (let frame = 0; frame < 400; frame += 1) {
    const next = moveActor(position, { x: 1, y: 0 }, FRAME_SECONDS, 'exterior');
    assert.equal(next.moved, true, `blocked approaching the well from the west, x=${position.x}`);
    position = { x: next.x, y: next.y, facing: next.facing };
    if (nearbyInteraction(position, 'exterior')?.id === 'clue-well') {
      reachedWell = true;
      break;
    }
  }
  assert.ok(reachedWell, `expected to trigger the well clue walking east along y=440, ended at x=${position.x}`);
});

// --- item 4: the audit's own end-to-end simulation, reproduced -------------

test('west-only return simulation (real moveActor/isExteriorWalkable, not a port): every reachable east-market row reaches the inn door trigger', () => {
  const trigger = INN_CONTRACT.door.triggerRect;
  const grid = [];
  for (const startX of [1150, 1300, 1450]) {
    for (let startY = 410; startY <= 540; startY += 5) grid.push({ startX, startY });
  }

  const walkableStarts = grid.filter(({ startX, startY }) => isExteriorWalkable(startX, startY));
  // Pre-fix this was 21; the lamp fix alone frees up additional walkable
  // starting rows directly under the former lamp colliders.
  assert.ok(walkableStarts.length >= 21, `expected a broad walkable band across the grid, found ${walkableStarts.length}`);

  const results = walkableStarts.map(({ startX, startY }) => (
    { startX, startY, ...simulateWestOnlyReturn(startX, startY) }
  ));

  // Only starting rows whose y already sits inside the door trigger's own
  // y-span can ever enter it under pure west-only input (see the invariant
  // test above) — this is a fact about the door trigger's height, not a
  // walkability bug, so it is computed from INN_CONTRACT rather than
  // hard-coded. Every such row is the audit's actual target and must now
  // succeed.
  const feasible = results.filter(({ startY }) => startY >= trigger.y && startY <= trigger.y + trigger.height);
  assert.ok(feasible.length > 0, "expected at least one starting row inside the door trigger's y-span");

  const failures = feasible.filter((result) => !result.reached);
  assert.deepEqual(
    failures.map(({ startX, startY, endX, endY, frames }) => (
      `(${startX},${startY}) stuck at (${endX},${endY}) after ${frames} frames`
    )),
    [],
    'every reachable-in-principle east-market row must reach the inn door trigger under west-only input'
  );

  // Rows outside the trigger's y-span cannot mathematically enter it under
  // pure west-only input regardless of collision geometry; assert the
  // simulation still terminates cleanly for them (no crash, no y drift)
  // instead of silently excluding them from coverage.
  const outOfBand = results.filter(({ startY }) => startY < trigger.y || startY > trigger.y + trigger.height);
  assert.ok(outOfBand.length > 0, 'expected the grid to include rows outside the door trigger\'s y-span too');
  for (const result of outOfBand) {
    assert.equal(result.reached, false, `(${result.startX},${result.startY}) unexpectedly entered the trigger despite its y falling outside the trigger's span`);
    assert.equal(result.endY, result.startY, 'y must stay exactly invariant under pure west input');
  }
});
