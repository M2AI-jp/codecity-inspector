import {
  constants as fsConstants,
  lstatSync,
  promises as fs,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * The first wire-compatible inspection report.  Keep this number in step with
 * the repository's backend contract v1; consumers must reject an
 * unknown version instead of guessing at its meaning.
 */
const INSPECTION_REPORT_SCHEMA_VERSION = 1;

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
  maxVisitedEntries: 12_000,
  maxVisitedDirectories: 2_500,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxTextBytes: 256 * 1024,
  // Static syntax can expand a small passive file into many graph objects.
  // These are memory-safety boundaries, not completeness targets. Anything
  // beyond them remains explicitly unknown in the inspection report.
  maxImportSpecifiersPerFile: 1_024,
  maxDerivedGraphNodes: 16_000,
  maxDerivedGraphEdges: 32_000,
  maxDerivedGraphEvidence: 32_000,
  maxDerivedDependencies: 12_000,
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
  ['.cts', 'typescript'],
  ['.css', 'css'],
  ['.go', 'go'],
  ['.h', 'c'],
  ['.hpp', 'cpp'],
  ['.html', 'html'],
  ['.java', 'java'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.cjs', 'javascript'],
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
  '.cts',
  '.cjs',
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

// Basename test/spec markers are meaningful for implementation files only.
// JSON/YAML/TOML documents such as openapi.spec.json are descriptions or
// metadata unless they sit under an actual test directory.
const TEST_MARKER_EXTENSIONS = new Set([
  ...TEXT_SOURCE_EXTENSIONS,
  '.css', '.html', '.kt', '.xml',
]);
const IMPORT_SYNTAX_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
]);

const SOURCE_FILE_EXTENSIONS = [
  '',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.jsx',
  '.json',
];

const NOFOLLOW = typeof fsConstants.O_NOFOLLOW === 'number'
  ? fsConstants.O_NOFOLLOW
  : 0;
const DIRECTORY = typeof fsConstants.O_DIRECTORY === 'number'
  ? fsConstants.O_DIRECTORY
  : 0;

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortStrings(values) {
  return [...values].sort(compareStrings);
}

function asFilePath(root) {
  if (typeof root !== 'string') {
    throw new TypeError('inspectRepository root must be a path');
  }
  if (root.length === 0) {
    throw new TypeError('inspectRepository root must not be empty');
  }
  return root;
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
  const extension = extensionOf(relativePathValue);
  const directories = segments.slice(0, -1);
  const documentationDirectory = directories.includes('doc')
    || directories.includes('docs')
    || directories.includes('documentation');
  const sourceTestDirectory = directories.includes('test')
    || directories.includes('tests')
    || directories.includes('__tests__')
    || directories.includes('__test__')
    || directories.includes('spec')
    || directories.includes('specs')
    || directories.includes('__snapshots__')
    || directories.includes('fixtures')
    || directories.includes('__fixtures__')
    || (!documentationDirectory && directories.some((directory) => directory
      .split(/[^a-z0-9]+/u)
      .filter(Boolean)
      .some((token) => ['test', 'tests', 'spec', 'specs'].includes(token))));
  if (sourceTestDirectory) return true;
  // Documentation extensions/kinds win over basename test/spec markers. A
  // documentation fixture under an actual test directory remains a test
  // artifact via the branch above.
  if (DOCUMENTATION_EXTENSIONS.has(extension)
      || basename === 'readme'
      || basename.startsWith('readme.')) return false;
  // Documentation trees can contain filenames such as `test-plan`; their prose
  // title is not a test implementation. Explicit markers in a source path
  // remain test evidence.
  if (documentationDirectory) {
    return false;
  }
  if (!TEST_MARKER_EXTENSIONS.has(extension)) return false;
  return /(?:^|[._-])(test|spec)(?:[._-]|$)/.test(basename);
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

function extractImportSpecifiers(text, maxSpecifiers) {
  const tokens = lexicalImportTokens(text);
  const result = new Set();
  let truncated = false;
  const add = (value) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512 || result.has(value)) {
      return;
    }
    if (result.size >= maxSpecifiers) {
      truncated = true;
      return;
    }
    result.add(value);
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'identifier') continue;
    if ((token.value === 'require' || token.value === 'import')
        && isCallExpressionStart(tokens, index)) {
      const openIndex = nextCodeTokenIndex(tokens, index + 1);
      const open = tokens[openIndex];
      if (open?.value === '(') {
        const argument = tokens[nextCodeTokenIndex(tokens, openIndex + 1)];
        if (argument?.type === 'string') add(argument.value);
        continue;
      }
    }
    if ((token.value === 'import' || token.value === 'export')
        && isStatementBoundary(tokens, index)) {
      const next = tokens[nextCodeTokenIndex(tokens, index + 1)];
      if (token.value === 'import' && next?.type === 'string') {
        add(next.value);
        continue;
      }
      if (token.value === 'export' && ['function', 'class', 'const', 'let', 'var', 'default'].includes(next?.value)) {
        continue;
      }
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const current = tokens[cursor];
        if (current.value === ';') break;
        if (current.type === 'identifier' && current.value === 'from') {
          const source = tokens[cursor + 1];
          if (source?.type === 'string') add(source.value);
          break;
        }
      }
    }
  }
  return { specifiers: sortStrings(result), truncated };
}

function isCallExpressionStart(tokens, index) {
  const previous = tokens[index - 1];
  if (!previous || previous.type === 'newline') return true;
  if (previous.type === 'identifier') {
    return new Set(['return', 'throw', 'await', 'yield', 'case', 'else', 'do']).has(previous.value);
  }
  return new Set(['=', '(', '[', '{', ',', ';']).has(previous.value);
}

function isStatementBoundary(tokens, index) {
  const previous = tokens[index - 1];
  if (!previous || previous.type === 'newline') return true;
  return previous.type === 'punctuation' && new Set([';', '}', ')', ']']).has(previous.value);
}

function nextCodeTokenIndex(tokens, start) {
  let index = start;
  while (tokens[index]?.type === 'newline') index += 1;
  return index;
}

function lexicalImportTokens(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/u.test(character)) {
      if (character === '\n') tokens.push({ type: 'newline', value: '\n' });
      index += 1;
      continue;
    }
    if (character === '/' && text[index + 1] === '/') {
      index += 2;
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && text[index + 1] === '*') {
      index += 2;
      while (index < text.length) {
        if (text[index] === '*' && text[index + 1] === '/') {
          index += 2;
          break;
        }
        if (text[index] === '\n') tokens.push({ type: 'newline', value: '\n' });
        index += 1;
      }
      continue;
    }
    if (character === '/' && isRegexLiteralStart(tokens)) {
      index = skipRegexLiteral(text, index);
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      const quote = character;
      let value = '';
      index += 1;
      while (index < text.length) {
        const current = text[index];
        if (current === '\\' && index + 1 < text.length) {
          value += text[index + 1];
          index += 2;
          continue;
        }
        if (current === quote) {
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      tokens.push({ type: 'string', value });
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < text.length && /[A-Za-z0-9_$]/u.test(text[index])) index += 1;
      tokens.push({ type: 'identifier', value: text.slice(start, index) });
      continue;
    }
    tokens.push({ type: 'punctuation', value: character });
    index += 1;
  }
  return tokens;
}

function isRegexLiteralStart(tokens) {
  const previous = tokens.at(-1);
  if (!previous || previous.type === 'newline') return true;
  if (previous.type === 'identifier') {
    return new Set(['return', 'case', 'throw', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of', 'yield', 'await', 'else', 'do']).has(previous.value);
  }
  return new Set(['=', '(', '[', '{', ',', ':', ';', '!', '&', '|', '?', '+', '-', '%', '*', '^', '~', '<']).has(previous.value);
}

function skipRegexLiteral(text, start) {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < text.length) {
    const character = text[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '[') {
      inCharacterClass = true;
      index += 1;
      continue;
    }
    if (character === ']') {
      inCharacterClass = false;
      index += 1;
      continue;
    }
    if (character === '/' && !inCharacterClass) {
      index += 1;
      while (/[A-Za-z]/u.test(text[index] ?? '')) index += 1;
      return index;
    }
    if (character === '\n' || character === '\r') return start + 1;
    index += 1;
  }
  return index;
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

function sameFilesystemObject(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function acquireRepositoryRoot(absoluteRoot) {
  try {
    // Capture the lexical object before yielding to the event loop, then prove
    // every resolved view is the same directory. A path substituted between
    // these operations may be resolved for comparison, but is never traversed.
    const lexicalStat = lstatSync(absoluteRoot);
    if (lexicalStat.isSymbolicLink()) return { ok: false, reason: 'repository-root-symlink' };
    if (!lexicalStat.isDirectory()) return { ok: false, reason: 'repository-root-not-directory' };

    const canonicalPath = realpathSync(absoluteRoot);
    const canonicalStat = lstatSync(canonicalPath);
    const finalLexicalStat = lstatSync(absoluteRoot);
    const finalCanonicalPath = realpathSync(absoluteRoot);
    const finalCanonicalStat = lstatSync(finalCanonicalPath);
    if (finalLexicalStat.isSymbolicLink()
        || !canonicalStat.isDirectory()
        || !finalLexicalStat.isDirectory()
        || !finalCanonicalStat.isDirectory()
        || canonicalPath !== finalCanonicalPath
        || !sameFilesystemObject(lexicalStat, canonicalStat)
        || !sameFilesystemObject(lexicalStat, finalLexicalStat)
        || !sameFilesystemObject(lexicalStat, finalCanonicalStat)) {
      return { ok: false, reason: 'repository-root-changed' };
    }
    return {
      ok: true,
      requestedPath: absoluteRoot,
      canonicalPath,
      dev: lexicalStat.dev,
      ino: lexicalStat.ino,
    };
  } catch (error) {
    return { ok: false, reason: error?.code || 'repository-root-unreadable' };
  }
}

async function verifyRepositoryRoot(acquiredRoot) {
  try {
    const lexicalStat = await fs.lstat(acquiredRoot.requestedPath);
    if (lexicalStat.isSymbolicLink() || !lexicalStat.isDirectory()) {
      return { ok: false, reason: 'repository-root-changed' };
    }
    const canonicalPath = await fs.realpath(acquiredRoot.requestedPath);
    if (canonicalPath !== acquiredRoot.canonicalPath) {
      return { ok: false, reason: 'repository-root-changed' };
    }
    const canonicalStat = await fs.lstat(canonicalPath);
    if (!canonicalStat.isDirectory()
        || lexicalStat.dev !== acquiredRoot.dev
        || lexicalStat.ino !== acquiredRoot.ino
        || !sameFilesystemObject(lexicalStat, canonicalStat)) {
      return { ok: false, reason: 'repository-root-changed' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'repository-root-changed' };
  }
}

async function verifiedStatInsideRoot(filePath, acquiredRoot) {
  try {
    const rootBefore = await verifyRepositoryRoot(acquiredRoot);
    if (!rootBefore.ok) return rootBefore;
    const lexicalStat = await fs.lstat(filePath);
    const canonicalPath = await fs.realpath(filePath);
    if (!pathIsInside(acquiredRoot.canonicalPath, canonicalPath)) return { ok: false, reason: 'path-resolved-outside-root' };
    const canonicalStat = await fs.lstat(canonicalPath);
    if (lexicalStat.dev !== canonicalStat.dev || lexicalStat.ino !== canonicalStat.ino) return { ok: false, reason: 'path-changed' };
    const rootAfter = await verifyRepositoryRoot(acquiredRoot);
    if (!rootAfter.ok) return rootAfter;
    return { ok: true, stat: lexicalStat, canonicalPath };
  } catch (error) {
    return { ok: false, reason: error?.code || 'path-unreadable' };
  }
}

async function readBoundedFile(filePath, maxBytes, acquiredRoot) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | NOFOLLOW);
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) return { ok: false, reason: 'not-a-regular-file' };
    if (openedStat.size > maxBytes) return { ok: false, reason: 'file-byte-limit' };
    const verified = await verifiedStatInsideRoot(filePath, acquiredRoot);
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
    return { ok: true, bytes: Buffer.concat(chunks) };
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

async function readGitOrigin(acquiredRoot, limits) {
  const gitPath = path.join(acquiredRoot.canonicalPath, '.git');
  try {
    const git = await verifiedStatInsideRoot(gitPath, acquiredRoot);
    if (!git.ok) return { origin: null, skipped: true, reason: git.reason };
    if (!git.stat.isDirectory()) return { origin: null, skipped: true, reason: 'git-metadata-not-directory' };
    const configPath = path.join(gitPath, 'config');
    const config = await verifiedStatInsideRoot(configPath, acquiredRoot);
    if (!config.ok) return { origin: null, skipped: true, reason: config.reason };
    if (!config.stat.isFile()) return { origin: null, skipped: true, reason: 'git-config-not-regular' };
    const read = await readBoundedFile(configPath, Math.min(limits.maxTextBytes, 64 * 1024), acquiredRoot);
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
    files: [],
    graph: { nodes: [], edges: [], entrypoints: [] },
    manifests: [],
    evidence: { observed: [], inferred: [], unknown: dedupeEvidence(unknownEvidence) },
  };
}

/**
 * Inspect a repository without executing anything in it.
 *
 * The function only uses filesystem metadata, opendir/open/read, and bounded in-memory
 * parsing.  Symlinks below the root are never followed.  The returned object
 * is JSON serializable and contains no absolute filesystem paths.
 */
export async function inspectRepository(root) {
  const requestedRoot = asFilePath(root);
  const limits = DEFAULT_LIMITS;
  const absoluteRoot = path.resolve(requestedRoot);
  let rootName = path.basename(absoluteRoot) || 'repository';
  const acquiredRoot = acquireRepositoryRoot(absoluteRoot);
  if (!acquiredRoot.ok) {
    return emptyReport(rootName, rootName, [unknownEntry({
      id: 'unknown:repository-root',
      claim: 'repository.root',
      pathValue: '.',
      reason: acquiredRoot.reason,
    })]);
  }
  const realRoot = acquiredRoot.canonicalPath;
  rootName = path.basename(realRoot) || rootName;

  const observed = [];
  const inferred = [];
  const unknown = [];
  const files = [];
  const contentByPath = new Map();
  let filesDiscovered = 0;
  let bytesRead = 0;
  let entriesVisited = 0;
  let directoriesVisited = 0;
  let traversalStopped = false;
  let rootInvalidated = false;
  const fileByPath = new Map();

  const noteUnknown = (item) => unknown.push(item);

  const stopTraversal = (reason, reachedAt, limit) => {
    if (traversalStopped) return;
    traversalStopped = true;
    noteUnknown(unknownEntry({
      id: 'unknown:repository-traversal-limit',
      claim: 'repository.contents',
      pathValue: '.',
      reason,
      details: {
        limit,
        reachedAt: reachedAt || '.',
      },
    }));
  };

  async function walkDirectory(directoryPath, directoryRelativePath, depth) {
    if (traversalStopped) return;
    if (directoriesVisited >= limits.maxVisitedDirectories) {
      stopTraversal('directory-visit-limit', directoryRelativePath, limits.maxVisitedDirectories);
      return;
    }
    directoriesVisited += 1;

    const entries = [];
    let directory;
    let directoryGuard;
    try {
      const before = await verifiedStatInsideRoot(directoryPath, acquiredRoot);
      if (before.reason === 'repository-root-changed') rootInvalidated = true;
      if (!before.ok || !before.stat.isDirectory()) throw Object.assign(new Error('directory changed'), { code: before.reason ?? 'directory-not-regular' });
      directoryGuard = await fs.open(directoryPath, fsConstants.O_RDONLY | DIRECTORY | NOFOLLOW);
      const guardStat = await directoryGuard.stat();
      if (!guardStat.isDirectory() || !sameFilesystemObject(guardStat, before.stat)) {
        throw Object.assign(new Error('directory changed'), { code: 'directory-changed' });
      }
      // opendir only acquires its OS directory handle; it does not enumerate
      // entries. Prove the pathname still names the object we approved before
      // asking that bound handle for its first Dirent.
      directory = await fs.opendir(directoryPath, { bufferSize: 1 });
      const afterOpen = await verifiedStatInsideRoot(directoryPath, acquiredRoot);
      if (afterOpen.reason === 'repository-root-changed') rootInvalidated = true;
      if (!afterOpen.ok
          || !afterOpen.stat.isDirectory()
          || !sameFilesystemObject(afterOpen.stat, before.stat)
          || !sameFilesystemObject(afterOpen.stat, guardStat)) {
        throw Object.assign(new Error('directory changed'), { code: afterOpen.reason ?? 'directory-changed' });
      }
      while (!traversalStopped) {
        if (entriesVisited >= limits.maxVisitedEntries) {
          stopTraversal('entry-visit-limit', directoryRelativePath, limits.maxVisitedEntries);
          break;
        }
        const beforeRead = await verifiedStatInsideRoot(directoryPath, acquiredRoot);
        if (beforeRead.reason === 'repository-root-changed') rootInvalidated = true;
        if (!beforeRead.ok
            || !beforeRead.stat.isDirectory()
            || !sameFilesystemObject(beforeRead.stat, guardStat)) {
          throw Object.assign(new Error('directory changed'), { code: beforeRead.reason ?? 'directory-changed' });
        }
        const entry = await directory.read();
        const afterRead = await verifiedStatInsideRoot(directoryPath, acquiredRoot);
        if (afterRead.reason === 'repository-root-changed') rootInvalidated = true;
        if (!afterRead.ok
            || !afterRead.stat.isDirectory()
            || !sameFilesystemObject(afterRead.stat, guardStat)) {
          throw Object.assign(new Error('directory changed'), { code: afterRead.reason ?? 'directory-changed' });
        }
        if (!entry) break;
        entriesVisited += 1;
        if (entries.length >= limits.maxEntriesPerDirectory) {
          noteUnknown(unknownEntry({
            id: `unknown:entries:${directoryRelativePath || '.'}`,
            claim: 'directory.contents',
            pathValue: directoryRelativePath || '.',
            reason: 'directory-entry-limit',
            details: { limit: limits.maxEntriesPerDirectory },
          }));
          break;
        }
        entries.push(entry);
      }
      const after = await verifiedStatInsideRoot(directoryPath, acquiredRoot);
      if (after.reason === 'repository-root-changed') rootInvalidated = true;
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
    } finally {
      if (directory) {
        try {
          await directory.close();
        } catch {
          // Closing a directory after EOF or a read failure is best effort.
          // No repository write was attempted and unread scope stays unknown.
        }
      }
      if (directoryGuard) {
        try {
          await directoryGuard.close();
        } catch {
          // The guard only pins the approved directory during enumeration.
          // A close failure cannot make unaccepted repository bytes trusted.
        }
      }
    }
    entries.sort((a, b) => compareStrings(a.name, b.name));

    for (const entry of entries) {
      if (traversalStopped) break;
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

      const verified = await verifiedStatInsideRoot(entryPath, acquiredRoot);
      if (verified.reason === 'repository-root-changed') rootInvalidated = true;
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
        if (traversalStopped) break;
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
        // A file budget is a repository-wide safety boundary, not a quota to
        // restart in each sibling directory. Stop the whole walk and preserve
        // every unread branch as unknown through the shared traversal record.
        stopTraversal('file-limit', entryRelativePath, limits.maxFiles);
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
        noteUnknown(unknownEntry({
          id: `unknown:read:${entryRelativePath}`,
          claim: 'file.contents',
          pathValue: entryRelativePath,
          reason,
        }));
        continue;
      }

      const read = await readBoundedFile(entryPath, limits.maxFileBytes, acquiredRoot);
      if (read.reason === 'repository-root-changed') rootInvalidated = true;
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
  const rootAfterTraversal = await verifyRepositoryRoot(acquiredRoot);
  if (!rootAfterTraversal.ok || rootInvalidated) {
    return emptyReport(rootName, rootName, [unknownEntry({
      id: 'unknown:repository-root',
      claim: 'repository.root',
      pathValue: '.',
      reason: 'repository-root-changed',
    })]);
  }
  files.sort((a, b) => compareStrings(a.path, b.path));

  const git = await readGitOrigin(acquiredRoot, limits);
  if (git.reason === 'repository-root-changed') rootInvalidated = true;
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

  const dependenciesByManifest = new Map();
  let derivedDependencies = 0;
  let dependencyLimitNoted = false;
  for (const manifest of manifests) {
    const accepted = [];
    for (const dependency of packageDependencyEntries(manifest)) {
      if (derivedDependencies >= limits.maxDerivedDependencies) {
        if (!dependencyLimitNoted) {
          dependencyLimitNoted = true;
          noteUnknown(unknownEntry({
            id: 'unknown:manifest-dependency-limit',
            claim: 'repository.dependencies',
            pathValue: manifest.path,
            reason: 'derived-dependency-limit',
            details: { limit: limits.maxDerivedDependencies },
          }));
        }
        break;
      }
      accepted.push(dependency);
      derivedDependencies += 1;
    }
    dependenciesByManifest.set(manifest.path, accepted);
  }

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
  }

  const graphNodeById = new Map();
  for (const file of files) {
    graphNodeById.set(file.id, { id: file.id, kind: 'file', path: file.path });
  }
  const edgeById = new Map();
  let derivedGraphNodes = 0;
  let derivedGraphEvidence = 0;
  const graphLimitsNoted = new Set();
  const noteGraphLimit = (reason, claim, reachedAt, limit) => {
    if (graphLimitsNoted.has(reason)) return;
    graphLimitsNoted.add(reason);
    noteUnknown(unknownEntry({
      id: `unknown:graph:${reason}`,
      claim,
      pathValue: reachedAt ?? '.',
      reason,
      details: { limit },
    }));
  };
  const addGraphRelation = ({ from, to, targetNode, kind, specifier, evidenceEntries, reachedAt }) => {
    const id = `edge:${from}->${to}:${kind}:${specifier || ''}`;
    const needsNode = targetNode !== null && !graphNodeById.has(to);
    const needsEdge = !edgeById.has(id);
    if (needsNode && derivedGraphNodes >= limits.maxDerivedGraphNodes) {
      noteGraphLimit('derived-node-limit', 'graph.nodes', reachedAt, limits.maxDerivedGraphNodes);
      return null;
    }
    if (needsEdge && edgeById.size >= limits.maxDerivedGraphEdges) {
      noteGraphLimit('derived-edge-limit', 'graph.edges', reachedAt, limits.maxDerivedGraphEdges);
      return null;
    }
    if (derivedGraphEvidence + evidenceEntries.length > limits.maxDerivedGraphEvidence) {
      noteGraphLimit('derived-evidence-limit', 'graph.evidence', reachedAt, limits.maxDerivedGraphEvidence);
      return null;
    }
    if (needsNode) {
      graphNodeById.set(to, targetNode);
      derivedGraphNodes += 1;
    }
    if (needsEdge) {
      const edge = { id, from, to, kind };
      if (specifier !== undefined) edge.specifier = specifier;
      edgeById.set(id, edge);
    }
    for (const entry of evidenceEntries) {
      if (entry.state === 'unknown') noteUnknown(entry);
      else if (entry.state === 'observed') observed.push(entry);
      else inferred.push(entry);
    }
    derivedGraphEvidence += evidenceEntries.length;
    return id;
  };

  for (const file of files) {
    if (!TEXT_SOURCE_EXTENSIONS.has(file.extension)) continue;
    if (!IMPORT_SYNTAX_EXTENSIONS.has(file.extension)) continue;
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
    const extracted = extractImportSpecifiers(text, limits.maxImportSpecifiersPerFile);
    if (extracted.truncated) {
      noteUnknown(unknownEntry({
        id: `unknown:import-specifier-limit:${file.path}`,
        claim: 'graph.imports',
        pathValue: file.path,
        reason: 'import-specifier-limit',
        details: { limit: limits.maxImportSpecifiersPerFile },
      }));
    }
    for (const specifier of extracted.specifiers) {
      const localTarget = resolveLocalImport(file.path, specifier, fileByPath);
      const isLocal = specifier.startsWith('.') || specifier.startsWith('/');
      let target;
      let targetNode = null;
      const evidenceEntries = [];
      if (localTarget) {
        target = localTarget;
      } else if (isLocal) {
        target = unresolvedNodeId(file.path, specifier);
        targetNode = { id: target, kind: 'unresolved', specifier };
        evidenceEntries.push(unknownEntry({
          id: `unknown:import-target:${file.path}:${specifier}`,
          claim: 'graph.importTarget',
          pathValue: file.path,
          reason: 'relative-import-unresolved',
          details: { specifier },
        }));
      } else {
        target = externalNodeId(specifier);
        targetNode = { id: target, kind: 'external', specifier };
      }
      const prospectiveEdgeId = `edge:${file.id}->${target}:import:${specifier}`;
      evidenceEntries.push(evidenceEntry({
        id: `inferred:edge:${file.id}:${specifier}`,
        state: 'inferred',
        claim: 'graph.import',
        subject: prospectiveEdgeId,
        pathValue: file.path,
        value: { specifier, target },
        source: 'static-import-syntax',
      }));
      addGraphRelation({
        from: file.id,
        to: target,
        targetNode,
        kind: 'import',
        specifier,
        evidenceEntries,
        reachedAt: file.path,
      });
    }
  }
  for (const manifest of manifests) {
    for (const dependency of dependenciesByManifest.get(manifest.path) ?? []) {
      const target = externalNodeId(dependency.name);
      const source = `manifest:${manifest.path}`;
      const prospectiveEdgeId = `edge:${source}->${target}:dependency:${dependency.name}`;
      addGraphRelation({
        from: source,
        to: target,
        targetNode: { id: target, kind: 'external', specifier: dependency.name },
        kind: 'dependency',
        specifier: dependency.name,
        reachedAt: manifest.path,
        evidenceEntries: [evidenceEntry({
          id: `observed:dependency:${manifest.path}:${dependency.section}:${dependency.name}`,
          state: 'observed',
          claim: 'dependency.declared',
          subject: prospectiveEdgeId,
          pathValue: manifest.path,
          value: { name: dependency.name, section: dependency.section, version: dependency.version },
          source: 'manifest',
        })],
      });
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

  for (const file of files) {
    const language = languageForFile(file);
    if (!language) continue;
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

  const finalRoot = await verifyRepositoryRoot(acquiredRoot);
  if (!finalRoot.ok || rootInvalidated) {
    return emptyReport(rootName, rootName, [unknownEntry({
      id: 'unknown:repository-root',
      claim: 'repository.root',
      pathValue: '.',
      reason: 'repository-root-changed',
    })]);
  }

  const report = {
    schemaVersion: INSPECTION_REPORT_SCHEMA_VERSION,
    repository: { name: rootName, identity },
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

  return report;
}
