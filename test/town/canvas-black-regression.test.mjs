// test/town/canvas-black-regression.test.mjs
//
// Regression coverage for a P0 bug found by playtest + real-browser
// screenshots in public/fable5-v2: the canvas going permanently solid black
// (or otherwise permanently frozen/desynced) while the DOM-driven HUD
// (mission card, nearby prompt) kept updating normally. Reported state at
// the time: quest completed ("調査完了・tiny-town"), player inside the inn
// near the exit trigger ("宿屋の玄関 / そのまま進むと出られます").
//
// Root cause, confirmed against a real Chrome tab (requestAnimationFrame
// manually pumped via a hijacked queue, since a backgrounded/hidden tab
// never fires it on its own -- see the investigation session for the full
// harness): app.js's frame(timestamp) trusted requestAnimationFrame's
// timestamp argument to always be a finite DOMHighResTimeStamp and never
// validated it. A single non-finite timestamp reaching frame() had two
// compounding, PERMANENT effects, neither of which threw where it first
// went wrong (so nothing stopped the corruption from spreading) and neither
// of which self-healed on later, perfectly valid frames:
//
//   1. state.lastTimestamp itself got poisoned (timestamp - lastTimestamp
//      is NaN forever once either side is NaN), so every later
//      deltaSeconds was NaN too, which poisoned state.cameraFocus via
//      lerpCameraFocus: `current.x + (target.x - current.x) * k` is NaN
//      forever once current.x is NaN, regardless of k -- confirmed via
//      direct state inspection across 20+ subsequent frames fed perfectly
//      valid timestamps. context.translate() silently no-ops on a NaN
//      argument (verified directly against the real CanvasRenderingContext2D
//      in Chrome) rather than throwing, so this doesn't crash -- it just
//      permanently desyncs the camera from the player, rendering whatever
//      happens to sit at the *previous* (or, after a setTransform, the
//      un-translated) transform instead.
//   2. Whenever state.questStage === 'completed' (exactly the reported
//      state) and mode === 'interior' (also exactly the reported state),
//      drawLedgerCompletion() runs unconditionally every frame and used to
//      compute `0.86 + Math.sin(timestamp / 260) * 0.08` with no guard.
//      A NaN timestamp makes that NaN, which taints the
//      `rgba(255, 228, 145, ${...})` string fed to
//      CanvasGradient.addColorStop() into 'rgba(255, 228, 145, NaN)'.
//      Unlike fillStyle/strokeStyle (which silently ignore an unparsable
//      color), addColorStop THROWS a SyntaxError for one -- confirmed
//      directly against a real browser, exact message: "Failed to execute
//      'addColorStop' on 'CanvasGradient': The value provided (...) could
//      not be parsed as a color." That exception is uncaught (frame() has
//      no try/catch anywhere in this app), so it propagates out of
//      drawWorld() and frame(), skipping the trailing
//      requestAnimationFrame(frame) call that keeps the game running.
//      Confirmed end to end: after this throw, the internal rAF queue
//      drops to zero and never receives another callback even after 20+
//      further pump attempts with valid timestamps -- the render loop is
//      dead, permanently, with no error surfaced anywhere in the DOM (the
//      app has no window.onerror/try-catch around the rAF loop at all), so
//      the last successfully-updated HUD text (mission card, prompt) stays
//      on screen looking deceptively alive while the canvas never paints
//      again. This is the mechanism that most precisely matches "HUD still
//      correct, canvas dead forever."
//
// A secondary, related defect (hypothesis 1 in the investigation brief):
// performAction()'s default timestamp used to be performance.now(), a
// different clock than the rAF-loop timestamp its own guards
// (state.transitionUntil, a pending transition's startedAt) are compared
// against. In an unmodified real browser the two clocks agree closely
// enough not to matter, but nothing *guaranteed* that, and a transition
// started with startedAt on a foreign/offset clock could get stuck with
// `elapsed` deeply negative forever -- measured directly: with one
// constructed but realistic offset it took ~734 SECONDS of continued rAF
// time to resolve on its own. See 'a transition started with startedAt on a
// foreign clock...' below for the fixed behavior.
//
// The fix (see app.js/world-runtime.mjs):
//   - frame() sanitizes its timestamp via sanitizeTimestamp() before
//     anything downstream ever sees it (falls back to state.lastTimestamp,
//     which is therefore finite by construction forever after).
//   - smoothingFactor()/lerpCameraFocus() independently guard against a
//     non-finite deltaSeconds/current so a corrupted camera focus
//     self-heals (snaps to target) within one frame instead of staying
//     broken forever, as defense in depth beyond the frame() fix.
//   - createCamera() guards a non-finite focus the same way.
//   - fadeOverlayAlpha() returns 0 (not NaN) for non-finite input.
//   - ledgerCompletionPulse() (extracted from drawLedgerCompletion
//     specifically so this is directly testable) guards against a
//     non-finite timestamp, closing the exact addColorStop crash site.
//   - isTransitionExpired() is a watchdog: updateModeTransition() force-
//     completes (applies the mode switch if not yet applied, and always
//     clears state.pendingTransition) once |elapsed| >= TRANSITION_TOTAL_MS
//     * 2, so a transition can never stay wedged for any reason, including
//     the clock-mismatch failure mode above.
//   - performAction()/advanceDialogue() now source their default/implicit
//     "now" from state.lastTimestamp (the rAF loop's own clock) instead of
//     performance.now(), removing the second clock basis entirely.
//   - beginModeTransition()'s existing `if (state.pendingTransition)
//     return;` re-entry guard (unchanged, already correct) is exercised
//     directly here too, since a regression there would reintroduce a
//     perpetually-restarting, never-completing transition.
//
// This file drives real, adversarial timestamp sequences -- large origin
// (matching a real tab open for a while), +-3ms jitter, multi-second gaps
// (a backgrounded tab resuming), injected non-finite frames, and a
// foreign-clock manual action -- against the REAL exported functions (not
// ports), through a local harness that mirrors app.js's current
// frame()/updateModeTransition()/updateAutoTransition()/updateCamera()/
// beginModeTransition()/applyModeSwitch()/performAction() orchestration
// exactly (the same pattern test/town/door-auto-transition.test.mjs and
// test/town/movement-continuity.test.mjs already use for app.js logic that
// isn't itself exported, since app.js is DOM-coupled at module scope and
// cannot be imported under Node).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTOR_CONTRACT,
  DOOR_AUTO_COOLDOWN_MS,
  INN_CONTRACT,
  createCamera,
  createDoorAutoState,
  evaluateDoorAutoTransition,
  fadeOverlayAlpha,
  isTransitionExpired,
  ledgerCompletionPulse,
  lerpCameraFocus,
  moveActor,
  nearbyInteraction,
  smoothingFactor
} from '../../public/fable5-v2/world-runtime.mjs';

const TRANSITION_TOTAL_MS = 200;
const TRANSITION_HALF_MS = TRANSITION_TOTAL_MS / 2;
const CAMERA_SMOOTHING_RATE = 0.15;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// --- harness: mirrors app.js's CURRENT (fixed) orchestration ---------------
//
// Every actual computation below is the real exported function; only the
// per-frame sequencing (which lives in app.js and is DOM-coupled) is
// mirrored, matching this repo's existing convention for testing app.js
// orchestration.

function freshState() {
  return {
    mode: 'exterior',
    player: { x: ACTOR_CONTRACT.spawn.x, y: ACTOR_CONTRACT.spawn.y, facing: 'north', moving: false },
    nearby: null,
    zoom: 1,
    cameraFocus: { x: ACTOR_CONTRACT.spawn.x, y: ACTOR_CONTRACT.spawn.y },
    viewport: { width: 1280, height: 720 },
    transitionUntil: 0,
    pendingTransition: null,
    doorAuto: createDoorAutoState(),
    lastTimestamp: 0,
    questStage: 'unstarted',
    dialogueOpen: false
  };
}

function sanitizeTimestamp(timestamp, fallback) {
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function applyModeSwitch(state, mode) {
  state.mode = mode;
  if (mode === 'interior') {
    state.player.x = INN_CONTRACT.interior.entryFoot.x;
    state.player.y = INN_CONTRACT.interior.entryFoot.y;
    state.cameraFocus = { x: INN_CONTRACT.interior.cameraFocus.x, y: INN_CONTRACT.interior.cameraFocus.y };
  } else {
    state.player.x = INN_CONTRACT.door.returnPoint.x;
    state.player.y = INN_CONTRACT.door.returnPoint.y;
    state.cameraFocus = { x: state.player.x, y: state.player.y };
  }
}

function beginModeTransition(state, mode, timestamp) {
  if (state.pendingTransition) return;
  state.transitionUntil = timestamp + TRANSITION_TOTAL_MS;
  state.pendingTransition = { targetMode: mode, startedAt: timestamp, applied: false };
  state.doorAuto = { latched: true, cooldownUntil: timestamp + DOOR_AUTO_COOLDOWN_MS };
}

function updateModeTransition(state, timestamp) {
  const pending = state.pendingTransition;
  if (!pending) return;
  const elapsed = timestamp - pending.startedAt;
  const expired = isTransitionExpired(elapsed, TRANSITION_TOTAL_MS);
  if (!pending.applied && (elapsed >= TRANSITION_HALF_MS || expired)) {
    applyModeSwitch(state, pending.targetMode);
    pending.applied = true;
  }
  if (elapsed >= TRANSITION_TOTAL_MS || expired) {
    state.pendingTransition = null;
  }
}

function currentFadeAlpha(state, timestamp) {
  const pending = state.pendingTransition;
  return pending ? fadeOverlayAlpha(timestamp - pending.startedAt, TRANSITION_TOTAL_MS) : 0;
}

function updateAutoTransition(state, timestamp) {
  if (state.pendingTransition || state.dialogueOpen) return;
  const autoId = state.mode === 'exterior' ? 'enter-inn' : 'exit-inn';
  const inside = state.nearby?.id === autoId;
  const result = evaluateDoorAutoTransition(state.doorAuto, inside, timestamp);
  state.doorAuto = { latched: result.latched, cooldownUntil: result.cooldownUntil };
  if (result.fire) beginModeTransition(state, state.mode === 'exterior' ? 'interior' : 'exterior', timestamp);
}

function updateCamera(state, deltaSeconds) {
  const target = state.mode === 'interior' ? INN_CONTRACT.interior.cameraFocus : state.player;
  state.cameraFocus = lerpCameraFocus(state.cameraFocus, target, deltaSeconds, CAMERA_SMOOTHING_RATE);
}

function updateNearby(state, timestamp) {
  state.nearby = timestamp < state.transitionUntil ? null : nearbyInteraction(state.player, state.mode);
}

function performAction(state, timestamp, nearbyId) {
  if (state.dialogueOpen || timestamp < state.transitionUntil || !state.nearby) return;
  if (nearbyId === 'enter-inn' && state.nearby.id === 'enter-inn') beginModeTransition(state, 'interior', timestamp);
  if (nearbyId === 'exit-inn' && state.nearby.id === 'exit-inn') beginModeTransition(state, 'exterior', timestamp);
}

// Mirrors frame()'s full per-frame sequence, including a moveActor() step so
// end-to-end walking scenarios can drive themselves. `input` is a
// {x,y} movement vector for this frame (0,0 for "no input held").
function frame(state, rawTimestamp, input = { x: 0, y: 0 }) {
  const timestamp = sanitizeTimestamp(rawTimestamp, state.lastTimestamp);
  const deltaSeconds = state.lastTimestamp === 0
    ? 0
    : Math.min(0.05, Math.max(0, (timestamp - state.lastTimestamp) / 1000));
  state.lastTimestamp = timestamp;
  if (!state.dialogueOpen && timestamp >= state.transitionUntil) {
    const moved = moveActor(state.player, input, deltaSeconds, state.mode);
    state.player.x = moved.x;
    state.player.y = moved.y;
    state.player.facing = moved.facing;
    state.player.moving = moved.moved;
  }
  updateNearby(state, timestamp);
  updateModeTransition(state, timestamp);
  updateAutoTransition(state, timestamp);
  updateCamera(state, deltaSeconds);
  return { timestamp, deltaSeconds, fadeAlpha: currentFadeAlpha(state, timestamp) };
}

// A camera object is "healthy" if every numeric field is finite -- the
// direct, DOM-independent stand-in for "the canvas is not permanently
// broken", since createCamera's output is exactly what feeds
// context.translate() in drawWorld().
function assertHealthyCamera(state, label) {
  assert.ok(isFiniteNumber(state.cameraFocus.x), `${label}: cameraFocus.x not finite (${state.cameraFocus.x})`);
  assert.ok(isFiniteNumber(state.cameraFocus.y), `${label}: cameraFocus.y not finite (${state.cameraFocus.y})`);
  const camera = createCamera(state.viewport.width, state.viewport.height, state.cameraFocus, state.zoom);
  assert.ok(isFiniteNumber(camera.x), `${label}: camera.x not finite (${camera.x})`);
  assert.ok(isFiniteNumber(camera.y), `${label}: camera.y not finite (${camera.y})`);
}

function jitter(base, amplitude = 3) {
  return base + (Math.random() * amplitude * 2 - amplitude);
}

// --- unit-level guards on the individual fixed/added pure functions --------

test('smoothingFactor returns a finite value in [0,1] for non-finite deltaSeconds', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x']) {
    const k = smoothingFactor(0.15, bad);
    assert.ok(isFiniteNumber(k), `smoothingFactor(0.15, ${bad}) = ${k} is not finite`);
    assert.ok(k >= 0 && k <= 1, `smoothingFactor(0.15, ${bad}) = ${k} out of [0,1]`);
  }
});

test('lerpCameraFocus self-heals a non-finite current onto target in a single call (no permanent NaN)', () => {
  const target = { x: 212, y: 300 };
  for (const brokenCurrent of [{ x: NaN, y: NaN }, { x: Infinity, y: 5 }, { x: 5, y: -Infinity }, {}]) {
    const result = lerpCameraFocus(brokenCurrent, target, 1 / 60, 0.15);
    assert.ok(isFiniteNumber(result.x), `x not finite for broken current ${JSON.stringify(brokenCurrent)}`);
    assert.ok(isFiniteNumber(result.y), `y not finite for broken current ${JSON.stringify(brokenCurrent)}`);
  }
});

test('lerpCameraFocus keeps healing on every subsequent call even while deltaSeconds stays non-finite', () => {
  // Mirrors the exact failure mode found in the browser: once cameraFocus
  // is NaN, does calling lerpCameraFocus again (with a still-bad delta)
  // make it worse, or does the self-heal hold?
  let focus = { x: NaN, y: NaN };
  const target = { x: 212, y: 300 };
  for (let i = 0; i < 5; i += 1) {
    focus = lerpCameraFocus(focus, target, NaN, 0.15);
    assert.ok(isFiniteNumber(focus.x), `frame ${i}: x went non-finite again`);
    assert.ok(isFiniteNumber(focus.y), `frame ${i}: y went non-finite again`);
  }
});

test('createCamera returns a finite, clamped camera for a non-finite focus', () => {
  for (const badFocus of [{ x: NaN, y: NaN }, { x: Infinity, y: -Infinity }, {}, null, undefined]) {
    const camera = createCamera(1280, 720, badFocus, 1);
    assert.ok(isFiniteNumber(camera.x), `camera.x not finite for focus ${JSON.stringify(badFocus)}`);
    assert.ok(isFiniteNumber(camera.y), `camera.y not finite for focus ${JSON.stringify(badFocus)}`);
    assert.ok(camera.x >= 0 && camera.y >= 0, 'camera position must stay within the non-negative clamp');
  }
});

test('fadeOverlayAlpha returns a real 0, not NaN, for non-finite elapsed/total', () => {
  for (const [elapsed, total] of [[NaN, 200], [100, NaN], [Infinity, 200], [100, Infinity], [NaN, NaN]]) {
    const alpha = fadeOverlayAlpha(elapsed, total);
    assert.equal(alpha, 0, `fadeOverlayAlpha(${elapsed}, ${total}) = ${alpha}, expected exactly 0`);
    assert.ok(!Number.isNaN(alpha));
  }
});

test('ledgerCompletionPulse stays finite for a non-finite timestamp, keeping every addColorStop rgba() string parseable', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null]) {
    const pulse = ledgerCompletionPulse(bad);
    assert.ok(isFiniteNumber(pulse), `ledgerCompletionPulse(${bad}) = ${pulse} is not finite`);
    // Reproduce app.js's exact template literals: if pulse were ever NaN,
    // these strings would contain the literal substring "NaN" and
    // CanvasGradient.addColorStop() would throw a SyntaxError for them
    // (confirmed against a real browser) -- the exact mechanism that
    // permanently killed the render loop.
    const stop0 = `rgba(255, 228, 145, ${0.38 * pulse})`;
    const stop1 = `rgba(255, 194, 82, ${0.2 * pulse})`;
    assert.ok(!stop0.includes('NaN'), `color stop became unparsable: ${stop0}`);
    assert.ok(!stop1.includes('NaN'), `color stop became unparsable: ${stop1}`);
  }
});

test('ledgerCompletionPulse is unchanged for ordinary finite timestamps (fix does not alter normal visuals)', () => {
  for (const t of [0, 1, 1000, 86_400_000]) {
    const expected = 0.86 + Math.sin(t / 260) * 0.08;
    assert.ok(Math.abs(ledgerCompletionPulse(t) - expected) < 1e-12);
  }
});

test('isTransitionExpired: false while genuinely in flight, true at/after 2x totalMs, true for non-finite/degenerate input', () => {
  assert.equal(isTransitionExpired(0, TRANSITION_TOTAL_MS), false, 'just started');
  assert.equal(isTransitionExpired(TRANSITION_HALF_MS, TRANSITION_TOTAL_MS), false, 'at the midpoint');
  assert.equal(isTransitionExpired(TRANSITION_TOTAL_MS - 1, TRANSITION_TOTAL_MS), false, 'just before the end');
  assert.equal(isTransitionExpired(TRANSITION_TOTAL_MS * 2 - 1, TRANSITION_TOTAL_MS), false, 'just under the watchdog threshold');
  assert.equal(isTransitionExpired(TRANSITION_TOTAL_MS * 2, TRANSITION_TOTAL_MS), true, 'exactly at the watchdog threshold');
  assert.equal(isTransitionExpired(TRANSITION_TOTAL_MS * 5, TRANSITION_TOTAL_MS), true, 'way too long');
  assert.equal(isTransitionExpired(-TRANSITION_TOTAL_MS * 5, TRANSITION_TOTAL_MS), true, 'deeply negative (clock mismatch)');
  assert.equal(isTransitionExpired(NaN, TRANSITION_TOTAL_MS), true, 'non-finite elapsed');
  assert.equal(isTransitionExpired(50, 0), true, 'degenerate zero duration');
  assert.equal(isTransitionExpired(50, -1), true, 'degenerate negative duration');
});

// --- orchestration-level regression: the exact browser-confirmed mechanism -

test('a single non-finite rAF timestamp mid-walk does not permanently corrupt cameraFocus (root cause, scenario A)', () => {
  const state = freshState();
  let t = 87_000; // large origin, matches a real tab open for a while
  for (let i = 0; i < 10; i += 1) {
    t += 16.667;
    frame(state, t, { x: -1, y: 0 });
    assertHealthyCamera(state, `pre-injection frame ${i}`);
  }
  // The hostile frame: a non-finite rAF timestamp.
  frame(state, NaN, { x: -1, y: 0 });
  assertHealthyCamera(state, 'the injected NaN frame itself');
  // Recovery: many more perfectly ordinary frames. Before the fix this
  // stayed permanently NaN here even though every one of these timestamps
  // is completely valid.
  for (let i = 0; i < 30; i += 1) {
    t += 16.667;
    frame(state, t, { x: 0, y: 0 });
    assertHealthyCamera(state, `recovery frame ${i}`);
  }
});

test('quest already completed + interior + a non-finite timestamp: the exact reported failure mode never throws', () => {
  // Reproduces the precise state the bug report confirmed via real
  // screenshots: quest complete, player inside near the exit trigger, then
  // a hostile timestamp arrives. Before the fix, this combination is what
  // threw an uncaught SyntaxError out of CanvasGradient.addColorStop() (see
  // ledgerCompletionPulse's own test above) and killed the render loop
  // forever. This test drives the orchestration end to end and separately
  // asserts the render-affecting values it would have fed a real canvas
  // stay finite/parseable throughout.
  const state = freshState();
  state.questStage = 'completed';
  state.mode = 'interior';
  state.player = { x: INN_CONTRACT.interior.entryFoot.x, y: INN_CONTRACT.interior.entryFoot.y, facing: 'south', moving: false };
  state.cameraFocus = { x: INN_CONTRACT.interior.cameraFocus.x, y: INN_CONTRACT.interior.cameraFocus.y };
  let t = 100_000;
  // Mirrors what beginModeTransition force-latches on every real entry:
  // entryFoot sits inside the exit trigger's own radius (see
  // door-auto-transition.test.mjs), so without this the very first frame
  // below would immediately auto-fire the exit and the player would never
  // actually be observed sitting at the trigger -- exactly the state the
  // real bug report confirmed via screenshots.
  state.doorAuto = { latched: true, cooldownUntil: t + DOOR_AUTO_COOLDOWN_MS };
  for (let i = 0; i < 5; i += 1) {
    t += 16.667;
    frame(state, t, { x: 0, y: 0 });
  }
  assert.equal(state.nearby?.id, 'exit-inn', 'test setup: expected to be sitting at the exit trigger');
  assert.equal(state.pendingTransition, null, 'test setup: no transition should have auto-fired yet (latch still holds)');

  const hostileValues = [NaN, Infinity, -Infinity];
  for (const hostile of hostileValues) {
    frame(state, hostile, { x: 0, y: 0 });
    assertHealthyCamera(state, `hostile timestamp ${hostile}`);
    const pulse = ledgerCompletionPulse(state.lastTimestamp);
    assert.ok(isFiniteNumber(pulse), `ledger pulse not finite after hostile timestamp ${hostile}`);
    assert.ok(!`rgba(255, 228, 145, ${0.38 * pulse})`.includes('NaN'), 'ledger color stop became unparsable');
  }
  // And the loop keeps producing healthy, finite state on ordinary frames
  // straight afterward -- i.e. nothing was left permanently poisoned.
  for (let i = 0; i < 10; i += 1) {
    t += 16.667;
    frame(state, t, { x: 0, y: 0 });
    assertHealthyCamera(state, `post-hostile recovery frame ${i}`);
    assert.ok(isFiniteNumber(ledgerCompletionPulse(state.lastTimestamp)));
  }
});

test('a multi-second gap mid-fade (a backgrounded tab resuming) still resolves the transition cleanly', () => {
  const state = freshState();
  state.player = { ...INN_CONTRACT.door.approachPoint, facing: 'north', moving: false };
  let t = 91_234; // large origin
  for (let i = 0; i < 3; i += 1) {
    t += jitter(16.667);
    frame(state, t, { x: 0, y: 0 });
  }
  t += jitter(16.667);
  frame(state, t, { x: 0, y: 0 });
  assert.ok(state.pendingTransition, 'expected the auto-transition to have fired by now');
  const fadeAlphaMidFlight = currentFadeAlpha(state, t);
  assert.ok(fadeAlphaMidFlight >= 0 && fadeAlphaMidFlight <= 1);

  // Tab goes hidden for 4.2s mid-fade, well before the 200ms transition
  // would naturally complete.
  t += 4_200;
  frame(state, t, { x: 0, y: 0 });

  assert.equal(state.pendingTransition, null, 'transition must have resolved across the gap, not stayed stuck');
  assert.equal(currentFadeAlpha(state, t), 0, 'fade alpha must be back to exactly 0 once the transition is over');
  assertHealthyCamera(state, 'after the gap');
});

test('a transition started with startedAt on a foreign/offset clock still resolves within TRANSITION_TOTAL_MS*2 via the watchdog', () => {
  // Directly exercises the watchdog's one job: without it, a transition
  // whose startedAt was recorded on a different clock basis than the
  // timestamps updateModeTransition is later driven with can get elapsed
  // stuck deeply negative forever (measured directly at investigation time:
  // one realistic offset took ~734 SECONDS of continued rAF time to
  // resolve on its own). With performAction now sourcing its default
  // timestamp from state.lastTimestamp instead of performance.now(), this
  // specific mismatch should not arise in practice any more -- this test
  // simulates it happening anyway (e.g. a future regression reintroducing a
  // second clock) and confirms the watchdog bounds the damage.
  const state = freshState();
  const foreignClockOffset = 733_452.918;
  state.pendingTransition = { targetMode: 'interior', startedAt: foreignClockOffset, applied: false };
  state.transitionUntil = foreignClockOffset + TRANSITION_TOTAL_MS;

  let t = 0;
  let resolvedAtFrame = null;
  for (let i = 0; i < 50; i += 1) {
    t += 16.667;
    frame(state, t, { x: 0, y: 0 });
    if (!state.pendingTransition) { resolvedAtFrame = i; break; }
  }
  assert.ok(resolvedAtFrame !== null, 'transition never resolved within 50 frames (~833ms) -- watchdog did not engage');
  // TRANSITION_TOTAL_MS*2 = 400ms of *elapsed* (i.e. measured from
  // startedAt, which for this deeply-offset case means as soon as the
  // watchdog's |elapsed| >= totalMs*2 condition is reachable at all -- in
  // practice this fires on the very first frame, since |0 - 733452.918| is
  // already far past the threshold).
  assert.equal(resolvedAtFrame, 0, 'the watchdog should force-complete an already-way-out-of-range transition immediately');
  assertHealthyCamera(state, 'after the watchdog forced completion');
});

test('mashing the manual action during an in-flight transition never restarts it and never double-applies the mode switch', () => {
  const state = freshState();
  state.player = { ...INN_CONTRACT.door.approachPoint, facing: 'north', moving: false };
  let t = 50_000;
  frame(state, t, { x: 0, y: 0 });
  t += 16.667;
  frame(state, t, { x: 0, y: 0 }); // auto-fire should happen inside this call
  assert.ok(state.pendingTransition, 'expected the auto-enter to have fired');
  const startedAt = state.pendingTransition.startedAt;
  let modeSwitchCount = 0;
  let lastMode = state.mode;

  for (let i = 0; i < 20; i += 1) {
    t += 16.667;
    // Mash the manual action every single frame using the SAME (rAF-loop)
    // clock a real keydown handler now uses (state.lastTimestamp) -- see
    // performAction's own comment in app.js for why that clock choice
    // matters.
    performAction(state, state.lastTimestamp, 'enter-inn');
    frame(state, t, { x: 0, y: 0 });
    if (state.pendingTransition) {
      assert.equal(
        state.pendingTransition.startedAt, startedAt,
        `mashing at frame ${i} restarted the transition's startedAt`
      );
    }
    if (state.mode !== lastMode) { modeSwitchCount += 1; lastMode = state.mode; }
  }
  assert.equal(state.pendingTransition, null, 'transition should have completed normally despite mashing');
  assert.equal(modeSwitchCount, 1, `expected exactly one mode switch, observed ${modeSwitchCount}`);
  assert.equal(state.mode, 'interior');
});

test('rushing the door trigger then immediately reversing direction does not bounce back out mid-transition or corrupt state', () => {
  const state = freshState();
  state.player = { ...INN_CONTRACT.door.approachPoint, facing: 'north', moving: false };
  let t = 60_000;
  // Approach and cross the trigger holding north.
  let entered = false;
  for (let i = 0; i < 30 && !entered; i += 1) {
    t += 16.667;
    frame(state, t, { x: 0, y: -1 });
    if (state.pendingTransition) entered = true;
  }
  assert.ok(entered, 'expected walking north from the approach point to trigger the auto-enter');
  const startedAt = state.pendingTransition.startedAt;
  // Immediately reverse direction (hold south) for the rest of the
  // transition and a while after.
  for (let i = 0; i < 40; i += 1) {
    t += 16.667;
    frame(state, t, { x: 0, y: 1 });
    if (state.pendingTransition) {
      assert.equal(state.pendingTransition.startedAt, startedAt, `reversal at frame ${i} restarted the transition`);
    }
    assertHealthyCamera(state, `reversal frame ${i}`);
  }
  assert.equal(state.mode, 'interior', 'the entry transition should have completed exactly once');
});

test('large-origin, jittered timestamps across a full enter/exit cycle keep cameraFocus and fadeAlpha finite on every single frame', () => {
  const state = freshState();
  state.player = { x: ACTOR_CONTRACT.spawn.x, y: ACTOR_CONTRACT.spawn.y, facing: 'north', moving: false };
  let t = 123_456; // large origin
  const path = [
    { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 0, y: 1 }, { x: 0, y: 1 }
  ];
  let frameCount = 0;
  for (const input of path) {
    for (let i = 0; i < 200; i += 1) {
      t += jitter(16.667);
      const { fadeAlpha } = frame(state, t, input);
      frameCount += 1;
      assert.ok(isFiniteNumber(fadeAlpha), `frame ${frameCount}: fadeAlpha not finite (${fadeAlpha})`);
      assert.ok(fadeAlpha >= 0 && fadeAlpha <= 1, `frame ${frameCount}: fadeAlpha ${fadeAlpha} out of [0,1]`);
      assertHealthyCamera(state, `frame ${frameCount}`);
      if (!state.pendingTransition) {
        assert.equal(fadeAlpha, 0, `frame ${frameCount}: fadeAlpha must be exactly 0 with no transition pending`);
      }
    }
  }
});

test('beginModeTransition re-entry guard: a second call while pending is a strict no-op (regression for a perpetually-restarting transition)', () => {
  const state = freshState();
  beginModeTransition(state, 'interior', 1000);
  const first = { ...state.pendingTransition };
  const firstTransitionUntil = state.transitionUntil;
  beginModeTransition(state, 'interior', 1050);
  beginModeTransition(state, 'exterior', 1100);
  assert.deepEqual(state.pendingTransition, first, 'a pending transition must not be overwritten by a later begin call');
  assert.equal(state.transitionUntil, firstTransitionUntil, 'transitionUntil (and therefore the input lock) must not move either');
});
