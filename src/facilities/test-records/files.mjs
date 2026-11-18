import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { JUNIT_RECORD_MAX, TEST_RECORD_MAX, repoPath } from '../scan.mjs';

// 記録の置き場・大きさ・追跡をここで確かめ、読む候補の順序を保つ。
export function recordFile(root, file) {
  try {
    const abs = repoPath(root, file, 'file');
    if (!abs) return null;
    const s = lstatSync(abs);
    if (!s.isFile() || s.size > TEST_RECORD_MAX) return null;
    return { file, abs, mtimeMs: s.mtimeMs, mtime: new Date(s.mtimeMs).toISOString() };
  } catch { return null; }
}

export function jsonAt(meta) {
  try { return JSON.parse(readFileSync(meta.abs, 'utf8')); } catch { return null; }
}

export function junitFiles(root) {
  const found = [];
  const add = (dir, re) => {
    if (found.length >= JUNIT_RECORD_MAX) return;
    const abs = repoPath(root, dir, 'directory');
    if (!abs) return;
    try {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        if (found.length >= JUNIT_RECORD_MAX) return;
        if (!e.isFile() || !re.test(e.name)) continue;
        const file = dir === '.' ? e.name : `${dir}/${e.name}`;
        if (repoPath(root, file, 'file')) found.push(file);
      }
    } catch { /* 記録の置き場が無い街もある */ }
  };
  add('test-results', /\.xml$/i);
  add('reports', /^junit.*\.xml$/i);
  add('.', /^junit.*\.xml$/i);
  add('test-reports', /\.xml$/i);
  return [...new Set(found)].sort().slice(0, JUNIT_RECORD_MAX);
}

export function isTrackedRecord(root, file, extra) {
  if (!extra?.isGit || typeof extra.git !== 'function') return false;
  return !!extra.git(['ls-files', '--error-unmatch', '--', file])?.trim();
}
