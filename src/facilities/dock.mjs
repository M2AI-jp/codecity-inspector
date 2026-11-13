import { basename } from 'node:path';
import { sortPaths, uniq } from './common.mjs';
import { SKIP_DIR } from './scan.mjs';

// ---------- 船着場（アプリ・パッケージの配布） ----------
const PUBLISH_CMD = new RegExp([
  /\b(?:npm|pnpm|yarn|bun)\s+(?:npm\s+)?publish\b|\bchangesets?\s+publish\b|changesets\/action|\bsemantic-release\b/.source,
  /\btwine\s+upload\b|\bpoetry\s+publish\b|\buv\s+publish\b|\bflit\s+publish\b|\bhatch\s+publish\b|pypa\/gh-action-pypi-publish/.source,
  /\bcargo\s+publish\b|\bgem\s+push\b|rubygems\/release-gem|\bgoreleaser\b|softprops\/action-gh-release|actions\/create-release/.source,
  /ncipollo\/release-action|\bgh\s+release\s+(?:create|upload)\b|\beas\s+submit\b|\bfastlane\s+(?:deliver|pilot|supply|release|beta|upload_to)/.source,
  /\bvsce\s+publish\b|\bovsx\s+publish\b|electron-builder[^\n]*--publish|tauri-apps\/tauri-action|\b(?:dart|flutter)\s+pub\s+publish\b/.source,
  /\bmvn\s+deploy\b|\bgradlew?\s+publish|\bdocker\s+push\b/.source,
].join('|'), 'i');
const RELEASE_CONFIG = /^(\.goreleaser\.ya?ml|\.releaserc(\.\w+)?|release\.config\.[cm]?js|release-please-config\.json|electron-builder\.(json|ya?ml|toml)|forge\.config\.[cm]?[jt]s|eas\.json|Fastfile)$/;
const APP_KIND_JA = {
  iOS: 'iPhone のアプリ', macOS: 'Mac のアプリ', Apple: 'Apple の機械のアプリ', Android: 'Android のアプリ', Expo: 'スマホのアプリ（Expo）',
  'React Native': 'スマホのアプリ（React Native）', Electron: 'パソコンのアプリ（Electron）', Tauri: 'パソコンのアプリ（Tauri）',
  Capacitor: 'スマホのアプリ（Capacitor）', Flutter: 'スマホのアプリ（Flutter）', 'Browser extension': 'ブラウザの拡張機能',
  'VS Code extension': 'VS Code の拡張機能',
};

export function detectDock({ files, dockManifests, workflowText, read }) {
  const packages = [], apps = [], publish = [], bins = [], all = [];
  const strongPkg = [];          // 外へ出すための荷札だと読めるもの（package.json の main・bin・files など）
  const text = read(dockManifests);
  const dir = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.');
  const pkg = (registry, name, version, path, strong) => {
    if (!name || packages.some((x) => x.registry === registry && x.name === name)) return;
    packages.push({ registry, name, version: version || null, path });
    all.push(path);
    if (strong) strongPkg.push(path);
  };
  const app = (kind, path, evidence, ownDir) => {
    const p = path === '.' ? '.' : `${path}/`;
    if (apps.some((a) => a.kind === kind && a.path === p)) return;
    apps.push({ kind, path: p });
    all.push(...evidence);
    // 専用のディレクトリ（ios/・mac/ など）なら、その中のファイルも根拠（そのモジュールを船着場にまとめる）
    if (ownDir && path !== '.') for (const f of files) if (f.path.startsWith(`${path}/`)) all.push(f.path);
  };
  for (const [p, t] of text) {
    const b = basename(p).toLowerCase();
    try {
      if (b === 'package.json') {
        const j = JSON.parse(t);
        const deps = { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
        if (j.name && j.version && !j.private) {
          pkg('npm', String(j.name), String(j.version), p, !!(j.bin || j.main || j.exports || j.module || j.files || j.publishConfig || j.types || j.typings));
          if (j.bin) bins.push(...(typeof j.bin === 'string' ? [String(j.name).replace(/^@[^/]+\//, '')] : Object.keys(j.bin)));
        }
        if (j.engines && j.engines.vscode) app('VS Code extension', dir(p), [p], false);
        if (deps.electron) app('Electron', dir(p), [p], false);
        else if (deps['react-native'] && !deps.expo) app('React Native', dir(p), [p], false);
        for (const v of Object.values(j.scripts || {})) if (PUBLISH_CMD.test(String(v)) && !publish.includes(p)) publish.push(p);
      } else if (b === 'pyproject.toml') {
        if (/^\[tool\.uv\][^[]*^\s*package\s*=\s*false/m.test(t)) continue;      // パッケージにしないと書いてある
        const sec = (name) => { const m = new RegExp(`^\\[${name.replaceAll('.', '\\.')}\\]([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(t); return m ? m[1] : null; };
        const proj = sec('project') ?? sec('tool.poetry');
        const name = proj && /^\s*name\s*=\s*["']([^"']+)["']/m.exec(proj)?.[1];
        const version = proj && /^\s*version\s*=\s*["']([^"']+)["']/m.exec(proj)?.[1];
        if (name) pkg('PyPI', name, version, p, /^\[build-system\]/m.test(t));
        const scripts = sec('project.scripts') ?? sec('tool.poetry.scripts');
        if (name && scripts) for (const m of scripts.matchAll(/^\s*["']?([\w.-]+)["']?\s*=/gm)) bins.push(m[1]);
      } else if (b === 'setup.py') {
        const name = /\bname\s*=\s*["']([^"']+)["']/.exec(t)?.[1];
        if (name) pkg('PyPI', name, /\bversion\s*=\s*["']([^"']+)["']/.exec(t)?.[1], p, true);
      } else if (b === 'cargo.toml') {
        const m = /^\[package\]([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(t);
        if (!m || /^\s*publish\s*=\s*false/m.test(m[1])) continue;
        const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(m[1])?.[1];
        pkg('crates.io', name, /^\s*version\s*=\s*"([^"]+)"/m.exec(m[1])?.[1], p, true);
        for (const bm of t.matchAll(/^\[\[bin\]\][^[]*?^\s*name\s*=\s*"([^"]+)"/gm)) bins.push(bm[1]);
      } else if (b.endsWith('.gemspec')) {
        const name = /\.name\s*=\s*["']([^"']+)["']/.exec(t)?.[1];
        pkg('RubyGems', name, /\.version\s*=\s*["']([^"']+)["']/.exec(t)?.[1], p, true);
      } else if (b === 'go.mod') {
        const mod = /^module\s+(\S+)/m.exec(t)?.[1];
        if (mod && /^[a-z0-9.-]+\.[a-z]{2,}\//.test(mod) && !/^example\.(com|org)\//.test(mod)) pkg('Go', mod, null, p, false);
      } else if (b === 'composer.json') {
        const j = JSON.parse(t);
        if (j.name && String(j.name).includes('/') && j.type !== 'project') pkg('Packagist', String(j.name), j.version || null, p, j.type === 'library');
      } else if (b === 'pubspec.yaml') {
        if (/^flutter:/m.test(t) || /^\s{2}flutter:\s*$/m.test(t) && /sdk:\s*flutter/.test(t)) app('Flutter', dir(p), [p], false);
        else if (!/^publish_to:\s*["']?none/m.test(t)) {
          const name = /^name:\s*(\S+)/m.exec(t)?.[1];
          pkg('pub.dev', name, /^version:\s*(\S+)/m.exec(t)?.[1], p, !!name);
        }
      } else if (b === 'package.swift') {
        pkg('SwiftPM', /\bname:\s*"([^"]+)"/.exec(t)?.[1], null, p, false);
      } else if (b === 'info.plist') {
        if (!/CFBundleIdentifier|CFBundleExecutable/.test(t) || /(^|\/)[^/]+\.(framework|bundle|appex|xctest)\//.test(p) || /(^|\/)(tests?|ui-?tests?)\//i.test(p)) continue;
        const kind = /LSRequiresIPhoneOS|UIDeviceFamily|UILaunchStoryboardName|UISupportedInterfaceOrientations|UIApplicationSceneManifest/.test(t) ? 'iOS'
          : /LSMinimumSystemVersion|NSPrincipalClass|LSUIElement|NSHighResolutionCapable|LSApplicationCategoryType/.test(t) ? 'macOS' : 'Apple';
        app(kind, dir(p), [p], true);
      } else if (b === 'project.pbxproj') {
        const proj = dir(dir(p));                       // Foo.xcodeproj の置き場所
        const kind = /SDKROOT = iphoneos/.test(t) ? 'iOS' : /SDKROOT = macosx/.test(t) ? 'macOS' : 'Apple';
        app(kind, proj, [p], proj !== '.');
      } else if (b === 'androidmanifest.xml') {
        if (!/<application\b/.test(t)) continue;
        const segs = p.split('/');
        const ai = segs.findIndex((x) => x.toLowerCase() === 'android');
        const where = ai >= 0 ? segs.slice(0, ai + 1).join('/') : p.replace(/(\/app)?\/src\/main\/AndroidManifest\.xml$/i, '') || '.';
        app('Android', where === p ? dir(p) : where, [p], true);
      } else if (b === 'app.json' || /^app\.config\./.test(b)) {
        if (b === 'app.json' ? /"expo"\s*:/.test(t) : /\bexpo\b/.test(t)) app('Expo', dir(p), [p], false);
      } else if (b === 'manifest.json') {
        const j = JSON.parse(t);
        if (j.manifest_version && (j.background || j.content_scripts || j.action || j.browser_action || j.permissions)) app('Browser extension', dir(p), [p], false);
      } else if (b === 'tauri.conf.json') {
        app('Tauri', dir(p), [p], /(^|\/)src-tauri$/.test(dir(p)));
      } else if (/^capacitor\.config\./.test(b)) {
        app('Capacitor', dir(p), [p], false);
      }
    } catch { /* 読めない manifest は飛ばす */ }
  }
  // 出港の手順: 公開・配布する workflow と、配布の設定ファイル
  for (const [p, t] of workflowText) {
    const docker = /docker\/build-push-action/.test(t) && /^\s*push:\s*(true|\$\{\{)/m.test(t);
    if ((PUBLISH_CMD.test(t) || docker) && !publish.includes(p)) publish.push(p);
  }
  for (const f of files) if (!SKIP_DIR.test(f.path) && RELEASE_CONFIG.test(basename(f.path)) && f.path.split('/').length <= 3 && !publish.includes(f.path)) publish.push(f.path);
  // 名前に release・publish・deploy を含むものを先に
  const pubs = sortPaths(publish).sort((a, b) => (!/release|publish|deploy/i.test(basename(a))) - (!/release|publish|deploy/i.test(basename(b))));
  all.push(...pubs);
  // 荷札だけ（main も bin もない package.json、go.mod の module 名など）では船着場にしない
  if (!(apps.length || pubs.length || strongPkg.length)) return null;
  const parts = [];
  if (apps.length) {
    const what = APP_KIND_JA[apps[0].kind] || `${apps[0].kind} のアプリ`;
    parts.push(`「${apps[0].path}」に${/^[A-Za-z]/.test(what) ? ' ' : ''}${what}${apps.length > 1 ? ` ほか ${apps.length - 1}` : ''}`);
  }
  const p0 = packages[0];
  if (p0) parts.push(`荷札「${p0.name}${p0.version ? ` ${p0.version}` : ''}」（${p0.path}）`);
  if (pubs.length) parts.push(`出港の手順「${pubs[0]}」`);
  return {
    reason: parts.join('、'),
    evidence: all,
    facts: {
      packages: packages.slice(0, 6), apps: apps.slice(0, 6), publish: pubs.slice(0, 6), bins: uniq(bins).slice(0, 6),
    },
  };
}
