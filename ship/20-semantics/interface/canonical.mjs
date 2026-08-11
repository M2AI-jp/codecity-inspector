import {
  EVIDENCE_STATES,
} from '../configuration/semantic-config.mjs';

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
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
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 ? value.id : null;
}

export function emptyEvidence() {
  return {
    observed: [],
    inferred: [],
    unknown: [],
  };
}

export function normalizeEvidenceBag(value) {
  const source = isRecord(value) ? value : {};
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

function compareStrings(left, right) {
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
