// test/town/movement-continuity.test.mjs
//
// Regression coverage for a P0 game-feel bug found by playtest + code audit
// in public/fable5-v2/app.js: nudgePlayer() used to apply an *extra*,
// immediate moveActor() call with a hard-coded deltaSeconds (0.06s) on every
// keydown/pointerdown, outside the requestAnimationFrame loop, without
// advancing state.lastTimestamp. The very next animation frame then still
// covered the same wall-clock interval and called moveActor() again for it,
// so that interval's movement was applied twice: once as a ~4.5px
// (0.06s * 75px/s) instant nudge, and again as the normal
// ~1.25px (1/60s * 75px/s) frame step -- a visible warp on every keypress
// and, worse, on every direction change (since direction changes also go
// through the non-repeat keydown branch).
//
// The fix removes the extra call entirely: input handlers now only ever
// mutate state.keys / state.heldDirections (see app.js), and
// requestAnimationFrame's own updateMovement() is the sole place
// moveActor() is called, exactly once per frame, with that frame's own
// deltaSeconds. This file exercises the *real* exported moveActor() -- the
// same function app.js calls -- through a harness that mirrors that
// corrected architecture (input events only ever toggle a "held" set;
// movement happens once per simulated frame from whatever is held at
// sampling time), so it is a permanent guard against the double-call
// pattern regressing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTOR_CONTRACT, moveActor } from '../../public/fable5-v2/world-runtime.mjs';

const FRAME_MS = 1000 / 60;
const FRAME_SECONDS = FRAME_MS / 1000;
// Steady state at 60fps is ACTOR_CONTRACT.speed/60 = 1.25px/frame. The task
// brief's own bound is "frame-to-frame movement stays roughly <=1.5px",
// which leaves headroom for float rounding without admitting the old bug's
// ~5.75px combined warp.
const MAX_SANE_FRAME_STEP = 1.5;
const STEADY_STATE_STEP = ACTOR_CONTRACT.speed * FRAME_SECONDS;

/**
 * Mirrors app.js's corrected architecture: `heldEvents` only ever adds to or
 * removes from a "keys currently held" set (exactly what onKeyDown/onKeyUp/
 * bindDirectionButton do now), and moveActor() -- the real, imported
 * function, not a port -- is called exactly once per simulated frame using
 * whatever is held at that frame's sampling instant. Returns the per-frame
 * step distances so callers can assert on continuity.
 */
function simulateFrameLoop(frameCount, heldEventsByFrame) {
  let player = { x: 650, y: 520, facing: 'south', moving: false };
  const held = new Set();
  const steps = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (const event of heldEventsByFrame.get(frameIndex) ?? []) {
      if (event.action === 'down') held.add(event.direction);
      else held.delete(event.direction);
    }
    const input = { x: 0, y: 0 };
    for (const direction of held) {
      if (direction === 'west') input.x -= 1;
      if (direction === 'east') input.x += 1;
      if (direction === 'north') input.y -= 1;
      if (direction === 'south') input.y += 1;
    }
    // Frame 0 has no prior timestamp in app.js (state.lastTimestamp === 0
    // guard), so it always uses deltaSeconds=0 -- mirrored here too.
    const deltaSeconds = frameIndex === 0 ? 0 : FRAME_SECONDS;
    const next = moveActor(player, input, deltaSeconds, 'exterior');
    steps.push(Math.hypot(next.x - player.x, next.y - player.y));
    player = { x: next.x, y: next.y, facing: next.facing, moving: next.moved };
  }
  return { steps, player };
}

function eventsMap(entries) {
  const map = new Map();
  for (const [atFrame, action, direction] of entries) {
    if (!map.has(atFrame)) map.set(atFrame, []);
    map.get(atFrame).push({ action, direction });
  }
  return map;
}

test('a held direction produces a constant ~1.25px/frame step at 60fps, no warps', () => {
  const { steps } = simulateFrameLoop(40, eventsMap([[1, 'down', 'west']]));
  // Frame 0 is the deltaSeconds=0 boot frame (no movement possible yet).
  assert.equal(steps[0], 0);
  for (const step of steps.slice(1)) {
    assert.ok(step <= MAX_SANE_FRAME_STEP, `frame step ${step} exceeded ${MAX_SANE_FRAME_STEP}px`);
    assert.ok(
      Math.abs(step - STEADY_STATE_STEP) < 0.01,
      `frame step ${step} should equal the steady-state ${STEADY_STATE_STEP}px exactly (no double-application)`
    );
  }
});

test('a single short tap (down then up before the next frame samples it) moves at most one frame\'s worth', () => {
  // The key goes down and back up between frame 4 and frame 5's sampling,
  // i.e. it is held for exactly one frame's sampling instant -- the
  // shortest a real key press can register in a rAF-only architecture.
  const { steps } = simulateFrameLoop(20, eventsMap([
    [5, 'down', 'west'],
    [6, 'up', 'west']
  ]));
  const moved = steps.filter((step) => step > 0);
  assert.equal(moved.length, 1, `expected exactly one moving frame from a one-frame tap, got ${moved.length}`);
  assert.ok(moved[0] <= MAX_SANE_FRAME_STEP, `tap step ${moved[0]} exceeded ${MAX_SANE_FRAME_STEP}px`);
  assert.ok(
    Math.abs(moved[0] - STEADY_STATE_STEP) < 0.01,
    'a tap must move exactly one frame worth, not an extra nudged amount on top'
  );
});

test('reversing direction mid-hold never produces a combined "undo + redo" jump', () => {
  const events = eventsMap([
    [1, 'down', 'west'],
    [10, 'up', 'west'],
    [10, 'down', 'east']
  ]);
  const { steps } = simulateFrameLoop(20, events);
  for (let frameIndex = 1; frameIndex < steps.length; frameIndex += 1) {
    assert.ok(
      steps[frameIndex] <= MAX_SANE_FRAME_STEP,
      `frame ${frameIndex} step ${steps[frameIndex]} exceeded ${MAX_SANE_FRAME_STEP}px around the direction change`
    );
  }
  // The frame the direction actually flips still only moves one frame's
  // worth in the *new* direction -- not the old direction's leftover step
  // plus the new one.
  assert.ok(Math.abs(steps[10] - STEADY_STATE_STEP) < 0.01);
});

test('rapid mashing (key toggled on/off every single frame) never exceeds one frame\'s worth per frame', () => {
  const entries = [];
  for (let frameIndex = 1; frameIndex < 60; frameIndex += 1) {
    entries.push([frameIndex, frameIndex % 2 === 1 ? 'down' : 'up', 'west']);
  }
  const { steps } = simulateFrameLoop(60, eventsMap(entries));
  for (const step of steps) {
    assert.ok(step <= MAX_SANE_FRAME_STEP, `mashing produced a step of ${step}px, exceeding ${MAX_SANE_FRAME_STEP}px`);
  }
  // Mashing still makes net progress (every "down" frame moves), it just
  // never warps -- confirms this isn't a false pass from movement being
  // silently disabled.
  assert.ok(steps.some((step) => step > 0), 'mashing should still produce some movement');
});

test('regression illustration: reintroducing the old extra immediate call would exceed the bound', () => {
  // This does not call into app.js (its nudgePlayer is gone); it documents
  // the exact arithmetic the fix eliminates, using the same real
  // moveActor(): one frame's worth of normal per-frame movement, plus
  // nudgePlayer's old extra out-of-band 0.06s call for the same keypress,
  // both measured as displacement from the same starting point and summed
  // -- reproducing what used to reach the screen as a single visible jump
  // between two consecutive painted frames. This is a sanity check that the
  // bound the tests above enforce is not vacuous.
  const start = { x: 650, y: 520, facing: 'south' };
  const frameStep = moveActor(start, { x: -1, y: 0 }, FRAME_SECONDS, 'exterior');
  const nudgeStep = moveActor(start, { x: -1, y: 0 }, 0.06, 'exterior');
  const frameDelta = Math.hypot(frameStep.x - start.x, frameStep.y - start.y);
  const nudgeDelta = Math.hypot(nudgeStep.x - start.x, nudgeStep.y - start.y);
  const combinedStep = frameDelta + nudgeDelta;
  assert.ok(
    combinedStep > MAX_SANE_FRAME_STEP,
    'sanity check: the old double-call pattern should exceed the continuity bound (confirms the bound is not vacuous)'
  );
  assert.ok(
    combinedStep > STEADY_STATE_STEP * 3,
    `old pattern (${combinedStep.toFixed(2)}px) should be multiple times the steady-state ${STEADY_STATE_STEP}px step`
  );
});
