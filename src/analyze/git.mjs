import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// 作業ツリーから読むときは、リポジトリ内の通常ファイルだけに限定する。
// 親ディレクトリの symlink も拒否して、解析対象の外へ解決される経路を残さない。
export function repoPath(root, rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  const base = resolve(root);
  const abs = resolve(base, rel);
  const fromRoot = relative(base, abs);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
  try {
    const rootStat = lstatSync(base);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
  } catch { return null; }
  let cur = base;
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

export function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, '-c', 'core.quotepath=false', ...args], {
      encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return null; }
}

export function unquote(p) {
  if (p.length > 1 && p.startsWith('"') && p.endsWith('"')) { try { return JSON.parse(p); } catch { return p.slice(1, -1); } }
  return p;
}
