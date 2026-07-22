import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AUTHORING_CATEGORIES, CATEGORY_DIRS } from './config.mjs';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const hashFile = async (filePath) => sha256(await readFile(filePath));

export function canonicalJson(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

export async function hashTree(root) {
  const entries = [];
  const walk = async (dir) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) entries.push([path.relative(root, full), await hashFile(full)]);
      else entries.push([path.relative(root, full), `unsupported:${entry.isSymbolicLink() ? 'symlink' : 'other'}`]);
    }
  };
  try { await walk(root); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return sha256(canonicalJson(entries));
}

export async function hashApprovedTree(root) {
  const categoryHashes = [];
  for (const category of AUTHORING_CATEGORIES) {
    const directory = CATEGORY_DIRS[category];
    categoryHashes.push([directory, await hashTree(path.join(root, 'generated', directory, 'approved'))]);
  }
  return sha256(canonicalJson(categoryHashes));
}
