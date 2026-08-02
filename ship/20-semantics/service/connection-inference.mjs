import {
  CONNECTION_DIRECTIONS,
  CONNECTION_KINDS,
} from '../configuration/semantic-config.mjs';
import {
  EXTERNAL_EDGE_KINDS,
} from '../data/role-rules.mjs';
import {
  readEvidenceRecords,
  readGraph,
} from '../data/inspection-access.mjs';
import {
  emptyEvidence,
  evidenceKey,
  isRecord,
  mergeEvidence,
  sortByStrings,
  sortedUniqueStrings,
} from '../interface/canonical.mjs';

const DIRECTION_SET = new Set(CONNECTION_DIRECTIONS);
const KIND_SET = new Set(CONNECTION_KINDS);

export function buildConnections(inspection, semanticFiles) {
  const graph = readGraph(inspection);
  const filesById = new Map(semanticFiles.map((file) => [file.fileId, file]));
  const filesByPath = new Map(semanticFiles.map((file) => [file.path, file]));
  const nodes = indexNodes(graph.nodes, filesById, filesByPath);
  const evidenceRecords = readEvidenceRecords(inspection);
  const connections = [];

  for (const edge of graph.edges) {
    const parsed = parseEdge(edge, nodes, filesById, filesByPath);
    if (parsed === null) {
      continue;
    }
    const edgeKey = parsed.edgeId === null
      ? `connection.graph.edge.${parsed.direction}.${parsed.kind}.${parsed.target}`
      : `connection.graph.edge.${parsed.edgeId}`;
    const evidence = emptyEvidence();
    evidence.inferred.push(edgeKey);
    for (const record of evidenceRecords) {
      if (record.subjects.includes(parsed.edgeId)
          || record.subjects.includes(parsed.target)
          || parsed.sourceFileIds.some((fileId) => {
            const file = filesById.get(fileId);
            return record.subjects.includes(fileId) || record.subjects.includes(file?.path);
          })) {
        evidence[record.state].push(record.key);
      }
    }
    const normalizedEvidence = mergeEvidence(evidence);
    const id = parsed.edgeId ?? generatedConnectionId(parsed);
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

function indexNodes(rawNodes, filesById, filesByPath) {
  const nodes = new Map();
  for (const raw of rawNodes) {
    const id = firstString(raw, ['id', 'nodeId', 'fileId']);
    const path = firstString(raw, ['path', 'relativePath']);
    if (id === null && path === null) {
      continue;
    }
    const file = (id !== null ? filesById.get(id) : undefined)
      ?? (path !== null ? filesByPath.get(path) : undefined);
    const node = {
      id: id ?? path,
      path: path ?? file?.path ?? null,
      fileId: file?.fileId ?? (id !== null && filesById.has(id) ? id : null),
      external: isExternalNode(raw),
      target: firstString(raw, ['specifier', 'url', 'target', 'name', 'package']),
      kind: firstString(raw, ['kind', 'type']),
    };
    nodes.set(node.id, node);
    if (path !== null && !nodes.has(path)) {
      nodes.set(path, node);
    }
  }
  return nodes;
}

function parseEdge(edge, nodes, filesById, filesByPath) {
  const edgeId = firstString(edge, ['id', 'edgeId', 'connectionId']);
  const sourceValue = firstValue(edge, ['from', 'source', 'sourceId', 'sourceFileId']);
  const targetValue = firstValue(edge, ['to', 'target', 'targetId', 'targetFileId']);
  const source = resolveEndpoint(sourceValue, nodes, filesById, filesByPath);
  const targetNode = resolveEndpoint(targetValue, nodes, filesById, filesByPath);
  const target = endpointTarget(targetNode, targetValue);
  if (target === null) {
    return null;
  }

  const sourceFileIds = sortedUniqueStrings([
    ...(source?.fileId === null || source?.fileId === undefined ? [] : [source.fileId]),
    ...(targetNode?.fileId === null || targetNode?.fileId === undefined ? [] : [targetNode.fileId]),
    ...extractFileIds(edge, filesById, filesByPath),
  ]);
  const kind = classifyKind(edge, source, targetNode, target);
  const direction = classifyDirection(edge, source, targetNode, sourceFileIds, kind);

  return {
    edgeId,
    direction,
    kind,
    target,
    sourceFileIds,
  };
}

function resolveEndpoint(value, nodes, filesById, filesByPath) {
  if (isRecord(value)) {
    const id = firstString(value, ['id', 'nodeId', 'fileId']);
    const path = firstString(value, ['path', 'relativePath']);
    return resolveEndpoint(id ?? path, nodes, filesById, filesByPath)
      ?? {
        id: id ?? path,
        path,
        fileId: id !== null && filesById.has(id) ? id : path !== null && filesByPath.has(path)
          ? filesByPath.get(path).fileId
          : null,
        external: isExternalNode(value),
        target: firstString(value, ['specifier', 'url', 'target', 'name', 'package']),
        kind: firstString(value, ['kind', 'type']),
      };
  }
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return nodes.get(value)
    ?? (filesById.has(value)
      ? { id: value, path: filesById.get(value).path, fileId: value, external: false, target: null, kind: null }
      : filesByPath.has(value)
        ? { id: value, path: value, fileId: filesByPath.get(value).fileId, external: false, target: null, kind: null }
        : {
          id: value,
          path: null,
          fileId: null,
          external: looksExternal(value),
          target: value,
          kind: null,
        });
}

function endpointTarget(endpoint, original) {
  if (endpoint?.target !== null && endpoint?.target !== undefined) {
    return endpoint.target;
  }
  if (endpoint?.path !== null && endpoint?.path !== undefined) {
    return endpoint.path;
  }
  if (typeof original === 'string' && original.length > 0) {
    return original;
  }
  return endpoint?.id ?? null;
}

function classifyKind(edge, source, target, targetValue) {
  const candidates = [
    firstString(edge, ['kind', 'type', 'protocol', 'category']),
    source?.kind,
    target?.kind,
    target?.target,
    typeof targetValue === 'string' ? targetValue : null,
  ].filter((value) => typeof value === 'string');
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
    if (KIND_SET.has(normalized)) {
      return normalized;
    }
    if (normalized === 'api' || normalized === 'rest' || normalized === 'graphql' || normalized === 'rpc'
        || normalized === 'http-api' || normalized === 'https') {
      return 'http';
    }
    if (normalized.includes('webhook')) {
      return 'webhook';
    }
    if (normalized.includes('llm') || normalized.includes('openai') || normalized.includes('anthropic')
        || normalized.includes('model')) {
      return 'llm';
    }
    if (normalized.includes('database') || normalized.includes('storage') || normalized.includes('redis')
        || normalized.includes('postgres') || normalized.includes('mysql') || normalized.endsWith('.db')) {
      return 'storage';
    }
    if (normalized.includes('external')) {
      return 'external-api';
    }
    if (normalized.includes('http://') || normalized.includes('https://')) {
      return 'http';
    }
  }
  return 'unknown';
}

function classifyDirection(edge, source, target, sourceFileIds, kind) {
  const explicit = firstString(edge, ['direction', 'flow']);
  if (explicit !== null) {
    const normalized = explicit.toLowerCase();
    if (DIRECTION_SET.has(normalized)) {
      return normalized;
    }
  }
  if (source?.external === true && target?.external !== true) {
    return 'inbound';
  }
  if (target?.external === true || EXTERNAL_EDGE_KINDS.has(kind)) {
    return 'outbound';
  }
  if (sourceFileIds.length > 0 && target !== null) {
    return 'internal';
  }
  return 'internal';
}

function extractFileIds(edge, filesById, filesByPath) {
  const values = [];
  for (const field of ['sourceFileIds', 'fileIds', 'files']) {
    const value = edge?.[field];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      const candidate = typeof entry === 'string'
        ? entry
        : isRecord(entry) ? firstString(entry, ['fileId', 'id', 'path']) : null;
      if (candidate === null) {
        continue;
      }
      if (filesById.has(candidate)) {
        values.push(candidate);
      } else if (filesByPath.has(candidate)) {
        values.push(filesByPath.get(candidate).fileId);
      }
    }
  }
  return values;
}

function generatedConnectionId(parsed) {
  return `connection.${parsed.direction}.${parsed.kind}.${parsed.sourceFileIds.join(',')}.${parsed.target}`;
}

function mergeConnections(left, right) {
  return {
    ...left,
    sourceFileIds: sortedUniqueStrings([...left.sourceFileIds, ...right.sourceFileIds]),
    evidence: mergeEvidence(left.evidence, right.evidence),
  };
}

function firstString(record, fields) {
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function firstValue(record, fields) {
  for (const field of fields) {
    if (record !== null && record !== undefined && record[field] !== undefined && record[field] !== null) {
      return record[field];
    }
  }
  return null;
}

function stringValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isExternalNode(node) {
  const kind = firstString(node, ['kind', 'type', 'category']);
  if (kind !== null && /(external|package|dependency|remote)/iu.test(kind)) {
    return true;
  }
  const specifier = firstString(node, ['specifier', 'url', 'package']);
  return specifier !== null && looksExternal(specifier);
}

function looksExternal(value) {
  return typeof value === 'string' && (
    /^https?:\/\//iu.test(value)
    || /^wss?:\/\//iu.test(value)
    || value.startsWith('@')
    || value.includes('://')
  );
}
