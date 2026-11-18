import fs from 'node:fs';
import path from 'node:path';

// Keep paths, sorted input lists and warnings local to one manifest build.
export function createSource(GAME) {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const rel = (abs) => path.relative(GAME, abs).split(path.sep).join('/');
  const list = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : []);

  function readJSON(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { warn(`${rel(file)}: JSON を読めません (${e.message})`); return null; }
  }
  return { GAME, warnings, warn, rel, list, readJSON };
}

export const isBox = (a) => Array.isArray(a) && a.length >= 4 && a.slice(0, 4).every(Number.isFinite);
export const isLight = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every(Number.isFinite);
export const isPt = (a) => Array.isArray(a) && a.length >= 2 && a.slice(0, 2).every(Number.isFinite);
