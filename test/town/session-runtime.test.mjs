import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTOR_CONTRACT } from '../../public/fable5-v2/world-runtime.mjs';
import { getBuilding } from '../../public/fable5-v2/building-runtime.mjs';
import {
  chooseInvestigationQuestion,
  createInvestigationState,
  recordInvestigationClue,
  startInnDialogue
} from '../../public/fable5-v2/quest-runtime.mjs';
import {
  FABLE5_SESSION_SCHEMA_VERSION,
  createFable5SessionState,
  createInitialFable5SessionState,
  restoreFable5SessionState
} from '../../public/fable5-v2/session-runtime.mjs';

function accepted(result) {
  assert.equal(result.ok, true, result.code ?? 'expected accepted transition');
  return result.state;
}

function progressedQuest() {
  let quest = accepted(startInnDialogue(createInvestigationState()));
  quest = accepted(chooseInvestigationQuestion(quest, 'observed'));
  return accepted(recordInvestigationClue(quest, 'clue-streetlamp', ['fact:streetlamp']));
}

test('a fresh Fable5 session is exact, immutable, and restorable at the exterior spawn', () => {
  const created = createInitialFable5SessionState();
  assert.equal(created.ok, true);
  assert.equal(Object.isFrozen(created), true);
  assert.deepEqual(created.state.player, {
    x: ACTOR_CONTRACT.spawn.x,
    y: ACTOR_CONTRACT.spawn.y,
    facing: 'north'
  });
  assert.equal(created.state.location.mode, 'exterior');
  assert.equal(created.state.location.buildingId, null);
  assert.equal(created.state.sessionSchemaVersion, FABLE5_SESSION_SCHEMA_VERSION);
  const restored = restoreFable5SessionState(created.state);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state.player, created.state.player);
  assert.deepEqual(restored.state.audioPreferences, { muted: false, volume: 0.45 });
});

test('a session round-trips quest, player, approved interior location, zoom, and scoped audio settings', () => {
  const inn = getBuilding('inn');
  const created = createFable5SessionState({
    quest: progressedQuest(),
    player: { ...inn.interior.entryFoot, facing: 'west' },
    mode: 'interior',
    buildingId: 'inn',
    zoom: 2,
    audioPreferences: { muted: true, volume: 0.72 }
  });
  assert.equal(created.ok, true);
  const restored = restoreFable5SessionState(created.state);
  assert.deepEqual(restored, {
    ok: true,
    state: {
      quest: progressedQuest(),
      player: { ...inn.interior.entryFoot, facing: 'west' },
      mode: 'interior',
      buildingId: 'inn',
      zoom: 2,
      audioPreferences: { muted: true, volume: 0.72 }
    }
  });
});

test('session creation and restoration fail closed for invalid settings, off-nav positions, partial saves, and impossible rooms', () => {
  const initial = createInitialFable5SessionState().state;
  const invalidCreation = [
    { ...initial, player: { x: Number.NaN, y: 1, facing: 'north' } },
    { ...initial, player: { x: 0, y: 0, facing: 'north' } },
    { ...initial, location: { mode: 'interior', buildingId: 'missing' } },
    { ...initial, settings: { zoom: 3, audio: { muted: false, volume: 0.45 } } },
    { ...initial, settings: { zoom: 1, audio: { muted: 'false', volume: 0.45 } } }
  ];
  for (const candidate of invalidCreation) {
    const result = createFable5SessionState({
      quest: candidate.quest,
      player: candidate.player,
      mode: candidate.location.mode,
      buildingId: candidate.location.buildingId,
      zoom: candidate.settings.zoom,
      audioPreferences: candidate.settings.audio
    });
    assert.equal(result.ok, false);
  }

  const invalidRestores = [
    { quest: initial.quest },
    { ...initial, sessionSchemaVersion: 2 },
    { ...initial, unexpected: true },
    { ...initial, location: { mode: 'interior', buildingId: 'city-hall' } },
    { ...initial, location: { mode: 'interior', buildingId: 'residence' } },
    { ...initial, player: { x: 1, y: 1, facing: 'north' } }
  ];
  for (const candidate of invalidRestores) {
    assert.equal(restoreFable5SessionState(candidate).ok, false);
  }
});
