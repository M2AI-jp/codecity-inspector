// Pure, fail-closed session snapshot contract for the Fable5 customer route.
// Browser storage is deliberately outside this module: the app injects this
// JSON-safe state into persistence only after it has passed these checks.

import { ACTOR_CONTRACT, GAMEPLAY_ZOOM, isExteriorWalkable } from './world-runtime.mjs';
import { getBuilding, isBuildingRuntimeAvailable, isInteriorWalkable } from './building-runtime.mjs';
import { DEFAULT_AUDIO_PREFERENCES } from './audio-feedback.mjs';
import {
  createInvestigationState,
  restoreInvestigationState,
  serializeInvestigationState
} from './quest-runtime.mjs';

export const FABLE5_SESSION_SCHEMA_VERSION = 1;

const FACINGS = Object.freeze(['north', 'east', 'south', 'west']);
const MODES = Object.freeze(['exterior', 'interior']);
const ZOOM_MIN = 1;
const ZOOM_MAX = 2;

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) frozen(child);
  return Object.freeze(value);
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validAudioPreferences(value) {
  if (!exactKeys(value, ['muted', 'volume'])) return null;
  if (typeof value.muted !== 'boolean' || !Number.isFinite(value.volume)) return null;
  if (value.volume < 0 || value.volume > 1) return null;
  return frozen({ muted: value.muted, volume: value.volume });
}

function validPlayer(value) {
  if (!exactKeys(value, ['x', 'y', 'facing'])) return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !FACINGS.includes(value.facing)) return null;
  return frozen({ x: value.x, y: value.y, facing: value.facing });
}

function validLocation(value, player) {
  if (!exactKeys(value, ['mode', 'buildingId']) || !MODES.includes(value.mode)) return null;
  if (value.mode === 'exterior') {
    if (value.buildingId !== null || !isExteriorWalkable(player.x, player.y)) return null;
    return frozen({ mode: 'exterior', buildingId: null });
  }
  if (typeof value.buildingId !== 'string') return null;
  if (!getBuilding(value.buildingId) || !isBuildingRuntimeAvailable(value.buildingId)
    || !isInteriorWalkable(value.buildingId, player)) return null;
  return frozen({ mode: 'interior', buildingId: value.buildingId });
}

function validSettings(value) {
  if (!exactKeys(value, ['zoom', 'audio'])) return null;
  if (!Number.isInteger(value.zoom) || value.zoom < ZOOM_MIN || value.zoom > ZOOM_MAX) return null;
  const audio = validAudioPreferences(value.audio);
  return audio ? frozen({ zoom: value.zoom, audio }) : null;
}

function snapshotParts({ quest, player, mode, buildingId, zoom, audioPreferences }) {
  const serializedQuest = serializeInvestigationState(quest);
  if (!serializedQuest.ok) return { ok: false, code: 'invalid-quest' };
  const safePlayer = validPlayer(player);
  if (!safePlayer) return { ok: false, code: 'invalid-player' };
  const location = validLocation({ mode, buildingId }, safePlayer);
  if (!location) return { ok: false, code: 'invalid-location' };
  const settings = validSettings({ zoom, audio: audioPreferences });
  if (!settings) return { ok: false, code: 'invalid-settings' };
  return {
    ok: true,
    quest: serializedQuest.state,
    player: safePlayer,
    location,
    settings
  };
}

/**
 * Produce an immutable, JSON-safe snapshot that is valid for exactly the
 * currently reachable Fable5 exterior/interior collision geometry.
 */
export function createFable5SessionState(input) {
  const parts = snapshotParts(input ?? {});
  if (!parts.ok) return frozen(parts);
  return frozen({
    ok: true,
    state: {
      sessionSchemaVersion: FABLE5_SESSION_SCHEMA_VERSION,
      quest: parts.quest,
      player: parts.player,
      location: parts.location,
      settings: parts.settings
    }
  });
}

/** A fresh, fully valid session is the only recovery target for bad saves. */
export function createInitialFable5SessionState() {
  return createFable5SessionState({
    quest: createInvestigationState(),
    player: { x: ACTOR_CONTRACT.spawn.x, y: ACTOR_CONTRACT.spawn.y, facing: 'north' },
    mode: 'exterior',
    buildingId: null,
    zoom: GAMEPLAY_ZOOM,
    audioPreferences: DEFAULT_AUDIO_PREFERENCES
  });
}

/**
 * Restore only an exact v1 snapshot. It rejects partial, stale, impossible,
 * and off-nav saves rather than guessing a nearby position or room.
 */
export function restoreFable5SessionState(value) {
  if (!exactKeys(value, ['sessionSchemaVersion', 'quest', 'player', 'location', 'settings'])) {
    return frozen({ ok: false, code: 'invalid-session-shape' });
  }
  if (value.sessionSchemaVersion !== FABLE5_SESSION_SCHEMA_VERSION) {
    return frozen({ ok: false, code: 'session-schema-mismatch' });
  }
  const quest = restoreInvestigationState(value.quest);
  if (!quest.ok) return frozen({ ok: false, code: 'invalid-quest' });
  const player = validPlayer(value.player);
  if (!player) return frozen({ ok: false, code: 'invalid-player' });
  const location = validLocation(value.location, player);
  if (!location) return frozen({ ok: false, code: 'invalid-location' });
  const settings = validSettings(value.settings);
  if (!settings) return frozen({ ok: false, code: 'invalid-settings' });
  return frozen({
    ok: true,
    state: {
      quest: quest.state,
      player,
      mode: location.mode,
      buildingId: location.buildingId,
      zoom: settings.zoom,
      audioPreferences: settings.audio
    }
  });
}
