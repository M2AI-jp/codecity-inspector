import path from 'node:path';

const MODULE_PATTERN = /^ship\/(\d{2})-[^/]+\//;
const IMPORT_PATTERN = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const ALLOWED_DEPENDENCIES = Object.freeze({
  '10': [],
  '20': ['10'],
  '30': ['10', '20'],
  '40': ['30'],
  '50': [],
  '60': ['40', '50'],
  '70': [],
  '80': [],
  '90': ['10', '20', '30', '40', '50', '60', '80']
});

function normalizeRepoPath(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

export function moduleNumber(filePath) {
  return normalizeRepoPath(filePath).match(MODULE_PATTERN)?.[1] ?? null;
}

export function importSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}

function resolvedRepoImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  return normalizeRepoPath(path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRepoPath(importer)), specifier)));
}

export function boundaryProblems(importer, source) {
  const normalizedImporter = normalizeRepoPath(importer);
  const owner = moduleNumber(normalizedImporter);
  const problems = [];

  if (normalizedImporter.startsWith('ship/') && source.includes('studio/')) {
    problems.push(`${normalizedImporter}: shipping code may not reference studio/`);
  }

  for (const specifier of importSpecifiers(source)) {
    if (specifier.startsWith('node:') || (!specifier.startsWith('.') && !specifier.startsWith('/'))) continue;
    const resolved = resolvedRepoImport(normalizedImporter, specifier);
    if (!resolved) continue;
    const target = moduleNumber(resolved);
    if (!owner || !target || owner === target) continue;

    if (!ALLOWED_DEPENDENCIES[owner]?.includes(target)) {
      problems.push(`${normalizedImporter}: module ${owner} may not import module ${target}`);
    }

    const expectedPublicEntry = new RegExp(`^ship/${target}-[^/]+/index\\.mjs$`);
    if (!expectedPublicEntry.test(resolved)) {
      problems.push(`${normalizedImporter}: cross-module import must resolve to module ${target} index.mjs`);
    }
  }

  return problems;
}

export const MODULE_DEPENDENCIES = ALLOWED_DEPENDENCIES;
