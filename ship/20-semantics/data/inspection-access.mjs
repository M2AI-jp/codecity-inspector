import {
  asNonEmptyString,
  evidenceKey,
  isRecord,
  normalizeEvidenceBag,
  sortedUniqueStrings,
} from '../interface/canonical.mjs';

export function readInspectionFiles(inspection) {
  const source = Array.isArray(inspection?.files) ? inspection.files : [];
  const result = [];
  for (const entry of source) {
    if (!isRecord(entry)) {
      continue;
    }
    const fileId = asNonEmptyString(entry.id);
    const path = asNonEmptyString(entry.path);
    if (fileId === null || path === null) {
      continue;
    }
    result.push({
      fileId,
      path,
      kind: asNonEmptyString(entry.kind),
      extension: asNonEmptyString(entry.extension)?.toLowerCase() ?? null,
      isTest: entry.isTest === true,
    });
  }
  return result;
}

export function readRepository(inspection) {
  const source = isRecord(inspection?.repository) ? inspection.repository : {};
  return {
    name: typeof source.name === 'string' ? source.name : null,
    identity: typeof source.identity === 'string' ? source.identity : null,
  };
}

export function readEvidence(inspection) {
  return normalizeEvidenceBag(inspection?.evidence);
}

export function readEvidenceRecords(inspection) {
  const source = isRecord(inspection?.evidence) ? inspection.evidence : {};
  const records = [];
  for (const state of ['observed', 'inferred', 'unknown']) {
    const entries = Array.isArray(source[state]) ? source[state] : [];
    for (const entry of entries) {
      const key = evidenceKey(entry);
      if (key === null) {
        continue;
      }
      records.push({
        state,
        key,
        subjects: evidenceSubjects(entry),
      });
    }
  }
  return records.sort((left, right) => {
    const leftKey = `${left.state}\u0000${left.key}`;
    const rightKey = `${right.state}\u0000${right.key}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

export function readGraph(inspection) {
  return inspection.graph;
}

export function readManifests(inspection) {
  return inspection.manifests;
}

export function pathSegments(path) {
  return typeof path === 'string'
    ? path.split(/[\\/]+/u).filter(Boolean).map((part) => part.toLowerCase())
    : [];
}

export function basename(path) {
  return typeof path === 'string' ? (path.split(/[\\/]+/u).at(-1) ?? '').toLowerCase() : '';
}

export function evidenceSubjects(entry) {
  return sortedUniqueStrings([entry.subject, entry.path].filter((value) => typeof value === 'string'));
}
