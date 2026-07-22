import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createFable5Persistence,
  FABLE5_PERSISTENCE_NAMESPACE,
  FABLE5_PERSISTENCE_SCHEMA_VERSION
} from '../../public/fable5-v2/persistence.mjs';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function memoryStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  const calls = [];
  return {
    calls,
    values,
    getItem(key) {
      calls.push(['getItem', key]);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      calls.push(['setItem', key, value]);
      values.set(key, value);
    },
    removeItem(key) {
      calls.push(['removeItem', key]);
      values.delete(key);
    },
    clear() {
      calls.push(['clear']);
      values.clear();
    }
  };
}

function persistence(storage, {
  repositoryIdentity = 'owner/repository',
  inspectionDigest = DIGEST_A,
  namespace = FABLE5_PERSISTENCE_NAMESPACE
} = {}) {
  return createFable5Persistence({ storage, repositoryIdentity, inspectionDigest, namespace });
}

test('creates a versioned key from the exact repository identity and inspection digest', () => {
  const store = memoryStorage();
  const adapter = persistence(store, { repositoryIdentity: 'team/街 repo', inspectionDigest: DIGEST_B });

  assert.equal(adapter.schemaVersion, FABLE5_PERSISTENCE_SCHEMA_VERSION);
  assert.equal(adapter.scope.repositoryIdentity, 'team/街 repo');
  assert.equal(adapter.scope.inspectionDigest, DIGEST_B);
  assert.match(adapter.key, new RegExp(`^${FABLE5_PERSISTENCE_NAMESPACE}:v1:`));
  assert.match(adapter.key, /team%2F%E8%A1%97%20repo/);
  assert.ok(adapter.key.endsWith(`:${DIGEST_B}`));
  assert.ok(Object.isFrozen(adapter));
});

test('saves a schema-versioned envelope and loads the same JSON record', () => {
  const store = memoryStorage();
  const adapter = persistence(store);
  const progress = {
    questStage: 'investigating',
    foundClues: ['clue-well', 'clue-streetlamp'],
    player: { x: 212, y: 438, facing: 'north' }
  };

  assert.deepEqual(adapter.save(progress), { status: 'saved', key: adapter.key });
  const envelope = JSON.parse(store.values.get(adapter.key));
  assert.equal(envelope.schemaVersion, FABLE5_PERSISTENCE_SCHEMA_VERSION);
  assert.deepEqual(envelope.scope, adapter.scope);
  assert.deepEqual(envelope.state, progress);
  assert.deepEqual(adapter.load(), { status: 'loaded', key: adapter.key, state: progress });
});

test('returns missing with a null state when the exact scoped key has no entry', () => {
  const adapter = persistence(memoryStorage());
  assert.deepEqual(adapter.load(), { status: 'missing', key: adapter.key, state: null });
});

test('keeps saves isolated by repository identity and inspection digest', () => {
  const store = memoryStorage();
  const repositoryA = persistence(store, { repositoryIdentity: 'owner/a', inspectionDigest: DIGEST_A });
  const repositoryB = persistence(store, { repositoryIdentity: 'owner/b', inspectionDigest: DIGEST_A });
  const changedInspection = persistence(store, { repositoryIdentity: 'owner/a', inspectionDigest: DIGEST_B });

  repositoryA.save({ questStage: 'completed' });
  repositoryB.save({ questStage: 'unstarted' });

  assert.notEqual(repositoryA.key, repositoryB.key);
  assert.notEqual(repositoryA.key, changedInspection.key);
  assert.deepEqual(repositoryA.load().state, { questStage: 'completed' });
  assert.deepEqual(repositoryB.load().state, { questStage: 'unstarted' });
  assert.deepEqual(changedInspection.load(), { status: 'missing', key: changedInspection.key, state: null });
});

test('fails closed when a payload at the scoped key claims another repository or digest', () => {
  const store = memoryStorage();
  const adapter = persistence(store, { repositoryIdentity: 'owner/a', inspectionDigest: DIGEST_A });
  store.values.set(adapter.key, JSON.stringify({
    schemaVersion: 1,
    scope: {
      namespace: FABLE5_PERSISTENCE_NAMESPACE,
      repositoryIdentity: 'owner/b',
      inspectionDigest: DIGEST_B
    },
    state: { questStage: 'completed' }
  }));

  assert.deepEqual(adapter.load(), { status: 'scope-mismatch', key: adapter.key, state: null });
});

test('fails closed for malformed JSON, invalid envelopes, and unsupported schema versions', () => {
  const store = memoryStorage();
  const adapter = persistence(store);
  const corrupt = [
    '{not json',
    'null',
    { not: 'a storage string' },
    JSON.stringify({ schemaVersion: 1, scope: adapter.scope, state: ['not', 'a', 'record'] }),
    JSON.stringify({ schemaVersion: 1, scope: { ...adapter.scope, inspectionDigest: 'not-a-digest' }, state: {} }),
    JSON.stringify({ schemaVersion: 99, scope: adapter.scope, state: {} })
  ];
  const expected = ['corrupt', 'corrupt', 'corrupt', 'corrupt', 'corrupt', 'schema-mismatch'];

  for (let index = 0; index < corrupt.length; index += 1) {
    store.values.set(adapter.key, corrupt[index]);
    assert.deepEqual(adapter.load(), { status: expected[index], key: adapter.key, state: null });
  }
});

test('rejects unsafe or lossy save values without writing a partial payload', () => {
  const store = memoryStorage();
  const adapter = persistence(store);
  const cyclic = { questStage: 'investigating' };
  cyclic.self = cyclic;
  const withAccessor = {};
  Object.defineProperty(withAccessor, 'secret', { enumerable: true, get() { return 'nope'; } });
  const invalidStates = [
    null,
    ['array-not-a-state-record'],
    { progress: undefined },
    { progress: Number.NaN },
    { progress: 1n },
    { progress: () => {} },
    cyclic,
    withAccessor,
    { __proto__: { polluted: true } }
  ];

  for (const state of invalidStates) {
    assert.deepEqual(adapter.save(state), { status: 'invalid-state', key: adapter.key });
  }
  assert.equal(store.values.has(adapter.key), false);
  assert.equal(store.calls.some(([method]) => method === 'setItem'), false);
});

test('copies state on save so later caller mutation cannot alter the stored snapshot', () => {
  const store = memoryStorage();
  const adapter = persistence(store);
  const state = { foundClues: ['clue-well'], player: { x: 1 } };

  adapter.save(state);
  state.foundClues.push('clue-east-shop');
  state.player.x = 99;

  assert.deepEqual(adapter.load().state, { foundClues: ['clue-well'], player: { x: 1 } });
});

test('handles unavailable, incomplete, and throwing storage without throwing from load/save/reset', () => {
  const throwingStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); }
  };
  const adapter = persistence(throwingStorage);

  assert.doesNotThrow(() => adapter.load());
  assert.deepEqual(adapter.load(), { status: 'storage-unavailable', key: adapter.key, state: null });
  assert.deepEqual(adapter.save({ questStage: 'unstarted' }), { status: 'storage-unavailable', key: adapter.key });
  assert.deepEqual(adapter.reset({ confirmed: true }), { status: 'storage-unavailable', key: adapter.key });

  const incomplete = persistence({ getItem() { return null; } });
  assert.deepEqual(incomplete.load(), { status: 'missing', key: incomplete.key, state: null });
  assert.deepEqual(incomplete.save({}), { status: 'storage-unavailable', key: incomplete.key });
});

test('requires explicit confirmation and removes only this repository scope on reset', () => {
  const store = memoryStorage();
  const first = persistence(store, { repositoryIdentity: 'owner/first' });
  const second = persistence(store, { repositoryIdentity: 'owner/second' });
  first.save({ questStage: 'completed' });
  second.save({ questStage: 'investigating' });

  assert.deepEqual(first.reset(), { status: 'reset-not-confirmed', key: first.key });
  assert.deepEqual(first.reset({ confirmed: 'yes' }), { status: 'reset-not-confirmed', key: first.key });
  assert.deepEqual(first.load().state, { questStage: 'completed' });
  assert.equal(store.calls.some(([method]) => method === 'clear'), false);

  assert.deepEqual(first.reset({ confirmed: true }), { status: 'reset', key: first.key });
  assert.deepEqual(first.load(), { status: 'missing', key: first.key, state: null });
  assert.deepEqual(second.load().state, { questStage: 'investigating' });
  assert.equal(store.calls.some(([method]) => method === 'clear'), false);
});

test('rejects malformed scopes before touching injected storage', () => {
  const store = memoryStorage();
  const invalidAdapters = [
    persistence(store, { repositoryIdentity: '', inspectionDigest: DIGEST_A }),
    persistence(store, { repositoryIdentity: 'owner/a', inspectionDigest: 'bad' }),
    persistence(store, { repositoryIdentity: '\uD800', inspectionDigest: DIGEST_A }),
    persistence(store, { repositoryIdentity: 'owner/a', inspectionDigest: DIGEST_A, namespace: '' })
  ];

  for (const adapter of invalidAdapters) {
    assert.equal(adapter.key, null);
    assert.deepEqual(adapter.load(), { status: 'invalid-scope', key: null, state: null });
    assert.deepEqual(adapter.save({}), { status: 'invalid-scope', key: null });
    assert.deepEqual(adapter.reset({ confirmed: true }), { status: 'invalid-scope', key: null });
  }
  assert.equal(store.calls.length, 0);
});

test('has no browser-global persistence access at module import time', async () => {
  const source = await readFile(new URL('../../public/fable5-v2/persistence.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:window\.)?localStorage\b/);
  assert.doesNotMatch(source, /\b(?:window\.)?sessionStorage\b/);
});
