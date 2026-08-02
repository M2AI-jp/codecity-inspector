import {
  ROLES,
  EVIDENCE_STATES,
} from '../configuration/semantic-config.mjs';
import {
  asNonEmptyString,
  emptyEvidence,
  isRecord,
  sortedUniqueStrings,
} from '../interface/canonical.mjs';

const ROLE_SET = new Set(ROLES);

/**
 * Keep only annotations that can be joined to an existing inspection file and
 * that carry an inferred/unknown rationale. In particular, `observed` is
 * intentionally not an accepted annotation state.
 */
export function readAnnotations(annotations, files) {
  const source = annotationList(annotations);
  if (source.length === 0) {
    return new Map();
  }

  const filesById = new Map(files.map((file) => [file.fileId, file]));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const grouped = new Map();

  for (const raw of source) {
    const annotation = normalizeAnnotation(raw, filesById, filesByPath);
    if (annotation === null) {
      continue;
    }
    const key = annotation.fileId;
    const values = grouped.get(key) ?? [];
    values.push(annotation);
    grouped.set(key, values);
  }

  for (const [key, values] of grouped) {
    values.sort(compareAnnotations);
    grouped.set(key, values);
  }
  return grouped;
}

export function applyAnnotation(base, annotations) {
  const values = annotations.get(base.fileId) ?? [];
  if (values.length === 0) {
    return base;
  }

  const roles = sortedUniqueStrings(values.map((value) => value.role));
  const evidence = emptyEvidence();
  // An annotation is allowed to refine a role, never to erase an observed
  // inspection fact already attached to that file.
  evidence.observed.push(...(base.evidence?.observed ?? []));
  for (const value of values) {
    evidence[value.state].push(value.reason);
  }
  for (const state of EVIDENCE_STATES) {
    evidence[state] = sortedUniqueStrings(evidence[state]);
  }

  if (roles.length !== 1) {
    evidence.inferred = [];
    evidence.unknown.push(`role.annotation.ambiguous.${roles.join('+')}`);
    return { ...base, role: 'module', evidence };
  }

  return {
    ...base,
    role: roles[0],
    evidence,
  };
}

function normalizeAnnotation(raw, filesById, filesByPath) {
  if (!isRecord(raw)) {
    return null;
  }

  const fileId = asNonEmptyString(raw.fileId) ?? asNonEmptyString(raw.id);
  const path = asNonEmptyString(raw.path);
  const file = (fileId !== null ? filesById.get(fileId) : undefined)
    ?? (path !== null ? filesByPath.get(path) : undefined);
  if (file === undefined) {
    return null;
  }

  const role = asNonEmptyString(raw.role);
  if (role === null || !ROLE_SET.has(role)) {
    return null;
  }

  const nestedEvidence = isRecord(raw.evidence) ? raw.evidence : null;
  const state = asNonEmptyString(raw.state)
    ?? asNonEmptyString(raw.status)
    ?? asNonEmptyString(raw.evidenceState)
    ?? asNonEmptyString(nestedEvidence?.state)
    ?? asNonEmptyString(nestedEvidence?.status);
  if (state !== 'inferred' && state !== 'unknown') {
    return null;
  }

  const reason = asNonEmptyString(raw.reason)
    ?? asNonEmptyString(raw.rationale)
    ?? asNonEmptyString(raw.basis)
    ?? asNonEmptyString(nestedEvidence?.reason)
    ?? asNonEmptyString(nestedEvidence?.rationale)
    ?? firstEvidenceString(raw.evidence);
  if (reason === null) {
    return null;
  }

  return {
    fileId: file.fileId,
    path: file.path,
    role,
    state,
    reason,
  };
}

function annotationList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  if (Array.isArray(value.files)) {
    return value.files;
  }
  if (Array.isArray(value.annotations)) {
    return value.annotations;
  }
  // A keyed map is convenient for callers assembling annotations from a
  // review form. The key is only a lookup hint; the entry still has to carry
  // a known fileId/path before it can be accepted.
  return Object.entries(value).map(([key, entry]) => {
    if (!isRecord(entry)) {
      return entry;
    }
    return entry.fileId || entry.id || entry.path
      ? entry
      : { ...entry, fileId: key };
  });
}

function firstEvidenceString(value) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === 'string' && entry.length > 0) ?? null;
  }
  if (isRecord(value)) {
    for (const key of ['inferred', 'unknown']) {
      const found = firstEvidenceString(value[key]);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

function compareAnnotations(left, right) {
  // Inferred is a positive semantic hint; when a caller supplies both an
  // unknown and inferred annotation for the same role, the inferred one wins.
  const leftState = left.state === 'inferred' ? 0 : 1;
  const rightState = right.state === 'inferred' ? 0 : 1;
  if (leftState !== rightState) {
    return leftState - rightState;
  }
  if (left.role !== right.role) {
    return left.role < right.role ? -1 : 1;
  }
  return left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0;
}
