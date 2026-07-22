export const WORLD_WIDTH = 1586;
export const WORLD_HEIGHT = 992;
export const GAMEPLAY_ZOOM = 1;
export const PLAYER_WALK_FRAME_DURATION_MS = 70;

export const ACTOR_CONTRACT = Object.freeze({
  frameWidth: 64,
  frameHeight: 128,
  footPivotX: 32,
  footPivotY: 120,
  radiusX: 12,
  radiusY: 7,
  speed: 75,
  spawn: Object.freeze({ x: 650, y: 520 }),
  directionRows: Object.freeze({ south: 0, west: 1, east: 2, north: 3 })
});

export const INN_CONTRACT = Object.freeze({
  id: 'inn',
  visualBBox: Object.freeze({ x: 8, y: 116, width: 397, height: 358 }),
  lotBBox: Object.freeze({ x: 0, y: 116, width: 430, height: 416 }),
  door: Object.freeze({
    observedRect: Object.freeze({ x: 190, y: 409, width: 44, height: 62 }),
    foot: Object.freeze({ x: 212, y: 470 }),
    triggerRect: Object.freeze({ x: 180, y: 452, width: 64, height: 36 }),
    approachPoint: Object.freeze({ x: 212, y: 480 }),
    returnPoint: Object.freeze({ x: 212, y: 497 })
  }),
  objects: Object.freeze({
    bartenderOrigin: Object.freeze({ x: 202, y: 255 }),
    entranceForegroundOrigin: Object.freeze({ x: 145, y: 397 }),
    routeStreetlampOrigin: Object.freeze({ x: 302, y: 464 }),
    routeStreetlampFoot: Object.freeze({ x: 327, y: 624 })
  }),
  interior: Object.freeze({
    walkPolygon: Object.freeze([
      Object.freeze([164, 382]), Object.freeze([260, 382]),
      Object.freeze([260, 420]), Object.freeze([236, 420]),
      Object.freeze([236, 450]), Object.freeze([188, 450]),
      Object.freeze([188, 420]), Object.freeze([164, 420])
    ]),
    entryFoot: Object.freeze({ x: 212, y: 438 }),
    exitFoot: Object.freeze({ x: 212, y: 446 }),
    cameraFocus: Object.freeze({ x: 212, y: 300 }),
    npcVisibleLowerBound: Object.freeze({ x: 224, y: 309 }),
    npcInteractionPoint: Object.freeze({ x: 224, y: 344 }),
    npcDialogueAnchor: Object.freeze({ x: 224, y: 309 }),
    npcUiConnectorAnchor: Object.freeze({ x: 224, y: 258 }),
    npcFacing: 'south'
  })
});

// Fixed site geometry only. The per-site investigation text is NOT stored here:
// it is produced from the live /api/town payload by buildInvestigation() so a
// different repository yields a different case. Coordinates, radius, anchors,
// and the observed/inferred/unknown class each site reports are the stable part;
// the body prose is the data-driven part.
export const CLUE_INTERACTIONS = Object.freeze([
  Object.freeze({
    id: 'clue-streetlamp',
    label: '台座の印を調べる',
    shortLabel: '古い街灯',
    place: '古町の街灯',
    point: Object.freeze({ x: 327, y: 545 }),
    anchor: Object.freeze({ x: 327, y: 492 }),
    radius: 34,
    evidenceClass: 'observed',
    evidenceLabel: '観測の手掛かり'
  }),
  Object.freeze({
    id: 'clue-well',
    label: '井戸の縁を調べる',
    shortLabel: '中央広場の井戸',
    place: '中央広場の井戸',
    point: Object.freeze({ x: 850, y: 440 }),
    anchor: Object.freeze({ x: 850, y: 374 }),
    radius: 38,
    evidenceClass: 'inferred',
    evidenceLabel: '推定の手掛かり'
  }),
  Object.freeze({
    id: 'clue-east-shop',
    label: '閉じた看板を調べる',
    shortLabel: '東市場の看板',
    place: '東市場の店',
    point: Object.freeze({ x: 1200, y: 480 }),
    anchor: Object.freeze({ x: 1200, y: 405 }),
    radius: 40,
    evidenceClass: 'unknown',
    evidenceLabel: '不明の手掛かり'
  })
]);

// Fable5VerticalSlice24x16.md requirement 4: "未実装入口は装飾扉として偽らず、閉鎖状態と
// 理由を一貫したUXで示す". Before this, walking up to the town hall / a house / an east
// market shop produced no signal at all beyond the same generic bump message every other
// obstacle (a bench, a lamp post) already gives via registerBump() in app.js -- the player
// could not tell "this is a real, permanently closed entrance" from "this is scenery you
// should walk around". Each entry below pairs a doorway visually confirmed against
// target-town-user-direct-v1.png (1586x992, the accepted offline ground truth
// now reconstructed at runtime from verified prefabs) with a walkable approach
// point in front of it (verified with isExteriorWalkable against this same
// reference) and a
// world-appropriate reason. nearbyInteraction() below reports these only after the
// CLUE_INTERACTIONS loop, so a genuine investigation hotspot (e.g. clue-east-shop's sign,
// 195px away from closed-eastshop's own point) always keeps priority over the ambient
// "this is closed" message when both would otherwise be in range.
//
// Door measurements (pixel rects visually confirmed against the runtime background):
//   - town hall: recessed double-door arch approx x 605-675, y 155-222, at the top of a
//     staircase whose bottom step meets the plaza's own north edge (CIVIC_PLAZA's y=285
//     top edge) around x 590-690. closed-townhall's point (640,296) is the nearest
//     confirmed-walkable spot centred under that door.
//   - house: a residential door approx x 965-1030, y 210-270, in the townhouse row east of
//     the town hall (Fable5VerticalSlice24x16.md's "一般家屋"). closed-house's point
//     (997,296) is the nearest confirmed-walkable spot centred under it.
//   - east market shop: the second (east) market stall's open counter/doorway approx
//     x 1370-1420, y 380-440, distinct from the first stall's signboard that
//     clue-east-shop already investigates. closed-eastshop's point (1395,480) is the
//     nearest confirmed-walkable spot in front of it.
export const CLOSED_ENTRANCES = Object.freeze([
  Object.freeze({
    id: 'closed-townhall',
    label: '市庁舎は現在閉まっている。役人は出払っているようだ。',
    shortLabel: '市庁舎の正面扉',
    place: '古町の市庁舎',
    point: Object.freeze({ x: 640, y: 296 }),
    radius: 55
  }),
  Object.freeze({
    id: 'closed-house',
    label: 'この家の扉は閉ざされている。住人は留守のようだ。',
    shortLabel: '住宅の扉',
    place: '古町の住宅',
    point: Object.freeze({ x: 997, y: 296 }),
    radius: 55
  }),
  Object.freeze({
    id: 'closed-eastshop',
    label: 'この店の扉も閉ざされている。看板と同じく、今日は開いていないようだ。',
    shortLabel: '東市場の店の扉',
    place: '東市場の店',
    point: Object.freeze({ x: 1395, y: 480 }),
    radius: 55
  })
]);

// Pure classification helper so app.js (registerBump, updateNearby) never has to repeat
// the 'closed-' id-prefix convention inline. A closed entrance is deliberately
// non-actionable -- there is nothing to press Enter/E/the action button for -- so callers
// use this to suppress the key hint and disable the action button, not just to pick which
// message string to show.
export function isClosedEntranceId(id) {
  return typeof id === 'string' && id.startsWith('closed-');
}

const MAIN_ROAD = Object.freeze([
  // Include the visible north cobble edge so the actor footprint, not just its
  // centre point, can cross the plaza/road join at y=480.
  Object.freeze([214, 465]), Object.freeze([700, 465]),
  Object.freeze([700, 558]), Object.freeze([214, 558])
]);

const INN_ROUTE = Object.freeze([
  Object.freeze([188, 458]), Object.freeze([236, 458]),
  Object.freeze([236, 506]), Object.freeze([188, 506])
]);

// Observed visible cobblestone west of the inn/main-road junction. The lower
// edge follows the street as it bends around the roof and tree mass rather
// than opening the entire image rectangle.
const WEST_MARKET_ROAD = Object.freeze([
  Object.freeze([0, 530]), Object.freeze([180, 510]),
  Object.freeze([180, 490]), Object.freeze([430, 490]),
  Object.freeze([430, 570]), Object.freeze([180, 570]),
  Object.freeze([120, 620]), Object.freeze([0, 660])
]);

// Observed central plaza paving. The small southwest and southeast notches
// join the main road without admitting either inn frontage or garden trees.
const CIVIC_PLAZA = Object.freeze([
  Object.freeze([450, 285]), Object.freeze([1090, 285]),
  Object.freeze([1090, 455]), Object.freeze([1040, 455]),
  Object.freeze([1040, 480]), Object.freeze([760, 480]),
  Object.freeze([760, 520]), Object.freeze([430, 520]),
  Object.freeze([430, 455]), Object.freeze([450, 455])
]);

// Observed east-west paving in front of the two eastern shops. Their steps,
// walls, barrels, and lamps remain blockers below.
//
// The deep (y=520) southern step used to start at x=1100, exactly matching
// CIVIC_PLAZA's own east edge (x=1090) only along that single shared column.
// Because isExteriorWalkable requires the actor's whole footprint (not just
// its centre) to stay on measured paving, that 10px seam left a sliver
// (~x:1090-1106, y:495-520) that belonged to neither polygon: an actor
// holding a purely east-west heading through that band could not cross it.
// Starting the deep step at x=1090 instead removes the seam and keeps the
// same footprint everywhere else.
const EAST_MARKET_ROAD = Object.freeze([
  Object.freeze([660, 410]), Object.freeze([1100, 410]),
  Object.freeze([1100, 405]), Object.freeze([1586, 405]),
  Object.freeze([1586, 520]), Object.freeze([1090, 520]),
  Object.freeze([1090, 500]), Object.freeze([780, 500]),
  Object.freeze([780, 540]), Object.freeze([660, 540])
]);

// The central path visibly continues south between tree and building masses.
// Three overlapping quadrilaterals track its bends conservatively and keep
// the opaque vegetation outside the walkable union.
const SOUTH_PATH_NORTH = Object.freeze([
  Object.freeze([690, 510]), Object.freeze([780, 510]),
  Object.freeze([770, 650]), Object.freeze([650, 650])
]);

const SOUTH_PATH_MIDDLE = Object.freeze([
  Object.freeze([650, 620]), Object.freeze([770, 620]),
  Object.freeze([710, 820]), Object.freeze([590, 820])
]);

const SOUTH_PATH_END = Object.freeze([
  Object.freeze([590, 790]), Object.freeze([710, 790]),
  Object.freeze([700, 992]), Object.freeze([580, 992])
]);

export const WALKABLE_ROUTE_POLYGONS = Object.freeze([
  MAIN_ROAD,
  INN_ROUTE,
  WEST_MARKET_ROAD,
  CIVIC_PLAZA,
  EAST_MARKET_ROAD,
  SOUTH_PATH_NORTH,
  SOUTH_PATH_MIDDLE,
  SOUTH_PATH_END
]);

// Only collision with a measured or explicitly inferred geometry-v2 shape is
// represented. Unknown alpha edges are intentionally not invented here.
export const EXTERIOR_BLOCKERS = Object.freeze([
  Object.freeze({ id: 'inn-west-frontage', shape: 'rect', x: 0, y: 427, width: 188, height: 57 }),
  // The facade ends above the visible cobble lane. The previous 484px lower
  // edge made the actor collide with empty pavement while returning west.
  Object.freeze({ id: 'inn-east-frontage', shape: 'rect', x: 236, y: 418, width: 194, height: 46 }),
  Object.freeze({ id: 'east-shop-west-frontage', shape: 'rect', x: 1100, y: 350, width: 195, height: 115 }),
  Object.freeze({ id: 'east-shop-east-frontage', shape: 'rect', x: 1310, y: 350, width: 276, height: 115 }),
  Object.freeze({ id: 'plaza-flowerbed', shape: 'ellipse', x: 632, y: 351, radiusX: 75, radiusY: 45 }),
  Object.freeze({ id: 'plaza-well', shape: 'ellipse', x: 850, y: 388, radiusX: 38, radiusY: 27 }),
  Object.freeze({ id: 'plaza-north-bench', shape: 'rect', x: 506, y: 270, width: 72, height: 42 }),
  Object.freeze({ id: 'plaza-south-bench', shape: 'rect', x: 520, y: 365, width: 70, height: 43 }),
  // Centred on the two barrel planters themselves (visible north of the
  // paving apron they used to sit on top of). The previous 801,429 centre
  // and 18x14 radius sat entirely on open cobble south of the planters,
  // fully blocking the natural approach to the well investigation point
  // (850,440) for no visible reason.
  Object.freeze({ id: 'plaza-south-planters', shape: 'ellipse', x: 799, y: 402, radiusX: 17, radiusY: 13 }),
  Object.freeze({ id: 'plaza-east-barrels', shape: 'rect', x: 1044, y: 374, width: 65, height: 56 }),
  Object.freeze({ id: 'plaza-west-resident', shape: 'ellipse', x: 738, y: 382, radiusX: 10, radiusY: 6 }),
  Object.freeze({ id: 'plaza-east-resident', shape: 'ellipse', x: 1015, y: 384, radiusX: 10, radiusY: 6 }),
  Object.freeze({ id: 'route-streetlamp-base', shape: 'ellipse', x: 327, y: 624, radiusX: 11, radiusY: 9 }),
  // The west lamp remains a depth-sorted foreground object. It intentionally
  // has no broad ground collider because that sealed the visible cobble lane
  // for every natural interaction-height return from the east market.
  Object.freeze({ id: 'plaza-east-lamp-base', shape: 'ellipse', x: 948, y: 391, radiusX: 11, radiusY: 8 }),
  // The two east-market lamps (formerly 'east-road-west-lamp-base' at
  // 1308,472 and 'east-road-east-lamp-base' at 1510,474) are removed for the
  // same reason as the plaza west lamp above. EAST_MARKET_ROAD is only
  // ~115px tall at their x, and moveActor never adjusts y while an actor
  // holds a pure east-west heading, so even their smallest possible ground
  // collider (any nonzero radius, once padded by the actor's own 12x7
  // footprint) fully blocked every row through x~1300 and left no way to
  // route around it without north-south input. Both remain depth-sorted
  // foreground art in the background image; only the ground collider is
  // gone.
]);

export const INTERIOR_BLOCKERS = Object.freeze([]);

function pointOnSegment(x, y, ax, ay, bx, by) {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > 0.001) return false;
  const dot = (x - ax) * (bx - ax) + (y - ay) * (by - ay);
  if (dot < 0) return false;
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
  return dot <= lengthSquared;
}

// Simple axis-aligned overlap test for two {x,y,width,height} rects. Used to
// keep the dialogue frame from being drawn on top of the player's own
// sprite (see dialogueFramePosition in app.js).
export function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index, index += 1) {
    const [ax, ay] = polygon[prior];
    const [bx, by] = polygon[index];
    if (pointOnSegment(x, y, ax, ay, bx, by)) return true;
    const crosses = ((ay > y) !== (by > y))
      && x < ((bx - ax) * (y - ay)) / (by - ay) + ax;
    if (crosses) inside = !inside;
  }
  return inside;
}

function actorHitsBlocker(x, y, blocker) {
  if (blocker.shape === 'rect') {
    const nearestX = Math.max(blocker.x, Math.min(x, blocker.x + blocker.width));
    const nearestY = Math.max(blocker.y, Math.min(y, blocker.y + blocker.height));
    const dx = (x - nearestX) / ACTOR_CONTRACT.radiusX;
    const dy = (y - nearestY) / ACTOR_CONTRACT.radiusY;
    return dx * dx + dy * dy < 1;
  }
  const dx = (x - blocker.x) / (blocker.radiusX + ACTOR_CONTRACT.radiusX);
  const dy = (y - blocker.y) / (blocker.radiusY + ACTOR_CONTRACT.radiusY);
  return dx * dx + dy * dy < 1;
}

function actorSamplePoints(x, y) {
  const points = [[x, y]];
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    points.push([
      x + Math.cos(angle) * ACTOR_CONTRACT.radiusX,
      y + Math.sin(angle) * ACTOR_CONTRACT.radiusY
    ]);
  }
  return points;
}

export function isExteriorWalkable(x, y) {
  const samplesStayOnMeasuredRoute = actorSamplePoints(x, y).every(([sampleX, sampleY]) => (
    WALKABLE_ROUTE_POLYGONS.some((polygon) => pointInPolygon(sampleX, sampleY, polygon))
  ));
  return samplesStayOnMeasuredRoute
    && !EXTERIOR_BLOCKERS.some((blocker) => actorHitsBlocker(x, y, blocker));
}

export function isInteriorWalkable(x, y) {
  const samplesStayInRoom = actorSamplePoints(x, y).every(([sampleX, sampleY]) => (
    pointInPolygon(sampleX, sampleY, INN_CONTRACT.interior.walkPolygon)
  ));
  return samplesStayInRoom
    && !INTERIOR_BLOCKERS.some((blocker) => actorHitsBlocker(x, y, blocker));
}

export function normalizeMovementInput(input) {
  const x = Math.max(-1, Math.min(1, Number(input?.x) || 0));
  const y = Math.max(-1, Math.min(1, Number(input?.y) || 0));
  const length = Math.hypot(x, y);
  if (length === 0) return Object.freeze({ x: 0, y: 0 });
  return Object.freeze({ x: x / length, y: y / length });
}

export function facingForVector(vector, previous = 'south') {
  if (!vector || (vector.x === 0 && vector.y === 0)) return previous;
  if (Math.abs(vector.x) > Math.abs(vector.y)) return vector.x < 0 ? 'west' : 'east';
  return vector.y < 0 ? 'north' : 'south';
}

export function moveActor(position, input, deltaSeconds, mode = 'exterior') {
  const vector = normalizeMovementInput(input);
  const distance = Math.min(32, Math.max(0, deltaSeconds) * ACTOR_CONTRACT.speed);
  const canStand = mode === 'interior' ? isInteriorWalkable : isExteriorWalkable;
  let x = position.x;
  let y = position.y;
  const nextX = x + vector.x * distance;
  if (canStand(nextX, y)) x = nextX;
  const nextY = y + vector.y * distance;
  if (canStand(x, nextY)) y = nextY;
  return Object.freeze({
    x,
    y,
    moved: Math.abs(x - position.x) > 0.01 || Math.abs(y - position.y) > 0.01,
    blocked: vector.x !== 0 || vector.y !== 0 ? x === position.x && y === position.y : false,
    facing: facingForVector(vector, position.facing)
  });
}

export function distanceBetween(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function nearbyInteraction(position, mode) {
  if (mode === 'exterior') {
    const trigger = INN_CONTRACT.door.triggerRect;
    const insideDoorTrigger = position.x >= trigger.x
      && position.x <= trigger.x + trigger.width
      && position.y >= trigger.y
      && position.y <= trigger.y + trigger.height;
    const distance = distanceBetween(position, INN_CONTRACT.door.foot);
    if (insideDoorTrigger) {
      // Doors auto-enter on approach (see evaluateDoorAutoTransition below
      // and app.js's updateAutoTransition); the label now describes that
      // instead of instructing a key press, though Enter/Space/E and the
      // action button still work as an explicit alternative.
      return Object.freeze({ id: 'enter-inn', label: 'そのまま進むと入れます', place: '古町の宿屋', distance });
    }
    for (const clue of CLUE_INTERACTIONS) {
      const clueDistance = distanceBetween(position, clue.point);
      if (clueDistance <= clue.radius) return Object.freeze({ ...clue, distance: clueDistance });
    }
    // Checked after CLUE_INTERACTIONS so a genuine investigation hotspot never loses its
    // prompt to the ambient "this is closed" message merely because the two happen to sit
    // near each other (see CLOSED_ENTRANCES's own comment for the exact separation).
    for (const entrance of CLOSED_ENTRANCES) {
      const entranceDistance = distanceBetween(position, entrance.point);
      if (entranceDistance <= entrance.radius) return Object.freeze({ ...entrance, distance: entranceDistance });
    }
    return null;
  }
  const npcDistance = distanceBetween(position, INN_CONTRACT.interior.npcInteractionPoint);
  const exitDistance = distanceBetween(position, INN_CONTRACT.interior.exitFoot);
  if (npcDistance <= 58) {
    return Object.freeze({ id: 'talk-innkeeper', label: '宿帳係と話す', place: '宿屋の帳場', distance: npcDistance });
  }
  return exitDistance <= 42
    ? Object.freeze({ id: 'exit-inn', label: 'そのまま進むと出られます', place: '宿屋の玄関', distance: exitDistance })
    : null;
}

// --- automatic door transition ------------------------------------------------
//
// The door used to require an explicit Enter/Space/E press even once the
// player had already walked fully into its trigger zone, which reads as
// unresponsive rather than a real doorway. evaluateDoorAutoTransition() is a
// pure edge-triggered latch: it only reports fire=true on the call where
// insideTrigger flips from false to true while unlatched, then stays
// latched (no further fire) until a call reports insideTrigger=false again.
// A time-based cooldown is layered on top of the latch so a very fast
// leave/return pair cannot refire within cooldownMs of the last fire even
// though the latch alone would already have cleared -- this is what stops
// entering the inn from immediately re-triggering the exit side, since the
// interior spawn point (INN_CONTRACT.interior.entryFoot) sits inside the
// exit trigger's own radius. Callers own *what* "inside" and "the trigger"
// mean (door rect/circle membership from nearbyInteraction() in this app);
// this function only owns the temporal edge/latch/cooldown state machine,
// which is what makes it independently testable without a DOM.
export const DOOR_AUTO_COOLDOWN_MS = 600;

export function createDoorAutoState() {
  return Object.freeze({ latched: false, cooldownUntil: 0 });
}

export function evaluateDoorAutoTransition(autoState, insideTrigger, timestamp, cooldownMs = DOOR_AUTO_COOLDOWN_MS) {
  if (!insideTrigger) {
    return Object.freeze({ latched: false, cooldownUntil: autoState.cooldownUntil, fire: false });
  }
  if (autoState.latched || timestamp < autoState.cooldownUntil) {
    return Object.freeze({ latched: autoState.latched, cooldownUntil: autoState.cooldownUntil, fire: false });
  }
  return Object.freeze({ latched: true, cooldownUntil: timestamp + cooldownMs, fire: true });
}

export function createCamera(viewportWidth, viewportHeight, focus, zoom = GAMEPLAY_ZOOM) {
  const visibleWidth = viewportWidth / zoom;
  const visibleHeight = viewportHeight / zoom;
  const maximumX = Math.max(0, WORLD_WIDTH - visibleWidth);
  const maximumY = Math.max(0, WORLD_HEIGHT - visibleHeight);
  // Defense-in-depth against a non-finite focus (see lerpCameraFocus's own
  // guard): a NaN focus.x/y would otherwise survive Math.min/Math.max
  // unclamped (NaN poisons both) and reach context.translate() as NaN.
  // Canvas silently no-ops translate()/scale() calls given NaN instead of
  // throwing, which leaves the *previous* transform in effect -- the world
  // then renders at a fixed, wrong, un-clamped position instead of failing
  // loudly, which is exactly as broken but far harder to notice or recover
  // from. Falling back to 0 keeps camera.x/y -- and therefore every
  // drawImage call downstream -- always finite and always inside the
  // clamped world bounds.
  const focusX = Number.isFinite(focus?.x) ? focus.x : 0;
  const focusY = Number.isFinite(focus?.y) ? focus.y : 0;
  return Object.freeze({
    zoom,
    x: Math.round(Math.max(0, Math.min(maximumX, focusX - visibleWidth / 2))),
    y: Math.round(Math.max(0, Math.min(maximumY, focusY - visibleHeight / 2))),
    viewportWidth,
    viewportHeight
  });
}

export function worldToScreen(camera, point) {
  return Object.freeze({
    x: Math.round((point.x - camera.x) * camera.zoom),
    y: Math.round((point.y - camera.y) * camera.zoom)
  });
}

// --- camera smoothing ----------------------------------------------------
//
// The camera used to snap its focus straight onto the player every frame,
// which reads as harsh micro-jitter once the player's own per-frame motion
// is involved (worst around direction changes and bumps). smoothingFactor()
// turns a "fraction of the remaining distance closed per 60fps frame" rate
// into a frame-rate-independent interpolation factor -- the same rate
// closes the same fraction of distance in the same wall-clock time whether
// the game runs at 30fps or 144fps -- and lerpCameraFocus() applies it to a
// world-space focus point. Camera clamping and integer rounding still
// happen exactly once, downstream, in createCamera, on the *smoothed*
// focus this produces, so dot-snapping is preserved.
export function smoothingFactor(rate, deltaSeconds) {
  const clampedRate = Math.max(0, Math.min(1, rate));
  // A non-finite deltaSeconds (a corrupted or foreign timestamp reaching
  // here) must never produce a non-finite factor. Treat it as "no time
  // passed" -- see lerpCameraFocus's own guard below for the matching
  // defense on `current`/`target` themselves.
  const seconds = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  return 1 - Math.pow(1 - clampedRate, seconds * 60);
}

export function lerpCameraFocus(current, target, deltaSeconds, rate = 0.15) {
  // Defensive, self-healing non-finite guard. A single bad frame (a
  // corrupted deltaSeconds, or -- via some future bug -- an already-broken
  // `current`) used to leave state.cameraFocus permanently NaN: every later
  // call computes current.x + (target.x - current.x) * k, and once
  // current.x is NaN that expression stays NaN forever regardless of k, so
  // the camera (and everything drawn relative to it, since context.
  // translate() silently no-ops on a NaN argument instead of throwing)
  // never recovers even once rendering resumes receiving perfectly valid
  // timestamps. Falling back to `target` for a non-finite `current` snaps
  // the camera straight onto its destination instead -- a one-frame pop at
  // worst, but exactly right again on the very next frame instead of
  // broken forever.
  const targetX = Number.isFinite(target?.x) ? target.x : 0;
  const targetY = Number.isFinite(target?.y) ? target.y : 0;
  const currentX = Number.isFinite(current?.x) ? current.x : targetX;
  const currentY = Number.isFinite(current?.y) ? current.y : targetY;
  const k = smoothingFactor(rate, deltaSeconds);
  return Object.freeze({
    x: currentX + (targetX - currentX) * k,
    y: currentY + (targetY - currentY) * k
  });
}

// --- fade transition -------------------------------------------------------
//
// Mode switches (entering/leaving the inn) used to happen on a single frame
// with no visual transition -- the scene and the camera's cut to its fixed
// interior framing both popped instantly. fadeOverlayAlpha() is a pure
// function of elapsed time that produces a black-overlay alpha which eases
// up to fully opaque at the midpoint of the transition and back down to
// transparent by the end, so the actual state swap (see applyModeSwitch in
// app.js) can happen at the one instant the screen is fully covered and be
// invisible. easeInOutCosine has zero slope at both ends of every half, so
// the overlay reaches alpha=1 at the midpoint with zero velocity: the least
// perceptible possible moment to swap the world underneath it.
export function easeInOutCosine(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  return 0.5 - 0.5 * Math.cos(Math.PI * clamped);
}

export function fadeOverlayAlpha(elapsedMs, totalMs) {
  // A non-finite elapsedMs (e.g. timestamp - pending.startedAt when either
  // side is corrupted) falls through every comparison below as false --
  // NaN <= 0, NaN >= totalMs, and NaN <= half are all false -- and without
  // this guard would reach easeInOutCosine(NaN) and return NaN instead of
  // 0. app.js's caller already fails closed on that (`if (fadeAlpha > 0)`
  // is false for NaN too, so the overlay itself never mis-paints), but
  // returning a real, finite 0 here keeps this pure function's own
  // contract -- "0 outside an active transition" -- honest for every
  // caller, not just the one that happens to compare with `>`.
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(totalMs)) return 0;
  if (!(totalMs > 0) || elapsedMs <= 0 || elapsedMs >= totalMs) return 0;
  const half = totalMs / 2;
  return elapsedMs <= half
    ? easeInOutCosine(elapsedMs / half)
    : 1 - easeInOutCosine((elapsedMs - half) / half);
}

// --- transition watchdog ---------------------------------------------------
//
// A mode transition (see beginModeTransition/updateModeTransition in
// app.js) must always resolve in finite wall-clock time so the black fade
// overlay it drives can never get stuck covering the screen, and the input
// lock it drives (state.transitionUntil) can never get stuck either. Under
// normal operation `elapsed` (timestamp - pending.startedAt) grows
// monotonically from 0 and the ordinary >= TRANSITION_HALF_MS / >=
// TRANSITION_TOTAL_MS checks resolve it well within totalMs*2 of real time,
// even across a multi-second gap (a backgrounded tab resuming).
// isTransitionExpired() is the fallback for when that assumption breaks
// anyway: a non-finite elapsed, or one so far outside [0, totalMs] in *either*
// direction that the ordinary checks could never naturally fire -- most
// notably a deeply *negative* elapsed forever, which happens if a
// transition's startedAt is ever recorded on a different clock basis than
// the timestamps updateModeTransition is later driven with (e.g. two
// different time sources for "now" -- see performAction/advanceDialogue in
// app.js, which are kept on the same rAF-timestamp clock specifically to
// avoid this). Forces the transition closed instead of leaving it -- and
// everything gated on it -- wedged indefinitely.
export function isTransitionExpired(elapsedMs, totalMs) {
  if (!(totalMs > 0)) return true;
  if (!Number.isFinite(elapsedMs)) return true;
  return Math.abs(elapsedMs) >= totalMs * 2;
}

export function spriteFrame(actor, timestamp) {
  const row = ACTOR_CONTRACT.directionRows[actor.facing] ?? 0;
  const elapsed = actor.moving ? Math.max(0, timestamp - (actor.walkStartedAt ?? timestamp)) : 0;
  const phase = Math.floor(elapsed / PLAYER_WALK_FRAME_DURATION_MS) % 8;
  const column = actor.moving ? phase + 1 : 0;
  return Object.freeze({
    sx: column * ACTOR_CONTRACT.frameWidth,
    sy: row * ACTOR_CONTRACT.frameHeight,
    sw: ACTOR_CONTRACT.frameWidth,
    sh: ACTOR_CONTRACT.frameHeight,
    offsetX: 0,
    offsetY: 0
  });
}

// Drives the opacity pulse of the quest-completion ledger glow (see
// drawLedgerCompletion in app.js). Pulled out as its own pure function
// specifically so the guard against a non-finite `timestamp` is directly
// testable without a DOM/canvas: the raw `0.86 + Math.sin(timestamp / 260) *
// 0.08` computation feeds straight into template-literal rgba(...) strings
// passed to CanvasGradient.addColorStop(), and unlike fillStyle/strokeStyle
// (which silently ignore an unparsable color) addColorStop THROWS a
// SyntaxError for a NaN-tainted one -- an uncaught exception that
// permanently kills the requestAnimationFrame loop (confirmed against a
// real browser: the exception propagates out of drawWorld() and frame(),
// so the trailing requestAnimationFrame(frame) call that keeps the game
// running never happens again). This is the one call in the whole render
// path proven to crash outright, rather than merely draw something wrong,
// when a non-finite timestamp reaches it -- see frame()'s own
// sanitizeTimestamp() in app.js for where that is now prevented at the
// source.
export function ledgerCompletionPulse(timestamp) {
  return Number.isFinite(timestamp) ? 0.86 + Math.sin(timestamp / 260) * 0.08 : 0.86;
}

// --- prefers-reduced-motion ------------------------------------------------
//
// window.matchMedia('(prefers-reduced-motion: reduce)') is a browser API and
// deliberately never touches this module (every function here stays DOM-free
// so it can be unit tested under plain Node -- the same convention every
// other pure function in this file already follows). app.js is the only
// place that reads the media query, once at boot and again on every 'change'
// event so a user who toggles the OS setting mid-session sees the effect
// immediately with no reload -- but it hands the resulting boolean to these
// three pure functions rather than branching inline, so *what value each
// motion-driven system switches to* is directly testable here, not just "did
// app.js call matchMedia". Each one degrades a specific animated system
// app.js drives every frame or per-transition:
//   - cameraSmoothingRateForMotionPreference: feeds lerpCameraFocus's own
//     `rate` (see smoothingFactor above). A rate of 1 makes smoothingFactor
//     return 1 for any deltaSeconds>0, so lerpCameraFocus snaps `current`
//     fully onto `target` every single frame instead of easing -- the camera
//     follows the player immediately, with no lag to perceive as motion.
//   - ledgerPulseForMotionPreference: replaces ledgerCompletionPulse's own
//     Math.sin(...) oscillation with that same function's rest/midpoint
//     value (0.86), so the completion glow's *brightness* is unchanged on
//     average, it simply stops pulsing.
//   - transitionDurationForMotionPreference: shortens (or, with
//     reducedDurationMs=0, eliminates) the black fade app.js's
//     beginModeTransition/updateModeTransition/currentFadeAlpha drive across
//     a door transition. Generic over the specific millisecond values so
//     app.js's own constants stay the single source of truth for timing.
export function cameraSmoothingRateForMotionPreference(reduceMotion, baseRate) {
  return reduceMotion ? 1 : baseRate;
}

export function ledgerPulseForMotionPreference(reduceMotion, timestamp) {
  return reduceMotion ? 0.86 : ledgerCompletionPulse(timestamp);
}

export function transitionDurationForMotionPreference(reduceMotion, baseDurationMs, reducedDurationMs) {
  return reduceMotion ? reducedDurationMs : baseDurationMs;
}

export function evidenceDialoguePages(payload) {
  const facts = Array.isArray(payload?.facts) ? payload.facts : [];
  const repository = typeof payload?.repository?.name === 'string' && payload.repository.name
    ? payload.repository.name
    : '名称未設定のリポジトリ';
  const entrypoint = facts.find((fact) => fact?.type === 'entrypoint');
  const unresolved = facts.find((fact) => fact?.type === 'unresolved');
  const cycle = facts.find((fact) => fact?.type === 'cycle');
  const fileScope = facts.find((fact) => fact?.type === 'survey_scope' && fact?.params?.dimension === 'files');
  const dependencyScope = facts.find((fact) => fact?.type === 'survey_scope' && fact?.params?.dimension === 'static_dependencies');
  const inferredCount = facts.filter((fact) => (fact?.evidence?.inferred?.length ?? 0) > 0).length;
  const unknownCount = facts.filter((fact) => (fact?.evidence?.unknown?.length ?? 0) > 0).length;
  const fileCount = Number.isSafeInteger(fileScope?.params?.count) ? fileScope.params.count : null;
  const dependencyCount = Number.isSafeInteger(dependencyScope?.params?.count) ? dependencyScope.params.count : null;
  return Object.freeze([
    Object.freeze({
      className: 'observed',
      label: '観測',
      body: entrypoint?.params?.path && unresolved?.params?.targetHint
        ? `入口は ${entrypoint.params.path} です。そこから参照する ${unresolved.params.targetHint} は見つかりませんでした。`
        : fileCount === null
          ? `${repository} という町名は確認できました。ファイル総数は、この検査結果だけでは確定していません。`
        : `${repository} を静的に読み、${fileCount}件のファイルを観測しました。対象のコードは実行していません。`
    }),
    Object.freeze({
      className: 'inferred',
      label: '推定',
      body: Array.isArray(cycle?.params?.members) && cycle.params.members.length >= 2
        ? `${cycle.params.members[0]} と ${cycle.params.members[1]} は循環している可能性があります。静的なつながりからの推定です。`
        : dependencyCount === null
          ? `${inferredCount}件の推定があります。観測した構造から導いたもので、実行時の成功を意味しません。`
        : `${dependencyCount}件の静的なつながりを手掛かりに、${inferredCount}件を推定しています。実行時の動作は断定しません。`
    }),
    Object.freeze({
      className: 'unknown',
      label: '不明',
      body: `${unknownCount}件の動作は未確認です。未確認は故障を意味しません。実行結果はまだ不明です。`
    })
  ]);
}

// --- repository-driven investigation content --------------------------------
//
// buildInvestigation(payload) is a pure projection from the /api/town payload
// (schemaVersion 2) into the prose the three fixed clue sites, the innkeeper's
// request, and the final report display. It never invents facts: each site is
// assigned one evidence class (observed / inferred / unknown) by CLUE_INTERACTIONS
// and only draws on facts that actually carry that class. When no such fact
// exists, the site says so honestly rather than fabricating a finding. This is
// the only place repository-specific clue prose is produced; app.js renders it
// verbatim through the existing quest state machine.

function investigationRepositoryName(payload) {
  return typeof payload?.repository?.name === 'string' && payload.repository.name
    ? payload.repository.name
    : '名称未設定のリポジトリ';
}

function nonemptyParam(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function factCarriesClass(fact, evidenceClass) {
  return (fact?.evidence?.[evidenceClass]?.length ?? 0) > 0;
}

const INVESTIGATION_FACT_PRIORITY = Object.freeze({
  observed: Object.freeze(['entrypoint', 'unresolved', 'survey_scope', 'truncation', 'facility_present', 'facility_absent']),
  inferred: Object.freeze(['cycle', 'unreached', 'test_association', 'facility_present']),
  unknown: Object.freeze(['unverified', 'runtime_unknown', 'survey_scope', 'truncation', 'facility_absent', 'facility_present'])
});

// When several facts of the same type carry the site's class, prefer the most
// legible one. Only survey_scope currently benefits (prefer the file census).
const INVESTIGATION_FACT_PREFERENCE = Object.freeze({
  'clue-streetlamp': (fact) => fact?.params?.dimension === 'files'
});

function selectInvestigationFact(facts, evidenceClass, clueId) {
  const candidates = facts.filter((fact) => factCarriesClass(fact, evidenceClass));
  const prefer = INVESTIGATION_FACT_PREFERENCE[clueId];
  for (const type of INVESTIGATION_FACT_PRIORITY[evidenceClass] ?? []) {
    const matches = candidates.filter((fact) => fact?.type === type);
    if (matches.length === 0) continue;
    if (typeof prefer === 'function') {
      const preferred = matches.find(prefer);
      if (preferred) return preferred;
    }
    return matches[0];
  }
  return candidates[0] ?? null;
}

function investigationPage(className, label, body) {
  return Object.freeze({ className, label, body });
}

function streetlampPage(fact, repository, label) {
  if (!fact) {
    return investigationPage('observed', label,
      '古い街灯の台座に刻まれた印は読み取れませんでした。この方面に観測できた事実は残っていません。');
  }
  if (fact.type === 'entrypoint') {
    return investigationPage('observed', label,
      `古い街灯の台座に「${fact.params.path}」と刻まれています。${repository}の入口として観測された印です。`);
  }
  if (fact.type === 'unresolved') {
    const to = nonemptyParam(fact.params?.targetHint) ?? '行き先の分からぬ道';
    return investigationPage('observed', label,
      `台座には「${fact.params.from}」から「${to}」への道が刻まれていますが、その先の敷石は途切れています。静的に観測した未解決の道です。`);
  }
  if (fact.type === 'survey_scope') {
    if (fact.params?.dimension === 'files') {
      return investigationPage('observed', label,
        `台座の銘板は「${fact.params.count}件のファイルを検分」と記します。読み取りで観測したもので、動かしてはいません。`);
    }
    if (fact.params?.dimension === 'repository') {
      return investigationPage('observed', label,
        `台座には町の名「${nonemptyParam(fact.params?.name) ?? repository}」が観測記録として刻まれています。`);
    }
    return investigationPage('observed', label,
      `台座には静的な観測記録（${fact.params?.dimension}）が刻まれています。読み取りで確かめた内容です。`);
  }
  if (fact.type === 'truncation') {
    return investigationPage('observed', label,
      `台座の記録は「${fact.params?.omittedFiles ?? 0}件を省略」と刻み、検分が途中で打ち切られたことを観測しています。`);
  }
  if (fact.type === 'facility_present' || fact.type === 'facility_absent') {
    const state = fact.type === 'facility_present' ? '在る' : '無い';
    return investigationPage('observed', label,
      `台座には設備「${fact.params?.kind}」が${state}と観測記録が刻まれています。読み取りで確かめた内容です。`);
  }
  return investigationPage('observed', label,
    `古い街灯の台座には観測された事実（${fact.type}）が刻まれています。読み取りで確かめた内容です。`);
}

function wellPage(fact, repository, label) {
  if (!fact) {
    return investigationPage('inferred', label,
      '井戸の水面は静かで、向かい合う紋章はありません。構造から導ける推定はまだ立っていません。');
  }
  if (fact.type === 'cycle') {
    const members = Array.isArray(fact.params?.members) ? fact.params.members : [];
    if (members.length >= 2) {
      return investigationPage('inferred', label,
        `井戸の縁で「${members[0]}」と「${members[1]}」の紋章が向かい合っています。静的なつながりからの推定で、循環している可能性があります。`);
    }
    return investigationPage('inferred', label,
      '井戸の縁に循環の紋章がありますが、相手までは読み取れません。静的なつながりからの推定です。');
  }
  if (fact.type === 'unreached') {
    return investigationPage('inferred', label,
      `井戸の水面に「${fact.params?.path}」の影が映りますが、知られた入口からは辿り着けません。構造からの推定です。`);
  }
  if (fact.type === 'test_association') {
    return investigationPage('inferred', label,
      `井戸の縁で「${fact.params?.source}」と試験「${fact.params?.test}」の紋章が結ばれています。静的な対応からの推定です。`);
  }
  if (fact.type === 'facility_present') {
    return investigationPage('inferred', label,
      `井戸の縁には設備「${fact.params?.kind}」を推し量る紋章があります。実行時の成否を断定するものではありません。`);
  }
  return investigationPage('inferred', label,
    `井戸の縁には構造から導いた推定（${fact.type}）の紋章があります。実行時の成否を断定するものではありません。`);
}

function shopPage(fact, repository, label) {
  if (!fact) {
    return investigationPage('unknown', label,
      '東市場の看板はすべて開いています。この方面に未確認の事項は残っていません。');
  }
  if (fact.type === 'unverified') {
    return investigationPage('unknown', label,
      `東市場の「${fact.params?.path}」の看板は閉じたままです。中の動作は見えず、未確認であることしか分かりません。`);
  }
  if (fact.type === 'runtime_unknown') {
    const to = nonemptyParam(fact.params?.targetHint) ?? '見えない相手';
    return investigationPage('unknown', label,
      `東市場の看板には「${fact.params?.from}」から「${to}」への取引が記されますが、成否は動かさねば分かりません。実行時は未確認です。`);
  }
  if (fact.type === 'survey_scope') {
    return investigationPage('unknown', label,
      `東市場の看板は閉じ、${fact.params?.dimension}の目録すら確かめられませんでした。未確認のままです。`);
  }
  if (fact.type === 'truncation') {
    return investigationPage('unknown', label,
      '東市場の看板は「省いた範囲は未確認」と記します。打ち切られた先は、動かさねば分かりません。');
  }
  if (fact.type === 'facility_absent' || fact.type === 'facility_present') {
    return investigationPage('unknown', label,
      `東市場の看板に設備「${fact.params?.kind}」の記載がありますが、動作は見えず未確認です。`);
  }
  return investigationPage('unknown', label,
    `東市場の看板は閉じたまま（${fact.type}）です。中の動作は見えず、未確認です。`);
}

const INVESTIGATION_SITE_BUILDERS = Object.freeze({
  'clue-streetlamp': streetlampPage,
  'clue-well': wellPage,
  'clue-east-shop': shopPage
});

function investigationReportPages(sites, repository) {
  const observed = sites['clue-streetlamp'];
  const inferred = sites['clue-well'];
  const unknown = sites['clue-east-shop'];
  return Object.freeze([
    investigationPage('observed', '報告',
      `${repository}の宿帳へ調査を記録します。古い街灯の観測：${observed?.fact ? '観測できた事実を控えました。' : '観測できた事実はありませんでした。'}`),
    investigationPage('inferred', '報告',
      `中央広場の井戸の推定：${inferred?.fact ? '構造からの推定を控えました。' : '推定は立ちませんでした。'}`),
    investigationPage('unknown', '報告',
      `東市場の未確認：${unknown?.fact ? '未確認の事項を控えました。' : '未確認の事項は残っていません。'}　未確認は故障を意味しません。`)
  ]);
}

/**
 * Pure projection from a GET /api/town payload into the town's investigation
 * prose. Deterministic for a given payload; invents nothing. The three sites,
 * their coordinates, and their evidence class come from CLUE_INTERACTIONS; only
 * the prose is derived from payload.facts here.
 *
 * @param {unknown} payload - GET /api/town response ({ repository, facts, ... }).
 * @returns {{
 *   repository: string,
 *   sites: Record<string, { id: string, place: string, evidenceClass: string,
 *     evidenceLabel: string, fact: object|null, pages: ReadonlyArray<{className:string,label:string,body:string}> }>,
 *   intro: ReadonlyArray<{className:string,label:string,body:string}>,
 *   report: ReadonlyArray<{className:string,label:string,body:string}>
 * }}
 */
export function buildInvestigation(payload) {
  const facts = Array.isArray(payload?.facts) ? payload.facts : [];
  const repository = investigationRepositoryName(payload);
  const sites = {};
  for (const clue of CLUE_INTERACTIONS) {
    const fact = selectInvestigationFact(facts, clue.evidenceClass, clue.id);
    const build = INVESTIGATION_SITE_BUILDERS[clue.id];
    const page = build
      ? build(fact, repository, clue.evidenceLabel)
      : investigationPage(clue.evidenceClass, clue.evidenceLabel, `${clue.place}の手掛かりです。`);
    sites[clue.id] = Object.freeze({
      id: clue.id,
      place: clue.place,
      evidenceClass: clue.evidenceClass,
      evidenceLabel: clue.evidenceLabel,
      fact: fact ?? null,
      pages: Object.freeze([page])
    });
  }
  const intro = Object.freeze([
    ...evidenceDialoguePages(payload),
    investigationPage('quest', '依頼',
      `${repository}の宿帳と、町に残る手掛かりが合うか確かめてください。古い街灯・中央広場の井戸・東市場の看板を調べ、この帳場へ戻ってください。`)
  ]);
  return Object.freeze({
    repository,
    sites: Object.freeze(sites),
    intro,
    report: investigationReportPages(sites, repository)
  });
}

export function wrapCanvasText(context, text, maximumWidth) {
  const characters = [...String(text ?? '')];
  const lines = [];
  let line = '';
  for (const character of characters) {
    const candidate = `${line}${character}`;
    if (line && context.measureText(candidate).width > maximumWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}
