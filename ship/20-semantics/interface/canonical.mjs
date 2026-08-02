import { createHash } from 'node:crypto';

import {
  EMPTY_EVIDENCE,
  EVIDENCE_STATES,
} from '../configuration/semantic-config.mjs';

const EVIDENCE_KEY_FIELDS = Object.freeze([
  'key',
  'id',
  'code',
  'reason',
  'rationale',
  'source',
]);

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function asFiniteNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function sortedUniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const stringValue = typeof value === 'string' ? value : null;
    if (stringValue === null || stringValue.length === 0 || seen.has(stringValue)) {
      continue;
    }
    seen.add(stringValue);
    result.push(stringValue);
  }
  return result.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

/**
 * Convert an evidence value to a stable machine key. InspectionReport v1 uses
 * string keys, but accepting a small key/id/code object keeps this boundary
 * tolerant of producers that attach a display label beside the machine key.
 */
export function evidenceKey(value) {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (!isRecord(value)) {
    return null;
  }
  for (const field of EVIDENCE_KEY_FIELDS) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

export function emptyEvidence() {
  return {
    observed: [],
    inferred: [],
    unknown: [],
  };
}

export function normalizeEvidenceBag(value) {
  const source = isRecord(value) ? value : EMPTY_EVIDENCE;
  return {
    observed: sortedUniqueStrings(evidenceValues(source.observed)),
    inferred: sortedUniqueStrings(evidenceValues(source.inferred)),
    unknown: sortedUniqueStrings(evidenceValues(source.unknown)),
  };
}

function evidenceValues(value) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.map(evidenceKey).filter((key) => key !== null);
}

export function mergeEvidence(...bags) {
  const result = emptyEvidence();
  for (const bag of bags) {
    const normalized = normalizeEvidenceBag(bag);
    for (const state of EVIDENCE_STATES) {
      result[state].push(...normalized[state]);
    }
  }
  for (const state of EVIDENCE_STATES) {
    result[state] = sortedUniqueStrings(result[state]);
  }
  return result;
}

/**
 * A canonical JSON representation. Object keys and arrays are sorted so a
 * report assembled in a different traversal order yields the same digest.
 * The input is never modified.
 */
export function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'undefined') {
    return null;
  }
  if (Array.isArray(value)) {
    const values = value.map(canonicalize);
    values.sort((left, right) => {
      const leftJSON = JSON.stringify(left);
      const rightJSON = JSON.stringify(right);
      return leftJSON < rightJSON ? -1 : leftJSON > rightJSON ? 1 : 0;
    });
    return values;
  }
  if (isRecord(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return String(value);
}

export function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonicalDigest(value) {
  return sha256(canonicalJSON(value));
}

export function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortByStrings(values, selector) {
  return [...values].sort((left, right) => {
    const leftKeys = selector(left);
    const rightKeys = selector(right);
    for (let index = 0; index < Math.max(leftKeys.length, rightKeys.length); index += 1) {
      const leftKey = leftKeys[index] ?? '';
      const rightKey = rightKeys[index] ?? '';
      const compared = compareStrings(leftKey, rightKey);
      if (compared !== 0) {
        return compared;
      }
    }
    return 0;
  });
}
