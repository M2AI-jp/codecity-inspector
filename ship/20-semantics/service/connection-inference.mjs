import {
  CONNECTION_KINDS,
} from '../configuration/semantic-config.mjs';
import {
  readGraph,
} from '../data/inspection-access.mjs';
import {
  emptyEvidence,
  evidenceKey,
  mergeEvidence,
  sortByStrings,
  sortedUniqueStrings,
} from '../interface/canonical.mjs';

import {
  builtinModules,
} from 'node:module';

const KIND_SET = new Set(CONNECTION_KINDS);
const NODE_BUILTIN_SET = new Set(builtinModules);
const LLM_PACKAGE_ROOTS = new Set([
  'openai',
  'anthropic',
  '@anthropic-ai/sdk',
]);
const STORAGE_PACKAGE_ROOTS = new Set([
  '@prisma/client',
  'mongodb',
  'redis',
  'ioredis',
  'pg',
  'postgres',
  'mysql',
  'mysql2',
  'sqlite3',
  'better-sqlite3',
  'sequelize',
  'typeorm',
  'drizzle-orm',
]);

export function buildConnections(inspection, semanticFiles) {
  const graph = readGraph(inspection);
  const filesById = new Map(semanticFiles.map((file) => [file.fileId, file]));
  const nodes = indexNodes(graph.nodes, filesById);
  const evidenceRecords = readExactEvidenceRecords(inspection);
  const connections = [];

  for (const edge of graph.edges) {
    const parsed = parseEdge(edge, nodes);
    const edgeKey = `connection.graph.edge.${parsed.edgeId}`;
    const evidence = emptyEvidence();
    evidence.inferred.push(edgeKey);
    const evidenceSubjects = new Set([parsed.edgeId, ...parsed.externalEndpointIds]);
    for (const record of evidenceRecords) {
      if (evidenceSubjects.has(record.subject)) {
        evidence[record.state].push(record.key);
      }
    }
    const normalizedEvidence = mergeEvidence(evidence);
    const id = parsed.edgeId;
    connections.push({
      id,
      direction: parsed.direction,
      kind: parsed.kind,
      target: parsed.target,
      sourceFileIds: parsed.sourceFileIds,
      evidence: normalizedEvidence,
    });
  }

  const deduplicated = new Map();
  for (const connection of connections) {
    const existing = deduplicated.get(connection.id);
    if (existing === undefined) {
      deduplicated.set(connection.id, connection);
      continue;
    }
    deduplicated.set(connection.id, mergeConnections(existing, connection));
  }
  return sortByStrings([...deduplicated.values()], (connection) => [
    connection.id,
    connection.direction,
    connection.kind,
    connection.target,
  ]);
}

function readExactEvidenceRecords(inspection) {
  const source = inspection?.evidence;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return [];
  }
  const records = [];
  for (const state of ['observed', 'inferred', 'unknown']) {
    const entries = Array.isArray(source[state]) ? source[state] : [];
    for (const entry of entries) {
      const key = evidenceKey(entry);
      const subject = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        && typeof entry.subject === 'string' && entry.subject.length > 0
        ? entry.subject
        : null;
      if (key === null || subject === null) continue;
      records.push({ state, key, subject });
    }
  }
  return sortByStrings(records, (record) => [record.state, record.key, record.subject]);
}

function indexNodes(rawNodes, filesById) {
  const nodes = new Map();
  for (const raw of rawNodes) {
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
    if (id === null) {
      continue;
    }
    const file = filesById.get(id);
    const node = {
      id,
      path: typeof raw.path === 'string' ? raw.path : file?.path ?? null,
      fileId: file?.fileId ?? null,
      topology: endpointTopology(raw, file),
      external: raw.kind === 'external',
      target: typeof raw.specifier === 'string' ? raw.specifier : null,
      kind: typeof raw.kind === 'string' ? raw.kind : null,
    };
    nodes.set(node.id, node);
  }
  return nodes;
}

function parseEdge(edge, nodes) {
  const edgeId = edge.id;
  const source = nodes.get(edge.from);
  const targetNode = nodes.get(edge.to);
  const targetEndpoint = source?.topology === 'external'
    ? source
    : targetNode?.topology === 'external'
      ? targetNode
      : targetNode;
  const externalEndpointIds = sortedUniqueStrings([source, targetNode]
    .filter((endpoint) => endpoint?.topology === 'external')
    .map((endpoint) => endpoint.id));

  const sourceFileIds = sortedUniqueStrings([
    ...(source?.fileId === null || source?.fileId === undefined ? [] : [source.fileId]),
    ...(targetNode?.fileId === null || targetNode?.fileId === undefined ? [] : [targetNode.fileId]),
  ]);
  const kind = classifyKind(edge, source, targetNode);
  const target = endpointTarget(targetEndpoint, kind);
  const direction = classifyDirection(source, targetNode);

  return {
    edgeId,
    direction,
    kind,
    target,
    sourceFileIds,
    externalEndpointIds,
  };
}

function endpointTarget(endpoint, kind) {
  const rawTarget = endpoint?.target !== null && endpoint?.target !== undefined
    ? endpoint.target
    : endpoint?.path !== null && endpoint?.path !== undefined
      ? endpoint.path
      : endpoint?.id ?? null;
  if (typeof rawTarget !== 'string' || endpoint?.topology !== 'external') {
    return rawTarget;
  }
  // A package import and its manifest declaration describe the same external
  // resident when they resolve to a known package. Keep URL paths intact and
  // leave unknown packages untouched: neither case proves package identity.
  if (/^https?:\/\//iu.test(rawTarget)) return rawTarget;
  const root = packageRootOf(rawTarget);
  const knownPackage = kind === 'llm'
    ? LLM_PACKAGE_ROOTS.has(root)
    : kind === 'storage'
      ? STORAGE_PACKAGE_ROOTS.has(root)
      : false;
  return knownPackage ? root : rawTarget;
}

function classifyKind(edge, source, target) {
  const explicitKind = normalizeDeclaredConnectionKind(edge.kind);
  if (explicitKind !== null) {
    return explicitKind;
  }

  if (source?.topology !== 'external' && target?.topology !== 'external') {
    return 'unknown';
  }

  // The node kind marks a repository boundary, not an API or runtime call.
  const candidates = [
    source?.topology === 'external' ? source.target : null,
    target?.topology === 'external' ? target.target : null,
    typeof edge.specifier === 'string' ? edge.specifier : null,
  ].filter((value) => typeof value === 'string');
  for (const candidate of candidates) {
    const kind = inferConnectionKind(candidate);
    if (kind !== null) {
      return kind;
    }
  }
  return 'unknown';
}

function endpointTopology(raw, file) {
  if (raw?.kind === 'external') {
    return 'external';
  }
  if (raw?.kind === 'file' || raw?.kind === 'manifest' || raw?.kind === 'internal'
      || file !== undefined) {
    return 'internal';
  }
  return 'unknown';
}

function normalizeDeclaredConnectionKind(candidate) {
  if (typeof candidate !== 'string') {
    return null;
  }
  const normalized = candidate.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  if (KIND_SET.has(normalized)) {
    return normalized;
  }
  if (normalized === 'api' || normalized === 'rest' || normalized === 'graphql' || normalized === 'rpc'
      || normalized === 'http-api' || normalized === 'https') {
    return 'http';
  }
  return null;
}

function inferConnectionKind(candidate) {
  const value = candidate.trim();
  if (value.length === 0 || value.startsWith('node:') || NODE_BUILTIN_SET.has(value)) {
    return null;
  }

  // URLs are transport evidence even when their path contains storage or
  // model vocabulary (for example, https://service/database-docs).
  if (/^https?:\/\//iu.test(value)) {
    return 'http';
  }

  const packageRoot = packageRootOf(value);
  if (LLM_PACKAGE_ROOTS.has(packageRoot)) {
    return 'llm';
  }
  if (STORAGE_PACKAGE_ROOTS.has(packageRoot)) {
    return 'storage';
  }
  return null;
}

function packageRootOf(specifier) {
  const normalized = specifier.toLowerCase();
  if (normalized.startsWith('@')) {
    const parts = normalized.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : normalized;
  }
  return normalized.split('/')[0];
}

function classifyDirection(source, target) {
  if (source?.topology === 'external' && target?.topology === 'internal') {
    return 'inbound';
  }
  if (source?.topology === 'internal' && target?.topology === 'external') {
    return 'outbound';
  }
  if (source?.topology === 'internal' && target?.topology === 'internal') {
    return 'internal';
  }
  return 'unknown';
}

function mergeConnections(left, right) {
  return {
    ...left,
    sourceFileIds: sortedUniqueStrings([...left.sourceFileIds, ...right.sourceFileIds]),
    evidence: mergeEvidence(left.evidence, right.evidence),
  };
}
