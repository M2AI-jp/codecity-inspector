// test/town/fable5-boot-smoke.test.mjs
//
// Smoke coverage for a P0 bug class found in public/fable5-v2/app.js: the
// live boot path (restoreSessionProgress()) and the "最初から" reset path
// (resetCurrentSession()) each construct a "start over" runtime session from
// createInitialFable5SessionState() + restoreFable5SessionState(), and both
// used to be independent, hand-written implementations of that same
// two-step flattening. The boot path got it right; the reset path skipped
// the restoreFable5SessionState() round trip and handed
// createInitialFable5SessionState()'s nested envelope shape
// (`state.location.mode/buildingId`, `state.settings.zoom/audio`) straight
// to applyRestoredSession(), which only ever reads the flat runtime shape
// (`state.mode/buildingId/zoom/audioPreferences`) -- reproducing, on a real
// click of the reset button, the exact same
// "Cannot read properties of undefined (reading 'muted')" crash a fresh,
// empty-localStorage boot hit before the boot path was fixed.
//
// app.js cannot be imported under Node (it is DOM-coupled at module scope --
// the same constraint every other app.js-orchestration test file in this
// directory already works around; see canvas-black-regression.test.mjs's own
// comment). freshRuntimeSession() (app.js) is mirrored here as a thin
// one-line composition of the two real, exported session-runtime.mjs
// functions it actually calls, so this exercises the real contract rather
// than a reimplementation: any regression in either function, or in the
// composition itself, fails this file.
//
// See test/town/bump-freeze-regression.test.mjs and
// canvas-black-regression.test.mjs for the sibling freeze/crash regression
// suites this complements.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFable5Persistence } from '../../public/fable5-v2/persistence.mjs';
import {
  createInitialFable5SessionState,
  restoreFable5SessionState
} from '../../public/fable5-v2/session-runtime.mjs';

function emptyStorage() {
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };
}

function throwingStorage() {
  return {
    getItem() { throw new Error('storage disabled (privacy mode)'); },
    setItem() { throw new Error('storage disabled (privacy mode)'); },
    removeItem() { throw new Error('storage disabled (privacy mode)'); }
  };
}

// Mirrors app.js's freshRuntimeSession() exactly: both restoreSessionProgress()
// (fresh boot) and resetCurrentSession() ("最初から") must produce this same
// flat shape before calling applyRestoredSession().
function freshRuntimeSession() {
  const initial = createInitialFable5SessionState();
  if (!initial.ok) return null;
  const runtime = restoreFable5SessionState(initial.state);
  return runtime.ok ? runtime.state : null;
}

// Exactly the fields applyRestoredSession() in app.js reads off the object
// freshRuntimeSession() returns -- a regression that renamed/nested any of
// these would crash the very first frame after boot or reset with a
// TypeError, the failure class this whole file guards against.
function assertApplyRestoredSessionShape(session, label) {
  assert.ok(session, `${label}: session must not be null`);
  assert.equal(typeof session.mode, 'string', `${label}: mode`);
  assert.ok('buildingId' in session, `${label}: buildingId`);
  assert.ok(Number.isFinite(session.player?.x), `${label}: player.x`);
  assert.ok(Number.isFinite(session.player?.y), `${label}: player.y`);
  assert.equal(typeof session.player?.facing, 'string', `${label}: player.facing`);
  assert.ok(Number.isFinite(session.zoom), `${label}: zoom`);
  assert.equal(typeof session.audioPreferences?.muted, 'boolean', `${label}: audioPreferences.muted`);
  assert.ok(Number.isFinite(session.audioPreferences?.volume), `${label}: audioPreferences.volume`);
  assert.equal(typeof session.quest?.phase, 'string', `${label}: quest.phase`);
}

test('booting with completely empty localStorage produces a valid flat runtime session and never throws', () => {
  const persistence = createFable5Persistence({
    storage: emptyStorage(),
    repositoryIdentity: 'owner/repo',
    inspectionDigest: 'a'.repeat(64)
  });
  const loaded = persistence.load();
  assert.equal(loaded.status, 'missing', 'test setup: an empty store must report missing, not loaded/corrupt');

  const initialRuntime = freshRuntimeSession();
  assertApplyRestoredSessionShape(initialRuntime, 'fresh boot');
  assert.equal(initialRuntime.mode, 'exterior');
  assert.equal(initialRuntime.buildingId, null);
  assert.equal(initialRuntime.quest.phase, 'new');
});

// This is the exact regression the reset-button crash reproduced: the nested
// envelope createInitialFable5SessionState() alone returns is NOT the shape
// applyRestoredSession() needs, and a caller that skips the
// restoreFable5SessionState() round trip crashes on the very first read of
// `session.audioPreferences.muted`.
test('the nested session envelope and the flat runtime session are genuinely different shapes (sanity check for the fix)', () => {
  const nestedOnly = createInitialFable5SessionState();
  assert.equal(nestedOnly.ok, true);
  assert.equal(nestedOnly.state.mode, undefined, 'the nested envelope has no top-level mode');
  assert.equal(nestedOnly.state.audioPreferences, undefined, 'the nested envelope has no top-level audioPreferences');
  assert.equal(nestedOnly.state.location.mode, 'exterior');
  assert.equal(nestedOnly.state.settings.audio.muted, false);

  const flattened = freshRuntimeSession();
  assert.equal(flattened.mode, 'exterior', 'freshRuntimeSession() must flatten location.mode into mode');
  assert.equal(flattened.buildingId, null, 'freshRuntimeSession() must flatten location.buildingId into buildingId');
  assert.equal(flattened.audioPreferences.muted, false, 'freshRuntimeSession() must flatten settings.audio into audioPreferences');
  assertApplyRestoredSessionShape(flattened, 'freshRuntimeSession()');
});

test('the "start over" reset path produces the exact same valid shape a fresh boot does', () => {
  const bootSession = freshRuntimeSession();
  const resetSession = freshRuntimeSession();
  assertApplyRestoredSessionShape(bootSession, 'boot');
  assertApplyRestoredSessionShape(resetSession, 'reset');
  assert.deepEqual(resetSession, bootSession, 'a reset must reconstruct exactly the same fresh session a first-ever boot does');
});

test('storage that throws on every call (privacy mode) still boots to a valid fresh session instead of crashing', () => {
  const persistence = createFable5Persistence({
    storage: throwingStorage(),
    repositoryIdentity: 'owner/repo',
    inspectionDigest: 'b'.repeat(64)
  });
  const loaded = persistence.load();
  assert.equal(loaded.status, 'storage-unavailable');

  const initialRuntime = freshRuntimeSession();
  assertApplyRestoredSessionShape(initialRuntime, 'privacy-mode boot');
});

test('a repository/digest scope too malformed to key a save still yields a valid fresh session', () => {
  const persistence = createFable5Persistence({
    storage: emptyStorage(),
    repositoryIdentity: '',
    inspectionDigest: 'not-a-valid-digest'
  });
  const loaded = persistence.load();
  assert.equal(loaded.status, 'invalid-scope');

  const initialRuntime = freshRuntimeSession();
  assertApplyRestoredSessionShape(initialRuntime, 'invalid-scope boot');
});
