// test/town/bump-freeze-regression.test.mjs
//
// Regression coverage for a P0 bug found by adversarial real-browser
// playtesting (a hijacked requestAnimationFrame queue driven with large-
// origin, jittered synthetic timestamps -- see the harness convention this
// file shares with canvas-black-regression.test.mjs and
// movement-continuity.test.mjs) in public/fable5-v2: holding a movement key
// against open ground could silently and permanently freeze the game with
// no on-screen signal at all.
//
// Root cause, a chain of three independent defects:
//
//   1. moveActor() (world-runtime.mjs) computed `blocked` from whether the
//      position changed, without first checking whether any travel was
//      actually attempted. A dt<=0 frame (two requestAnimationFrame
//      callbacks landing on the same timestamp -- observed both in the
//      hijacked-queue harness and plausible on a real backgrounded/resuming
//      tab) sets distance=0, so the position trivially "doesn't change"
//      regardless of what is or isn't nearby -- and while a movement key
//      was held, that read as `blocked: true` on perfectly open ground.
//      app.js's updateMovement() then called registerBump(timestamp) for a
//      collision that never happened.
//   2. registerBump() sets `state.bumpUntil = timestamp + 300`, and
//      drawWorld()'s bump-glow ring computed
//      `progress = 1 - (state.bumpUntil - timestamp) / 300` inline, with no
//      clamp. If a *later* frame's timestamp and `state.bumpUntil` ever
//      disagree about "now" by more than ~643ms in the wrong direction --
//      easy to hit once false bumps are firing on nearly every held-key
//      frame -- `progress` goes below -8/7 and the glow's radius
//      (`8 + progress * 7`) goes negative.
//   3. CanvasRenderingContext2D.arc() throws an uncaught IndexSizeError for
//      a negative radius (confirmed against a real browser), and frame()
//      had no try/catch anywhere around its per-frame work. The exception
//      propagated out of drawWorld() and frame(), skipping the trailing
//      requestAnimationFrame(frame) call that keeps the game running --
//      the exact same "permanently dead rAF loop, stale HUD looks alive"
//      failure class documented in canvas-black-regression.test.mjs, but
//      reachable from ordinary held-key movement instead of a hostile
//      timestamp alone.
//
// The fix (see world-runtime.mjs/app.js):
//   - moveActor() now requires a genuine nonzero-distance attempt
//     (distance > 0) before `blocked` can ever be true.
//   - bumpGlowProgress() (extracted so this is directly testable) clamps
//     progress to [0,1] for any timestamp/bumpUntil relationship, and to 0
//     for non-finite input, so 8 + progress*7 can never go negative.
//   - frame() wraps its per-frame work in try/catch, logs any exception to
//     the console, and reschedules requestAnimationFrame(frame) in a
//     finally block so no single bad frame can ever stop the loop again.
//
// This file drives the real, exported moveActor()/bumpGlowProgress()
// directly (not ports) and verifies app.js's structural defenses by source
// inspection, matching this repo's existing convention for app.js
// orchestration that cannot be imported under Node (it is DOM-coupled at
// module scope).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ACTOR_CONTRACT,
  EXTERIOR_BLOCKERS,
  bumpGlowProgress,
  isExteriorWalkable,
  moveActor
} from '../../public/fable5-v2/world-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

// --- root cause 1: dt<=0 must never be misread as a collision --------------

test('moveActor never reports blocked for a dt=0 frame, even while a movement key is held on open ground', () => {
  const spawn = { x: ACTOR_CONTRACT.spawn.x, y: ACTOR_CONTRACT.spawn.y, facing: 'north' };
  assert.equal(isExteriorWalkable(spawn.x, spawn.y), true, 'test setup: spawn must be open, walkable ground');
  for (const input of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }]) {
    const result = moveActor(spawn, input, 0, 'exterior');
    assert.equal(result.blocked, false, `dt=0 with input ${JSON.stringify(input)} must not be misread as a collision`);
    assert.equal(result.moved, false, 'dt=0 genuinely travels zero distance');
    assert.equal(result.x, spawn.x);
    assert.equal(result.y, spawn.y);
  }
});

test('moveActor never reports blocked for a negative deltaSeconds either (defensive: distance is clamped to >=0)', () => {
  const spawn = { x: ACTOR_CONTRACT.spawn.x, y: ACTOR_CONTRACT.spawn.y, facing: 'north' };
  const result = moveActor(spawn, { x: 1, y: 0 }, -5, 'exterior');
  assert.equal(result.blocked, false);
  assert.equal(result.moved, false);
});

test('moveActor still correctly reports blocked for a genuine collision at dt>0 (the fix must not disable real collision)', () => {
  // Derived directly from the real exported blocker data instead of a
  // hand-picked pixel guess: a rect blocker's own centre is never walkable,
  // and CIVIC_PLAZA's paving is walkable immediately south of
  // plaza-north-bench, so walking north into the bench from just below it
  // is a real, always-reproducible collision.
  const bench = EXTERIOR_BLOCKERS.find(({ id }) => id === 'plaza-north-bench');
  assert.ok(bench, 'test setup: plaza-north-bench must exist in EXTERIOR_BLOCKERS');
  const centre = { x: bench.x + bench.width / 2, y: bench.y + bench.height / 2 };
  assert.equal(isExteriorWalkable(centre.x, centre.y), false, 'test setup: the bench centre must not itself be walkable');
  const approach = { x: centre.x, y: bench.y + bench.height + 20, facing: 'north' };
  assert.equal(isExteriorWalkable(approach.x, approach.y), true, 'test setup: the approach point must be walkable');

  let actor = { ...approach };
  let blockedAt = null;
  for (let step = 0; step < 30; step += 1) {
    const next = moveActor(actor, { x: 0, y: -1 }, 1 / 20, 'exterior');
    if (next.blocked) { blockedAt = step; break; }
    assert.ok(next.moved || step === 0, `expected forward progress at step ${step}`);
    actor = next;
  }
  assert.ok(blockedAt !== null, 'walking straight into the bench never reported a genuine collision');
});

// --- root cause 2: the bump-glow radius must never go negative -------------

test('bumpGlowProgress always stays within [0,1] for every timestamp/bumpUntil relationship, including the exact backward-jump shape that used to go negative', () => {
  const cases = [
    [0, 300], [150, 300], [299, 300], [300, 300], [300.0001, 300],
    // The exact failure shape: a later frame's timestamp far "behind" a
    // bumpUntil that was recorded relative to a much larger clock reading.
    [0, 1_000_000], [50_000, 100_000_000],
    [1_000_000, 0],
    [NaN, 300], [300, NaN], [Infinity, 300], [300, Infinity], [-Infinity, 300], [Infinity, -Infinity],
    [100, 100], [0, 0]
  ];
  for (const [timestamp, bumpUntil] of cases) {
    const progress = bumpGlowProgress(timestamp, bumpUntil);
    assert.ok(Number.isFinite(progress), `progress not finite for (${timestamp}, ${bumpUntil}): ${progress}`);
    assert.ok(progress >= 0 && progress <= 1, `progress ${progress} out of [0,1] for (${timestamp}, ${bumpUntil})`);
    const radius = 8 + progress * 7;
    assert.ok(Number.isFinite(radius) && radius >= 8 && radius <= 15,
      `radius ${radius} out of the safe [8,15] band for (${timestamp}, ${bumpUntil}) -- this is exactly the IndexSizeError crash`);
  }
});

test('bumpGlowProgress matches the original unclamped formula for well-behaved input (the fix does not alter normal visuals)', () => {
  assert.equal(bumpGlowProgress(0, 300), 1 - (300 - 0) / 300);
  assert.equal(bumpGlowProgress(150, 300), 1 - (300 - 150) / 300);
  assert.ok(Math.abs(bumpGlowProgress(299, 300) - (1 - 1 / 300)) < 1e-9);
  assert.equal(bumpGlowProgress(300, 300), 1);
});

test('bumpGlowProgress rejects a non-positive durationMs by returning 0 rather than dividing by zero', () => {
  assert.equal(bumpGlowProgress(100, 200, 0), 0);
  assert.equal(bumpGlowProgress(100, 200, -50), 0);
});

// --- root cause 3: a per-frame exception must never permanently kill the loop, and drawWorld must use the clamped helper

test('frame() wraps its per-frame work in try/catch and always reschedules requestAnimationFrame in a finally block', async () => {
  const app = await readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8');
  const start = app.indexOf('function frame(rawTimestamp)');
  assert.ok(start >= 0, 'frame(rawTimestamp) must exist');
  const end = app.indexOf('\nfunction normalizedKey(event)');
  assert.ok(end > start, 'expected the next top-level function after frame() to locate its body');
  const frameBody = app.slice(start, end);

  assert.match(frameBody, /try\s*\{/, 'frame() must wrap its per-frame work in a try block');
  assert.match(frameBody, /\}\s*catch\s*\(error\)\s*\{/, 'frame() must catch a per-frame exception');
  assert.match(frameBody, /console\.error\(/, 'a caught per-frame exception must be logged, not silently swallowed');
  assert.match(
    frameBody,
    /finally\s*\{\s*state\.animationFrame = window\.requestAnimationFrame\(frame\);\s*\}/,
    'requestAnimationFrame(frame) must be rescheduled in a finally block so a thrown exception can never stop the loop'
  );
});

test('drawWorld uses the shared, clamped bumpGlowProgress helper instead of the old raw unclamped formula', async () => {
  const app = await readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8');
  assert.match(app, /bumpGlowProgress\(timestamp, state\.bumpUntil\)/);
  assert.doesNotMatch(app, /1 - \(state\.bumpUntil - timestamp\) \/ 300/, 'the old inline unclamped formula must be gone');
});
