import {
  ROLES,
} from '../configuration/semantic-config.mjs';
import {
  ROLE_SIGNAL_RULES,
} from '../data/role-rules.mjs';
import {
  basename,
  pathSegments,
} from '../data/inspection-access.mjs';
import {
  emptyEvidence,
  sortedUniqueStrings,
} from '../interface/canonical.mjs';

const ROLE_ORDER = new Map(ROLES.map((role, index) => [role, index]));
const DOCUMENTATION_EXTENSIONS = new Set(['.adoc', '.md', '.mdx', '.rst', '.txt']);
const DOCUMENTATION_DIRECTORIES = new Set(['doc', 'docs', 'documentation']);
const TEST_MARKER_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.cjs', '.css', '.cts', '.go', '.h', '.hpp', '.html', '.java',
  '.js', '.jsx', '.kt', '.mjs', '.mts', '.php', '.py', '.rb', '.rs', '.sh', '.sql', '.swift',
  '.ts', '.tsx', '.vue', '.xml',
]);

export function inferFileRole(file) {
  const evidence = emptyEvidence();
  const scores = new Map();

  const kind = typeof file?.kind === 'string' ? file.kind.toLowerCase() : '';
  const parts = responsibilitySegments(file?.path);
  const directoryPath = pathSegments(file?.path).slice(0, -1).join('/');
  const directoryParts = responsibilitySegments(directoryPath);
  const dataDirectory = directoryParts.some((part) => ROLE_SIGNAL_RULES.data.segments.includes(part));
  const name = basename(file?.path);
  const extension = typeof file?.extension === 'string'
    ? file.extension.toLowerCase()
    : (name.match(/\.[^.]+$/u)?.[0] ?? '').toLowerCase();
  const documentationDirectory = directoryParts.some((part) => DOCUMENTATION_DIRECTORIES.has(part));
  const documentationFile = kind === 'documentation'
    || DOCUMENTATION_EXTENSIONS.has(extension)
    || name === 'readme'
    || name.startsWith('readme.');
  const testMarker = TEST_MARKER_EXTENSIONS.has(extension)
    && ROLE_SIGNAL_RULES.test.names.some((token) => matchesNameSignal(name, token));
  // Documentation extensions/kinds take precedence over basename test/spec
  // markers. Only an actual test/spec directory makes documentation a test
  // artifact; a prose path such as docs/test-plan remains documentation.
  const rawDirectorySegments = pathSegments(directoryPath);
  const sourceTestDirectory = rawDirectorySegments.some((part) => [
    'test', 'tests', '__test__', '__tests__', 'spec', 'specs',
    '__snapshots__', 'fixtures', '__fixtures__',
  ].includes(part.toLowerCase())
    || (!documentationDirectory && rawDirectorySegments.some((part) => part
      .split(/[^a-z0-9]+/u)
      .filter(Boolean)
      .some((token) => ['test', 'tests', 'spec', 'specs'].includes(token)))));
  const documentationOnly = (documentationDirectory || documentationFile) && !sourceTestDirectory;

  if (file?.isTest === true && !documentationOnly) {
    addSignal(scores, 'test', 4, 'role.signal.test.file-flag');
  }

  const kindRole = kind === 'configuration'
    ? 'configuration'
    : kind === 'asset' || kind === 'static'
      ? 'data'
      : kind === 'test'
        ? 'test'
        : null;
  if (kindRole !== null && !documentationOnly) {
    addSignal(scores, kindRole, ['test', 'data'].includes(kindRole) ? 5 : 2, `role.signal.kind.${kindRole}`);
  }

  // A test tree remains a test tree even when its fixture/configuration files
  // also happen to match data or configuration lexical signals.
  if (!documentationOnly && (sourceTestDirectory || testMarker)) {
    addSignal(scores, 'test', 6, 'role.signal.test.path-marker');
  }

  for (const role of ROLES.filter((candidate) => candidate !== 'module')) {
    if (documentationOnly) continue;
    // A generic config-looking filename under an explicitly data-oriented
    // directory remains data; the directory responsibility outranks the
    // basename's conventional `config.*` spelling.
    if (role === 'configuration' && dataDirectory) continue;
    const rules = ROLE_SIGNAL_RULES[role];
    if (rules === undefined) {
      continue;
    }
    // Test directory/name signals are applied only at their corresponding
    // boundary. A basename like openapi.spec.json is metadata, not a test
    // implementation; actual test/spec directories remain test artifacts.
    if (role === 'test' && !sourceTestDirectory && !testMarker) continue;
    for (const segment of rules.segments) {
      if (parts.includes(segment)) {
        addSignal(scores, role, 3, `role.signal.${role}.segment.${segment}`);
      }
    }
    for (const token of rules.names) {
      if (matchesNameSignal(name, token)) {
        addSignal(scores, role, 2, `role.signal.${role}.name.${token}`);
      }
    }
    for (const candidateExtension of rules.extensions) {
      if (extension === candidateExtension || name.endsWith(candidateExtension)) {
        addSignal(scores, role, 1, `role.signal.${role}.extension.${candidateExtension.slice(1)}`);
      }
    }
  }

  if (scores.size === 0) {
    evidence.unknown.push('role.unknown.no-signal');
    return { role: 'module', evidence };
  }

  const highestScore = Math.max(...[...scores.values()].map((value) => value.score));
  const highest = [...scores.entries()]
    .filter(([, value]) => value.score === highestScore)
    .sort(([left], [right]) => (ROLE_ORDER.get(left) ?? 99) - (ROLE_ORDER.get(right) ?? 99));

  if (highest.length !== 1) {
    const ambiguousRoles = highest.map(([role]) => role).sort();
    evidence.unknown.push(`role.ambiguous.${ambiguousRoles.join('+')}`);
    return { role: 'module', evidence };
  }

  const [role, signal] = highest[0];
  evidence.inferred.push(...signal.keys);
  evidence.inferred = sortedUniqueStrings(evidence.inferred);
  return { role, evidence };
}

function addSignal(scores, role, score, key) {
  const current = scores.get(role) ?? { score: 0, keys: [] };
  current.score += score;
  current.keys.push(key);
  // A path may match the same rule more than once; repeated evidence should
  // increase confidence only once per distinct machine key.
  current.keys = sortedUniqueStrings(current.keys);
  scores.set(role, current);
}

/**
 * Keep directory markers exact while making punctuation-separated names
 * useful responsibility boundaries.  Dot-prefixed directories (for example
 * `.github` and `.husky`) remain exact markers; splitting them would make a
 * hidden marker such as `.github-actions` look like the real `.github` tree.
 */
function responsibilitySegments(path) {
  const segments = pathSegments(path);
  const result = [];
  for (const segment of segments) {
    result.push(segment);
    if (segment.startsWith('.')) continue;
    result.push(...segment.split(/[^a-z0-9]+/u).filter(Boolean));
  }
  return [...new Set(result)];
}

/**
 * Name rules describe complete lexical units, not arbitrary substrings.  A
 * punctuation-separated rule (for example `vite.config` or `.test.`) is
 * matched as an exact contiguous token sequence in the basename.  This
 * preserves useful conventional names while avoiding false positives such as
 * `rediscovery` matching a `redis` signal.
 */
function matchesNameSignal(name, signal) {
  if (typeof name !== 'string' || typeof signal !== 'string' || name.length === 0 || signal.length === 0) {
    return false;
  }
  if (name === signal) return true;
  const nameTokens = lexicalTokens(name);
  const signalTokens = lexicalTokens(signal);
  if (nameTokens.length === 0 || signalTokens.length === 0 || signalTokens.length > nameTokens.length) {
    return false;
  }
  for (let start = 0; start <= nameTokens.length - signalTokens.length; start += 1) {
    if (signalTokens.every((token, offset) => token === nameTokens[start + offset])) return true;
  }
  return false;
}

function lexicalTokens(value) {
  return value.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
}
