import { ENV_REF, isSystemEnv } from '../env.mjs';
import { HOSTS, IGNORE_HOST, nameIn } from '../sdk-names.mjs';
import { SERVERISH, ROUTE_CALL, PY_ROUTE, GO_ROUTE, RB_ROUTE, API_LITERAL } from './patterns.mjs';

// ソースを元の順で走査し、施設間で共有する証拠の順序を保つ。
export function scanWebSources({ sources, files, prod }) {
  const servers = [], hostsSeen = new Map(), webhooks = [], sqliteSrc = [];
  const envInCode = new Map(), loaderSrc = new Set(), routeList = [];   // 環境変数の名前 -> そのファイル、読み込む仕組み、受付の道
  for (const [p, s] of sources) {
    let how = null;
    if (/\bcreateServer\s*\(/.test(s) && /(?:from\s+|require\(\s*)['"](?:node:)?https?['"]/.test(s)) how = 'Node の http サーバー';
    else if ((/(?:from\s+|require\(\s*)['"](?:express|fastify|koa|hono|@hono\/node-server|restify|polka)['"]/.test(s)) && /\.listen\s*\(|serve\s*\(/.test(s)) how = 'Webサーバー';
    else if (/\b(?:Bun|Deno)\.serve\s*\(/.test(s)) how = 'Webサーバー';
    else if (/\bFlask\s*\(\s*__name__/.test(s) || /\bFastAPI\s*\(/.test(s) || /\buvicorn\.run\s*\(/.test(s)) how = 'Python の Webアプリ';
    else if (/\bhttp\.ListenAndServe(?:TLS)?\s*\(/.test(s)) how = 'Go の http サーバー';
    else if (/\bRails\.application\b/.test(s) && /config\/(application|routes)\.rb$/.test(p)) how = 'Rails のアプリ';
    if (how) servers.push({ path: p, how });
    for (const m of s.matchAll(/https:\/\/([a-z0-9][a-z0-9.\-]*\.[a-z]{2,})(\/[^\s'"`)<>]*)?/gi)) {
      const host = m[1].toLowerCase(), rest = m[2] || '';
      if (IGNORE_HOST.test(host)) continue;
      const known = nameIn(HOSTS, host);
      const apiLike = known || /^api\./.test(host) || /^\/(api|graphql)\b/.test(rest);
      if (!apiLike) continue;
      const n = known || host;
      if (!hostsSeen.has(n)) hostsSeen.set(n, new Set());
      hostsSeen.get(n).add(p);
    }
    for (const m of s.matchAll(/(?:\.(?:post|get|put|all|route|use)\s*\(\s*|@\w+\.(?:post|route)\s*\(\s*)['"`]([^'"`\s]*webhooks?[^'"`\s]*)['"`]/gi)) webhooks.push({ route: m[1], path: p });
    if (/(?:from\s+|require\(\s*)['"]node:sqlite['"]|^\s*import\s+sqlite3\b|\bsqlite3\.connect\s*\(/m.test(s)) sqliteSrc.push(p);
    // 環境変数の名前（値は読まない）
    for (const m of s.matchAll(ENV_REF)) {
      const n = m.slice(1).find(Boolean);
      if (!n || isSystemEnv(n)) continue;
      if (!envInCode.has(n)) envInCode.set(n, new Set());
      envInCode.get(n).add(p);
    }
    if (/\bprocess\.loadEnvFile\s*\(/.test(s)) loaderSrc.add('process.loadEnvFile');
    if (/\bload_dotenv\s*\(/.test(s)) loaderSrc.add('python-dotenv');
    // 受付（この街が外から受ける道）。サーバーらしいファイルだけ
    if (how || SERVERISH.test(s)) {
      const ext = p.slice(p.lastIndexOf('.') + 1);
      const put = (method, route) => routeList.push({ method: method && !/^(all|route|api_route)$/i.test(method) ? method.toUpperCase() : null, route, path: p });
      if (/^[cm]?[jt]sx?$/.test(ext)) for (const m of s.matchAll(ROUTE_CALL)) put(m[1], m[2]);
      if (ext === 'py') for (const m of s.matchAll(PY_ROUTE)) {
        const ms = m[1] === 'route' ? (/methods\s*=\s*[[(]\s*['"](\w+)['"]/.exec(m[3])?.[1] || 'GET') : m[1];   // Flask の route は既定で GET
        put(ms, m[2]);
      }
      if (ext === 'go') for (const m of s.matchAll(GO_ROUTE)) put(m[1] || m[3] || null, m[2] || m[4]);
      if (ext === 'rb' && /(^|\/)config\/routes\.rb$/.test(p)) for (const m of s.matchAll(RB_ROUTE)) put(m[1], m[2].startsWith('/') ? m[2] : `/${m[2]}`);
      for (const m of s.matchAll(API_LITERAL)) {
        const ls = s.lastIndexOf('\n', m.index) + 1, le = s.indexOf('\n', m.index);
        const line = s.slice(ls, m.index) + s.slice(m.index + m[0].length, le < 0 ? s.length : le);   // 道の名前そのもの（/api/posts）は見ない
        put(/\bpost(Routes?|Handlers?)?\b|\.post\s*\(|['"]POST['"]/i.test(line) ? 'POST' : null, m[1]);
      }
    }
  }
  // Next.js の道（app/**/route.* と pages/api/**）
  for (const f of files) {
    if (!prod(f.path)) continue;
    let m = /^(?:(.*\/)?src\/|(.*\/)?)app\/(.*\/)?route\.[cm]?[jt]sx?$/.exec(f.path);
    if (m) {
      const segs = (m[3] || '').split('/').filter((x) => x && !/^\(.*\)$/.test(x));
      const text = sources.get(f.path) || '';
      const methods = [...text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((x) => x[1]);
      for (const mm of methods.length ? methods : [null]) routeList.push({ method: mm, route: `/${segs.join('/')}`, path: f.path });
      continue;
    }
    m = /^(?:(?:.*\/)?src\/|(?:.*\/)?)pages\/(api(?:\/.*)?)\.[cm]?[jt]sx?$/.exec(f.path);
    if (m) routeList.push({ method: null, route: `/${m[1].replace(/\/index$/, '')}`, path: f.path });
  }
  return { servers, hostsSeen, webhooks, sqliteSrc, envInCode, loaderSrc, routeList };
}
