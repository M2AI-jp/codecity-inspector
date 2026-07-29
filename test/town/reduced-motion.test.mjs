// test/town/reduced-motion.test.mjs
//
// Regression coverage for prefers-reduced-motion support in public/fable5-v2.
// Before this, @media (prefers-reduced-motion: reduce) in styles.css only
// ever touched the startup spinner's CSS animation -- the actual gameplay
// motion (camera easing, the quest-completion ledger glow's pulse, and the
// black fade app.js drives across every door transition) never read the
// user's OS/browser motion preference at all.
//
// The fix is three small pure functions in world-runtime.mjs -- each one
// the *decision* a specific animated system switches on, kept deliberately
// DOM-free (matching this file's own convention: window.matchMedia is a
// browser API and is read exactly once, plus live on every 'change' event,
// by app.js, which then hands the resulting boolean to these functions
// rather than branching inline):
//
//   - cameraSmoothingRateForMotionPreference(reduceMotion, baseRate):
//     app.js's updateCamera() reads this live, every single frame, so a
//     mid-session OS-level toggle changes camera behaviour on the very next
//     frame with no reload. rate=1 makes smoothingFactor() (already tested
//     in canvas-black-regression.test.mjs) return 1 for any deltaSeconds>0,
//     which makes lerpCameraFocus() snap `current` fully onto `target`
//     every frame instead of easing toward it.
//   - ledgerPulseForMotionPreference(reduceMotion, timestamp): replaces
//     ledgerCompletionPulse()'s Math.sin(...) oscillation with that same
//     function's own rest/midpoint value (0.86) -- same average brightness,
//     simply no longer pulsing.
//   - transitionDurationForMotionPreference(reduceMotion, base, reduced):
//     app.js's beginModeTransition() resolves this ONCE, at the moment a
//     transition begins, and stores it on the transition itself
//     (pending.totalMs) rather than re-reading the live setting every
//     frame -- so a toggle mid-fade can never change an already-running
//     transition's speed out from under it, only the next transition that
//     begins after the toggle.
//
// This file tests the three real exported pure functions directly, their
// composition with the existing smoothingFactor/lerpCameraFocus/
// ledgerCompletionPulse/fadeOverlayAlpha exports, and an orchestration-level
// harness mirroring app.js's current beginModeTransition/
// updateModeTransition/updateCamera (the same "mirror app.js's DOM-coupled
// orchestration against the real pure functions" convention
// canvas-black-regression.test.mjs and door-auto-transition.test.mjs
// already use) to lock in the "live every frame" vs "captured once per
// transition" distinction above as a permanent regression guard.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOOR_AUTO_COOLDOWN_MS,
  cameraSmoothingRateForMotionPreference,
  createDoorAutoState,
  fadeOverlayAlpha,
  isTransitionExpired,
  ledgerCompletionPulse,
  ledgerPulseForMotionPreference,
  lerpCameraFocus,
  smoothingFactor,
  transitionDurationForMotionPreference
} from '../../public/fable5-v2/world-runtime.mjs';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// --- cameraSmoothingRateForMotionPreference ---------------------------------

test('cameraSmoothingRateForMotionPreference returns exactly 1 whenever reduceMotion is true, regardless of baseRate', () => {
  for (const baseRate of [0, 0.01, 0.15, 0.5, 0.9999, 1]) {
    assert.equal(cameraSmoothingRateForMotionPreference(true, baseRate), 1);
  }
});

test('cameraSmoothingRateForMotionPreference passes baseRate through unchanged whenever reduceMotion is false', () => {
  for (const baseRate of [0, 0.01, 0.15, 0.5, 0.9999, 1]) {
    assert.equal(cameraSmoothingRateForMotionPreference(false, baseRate), baseRate);
  }
});

test('a rate of 1 makes lerpCameraFocus fully snap onto target in a single ordinary frame (the actual camera-follow behaviour)', () => {
  const current = { x: 100, y: 400 };
  const target = { x: 650, y: 520 };
  const reducedRate = cameraSmoothingRateForMotionPreference(true, 0.15);
  const snapped = lerpCameraFocus(current, target, 1 / 60, reducedRate);
  assert.deepEqual(snapped, { x: 650, y: 520 });
});

test('the normal rate (reduceMotion=false) still leaves the camera trailing the target after one ordinary frame (no regression to eased motion)', () => {
  const current = { x: 100, y: 400 };
  const target = { x: 650, y: 520 };
  const normalRate = cameraSmoothingRateForMotionPreference(false, 0.15);
  const eased = lerpCameraFocus(current, target, 1 / 60, normalRate);
  assert.notDeepEqual(eased, target);
  const remainingDistance = Math.hypot(target.x - eased.x, target.y - eased.y);
  const startDistance = Math.hypot(target.x - current.x, target.y - current.y);
  assert.ok(remainingDistance > 0 && remainingDistance < startDistance, 'expected partial easing, not a snap and not a stall');
});

test('rate=1 still resolves to a finite smoothingFactor for every deltaSeconds, including the deltaSeconds=0 boot frame', () => {
  assert.equal(smoothingFactor(1, 0), 0, 'no time elapsed: even a full-snap rate closes zero distance on the very first (deltaSeconds=0) frame');
  for (const dt of [1 / 144, 1 / 60, 1 / 30, 0.05]) {
    assert.equal(smoothingFactor(1, dt), 1, `expected an immediate full snap at dt=${dt}`);
  }
});

// --- ledgerPulseForMotionPreference ------------------------------------------

test('ledgerPulseForMotionPreference freezes at ledgerCompletionPulse\'s own rest value (0.86) whenever reduceMotion is true', () => {
  for (const timestamp of [0, 1, 1000, 86_400_000, NaN, Infinity, -Infinity, undefined]) {
    assert.equal(ledgerPulseForMotionPreference(true, timestamp), 0.86);
  }
});

test('ledgerPulseForMotionPreference delegates exactly to ledgerCompletionPulse whenever reduceMotion is false (no change to normal visuals)', () => {
  for (const timestamp of [0, 1, 1000, 86_400_000, NaN, Infinity, -Infinity, undefined]) {
    assert.equal(ledgerPulseForMotionPreference(false, timestamp), ledgerCompletionPulse(timestamp));
  }
});

test('the frozen reduced-motion pulse equals the oscillation\'s own time-averaged midpoint, so brightness does not visibly jump when the preference is toggled', () => {
  // ledgerCompletionPulse(t) = 0.86 + sin(t/260)*0.08, whose time-average
  // over any whole number of periods is exactly its constant term, 0.86 --
  // i.e. the reduced-motion value is not an arbitrary pick, it is the same
  // brightness the animation already spends equal time above and below.
  let total = 0;
  const samples = 2_000;
  const period = 260 * 2 * Math.PI;
  for (let i = 0; i < samples; i += 1) total += ledgerCompletionPulse((i / samples) * period);
  const average = total / samples;
  assert.ok(Math.abs(average - 0.86) < 0.001, `expected the oscillation's average (${average}) to match the frozen value (0.86)`);
});

test('ledgerPulseForMotionPreference always stays within the exact same [0.78, 0.94] range the unfrozen pulse uses, in both modes', () => {
  for (const reduceMotion of [true, false]) {
    for (const timestamp of [0, 130, 260, 500, 12_345]) {
      const pulse = ledgerPulseForMotionPreference(reduceMotion, timestamp);
      assert.ok(pulse >= 0.78 && pulse <= 0.94, `pulse ${pulse} out of range for reduceMotion=${reduceMotion}, t=${timestamp}`);
      // Also guards the exact addColorStop-crash regression this value
      // ultimately feeds (see ledgerCompletionPulse's own comment): must
      // never itself be capable of producing a "NaN"-tainted rgba string.
      assert.ok(!`rgba(255, 228, 145, ${0.38 * pulse})`.includes('NaN'));
    }
  }
});

// --- transitionDurationForMotionPreference -----------------------------------

test('transitionDurationForMotionPreference picks reducedDurationMs when reduceMotion is true, baseDurationMs otherwise', () => {
  const cases = [[200, 80], [1000, 0], [50, 50], [600, 1]];
  for (const [base, reduced] of cases) {
    assert.equal(transitionDurationForMotionPreference(true, base, reduced), reduced);
    assert.equal(transitionDurationForMotionPreference(false, base, reduced), base);
  }
});

test('the app\'s own reduced duration (80ms) is meaningfully shorter than its base duration (200ms), not equal or reversed', () => {
  const APP_TRANSITION_TOTAL_MS = 200; // mirrors app.js's own constant
  const APP_TRANSITION_TOTAL_MS_REDUCED = 80; // mirrors app.js's own constant
  assert.ok(APP_TRANSITION_TOTAL_MS_REDUCED > 0, 'reduced motion should shorten the fade, not eliminate the scene-change cue entirely');
  assert.ok(APP_TRANSITION_TOTAL_MS_REDUCED < APP_TRANSITION_TOTAL_MS / 2, 'expected more than a token reduction');
});

test('a shortened duration still produces a valid, finite fade curve via the existing fadeOverlayAlpha/isTransitionExpired exports', () => {
  const reducedMs = transitionDurationForMotionPreference(true, 200, 80);
  for (let elapsed = 0; elapsed <= reducedMs; elapsed += 4) {
    const alpha = fadeOverlayAlpha(elapsed, reducedMs);
    assert.ok(isFiniteNumber(alpha) && alpha >= 0 && alpha <= 1, `fadeOverlayAlpha(${elapsed}, ${reducedMs}) = ${alpha} invalid`);
  }
  assert.equal(isTransitionExpired(reducedMs / 2, reducedMs), false, 'midpoint of the shortened transition must not read as expired');
  assert.equal(isTransitionExpired(reducedMs * 2, reducedMs), true, 'the watchdog threshold must scale down with the shortened duration too');
});

// --- orchestration-level: mirrors app.js's current beginModeTransition/ ----
// --- updateModeTransition/updateCamera exactly, using only real exports ----
//
// Same convention as canvas-black-regression.test.mjs: app.js is DOM-coupled
// at module scope and cannot be imported under Node, so its per-frame
// sequencing is mirrored here while every actual computation is the real
// exported function.

const TRANSITION_TOTAL_MS = 200;
const TRANSITION_TOTAL_MS_REDUCED = 80;
const CAMERA_SMOOTHING_RATE = 0.15;

function freshState(reduceMotion) {
  return {
    reduceMotion,
    cameraFocus: { x: 650, y: 520 },
    player: { x: 650, y: 520 },
    pendingTransition: null,
    transitionUntil: 0,
    doorAuto: createDoorAutoState(),
    lastTimestamp: 0
  };
}

function beginModeTransition(state, mode, timestamp) {
  if (state.pendingTransition) return;
  const totalMs = transitionDurationForMotionPreference(state.reduceMotion, TRANSITION_TOTAL_MS, TRANSITION_TOTAL_MS_REDUCED);
  state.transitionUntil = timestamp + totalMs;
  state.pendingTransition = { targetMode: mode, startedAt: timestamp, applied: false, totalMs };
  state.doorAuto = { latched: true, cooldownUntil: timestamp + DOOR_AUTO_COOLDOWN_MS };
}

function updateModeTransition(state, timestamp) {
  const pending = state.pendingTransition;
  if (!pending) return;
  const elapsed = timestamp - pending.startedAt;
  const expired = isTransitionExpired(elapsed, pending.totalMs);
  if (!pending.applied && (elapsed >= pending.totalMs / 2 || expired)) pending.applied = true;
  if (elapsed >= pending.totalMs || expired) state.pendingTransition = null;
}

function updateCamera(state, deltaSeconds) {
  const rate = cameraSmoothingRateForMotionPreference(state.reduceMotion, CAMERA_SMOOTHING_RATE);
  state.cameraFocus = lerpCameraFocus(state.cameraFocus, state.player, deltaSeconds, rate);
}

function frame(state, timestamp, deltaSeconds) {
  state.lastTimestamp = timestamp;
  updateModeTransition(state, timestamp);
  updateCamera(state, deltaSeconds);
}

test('a transition begun under reduceMotion=true resolves in far fewer frames than the 200ms baseline', () => {
  const reduced = freshState(true);
  let t = 0;
  beginModeTransition(reduced, 'interior', t);
  let framesToResolve = 0;
  for (; framesToResolve < 60; framesToResolve += 1) {
    t += 16.667;
    frame(reduced, t, 16.667 / 1000);
    if (!reduced.pendingTransition) break;
  }
  assert.equal(reduced.pendingTransition, null, 'reduced-motion transition never resolved');
  // 80ms at ~16.667ms/frame is 5 frames; allow slack for the frame grid
  // without admitting anywhere near the 200ms baseline's ~12 frames.
  assert.ok(framesToResolve <= 7, `expected the shortened transition to resolve in <=7 frames, took ${framesToResolve}`);

  const normal = freshState(false);
  t = 0;
  beginModeTransition(normal, 'interior', t);
  let normalFrames = 0;
  for (; normalFrames < 60; normalFrames += 1) {
    t += 16.667;
    frame(normal, t, 16.667 / 1000);
    if (!normal.pendingTransition) break;
  }
  assert.ok(normalFrames > framesToResolve, 'the baseline transition should take measurably longer than the reduced one');
});

test('toggling reduceMotion mid-flight never changes an already-running transition\'s own duration (only the next one)', () => {
  const state = freshState(false);
  let t = 1000;
  beginModeTransition(state, 'interior', t);
  assert.equal(state.pendingTransition.totalMs, TRANSITION_TOTAL_MS);

  // The user flips the OS setting mid-fade.
  state.reduceMotion = true;
  t += 16.667;
  frame(state, t, 16.667 / 1000);
  // Still in flight, and still carrying the duration it was born with.
  assert.ok(state.pendingTransition, 'transition should still be in flight this soon after starting');
  assert.equal(state.pendingTransition.totalMs, TRANSITION_TOTAL_MS, 'an in-flight transition must not change speed mid-fade');

  // Let it finish naturally on the original (unchanged) schedule.
  for (let i = 0; i < 60 && state.pendingTransition; i += 1) {
    t += 16.667;
    frame(state, t, 16.667 / 1000);
  }
  assert.equal(state.pendingTransition, null);

  // The NEXT transition, begun after the toggle, does pick up the new
  // preference -- this is what makes the toggle "live" without a reload.
  beginModeTransition(state, 'exterior', t);
  assert.equal(state.pendingTransition.totalMs, TRANSITION_TOTAL_MS_REDUCED);
});

test('camera easing responds to reduceMotion on the very next frame, even mid-motion (unlike the per-transition duration)', () => {
  const state = freshState(false);
  state.cameraFocus = { x: 0, y: 0 };
  state.player = { x: 1000, y: 1000 };
  // A few ordinary frames of easing.
  let t = 0;
  for (let i = 0; i < 5; i += 1) {
    t += 16.667;
    frame(state, t, 16.667 / 1000);
  }
  assert.notDeepEqual(state.cameraFocus, state.player, 'sanity check: normal easing should not have already reached the target');

  // Flip the preference live -- no new transition, no reload.
  state.reduceMotion = true;
  t += 16.667;
  frame(state, t, 16.667 / 1000);
  assert.deepEqual(state.cameraFocus, state.player, 'camera should fully snap onto the player on the very first frame after the live toggle');
});
