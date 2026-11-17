import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { MAX_TEXT_BYTES, MAX_READ_FILES, MAX_WALK_FILES } from './constants.mjs';
import { git, repoPath } from './git.mjs';

const BINARY_EXT = new Set(('png jpg jpeg gif webp bmp ico icns tif tiff psd ai sketch fig pdf zip gz tgz bz2 xz 7z rar ' +
  'jar war class so dylib dll exe o a lib bin dat db sqlite sqlite3 woff woff2 ttf otf eot mp3 mp4 m4a wav ogg flac ' +
  'mov avi mkv webm wasm pyc node glb fbx blend heic aseprite').split(' '));
const CONFIG_EXT = new Set('json jsonc json5 yml yaml toml ini cfg conf env properties lock plist editorconfig'.split(' '));
const CONFIG_NAME = /(^\.|(^|[.-])(settings|config|conf|rc)\.(json|jsonc|json5)$)/i;
export const isConfig = (f) => CONFIG_EXT.has(f.ext) && ((f.ext !== 'json' && f.ext !== 'lock') || CONFIG_NAME.test(basename(f.path)))
  || (f.ext === 'none' && basename(f.path).startsWith('.'));

// 本物の env ファイル（.env・.env.local・.env.production など。見本の .env.example などは除く）
const SECRET_FILE = { test: (b) => /^\.env(\.[\w.-]+)?$/i.test(b) && !/[.-](example|sample|template|dist|tmpl|tpl|defaults?)$/i.test(b) && !/^\.env\.vault$/i.test(b) };

const extOf = (p) => extname(p).slice(1).toLowerCase() || 'none';

function countLines(buf) {
  let n = 0;
  for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) n++;
  if (buf.length && buf[buf.length - 1] !== 10) n++;
  return n;
}

// ---------- ファイル一覧 ----------
// git なら HEAD のツリーと、空のツリーとの差分の行数を使う（作業ツリーのファイルを開かないので速く、
// 同じコミットからは同じ結果になる）。
export function gitFiles(root) {
  const tree = git(root, ['ls-tree', '-r', '-l', '-z', 'HEAD']);
  if (tree == null) return null;
  const files = new Map();
  for (const rec of tree.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, , size] = rec.slice(0, tab).split(/\s+/);
    if (type !== 'blob' || mode === '120000') continue;     // submodule・symlink は数えない
    const p = rec.slice(tab + 1);
    const ext = extOf(p);
    files.set(p, { path: p, ext, bytes: Number(size) || 0, lines: 0, binary: BINARY_EXT.has(ext) });
  }
  const empty = git(root, ['hash-object', '-t', 'tree', '/dev/null'])?.trim() || '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const num = git(root, ['diff', '--numstat', '-z', '--no-renames', '--relative', empty, 'HEAD']) || '';
  for (const rec of num.split('\0')) {
    const t1 = rec.indexOf('\t'), t2 = rec.indexOf('\t', t1 + 1);
    if (t1 < 0 || t2 < 0) continue;
    const f = files.get(rec.slice(t2 + 1));
    if (!f) continue;
    const added = rec.slice(0, t1);
    if (added === '-') f.binary = true;
    else if (!f.binary) f.lines = Number(added) || 0;
  }
  return [...files.values()];
}

// git でないとき: ディレクトリを歩いてファイルを読む
export function walkFiles(root) {
  const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', '.next', '.cache', 'coverage', '__pycache__', 'target', '.venv', 'venv']);
  const result = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (result.length >= MAX_WALK_FILES) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(dir, e.name), r); }
      else if (e.isFile()) result.push(r);
    }
  };
  walk(root, '');
  return readFiles(root, result);
}

function readFiles(root, paths) {
  const files = [];
  let read = 0, textBytes = 0, textLines = 0;
  const unread = [];
  for (const p of paths) {
    let st;
    const abs = repoPath(root, p);
    if (!abs) continue;                                                // 作業ツリーで削除済み・symlink・ディレクトリ
    try { st = lstatSync(abs); } catch { continue; }                   // 作業ツリーで削除済み
    const ext = extOf(p);
    const f = { path: p, ext, bytes: st.size, lines: 0, binary: false };
    if (SECRET_FILE.test(basename(p))) { files.push(f); continue; }  // 秘密が入っているかもしれないファイルは開かない（行数も数えない）
    if (BINARY_EXT.has(ext) || st.size > MAX_TEXT_BYTES) f.binary = true;
    else if (read >= MAX_READ_FILES) unread.push(f);
    else {
      let buf;
      try { buf = readFileSync(abs); } catch { buf = null; }
      read++;
      if (!buf || buf.subarray(0, 8000).includes(0)) f.binary = true;
      else { f.lines = countLines(buf); textBytes += buf.length; textLines += f.lines; }
    }
    files.push(f);
  }
  const bpl = textLines ? textBytes / textLines : 40;
  for (const f of unread) f.lines = Math.round(f.bytes / bpl);   // 上限を超えた分は平均の1行あたりバイト数から推定
  return files;
}

// 中身を読むのは README と package.json だけ。git なら HEAD の内容を読む
export function makeTextReader(root, fromGit, bare) {
  return (p) => {
    if (fromGit) return git(root, ['show', `HEAD:${bare ? '' : './'}${p}`]);
    const abs = repoPath(root, p);
    if (!abs) return null;
    try {
      const st = lstatSync(abs);
      if (st.size > MAX_TEXT_BYTES) return null;
      return readFileSync(abs, 'utf8');
    } catch { return null; }
  };
}
