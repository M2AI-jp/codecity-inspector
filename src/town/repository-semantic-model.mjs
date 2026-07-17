import { deepFreeze } from './schema.mjs';

export const REPOSITORY_SEMANTIC_MODEL_VERSION = 1;
export const REPOSITORY_SEMANTIC_ROLES = deepFreeze([
  'service', 'interface', 'data', 'configuration', 'test', 'tooling', 'module'
]);

const ROLE_SET = new Set(REPOSITORY_SEMANTIC_ROLES);
const EVIDENCE_FIELDS = ['observed', 'inferred', 'unknown'];

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function knownFiles(inspection) {
  const byPath = new Map();
  const register = (candidate) => {
    const path = nonemptyString(candidate?.path);
    if (!path) return;
    const current = byPath.get(path) ?? {
      path,
      fileId: path,
      fileIds: [],
      kind: null,
      isTest: false
    };
    const fileId = nonemptyString(candidate?.id);
    if (fileId) {
      if (current.fileId === path) current.fileId = fileId;
      if (!current.fileIds.includes(fileId)) current.fileIds.push(fileId);
    }
    if (nonemptyString(candidate?.kind)) current.kind = candidate.kind;
    if (candidate?.isTest === true) current.isTest = true;
    byPath.set(path, current);
  };
  for (const file of arrayOf(inspection?.city?.buildings)) register(file);
  for (const node of arrayOf(inspection?.graph?.nodes)) register(node);
  return [...byPath.values()].sort((left, right) => compareStrings(left.path, right.path));
}

function heuristicRole(file) {
  const path = file.path.toLowerCase();
  const kind = file.kind?.toLowerCase() ?? '';
  if (file.isTest || /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$/.test(path)) return 'test';
  if (kind === 'service' || /(?:server|service|route|controller|endpoint)/.test(path)) return 'service';
  if (kind === 'interface' || /(?:component|view|screen|page|ui)/.test(path)) return 'interface';
  if (kind === 'data' || /(?:model|database|storage|repository|schema)/.test(path)) return 'data';
  if (kind === 'configuration' || /(?:config|settings|\.env)/.test(path)) return 'configuration';
  if (kind === 'script' || /(?:^|\/)(?:scripts?|tools?|\.github)(?:\/|$)/.test(path)) return 'tooling';
  return 'module';
}

function normalizedEvidence(value, path) {
  if (value !== undefined && !isPlainObject(value)) {
    throw new TypeError(`${path}.evidence must be an object.`);
  }
  const source = value ?? {};
  for (const key of Object.keys(source)) {
    if (!EVIDENCE_FIELDS.includes(key)) throw new TypeError(`${path}.evidence.${key} is not allowed.`);
  }
  const seen = new Map();
  const evidence = {};
  for (const field of EVIDENCE_FIELDS) {
    if (source[field] !== undefined && !Array.isArray(source[field])) {
      throw new TypeError(`${path}.evidence.${field} must be an array.`);
    }
    evidence[field] = [...new Set(arrayOf(source[field]).map((key, index) => {
      if (!nonemptyString(key)) throw new TypeError(`${path}.evidence.${field}[${index}] must be a nonempty string.`);
      const prior = seen.get(key);
      if (prior && prior !== field) {
        throw new TypeError(`${path}.evidence reclassifies "${key}" from ${prior} to ${field}.`);
      }
      seen.set(key, field);
      return key;
    }))].sort(compareStrings);
  }
  return evidence;
}

/**
 * Validate candidate semantic annotations against the inspected file inventory.
 * This is the provider boundary: an LLM may propose roles and evidence, never
 * files, coordinates, collision, entrances, events, or rendering behavior.
 */
export function normalizeRepositorySemanticModel({ inspection, annotations } = {}) {
  const files = knownFiles(inspection);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const byId = new Map();
  for (const file of files) {
    for (const identity of [...file.fileIds, file.fileId, file.path]) {
      const prior = byId.get(identity);
      if (prior && prior.path !== file.path) {
        throw new TypeError(`Inspection file id "${identity}" is ambiguous.`);
      }
      byId.set(identity, file);
    }
  }

  if (annotations !== undefined && !Array.isArray(annotations)) {
    throw new TypeError('semantic annotations must be an array.');
  }
  const candidateByPath = new Map();
  for (let index = 0; index < arrayOf(annotations).length; index += 1) {
    const annotation = annotations[index];
    const location = `semantic annotations[${index}]`;
    if (!isPlainObject(annotation)) throw new TypeError(`${location} must be an object.`);
    for (const key of Object.keys(annotation)) {
      if (!['fileId', 'path', 'role', 'evidence'].includes(key)) {
        throw new TypeError(`${location}.${key} is not allowed; LLM annotations cannot define placement or game behavior.`);
      }
    }
    const fileId = nonemptyString(annotation.fileId);
    const path = nonemptyString(annotation.path);
    if (!fileId && !path) throw new TypeError(`${location} needs a known fileId or path.`);
    const byFileId = fileId ? byId.get(fileId) : null;
    const byFilePath = path ? byPath.get(path) : null;
    if ((fileId && !byFileId) || (path && !byFilePath)) {
      throw new TypeError(`${location} references a file that was not present in the inspection.`);
    }
    if (byFileId && byFilePath && byFileId.path !== byFilePath.path) {
      throw new TypeError(`${location} fileId and path refer to different inspected files.`);
    }
    const file = byFileId ?? byFilePath;
    if (candidateByPath.has(file.path)) throw new TypeError(`${location} duplicates "${file.path}".`);
    if (!ROLE_SET.has(annotation.role)) throw new TypeError(`${location}.role is not supported.`);
    const evidence = normalizedEvidence(annotation.evidence, location);
    if (evidence.observed.length > 0) {
      throw new TypeError(`${location}.evidence.observed must be empty; only the inspector may assert observed facts.`);
    }
    candidateByPath.set(file.path, {
      role: annotation.role,
      evidence
    });
  }

  const normalized = files.map((file) => {
    const candidate = candidateByPath.get(file.path);
    const role = candidate?.role ?? heuristicRole(file);
    return {
      fileId: file.fileId,
      path: file.path,
      role,
      source: candidate ? 'candidate' : 'heuristic',
      evidence: candidate?.evidence ?? {
        observed: [],
        inferred: [`semantic.heuristic.${role}`],
        unknown: []
      }
    };
  });
  return deepFreeze({
    schemaVersion: REPOSITORY_SEMANTIC_MODEL_VERSION,
    files: normalized
  });
}
