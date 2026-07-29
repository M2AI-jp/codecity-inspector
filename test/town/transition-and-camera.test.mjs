// test/town/transition-and-camera.test.mjs
//
// Regression coverage for two P0/P1 game-feel gaps found by playtest +
// code audit in public/fable5-v2:
//
//   1. Mode switches (entering/leaving the inn) popped instantly with no
//      visual transition, and the fixed interior camera cut on the same
//      frame. fadeOverlayAlpha()/easeInOutCosine() are the pure functions
//      behind app.js's black fade-out/switch/fade-in (see
//      beginModeTransition/updateModeTransition/applyModeSwitch there).
//   2. The camera snapped straight onto its focus every frame with no
//      easing. smoothingFactor()/lerpCameraFocus() are the pure functions
//      behind app.js's updateCamera().
//
// Also covers rectsOverlap(), the small geometry primitive behind
// dialogueFramePosition()'s "don't draw the dialogue box on top of the
// player's own sprite" offset (P2 item 5b).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  easeInOutCosine,
  fadeOverlayAlpha,
  lerpCameraFocus,
  rectsOverlap,
  smoothingFactor
} from '../../public/fable5-v2/world-runtime.mjs';

// --- easeInOutCosine / fadeOverlayAlpha -------------------------------------

test('easeInOutCosine maps 0/0.5/1 to 0/0.5/1 and clamps out-of-range input', () => {
  assert.equal(easeInOutCosine(0), 0);
  assert.ok(Math.abs(easeInOutCosine(0.5) - 0.5) < 1e-9);
  assert.equal(easeInOutCosine(1), 1);
  assert.equal(easeInOutCosine(-5), easeInOutCosine(0));
  assert.equal(easeInOutCosine(5), easeInOutCosine(1));
});

test('easeInOutCosine has (numerically) zero slope at both ends, giving a true ease-in-out', () => {
  const epsilon = 1e-4;
  const slopeAtStart = (easeInOutCosine(epsilon) - easeInOutCosine(0)) / epsilon;
  const slopeAtEnd = (easeInOutCosine(1) - easeInOutCosine(1 - epsilon)) / epsilon;
  assert.ok(Math.abs(slopeAtStart) < 0.01, `slope near t=0 should be ~0, got ${slopeAtStart}`);
  assert.ok(Math.abs(slopeAtEnd) < 0.01, `slope near t=1 should be ~0, got ${slopeAtEnd}`);
});

test('easeInOutCosine is monotonically non-decreasing across [0,1]', () => {
  let previous = -Infinity;
  for (let step = 0; step <= 20; step += 1) {
    const value = easeInOutCosine(step / 20);
    assert.ok(value >= previous - 1e-9, `eased value decreased at step ${step}`);
    previous = value;
  }
});

test('fadeOverlayAlpha is 0 at both edges, 1 exactly at the midpoint, and symmetric', () => {
  const total = 200;
  assert.equal(fadeOverlayAlpha(0, total), 0);
  assert.equal(fadeOverlayAlpha(total, total), 0);
  assert.equal(fadeOverlayAlpha(-10, total), 0, 'before the transition starts');
  assert.equal(fadeOverlayAlpha(total + 10, total), 0, 'after the transition ends');
  assert.ok(Math.abs(fadeOverlayAlpha(total / 2, total) - 1) < 1e-9, 'must reach fully opaque exactly at the midpoint');
  // Symmetric around the midpoint: alpha(half - d) === alpha(half + d).
  for (const offset of [10, 40, 90]) {
    const before = fadeOverlayAlpha(total / 2 - offset, total);
    const after = fadeOverlayAlpha(total / 2 + offset, total);
    assert.ok(Math.abs(before - after) < 1e-9, `expected symmetry at offset ${offset}: ${before} vs ${after}`);
  }
});

test('fadeOverlayAlpha rises then falls monotonically either side of the midpoint (a clean single pulse)', () => {
  const total = 220;
  const half = total / 2;
  let previous = -Infinity;
  for (let elapsed = 0; elapsed <= half; elapsed += 10) {
    const alpha = fadeOverlayAlpha(elapsed, total);
    assert.ok(alpha >= previous - 1e-9, `alpha should rise through the fade-out half, dropped at ${elapsed}`);
    previous = alpha;
  }
  previous = Infinity;
  for (let elapsed = half; elapsed <= total; elapsed += 10) {
    const alpha = fadeOverlayAlpha(elapsed, total);
    assert.ok(alpha <= previous + 1e-9, `alpha should fall through the fade-in half, rose at ${elapsed}`);
    previous = alpha;
  }
});

test('fadeOverlayAlpha handles a degenerate (zero or negative) duration without throwing', () => {
  assert.equal(fadeOverlayAlpha(0, 0), 0);
  assert.equal(fadeOverlayAlpha(50, -10), 0);
});

// --- smoothingFactor / lerpCameraFocus --------------------------------------

test('smoothingFactor is frame-rate independent: the same wall-clock time closes the same fraction regardless of step size', () => {
  const rate = 0.15;
  // One 32ms step vs two 16ms steps should close very nearly the same total
  // fraction of distance over the same 32ms of wall-clock time.
  const oneBigStep = smoothingFactor(rate, 0.032);
  const twoSmallSteps = 1 - (1 - smoothingFactor(rate, 0.016)) ** 2;
  assert.ok(Math.abs(oneBigStep - twoSmallSteps) < 1e-9, `${oneBigStep} vs ${twoSmallSteps}`);
});

test('smoothingFactor is 0 at zero elapsed time and approaches 1 for large elapsed time', () => {
  assert.equal(smoothingFactor(0.15, 0), 0);
  assert.ok(smoothingFactor(0.15, 10) > 0.999999);
});

test('smoothingFactor stays within [0,1] for a range of rates and deltas, including out-of-range input', () => {
  for (const rate of [-1, 0, 0.15, 0.5, 1, 2]) {
    for (const deltaSeconds of [-1, 0, 1 / 60, 0.05, 1, 100]) {
      const k = smoothingFactor(rate, deltaSeconds);
      assert.ok(k >= 0 && k <= 1, `smoothingFactor(${rate}, ${deltaSeconds}) = ${k} out of [0,1]`);
    }
  }
});

test('lerpCameraFocus with current===target never drifts away from it', () => {
  const target = { x: 212, y: 300 };
  const result = lerpCameraFocus({ x: 212, y: 300 }, target, 1 / 60, 0.15);
  assert.ok(Math.abs(result.x - target.x) < 1e-9);
  assert.ok(Math.abs(result.y - target.y) < 1e-9);
});

test('lerpCameraFocus moves partway toward the target each frame and converges without overshoot', () => {
  let focus = { x: 0, y: 0 };
  const target = { x: 300, y: -150 };
  let previousDistance = Math.hypot(target.x - focus.x, target.y - focus.y);
  for (let frame = 0; frame < 240; frame += 1) {
    focus = lerpCameraFocus(focus, target, 1 / 60, 0.15);
    const distance = Math.hypot(target.x - focus.x, target.y - focus.y);
    assert.ok(distance <= previousDistance + 1e-9, `distance to target increased at frame ${frame}`);
    previousDistance = distance;
  }
  assert.ok(Math.abs(focus.x - target.x) < 0.5, `expected convergence on x, got ${focus.x}`);
  assert.ok(Math.abs(focus.y - target.y) < 0.5, `expected convergence on y, got ${focus.y}`);
});

test('lerpCameraFocus reacts smoothly to a moving target instead of snapping (frame-to-frame focus is bounded)', () => {
  // Simulates a player walking steadily (1.25px/frame, matching
  // ACTOR_CONTRACT.speed at 60fps) with the camera easing toward them; the
  // camera's own per-frame movement should never exceed a small multiple of
  // the player's own step, i.e. it eases rather than teleporting.
  let focus = { x: 650, y: 520 };
  let target = { x: 650, y: 520 };
  let maxCameraStep = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    target = { x: target.x - 1.25, y: target.y };
    const next = lerpCameraFocus(focus, target, 1 / 60, 0.15);
    maxCameraStep = Math.max(maxCameraStep, Math.abs(next.x - focus.x));
    focus = next;
  }
  assert.ok(maxCameraStep < 5, `camera step ${maxCameraStep}px is too large for smooth easing behind a steady walk`);
});

// --- rectsOverlap ------------------------------------------------------------

test('rectsOverlap detects overlap, adjacency (no overlap), and separation correctly', () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(rectsOverlap(a, { x: 5, y: 5, width: 10, height: 10 }), true, 'partial overlap');
  assert.equal(rectsOverlap(a, { x: 0, y: 0, width: 10, height: 10 }), true, 'identical rects');
  assert.equal(rectsOverlap(a, { x: 10, y: 0, width: 10, height: 10 }), false, 'exactly edge-adjacent on x does not overlap');
  assert.equal(rectsOverlap(a, { x: 0, y: 10, width: 10, height: 10 }), false, 'exactly edge-adjacent on y does not overlap');
  assert.equal(rectsOverlap(a, { x: 100, y: 100, width: 10, height: 10 }), false, 'far apart');
  assert.equal(rectsOverlap(a, { x: 2, y: -20, width: 2, height: 60 }), true, 'a thin rect straight through the middle');
});
