// src/town/world-identity.mjs
//
// Deterministic identity helpers for WorldPlan v2. worldSeed controls only the
// stable visual variation of a repository-name town; inspectionDigest detects
// changes in the caller's already-normalized generator input. Neither helper
// reads the repository, performs I/O, samples a clock, or uses randomness.
//
// inspectionDigest is deliberately NOT described as a repository content
// hash. It hashes exactly the normalized value supplied by the caller after a
// recursive, locale-independent canonical JSON serialization. Object key order
// is canonicalized; array order remains meaningful.

import { createHash } from 'node:crypto';

/** @param {string} value @returns {string} */
function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** @param {string} left @param {string} right @returns {-1|0|1} */
function compareCodeUnits(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** @param {unknown} value @returns {boolean} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/**
 * Serialize JSON-shaped data with recursively sorted object keys. Unsupported
 * or malformed values degrade to JSON null instead of invoking coercion,
 * toJSON, accessors outside a guarded read, or any environment-dependent
 * behavior. Cycles also degrade at the cycle edge; shared non-cyclic objects
 * are serialized normally at each position.
 *
 * @param {unknown} value
 * @param {WeakSet<object>} ancestors
 * @returns {string}
 */
function canonicalJson(value, ancestors) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value !== 'object') return 'null';

  if (ancestors.has(value)) return 'null';
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = [];
      for (let index = 0; index < value.length; index += 1) {
        let item;
        try {
          item = value[index];
        } catch {
          item = null;
        }
        items.push(canonicalJson(item, ancestors));
      }
      return `[${items.join(',')}]`;
    }

    if (!isPlainObject(value)) return 'null';
    let keys;
    try {
      keys = Object.keys(value).sort(compareCodeUnits);
    } catch {
      return 'null';
    }
    const entries = [];
    for (const key of keys) {
      let item;
      try {
        item = value[key];
      } catch {
        item = null;
      }
      entries.push(`${JSON.stringify(key)}:${canonicalJson(item, ancestors)}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Stable WorldPlan visual seed: SHA-256 of inspection.repository.name's exact
 * UTF-8 bytes. A missing, non-string, or inaccessible name becomes the empty
 * string deterministically. Repository contents never enter this seed.
 *
 * @param {unknown} inspection
 * @returns {string} lowercase hexadecimal SHA-256
 */
export function worldSeed(inspection) {
  let repositoryName = '';
  try {
    if (typeof inspection?.repository?.name === 'string') {
      repositoryName = inspection.repository.name;
    }
  } catch {
    repositoryName = '';
  }
  return sha256(repositoryName);
}

/**
 * Change digest for an already-normalized WorldPlan generator input. Object
 * insertion order is ignored recursively, while array order is retained. This
 * is a digest of generator input facts, not a target-repository content hash.
 * Malformed values degrade deterministically and never need caller coercion.
 *
 * @param {unknown} normalizedGeneratorInput
 * @returns {string} lowercase hexadecimal SHA-256
 */
export function inspectionDigest(normalizedGeneratorInput) {
  let canonical = 'null';
  try {
    canonical = canonicalJson(normalizedGeneratorInput, new WeakSet());
  } catch {
    canonical = 'null';
  }
  return sha256(canonical);
}
