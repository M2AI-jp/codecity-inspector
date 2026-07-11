import { parse } from '@babel/parser';
import { lstat, opendir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
const SOURCE_EXTENSION_SET = new Set(SOURCE_EXTENSIONS);
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.next', '.nuxt', '.svelte-kit', '.turbo',
  'build', 'coverage', 'dist', 'node_modules', 'out', 'target', 'vendor'
]);

const DEFAULT_LIMITS = Object.freeze({
  maxDirectories: 10_000,
  maxEntries: 100_000,
  maxFiles: 2_500,
  maxBytes: 12 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxAstNodes: 1_000_000,
  maxEdges: 25_000,
  maxRecordedSkips: 200
});

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSION_SET.has(path.extname(filePath).toLowerCase());
}

function isTestPath(relativePath) {
  return /(^|\/)(__tests__|test|tests|spec)(\/|$)/i.test(relativePath)
    || /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(relativePath);
}

function classify(relativePath) {
  if (isTestPath(relativePath)) return 'test';
  const normalized = `/${relativePath.toLowerCase()}`;
  if (/\/(cli|bin)(\/|\.)/.test(normalized)) return 'cli';
  if (/\/(server|api|routes?)(\/|\.)/.test(normalized)) return 'service';
  if (/\/(components?|pages?|views?|ui)(\/|\.)/.test(normalized)) return 'interface';
  if (/\/(models?|data|db|database)(\/|\.)/.test(normalized)) return 'data';
  if (/\/(config|configs?)(\/|\.)/.test(normalized)) return 'configuration';
  return 'module';
}

function parserOptions(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  const typescript = ['.ts', '.tsx', '.mts', '.cts'].includes(extension);
  const plugins = [];
  if (typescript) plugins.push('typescript');
  if (!typescript || extension === '.tsx') plugins.push('jsx');

  let sourceType = 'unambiguous';
  if (extension === '.mjs' || extension === '.mts') sourceType = 'module';
  else if (extension === '.cjs' || extension === '.cts') sourceType = 'commonjs';

  return {
    sourceType,
    plugins,
    createImportExpressions: true,
    attachComment: false
  };
}

function stringLiteralValue(node) {
  return node?.type === 'StringLiteral' && typeof node.value === 'string' ? node.value : null;
}

function astChildren(node) {
  const children = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && typeof child.type === 'string') children.push(child);
      }
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      children.push(value);
    }
  }
  return children;
}

function extractDependencies(source, relativePath, maxAstNodes) {
  const program = parse(source, parserOptions(relativePath)).program;
  const stack = [program];
  const found = [];
  let astNodesVisited = 0;

  const add = (kind, specifier, status, start) => {
    found.push({ kind, specifier, status, start: Number.isInteger(start) ? start : 0 });
  };

  while (stack.length > 0) {
    if (astNodesVisited >= maxAstNodes) {
      return { dependencies: [], astNodesVisited, truncated: true };
    }
    const node = stack.pop();
    astNodesVisited += 1;

    if (node.type === 'ImportDeclaration') {
      const specifier = stringLiteralValue(node.source);
      if (specifier) add('import', specifier, undefined, node.start);
    } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      const specifier = stringLiteralValue(node.source);
      if (specifier) add('export', specifier, undefined, node.start);
    } else if (node.type === 'ImportExpression') {
      const specifier = stringLiteralValue(node.source);
      add('dynamic-import', specifier, specifier ? undefined : 'runtime-unknown', node.start);
    } else if (node.type === 'CallExpression' && node.callee?.type === 'Import') {
      const specifier = stringLiteralValue(node.arguments?.[0]);
      add('dynamic-import', specifier, specifier ? undefined : 'runtime-unknown', node.start);
    } else if (node.type === 'CallExpression'
      && node.callee?.type === 'Identifier'
      && node.callee.name === 'require') {
      const specifier = node.arguments?.length === 1 ? stringLiteralValue(node.arguments[0]) : null;
      add('require', specifier, specifier ? undefined : 'runtime-unknown', node.start);
    }

    const children = astChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }

  found.sort((left, right) => left.start - right.start);
  const seen = new Set();
  const dependencies = [];
  for (const { kind, specifier, status } of found) {
    const key = `${kind}\0${specifier ?? ''}\0${status ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dependencies.push({ kind, specifier, ...(status ? { status } : {}) });
  }
  return { dependencies, astNodesVisited, truncated: false };
}

function unknownSpecifierStatus(specifier) {
  if (path.isAbsolute(specifier) || /^(?:data|file|https?|node):/i.test(specifier)) return 'unsupported';
  if (specifier.startsWith('#') || specifier.startsWith('@/') || specifier.startsWith('~/')) return 'alias-unknown';
  return 'external-or-alias';
}

function candidatePaths(root, fromRelativePath, specifier) {
  if (specifier === null) return { local: false, status: 'runtime-unknown', candidates: [] };
  const withoutSuffix = specifier.split(/[?#]/, 1)[0];
  if (!withoutSuffix.startsWith('.')) {
    return { local: false, status: unknownSpecifierStatus(specifier), candidates: [] };
  }
  const absoluteBase = path.resolve(root, path.dirname(fromRelativePath), withoutSuffix);
  if (!inside(root, absoluteBase)) return { local: true, outsideRoot: true, candidates: [] };

  const candidates = [absoluteBase];
  const extension = path.extname(absoluteBase).toLowerCase();
  if (extension && !SOURCE_EXTENSION_SET.has(extension)) {
    return { local: false, status: 'unsupported', candidates: [] };
  }
  if (!SOURCE_EXTENSION_SET.has(extension)) {
    for (const sourceExtension of SOURCE_EXTENSIONS) candidates.push(`${absoluteBase}${sourceExtension}`);
    for (const sourceExtension of SOURCE_EXTENSIONS) candidates.push(path.join(absoluteBase, `index${sourceExtension}`));
  } else if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    const stem = absoluteBase.slice(0, -extension.length);
    for (const sourceExtension of ['.ts', '.tsx', '.mts', '.cts']) candidates.push(`${stem}${sourceExtension}`);
  }
  return { local: true, outsideRoot: false, candidates };
}

function entryStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => entryStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => entryStrings(item, output));
  return output;
}

async function packageEntrypointHints(root, recordSkip) {
  const packagePath = path.join(root, 'package.json');
  try {
    const stat = await lstat(packagePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return [];
    if (stat.size > 1024 * 1024) {
      recordSkip('package.json', 'metadata-too-large');
      return [];
    }
    const parsed = JSON.parse(await readFile(packagePath, 'utf8'));
    const hints = [];
    for (const field of ['main', 'module', 'browser', 'bin', 'exports']) {
      for (const value of entryStrings(parsed[field])) {
        if (value.startsWith('.')) hints.push({ value, evidence: `package.json:${field}` });
      }
    }
    return hints;
  } catch (error) {
    if (error?.code !== 'ENOENT') recordSkip('package.json', 'metadata-unreadable');
    return [];
  }
}

/**
 * Read a JS/TS repository as data. This function never imports or executes target files.
 */
export async function scanRepository(repositoryPath, options = {}) {
  const suppliedRoot = path.resolve(repositoryPath);
  const root = await realpath(suppliedRoot);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new Error('Repository path must be a directory');

  const limits = {
    maxDirectories: positiveInteger(options.maxDirectories, DEFAULT_LIMITS.maxDirectories),
    maxEntries: positiveInteger(options.maxEntries, DEFAULT_LIMITS.maxEntries),
    maxFiles: positiveInteger(options.maxFiles, DEFAULT_LIMITS.maxFiles),
    maxBytes: positiveInteger(options.maxBytes, DEFAULT_LIMITS.maxBytes),
    maxFileBytes: positiveInteger(options.maxFileBytes, DEFAULT_LIMITS.maxFileBytes),
    maxAstNodes: positiveInteger(options.maxAstNodes, DEFAULT_LIMITS.maxAstNodes),
    maxEdges: positiveInteger(options.maxEdges, DEFAULT_LIMITS.maxEdges),
    maxRecordedSkips: positiveInteger(options.maxRecordedSkips, DEFAULT_LIMITS.maxRecordedSkips)
  };
  const ignoredDirectories = new Set([...DEFAULT_IGNORED_DIRECTORIES, ...(options.ignoreDirectories ?? [])]);
  const sourceRecords = [];
  const allSourcePaths = new Set();
  const skips = [];
  const skipCounts = {};
  let bytesRead = 0;
  let directoriesVisited = 0;
  let entriesVisited = 0;
  let astNodesVisited = 0;
  let omittedFiles = 0;
  let discoveryTruncated = false;
  let traversalTruncated = false;
  let analysisTruncated = false;

  const recordSkip = (relativePath, reason) => {
    skipCounts[reason] = (skipCounts[reason] ?? 0) + 1;
    if (skips.length < limits.maxRecordedSkips) skips.push({ path: toPosix(relativePath), reason });
  };

  async function walk(directory) {
    if (discoveryTruncated || traversalTruncated) return;
    if (directoriesVisited >= limits.maxDirectories) {
      traversalTruncated = true;
      recordSkip(path.relative(root, directory) || '.', 'max-directories');
      return;
    }
    directoriesVisited += 1;

    const entries = [];
    try {
      const directoryHandle = await opendir(directory);
      for await (const entry of directoryHandle) {
        if (entriesVisited >= limits.maxEntries) {
          discoveryTruncated = true;
          recordSkip(path.relative(root, directory) || '.', 'max-entries');
          break;
        }
        entriesVisited += 1;
        entries.push(entry);
      }
    } catch {
      recordSkip(path.relative(root, directory) || '.', 'directory-unreadable');
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath);
      if (!inside(root, absolutePath)) {
        recordSkip(relativePath, 'outside-root');
        continue;
      }
      if (entry.isSymbolicLink()) {
        recordSkip(relativePath, 'symbolic-link');
        continue;
      }
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) recordSkip(relativePath, 'ignored-directory');
        else await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !isSourceFile(entry.name)) continue;

      const posixPath = toPosix(relativePath);
      allSourcePaths.add(posixPath);
      let stat;
      try {
        stat = await lstat(absolutePath);
      } catch {
        recordSkip(relativePath, 'file-unreadable');
        omittedFiles += 1;
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        recordSkip(relativePath, 'non-regular-file');
        omittedFiles += 1;
        continue;
      }
      if (sourceRecords.length >= limits.maxFiles) {
        recordSkip(relativePath, 'max-files');
        omittedFiles += 1;
        continue;
      }
      if (stat.size > limits.maxFileBytes) {
        recordSkip(relativePath, 'max-file-bytes');
        omittedFiles += 1;
        continue;
      }
      if (bytesRead + stat.size > limits.maxBytes) {
        recordSkip(relativePath, 'max-total-bytes');
        omittedFiles += 1;
        continue;
      }
      let source;
      try {
        source = await readFile(absolutePath, 'utf8');
      } catch {
        recordSkip(relativePath, 'file-unreadable');
        omittedFiles += 1;
        continue;
      }
      bytesRead += stat.size;

      let dependencies = [];
      if (astNodesVisited >= limits.maxAstNodes) {
        analysisTruncated = true;
        recordSkip(relativePath, 'max-ast-nodes');
      } else {
        try {
          const extraction = extractDependencies(source, posixPath, limits.maxAstNodes - astNodesVisited);
          astNodesVisited += extraction.astNodesVisited;
          dependencies = extraction.dependencies;
          if (extraction.truncated) {
            analysisTruncated = true;
            recordSkip(relativePath, 'max-ast-nodes');
          }
        } catch {
          analysisTruncated = true;
          recordSkip(relativePath, 'parse-error-or-unsupported-syntax');
        }
      }
      sourceRecords.push({
        path: posixPath,
        absolutePath,
        bytes: stat.size,
        kind: classify(posixPath),
        isTest: isTestPath(posixPath),
        dependencies
      });
    }
  }

  await walk(root);

  const byAbsolutePath = new Map(sourceRecords.map((record) => [record.absolutePath, record]));
  const allByAbsolutePath = new Set([...allSourcePaths].map((relativePath) => path.resolve(root, relativePath)));
  const edges = [];
  let edgesOmitted = 0;
  const edgeLimitFiles = new Set();
  const appendEdge = (recordPath, edge) => {
    if (edges.length < limits.maxEdges) {
      edges.push(edge);
      return;
    }
    edgesOmitted += 1;
    skipCounts['max-edges'] = (skipCounts['max-edges'] ?? 0) + 1;
    if (!edgeLimitFiles.has(recordPath) && skips.length < limits.maxRecordedSkips) {
      edgeLimitFiles.add(recordPath);
      skips.push({ path: recordPath, reason: 'max-edges' });
    }
  };
  for (const record of sourceRecords) {
    for (const dependency of record.dependencies) {
      if (dependency.status === 'runtime-unknown') {
        appendEdge(record.path, {
          from: record.path,
          to: null,
          targetHint: null,
          kind: dependency.kind,
          status: dependency.status
        });
        continue;
      }
      const resolution = candidatePaths(root, record.path, dependency.specifier);
      if (!resolution.local) {
        appendEdge(record.path, {
          from: record.path,
          to: null,
          targetHint: null,
          kind: dependency.kind,
          status: resolution.status
        });
        continue;
      }
      if (resolution.outsideRoot) {
        appendEdge(record.path, {
          from: record.path,
          to: null,
          targetHint: null,
          kind: dependency.kind,
          status: 'outside-root'
        });
        continue;
      }
      const resolved = resolution.candidates.find((candidate) => byAbsolutePath.has(candidate));
      if (resolved) {
        appendEdge(record.path, {
          from: record.path,
          to: byAbsolutePath.get(resolved).path,
          targetHint: null,
          kind: dependency.kind,
          status: 'resolved'
        });
        continue;
      }
      const unscanned = resolution.candidates.find((candidate) => allByAbsolutePath.has(candidate));
      const hintCandidate = resolution.candidates[0];
      appendEdge(record.path, {
        from: record.path,
        to: null,
        targetHint: inside(root, hintCandidate) ? toPosix(path.relative(root, hintCandidate)) : null,
        kind: dependency.kind,
        status: unscanned ? 'not-scanned' : 'unresolved'
      });
    }
  }

  const hints = await packageEntrypointHints(root, recordSkip);
  const entrypoints = [];
  const entrySeen = new Set();
  for (const hint of hints) {
    const resolution = candidatePaths(root, 'package.json', hint.value);
    const resolved = resolution.candidates.find((candidate) => byAbsolutePath.has(candidate));
    if (!resolved) continue;
    const relativePath = byAbsolutePath.get(resolved).path;
    if (!entrySeen.has(relativePath)) {
      entrySeen.add(relativePath);
      entrypoints.push({ path: relativePath, evidence: hint.evidence });
    }
  }

  return {
    schemaVersion: 2,
    repository: { name: path.basename(root) },
    limits,
    summary: {
      filesDiscovered: allSourcePaths.size,
      filesScanned: sourceRecords.length,
      bytesRead,
      directoriesVisited,
      entriesVisited,
      astNodesVisited,
      omittedFiles,
      edgesOmitted,
      truncated: traversalTruncated || discoveryTruncated || analysisTruncated || omittedFiles > 0 || edgesOmitted > 0,
      truncation: {
        traversal: traversalTruncated,
        discovery: discoveryTruncated,
        analysis: analysisTruncated,
        files: omittedFiles > 0,
        edges: edgesOmitted > 0
      }
    },
    nodes: sourceRecords.map(({ path: nodePath, bytes, kind, isTest }) => ({
      id: nodePath,
      path: nodePath,
      bytes,
      kind,
      isTest
    })),
    edges,
    entrypoints,
    skips,
    skipCounts,
    limitations: [
      'Babel AST parsing extracts static JS/TS dependency literals only; computed dependency occurrences are marked runtime-unknown without inferring targets.',
      'Files rejected by the parser or AST traversal limit are recorded as unknown and do not produce dependency claims.',
      'TypeScript path aliases, bundler aliases, framework routing, and external services are not resolved.',
      'Symbolic links and common generated or vendor directories are not inspected.',
      'A resolved link or reachable file is structural evidence, not proof that behavior is correct.'
    ]
  };
}

export const scannerDefaults = DEFAULT_LIMITS;
