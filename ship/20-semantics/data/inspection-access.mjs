import {
  asFiniteNonNegativeInteger,
  asNonEmptyString,
  evidenceKey,
  isRecord,
  normalizeEvidenceBag,
  sortedUniqueStrings,
} from '../interface/canonical.mjs';

const FILE_ID_FIELDS = Object.freeze(['id', 'fileId']);
const PATH_FIELDS = Object.freeze(['path', 'relativePath']);

export function readInspectionFiles(inspection) {
  const source = Array.isArray(inspection?.files) ? inspection.files : [];
  const result = [];
  for (const entry of source) {
    if (!isRecord(entry)) {
      continue;
    }
    const fileId = firstString(entry, FILE_ID_FIELDS);
    const path = firstString(entry, PATH_FIELDS);
    if (fileId === null && path === null) {
      continue;
    }
    result.push({
      fileId: fileId ?? path,
      path: path ?? fileId,
      kind: asNonEmptyString(entry.kind),
      extension: asNonEmptyString(entry.extension)?.toLowerCase() ?? extensionFromPath(path),
      sizeBytes: asFiniteNonNegativeInteger(entry.sizeBytes),
      isTest: entry.isTest === true,
      source: entry,
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

export function readSummary(inspection) {
  const source = isRecord(inspection?.summary) ? inspection.summary : {};
  return {
    filesDiscovered: asFiniteNonNegativeInteger(source.filesDiscovered),
    filesInspected: asFiniteNonNegativeInteger(source.filesInspected),
    truncated: source.truncated === true,
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
        raw: entry,
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
  const source = isRecord(inspection?.graph) ? inspection.graph : {};
  const nodes = Array.isArray(source.nodes) ? source.nodes.filter(isRecord) : [];
  const edges = Array.isArray(source.edges) ? source.edges.filter(isRecord) : [];
  const entrypoints = Array.isArray(source.entrypoints)
    ? source.entrypoints.filter((entry) => typeof entry === 'string' || isRecord(entry))
    : [];
  return { nodes, edges, entrypoints };
}

export function readManifests(inspection) {
  return Array.isArray(inspection?.manifests)
    ? inspection.manifests.filter(isRecord)
    : [];
}

export function firstString(record, fields) {
  for (const field of fields) {
    const candidate = asNonEmptyString(record?.[field]);
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
}

export function extensionFromPath(path) {
  if (typeof path !== 'string') {
    return null;
  }
  const basename = path.split('/').at(-1) ?? '';
  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex <= 0) {
    return null;
  }
  return basename.slice(dotIndex).toLowerCase();
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
  if (!isRecord(entry)) {
    return [];
  }
  const candidates = [
    entry.subject,
    entry.subjectId,
    entry.fileId,
    entry.path,
    entry.target,
    entry.node,
    entry.nodeId,
    entry.from,
    entry.to,
  ];
  return sortedUniqueStrings(candidates.flatMap((value) => {
    if (typeof value === 'string') {
      return [value];
    }
    if (isRecord(value)) {
      return [value.id, value.fileId, value.path, value.name]
        .filter((candidate) => typeof candidate === 'string');
    }
    return [];
  }));
}
