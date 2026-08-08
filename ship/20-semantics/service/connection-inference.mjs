import {
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
  mergeEvidence,
  sortByStrings,
  sortedUniqueStrings,
} from '../interface/canonical.mjs';

const KIND_SET = new Set(CONNECTION_KINDS);

export function buildConnections(inspection, semanticFiles) {
  const graph = readGraph(inspection);
  const filesById = new Map(semanticFiles.map((file) => [file.fileId, file]));
  const nodes = indexNodes(graph.nodes, filesById);
  const evidenceRecords = readEvidenceRecords(inspection);
  const connections = [];

  for (const edge of graph.edges) {
    const parsed = parseEdge(edge, nodes);
    const edgeKey = `connection.graph.edge.${parsed.edgeId}`;
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
  const target = endpointTarget(targetNode);

  const sourceFileIds = sortedUniqueStrings([
    ...(source?.fileId === null || source?.fileId === undefined ? [] : [source.fileId]),
    ...(targetNode?.fileId === null || targetNode?.fileId === undefined ? [] : [targetNode.fileId]),
  ]);
  const kind = classifyKind(edge, source, targetNode, target);
  const direction = classifyDirection(source, targetNode, kind);

  return {
    edgeId,
    direction,
    kind,
    target,
    sourceFileIds,
  };
}

function endpointTarget(endpoint) {
  if (endpoint?.target !== null && endpoint?.target !== undefined) {
    return endpoint.target;
  }
  if (endpoint?.path !== null && endpoint?.path !== undefined) {
    return endpoint.path;
  }
  return endpoint?.id ?? null;
}

function classifyKind(edge, source, target, targetValue) {
  const candidates = [
    typeof edge.kind === 'string' ? edge.kind : null,
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

function classifyDirection(source, target, kind) {
  if (source?.external === true && target?.external !== true) {
    return 'inbound';
  }
  if (target?.external === true || EXTERNAL_EDGE_KINDS.has(kind)) {
    return 'outbound';
  }
  return 'internal';
}

function mergeConnections(left, right) {
  return {
    ...left,
    sourceFileIds: sortedUniqueStrings([...left.sourceFileIds, ...right.sourceFileIds]),
    evidence: mergeEvidence(left.evidence, right.evidence),
  };
}
