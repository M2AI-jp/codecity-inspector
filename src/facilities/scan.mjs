import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync, lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const SCAN_FILES = 2500;            // ソースを読むファイル数の上限
export const SCAN_BYTES = 16 << 20;        // ソースを読む合計バイト数の上限
export const SCAN_FILE_MAX = 256 << 10;    // これより大きいソースは読まない
export const RECOVERY_SCAN_BYTES = 16 << 20;   // 修理小屋のために読む shell・workflow・手順書の合計バイト数の上限
export const NONGIT_HEAD = 96 << 10;       // git でないとき、1ファイルの先頭だけ読む
export const TEST_RECORD_MAX = 1 << 20;    // テスト結果の記録も大きすぎるものは読まない
export const JUNIT_RECORD_MAX = 20;        // JUnit XML は数を絞る
export const READ_FILE_MAX = 1 << 20;      // 解析で読む1ファイルの上限
export const READ_BATCH_MAX = SCAN_BYTES;  // 1回の解析読込の合計上限

export const CODE_EXT = new Set('js mjs cjs ts mts cts jsx tsx py rb go rs php java kt swift ex exs cs'.split(' '));
const SCRIPT_EXT = new Set('sh bash zsh fish ps1 bat cmd make'.split(' '));
export const DOC_EXT = new Set('md markdown txt rst adoc org'.split(' '));
export const SKIP_DIR = /(^|\/)(node_modules|vendor|vendored|dist|build|\.next|coverage|third_party|external)\//;
export const NOT_PRODUCT = /(^|\/)(examples?|demos?|samples?|fixtures?|docs?|documentation|tests?|__tests__|specs?|e2e|cypress|playwright|benchmarks?)\//i;
export const TEST_DIR = /^(tests?|__tests__|specs?|e2e|cypress|playwright|testing)$/i;
export const TEST_FILE = /(\.(test|spec)\.[a-z0-9]+$)|(^test_[^/]*\.py$)|(_test\.(py|go|rb|exs)$)|(^conftest\.py$)|(Tests?\.(swift|java|kt|cs)$)/;

export const extOfPath = (path) => {
  const b = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1) : '';
};

export const automationPath = (path) => {
  const b = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return SCRIPT_EXT.has(extOfPath(path)) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path) ||
    /(^|\/)(scripts?|bin|tasks?|tools?|deploy|deployment|ops|ci)(\/|$)/i.test(path) ||
    /^(package\.json|makefile|gnumakefile|justfile|taskfile\.ya?ml|dockerfile|containerfile|procfile|.*\.ya?ml|.*\.yaml|.*\.toml)$/i.test(b);
};

export const migrationPath = (path) => /(^|\/)(migrations?|alembic)(\/|$)/i.test(path) || /\.down\.sql$/i.test(path);

// 作業ツリーから読むときは、リポジトリ内の通常ファイルだけに限定する。
// 親ディレクトリの symlink も拒否して、リポジトリの外へ解決される経路を残さない。
export function repoPath(root, rel, kind = 'file') {
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  const base = resolve(root);
  const abs = resolve(base, rel);
  const fromRoot = relative(base, abs);
  if (fromRoot && (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))) return null;
  try {
    const rootStat = lstatSync(base);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
  } catch { return null; }
  if (!fromRoot) {
    try {
      return kind === 'directory' ? base : null;
    } catch { return null; }
  }
  let cur = base;
  const parts = fromRoot.split(sep);
  for (let i = 0; i < parts.length; i++) {
    cur = join(cur, parts[i]);
    let st;
    try { st = lstatSync(cur); } catch { return null; }
    if (st.isSymbolicLink()) return null;
    if (i < parts.length - 1 && !st.isDirectory()) return null;
    if (i === parts.length - 1 && (kind === 'file' ? !st.isFile() : !st.isDirectory())) return null;
  }
  return abs;
}

// 中身を読む。パスは解析したディレクトリからの相対。
// （"HEAD:./p" は今いるディレクトリから。bare リポジトリには作業ディレクトリが無いので "HEAD:p"）
export function makeReader(root, isGit, bare) {
  return (paths) => {
    const out = new Map();
    if (!paths.length) return out;
    if (isGit) {
      let buf;
      try {
        buf = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
          input: paths.map((p) => `HEAD:${bare ? '' : './'}${p}`).join('\n') + '\n', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch { return out; }
      let pos = 0;
      for (const p of paths) {
        const nl = buf.indexOf(10, pos);
        if (nl < 0) break;
        const head = buf.toString('latin1', pos, nl).split(' ');
        pos = nl + 1;
        if (head[1] === 'missing' || head.length < 3) continue;
        const size = Number(head[2]);
        if (!Number.isSafeInteger(size) || size < 0 || size > READ_FILE_MAX || size > READ_BATCH_MAX) {
          pos += Math.max(0, size) + 1;
          continue;
        }
        out.set(p, buf.toString('utf8', pos, pos + size));
        pos += size + 1;
      }
      return out;
    }
    for (const p of paths) {
      const abs = repoPath(root, p, 'file');
      if (!abs) continue;
      let fd = null;
      try {
        fd = openSync(abs, 'r');
        const b = Buffer.alloc(NONGIT_HEAD);
        const n = readSync(fd, b, 0, b.length, 0);
        out.set(p, b.toString('utf8', 0, n));
      } catch { /* 読めないファイルは飛ばす */ }
      finally { if (fd !== null) { try { closeSync(fd); } catch {} } }
    }
    return out;
  };
}

// 修理小屋などが、件数とバイト数の上限の中で順に読むファイルを選ぶ。
export const pickWithinBudget = (paths, bytesOf, maxFiles, maxBytes) => {
  const out = [];
  let budget = maxBytes;
  for (const p of paths) {
    if (out.length >= maxFiles) break;
    const b = bytesOf(p);
    if (b > budget) continue;
    out.push(p); budget -= b;
  }
  return out;
};
