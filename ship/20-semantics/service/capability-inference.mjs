import {
  CAPABILITY_NAMES,
  CONNECTION_KINDS,
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

const CONNECTION_KIND_SET = new Set(CONNECTION_KINDS);
const BUILD_TOOLCHAIN_PATH_SIGNALS = Object.freeze([
  'makefile',
  'dockerfile',
  'build.gradle',
  'pom.xml',
  'cargo.toml',
  'go.mod',
  'vite.config',
  'webpack.config',
  'rollup.config',
  'tsconfig',
  'babel.config',
]);
const BUILD_SCRIPT_NAMES = Object.freeze(new Set([
  'build', 'compile', 'bundle',
  'prebuild', 'postbuild', 'precompile', 'postcompile', 'prebundle', 'postbundle',
]));
const REFERENCE_PATH_SEGMENTS = Object.freeze(new Set([
  'doc', 'docs', 'documentation', 'document',
  'reference', 'references', 'asset', 'assets', 'art',
  'static', 'image', 'images', 'media', 'public',
]));
const REFERENCE_MATERIAL_EXTENSIONS = Object.freeze(new Set([
  '.adoc', '.md', '.mdx', '.rst', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif', '.bmp',
]));

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
  const paths = files
    .filter((file) => !isReferenceMaterialPath(file.path))
    .map((file) => file.path.toLowerCase());
  const configurationPaths = files
    .filter((file) => file.role !== 'data' && !isDataPath(file.path) && !isReferenceMaterialPath(file.path))
    .map((file) => file.path.toLowerCase());
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
      break;
    case 'persistence':
      if (connections.some((connection) => connection?.kind === 'storage')) {
        evidence.push('capability.persistence.connection.storage');
      }
      for (const token of CAPABILITY_SIGNALS.persistence) {
        signal(token);
      }
      break;
    case 'configuration':
      if (role('configuration').length > 0) {
        evidence.push('capability.configuration.file.role.configuration');
      }
      if (configurationPaths.some((path) => path.endsWith('.env') || hasToken(path, 'config')) || manifests.length > 0) {
        evidence.push('capability.configuration.metadata');
      }
      break;
    case 'build':
      if (manifests.some((manifest) => hasBuildMetadata(manifest))) {
        evidence.push('capability.build.manifest');
      }
      if (paths.some((path) => BUILD_TOOLCHAIN_PATH_SIGNALS.some((token) => hasToken(path, token)))) {
        evidence.push('capability.build.path.toolchain');
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
      if (connections.some((connection) => isBoundaryDirection(connection.direction)
          && isKnownConnectionKind(connection.kind))) {
        evidence.push('capability.externalConnections.graph');
      }
      break;
    default:
      break;
  }
  return sortedUniqueStrings(evidence);
}

function isBoundaryDirection(direction) {
  return direction === 'inbound' || direction === 'outbound';
}

function isKnownConnectionKind(kind) {
  return typeof kind === 'string' && kind !== 'unknown' && CONNECTION_KIND_SET.has(kind);
}

function hasBuildMetadata(manifest) {
  return typeof manifest?.scripts === 'object'
    && manifest.scripts !== null
    && Object.keys(manifest.scripts).some((key) => String(key).toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter(Boolean)
      .some((token) => BUILD_SCRIPT_NAMES.has(token)));
}

function isReferenceMaterialPath(path) {
  const segments = typeof path === 'string'
    ? path.toLowerCase().split(/[\\/]+/u).filter(Boolean)
    : [];
  const basename = segments.at(-1) ?? '';
  const extension = basename.match(/\.[^.]+$/u)?.[0] ?? '';
  if (REFERENCE_MATERIAL_EXTENSIONS.has(extension)) return true;
  const directories = segments.slice(0, -1);
  return directories.some((segment) => segment
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
    .some((token) => REFERENCE_PATH_SEGMENTS.has(token)));
}

function isDataPath(path) {
  const dataSegments = new Set([
    'data', 'datasets', 'fixtures', 'seeds', 'migrations', 'schema', 'schemas',
    'sql', 'storage', 'art', 'asset', 'assets', 'reference', 'references',
    'static', 'image', 'images',
  ]);
  const segments = typeof path === 'string'
    ? path.toLowerCase().split(/[\\/]+/u).filter(Boolean)
    : [];
  return segments.slice(0, -1).some((segment) => segment
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
    .some((token) => dataSegments.has(token)));
}

function hasToken(value, token) {
  if (typeof value !== 'string') {
    return false;
  }
  const signalValue = String(token).toLowerCase();
  if (signalValue.startsWith('.')) {
    return value.toLowerCase().split(/[\\/]+/u).filter(Boolean).includes(signalValue);
  }
  const valueTokens = value.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
  const signalTokens = signalValue.split(/[^a-z0-9]+/u).filter(Boolean);
  if (signalTokens.length === 0 || signalTokens.length > valueTokens.length) return false;
  return valueTokens.some((_, start) => signalTokens.every((signal, offset) => valueTokens[start + offset] === signal));
}
