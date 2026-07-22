// test/town/closed-entrances.test.mjs
//
// Regression coverage for Fable5VerticalSlice24x16.md requirement 4:
// "未実装入口は装飾扉として偽らず、閉鎖状態と理由を一貫したUXで示す"
// (an unimplemented entrance must not pretend to be a decorative door --
// its closed state and reason must be shown with consistent UX).
//
// Before this, walking up to the town hall / a house / an east market shop
// in public/fable5-v2 produced no signal at all beyond the exact same
// generic "ここは通れません。別の道を探してください。" message every other
// piece of scenery (a bench, a lamp post, the flowerbed) already gives via
// app.js's registerBump() -- there was no way to tell "this is a real,
// permanently closed door" from "this is just decoration you should walk
// around".
//
// The fix adds CLOSED_ENTRANCES (world-runtime.mjs): three doorways visually
// measured against target-town-user-direct-v1.png (1586x992, the accepted
// offline ground truth reconstructed at runtime from verified prefabs), each
// paired with a walkable approach point confirmed with isExteriorWalkable and
// a world-appropriate closure reason.
// nearbyInteraction() reports them (after CLUE_INTERACTIONS, so a genuine
// investigation hotspot never loses its prompt to the ambient "this is
// closed" message) and isClosedEntranceId() is the shared classification
// helper app.js uses to suppress the key hint, disable the action button,
// and -- in registerBump() -- swap the generic bump message for the
// door-specific reason. This file tests the real exported pure functions
// directly (not ports), plus end-to-end walks from the real spawn point
// using the real moveActor()/isExteriorWalkable() pair, mirroring the
// existing convention in door-auto-transition.test.mjs and
// exterior-west-return.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTOR_CONTRACT,
  CLOSED_ENTRANCES,
  CLUE_INTERACTIONS,
  INN_CONTRACT,
  distanceBetween,
  isClosedEntranceId,
  isExteriorWalkable,
  moveActor,
  nearbyInteraction
} from '../../public/fable5-v2/world-runtime.mjs';

const FRAME_SECONDS = 1 / ACTOR_CONTRACT.speed; // exact 1px/frame steps, matching this repo's existing walkTo convention

// --- isClosedEntranceId: the shared, pure classification helper ------------

test('isClosedEntranceId recognizes every real CLOSED_ENTRANCES id and only those', () => {
  for (const entrance of CLOSED_ENTRANCES) {
    assert.equal(isClosedEntranceId(entrance.id), true, `expected ${entrance.id} to be recognized`);
  }
});

test('isClosedEntranceId is false for every other real interaction id in this app', () => {
  const otherRealIds = [
    'enter-inn', 'exit-inn', 'talk-innkeeper',
    ...CLUE_INTERACTIONS.map((clue) => clue.id)
  ];
  for (const id of otherRealIds) {
    assert.equal(isClosedEntranceId(id), false, `did not expect ${id} to read as a closed entrance`);
  }
});

test('isClosedEntranceId fails closed (false) for null/undefined/non-string/lookalike input, never throws', () => {
  for (const bad of [null, undefined, 42, {}, [], true, '', 'closed', 'CLOSED-townhall', 'not-closed-anything']) {
    assert.equal(isClosedEntranceId(bad), false, `expected false for ${JSON.stringify(bad)}`);
  }
});

// --- CLOSED_ENTRANCES data shape --------------------------------------------

test('CLOSED_ENTRANCES has exactly the three required sites, each with a distinct honest reason', () => {
  assert.deepEqual(
    CLOSED_ENTRANCES.map((entrance) => entrance.id),
    ['closed-townhall', 'closed-house', 'closed-eastshop']
  );
  const ids = new Set();
  for (const entrance of CLOSED_ENTRANCES) {
    assert.equal(ids.has(entrance.id), false, `duplicate id ${entrance.id}`);
    ids.add(entrance.id);
    assert.equal(typeof entrance.place, 'string');
    assert.ok(entrance.place.length > 0);
    assert.equal(typeof entrance.label, 'string');
    // A generic bump/obstacle message must never leak in as a "closed" reason:
    // each site's own worldbuilding-specific text is required, not the
    // fallback used for ordinary scenery collisions.
    assert.notEqual(entrance.label, 'ここは通れません。別の道を探してください。');
    assert.ok(entrance.label.length >= 8, `label for ${entrance.id} reads too thin to be a real reason`);
    assert.ok(Number.isFinite(entrance.point?.x) && Number.isFinite(entrance.point?.y));
    assert.ok(entrance.point.x >= 0 && entrance.point.x < 1586, 'point.x must sit inside the 1586x992 runtime background');
    assert.ok(entrance.point.y >= 0 && entrance.point.y < 992, 'point.y must sit inside the 1586x992 runtime background');
    assert.ok(entrance.radius > 0 && entrance.radius < 200, `radius for ${entrance.id} looks unreasonable: ${entrance.radius}`);
  }
});

test('each CLOSED_ENTRANCES approach point is itself walkable (measured against the real collision geometry)', () => {
  for (const entrance of CLOSED_ENTRANCES) {
    assert.equal(
      isExteriorWalkable(entrance.point.x, entrance.point.y),
      true,
      `${entrance.id}'s point (${entrance.point.x},${entrance.point.y}) should be a reachable standing spot, not the door pixel itself`
    );
  }
});

test('no two CLOSED_ENTRANCES sites, and no CLOSED_ENTRANCES site and CLUE_INTERACTIONS site, overlap radii', () => {
  const all = [
    ...CLOSED_ENTRANCES.map((e) => ({ id: e.id, point: e.point, radius: e.radius })),
    ...CLUE_INTERACTIONS.map((c) => ({ id: c.id, point: c.point, radius: c.radius }))
  ];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const gap = distanceBetween(all[i].point, all[j].point);
      assert.ok(
        gap > all[i].radius + all[j].radius,
        `${all[i].id} and ${all[j].id} radii overlap (gap ${gap.toFixed(1)} <= ${all[i].radius + all[j].radius})`
      );
    }
  }
});

// --- nearbyInteraction(): the pure detection function app.js drives --------

test('nearbyInteraction reports each closed entrance exactly at its own point, with the right place/label', () => {
  for (const entrance of CLOSED_ENTRANCES) {
    const found = nearbyInteraction(entrance.point, 'exterior');
    assert.equal(found?.id, entrance.id);
    assert.equal(found.place, entrance.place);
    assert.equal(found.label, entrance.label);
    assert.equal(found.distance, 0);
  }
});

test('nearbyInteraction reports a closed entrance anywhere strictly inside its radius, and not just outside it', () => {
  for (const entrance of CLOSED_ENTRANCES) {
    const justInside = { x: entrance.point.x + entrance.radius - 1, y: entrance.point.y };
    const justOutside = { x: entrance.point.x + entrance.radius + 20, y: entrance.point.y };
    assert.equal(nearbyInteraction(justInside, 'exterior')?.id, entrance.id, `${entrance.id}: expected a hit just inside its radius`);
    const outsideResult = nearbyInteraction(justOutside, 'exterior');
    assert.notEqual(outsideResult?.id, entrance.id, `${entrance.id}: should not fire far outside its own radius`);
  }
});

test('interior mode never reports a closed entrance (they are an exterior-only concept)', () => {
  for (const entrance of CLOSED_ENTRANCES) {
    const result = nearbyInteraction(entrance.point, 'interior');
    assert.notEqual(result?.id, entrance.id);
  }
});

test('a closed-entrance id can never collide with an id performAction() in app.js already special-cases', () => {
  // app.js's performAction() only ever acts on 'enter-inn', 'exit-inn',
  // 'talk-innkeeper', and ids starting with 'clue-'. A closed-entrance id
  // must never accidentally match one of those prefixes/values, or a
  // future edit to CLOSED_ENTRANCES could silently make a "closed" door
  // enterable (or a clue) through that unrelated branch.
  for (const entrance of CLOSED_ENTRANCES) {
    assert.notEqual(entrance.id, 'enter-inn');
    assert.notEqual(entrance.id, 'exit-inn');
    assert.notEqual(entrance.id, 'talk-innkeeper');
    assert.equal(entrance.id.startsWith('clue-'), false);
  }
});

// --- priority: CLUE_INTERACTIONS must never lose its prompt to the new -----
// --- ambient "closed" message, even though closed-eastshop sits near it ----

test('clue-east-shop keeps priority at its own investigation point (regression: the new closed-eastshop check is additive, not intrusive)', () => {
  const clue = CLUE_INTERACTIONS.find((entry) => entry.id === 'clue-east-shop');
  assert.equal(nearbyInteraction(clue.point, 'exterior')?.id, 'clue-east-shop');
});

test('the inn door trigger and every existing clue site are unaffected by CLOSED_ENTRANCES', () => {
  assert.equal(nearbyInteraction(INN_CONTRACT.door.approachPoint, 'exterior')?.id, 'enter-inn');
  for (const clue of CLUE_INTERACTIONS) {
    assert.equal(nearbyInteraction(clue.point, 'exterior')?.id, clue.id);
  }
});

test('an ordinary obstacle (a bench, away from every clue and closed entrance) still reports no interaction at all', () => {
  // (540, 290) sits just west of the plaza-north-bench blocker, comfortably
  // outside every CLUE_INTERACTIONS/CLOSED_ENTRANCES radius: this is the
  // "just a piece of scenery" case that must keep using app.js's original
  // generic bump message, not any door-specific one.
  assert.equal(nearbyInteraction({ x: 540, y: 290 }, 'exterior'), null);
});

// --- end-to-end: a real walk from spawn reaches each door and fires it -----
//
// Mirrors this repo's existing walkTo convention (see
// test/town/prefab-worldplan.test.mjs and door-auto-transition.test.mjs):
// each leg holds a single axis of input against the real moveActor(), and
// every step must actually move (a blocked step fails the test loudly)
// instead of silently accepting a stuck walk. Checkpoints were derived by
// scanning the real isExteriorWalkable() collision field (not guessed), so
// this both proves reachability and guards the specific route against a
// future geometry edit narrowing or sealing it.

function walkTo(start, destination, mode = 'exterior') {
  let actor = { ...start, facing: start.facing ?? 'north' };
  let remaining = 3000;
  while ((actor.x !== destination.x || actor.y !== destination.y) && remaining > 0) {
    const input = actor.x !== destination.x
      ? { x: Math.sign(destination.x - actor.x), y: 0 }
      : { x: 0, y: Math.sign(destination.y - actor.y) };
    const next = moveActor(actor, input, FRAME_SECONDS, mode);
    assert.equal(next.moved, true, `blocked at (${actor.x},${actor.y}) walking toward (${destination.x},${destination.y})`);
    actor = next;
    remaining -= 1;
  }
  assert.ok(remaining > 0, `movement guard exhausted before reaching (${destination.x},${destination.y})`);
  return actor;
}

function walkCheckpoints(checkpoints) {
  let actor = { ...ACTOR_CONTRACT.spawn, facing: 'north' };
  for (const checkpoint of checkpoints) actor = walkTo(actor, checkpoint);
  return actor;
}

test('a real walk from spawn reaches the town hall door and reports closed-townhall', () => {
  const actor = walkCheckpoints([
    { x: 700, y: 520 }, { x: 700, y: 450 }, { x: 900, y: 450 }, { x: 900, y: 296 }, { x: 640, y: 296 }
  ]);
  assert.equal(nearbyInteraction(actor, 'exterior')?.id, 'closed-townhall');
});

test('a real walk from spawn reaches the house door and reports closed-house', () => {
  const actor = walkCheckpoints([
    { x: 700, y: 520 }, { x: 700, y: 450 }, { x: 900, y: 450 }, { x: 900, y: 296 }, { x: 997, y: 296 }
  ]);
  assert.equal(nearbyInteraction(actor, 'exterior')?.id, 'closed-house');
});

test('a real walk from spawn reaches the east market shop door and reports closed-eastshop', () => {
  const actor = walkCheckpoints([
    { x: 700, y: 520 }, { x: 700, y: 492 }, { x: 1395, y: 492 }, { x: 1395, y: 480 }
  ]);
  assert.equal(nearbyInteraction(actor, 'exterior')?.id, 'closed-eastshop');
});

// --- registerBump()'s message-selection logic, mirrored ---------------------
//
// app.js's registerBump() is DOM-coupled (calls setStatus(), touches
// elements.*) and cannot be imported under Node -- the same constraint every
// other app.js-orchestration test file in this directory already works
// around (see canvas-black-regression.test.mjs's own comment on this). This
// mirrors its exact decision rule using the real nearbyInteraction() and
// isClosedEntranceId() exports, so the rule itself -- not a copy of the
// string literals -- is what is under test.
const GENERIC_BUMP_MESSAGE = 'ここは通れません。別の道を探してください。';

function bumpMessageFor(position, mode = 'exterior') {
  const blockedNearby = nearbyInteraction(position, mode);
  return isClosedEntranceId(blockedNearby?.id)
    ? `${blockedNearby.place}。${blockedNearby.label}`
    : GENERIC_BUMP_MESSAGE;
}

test('bumping right at a closed entrance surfaces its specific reason, not the generic obstacle message', () => {
  for (const entrance of CLOSED_ENTRANCES) {
    assert.equal(bumpMessageFor(entrance.point), `${entrance.place}。${entrance.label}`);
  }
});

test('bumping an ordinary obstacle still surfaces the original generic message, unchanged', () => {
  assert.equal(bumpMessageFor({ x: 540, y: 290 }), GENERIC_BUMP_MESSAGE);
  // The flowerbed, approached head-on from the spawn column: a real,
  // unremarkable piece of scenery, not a closed entrance.
  const flowerbedApproach = walkTo({ ...ACTOR_CONTRACT.spawn, facing: 'north' }, { x: 650, y: 465 });
  assert.equal(bumpMessageFor(flowerbedApproach), GENERIC_BUMP_MESSAGE);
});
