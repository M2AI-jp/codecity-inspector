import { basename } from 'node:path';
import { DAY } from './constants.mjs';
import { isConfig } from './files.mjs';

const UI_EXT = new Set('css scss sass less styl html htm jsx tsx vue svelte astro hbs handlebars ejs pug njk liquid twig'.split(' '));
const DOC_EXT = new Set('md markdown txt rst adoc org'.split(' '));
const IMAGE_EXT = new Set('png jpg jpeg gif webp bmp ico icns svg tif tiff psd aseprite'.split(' '));
const DATA_EXT = new Set('json jsonl ndjson log csv tsv xml parquet dat db sqlite sqlite3'.split(' '));

const RUIN_WORD = /(^|[-_. ])(legacy|deprecated|old|archive|archived|attic|obsolete)([-_. ]|$)/i;
const WORKSHOP_DIRS = new Set(['scripts', 'script', 'tools', 'tool', 'bin', 'ci', '.github', '.circleci', '.gitlab',
  '.buildkite', '.devcontainer', '.vscode', '.idea', '.husky', '.claude', '.cursor', 'docker', 'deploy', 'deployment',
  'infra', 'infrastructure', 'devtools', 'tasks', 'cmake', 'config', 'configs', '.config', 'ops', 'k8s', 'helm',
  'terraform', 'workflows', 'build-tools']);
const SHOP_DIRS = new Set(['components', 'component', 'ui', 'views', 'view', 'pages', 'page', 'web', 'www', 'frontend',
  'front', 'client', 'styles', 'style', 'css', 'public', 'static', 'assets', 'templates', 'layouts', 'screens',
  'widgets', 'theme', 'themes', 'icons', 'fonts', 'images', 'img']);
const BUILD_FILES = /^(makefile|gnumakefile|dockerfile|containerfile|docker-compose\.ya?ml|compose\.ya?ml|jenkinsfile|procfile|justfile|taskfile\.ya?ml|rakefile|gemfile|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|pom\.xml|cmakelists\.txt|meson\.build|build\.zig|cargo\.toml|go\.mod|pyproject\.toml|setup\.py|setup\.cfg|requirements(-[\w]+)?\.txt|tox\.ini|noxfile\.py|flake\.nix|shell\.nix|\.gitlab-ci\.yml|\.travis\.yml|azure-pipelines\.yml|netlify\.toml|vercel\.json|wrangler\.toml|tsconfig(\.[\w-]+)?\.json|jsconfig\.json|(vite|vitest|webpack|rollup|esbuild|babel|jest|playwright|eslint|prettier|tailwind|postcss|svelte|next|nuxt|astro)\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?|\.prettierrc(\.\w+)?|\.babelrc|\.nvmrc|\.node-version|\.tool-versions|\.editorconfig|\.dockerignore|\.npmrc|\.env\.example|\.devcontainer\.json)$/i;

// ---------- 種類の判定 ----------
export function topCounts(obj, n = 3) {
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

// モジュールの古さとファイルの内訳から、種類と理由を決める。
export function classifyModules(modules, groups, readText, refTime) {
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
}
