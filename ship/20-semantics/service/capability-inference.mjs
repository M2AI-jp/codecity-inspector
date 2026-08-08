import {
  CAPABILITY_NAMES,
} from '../configuration/semantic-config.mjs';
import {
  CAPABILITY_SIGNALS,
} from '../data/role-rules.mjs';
import {
  readGraph,
  readManifests,
} from '../data/inspection-access.mjs';
import {
  sortedUniqueStrings,
} from '../interface/canonical.mjs';

export function buildCapabilities(inspection, semanticFiles, connections) {
  const graph = readGraph(inspection);
  const manifests = readManifests(inspection);
  const result = {};
  for (const capability of CAPABILITY_NAMES) {
    const inferred = inferCapability(capability, semanticFiles, connections, graph, manifests);
    result[capability] = inferred.length > 0
      ? { state: 'inferred', evidence: sortedUniqueStrings(inferred) }
      : { state: 'unknown', evidence: [`capability.${capability}.unknown`] };
  }
  return result;
}

function inferCapability(capability, files, connections, graph, manifests) {
  const evidence = [];
  const role = (name) => files.filter((file) => file.role === name);
  const paths = files.map((file) => file.path.toLowerCase());
  const signal = (name) => {
    if (paths.some((path) => hasToken(path, name))) {
      evidence.push(`capability.${capability}.path.${name}`);
    }
  };

  switch (capability) {
    case 'entrypoint':
      if (graph.entrypoints.length > 0) {
        evidence.push('capability.entrypoint.graph.entrypoints');
      }
      if (paths.some((path) => /(^|[/\\])(?:main|index|entry|server|app)\.[^/\\]+$/u.test(path))) {
        evidence.push('capability.entrypoint.path.conventional');
      }
      break;
    case 'persistence':
      if (role('data').length > 0) {
        evidence.push('capability.persistence.file.role.data');
      }
      for (const token of CAPABILITY_SIGNALS.persistence) {
        signal(token);
      }
      break;
    case 'configuration':
      if (role('configuration').length > 0) {
        evidence.push('capability.configuration.file.role.configuration');
      }
      if (files.some((file) => file.path.toLowerCase().endsWith('.env')
          || file.path.toLowerCase().includes('/config/')) || manifests.length > 0) {
        evidence.push('capability.configuration.metadata');
      }
      break;
    case 'build':
      if (role('tooling').length > 0) {
        evidence.push('capability.build.file.role.tooling');
      }
      if (manifests.some((manifest) => hasBuildMetadata(manifest))) {
        evidence.push('capability.build.manifest');
      }
      for (const path of paths) {
        if (/(^|[/\\])(?:makefile|dockerfile|build\.gradle|pom\.xml|cargo\.toml|go\.mod)$/iu.test(path)
            || /(?:vite|webpack|rollup|tsconfig|babel)\.config\./u.test(path)) {
          evidence.push('capability.build.path.toolchain');
          break;
        }
      }
      break;
    case 'test':
      if (role('test').length > 0) {
        evidence.push('capability.test.file.role.test');
      }
      break;
    case 'observability':
    case 'recovery':
    case 'distribution':
      for (const token of CAPABILITY_SIGNALS[capability]) {
        signal(token);
      }
      break;
    case 'externalConnections':
      if (connections.some((connection) => connection.kind !== 'unknown' || connection.direction !== 'internal')) {
        evidence.push('capability.externalConnections.graph');
      }
      if (connections.some((connection) => connection.kind === 'external-api'
          || connection.kind === 'http'
          || connection.kind === 'webhook'
          || connection.kind === 'llm')) {
        evidence.push('capability.externalConnections.graph.external-kind');
      }
      break;
    default:
      break;
  }
  return sortedUniqueStrings(evidence);
}

function hasBuildMetadata(manifest) {
  return typeof manifest?.scripts === 'object'
    && manifest.scripts !== null
    && Object.keys(manifest.scripts).some((key) => /build|compile|bundle/iu.test(key));
}

function hasToken(value, token) {
  if (typeof value !== 'string') {
    return false;
  }
  const normalizedValue = value.toLowerCase();
  const normalizedToken = token.toLowerCase();
  if (normalizedValue === normalizedToken) {
    return true;
  }
  return normalizedValue.split(/[^a-z0-9]+/u).filter(Boolean).includes(normalizedToken)
    || normalizedValue.includes(normalizedToken);
}
