import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_CUES,
  AUDIO_PREFERENCE_STORAGE_KEY,
  DEFAULT_AUDIO_PREFERENCES,
  createAudioFeedback,
  normalizeAudioPreferences
} from '../../public/fable5-v2/audio-feedback.mjs';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      values.set(key, value);
      writes.push([key, value]);
    },
    writes,
    read(key = AUDIO_PREFERENCE_STORAGE_KEY) { return values.get(key); }
  };
}

function makeAudioContext({ state = 'running', resume = undefined } = {}) {
  const oscillators = [];
  const gains = [];
  const context = {
    state,
    currentTime: 12.5,
    destination: { id: 'destination' },
    resumeCalls: 0,
    closeCalls: 0,
    createOscillator() {
      const oscillator = {
        frequency: {
          events: [],
          setValueAtTime(value, time) { this.events.push(['set', value, time]); }
        },
        connections: [],
        starts: [],
        stops: [],
        disconnected: 0,
        type: '',
        connect(node) { this.connections.push(node); },
        start(time) { this.starts.push(time); },
        stop(time) {
          this.stops.push(time);
          this.onended?.();
        },
        disconnect() { this.disconnected += 1; }
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() {
      const gain = {
        gain: {
          events: [],
          setValueAtTime(value, time) { this.events.push(['set', value, time]); },
          linearRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); }
        },
        connections: [],
        disconnected: 0,
        connect(node) { this.connections.push(node); },
        disconnect() { this.disconnected += 1; }
      };
      gains.push(gain);
      return gain;
    },
    close() { this.closeCalls += 1; }
  };
  context.resume = resume ?? function resumeContext() {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  };
  return { context, oscillators, gains };
}

function factoryFor(fake) {
  let calls = 0;
  function AudioContext() {
    calls += 1;
    return fake.context;
  }
  return { AudioContext, calls: () => calls };
}

test('does not create an AudioContext or make sound before an explicit user-gesture unlock', () => {
  const fake = makeAudioContext();
  const factory = factoryFor(fake);
  const audio = createAudioFeedback({ AudioContext: factory.AudioContext, storage: null });

  assert.equal(audio.play('footstep'), false);
  assert.equal(audio.footstep(), false);
  assert.equal(audio.door(), false);
  assert.equal(audio.dialogue(), false);
  assert.equal(factory.calls(), 0);
  assert.equal(fake.oscillators.length, 0);
  assert.equal(audio.isUnlocked(), false);
});

test('unlock resumes exactly one injected context and enables deterministic native Web Audio cue scheduling', async () => {
  const fake = makeAudioContext({ state: 'suspended' });
  const factory = factoryFor(fake);
  const audio = createAudioFeedback({ AudioContext: factory.AudioContext, storage: null });

  assert.equal(await audio.unlock(), true);
  assert.equal(factory.calls(), 1);
  assert.equal(fake.context.resumeCalls, 1);
  assert.equal(audio.isUnlocked(), true);
  assert.equal(audio.footstep(), true);

  const cue = AUDIO_CUES.footstep;
  const oscillator = fake.oscillators[0];
  const gain = fake.gains[0];
  assert.equal(oscillator.type, cue.type);
  assert.deepEqual(oscillator.frequency.events, [['set', cue.frequency, 12.5]]);
  assert.deepEqual(gain.gain.events, [
    ['set', 0, 12.5],
    ['ramp', cue.gain * DEFAULT_AUDIO_PREFERENCES.volume, 12.5 + cue.attack],
    ['ramp', 0, 12.5 + cue.duration]
  ]);
  assert.deepEqual(oscillator.starts, [12.5]);
  assert.deepEqual(oscillator.stops, [12.5 + cue.duration]);
  assert.deepEqual(oscillator.connections, [gain]);
  assert.deepEqual(gain.connections, [fake.context.destination]);
  assert.equal(oscillator.disconnected, 1, 'onended cleanup releases the oscillator');
  assert.equal(gain.disconnected, 1, 'onended cleanup releases the gain node');
});

test('footstep, door, and dialogue wrappers each schedule their fixed cue without randomness or external assets', async () => {
  const fake = makeAudioContext();
  const audio = createAudioFeedback({ AudioContext: factoryFor(fake).AudioContext, storage: null });
  await audio.unlock();

  assert.equal(audio.footstep(), true);
  assert.equal(audio.door(), true);
  assert.equal(audio.dialogue(), true);
  assert.deepEqual(fake.oscillators.map(({ type, frequency }) => ({
    type,
    frequency: frequency.events[0][1]
  })), [
    { type: 'triangle', frequency: 180 },
    { type: 'sine', frequency: 132 },
    { type: 'square', frequency: 660 }
  ]);
  for (const [index, duration] of [0.045, 0.12, 0.045].entries()) {
    const elapsed = fake.oscillators[index].stops[0] - 12.5;
    assert.ok(Math.abs(elapsed - duration) < 1e-12, `cue ${index} duration drifted: ${elapsed}`);
  }
  assert.equal(audio.play('not-a-cue'), false);
  assert.equal(fake.oscillators.length, 3);
});

test('mute and volume preferences load, clamp, persist, and prevent oscillators when inaudible', async () => {
  const storage = createStorage({
    [AUDIO_PREFERENCE_STORAGE_KEY]: JSON.stringify({ muted: true, volume: 0.2 })
  });
  const fake = makeAudioContext();
  const audio = createAudioFeedback({ AudioContext: factoryFor(fake).AudioContext, storage });

  assert.deepEqual(audio.getPreferences(), { muted: true, volume: 0.2 });
  await audio.unlock();
  assert.equal(audio.door(), false, 'mute is checked before any oscillator is created');
  assert.equal(fake.oscillators.length, 0);

  assert.equal(audio.setMuted(false), false);
  assert.equal(audio.setVolume(4), 1, 'volume is capped at one');
  assert.equal(audio.door(), true);
  assert.equal(fake.oscillators.length, 1);
  assert.deepEqual(JSON.parse(storage.read()), { muted: false, volume: 1 });
  assert.equal(storage.writes.length, 2);

  assert.equal(audio.setVolume(0), 0);
  assert.equal(audio.dialogue(), false, 'zero volume is an inaudible no-op');
  assert.equal(fake.oscillators.length, 1);
  assert.equal(audio.toggleMuted(), true);
  assert.deepEqual(audio.getPreferences(), { muted: true, volume: 0 });
});

test('normalization rejects malformed stored values without turning audio preferences into NaN or out-of-range state', () => {
  assert.deepEqual(normalizeAudioPreferences(null), DEFAULT_AUDIO_PREFERENCES);
  assert.deepEqual(normalizeAudioPreferences({ muted: 'true', volume: '0.25' }), { muted: false, volume: 0.25 });
  assert.deepEqual(normalizeAudioPreferences({ muted: true, volume: -2 }), { muted: true, volume: 0 });
  assert.deepEqual(normalizeAudioPreferences({ muted: false, volume: Infinity }), DEFAULT_AUDIO_PREFERENCES);
});

test('unavailable, blocked, malformed, and throwing browser APIs fail closed without surfacing an exception', async () => {
  const unavailable = createAudioFeedback({ AudioContext: null, storage: null });
  assert.equal(unavailable.isSupported(), false);
  assert.equal(await unavailable.unlock(), false);
  assert.equal(unavailable.play('door'), false);

  function ThrowingAudioContext() { throw new Error('blocked'); }
  const blocked = createAudioFeedback({ AudioContext: ThrowingAudioContext, storage: null });
  assert.equal(await blocked.unlock(), false);
  assert.equal(blocked.play('dialogue'), false);

  const brokenStorage = {
    getItem() { throw new Error('storage blocked'); },
    setItem() { throw new Error('storage blocked'); }
  };
  const fake = makeAudioContext({
    state: 'suspended',
    resume() { return Promise.reject(new Error('gesture denied')); }
  });
  const denied = createAudioFeedback({ AudioContext: factoryFor(fake).AudioContext, storage: brokenStorage });
  assert.deepEqual(denied.getPreferences(), DEFAULT_AUDIO_PREFERENCES);
  assert.equal(await denied.unlock(), false);
  assert.equal(denied.play('footstep'), false);

  const hostileContext = {
    get state() { throw new Error('state access blocked'); },
    resume() { return Promise.resolve(); },
    close() {}
  };
  function HostileAudioContext() { return hostileContext; }
  const hostile = createAudioFeedback({ AudioContext: HostileAudioContext, storage: null });
  assert.equal(await hostile.unlock(), false);
  assert.doesNotThrow(() => {
    assert.equal(hostile.isUnlocked(), false);
    assert.equal(hostile.play('door'), false);
  });

  assert.doesNotThrow(() => {
    denied.setMuted(true);
    denied.setVolume('not-a-number');
    denied.destroy();
  });
});

test('destroy is safe, closes the context once, and permanently prevents later unlock/play attempts', async () => {
  const fake = makeAudioContext();
  const audio = createAudioFeedback({ AudioContext: factoryFor(fake).AudioContext, storage: null });
  await audio.unlock();
  audio.destroy();
  audio.destroy();

  assert.equal(fake.context.closeCalls, 1);
  assert.equal(audio.isUnlocked(), false);
  assert.equal(await audio.unlock(), false);
  assert.equal(audio.play('footstep'), false);
});
