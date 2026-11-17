import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { MAX_COMMITS, MAX_TEXT_BYTES } from './constants.mjs';
import { git, repoPath, unquote } from './git.mjs';
import { agentsOfCommit } from './authors.mjs';

// ---------- git 履歴 ----------
// grafts: 浅いクローンの境界コミット（完全なハッシュ）。親が無いように見えるだけなので、ファイル一覧は使わない
// 本文（%b）は外部エージェントの印を探すためだけに読み、持ち続けない
export function readHistory(root, extra = ['--', '.'], maxCommits = MAX_COMMITS, grafts = []) {
  const args = [...extra];
  if (!args.includes('-n') && !args.includes('--max-count')) {
    args.unshift('-n', String(maxCommits));
  }
  const r = spawnSync('git', ['-C', root, '-c', 'core.quotepath=false', 'log', '--no-merges', '--no-renames',
    '--format=%x1e%h%x1f%cI%x1f%aN%x1f%aE%x1f%s%x1f%b%x1f', '--name-only', '--relative', ...args],
  { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
  const out = r.stdout || '';
  const commits = [];
  const recs = out.split('\x1e');
  if (r.error && recs.length > 1) recs.pop();      // 途中で切れた最後の1件は捨てる
  for (const rec of recs) {
    if (!rec) continue;
    // ファイル名に生の \x1f は出てこない（制御文字は git が引用する）ので、最後の \x1f の後ろがファイル一覧
    const end = rec.lastIndexOf('\x1f');
    if (end < 0) continue;
    const f = rec.split('\x1f', 5);
    const [hash, date, author = '', email = '', subject = ''] = f;
    if (!date) continue;
    const bodyStart = f.reduce((n, s) => n + s.length + 1, 0);
    const body = bodyStart <= end ? rec.slice(bodyStart, end) : '';
    const cut = grafts.length && grafts.some((h) => h.startsWith(hash));
    const files = cut ? [] : rec.slice(end + 1).split('\n').filter(Boolean).map(unquote);
    // メールアドレスはエージェントを見分けるためだけに使い、持ち続けない
    const { agents, byAuthor } = agentsOfCommit(author, email, subject, body);
    commits.push({ hash, date, author, subject, files, ...(agents.length ? { agents } : {}), ...(byAuthor ? { byAgent: byAuthor } : {}) });
  }
  return commits;
}

// 作業ツリーで HEAD と違うファイル（変更・追加・削除・無視されていない未追跡）。解析したディレクトリからの相対パス。
// bare リポジトリ・作業ツリーでないときは null。git status は索引を書きかえないよう --no-optional-locks で読む
export function dirtyFiles(root, bare) {
  if (bare) return null;
  const prefix = git(root, ['rev-parse', '--show-prefix'])?.trim() ?? '';
  const out = git(root, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', '.']);
  if (out == null) return null;
  const paths = [];
  for (const rec of out.split('\0')) {
    if (rec.length < 4) continue;
    let p = rec.slice(3);                       // "XY path"（porcelain のパスはリポジトリのルートから）
    if (prefix) { if (!p.startsWith(prefix)) continue; p = p.slice(prefix.length); }
    if (p.endsWith('/')) p = p.slice(0, -1);    // 中身ごと変わった submodule など
    if (p) paths.push(p);
  }
  return paths;
}

// 浅いクローン（git clone --depth）: 境界のコミットは全ファイルを足したように見えるので、ファイルの帰属に使わない
export function readShallow(root, head) {
  const shallow = !!head && git(root, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true';
  let grafts = [];
  if (shallow) {
    const sp = git(root, ['rev-parse', '--git-path', 'shallow'])?.trim();
    const shallowPath = sp ? repoPath(root, sp) : null;
    try {
      if (!shallowPath || lstatSync(shallowPath).size > MAX_TEXT_BYTES) throw new Error('unsafe shallow file');
      grafts = readFileSync(shallowPath, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
    } catch {}
  }
  return { shallow, grafts };
}

// 古さの基準は、HEAD の現在位置に来た時刻・最新コミット・
// 記録していない作業ツリーの変更時刻の最大（同じ状態なら同じ結果）。
export function referenceTime(root, isGit, head, latestTime, dirty) {
  const reflogSeconds = isGit && head ? Number(git(root, ['reflog', '-1', '--format=%ct', 'HEAD'])?.trim()) : NaN;
  const headTime = Number.isFinite(reflogSeconds) && reflogSeconds > 0 ? reflogSeconds * 1000 : latestTime;
  const recordPath = (p) => /^(?:test-results\/\.last-run\.json|\.pytest_cache\/v\/cache\/lastfailed|node_modules\/\.vitest\/results\.json|node_modules\/\.vite\/vitest\/results\.json|test-results\/[^/]+\.xml|reports\/junit[^/]+\.xml|junit[^/]+\.xml|test-reports\/[^/]+\.xml)$/i.test(p);
  let dirtyTime = 0;
  for (const p of dirty || []) {
    if (recordPath(p)) continue;
    const abs = repoPath(root, p);
    if (!abs) continue;
    try { dirtyTime = Math.max(dirtyTime, lstatSync(abs).mtimeMs); } catch {}
  }
  return Math.max(latestTime, headTime, dirtyTime);
}
