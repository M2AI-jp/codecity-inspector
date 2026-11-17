// リポジトリの通常ファイルだけを読む。
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MAX_FILES, MAX_READ, SKIP_DIR } from './constants.mjs';

function git(root, args, max = 64 * 1024 * 1024) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: max, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}

// 作業ツリーから読むときは、リポジトリ内の通常ファイルだけに限定する。
// 親ディレクトリの symlink も拒否し、/dev/stdin・/dev/zero などの外部特殊ファイルを開かない。
function repoFile(root, rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  const baseRoot = resolve(root);
  const abs = resolve(baseRoot, rel);
  const fromRoot = relative(baseRoot, abs);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
  try {
    const rootStat = lstatSync(baseRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
  } catch { return null; }
  let cur = baseRoot;
  const parts = fromRoot.split(sep);
  for (let i = 0; i < parts.length; i++) {
    cur = join(cur, parts[i]);
    let st;
    try { st = lstatSync(cur); } catch { return null; }
    if (st.isSymbolicLink()) return null;
    if (i < parts.length - 1 && !st.isDirectory()) return null;
    if (i === parts.length - 1 && !st.isFile()) return null;
  }
  return abs;
}

function listFiles(root) {
  const out = git(root, ['ls-files', '-z']);
  if (out != null) return out.split('\0').filter(Boolean).slice(0, MAX_FILES).filter((p) => repoFile(root, p));
  // git でなければ浅く歩く
  const files = [];
  const walk = (rel, depth) => {
    if (files.length >= 20000 || depth > 4) return;
    let ents;
    try { ents = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!e.name.startsWith('.') || e.name === '.github') { if (!SKIP_DIR.test(p)) walk(p, depth + 1); } }
      else if (e.isFile()) files.push(p);
    }
  };
  walk('', 0);
  return files;
}

function readText(root, rel) {
  try {
    const abs = repoFile(root, rel);
    if (!abs) return null;
    const st = lstatSync(abs);
    if (st.size > MAX_READ) return null;
    return readFileSync(abs, 'utf8');
  } catch { return null; }
}

const depth = (p) => p.split('/').length - 1;
const base = (p) => p.slice(p.lastIndexOf('/') + 1);

export { listFiles, readText, depth, base };
