// test/town/door-auto-transition.test.mjs
//
// Regression coverage for a P0 game-feel gap found by playtest + code audit
// in public/fable5-v2: walking fully into the inn door's trigger zone used
// to do nothing but show a prompt -- entering required an explicit
// Enter/Space/E press or the action button even after the player had
// already walked up to (and briefly past) the threshold, which reads as
// unresponsive rather than a real doorway.
//
// evaluateDoorAutoTransition() (world-runtime.mjs) is the pure edge/latch/
// cooldown state machine app.js's updateAutoTransition() drives every
// frame with nearbyInteraction()'s own id check as the "inside" signal.
// This file tests that function directly (the real export, not a port),
// plus an end-to-end simulation combining it with the real moveActor() and
// nearbyInteraction() to confirm a natural walk to the door actually fires
// automatically, and that the interior spawn point sitting inside the exit
// trigger's own radius does not cause an immediate return trip.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTOR_CONTRACT,
  DOOR_AUTO_COOLDOWN_MS,
  INN_CONTRACT,
  createDoorAutoState,
  evaluateDoorAutoTransition,
  moveActor,
  nearbyInteraction
} from '../../public/fable5-v2/world-runtime.mjs';

const FRAME_SECONDS = 1 / ACTOR_CONTRACT.speed; // exact 1px/frame steps, see prefab-worldplan.test.mjs's walkTo

test('createDoorAutoState starts unlatched with no cooldown, so a first approach fires immediately', () => {
  const initial = createDoorAutoState();
  assert.deepEqual(initial, { latched: false, cooldownUntil: 0 });
  const result = evaluateDoorAutoTransition(initial, true, 1);
  assert.equal(result.fire, true);
});

test('evaluateDoorAutoTransition fires exactly once on the outside-to-inside edge, then latches', () => {
  let state = createDoorAutoState();
  // Outside: never fires, stays unlatched.
  state = pick(evaluateDoorAutoTransition(state, false, 0));
  assert.equal(state.latched, false);

  // Crossing the edge fires once.
  const entry = evaluateDoorAutoTransition(state, true, 1000);
  assert.equal(entry.fire, true);
  assert.equal(entry.latched, true);
  assert.equal(entry.cooldownUntil, 1000 + DOOR_AUTO_COOLDOWN_MS);
  state = pick(entry);

  // Staying inside on later frames does not refire, however many frames.
  for (const t of [1016, 1200, 5000, 60_000]) {
    const again = evaluateDoorAutoTransition(state, true, t);
    assert.equal(again.fire, false, `should not refire while still inside at t=${t}`);
    state = pick(again);
  }
});

test('leaving the trigger clears the latch, and returning after the cooldown fires again', () => {
  let state = pick(evaluateDoorAutoTransition(createDoorAutoState(), true, 0)); // fires at t=0
  assert.equal(state.cooldownUntil, DOOR_AUTO_COOLDOWN_MS, 'cooldown is anchored to the fire time, not any later leave time');
  state = pick(evaluateDoorAutoTransition(state, false, 100)); // player steps back out well before the cooldown expires
  assert.equal(state.latched, false);
  assert.equal(state.cooldownUntil, DOOR_AUTO_COOLDOWN_MS, 'leaving must not reset or extend the cooldown clock');

  // Returning immediately (still inside the cooldown window, which runs
  // from the original t=0 fire, not from the t=100 leave) must not fire.
  const tooSoon = evaluateDoorAutoTransition(state, true, DOOR_AUTO_COOLDOWN_MS - 1);
  assert.equal(tooSoon.fire, false, 'cooldown must block a refire even though the latch already cleared');
  state = pick(tooSoon);

  // Returning after the cooldown has fully elapsed fires normally.
  const later = evaluateDoorAutoTransition(state, true, DOOR_AUTO_COOLDOWN_MS + 1);
  assert.equal(later.fire, true, 'a genuine leave-then-return after the cooldown should fire again');
});

test('rapid in/out flicker within the cooldown window never fires more than the initial entry', () => {
  let state = createDoorAutoState();
  const timeline = [
    [0, true],    // enters -> fires
    [50, false],  // steps back out immediately
    [80, true],   // and back in
    [140, false], // and out again
    [200, true]   // and in again, still all inside DOOR_AUTO_COOLDOWN_MS (600ms) of t=0
  ];
  let fireCount = 0;
  for (const [t, inside] of timeline) {
    const result = evaluateDoorAutoTransition(state, inside, t);
    if (result.fire) fireCount += 1;
    state = pick(result);
  }
  assert.equal(fireCount, 1, 'only the very first entry should fire during rapid flicker inside the cooldown window');
});

test('a spawn point that starts already inside the trigger does not fire until the player leaves once', () => {
  // Mirrors app.js's beginModeTransition, which force-latches doorAuto on
  // every mode switch specifically because INN_CONTRACT.interior.entryFoot
  // sits inside the exit trigger's own radius -- without the latch, the
  // very next frame after entering would immediately fire the exit side.
  const distanceToExit = Math.hypot(
    INN_CONTRACT.interior.entryFoot.x - INN_CONTRACT.interior.exitFoot.x,
    INN_CONTRACT.interior.entryFoot.y - INN_CONTRACT.interior.exitFoot.y
  );
  assert.ok(distanceToExit <= 42, 'this test assumes entryFoot sits inside the exit trigger radius (42px)');

  let state = { latched: true, cooldownUntil: 1_600 }; // what beginModeTransition sets on switch
  const stillAtSpawn = evaluateDoorAutoTransition(state, true, 1_600);
  assert.equal(stillAtSpawn.fire, false, 'must not immediately bounce back out from the interior spawn point');
  state = pick(stillAtSpawn);

  const walkedAway = evaluateDoorAutoTransition(state, false, 3_000);
  assert.equal(walkedAway.latched, false);

  const walkedBack = evaluateDoorAutoTransition(walkedAway, true, 5_000);
  assert.equal(walkedBack.fire, true, 'a deliberate return to the door after leaving should fire normally');
});

// --- end-to-end: real moveActor()/nearbyInteraction(), not a port ----------

test('walking naturally toward the inn door fires the auto-enter on the exact frame the trigger is entered', () => {
  let player = { x: ACTOR_CONTRACT.spawn.x, y: ACTOR_CONTRACT.spawn.y, facing: 'north' };
  let auto = createDoorAutoState();
  let elapsedMs = 0;
  let fired = null;
  const checkpoints = [
    { x: 226, y: 520 },
    { x: 226, y: 495 },
    { x: 212, y: 495 },
    INN_CONTRACT.door.approachPoint
  ];
  outer:
  for (const checkpoint of checkpoints) {
    for (let step = 0; step < 2_000; step += 1) {
      if (player.x === checkpoint.x && player.y === checkpoint.y) break;
      const input = player.x !== checkpoint.x
        ? { x: Math.sign(checkpoint.x - player.x), y: 0 }
        : { x: 0, y: Math.sign(checkpoint.y - player.y) };
      const next = moveActor(player, input, FRAME_SECONDS, 'exterior');
      assert.equal(next.moved, true, `blocked walking toward the door at (${player.x},${player.y})`);
      player = { x: next.x, y: next.y, facing: next.facing };
      elapsedMs += FRAME_SECONDS * 1000;
      const nearby = nearbyInteraction(player, 'exterior');
      const result = evaluateDoorAutoTransition(auto, nearby?.id === 'enter-inn', elapsedMs);
      auto = pick(result);
      if (result.fire) {
        fired = { player: { ...player }, nearbyId: nearby?.id };
        break outer;
      }
    }
  }
  assert.ok(fired, 'expected auto-enter to fire while walking the natural approach to the inn door');
  assert.equal(fired.nearbyId, 'enter-inn');
  const trigger = INN_CONTRACT.door.triggerRect;
  assert.ok(fired.player.x >= trigger.x && fired.player.x <= trigger.x + trigger.width);
  assert.ok(fired.player.y >= trigger.y && fired.player.y <= trigger.y + trigger.height);
});

test('nearbyInteraction still reports enter-inn/exit-inn for the manual Enter/E/action-button fallback', () => {
  // Auto-fire and the manual path share the same underlying signal
  // (nearbyInteraction id); this just confirms that signal itself was not
  // disturbed by the wording change to its label (see the comment on
  // nearbyInteraction in world-runtime.mjs).
  assert.equal(nearbyInteraction(INN_CONTRACT.door.approachPoint, 'exterior')?.id, 'enter-inn');
  assert.equal(typeof nearbyInteraction(INN_CONTRACT.door.approachPoint, 'exterior').label, 'string');
  const exitPoint = INN_CONTRACT.interior.entryFoot;
  assert.equal(nearbyInteraction(exitPoint, 'interior')?.id, 'exit-inn');
});

function pick({ latched, cooldownUntil }) {
  return { latched, cooldownUntil };
}
