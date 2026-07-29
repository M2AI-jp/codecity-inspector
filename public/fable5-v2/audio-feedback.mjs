// Tiny, optional Web Audio feedback for the Fable5 scene. This module never
// creates or resumes an AudioContext until unlock() is called from a trusted
// user gesture by the host app.
//
// Persistence is intentionally opt-in. The shipped game keeps mute/volume in
// the repository+inspection-digest scoped Fable5 session envelope, rather
// than letting this low-level feedback helper write an unscoped browser-wide
// preference. A different host may still inject an explicit storage boundary
// when that is genuinely its product contract.

export const AUDIO_PREFERENCE_STORAGE_KEY = 'codecity:fable5:audio-v1';

export const DEFAULT_AUDIO_PREFERENCES = Object.freeze({
  muted: false,
  volume: 0.45
});

// Each cue is deliberately a single, short oscillator: it is deterministic,
// has no external asset/network dependency, and is cheap enough for a small
// pixel-art game. Gain is multiplied by the persisted master volume.
export const AUDIO_CUES = Object.freeze({
  footstep: Object.freeze({ type: 'triangle', frequency: 180, duration: 0.045, attack: 0.002, gain: 0.055 }),
  door: Object.freeze({ type: 'sine', frequency: 132, duration: 0.12, attack: 0.004, gain: 0.09 }),
  dialogue: Object.freeze({ type: 'square', frequency: 660, duration: 0.045, attack: 0.002, gain: 0.032 })
});

function clampVolume(value) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_AUDIO_PREFERENCES.volume;
  return Math.min(1, Math.max(0, number));
}

export function normalizeAudioPreferences(value) {
  return Object.freeze({
    muted: value?.muted === true,
    volume: clampVolume(value?.volume)
  });
}

function defaultAudioContext() {
  try {
    return globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
  } catch {
    return null;
  }
}

function readPreferences(storage, storageKey) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return DEFAULT_AUDIO_PREFERENCES;
    const raw = storage.getItem(storageKey);
    if (typeof raw !== 'string') return DEFAULT_AUDIO_PREFERENCES;
    return normalizeAudioPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_AUDIO_PREFERENCES;
  }
}

function writePreferences(storage, storageKey, preferences) {
  try {
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(storageKey, JSON.stringify(preferences));
    }
  } catch {
    // Storage can be blocked in private/sandboxed contexts. Audio remains
    // optional, so a failed preference write must never affect gameplay.
  }
}

function safeDisconnect(node) {
  try {
    node?.disconnect?.();
  } catch {
    // Best-effort cleanup only.
  }
}

function scheduleCue(context, cue, volume) {
  try {
    if (!context || typeof context.createOscillator !== 'function' || typeof context.createGain !== 'function') {
      return false;
    }
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    if (!oscillator || !gainNode || !oscillator.frequency || !gainNode.gain
      || typeof oscillator.frequency.setValueAtTime !== 'function'
      || typeof gainNode.gain.setValueAtTime !== 'function'
      || typeof gainNode.gain.linearRampToValueAtTime !== 'function'
      || typeof oscillator.connect !== 'function'
      || typeof gainNode.connect !== 'function'
      || typeof oscillator.start !== 'function'
      || typeof oscillator.stop !== 'function') {
      return false;
    }

    const startAt = Number.isFinite(context.currentTime) ? context.currentTime : 0;
    const attackEnd = startAt + cue.attack;
    const endAt = startAt + cue.duration;
    oscillator.type = cue.type;
    oscillator.frequency.setValueAtTime(cue.frequency, startAt);
    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(cue.gain * volume, attackEnd);
    gainNode.gain.linearRampToValueAtTime(0, endAt);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.onended = () => {
      safeDisconnect(oscillator);
      safeDisconnect(gainNode);
    };
    oscillator.start(startAt);
    oscillator.stop(endAt);
    return true;
  } catch {
    return false;
  }
}

function contextIsRunning(context) {
  // A few fake/minimal contexts omit state; a real Web Audio context exposes
  // it. When present, anything but "running" is treated as blocked.
  try {
    const state = context?.state;
    return !state || state === 'running';
  } catch {
    return false;
  }
}

/**
 * Creates an optional feedback controller. The app should call unlock() from
 * its first keydown/pointerdown handler, then call footstep(), door(), or
 * dialogue() at deliberate game events. play() before unlock() is a no-op.
 */
export function createAudioFeedback({
  AudioContext = defaultAudioContext(),
  storage = null,
  storageKey = AUDIO_PREFERENCE_STORAGE_KEY
} = {}) {
  const key = typeof storageKey === 'string' && storageKey.length > 0
    ? storageKey
    : AUDIO_PREFERENCE_STORAGE_KEY;
  let preferences = readPreferences(storage, key);
  let context = null;
  let unlocked = false;
  let destroyed = false;
  let unlockPromise = null;

  function releaseFailedContext() {
    const failedContext = context;
    context = null;
    unlocked = false;
    try {
      failedContext?.close?.();
    } catch {
      // A failed/blocked audio context is intentionally discarded.
    }
  }

  function unlock() {
    if (destroyed || typeof AudioContext !== 'function') return Promise.resolve(false);
    if (unlocked && contextIsRunning(context)) return Promise.resolve(true);
    if (unlockPromise) return unlockPromise;

    try {
      if (!context) context = new AudioContext();
      if (!context) return Promise.resolve(false);
      const resumed = typeof context.resume === 'function' ? context.resume() : undefined;
      unlockPromise = Promise.resolve(resumed)
        .then(() => {
          if (destroyed || !contextIsRunning(context)) {
            releaseFailedContext();
            return false;
          }
          unlocked = true;
          return true;
        })
        .catch(() => {
          releaseFailedContext();
          return false;
        })
        .finally(() => {
          unlockPromise = null;
        });
      return unlockPromise;
    } catch {
      releaseFailedContext();
      return Promise.resolve(false);
    }
  }

  function play(name) {
    const cue = AUDIO_CUES[name];
    if (destroyed || !unlocked || !contextIsRunning(context) || !cue
      || preferences.muted || preferences.volume <= 0) return false;
    return scheduleCue(context, cue, preferences.volume);
  }

  function setMuted(muted) {
    preferences = Object.freeze({ ...preferences, muted: muted === true });
    writePreferences(storage, key, preferences);
    return preferences.muted;
  }

  function setVolume(volume) {
    preferences = Object.freeze({ ...preferences, volume: clampVolume(volume) });
    writePreferences(storage, key, preferences);
    return preferences.volume;
  }

  function toggleMuted() {
    return setMuted(!preferences.muted);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    unlocked = false;
    const activeContext = context;
    context = null;
    try {
      activeContext?.close?.();
    } catch {
      // Teardown must stay safe during page navigation/unload.
    }
  }

  return Object.freeze({
    unlock,
    play,
    footstep: () => play('footstep'),
    door: () => play('door'),
    dialogue: () => play('dialogue'),
    setMuted,
    setVolume,
    toggleMuted,
    getPreferences: () => Object.freeze({ ...preferences }),
    isSupported: () => typeof AudioContext === 'function',
    isUnlocked: () => unlocked && contextIsRunning(context),
    destroy
  });
}
