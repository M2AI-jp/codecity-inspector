// Small, injected persistence boundary for the Fable5 runtime.
//
// This module intentionally never reaches for a browser storage global. The
// caller chooses whether persistence is available
// and passes a Storage-like object at runtime, after the page has loaded.

export const FABLE5_PERSISTENCE_SCHEMA_VERSION = 1;
export const FABLE5_PERSISTENCE_NAMESPACE = 'codecity-inspector:fable5:progress';

const INSPECTION_DIGEST = /^[a-f0-9]{64}$/;
const MAX_SCOPE_STRING_LENGTH = 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 10_000;
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Creates an isolated persistence adapter for exactly one inspected repository
 * revision. `repositoryIdentity` is deliberately exact rather than normalized:
 * two different identities must never share a save slot by accident.
 *
 * `storage` is a minimal injected Storage-like object. Only getItem, setItem,
 * and removeItem are used, and every access is guarded so privacy-mode,
 * quota, and security failures cannot crash the game.
 */
export function createFable5Persistence({
  storage,
  repositoryIdentity,
  inspectionDigest,
  namespace = FABLE5_PERSISTENCE_NAMESPACE
} = {}) {
  const scope = normalizeScope({ namespace, repositoryIdentity, inspectionDigest });
  const key = scope ? persistenceKey(scope) : null;

  return Object.freeze({
    schemaVersion: FABLE5_PERSISTENCE_SCHEMA_VERSION,
    key,
    scope,
    load() {
      return loadPersistedState(storage, scope, key);
    },
    save(state) {
      return savePersistedState(storage, scope, key, state);
    },
    reset({ confirmed = false } = {}) {
      return resetPersistedState(storage, scope, key, confirmed);
    }
  });
}

function normalizeScope({ namespace, repositoryIdentity, inspectionDigest }) {
  if (!isUsableScopeString(namespace) || !isUsableScopeString(repositoryIdentity)) return null;
  if (typeof inspectionDigest !== 'string' || !INSPECTION_DIGEST.test(inspectionDigest)) return null;

  return Object.freeze({
    namespace,
    repositoryIdentity,
    inspectionDigest
  });
}

function isUsableScopeString(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SCOPE_STRING_LENGTH
    && /\S/u.test(value)
    && isWellFormedUnicode(value);
}

// encodeURIComponent throws on a lone UTF-16 surrogate. Rejecting those
// identities avoids a silent key collision after browser DOMString coercion.
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function persistenceKey(scope) {
  return `${scope.namespace}:v${FABLE5_PERSISTENCE_SCHEMA_VERSION}:${encodeURIComponent(scope.repositoryIdentity)}:${scope.inspectionDigest}`;
}

function loadPersistedState(storage, scope, key) {
  if (!scope) return loadResult('invalid-scope', null);

  const read = callStorage(storage, 'getItem', [key]);
  if (!read.ok) return loadResult('storage-unavailable', key);
  if (read.value === null) return loadResult('missing', key);
  if (typeof read.value !== 'string') return loadResult('corrupt', key);
  if (read.value.length === 0) return loadResult('corrupt', key);

  let parsed;
  try {
    parsed = JSON.parse(read.value);
  } catch {
    return loadResult('corrupt', key);
  }

  const envelope = cloneJsonRecord(parsed);
  if (!envelope.ok) return loadResult('corrupt', key);
  if (envelope.value.schemaVersion !== FABLE5_PERSISTENCE_SCHEMA_VERSION) {
    return loadResult('schema-mismatch', key);
  }

  const storedScope = normalizeStoredScope(envelope.value.scope);
  if (!storedScope) return loadResult('corrupt', key);
  if (!sameScope(storedScope, scope)) return loadResult('scope-mismatch', key);

  const state = cloneJsonRecord(envelope.value.state);
  if (!state.ok) return loadResult('corrupt', key);

  return Object.freeze({ status: 'loaded', key, state: state.value });
}

function savePersistedState(storage, scope, key, state) {
  if (!scope) return operationResult('invalid-scope', null);

  const stateCopy = cloneJsonRecord(state);
  if (!stateCopy.ok) return operationResult('invalid-state', key);

  let serialized;
  try {
    serialized = JSON.stringify({
      schemaVersion: FABLE5_PERSISTENCE_SCHEMA_VERSION,
      scope,
      state: stateCopy.value
    });
  } catch {
    // cloneJsonRecord makes this unlikely, but JSON serialization should
    // remain a non-throwing persistence boundary even in hostile environments.
    return operationResult('serialization-failed', key);
  }

  const write = callStorage(storage, 'setItem', [key, serialized]);
  if (!write.ok) return operationResult('storage-unavailable', key);
  return operationResult('saved', key);
}

function resetPersistedState(storage, scope, key, confirmed) {
  if (!scope) return operationResult('invalid-scope', null);
  if (confirmed !== true) return operationResult('reset-not-confirmed', key);

  // Deliberately remove one exact scoped key. Never call storage.clear(), so
  // a reset for one inspected repository cannot erase another repository.
  const removal = callStorage(storage, 'removeItem', [key]);
  if (!removal.ok) return operationResult('storage-unavailable', key);
  return operationResult('reset', key);
}

function normalizeStoredScope(value) {
  const scope = cloneJsonRecord(value);
  if (!scope.ok) return null;
  return normalizeScope(scope.value);
}

function sameScope(left, right) {
  return left.namespace === right.namespace
    && left.repositoryIdentity === right.repositoryIdentity
    && left.inspectionDigest === right.inspectionDigest;
}

function callStorage(storage, method, args) {
  try {
    if ((typeof storage !== 'object' && typeof storage !== 'function') || storage === null) {
      return { ok: false };
    }
    const operation = storage[method];
    if (typeof operation !== 'function') return { ok: false };
    return { ok: true, value: operation.call(storage, ...args) };
  } catch {
    return { ok: false };
  }
}

function loadResult(status, key) {
  return Object.freeze({ status, key, state: null });
}

function operationResult(status, key) {
  return Object.freeze({ status, key });
}

// A game save is intentionally a JSON record, not an arbitrary JavaScript
// value. This avoids silently dropping undefined/functions, rejects cycles and
// accessors, and makes the exact bytes durable and portable across sessions.
function cloneJsonRecord(value) {
  const budget = { nodes: 0 };
  try {
    if (!isPlainRecord(value)) return { ok: false };
    return { ok: true, value: cloneJsonValue(value, new Set(), budget, 0) };
  } catch {
    return { ok: false };
  }
}

function cloneJsonValue(value, ancestors, budget, depth) {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new TypeError('JSON state limit');

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('non-JSON primitive');
  if (ancestors.has(value)) throw new TypeError('cyclic state');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return cloneJsonArray(value, ancestors, budget, depth);
    if (!isPlainRecord(value)) throw new TypeError('non-plain object');
    return cloneJsonObject(value, ancestors, budget, depth);
  } finally {
    ancestors.delete(value);
  }
}

function cloneJsonArray(value, ancestors, budget, depth) {
  if (!Number.isSafeInteger(value.length) || value.length > MAX_JSON_NODES) {
    throw new TypeError('oversized array');
  }
  const keys = Reflect.ownKeys(value);
  const output = new Array(value.length);
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !isArrayIndex(key, value.length)) {
      throw new TypeError('non-index array property');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('array accessor');
    }
    output[Number(key)] = cloneJsonValue(descriptor.value, ancestors, budget, depth + 1);
  }

  // JSON.stringify turns a sparse array's holes into null. Reject it instead
  // of silently changing the game state during a save/load round-trip.
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError('sparse array');
  }
  return output;
}

function cloneJsonObject(value, ancestors, budget, depth) {
  // Unsafe prototype-changing keys are rejected above, so an ordinary record
  // preserves the familiar object shape for callers after a successful load.
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || UNSAFE_JSON_KEYS.has(key)) throw new TypeError('unsafe object key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('object accessor');
    }
    output[key] = cloneJsonValue(descriptor.value, ancestors, budget, depth + 1);
  }
  return output;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayIndex(key, length) {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}
