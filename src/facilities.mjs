// リポジトリの証拠から施設（PRODUCT.md §4 の施設表）を見つける。控えめに判定し、理由は事実だけを書く。
//   town_hall 役場     : git リポジトリ（コミット・タグ・リリース）
//   inn       宿屋     : 公開Webサービス（Webサーバーのコード、公開・配備の設定、Webの骨組み）
//   pub       酒場     : API・外部接続・LLM API・webhook（依存の SDK、API の住所、webhook の道）
//   warehouse 倉庫     : DB・storage（DB の依存、SQL・SQLite、migrations・prisma）
//   watchtower 見張り台: logs・monitoring（記録・監視の依存、logs ディレクトリ、監視の設定）
//   dojo      道場     : test・E2E（テストのディレクトリ・ファイル、テストの道具）
// 中身を読むのは依存の一覧と、上限つきのソースの走査だけ（git なら HEAD の内容を cat-file --batch でまとめて読む）。
import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync } from 'node:fs';
import { basename, join } from 'node:path';

const DAY = 86400000;
const EVIDENCE_CAP = 20;
const SCAN_FILES = 2500;            // ソースを読むファイル数の上限
const SCAN_BYTES = 16 << 20;        // ソースを読む合計バイト数の上限
const SCAN_FILE_MAX = 256 << 10;    // これより大きいソースは読まない
const NONGIT_HEAD = 96 << 10;       // git でないとき、1ファイルの先頭だけ読む

const CODE_EXT = new Set('js mjs cjs ts mts cts jsx tsx py rb go rs php java kt swift ex exs cs'.split(' '));
const SKIP_DIR = /(^|\/)(node_modules|vendor|vendored|dist|build|\.next|coverage|third_party|external)\//;
const NOT_PRODUCT = /(^|\/)(examples?|demos?|samples?|fixtures?|docs?|documentation|tests?|__tests__|specs?|e2e|cypress|playwright|benchmarks?)\//i;
const TEST_DIR = /^(tests?|__tests__|specs?|e2e|cypress|playwright|testing)$/i;
const TEST_FILE = /(\.(test|spec)\.[a-z0-9]+$)|(^test_[^/]*\.py$)|(_test\.(py|go|rb|exs)$)|(^conftest\.py$)|(Tests?\.(swift|java|kt|cs)$)/;

// ---------- 依存の名前 → 分かりやすい名前 ----------
const SDK = [   // [正規表現, 名前]（npm・PyPI・RubyGems・Go・Cargo の名前）
  [/^openai$|^ruby-openai$|^github\.com\/sashabaranov\/go-openai$|^async-openai$|^@ai-sdk\/openai$/, 'OpenAI'],
  [/^@anthropic-ai\/|^anthropic$|^github\.com\/anthropics\/|^@ai-sdk\/anthropic$/, 'Anthropic'],
  [/^stripe$|^@stripe\/|^github\.com\/stripe\/stripe-go/, 'Stripe'],
  [/^@supabase\/|^supabase$/, 'Supabase'],
  [/^resend$/, 'Resend'],
  [/^twilio$|^twilio-ruby$|^github\.com\/twilio\//, 'Twilio'],
  [/^@aws-sdk\/|^aws-sdk$|^boto3$|^botocore$|^aws-sdk-|^github\.com\/aws\/aws-sdk-go/, 'AWS'],
  [/^firebase$|^firebase-admin$|^@firebase\//, 'Firebase'],
  [/^@slack\/|^slack_sdk$|^slack-sdk$|^slack_bolt$|^slack-bolt$|^slack-ruby-client$|^github\.com\/slack-go\/slack$/, 'Slack'],
  [/^discord\.js$|^discord\.py$|^discord$|^github\.com\/bwmarrin\/discordgo$|^serenity$/, 'Discord'],
  [/^octokit$|^@octokit\/|^pygithub$|^github\.com\/google\/go-github|^octocrab$/, 'GitHub'],
  [/^@google\/generative-ai$|^@google\/genai$|^google-generativeai$|^google-genai$|^@ai-sdk\/google$/, 'Google Gemini'],
  [/^@sendgrid\/|^sendgrid$|^sendgrid-ruby$/, 'SendGrid'],
  [/^@notionhq\/client$|^notion-client$/, 'Notion'],
  [/^@linear\/sdk$/, 'Linear'],
  [/^@mistralai\/|^mistralai$/, 'Mistral'],
  [/^groq-sdk$|^groq$/, 'Groq'],
  [/^cohere-ai$|^cohere$/, 'Cohere'],
  [/^replicate$/, 'Replicate'],
  [/^@modelcontextprotocol\/sdk$|^mcp$/, 'MCP'],
  [/^telegraf$|^node-telegram-bot-api$|^python-telegram-bot$/, 'Telegram'],
  [/^@line\/bot-sdk$|^line-bot-sdk$/, 'LINE'],
  [/^googleapis$|^@google-cloud\//, 'Google Cloud'],
  [/^algoliasearch$/, 'Algolia'],
  [/^nodemailer$/, 'メール送信（SMTP）'],
  [/^langchain$|^@langchain\//, 'LangChain'],
];
const DB = [
  [/^pg$|^postgres$|^psycopg2?(-binary)?$|^psycopg$|^asyncpg$|^github\.com\/lib\/pq$|^github\.com\/jackc\/pgx|^@vercel\/postgres$|^@neondatabase\//, 'PostgreSQL'],
  [/^mysql2?$|^pymysql$|^mysqlclient$|^github\.com\/go-sql-driver\/mysql$|^@planetscale\/database$/, 'MySQL'],
  [/^sqlite3$|^better-sqlite3$|^@libsql\/client$|^github\.com\/mattn\/go-sqlite3$|^rusqlite$|^modernc\.org\/sqlite$/, 'SQLite'],
  [/^mongodb$|^mongoose$|^pymongo$|^motor$|^go\.mongodb\.org\/mongo-driver/, 'MongoDB'],
  [/^redis$|^ioredis$|^@upstash\/redis$|^github\.com\/(go-redis|redis)\/|^@vercel\/kv$/, 'Redis'],
  [/^prisma$|^@prisma\/client$/, 'Prisma'],
  [/^drizzle-orm$/, 'Drizzle'],
  [/^typeorm$/, 'TypeORM'],
  [/^sequelize$/, 'Sequelize'],
  [/^knex$/, 'Knex'],
  [/^kysely$/, 'Kysely'],
  [/^sqlalchemy$|^alembic$/i, 'SQLAlchemy'],
  [/^peewee$/, 'Peewee'],
  [/^activerecord$|^sequel$/, 'ActiveRecord'],
  [/^gorm\.io\/gorm$/, 'GORM'],
  [/^sqlx$|^diesel$|^sea-orm$/, 'SQL（Rust）'],
  [/^@aws-sdk\/client-s3$|^@aws-sdk\/client-dynamodb$/, 'AWS のストレージ'],
  [/^@supabase\/supabase-js$/, 'Supabase'],
];
const MONITOR = [
  [/^winston$/, 'winston'], [/^pino$|^pino-/, 'pino'], [/^bunyan$/, 'bunyan'], [/^log4js$/, 'log4js'],
  [/^@sentry\/|^sentry-sdk$|^sentry-ruby$|^sentry-rails$|^github\.com\/getsentry\/sentry-go$|^sentry$/, 'Sentry'],
  [/^@opentelemetry\/|^opentelemetry-|^go\.opentelemetry\.io\//, 'OpenTelemetry'],
  [/^prom-client$|^prometheus[-_]client$|^github\.com\/prometheus\/client_golang$|^prometheus$/, 'Prometheus'],
  [/^dd-trace$|^@datadog\/|^datadog$|^ddtrace$/, 'Datadog'],
  [/^newrelic$|^newrelic_rpm$/, 'New Relic'],
  [/^structlog$/, 'structlog'], [/^loguru$/, 'loguru'], [/^lograge$/, 'lograge'],
  [/^go\.uber\.org\/zap$/, 'zap'], [/^github\.com\/sirupsen\/logrus$/, 'logrus'], [/^github\.com\/rs\/zerolog$/, 'zerolog'],
  [/^tracing$|^tracing-subscriber$/, 'tracing'],
];
const WEB_DEP = [
  [/^express$/, 'Express'], [/^fastify$/, 'Fastify'], [/^koa$/, 'Koa'], [/^hono$|^@hono\/node-server$/, 'Hono'],
  [/^next$/, 'Next.js'], [/^nuxt$/, 'Nuxt'], [/^astro$/, 'Astro'], [/^@sveltejs\/kit$/, 'SvelteKit'], [/^@remix-run\//, 'Remix'],
  [/^gatsby$/, 'Gatsby'], [/^@nestjs\/core$/, 'NestJS'], [/^@hapi\/hapi$/, 'hapi'],
  [/^flask$/i, 'Flask'], [/^django$/i, 'Django'], [/^fastapi$/i, 'FastAPI'], [/^rails$|^railties$/, 'Rails'], [/^sinatra$/, 'Sinatra'],
  [/^github\.com\/gin-gonic\/gin$/, 'Gin'], [/^github\.com\/labstack\/echo/, 'Echo'], [/^github\.com\/gofiber\/fiber/, 'Fiber'],
  [/^actix-web$/, 'actix-web'], [/^axum$/, 'axum'], [/^rocket$/, 'Rocket'], [/^warp$/, 'warp'],
];
const TEST_DEP = [
  [/^vitest$/, 'Vitest'], [/^jest$/, 'Jest'], [/^mocha$/, 'Mocha'], [/^@playwright\/test$|^playwright$/, 'Playwright'],
  [/^cypress$/, 'Cypress'], [/^ava$/, 'AVA'], [/^tap$/, 'tap'], [/^uvu$/, 'uvu'], [/^pytest$/, 'pytest'],
  [/^rspec$|^rspec-core$/, 'RSpec'], [/^minitest$/, 'Minitest'],
];
// 有名な API の住所 → 名前
const HOSTS = [
  [/^api\.openai\.com$/, 'OpenAI'], [/^api\.anthropic\.com$/, 'Anthropic'], [/^api\.stripe\.com$/, 'Stripe'],
  [/^(api|uploads)\.github\.com$/, 'GitHub'], [/^hooks\.slack\.com$|^slack\.com$/, 'Slack'], [/^discord(app)?\.com$/, 'Discord'],
  [/^api\.linear\.app$/, 'Linear'], [/^api\.notion\.com$/, 'Notion'], [/^api\.twilio\.com$/, 'Twilio'],
  [/^api\.sendgrid\.com$/, 'SendGrid'], [/^api\.resend\.com$/, 'Resend'], [/^generativelanguage\.googleapis\.com$/, 'Google Gemini'],
  [/^api\.telegram\.org$/, 'Telegram'], [/^api\.line\.me$/, 'LINE'], [/^api\.(twitter|x)\.com$/, 'X（Twitter）'],
  [/^api\.mistral\.ai$/, 'Mistral'], [/^api\.groq\.com$/, 'Groq'], [/^api\.cohere\.(ai|com)$/, 'Cohere'],
  [/^openrouter\.ai$/, 'OpenRouter'], [/^api\.replicate\.com$/, 'Replicate'], [/\.supabase\.co$/, 'Supabase'],
  [/^api\.cloudflare\.com$/, 'Cloudflare'], [/^api\.vercel\.com$/, 'Vercel'], [/^gitlab\.com$/, 'GitLab'], [/^api\.bitbucket\.org$/, 'Bitbucket'],
];
const IGNORE_HOST = /(^|\.)(example\.(com|org|net)|localhost|schema\.org|w3\.org|json-schema\.org|github\.io|googleapis\.com\/css)$/;

const nameIn = (table, dep) => { for (const [re, n] of table) if (re.test(dep)) return n; return null; };
const uniq = (a) => [...new Set(a)];
// 名前（github など）をファイル名に含むものを先に
const byName = (name, paths) => { const k = name.toLowerCase().replace(/[^a-z0-9]/g, ''); return sortPaths(paths).sort((x, y) => (!basename(x).toLowerCase().includes(k)) - (!basename(y).toLowerCase().includes(k))); };
const sortPaths = (a) => [...a].sort((x, y) => x.split('/').length - y.split('/').length || (x < y ? -1 : x > y ? 1 : 0));

// ---------- 中身を読む ----------
function makeReader(root, isGit) {
  return (paths) => {
    const out = new Map();
    if (!paths.length) return out;
    if (isGit) {
      let buf;
      try {
        buf = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
          input: paths.map((p) => `HEAD:${p}`).join('\n') + '\n', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'ignore'],
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
        out.set(p, buf.toString('utf8', pos, pos + size));
        pos += size + 1;
      }
      return out;
    }
    for (const p of paths) {
      try {
        const fd = openSync(join(root, p), 'r');
        const b = Buffer.alloc(NONGIT_HEAD);
        const n = readSync(fd, b, 0, b.length, 0);
        closeSync(fd);
        out.set(p, b.toString('utf8', 0, n));
      } catch { /* 読めないファイルは飛ばす */ }
    }
    return out;
  };
}

// 依存の名前を取り出す（manifest の種類ごと）
function depsOf(path, text) {
  const b = basename(path).toLowerCase();
  const out = [];
  try {
    if (b === 'package.json') {
      const j = JSON.parse(text);
      for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) out.push(...Object.keys(j[k] || {}));
    } else if (/^requirements.*\.txt$/.test(b) || b === 'pipfile') {
      for (const l of text.split('\n')) { const m = l.trim().match(/^([A-Za-z0-9_.\-]+)/); if (m && !l.trim().startsWith('#')) out.push(m[1].toLowerCase()); }
    } else if (b === 'pyproject.toml') {
      for (const m of text.matchAll(/["']([A-Za-z0-9_.\-]+)\s*(?:[<>=!~;[\]]|["'])/g)) out.push(m[1].toLowerCase());
      for (const m of text.matchAll(/^\s*([A-Za-z0-9_\-]+)\s*=\s*["{]/gm)) out.push(m[1].toLowerCase());
    } else if (b === 'gemfile' || b.endsWith('.gemspec')) {
      for (const m of text.matchAll(/^\s*(?:gem|spec\.add_(?:development_|runtime_)?dependency)\s*\(?\s*["']([^"']+)["']/gm)) out.push(m[1]);
    } else if (b === 'go.mod') {
      for (const m of text.matchAll(/^\s*(?:require\s+)?([a-z0-9.\-]+\.[a-z]+\/[^\s]+)\s+v[0-9]/gm)) out.push(m[1]);
    } else if (b === 'cargo.toml') {
      let inDeps = false;
      for (const l of text.split('\n')) {
        const sec = l.match(/^\s*\[([^\]]+)\]/);
        if (sec) { inDeps = /dependencies/.test(sec[1]); continue; }
        const m = inDeps && l.match(/^\s*([A-Za-z0-9_\-]+)\s*=/);
        if (m) out.push(m[1]);
      }
    }
  } catch { /* 壊れた manifest は読まない */ }
  return out;
}
const MANIFEST = /^(package\.json|requirements[\w.\-]*\.txt|pipfile|pyproject\.toml|gemfile|[\w.\-]+\.gemspec|go\.mod|cargo\.toml)$/i;

// ---------- 本体 ----------
// files: [{path, ext, bytes, binary}], history: 新しい順のコミット [{hash,date,author(key),subject,files}],
// groups: モジュール [{path, files}], extra: { root, isGit, head, git, keyer, refTime, rootFiles }
export function detectFacilities(files, history, groups, extra) {
  const { root, isGit, head, git, keyer, refTime } = extra;
  const read = makeReader(root, isGit && !!head);
  const prod = (p) => !SKIP_DIR.test(p) && !NOT_PRODUCT.test(p);
  const byBase = new Map();
  for (const f of files) {
    const b = basename(f.path).toLowerCase();
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f.path);
  }
  const named = (re) => files.filter((f) => !SKIP_DIR.test(f.path) && re.test(basename(f.path))).map((f) => f.path);

  // 依存の一覧
  const manifests = files.filter((f) => MANIFEST.test(basename(f.path)) && !SKIP_DIR.test(f.path) && f.bytes < (1 << 20)).map((f) => f.path).slice(0, 300);
  const deps = [];   // { dep, path }
  for (const [p, text] of read(manifests)) for (const dep of depsOf(p, text)) deps.push({ dep, path: p });
  const depHits = (table) => {
    const hits = new Map();   // name -> paths
    for (const { dep, path } of deps) {
      const n = nameIn(table, dep);
      if (!n) continue;
      if (!hits.has(n)) hits.set(n, new Set());
      hits.get(n).add(path);
    }
    return hits;
  };

  // ソースの走査（製品のコードだけ。名前の分かりやすいものから、上限まで）
  const PRIORITY = /(server|app|index|main|api|client|http|route|webhook|service|integration|github|slack|openai|llm|ai|db|database|store|storage|log|monitor|deploy)/i;
  const scanList = files.filter((f) => CODE_EXT.has(f.ext) && !f.binary && f.bytes <= SCAN_FILE_MAX && prod(f.path) && !/\.min\.js$/.test(f.path))
    .sort((a, b) => (PRIORITY.test(basename(b.path)) - PRIORITY.test(basename(a.path))) || a.path.split('/').length - b.path.split('/').length || (a.path < b.path ? -1 : 1));
  const chosen = [];
  let budget = SCAN_BYTES;
  for (const f of scanList) {
    if (chosen.length >= SCAN_FILES || budget - f.bytes < 0) break;
    chosen.push(f.path); budget -= f.bytes;
  }
  const sources = read(chosen);

  const servers = [], hostsSeen = new Map(), webhooks = [], sqliteSrc = [];
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
  }

  const facilities = [];
  const testPath = (p) => p.split('/').slice(0, -1).some((s) => TEST_DIR.test(s)) || TEST_FILE.test(basename(p));
  const stats = (evidence) => {
    // evidence のどれかに触れたコミット（全部のとき evidence = null）
    const set = evidence ? new Set(evidence) : null;
    let commits = 0, recent = 0, last = null;
    const authors = new Map();
    for (const c of history) {
      if (set && !c.files.some((f) => set.has(f))) continue;
      commits++;
      if (refTime - Date.parse(c.date) <= 90 * DAY) recent++;
      if (!last) last = c;
      authors.set(c.key, (authors.get(c.key) || 0) + 1);
    }
    return {
      commits, recent,
      lastCommit: last ? { hash: last.hash, date: last.date, author: keyer.display(last.key), subject: last.subject } : null,
      authors: [...authors.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10).map(([k, n]) => ({ name: keyer.display(k), commits: n })),
    };
  };
  const add = (archetype, name, reason, all, facts, extraStats) => {
    const evidence = uniq(all);
    facilities.push({ archetype, name, reason, evidence: evidence.slice(0, EVIDENCE_CAP), evidenceCount: evidence.length, facts, all: evidence, ...(extraStats || stats(evidence)) });
  };

  // --- 役場: git リポジトリ ---
  if (isGit && head) {
    const total = Number(git(['rev-list', '--count', 'HEAD'])?.trim()) || history.length;
    const roots = (git(['log', '--max-parents=0', '--format=%cI', 'HEAD']) || '').split('\n').filter(Boolean).sort();
    const tagLines = (git(['for-each-ref', 'refs/tags', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:iso-strict)']) || '').split('\n').filter(Boolean);
    const latestTag = tagLines.length ? { name: tagLines[0].split('\t')[0], date: tagLines[0].split('\t')[1] || null } : null;
    const changelog = extra.rootFiles.find((p) => /^(changelog|changes|history|news|releases?)(\.(md|markdown|txt|rst))?$/i.test(p)) || null;
    const people = new Set(history.map((c) => c.key));
    const facts = {
      commits: total,
      contributors: people.size,
      contributorsWindow: history.length >= 5000 ? history.length : null,     // 履歴を上限まで読んだときは、数えた範囲（直近のコミット数）
      firstCommit: roots[0] || (history.length ? history[history.length - 1].date : null),
      lastCommit: history.length ? history[0].date : null,
      tags: tagLines.length, latestTag, changelog,
    };
    const st = stats(null);
    add('town_hall', '役場', `git リポジトリ（コミット ${total} 件${tagLines.length ? `・タグ ${tagLines.length} 個` : ''}${changelog ? `・${changelog}` : ''}）`,
      ['.git', ...(changelog ? [changelog] : [])], facts, { ...st, commits: total });
  }

  // --- 宿屋: 公開Webサービス ---
  {
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
    if (servers.length || deployAll.length || frameworks.length || fwConfig.length) {
      const parts = [];
      if (servers.length) parts.push(`「${servers[0].path}」が ${servers[0].how}を立てる`);
      if (domains.length) parts.push(`「${cname[0]}」で ${domains[0]} という住所に公開している`);
      else if (deployAll.length) parts.push(`公開の設定「${deployAll[0]}」がある`);
      if (frameworks.length) parts.push(`${frameworks.slice(0, 2).join('・')} を使う`);
      else if (fwConfig.length && !servers.length) parts.push(`Webの骨組みの設定「${fwConfig[0]}」がある`);
      if (pages.length && parts.length < 3) parts.push(`「${sortPaths(pages)[0]}」を配る`);
      const evidence = [...servers.map((s) => s.path), ...deployAll, ...fwConfig, ...sortPaths(pages).slice(0, 4),
        ...[...deps2.values()].flatMap((s) => [...s])];
      add('inn', '宿屋', parts.join('、'), evidence, {
        servers: servers.slice(0, 6), deploy: deployAll.slice(0, 6), domains, frameworks, configs: fwConfig.slice(0, 4), pages: sortPaths(pages).slice(0, 4),
      });
    }
  }

  // --- 酒場: API・外部接続・LLM・webhook ---
  {
    const sdk = depHits(SDK);
    const connectors = new Map();   // name -> { via: 'dep'|'url', paths:Set }
    for (const [n, ps] of sdk) connectors.set(n, { via: 'dep', paths: ps });
    for (const [n, ps] of hostsSeen) if (!connectors.has(n)) connectors.set(n, { via: 'url', paths: ps });
    const hooks = uniq(webhooks.map((w) => w.route)).slice(0, 6);
    if (connectors.size || hooks.length) {
      // 既知の名前（依存・有名な住所）を先に、知らない住所はその後に
      const names = [...connectors.keys()].sort((a, b) => (a.includes('.') - b.includes('.')) || (connectors.get(b).paths.size - connectors.get(a).paths.size) || (a < b ? -1 : 1));
      const parts = [];
      if (names.length) parts.push(`外とつながる相手: ${names.slice(0, 5).join('、')}${names.length > 5 ? ` ほか ${names.length - 5}` : ''}`);
      if (hooks.length) parts.push(`webhook の受け口「${hooks[0]}」`);
      const evidence = [...names.flatMap((n) => sortPaths([...connectors.get(n).paths]).slice(0, 3)), ...webhooks.map((w) => w.path)];
      add('pub', '酒場', parts.join('、'), evidence, {
        connectors: names.map((n) => ({ name: n, via: connectors.get(n).via, paths: byName(n, [...connectors.get(n).paths]).slice(0, 3) })).slice(0, 12),
        webhooks: hooks,
      });
    }
  }

  // --- 倉庫: DB・storage ---
  {
    const db = depHits(DB);
    const dirFiles = files.filter((f) => !SKIP_DIR.test(f.path) && /(^|\/)(prisma|migrations|migrate|alembic)\//.test(f.path)).map((f) => f.path);
    const sql = files.filter((f) => f.ext === 'sql' && !SKIP_DIR.test(f.path)).map((f) => f.path);
    const sqlite = files.filter((f) => /^(sqlite|sqlite3|db)$/.test(f.ext) && !SKIP_DIR.test(f.path)).map((f) => f.path);
    const cfg = named(/^(schema\.prisma|drizzle\.config\.[cm]?[jt]s|knexfile\.[cm]?[jt]s|ormconfig\.(json|[jt]s)|database\.yml|redis\.conf)$/);
    const kinds = [...db.keys()];
    if ((sqlite.length || sqliteSrc.length) && !kinds.includes('SQLite')) kinds.push('SQLite');
    if (dirFiles.some((p) => /(^|\/)prisma\//.test(p)) && !kinds.includes('Prisma')) kinds.push('Prisma');
    const migrations = dirFiles.filter((p) => /(^|\/)(migrations|migrate|alembic)\//.test(p));
    if (kinds.length || sql.length || migrations.length || cfg.length) {
      const parts = [];
      if (kinds.length) parts.push(`データをしまう仕組み: ${kinds.slice(0, 4).join('、')}`);
      if (sql.length) parts.push(`SQL のファイル ${sql.length} 件`);
      if (migrations.length) parts.push(`作りかえの手順（migrations）${migrations.length} 件`);
      if (!parts.length) parts.push(`DB の設定「${cfg[0]}」がある`);
      const evidence = [...cfg, ...sortPaths(dirFiles), ...sql, ...sqlite, ...sqliteSrc, ...[...db.values()].flatMap((s) => [...s])];
      add('warehouse', '倉庫', parts.join('、'), evidence, {
        kinds, sqlFiles: sql.length, migrations: migrations.length, configs: cfg.slice(0, 4), dataFiles: sqlite.slice(0, 4), sqliteCode: sqliteSrc.slice(0, 3),
      });
    }
  }

  // --- 見張り台: logs・monitoring ---
  {
    const mon = depHits(MONITOR);
    const logFiles = files.filter((f) => !SKIP_DIR.test(f.path) && /(^|\/)logs?\//.test(f.path)).map((f) => f.path);
    const logDirs = uniq(logFiles.map((p) => p.slice(0, p.search(/(^|\/)logs?\//) + (p.match(/(^|\/)logs?\//)[0].length) - 1)));
    const cfg = named(/^(prometheus\.ya?ml|alertmanager\.ya?ml|\.sentryclirc|sentry\.(client|server|edge)\.config\.[cm]?[jt]s|newrelic\.(js|yml)|datadog\.ya?ml|otel-collector[\w.\-]*\.ya?ml|loki[\w.\-]*\.ya?ml|grafana[\w.\-]*\.(json|ya?ml))$/);
    const tools = [...mon.keys()];
    if (tools.length || logDirs.length || cfg.length) {
      const parts = [];
      if (tools.length) parts.push(`記録・見張りの道具: ${tools.slice(0, 4).join('、')}`);
      if (logDirs.length) parts.push(`記録（ログ）の置き場「${logDirs[0]}」`);
      if (cfg.length) parts.push(`監視の設定「${cfg[0]}」`);
      const evidence = [...cfg, ...[...mon.values()].flatMap((s) => [...s]), ...sortPaths(logFiles)];
      add('watchtower', '見張り台', parts.join('、'), evidence, { tools, logDirs: logDirs.slice(0, 4), configs: cfg.slice(0, 4) });
    }
  }

  // --- 道場: test・E2E ---
  {
    const inTestDir = files.filter((f) => !SKIP_DIR.test(f.path) && f.path.split('/').slice(0, -1).some((s) => TEST_DIR.test(s))).map((f) => f.path);
    const testFiles = files.filter((f) => !SKIP_DIR.test(f.path) && !f.binary && (TEST_FILE.test(basename(f.path)) ||
      (CODE_EXT.has(f.ext) && f.path.split('/').slice(0, -1).some((s) => TEST_DIR.test(s))))).map((f) => f.path);
    const cfg = named(/^(vitest|jest|playwright|cypress|ava)\.config\.[cm]?[jt]s$|^karma\.conf\.[cm]?js$|^\.mocharc(\.\w+)?$|^pytest\.ini$|^\.rspec(_parallel)?$|^phpunit\.xml(\.dist)?$/);
    const runners = [...depHits(TEST_DEP).keys()];
    for (const p of cfg) {
      const b = basename(p).toLowerCase();
      const n = b.startsWith('vitest') ? 'Vitest' : b.startsWith('jest') ? 'Jest' : b.startsWith('playwright') ? 'Playwright' : b.startsWith('cypress') ? 'Cypress'
        : b.startsWith('ava') ? 'AVA' : b.startsWith('karma') ? 'Karma' : b.startsWith('.mocharc') ? 'Mocha' : b === 'pytest.ini' ? 'pytest' : b.startsWith('.rspec') ? 'RSpec' : 'PHPUnit';
      if (!runners.includes(n)) runners.push(n);
    }
    // package.json の scripts.test（node --test など）
    const pkgs = read((byBase.get('package.json') || []).filter((p) => !SKIP_DIR.test(p)).slice(0, 20));
    for (const [, text] of pkgs) {
      try {
        const t = String(JSON.parse(text).scripts?.test || '');
        if (/\bnode\s+(--[\w-]+\s+)*--test\b/.test(t) && !runners.includes('node --test')) runners.push('node --test');
      } catch { /* 読めない package.json */ }
    }
    if (testFiles.length) {
      const dirs = uniq(inTestDir.map((p) => { const s = p.split('/'); const i = s.findIndex((x) => TEST_DIR.test(x)); return s.slice(0, i + 1).join('/'); }));
      const all = uniq([...cfg, ...testFiles, ...inTestDir]);
      const st = stats(all);
      let latest = null;
      for (const c of history) if (c.files.some((f) => testPath(f))) { latest = { subject: c.subject, date: c.date, author: keyer.display(c.key) }; break; }
      add('dojo', '道場', `テストのファイルが ${testFiles.length} 件${runners.length ? `（${runners.slice(0, 2).join('・')}）` : ''}${dirs.length ? `、稽古場「${sortPaths(dirs)[0]}」` : ''}`,
        [...cfg, ...sortPaths(dirs).map((d) => `${d}/`), ...sortPaths(testFiles)], { files: testFiles.length, runners, dirs: sortPaths(dirs).slice(0, 4), latest }, { ...st });
      facilities[facilities.length - 1].all = all;
    }
  }

  // 施設が丸ごと覆うモジュール（全ファイルがその施設の証拠）は、施設の建物にまとめる
  const taken = new Set();
  for (const f of facilities) {
    const set = new Set(f.all);
    f.merged = [];
    for (const g of groups) {
      if (g.path === '.' || taken.has(g.path) || !g.files.length) continue;
      if (g.files.every((x) => set.has(x.path))) { f.merged.push(g.path); taken.add(g.path); }
    }
    delete f.all;
  }
  return facilities;
}
