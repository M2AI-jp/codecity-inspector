import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { AUTHORING_CATEGORIES, CATEGORY_DIRS } from './config.mjs';

export function containedBy(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function validateAssetId(id) {
  if (typeof id !== 'string' || !/^(character|building|field|object|ui|effect)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/.test(id)) {
    throw new Error('Invalid asset id');
  }
  return id;
}

export function categoryDirectory(category) {
  if (!AUTHORING_CATEGORIES.includes(category)) throw new Error(`Unknown asset category: ${category}`);
  return CATEGORY_DIRS[category];
}

export function assetFileStem(assetId) {
  return validateAssetId(assetId).replaceAll('.', '_');
}

export function toPosixRelative(root, candidate) {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  if (!containedBy(absoluteRoot, absoluteCandidate)) throw new Error('Path escapes allowed root');
  return path.relative(absoluteRoot, absoluteCandidate).split(path.sep).join('/');
}

export function resolveWithin(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '' || path.isAbsolute(relativePath)
    || relativePath.includes('\0') || relativePath.includes('\\')) throw new Error('Unsafe relative path');
  const segments = relativePath.split('/');
  if (segments.some((part) => part === '' || part === '.' || part === '..')) throw new Error('Unsafe relative path');
  const candidate = path.resolve(root, ...segments);
  if (!containedBy(path.resolve(root), candidate)) throw new Error('Path escapes allowed root');
  return candidate;
}

export async function assertNoSymlinkPath(root, candidate, { allowMissingLeaf = false } = {}) {
  const absoluteRoot = path.resolve(root);
  if (!containedBy(absoluteRoot, path.resolve(candidate))) throw new Error('Path escapes allowed root');
  try {
    const rootStat = await lstat(absoluteRoot);
    if (rootStat.isSymbolicLink()) throw new Error('Symbolic links are not allowed');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const relative = path.relative(absoluteRoot, path.resolve(candidate));
  let current = absoluteRoot;
  const parts = relative.split(path.sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed');
    } catch (error) {
      const isLeaf = index === parts.length - 1;
      if (error?.code === 'ENOENT' && allowMissingLeaf) continue;
      throw error;
    }
  }
  return candidate;
}

export async function assertExistingFileWithin(root, relativePath) {
  const actualRoot = await realpath(root);
  const candidate = resolveWithin(actualRoot, relativePath);
  await assertNoSymlinkPath(actualRoot, candidate);
  const actual = await realpath(candidate);
  if (!containedBy(actualRoot, actual)) throw new Error('Path escapes allowed root');
  const stat = await lstat(actual);
  if (!stat.isFile()) throw new Error('Expected a file');
  return actual;
}

export async function assertExistingStateFile(root, category, state, forgeRelativePath) {
  if (!['pending', 'rejected', 'approved'].includes(state)) throw new Error('Unknown asset state');
  const prefix = `generated/${categoryDirectory(category)}/${state}/`;
  if (typeof forgeRelativePath !== 'string' || !forgeRelativePath.startsWith(prefix)) {
    throw new Error('Asset path does not match its category and state');
  }
  const suffix = forgeRelativePath.slice(prefix.length);
  if (!/^[a-z0-9_-]+\.png$/.test(suffix)) throw new Error('Asset state path must be a direct PNG filename');
  return assertExistingFileWithin(path.join(root, 'generated', categoryDirectory(category), state), suffix);
}

export async function assertExistingPendingCandidate(root, category, forgeRelativePath) {
  const generatedPrefix = `generated/${categoryDirectory(category)}/pending/`;
  const processedPrefix = `processed/${categoryDirectory(category)}/pending/`;
  let stateRoot;
  let suffix;
  if (forgeRelativePath?.startsWith(generatedPrefix)) {
    stateRoot = path.join(root, 'generated', categoryDirectory(category), 'pending');
    suffix = forgeRelativePath.slice(generatedPrefix.length);
  } else if (forgeRelativePath?.startsWith(processedPrefix)) {
    stateRoot = path.join(root, 'processed', categoryDirectory(category), 'pending');
    suffix = forgeRelativePath.slice(processedPrefix.length);
  } else {
    throw new Error('Candidate path does not match its category and pending state');
  }
  if (!/^[a-z0-9_-]+\.png$/.test(suffix)) throw new Error('Pending candidate path must be a direct PNG filename');
  return assertExistingFileWithin(stateRoot, suffix);
}
