import { basename } from 'node:path';
import { sortPaths, uniq } from './common.mjs';
import { ENV_REF, isSystemEnv } from './env.mjs';
import { SKIP_DIR } from './scan.mjs';
import {
  AUTH_DEP,
  DEPLOY_TARGET,
  HOSTS,
  IGNORE_HOST,
  WEB_DEP,
  nameIn,
} from './sdk-names.mjs';

// ---------- 宿屋・門・酒場の名簿で使う受付の道 ----------
export const SERVERISH = /\b(createServer|express\s*\(|fastify\s*\(|new\s+Koa|new\s+Hono|Router\s*\(|APIRouter|Blueprint\s*\(|Flask\s*\(|FastAPI\s*\(|gin\.(Default|New)\s*\(|echo\.New\s*\(|fiber\.New\s*\(|chi\.NewRouter|mux\.NewRouter|http\.HandleFunc|http\.NewServeMux|(req|request)\.(url|method|path)\b|Rails\.application\.routes)/;
export const ROUTE_CALL = /\b(?:app|router|server|api|fastify|routes?|hono|srv|admin|v\d)\.(get|post|put|patch|delete|all|options|head)\s*\(\s*['"`](\/[^'"`\s]*)['"`]/gi;
export const PY_ROUTE = /@\w+\.(get|post|put|patch|delete|route|api_route)\(\s*['"](\/[^'"]*)['"]([^)\n]*)\)/g;
export const GO_ROUTE = /\.(?:HandleFunc|Handle)\(\s*"(?:(GET|POST|PUT|PATCH|DELETE) )?(\/[^"\s]*)"|\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"\s]*)"/g;
export const RB_ROUTE = /^\s*(get|post|put|patch|delete)\s+['"](\/?[^'"]+)['"]/gm;
export const API_LITERAL = /['"`](\/api(?:\/[A-Za-z0-9_\-:{}.]+)*\/?)['"`]/g;
export const SPEC_FILE = /^((openapi|swagger|asyncapi)([-_.][\w-]+)*\.(ya?ml|json)|[\w.-]+\.(graphql|graphqls|gql)|[\w.-]+\.proto)$/i;
export const PROMPT_FILE = /(\.prompt(\.(md|txt|ya?ml|json))?|\.prompty)$|^((system|user)[-_]?)?prompts?([-_.][\w-]+)*\.(md|txt|ya?ml|json|j2|jinja2?|hbs|mustache|tmpl|tpl)$/i;

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

export function detectInn({ files, byBase, named, depHits, read, prod, servers }) {
  const deployNames = /^(vercel\.json|netlify\.toml|fly\.toml|procfile|render\.yaml|wrangler\.(toml|json|jsonc)|app\.json|now\.json)$/i;
  const deploy = named(deployNames).filter(prod);
  const cname = (byBase.get('cname') || []).filter((p) => !SKIP_DIR.test(p));
  const firebase = (byBase.get('firebase.json') || []);
  const dockerfiles = files.filter((f) => /^(dockerfile|containerfile)(\..*)?$/i.test(basename(f.path)) && !SKIP_DIR.test(f.path)).map((f) => f.path);
  const fwConfig = named(/^(next|nuxt|astro|svelte|remix|vite)\.config\.[cm]?[jt]s$|^gatsby-config\.[jt]s$|^angular\.json$/).filter(prod);
  const pages = files.filter((f) => /^index\.html?$/i.test(basename(f.path)) && prod(f.path)).map((f) => f.path);
  const deps2 = depHits(WEB_DEP);
  const read2 = read([...cname, ...firebase, ...dockerfiles].slice(0, 40));
  const domains = cname.map((p) => (read2.get(p) || '').trim().split(/\s+/)[0]).filter((d) => /^[a-z0-9.\-]+\.[a-z]{2,}$/i.test(d));
  const exposed = dockerfiles.filter((p) => /^\s*EXPOSE\s+\d+/mi.test(read2.get(p) || ''));
  const hosting = firebase.filter((p) => /"hosting"/.test(read2.get(p) || ''));
  const deployAll = sortPaths([...deploy, ...exposed, ...hosting, ...(domains.length ? cname : [])]);
  const frameworks = [...deps2.keys()];
  if (!(servers.length || deployAll.length || frameworks.length || fwConfig.length)) return null;
  const parts = [];
  if (servers.length) parts.push(`「${servers[0].path}」が ${servers[0].how}を立てる`);
  if (domains.length) parts.push(`「${cname[0]}」に ${domains[0]} という住所の札がある`);     // 公開した証拠ではない
  else if (deployAll.length) parts.push(`公開の設定「${deployAll[0]}」がある`);
  if (frameworks.length) parts.push(`${frameworks.slice(0, 2).join('・')} を使う`);
  else if (fwConfig.length && !servers.length) parts.push(`Webの骨組みの設定「${fwConfig[0]}」がある`);
  if (pages.length && parts.length < 3) parts.push(`「${sortPaths(pages)[0]}」を配る`);
  const evidence = [...servers.map((s) => s.path), ...deployAll, ...fwConfig, ...sortPaths(pages).slice(0, 4),
    ...[...deps2.values()].flatMap((s) => [...s])];
  return {
    reason: parts.join('、'),
    evidence,
    facts: {
      servers: servers.slice(0, 6), deploy: deployAll.slice(0, 6), domains, frameworks, configs: fwConfig.slice(0, 4), pages: sortPaths(pages).slice(0, 4),
    },
    entry: { deployAll, domains, cname: domains.length ? cname[0] : null, frameworks, fwConfig, evidence },
  };
}

export function receptions(routeList) {
  const seen = new Map();
  for (const r of routeList) {
    const k = `${r.method || ''} ${r.route}`;
    if (seen.has(k)) continue;
    if (!r.method && [...seen.values()].some((x) => x.route === r.route)) continue;
    if (r.method) for (const [k2, x] of seen) if (!x.method && x.route === r.route) seen.delete(k2);
    seen.set(k, r);
  }
  return [...seen.values()].sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : (a.method || '') < (b.method || '') ? -1 : 1));
}

export function detectGate({ entry, routeList, deps, prod, servers }) {
  const routes = receptions(routeList);
  const methodRoutes = routes.filter((r) => r.method);
  if (!(entry || methodRoutes.length)) return null;
  const targets = [];
  for (const p of entry ? entry.deployAll : []) {
    if (entry.cname && p === entry.cname) continue;
    const name = nameIn(DEPLOY_TARGET, basename(p));
    targets.push({ path: p, name: name || null });
  }
  // ログインの道具: 製品の依存（docs・examples・tests の下の manifest は数えない）
  const auth = [];
  for (const { dep, path } of deps) {
    if (!prod(path)) continue;
    const n = nameIn(AUTH_DEP, dep);
    if (n && !auth.some((a) => a.name === n)) auth.push({ name: n, path });
  }
  const parts = [];
  if (entry?.domains.length) parts.push(`「${entry.cname}」に ${entry.domains[0]} という住所`);
  else if (targets.length) parts.push(`公開の設定「${targets[0].path}」${targets[0].name ? `（${targets[0].name}）` : ''}`);
  if (servers.length) parts.push(`「${servers[0].path}」が ${servers[0].how}を立てる`);
  if (routes.length) parts.push(`受付の道 ${routes.length} 本`);
  if (!parts.length && entry?.frameworks.length) parts.push(`${entry.frameworks.slice(0, 2).join('・')} を使う`);
  if (!parts.length && entry?.fwConfig.length) parts.push(`Webの骨組みの設定「${entry.fwConfig[0]}」`);
  if (auth.length) parts.push(`ログインの道具 ${auth.slice(0, 2).map((a) => a.name).join('・')}`);
  return {
    reason: parts.join('、'),
    evidence: [...(entry ? entry.evidence : []), ...(entry?.cname ? [entry.cname] : []),
      ...sortPaths(uniq(routes.map((r) => r.path))), ...auth.map((a) => a.path)],
    facts: {
      domains: entry ? entry.domains.slice(0, 4) : [],
      deploy: targets.slice(0, 6),
      servers: servers.slice(0, 4),
      frameworks: entry ? entry.frameworks.slice(0, 4) : [],
      routes: (methodRoutes.length >= 3 ? methodRoutes : routes).slice(0, 8), routesTotal: routes.length,
      auth: auth.slice(0, 4),
    },
  };
}
