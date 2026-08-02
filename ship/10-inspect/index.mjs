import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * The first wire-compatible inspection report.  Keep this number in step with
 * the repository's backend contract v1; consumers must reject an
 * unknown version instead of guessing at its meaning.
 */
export const INSPECTION_REPORT_SCHEMA_VERSION = 1;

// These addresses are the only cross-module facts that static inspection may
// publish about the inspection itself.  Completion is an observed bounded
// read; runtime behaviour remains explicitly unknown because customer code is
// never executed.
const INSPECTION_COMPLETION_EVIDENCE_ID = 'repository.inspection.completed';
const INSPECTION_RUNTIME_UNKNOWN_EVIDENCE_ID = 'repository.inspection.runtime.unknown';

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 5_000,
  maxDepth: 32,
  maxEntriesPerDirectory: 2_000,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxTextBytes: 256 * 1024,
});

// These are policy exclusions, rather than evidence that a directory is
// broken.  We still put an `unknown` evidence item in the report for every
// excluded entry because its contents were deliberately not read.
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.bzr',
  'node_modules',
  'vendor',
  'generated',
  'gen',
  'dist',
  'build',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
  '.next',
  '.nuxt',
  '.turbo',
  'out',
  'target',
]);

const MANIFEST_NAMES = new Map([
  ['package.json', { kind: 'package', format: 'json' }],
  ['package-lock.json', { kind: 'lockfile', format: 'json' }],
  ['npm-shrinkwrap.json', { kind: 'lockfile', format: 'json' }],
  ['yarn.lock', { kind: 'lockfile', format: 'text' }],
  ['pnpm-lock.yaml', { kind: 'lockfile', format: 'yaml' }],
  ['pyproject.toml', { kind: 'package', format: 'toml' }],
  ['requirements.txt', { kind: 'package', format: 'text' }],
  ['cargo.toml', { kind: 'package', format: 'toml' }],
  ['cargo.lock', { kind: 'lockfile', format: 'text' }],
  ['go.mod', { kind: 'package', format: 'text' }],
  ['go.sum', { kind: 'lockfile', format: 'text' }],
  ['composer.json', { kind: 'package', format: 'json' }],
  ['gemfile', { kind: 'package', format: 'text' }],
  ['gemfile.lock', { kind: 'lockfile', format: 'text' }],
  ['mix.exs', { kind: 'package', format: 'text' }],
]);

const LANGUAGE_BY_EXTENSION = new Map([
  ['.c', 'c'],
  ['.cc', 'cpp'],
  ['.cpp', 'cpp'],
  ['.cs', 'csharp'],
  ['.css', 'css'],
  ['.go', 'go'],
  ['.h', 'c'],
  ['.hpp', 'cpp'],
  ['.html', 'html'],
  ['.java', 'java'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.json', 'json'],
  ['.kt', 'kotlin'],
  ['.mjs', 'javascript'],
  ['.mts', 'typescript'],
  ['.php', 'php'],
  ['.py', 'python'],
  ['.rb', 'ruby'],
  ['.rs', 'rust'],
  ['.sh', 'shell'],
  ['.sql', 'sql'],
  ['.swift', 'swift'],
  ['.toml', 'toml'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.vue', 'vue'],
  ['.xml', 'xml'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
]);

const DOCUMENTATION_EXTENSIONS = new Set([
  '.adoc',
  '.md',
  '.mdx',
  '.rst',
  '.txt',
]);

const CONFIG_BASENAMES = new Set([
  '.editorconfig',
  '.env',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.prettierrc',
  '.prettierrc.json',
  'dockerfile',
  'makefile',
  'tsconfig.json',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'webpack.config.js',
  'webpack.config.cjs',
  'webpack.config.mjs',
]);

const TEXT_SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
]);

const IMPORT_PATTERNS = [
  /\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g,
  /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const SOURCE_FILE_EXTENSIONS = [
  '',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.tsx',
  '.jsx',
  '.json',
];

const NOFOLLOW = typeof fsConstants.O_NOFOLLOW === 'number'
  ? fsConstants.O_NOFOLLOW
  : 0;

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortStrings(values) {
  return [...values].sort(compareStrings);
}

function asFilePath(root) {
  if (root instanceof URL) {
    if (root.protocol !== 'file:') {
      throw new TypeError('inspectRepository root URL must use the file: scheme');
    }
    return fileURLToPath(root);
  }
  if (typeof root !== 'string' && !(root instanceof String)) {
    throw new TypeError('inspectRepository root must be a path or file URL');
  }
  const value = String(root);
  if (value.length === 0) {
    throw new TypeError('inspectRepository root must not be empty');
  }
  return value;
}

function boundedInteger(value, fallback, maximum) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(maximum, Math.floor(number)));
}

function normalizeLimits(options) {
  const input = options && typeof options === 'object' ? options : {};
  const maxFiles = boundedInteger(input.maxFiles, DEFAULT_LIMITS.maxFiles, 100_000);
  const maxDepth = boundedInteger(input.maxDepth, DEFAULT_LIMITS.maxDepth, 128);
  const maxEntriesPerDirectory = boundedInteger(
    input.maxEntriesPerDirectory ?? input.maxEntries,
    DEFAULT_LIMITS.maxEntriesPerDirectory,
    50_000,
  );
  const maxFileBytes = boundedInteger(
    input.maxFileBytes ?? input.maxBytesPerFile,
    DEFAULT_LIMITS.maxFileBytes,
    16 * 1024 * 1024,
  );
  const maxTotalBytes = boundedInteger(
    input.maxTotalBytes,
    DEFAULT_LIMITS.maxTotalBytes,
    512 * 1024 * 1024,
  );
  const maxTextBytes = boundedInteger(
    input.maxTextBytes,
    Math.min(DEFAULT_LIMITS.maxTextBytes, maxFileBytes),
    maxFileBytes,
  );
  return Object.freeze({
    maxFiles,
    maxDepth,
    maxEntriesPerDirectory,
    maxFileBytes,
    maxTotalBytes,
    maxTextBytes,
  });
}

function relativePath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (relative === '') return '.';
  return relative.split(path.sep).join('/');
}

function pathWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function basenameLower(relativePathValue) {
  return path.posix.basename(relativePathValue).toLowerCase();
}

function extensionOf(relativePathValue) {
  return path.posix.extname(path.posix.basename(relativePathValue)).toLowerCase();
}

function isTestPath(relativePathValue) {
  const segments = relativePathValue.toLowerCase().split('/');
  const basename = segments.at(-1) ?? '';
  return segments.includes('test')
    || segments.includes('tests')
    || segments.includes('__tests__')
    || /(?:^|[._-])(test|spec)(?:[._-]|$)/.test(basename);
}

function manifestInfo(relativePathValue) {
  const basename = basenameLower(relativePathValue);
  return MANIFEST_NAMES.get(basename) ?? null;
}

function classifyFile(relativePathValue) {
  const basename = basenameLower(relativePathValue);
  const extension = extensionOf(relativePathValue);
  const manifest = manifestInfo(relativePathValue);
  if (manifest) return manifest.kind === 'lockfile' ? 'lockfile' : 'manifest';
  if (isTestPath(relativePathValue)) return 'test';
  if (CONFIG_BASENAMES.has(basename) || basename.startsWith('.env.')) return 'configuration';
  if (DOCUMENTATION_EXTENSIONS.has(extension) || basename === 'readme' || basename.startsWith('readme.')) {
    return 'documentation';
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.mp3', '.wav', '.ogg', '.woff', '.woff2', '.ttf'].includes(extension)) {
    return 'asset';
  }
  if (LANGUAGE_BY_EXTENSION.has(extension)) return 'source';
  return 'unknown';
}

function languageForFile(file) {
  return LANGUAGE_BY_EXTENSION.get(file.extension) ?? null;
}

function fileId(relativePathValue) {
  return `file:${relativePathValue}`;
}

function evidenceEntry({ id, claim, subject, value, pathValue, source, state }) {
  const entry = {
    id,
    state,
    claim,
    subject,
  };
  if (pathValue !== undefined) entry.path = pathValue;
  if (value !== undefined) entry.value = value;
  if (source !== undefined) entry.source = source;
  return entry;
}

function unknownEntry({ id, claim, pathValue, reason, details }) {
  const entry = {
    id,
    state: 'unknown',
    claim,
    reason,
  };
  if (pathValue !== undefined) entry.path = pathValue;
  if (details !== undefined) entry.details = details;
  return entry;
}

function dedupeEvidence(entries) {
  const byId = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string') continue;
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => compareStrings(a.id, b.id));
}

function copyStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const key of sortStrings(Object.keys(value))) {
    if (typeof value[key] === 'string') result[key] = value[key];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function copyBin(value) {
  if (typeof value === 'string') return value;
  const map = copyStringMap(value);
  return map;
}

function packageManifest(relativePathValue, parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const result = {
    id: `manifest:${relativePathValue}`,
    path: relativePathValue,
    kind: 'package',
    format: 'json',
  };
  for (const key of ['name', 'version', 'description', 'type', 'main', 'module', 'browser']) {
    if (typeof parsed[key] === 'string') result[key] = parsed[key];
  }
  for (const key of ['scripts', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'resolutions', 'engines']) {
    const map = copyStringMap(parsed[key]);
    if (map) result[key] = map;
  }
  const bin = copyBin(parsed.bin);
  if (bin !== undefined) result.bin = bin;
  if (Array.isArray(parsed.files)) {
    const files = parsed.files.filter((value) => typeof value === 'string');
    if (files.length > 0) result.files = sortStrings(files);
  }
  return result;
}

function genericManifest(relativePathValue, info) {
  return {
    id: `manifest:${relativePathValue}`,
    path: relativePathValue,
    kind: info.kind,
    format: info.format,
  };
}

function packageDependencyEntries(manifest) {
  if (!manifest || manifest.kind !== 'package') return [];
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const result = [];
  for (const section of sections) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      result.push({ name, section, version: manifest[section][name] });
    }
  }
  return result.sort((a, b) => compareStrings(`${a.name}\u0000${a.section}`, `${b.name}\u0000${b.section}`));
}

function extractImportSpecifiers(text) {
  const result = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (typeof match[1] === 'string' && match[1].length > 0 && match[1].length <= 512) {
        result.add(match[1]);
      }
      // A zero-width match would otherwise loop forever if a future pattern is
      // changed.  Current patterns are non-empty, but this is cheap insurance.
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }
  return sortStrings(result);
}

function resolveLocalImport(fromPath, specifier, fileByPath) {
  if (!(specifier.startsWith('.') || specifier.startsWith('/'))) return null;
  const fromDirectory = path.posix.dirname(fromPath);
  const raw = specifier.startsWith('/')
    ? specifier.slice(1)
    : path.posix.normalize(path.posix.join(fromDirectory, specifier));
  if (raw === '..' || raw.startsWith('../') || raw.includes('/../')) return null;
  for (const extension of SOURCE_FILE_EXTENSIONS) {
    const candidate = extension ? `${raw}${extension}` : raw;
    if (fileByPath.has(candidate)) return fileByPath.get(candidate).id;
  }
  for (const extension of SOURCE_FILE_EXTENSIONS.slice(1)) {
    const candidate = `${raw}/index${extension}`;
    if (fileByPath.has(candidate)) return fileByPath.get(candidate).id;
  }
  return null;
}

function externalNodeId(specifier) {
  return `external:${specifier}`;
}

function unresolvedNodeId(fromPath, specifier) {
  return `unresolved:${fromPath}:${specifier}`;
}

function sourcePathFromManifest(value) {
  if (typeof value !== 'string') return [];
  return [value.replaceAll('\\', '/')];
}

function inferEntrypoints(files, manifests, fileByPath) {
  const candidates = new Map();
  const addCandidate = (candidate, source) => {
    if (typeof candidate !== 'string' || candidate.length === 0) return;
    const cleaned = candidate.replace(/^\.\//, '').replaceAll('\\', '/');
    const resolved = resolveLocalImport('.', `./${cleaned}`, fileByPath)
      ?? fileByPath.get(cleaned)?.id;
    if (resolved) candidates.set(resolved, source);
  };

  for (const manifest of manifests) {
    if (manifest.kind !== 'package') continue;
    for (const key of ['main', 'module', 'browser']) {
      for (const value of sourcePathFromManifest(manifest[key])) addCandidate(value, manifest.path);
    }
    const bin = manifest.bin;
    if (typeof bin === 'string') addCandidate(bin, manifest.path);
    else if (bin && typeof bin === 'object') {
      for (const value of Object.values(bin)) addCandidate(value, manifest.path);
    }
  }

  const commonNames = /(?:^|\/)(?:index|main|app|server|cli)(?:\.[^/]+)?$/i;
  for (const file of files) {
    if (file.kind === 'source' && commonNames.test(file.path)) {
      candidates.set(file.id, 'filename-convention');
    }
  }
  return [...candidates.keys()].sort(compareStrings);
}

function inferProjectKind(files, manifests) {
  if (manifests.some((manifest) => manifest.path === 'package.json')) return 'node-package';
  if (manifests.some((manifest) => ['pyproject.toml', 'requirements.txt'].includes(manifest.path))) return 'python-project';
  if (manifests.some((manifest) => manifest.path === 'cargo.toml')) return 'rust-project';
  if (manifests.some((manifest) => manifest.path === 'go.mod')) return 'go-module';
  if (files.some((file) => file.extension === '.java')) return 'jvm-project';
  if (files.some((file) => file.extension === '.cs')) return 'dotnet-project';
  return 'unknown';
}

function inferGitOrigin(configText) {
  let inOrigin = false;
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^\[\s*remote\s+"([^"]+)"\s*\]$/i);
    if (section) {
      inOrigin = section[1] === 'origin';
      continue;
    }
    if (/^\[/.test(line)) {
      inOrigin = false;
      continue;
    }
    if (inOrigin) {
      const match = line.match(/^url\s*=\s*(.+)$/i);
      if (match) return sanitizeOrigin(match[1].trim());
    }
  }
  return null;
}

function sanitizeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || path.isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/u.test(trimmed) || /^\.\.?[/\\]/u.test(trimmed)) return null;
  // Strip credentials before the value becomes part of a report.  SCP-like
  // git URLs (git@example.com:org/repo.git) are already credential-free.
  try {
    const parsed = new URL(trimmed);
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) return null;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    const sanitized = trimmed.replace(/^[^/@\s]+:[^/@\s]+@/, '');
    return sanitized && !/\s/u.test(sanitized) ? sanitized : null;
  }
}

function pathIsInside(canonicalRoot, candidate) {
  const relative = path.relative(canonicalRoot, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function verifiedStatInsideRoot(filePath, canonicalRoot) {
  try {
    const lexicalStat = await fs.lstat(filePath);
    const canonicalPath = await fs.realpath(filePath);
    if (!pathIsInside(canonicalRoot, canonicalPath)) return { ok: false, reason: 'path-resolved-outside-root' };
    const canonicalStat = await fs.lstat(canonicalPath);
    if (lexicalStat.dev !== canonicalStat.dev || lexicalStat.ino !== canonicalStat.ino) return { ok: false, reason: 'path-changed' };
    return { ok: true, stat: lexicalStat, canonicalPath };
  } catch (error) {
    return { ok: false, reason: error?.code || 'path-unreadable' };
  }
}

async function readBoundedFile(filePath, maxBytes, canonicalRoot) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | NOFOLLOW);
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) return { ok: false, reason: 'not-a-regular-file' };
    if (openedStat.size > maxBytes) return { ok: false, reason: 'file-byte-limit', sizeBytes: openedStat.size };
    const verified = await verifiedStatInsideRoot(filePath, canonicalRoot);
    if (!verified.ok) return verified;
    if (verified.stat.dev !== openedStat.dev || verified.stat.ino !== openedStat.ino) return { ok: false, reason: 'path-changed' };
    const chunks = [];
    let remaining = openedStat.size;
    let position = 0;
    while (remaining > 0) {
      const chunkSize = Math.min(64 * 1024, remaining);
      const buffer = Buffer.allocUnsafe(chunkSize);
      const result = await handle.read(buffer, 0, chunkSize, position);
      if (result.bytesRead <= 0) break;
      chunks.push(buffer.subarray(0, result.bytesRead));
      remaining -= result.bytesRead;
      position += result.bytesRead;
    }
    if (remaining > 0) return { ok: false, reason: 'short-read' };
    const finalStat = await handle.stat();
    if (finalStat.dev !== openedStat.dev || finalStat.ino !== openedStat.ino || finalStat.size !== openedStat.size || finalStat.mtimeMs !== openedStat.mtimeMs) {
      return { ok: false, reason: 'file-changed' };
    }
    return { ok: true, bytes: Buffer.concat(chunks), sizeBytes: openedStat.size };
  } catch (error) {
    return { ok: false, reason: error?.code || 'read-failed' };
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Closing a descriptor is best effort; the repository was never
        // written to and the original read result remains valid.
      }
    }
  }
}

async function readGitOrigin(root, limits) {
  const gitPath = path.join(root, '.git');
  try {
    const git = await verifiedStatInsideRoot(gitPath, root);
    if (!git.ok) return { origin: null, skipped: true, reason: git.reason };
    if (!git.stat.isDirectory()) return { origin: null, skipped: true, reason: 'git-metadata-not-directory' };
    const configPath = path.join(gitPath, 'config');
    const config = await verifiedStatInsideRoot(configPath, root);
    if (!config.ok) return { origin: null, skipped: true, reason: config.reason };
    if (!config.stat.isFile()) return { origin: null, skipped: true, reason: 'git-config-not-regular' };
    const read = await readBoundedFile(configPath, Math.min(limits.maxTextBytes, 64 * 1024), root);
    if (!read.ok) return { origin: null, skipped: true, reason: read.reason };
    return { origin: inferGitOrigin(read.bytes.toString('utf8')), skipped: false };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { origin: null, skipped: false };
    return { origin: null, skipped: true, reason: error?.code || 'git-read-failed' };
  }
}

function emptyReport(name, identity, unknown = []) {
  const unknownEvidence = unknown.length > 0
    ? unknown
    : [unknownEntry({
      id: 'unknown:repository-root',
      claim: 'repository.contents',
      pathValue: '.',
      reason: 'repository-root-unreadable',
    })];
  return {
    schemaVersion: INSPECTION_REPORT_SCHEMA_VERSION,
    repository: { name, identity },
    summary: { filesDiscovered: 0, filesInspected: 0, truncated: false },
    files: [],
    graph: { nodes: [], edges: [], entrypoints: [] },
    manifests: [],
    evidence: { observed: [], inferred: [], unknown: dedupeEvidence(unknownEvidence) },
  };
}

/**
 * Inspect a repository without executing anything in it.
 *
 * The function only uses lstat/readdir/open/read and bounded in-memory
 * parsing.  Symlinks below the root are never followed.  The returned object
 * is JSON serializable and contains no absolute filesystem paths.
 */
export async function inspectRepository(root, options = {}) {
  const requestedRoot = asFilePath(root);
  const limits = normalizeLimits(options);
  const absoluteRoot = path.resolve(requestedRoot);
  let realRoot;
  let rootName = path.basename(absoluteRoot) || 'repository';
  try {
    // A symlink supplied as the repository root is not an accepted repository
    // class.  Check the lexical root before realpath so the root itself is
    // never silently promoted to its target.  Symlinks below an accepted root
    // are handled by walkDirectory and remain untracked.
    const lexicalRoot = await fs.lstat(absoluteRoot);
    if (lexicalRoot.isSymbolicLink()) {
      return emptyReport(rootName, rootName, [unknownEntry({
        id: 'unknown:repository-root',
        claim: 'repository.root',
        pathValue: '.',
        reason: 'repository-root-symlink',
      })]);
    }
    if (!lexicalRoot.isDirectory()) {
      return emptyReport(rootName, rootName, [unknownEntry({
        id: 'unknown:repository-root',
        claim: 'repository.root',
        pathValue: '.',
        reason: 'repository-root-not-directory',
      })]);
    }
    realRoot = await fs.realpath(absoluteRoot);
    const rootStat = await fs.lstat(realRoot);
    if (!rootStat.isDirectory()) {
      return emptyReport(rootName, rootName, [unknownEntry({
        id: 'unknown:repository-root',
        claim: 'repository.root',
        pathValue: '.',
        reason: 'repository-root-not-directory',
      })]);
    }
    rootName = path.basename(realRoot) || rootName;
  } catch (error) {
    return emptyReport(rootName, rootName, [unknownEntry({
      id: 'unknown:repository-root',
      claim: 'repository.root',
      pathValue: '.',
      reason: error?.code || 'repository-root-unreadable',
    })]);
  }

  const observed = [];
  const inferred = [];
  const unknown = [];
  const files = [];
  const contentByPath = new Map();
  let filesDiscovered = 0;
  let bytesRead = 0;
  let truncated = false;
  const fileByPath = new Map();

  const noteUnknown = (item) => unknown.push(item);

  async function walkDirectory(directoryPath, directoryRelativePath, depth) {
    let entries;
    try {
      const before = await verifiedStatInsideRoot(directoryPath, realRoot);
      if (!before.ok || !before.stat.isDirectory()) throw Object.assign(new Error('directory changed'), { code: before.reason ?? 'directory-not-regular' });
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
      const after = await verifiedStatInsideRoot(directoryPath, realRoot);
      if (!after.ok || !after.stat.isDirectory() || after.stat.dev !== before.stat.dev || after.stat.ino !== before.stat.ino) {
        throw Object.assign(new Error('directory changed'), { code: after.reason ?? 'directory-changed' });
      }
    } catch (error) {
      noteUnknown(unknownEntry({
        id: `unknown:directory:${directoryRelativePath || '.'}`,
        claim: 'directory.contents',
        pathValue: directoryRelativePath || '.',
        reason: error?.code || 'directory-unreadable',
      }));
      return;
    }
    entries.sort((a, b) => compareStrings(a.name, b.name));
    if (entries.length > limits.maxEntriesPerDirectory) {
      truncated = true;
      noteUnknown(unknownEntry({
        id: `unknown:entries:${directoryRelativePath || '.'}`,
        claim: 'directory.contents',
        pathValue: directoryRelativePath || '.',
        reason: 'directory-entry-limit',
        details: { limit: limits.maxEntriesPerDirectory, entries: entries.length },
      }));
      entries = entries.slice(0, limits.maxEntriesPerDirectory);
    }

    for (const entry of entries) {
      const entryRelativePath = directoryRelativePath ? `${directoryRelativePath}/${entry.name}` : entry.name;
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        noteUnknown(unknownEntry({
          id: `unknown:symlink:${entryRelativePath}`,
          claim: 'path.target',
          pathValue: entryRelativePath,
          reason: 'symlink-not-followed',
        }));
        continue;
      }

      const verified = await verifiedStatInsideRoot(entryPath, realRoot);
      if (!verified.ok) {
        noteUnknown(unknownEntry({
          id: `unknown:path:${entryRelativePath}`,
          claim: 'path.metadata',
          pathValue: entryRelativePath,
          reason: verified.reason,
        }));
        continue;
      }
      const stat = verified.stat;

      if (stat.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
          noteUnknown(unknownEntry({
            id: `unknown:excluded:${entryRelativePath}`,
            claim: 'directory.contents',
            pathValue: entryRelativePath,
            reason: 'excluded-by-policy',
          }));
          continue;
        }
        if (depth >= limits.maxDepth) {
          truncated = true;
          noteUnknown(unknownEntry({
            id: `unknown:depth:${entryRelativePath}`,
            claim: 'directory.contents',
            pathValue: entryRelativePath,
            reason: 'depth-limit',
            details: { limit: limits.maxDepth },
          }));
          continue;
        }
        await walkDirectory(entryPath, entryRelativePath, depth + 1);
        continue;
      }
      if (!stat.isFile()) {
        noteUnknown(unknownEntry({
          id: `unknown:nonfile:${entryRelativePath}`,
          claim: 'path.kind',
          pathValue: entryRelativePath,
          reason: 'unsupported-filesystem-entry',
        }));
        continue;
      }
      if (filesDiscovered >= limits.maxFiles) {
        truncated = true;
        noteUnknown(unknownEntry({
          id: `unknown:file-limit:${entryRelativePath}`,
          claim: 'repository.contents',
          pathValue: entryRelativePath,
          reason: 'file-limit',
          details: { limit: limits.maxFiles },
        }));
        break;
      }

      filesDiscovered += 1;
      const extension = extensionOf(entryRelativePath);
      const kind = classifyFile(entryRelativePath);
      const file = {
        id: fileId(entryRelativePath),
        path: entryRelativePath,
        kind,
        extension,
        sizeBytes: Number.isSafeInteger(stat.size) ? stat.size : Number.MAX_SAFE_INTEGER,
        isTest: isTestPath(entryRelativePath),
      };
      files.push(file);
      fileByPath.set(entryRelativePath, file);

      observed.push(evidenceEntry({
        id: `observed:file:${entryRelativePath}`,
        state: 'observed',
        claim: 'file.exists',
        subject: file.id,
        pathValue: entryRelativePath,
        value: true,
        source: 'lstat',
      }));
      observed.push(evidenceEntry({
        id: `observed:size:${entryRelativePath}`,
        state: 'observed',
        claim: 'file.sizeBytes',
        subject: file.id,
        pathValue: entryRelativePath,
        value: file.sizeBytes,
        source: 'lstat',
      }));
      inferred.push(evidenceEntry({
        id: `inferred:kind:${entryRelativePath}`,
        state: 'inferred',
        claim: 'file.kind',
        subject: file.id,
        pathValue: entryRelativePath,
        value: kind,
        source: 'filename-and-extension',
      }));
      inferred.push(evidenceEntry({
        id: `inferred:test:${entryRelativePath}`,
        state: 'inferred',
        claim: 'file.isTest',
        subject: file.id,
        pathValue: entryRelativePath,
        value: file.isTest,
        source: 'filename-and-directory',
      }));

      const manifest = manifestInfo(entryRelativePath);
      const shouldRead = stat.size <= limits.maxFileBytes && bytesRead + stat.size <= limits.maxTotalBytes;
      if (!shouldRead) {
        const reason = stat.size > limits.maxFileBytes ? 'file-byte-limit' : 'total-byte-limit';
        if (reason === 'total-byte-limit') truncated = true;
        noteUnknown(unknownEntry({
          id: `unknown:read:${entryRelativePath}`,
          claim: 'file.contents',
          pathValue: entryRelativePath,
          reason,
          details: { sizeBytes: file.sizeBytes },
        }));
        continue;
      }

      const read = await readBoundedFile(entryPath, limits.maxFileBytes, realRoot);
      if (!read.ok) {
        noteUnknown(unknownEntry({
          id: `unknown:read:${entryRelativePath}`,
          claim: 'file.contents',
          pathValue: entryRelativePath,
          reason: read.reason,
        }));
        continue;
      }
      bytesRead += read.bytes.length;
      contentByPath.set(entryRelativePath, read.bytes);
      observed.push(evidenceEntry({
        id: `observed:sha256:${entryRelativePath}`,
        state: 'observed',
        claim: 'file.sha256',
        subject: file.id,
        pathValue: entryRelativePath,
        value: createHash('sha256').update(read.bytes).digest('hex'),
        source: 'file-content',
      }));
      if (manifest && read.bytes.length > limits.maxTextBytes) {
        noteUnknown(unknownEntry({
          id: `unknown:text:${entryRelativePath}`,
          claim: 'manifest.fields',
          pathValue: entryRelativePath,
          reason: 'text-byte-limit',
        }));
      }
    }
  }

  await walkDirectory(realRoot, '', 0);
  files.sort((a, b) => compareStrings(a.path, b.path));

  const git = await readGitOrigin(realRoot, limits);
  if (git.skipped) {
    noteUnknown(unknownEntry({
      id: 'unknown:git-metadata',
      claim: 'repository.origin',
      pathValue: '.git',
      reason: git.reason || 'git-metadata-unreadable',
    }));
  }
  const identity = git.origin || rootName;
  observed.push(evidenceEntry({
    id: 'observed:repository:name',
    state: 'observed',
    claim: 'repository.name',
    subject: 'repository',
    value: rootName,
    source: 'filesystem-root',
  }));
  if (git.origin) {
    observed.push(evidenceEntry({
      id: 'observed:repository:origin',
      state: 'observed',
      claim: 'repository.identity',
      subject: 'repository',
      value: git.origin,
      pathValue: '.git/config',
      source: 'git-config',
    }));
  } else {
    inferred.push(evidenceEntry({
      id: 'inferred:repository:identity',
      state: 'inferred',
      claim: 'repository.identity',
      subject: 'repository',
      value: rootName,
      source: 'directory-name-fallback',
    }));
  }

  const manifests = [];
  for (const file of files) {
    const info = manifestInfo(file.path);
    if (!info) continue;
    const bytes = contentByPath.get(file.path);
    if (info.format === 'json' && bytes) {
      let parsed;
      try {
        parsed = JSON.parse(bytes.toString('utf8'));
      } catch {
        noteUnknown(unknownEntry({
          id: `unknown:manifest:${file.path}`,
          claim: 'manifest.fields',
          pathValue: file.path,
          reason: 'invalid-json',
        }));
      }
      const manifest = packageManifest(file.path, parsed);
      if (manifest) manifests.push(manifest);
      else if (!parsed) manifests.push(genericManifest(file.path, info));
    } else {
      manifests.push(genericManifest(file.path, info));
      if (!bytes) {
        noteUnknown(unknownEntry({
          id: `unknown:manifest:${file.path}`,
          claim: 'manifest.fields',
          pathValue: file.path,
          reason: 'manifest-content-unread',
        }));
      }
    }
  }
  manifests.sort((a, b) => compareStrings(a.path, b.path));

  for (const manifest of manifests) {
    inferred.push(evidenceEntry({
      id: `inferred:manifest:${manifest.path}`,
      state: 'inferred',
      claim: 'repository.manifest',
      subject: 'repository',
      pathValue: manifest.path,
      value: manifest.kind,
      source: 'manifest-name',
    }));
    if (manifest.kind === 'package') {
      for (const dependency of packageDependencyEntries(manifest)) {
        observed.push(evidenceEntry({
          id: `observed:dependency:${manifest.path}:${dependency.section}:${dependency.name}`,
          state: 'observed',
          claim: 'dependency.declared',
          subject: `external:${dependency.name}`,
          pathValue: manifest.path,
          value: { name: dependency.name, section: dependency.section, version: dependency.version },
          source: 'manifest',
        }));
      }
    }
  }

  const graphNodeById = new Map();
  for (const file of files) {
    graphNodeById.set(file.id, { id: file.id, kind: 'file', path: file.path });
  }
  const edgeById = new Map();
  const addExternalNode = (specifier) => {
    const id = externalNodeId(specifier);
    if (!graphNodeById.has(id)) graphNodeById.set(id, { id, kind: 'external', specifier });
    return id;
  };
  const addEdge = (from, to, kind, specifier, status) => {
    const id = `edge:${from}->${to}:${kind}:${specifier || ''}`;
    if (!edgeById.has(id)) {
      const edge = { id, from, to, kind };
      if (specifier !== undefined) edge.specifier = specifier;
      if (status !== undefined) edge.status = status;
      edgeById.set(id, edge);
    }
  };

  for (const file of files) {
    if (!TEXT_SOURCE_EXTENSIONS.has(file.extension)) continue;
    const bytes = contentByPath.get(file.path);
    if (!bytes) {
      noteUnknown(unknownEntry({
        id: `unknown:imports:${file.path}`,
        claim: 'graph.imports',
        pathValue: file.path,
        reason: 'source-content-unread',
      }));
      continue;
    }
    const text = bytes.subarray(0, limits.maxTextBytes).toString('utf8');
    for (const specifier of extractImportSpecifiers(text)) {
      const localTarget = resolveLocalImport(file.path, specifier, fileByPath);
      const isLocal = specifier.startsWith('.') || specifier.startsWith('/');
      let target;
      let status;
      if (localTarget) {
        target = localTarget;
        status = 'resolved';
      } else if (isLocal) {
        target = unresolvedNodeId(file.path, specifier);
        status = 'unresolved';
        if (!graphNodeById.has(target)) {
          graphNodeById.set(target, { id: target, kind: 'unresolved', specifier });
        }
        noteUnknown(unknownEntry({
          id: `unknown:import-target:${file.path}:${specifier}`,
          claim: 'graph.importTarget',
          pathValue: file.path,
          reason: 'relative-import-unresolved',
          details: { specifier },
        }));
      } else {
        target = addExternalNode(specifier);
        status = 'external';
      }
      addEdge(file.id, target, 'import', specifier, status);
      inferred.push(evidenceEntry({
        id: `inferred:edge:${file.id}:${specifier}`,
        state: 'inferred',
        claim: 'graph.import',
        subject: file.id,
        pathValue: file.path,
        value: { specifier, target },
        source: 'static-import-syntax',
      }));
    }
  }
  for (const manifest of manifests) {
    for (const dependency of packageDependencyEntries(manifest)) {
      const target = addExternalNode(dependency.name);
      const source = `manifest:${manifest.path}`;
      addEdge(source, target, 'dependency', dependency.name, 'external');
      inferred.push(evidenceEntry({
        id: `inferred:dependency-edge:${manifest.path}:${dependency.section}:${dependency.name}`,
        state: 'inferred',
        claim: 'graph.dependency',
        subject: source,
        pathValue: manifest.path,
        value: { target, section: dependency.section, version: dependency.version },
        source: 'manifest-dependency-field',
      }));
    }
  }

  // Manifest nodes are useful graph anchors but are not duplicate file nodes.
  for (const manifest of manifests) {
    const id = `manifest:${manifest.path}`;
    if (!graphNodeById.has(id)) graphNodeById.set(id, { id, kind: 'manifest', path: manifest.path });
  }

  const entrypoints = inferEntrypoints(files, manifests, fileByPath);
  if (entrypoints.length === 0) {
    noteUnknown(unknownEntry({
      id: 'unknown:graph:entrypoints',
      claim: 'graph.entrypoints',
      reason: 'no-static-entrypoint-found',
    }));
  }
  for (const entrypoint of entrypoints) {
    inferred.push(evidenceEntry({
      id: `inferred:entrypoint:${entrypoint}`,
      state: 'inferred',
      claim: 'graph.entrypoint',
      subject: entrypoint,
      value: true,
      source: 'manifest-or-filename-convention',
    }));
  }

  const languages = new Map();
  for (const file of files) {
    const language = languageForFile(file);
    if (!language) continue;
    languages.set(language, (languages.get(language) || 0) + 1);
    inferred.push(evidenceEntry({
      id: `inferred:language:${file.path}`,
      state: 'inferred',
      claim: 'file.language',
      subject: file.id,
      pathValue: file.path,
      value: language,
      source: 'extension',
    }));
  }
  const projectKind = inferProjectKind(files, manifests);
  inferred.push(evidenceEntry({
    id: 'inferred:repository:project-kind',
    state: 'inferred',
    claim: 'repository.projectKind',
    subject: 'repository',
    value: projectKind,
    source: 'manifest-and-extension-signals',
  }));
  for (const [language, count] of [...languages.entries()].sort((a, b) => compareStrings(a[0], b[0]))) {
    inferred.push(evidenceEntry({
      id: `inferred:language-count:${language}`,
      state: 'inferred',
      claim: 'repository.languageCount',
      subject: 'repository',
      value: { language, files: count },
      source: 'extension-count',
    }));
  }

  // This is the sole observed transition emitted by the inspection boundary:
  // the bounded, read-only inspection completed.  It is intentionally
  // independent from every capability inference below; completion does not
  // certify that customer code builds, runs, or passes tests.
  observed.push({
    id: INSPECTION_COMPLETION_EVIDENCE_ID,
    state: 'observed',
    claim: INSPECTION_COMPLETION_EVIDENCE_ID,
    subject: 'repository',
    value: true,
    source: 'bounded-read-only-inspection',
  });
  unknown.push(unknownEntry({
    id: INSPECTION_RUNTIME_UNKNOWN_EVIDENCE_ID,
    claim: 'repository.runtime-behavior',
    reason: 'source-not-executed',
    details: { policy: 'read-only-static-inspection' },
  }));

  const report = {
    schemaVersion: INSPECTION_REPORT_SCHEMA_VERSION,
    repository: { name: rootName, identity },
    summary: {
      filesDiscovered,
      filesInspected: files.length,
      truncated,
    },
    files,
    graph: {
      nodes: [...graphNodeById.values()].sort((a, b) => compareStrings(a.id, b.id)),
      edges: [...edgeById.values()].sort((a, b) => compareStrings(a.id, b.id)),
      entrypoints,
    },
    manifests,
    evidence: {
      observed: dedupeEvidence(observed),
      inferred: dedupeEvidence(inferred),
      unknown: dedupeEvidence(unknown),
    },
  };

  // Force a JSON round trip as a final contract check.  It catches accidental
  // undefined/BigInt values while keeping this module dependency-free.  The
  // returned object itself remains ordinary data for downstream modules.
  JSON.stringify(report);
  return report;
}

export default inspectRepository;
