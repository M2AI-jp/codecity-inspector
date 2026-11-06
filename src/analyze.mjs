// リポジトリ → RepoModel（CONTRACTS.md）。Node標準ライブラリのみ。
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { detectFacilities } from './facilities.mjs';

const MAX_COMMITS = 5000;          // git log を読む上限
const MAX_TEXT_BYTES = 1 << 20;    // これより大きいファイルは行数を数えない
const MAX_READ_FILES = 40000;      // 行数を数えるファイル数の上限（以降はバイト数から推定）
const MAX_WALK_FILES = 100000;     // git が無いときに歩くファイル数の上限
const SPLIT_AT = [0, 40, 120];     // 深さごとの「分割する」ファイル数
const DAY = 86400000;

const BINARY_EXT = new Set(('png jpg jpeg gif webp bmp ico icns tif tiff psd ai sketch fig pdf zip gz tgz bz2 xz 7z rar ' +
  'jar war class so dylib dll exe o a lib bin dat db sqlite sqlite3 woff woff2 ttf otf eot mp3 mp4 m4a wav ogg flac ' +
  'mov avi mkv webm wasm pyc node glb fbx blend heic aseprite').split(' '));
const UI_EXT = new Set('css scss sass less styl html htm jsx tsx vue svelte astro hbs handlebars ejs pug njk liquid twig'.split(' '));
const CONFIG_EXT = new Set('json jsonc json5 yml yaml toml ini cfg conf env properties lock plist editorconfig'.split(' '));
const DOC_EXT = new Set('md markdown txt rst adoc org'.split(' '));
const IMAGE_EXT = new Set('png jpg jpeg gif webp bmp ico icns svg tif tiff psd aseprite'.split(' '));
const DATA_EXT = new Set('json jsonl ndjson log csv tsv xml parquet dat db sqlite sqlite3'.split(' '));
const CONFIG_NAME = /(^\.|(^|[.-])(settings|config|conf|rc)\.(json|jsonc|json5)$)/i;
const isConfig = (f) => CONFIG_EXT.has(f.ext) && ((f.ext !== 'json' && f.ext !== 'lock') || CONFIG_NAME.test(basename(f.path)))
  || (f.ext === 'none' && basename(f.path).startsWith('.'));

const RUIN_WORD = /(^|[-_. ])(legacy|deprecated|old|archive|archived|attic|obsolete)([-_. ]|$)/i;
const WORKSHOP_DIRS = new Set(['scripts', 'script', 'tools', 'tool', 'bin', 'ci', '.github', '.circleci', '.gitlab',
  '.buildkite', '.devcontainer', '.vscode', '.idea', '.husky', '.claude', '.cursor', 'docker', 'deploy', 'deployment',
  'infra', 'infrastructure', 'devtools', 'tasks', 'cmake', 'config', 'configs', '.config', 'ops', 'k8s', 'helm',
  'terraform', 'workflows', 'build-tools']);
const SHOP_DIRS = new Set(['components', 'component', 'ui', 'views', 'view', 'pages', 'page', 'web', 'www', 'frontend',
  'front', 'client', 'styles', 'style', 'css', 'public', 'static', 'assets', 'templates', 'layouts', 'screens',
  'widgets', 'theme', 'themes', 'icons', 'fonts', 'images', 'img']);
const BUILD_FILES = /^(makefile|gnumakefile|dockerfile|containerfile|docker-compose\.ya?ml|compose\.ya?ml|jenkinsfile|procfile|justfile|taskfile\.ya?ml|rakefile|gemfile|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|pom\.xml|cmakelists\.txt|meson\.build|build\.zig|cargo\.toml|go\.mod|pyproject\.toml|setup\.py|setup\.cfg|requirements(-[\w]+)?\.txt|tox\.ini|noxfile\.py|flake\.nix|shell\.nix|\.gitlab-ci\.yml|\.travis\.yml|azure-pipelines\.yml|netlify\.toml|vercel\.json|wrangler\.toml|tsconfig(\.[\w-]+)?\.json|jsconfig\.json|(vite|vitest|webpack|rollup|esbuild|babel|jest|playwright|eslint|prettier|tailwind|postcss|svelte|next|nuxt|astro)\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?|\.prettierrc(\.\w+)?|\.babelrc|\.nvmrc|\.node-version|\.tool-versions|\.editorconfig|\.dockerignore|\.npmrc|\.env\.example|\.devcontainer\.json)$/i;

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const scrub = (s) => String(s ?? '').replace(EMAIL, '').replace(/<\s*>/g, '').replace(/\s+/g, ' ').trim();

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, '-c', 'core.quotepath=false', ...args], {
      encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return null; }
}

function unquote(p) {
  if (p.length > 1 && p.startsWith('"') && p.endsWith('"')) { try { return JSON.parse(p); } catch { return p.slice(1, -1); } }
  return p;
}

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
function gitFiles(root) {
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
function walkFiles(root) {
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
    try { st = lstatSync(join(root, p)); } catch { continue; }      // 作業ツリーで削除済み
    if (!st.isFile()) continue;                                       // submodule・symlink
    const ext = extOf(p);
    const f = { path: p, ext, bytes: st.size, lines: 0, binary: false };
    if (BINARY_EXT.has(ext) || st.size > MAX_TEXT_BYTES) f.binary = true;
    else if (read >= MAX_READ_FILES) unread.push(f);
    else {
      let buf;
      try { buf = readFileSync(join(root, p)); } catch { buf = null; }
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

// ---------- ディレクトリ → モジュール ----------
function buildTree(files) {
  const root = { path: '', name: '', depth: 0, files: [], children: new Map(), count: 0 };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    node.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      let c = node.children.get(parts[i]);
      if (!c) {
        c = { path: parts.slice(0, i + 1).join('/'), name: parts[i], depth: i + 1, files: [], children: new Map(), count: 0 };
        node.children.set(parts[i], c);
      }
      node = c;
      node.count++;
    }
    node.files.push(f);
  }
  return root;
}

function collect(node, out = []) {
  out.push(...node.files);
  for (const c of node.children.values()) collect(c, out);
  return out;
}
const sortedKids = (node) => [...node.children.values()].sort((a, b) => (a.name < b.name ? -1 : 1));

function groupModules(tree) {
  const groups = [];
  if (tree.files.length) groups.push({ path: '.', files: [...tree.files], node: null });
  const split = (node, minKid) => {
    const own = [...node.files];
    const kids = [];
    for (const c of sortedKids(node)) { if (c.count < minKid) collect(c, own); else kids.push(c); }
    if (kids.length + (own.length ? 1 : 0) < 2) return null;
    return { own, kids };
  };
  const visit = (node) => {
    const s = node.depth < SPLIT_AT.length && node.count > SPLIT_AT[node.depth] ? split(node, 3) : null;
    if (!s) { groups.push({ path: node.path, files: collect(node), node }); return; }
    if (s.own.length) groups.push({ path: node.path, files: s.own, node: null });
    for (const k of s.kids) visit(k);
  };
  for (const c of sortedKids(tree)) visit(c);
  // 小さなリポジトリでも街になるよう、モジュールが少なければ大きいディレクトリから分ける
  for (let guard = 0; groups.length < 6 && guard < 20; guard++) {
    const cand = groups.filter((g) => g.node && g.node.children.size > 0 && g.node.depth < 5)
      .sort((a, b) => b.files.length - a.files.length || (a.path < b.path ? -1 : 1));
    let done = false;
    for (const g of cand) {
      const s = split(g.node, 1);
      if (!s) continue;
      groups.splice(groups.indexOf(g), 1);
      if (s.own.length) groups.push({ path: g.path, files: s.own, node: null });
      for (const k of s.kids) groups.push({ path: k.path, files: collect(k), node: k });
      done = true;
      break;
    }
    if (!done) break;
  }
  groups.sort((a, b) => (a.path === '.' ? -1 : b.path === '.' ? 1 : a.path < b.path ? -1 : 1));
  return groups;
}

// ---------- git 履歴 ----------
// grafts: 浅いクローンの境界コミット（完全なハッシュ）。親が無いように見えるだけなので、ファイル一覧は使わない
function readHistory(root, extra = ['-n', String(MAX_COMMITS), '--', '.'], timeout = 0, grafts = []) {
  // 時間切れでも、それまでに読めた分は使う
  const r = spawnSync('git', ['-C', root, '-c', 'core.quotepath=false', 'log', '--no-merges', '--no-renames',
    '--format=%x1e%h%x1f%cI%x1f%aN%x1f%s', '--name-only', '--relative', ...extra],
  { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'], timeout });
  const out = r.stdout || '';
  const commits = [];
  const recs = out.split('\x1e');
  if (r.error && recs.length > 1) recs.pop();      // 途中で切れた最後の1件は捨てる
  for (const rec of recs) {
    if (!rec) continue;
    const nl = rec.indexOf('\n');
    const head = nl === -1 ? rec : rec.slice(0, nl);
    const [hash, date, author, subject] = head.split('\x1f');
    if (!date) continue;
    const cut = grafts.length && grafts.some((h) => h.startsWith(hash));
    const files = nl === -1 || cut ? [] : rec.slice(nl + 1).split('\n').filter(Boolean).map(unquote);
    commits.push({ hash, date, author: author ?? '', subject: subject ?? '', files });
  }
  return commits;
}

// 名前の表記ゆれ（大文字小文字）をまとめ、メールアドレスは取り除く
function authorKeyer() {
  const variants = new Map();   // key -> Map(display -> count)
  return {
    key(name) {
      let n = scrub(String(name).replace(/@.*$/, '')) || '(名前なし)';
      const k = n.toLowerCase();
      if (!variants.has(k)) variants.set(k, new Map());
      const m = variants.get(k);
      m.set(n, (m.get(n) || 0) + 1);
      return k;
    },
    display(k) {
      const m = variants.get(k);
      return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    },
  };
}

// ---------- README ----------
function cleanMd(s) {
  return scrub(s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/^[>*+-]\s+/, ''));
}

function parseReadme(root, rootFiles, readText) {
  const cands = rootFiles.filter((f) => /^readme(\.(md|markdown|txt|rst|adoc))?$/i.test(f.path));
  if (!cands.length) return null;
  cands.sort((a, b) => (/\.md$/i.test(b.path) ? 1 : 0) - (/\.md$/i.test(a.path) ? 1 : 0));
  const text = readText(cands[0].path);
  if (text == null) return null;
  const lines = text.replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  let title = null;
  const para = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^(```|~~~)/.test(line)) { inCode = !inCode; if (para.length) break; continue; }
    if (inCode) continue;
    const atx = line.match(/^#{1,6}\s+(.*?)\s*#*$/);
    const setext = !atx && line && /^(=+|-+)$/.test((lines[i + 1] || '').trim());
    if (atx || setext) {
      if (para.length) break;
      if (!title) title = cleanMd(atx ? atx[1] : line);
      if (setext) i++;
      continue;
    }
    if (!line) { if (para.length) break; continue; }
    if (/^(<|!\[|\[!\[|\||-{3,}|={3,}|\*{3,})/.test(line)) { if (para.length) break; continue; }
    const c = cleanMd(line);
    if (!c) continue;
    if (!title) { title = c; continue; }
    para.push(c);
  }
  let excerpt = para.join(' ');
  const chars = Array.from(excerpt);
  if (chars.length > 300) excerpt = chars.slice(0, 299).join('') + '…';
  return { title: title || basename(root), excerpt };
}

// ---------- 種類の判定 ----------
function topCounts(obj, n = 3) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}
const fmtCounts = (pairs) => pairs.map(([k, v]) => `${k === 'none' ? '拡張子なし' : '.' + k} ${v}件`).join('、');
const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '');

function classify(mod, files, ctx) {
  const segs = mod.path === '.' ? [] : mod.path.split('/');
  const ruinSeg = segs.find((s) => RUIN_WORD.test(s));
  if (ruinSeg) return ['ruin', `パス名に「${ruinSeg}」を含む（古い・退避された領域を示す名前）`];

  if (ctx.ruinByAge(mod)) {
    const days = Math.round((ctx.refTime - Date.parse(mod.lastCommit.date)) / DAY);
    return ['ruin', `最終更新は ${fmtDate(mod.lastCommit.date)} で、最新コミットより ${days} 日前（全モジュールで古い方の25%）`];
  }

  // 一番具体的なディレクトリ名から見る
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i].toLowerCase();
    if (WORKSHOP_DIRS.has(s)) return ['workshop', `ディレクトリ名「${segs[i]}」はビルド・CI・開発環境の場所を示す`];
    if (SHOP_DIRS.has(s)) return ['shop', `ディレクトリ名「${segs[i]}」は UI の領域を示す`];
  }

  const ev = [];
  const cat = { build: 0, config: 0, docs: 0, ui: 0, code: 0, images: 0, data: 0, binary: 0 };
  const catExt = Object.create(null);   // 拡張子をキーにする（constructor・__proto__ という拡張子でも壊れない）
  for (const f of files) {
    const b = basename(f.path);
    let c;
    if (BUILD_FILES.test(b) || /(^|\/)\.github\/workflows\//.test(f.path) || (b === 'package.json' && ctx.hasScripts(f.path))) {
      c = 'build';
      const label = /\.github\/workflows\//.test(f.path) ? '.github/workflows' : b === 'package.json' ? 'package.json の scripts' : b;
      if (!ev.includes(label) && ev.length < 3) ev.push(label);
    } else if (isConfig(f)) c = 'config';
    else if (DOC_EXT.has(f.ext) || /^(license|licence|copying|notice|authors|changelog)/i.test(b)) c = 'docs';
    else if (UI_EXT.has(f.ext)) c = 'ui';
    else if (IMAGE_EXT.has(f.ext)) c = 'images';
    else if (DATA_EXT.has(f.ext) || f.ext === 'lock') c = 'data';
    else if (f.binary) c = 'binary';
    else c = 'code';
    cat[c]++;
    (catExt[c] ??= Object.create(null))[f.ext] = (catExt[c][f.ext] || 0) + 1;
  }
  const { build, config, ui, code } = cat;
  if (build > 0 && build + config >= code + ui) return ['workshop', `${ev.join('、')} を含む（ビルド・開発環境の設定が中心）`];
  if (files.length && config === files.length) {
    return ['workshop', `設定ファイルだけでできている（${fmtCounts(topCounts(catExt.config, 2))}）`];
  }
  if (ui >= 2 && ui >= code) {
    return ['shop', `UI のファイルが ${ui}/${ui + code} 件（${fmtCounts(topCounts(catExt.ui, 2))}）`];
  }
  const LABEL = { code: 'コード', docs: '文書', images: '画像', data: 'データ', config: '設定', binary: 'バイナリ', build: 'ビルド設定', ui: 'UI' };
  const top = Object.entries(cat).sort((a, b) => b[1] - a[1])[0][0];
  const what = LABEL[top];
  const cited = fmtCounts(topCounts(catExt[top] || mod.languages, 2));
  return ['house', `${what}が中心の領域（${cited}）。UI・ビルド・古さの特徴はない`];
}

// ---------- 本体 ----------
export function analyzeRepository(rootPath) {
  const root = resolve(rootPath);
  const name = basename(root);
  // bare リポジトリ（作業ツリーなし）も HEAD から読む（objects/ などの git の中身を街にしない）
  const bare = git(root, ['rev-parse', '--is-bare-repository'])?.trim() === 'true';
  const isGit = bare || git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
  const head = isGit ? git(root, ['rev-parse', '--short', 'HEAD'])?.trim() || null : null;
  let branch = isGit ? git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() || null : null;
  if (branch === 'HEAD') branch = null;

  const fromGit = isGit && head ? gitFiles(root) : null;
  const files = fromGit ?? walkFiles(root);
  // 中身を読むのは README と package.json だけ。git なら HEAD の内容を読む
  const readText = (p) => {
    if (fromGit) return git(root, ['show', `HEAD:${bare ? '' : './'}${p}`]);
    try { return readFileSync(join(root, p), 'utf8'); } catch { return null; }
  };
  const tree = buildTree(files);
  const groups = groupModules(tree);

  // パス → モジュール（親をさかのぼって探す。ルート直下のファイルだけが "."）
  const byKey = new Map(groups.map((g, i) => [g.path === '.' ? '' : g.path, i]));
  const ownerOf = (p) => {
    if (!p.includes('/')) return byKey.get('');
    let d = p;
    for (let j = d.lastIndexOf('/'); j > 0; j = d.lastIndexOf('/')) {
      d = d.slice(0, j);
      const i = byKey.get(d);
      if (i !== undefined) return i;
    }
    return undefined;
  };

  // 浅いクローン（git clone --depth）: 境界のコミットは全ファイルを足したように見えるので、ファイルの帰属に使わない
  const shallow = !!head && git(root, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true';
  let grafts = [];
  if (shallow) {
    const sp = git(root, ['rev-parse', '--git-path', 'shallow'])?.trim();
    try { grafts = readFileSync(resolve(root, sp), 'utf8').split('\n').map((x) => x.trim()).filter(Boolean); } catch {}
  }
  const history = isGit && head ? readHistory(root, undefined, 0, grafts) : [];
  const keyer = authorKeyer();
  const stats = groups.map(() => ({ commits: 0, recent: 0, last: null, authors: new Map() }));
  // 「最近」は今日ではなくリポジトリの最新コミットから90日（同じコミットなら同じ結果）
  const latestTime = history.length ? Date.parse(history[0].date) : 0;
  const people = new Map();   // key -> { commits, touches: Map(moduleIdx -> n), last: 最新のコミット }
  for (const c of history) {
    const k = keyer.key(c.author);
    c.key = k;
    if (!people.has(k)) people.set(k, { commits: 0, touches: new Map(), last: c });   // 履歴は新しい順なので最初の1件が最新
    const person = people.get(k);
    person.commits++;
    const mods = new Set();
    for (const f of c.files) { const i = ownerOf(f); if (i !== undefined) mods.add(i); }
    const recent = latestTime - Date.parse(c.date) <= 90 * DAY;
    for (const i of mods) {
      const s = stats[i];
      s.commits++;
      if (recent) s.recent++;
      if (!s.last) s.last = c;
      s.authors.set(k, (s.authors.get(k) || 0) + 1);
      person.touches.set(i, (person.touches.get(i) || 0) + 1);
    }
  }
  // 直近の履歴に出てこないモジュールは、それより古い履歴をそのパスだけに絞って1回でたどる（時間の上限つき）
  if (history.length >= MAX_COMMITS) {
    const missing = groups.map((g, i) => i).filter((i) => !stats[i].last);
    const paths = missing.flatMap((i) => (groups[i].path === '.' ? groups[i].files.map((f) => f.path) : [groups[i].path])).slice(0, 400);
    if (paths.length) {
      for (const c of readHistory(root, ['--skip', String(MAX_COMMITS), '--', ...paths], 1500, grafts)) {
        const k = keyer.key(c.author);
        const mods = new Set();
        for (const f of c.files) { const i = ownerOf(f); if (i !== undefined && missing.includes(i)) mods.add(i); }
        for (const i of mods) {
          const s = stats[i];
          s.commits++;
          if (!s.last) s.last = { ...c, key: k };
          s.authors.set(k, (s.authors.get(k) || 0) + 1);
        }
      }
    }
  }

  const modules = groups.map((g, i) => {
    const languages = Object.create(null);
    let lines = 0, bytes = 0;
    for (const f of g.files) { languages[f.ext] = (languages[f.ext] || 0) + 1; lines += f.lines; bytes += f.bytes; }
    const s = stats[i];
    return {
      path: g.path, kind: 'house', reason: '',
      files: g.files.length, lines, bytes,
      languages: Object.fromEntries(topCounts(languages, 99)),
      lastCommit: s.last ? { hash: s.last.hash, date: s.last.date, author: keyer.display(s.last.key), subject: scrub(s.last.subject) } : null,
      commits: s.commits,
      recent: s.recent,
      authors: [...s.authors.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10)
        .map(([k, n]) => ({ name: keyer.display(k), commits: n })),
      topFiles: [...g.files].sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : 1)).slice(0, 8)
        .map((f) => ({ path: f.path, lines: f.lines })),
    };
  });

  // 古さの基準は「今日」ではなくリポジトリの最新コミット（同じコミットなら同じ結果）
  const refTime = history.length ? Date.parse(history[0].date) : 0;
  const dated = modules.filter((m) => m.lastCommit).map((m) => Date.parse(m.lastCommit.date)).sort((a, b) => a - b);
  const q25 = dated.length >= 4 ? dated[Math.floor((dated.length - 1) * 0.25)] : -Infinity;
  const pkgCache = new Map();
  const ctx = {
    refTime,
    ruinByAge: (m) => m.lastCommit && Date.parse(m.lastCommit.date) <= q25 && refTime - Date.parse(m.lastCommit.date) > 180 * DAY,
    hasScripts: (p) => {
      if (!pkgCache.has(p)) {
        let ok = false;
        try { const j = JSON.parse(readText(p)); ok = !!j.scripts && Object.keys(j.scripts).length > 0; } catch {}
        pkgCache.set(p, ok);
      }
      return pkgCache.get(p);
    },
  };
  modules.forEach((m, i) => { [m.kind, m.reason] = classify(m, groups[i].files, ctx); });

  const contributors = [...people.entries()]
    .sort((a, b) => b[1].commits - a[1].commits || (a[0] < b[0] ? -1 : 1))
    .map(([k, p]) => ({
      name: keyer.display(k),
      commits: p.commits,
      modules: [...p.touches.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([i]) => groups[i].path),
      lastCommit: { subject: scrub(p.last.subject), date: p.last.date },
    }));

  let facilities = [];
  try {
    facilities = detectFacilities(files, history, groups, {
      root, isGit, head, keyer, refTime, shallow, bare,
      git: (args) => git(root, args),
      rootFiles: tree.files.map((f) => f.path),
    });
  } catch (e) { console.warn(`施設の判定に失敗した（施設なしで続ける）: ${e.message}`); }
  for (const f of facilities) {
    if (f.lastCommit) f.lastCommit.subject = scrub(f.lastCommit.subject);
    if (f.facts?.latest) f.facts.latest.subject = scrub(f.facts.latest.subject);
  }

  return {
    name, head, branch,
    latestCommitDate: history.length ? history[0].date : null,
    readme: parseReadme(root, tree.files, readText),
    modules,
    facilities,
    contributors,
  };
}
