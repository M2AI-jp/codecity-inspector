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

// ---------- 井戸（env・secrets・config） ----------
// コードが読む環境変数の名前（値は読まない・出さない）。大文字の名前だけ
const ENV_REF = new RegExp([
  /process\.env\.([A-Z_][A-Z0-9_]*)/.source,
  /process\.env\[\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\]/.source,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/.source,
  /Bun\.env\.([A-Z_][A-Z0-9_]*)/.source,
  /(?:Deno\.env\.get|os\.getenv|os\.environ\.get|os\.Getenv|os\.LookupEnv|env::var(?:_os)?|System\.getenv|System\.get_env|Environment\.GetEnvironmentVariable|\bgetenv|ENV\.fetch|ENV\.key\?)\s*\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/.source,
  /(?:os\.environ|\bENV|\$_ENV|\$_SERVER|\benvironment)\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/.source,
  /\benv!\(\s*"([A-Z_][A-Z0-9_]*)"/.source,
].join('|'), 'g');
// OS や実行環境がもともと持っている名前（街が用意する設定ではない）
const SYSTEM_ENV = new Set(('HOME PATH USER USERNAME SHELL TERM TERM_PROGRAM PWD OLDPWD TMPDIR TMP TEMP LANG LANGUAGE LC_ALL LC_CTYPE ' +
  'LC_MESSAGES LOGNAME HOSTNAME EDITOR VISUAL PAGER COLUMNS LINES SHLVL USERPROFILE APPDATA LOCALAPPDATA PROGRAMFILES SYSTEMROOT ' +
  'WINDIR COMSPEC DISPLAY TZ CI NO_COLOR FORCE_COLOR NODE_TEST_CONTEXT GITHUB_ACTIONS GITHUB_WORKSPACE RUNNER_OS RUNNER_TEMP SSH_AUTH_SOCK').split(' '));
// GitHub Actions が自動で渡す名前（GITHUB_OUTPUT・GITHUB_SHA など）も、街が用意する設定ではない
const isSystemEnv = (n) => SYSTEM_ENV.has(n) || /^(XDG_|RUNNER_|npm_)/.test(n) ||
  /^GITHUB_(OUTPUT|ENV|PATH|STEP_SUMMARY|STATE|REPOSITORY(_OWNER|_ID)?|RUN_(ID|NUMBER|ATTEMPT)|SHA|REF(_NAME|_TYPE)?|BASE_REF|HEAD_REF|EVENT_(NAME|PATH)|ACTOR(_ID)?|TRIGGERING_ACTOR|WORKFLOW(_REF|_SHA)?|JOB|ACTION(_PATH|_REPOSITORY)?|ACTIONS|SERVER_URL|API_URL|GRAPHQL_URL|WORKSPACE|RETENTION_DAYS)$/.test(n);
const ENV_EXAMPLE = /^(\.env([.-][\w-]+)*[.-](example|sample|template|dist|tmpl|tpl)|(example|sample|template)\.env|env\.(example|sample|template))$/i;
const isSecretEnv = (b) => /^\.env(\.[\w.-]+)?$/i.test(b) && !/[.-](example|sample|template|dist|tmpl|tpl|defaults?)$/i.test(b) && !/^\.env\.vault$/i.test(b);
const LOADER = [
  [/^dotenv$|^dotenv-expand$|^dotenv-flow$|^dotenv-rails$|^dotenvy$|^github\.com\/joho\/godotenv$/, 'dotenv'],
  [/^@dotenvx\/dotenvx$|^dotenvx$/, 'dotenvx'], [/^python-dotenv$/, 'python-dotenv'], [/^env-cmd$/, 'env-cmd'],
  [/^environs$/, 'environs'], [/^django-environ$/, 'django-environ'], [/^pydantic-settings$/, 'pydantic-settings'],
  [/^figaro$/, 'figaro'], [/^envalid$/, 'envalid'], [/^@t3-oss\/env-/, 't3-env'], [/^config$|^node-config$/, 'node-config'],
];
const CONFIG_FILE = /^(config|settings|appsettings([.-][\w-]+)?|application([.-][\w-]+)?)\.(json|jsonc|ya?ml|toml|ini|properties|[cm]?js|ts|py|rb)$/i;
const CONFIG_DIR = /^(config|configs|settings|conf)$/i;
// 鍵らしい名前（API キー・トークン・秘密）と、その相手
const KEY_TOKEN = new Set('KEY APIKEY TOKEN SECRET PASSWORD PASSWD PASS CREDENTIAL CREDENTIALS PAT DSN'.split(' '));
const isKeyName = (n) => { const t = n.split('_').filter(Boolean); return t.some((x) => KEY_TOKEN.has(x)) && !/^(PATH|DIR|URL|NAME|FILE)$/.test(t[t.length - 1]); };
const KEY_FOR = {
  OPENAI: 'OpenAI', ANTHROPIC: 'Anthropic', CLAUDE: 'Anthropic', STRIPE: 'Stripe', SUPABASE: 'Supabase', RESEND: 'Resend',
  TWILIO: 'Twilio', AWS: 'AWS', FIREBASE: 'Firebase', SLACK: 'Slack', DISCORD: 'Discord', GITHUB: 'GitHub', GH: 'GitHub',
  GITLAB: 'GitLab', GEMINI: 'Google Gemini', GOOGLE: 'Google', SENDGRID: 'SendGrid', NOTION: 'Notion', LINEAR: 'Linear',
  MISTRAL: 'Mistral', GROQ: 'Groq', COHERE: 'Cohere', REPLICATE: 'Replicate', TELEGRAM: 'Telegram', LINE: 'LINE',
  ALGOLIA: 'Algolia', OPENROUTER: 'OpenRouter', SENTRY: 'Sentry', CLOUDFLARE: 'Cloudflare', VERCEL: 'Vercel', AZURE: 'Azure',
  HUGGINGFACE: 'Hugging Face', HF: 'Hugging Face', PINECONE: 'Pinecone', CODECOV: 'Codecov', NPM: 'npm', DOCKER: 'Docker',
  DOCKERHUB: 'Docker', APPLE: 'Apple', INFLUXDB: 'InfluxDB', DEEPSEEK: 'DeepSeek', XAI: 'xAI', PERPLEXITY: 'Perplexity',
  ELEVENLABS: 'ElevenLabs', MAILGUN: 'Mailgun', POSTMARK: 'Postmark', SHOPIFY: 'Shopify', PAYPAL: 'PayPal', DATADOG: 'Datadog',
};
const keyFor = (n, known) => {
  const t = n.split('_');
  for (const x of t) if (KEY_FOR[x]) return KEY_FOR[x];
  for (const k of known) {
    // 名前（Linear）か、住所のいちばん大事な部分（www.patreon.com → PATREON）
    const c = (k.includes('.') ? k.split('.').slice(-2, -1)[0] : k).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length >= 3 && t.includes(c)) return k;
  }
  return null;
};

// ---------- 酒場の名簿: 受付（街が受ける道）・取り決めの書類・AI への頼み方 ----------
const SERVERISH = /\b(createServer|express\s*\(|fastify\s*\(|new\s+Koa|new\s+Hono|Router\s*\(|APIRouter|Blueprint\s*\(|Flask\s*\(|FastAPI\s*\(|gin\.(Default|New)\s*\(|echo\.New\s*\(|fiber\.New\s*\(|chi\.NewRouter|mux\.NewRouter|http\.HandleFunc|http\.NewServeMux|(req|request)\.(url|method|path)\b|Rails\.application\.routes)/;
const ROUTE_CALL = /\b(?:app|router|server|api|fastify|routes?|hono|srv|admin|v\d)\.(get|post|put|patch|delete|all|options|head)\s*\(\s*['"`](\/[^'"`\s]*)['"`]/gi;
const PY_ROUTE = /@\w+\.(get|post|put|patch|delete|route|api_route)\(\s*['"](\/[^'"]*)['"]([^)\n]*)\)/g;
const GO_ROUTE = /\.(?:HandleFunc|Handle)\(\s*"(?:(GET|POST|PUT|PATCH|DELETE) )?(\/[^"\s]*)"|\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"\s]*)"/g;
const RB_ROUTE = /^\s*(get|post|put|patch|delete)\s+['"](\/?[^'"]+)['"]/gm;
const API_LITERAL = /['"`](\/api(?:\/[A-Za-z0-9_\-:{}.]+)*\/?)['"`]/g;
const SPEC_FILE = /^((openapi|swagger|asyncapi)([-_.][\w-]+)*\.(ya?ml|json)|[\w.-]+\.(graphql|graphqls|gql)|[\w.-]+\.proto)$/i;
const PROMPT_FILE = /(\.prompt(\.(md|txt|ya?ml|json))?|\.prompty)$|^((system|user)[-_]?)?prompts?([-_.][\w-]+)*\.(md|txt|ya?ml|json|j2|jinja2?|hbs|mustache|tmpl|tpl)$/i;

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

const nameIn = (table, dep) => { for (const [re, n] of table) if (re.test(dep)) return n; return null; };
const uniq = (a) => [...new Set(a)];
// 名前（github など）をファイル名に含むものを先に
const byName = (name, paths) => { const k = name.toLowerCase().replace(/[^a-z0-9]/g, ''); return sortPaths(paths).sort((x, y) => (!basename(x).toLowerCase().includes(k)) - (!basename(y).toLowerCase().includes(k))); };
const sortPaths = (a) => [...a].sort((x, y) => x.split('/').length - y.split('/').length || (x < y ? -1 : x > y ? 1 : 0));

// ---------- 中身を読む ----------
// パスは解析したディレクトリからの相対。リポジトリの一部のディレクトリを解析したときも、そのディレクトリのファイルを読む
// （"HEAD:./p" は今いるディレクトリから。bare リポジトリには作業ディレクトリが無いので "HEAD:p"）
function makeReader(root, isGit, bare) {
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
  // 同じファイルは1度だけ読む（git なら cat-file --batch の1回にまとめる）
  const rawRead = makeReader(root, isGit && !!head, !!extra.bare);
  const cache = new Map();
  const read = (paths) => {
    const miss = uniq(paths.filter((p) => !cache.has(p)));
    if (miss.length) { const got = rawRead(miss); for (const p of miss) cache.set(p, got.has(p) ? got.get(p) : null); }
    const out = new Map();
    for (const p of paths) { const t = cache.get(p); if (t != null) out.set(p, t); }
    return out;
  };
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
  // 井戸・船着場・道場が読む小さなファイル（見本の env・workflow・package.json・配布の manifest）も、ここで一緒に読んでおく
  const examples = sortPaths(files.filter((f) => !f.binary && prod(f.path) && ENV_EXAMPLE.test(basename(f.path)) && f.bytes < (256 << 10)).map((f) => f.path)).slice(0, 8);
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path) && f.bytes < (1 << 20)).map((f) => f.path).slice(0, 80);
  const dockManifests = files.filter((f) => !f.binary && prod(f.path) && f.bytes < (1 << 20) && f.path.split('/').length <= 4 &&
    /^(package\.json|pyproject\.toml|setup\.py|cargo\.toml|[\w.-]+\.gemspec|go\.mod|composer\.json|pubspec\.yaml|package\.swift|info\.plist|app\.json|app\.config\.[cm]?[jt]s|manifest\.json|androidmanifest\.xml|tauri\.conf\.json|capacitor\.config\.(json|[jt]s)|project\.pbxproj)$/i.test(basename(f.path))).map((f) => f.path).slice(0, 40);
  const pkgJsons = (byBase.get('package.json') || []).filter((p) => !SKIP_DIR.test(p)).slice(0, 20);
  read([...manifests, ...examples, ...workflows, ...dockManifests, ...pkgJsons]);
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
    // コミット数はどこでも同じ数え方: マージを除く（解析が読んだ git log --no-merges と同じ）。
    // 解析が上限で読み切れなかったときだけ、全体をマージを除いて数え直す
    // 浅いクローンでは、手元にあるのは直近の一部だけ（総数・最初のコミット・タグの有無は分からない）
    const shallow = !!extra.shallow;
    const total = history.length < 5000 || shallow ? history.length
      : Number(git(['rev-list', '--count', '--no-merges', 'HEAD'])?.trim()) || history.length;
    const roots = (git(['log', '--max-parents=0', '--format=%cI', 'HEAD']) || '').split('\n').filter(Boolean).sort();
    const tagLines = (git(['for-each-ref', 'refs/tags', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:iso-strict)']) || '').split('\n').filter(Boolean);
    const latestTag = tagLines.length ? { name: tagLines[0].split('\t')[0], date: tagLines[0].split('\t')[1] || null } : null;
    const changelog = extra.rootFiles.find((p) => /^(changelog|changes|history|news|releases?)(\.(md|markdown|txt|rst))?$/i.test(p)) || null;
    const people = new Set(history.map((c) => c.key));
    const facts = {
      dirty: extra.dirty ?? null,                       // 作業ツリーで HEAD と違うファイルの数（bare・作業ツリーなしは null）
      agents: extra.agents || [],                       // 外部工務店（コード生成エージェント）の工事報告 [{ name, commits, recent }]
      commits: total,
      contributors: people.size,
      contributorsWindow: history.length >= 5000 || shallow ? history.length : null,     // 履歴を上限まで（浅いクローンなら手元の分だけ）読んだときは、数えた範囲（直近のコミット数）
      firstCommit: shallow ? null : roots[0] || (history.length ? history[history.length - 1].date : null),
      lastCommit: history.length ? history[0].date : null,
      tags: shallow && !tagLines.length ? null : tagLines.length, latestTag, changelog,
      shallow,
    };
    const st = stats(null);
    add('town_hall', '役場', `git リポジトリ（${shallow ? '浅いクローンで、手元にあるのは直近の' : ''}マージを除くコミット ${total.toLocaleString('en-US')} 件${tagLines.length ? `・タグ ${tagLines.length} 個` : ''}${changelog ? `・${changelog}` : ''}）`,
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

  // --- 井戸と酒場の名簿で使う: 設定の名前（env）。値は読まない・出さない ---
  // 見本（.env.example など、公開してよい書き方の見本）は名前だけ読む。本物の .env は開かない
  const exampleNames = [];
  for (const [, text] of read(examples)) {
    for (const l of text.split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
      if (m && !exampleNames.includes(m[1])) exampleNames.push(m[1]);
    }
  }
  const exampleSet = new Set(exampleNames);
  const committedEnv = isGit ? sortPaths(files.filter((f) => !SKIP_DIR.test(f.path) && isSecretEnv(basename(f.path))).map((f) => f.path)) : [];
  // 見本に書いてある名前を先に、残りはそれを読むファイルの多い順
  const codeNames = [...envInCode.entries()].sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1)).map(([n]) => n);
  const envNames = uniq([...exampleNames, ...codeNames]);
  // CI（GitHub Actions）が使う鍵の名前（GITHUB_TOKEN は GitHub が自動で渡すので数えない）
  const workflowText = read(workflows);
  const ciSecrets = new Map();
  for (const [p, text] of workflowText) for (const m of text.matchAll(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (m[1] === 'GITHUB_TOKEN') continue;
    if (!ciSecrets.has(m[1])) ciSecrets.set(m[1], new Set());
    ciSecrets.get(m[1]).add(p);
  }

  // --- 酒場: API・外部接続・LLM・webhook ---
  {
    const sdk = depHits(SDK);
    const connectors = new Map();   // name -> { via: 'dep'|'url', paths:Set }
    for (const [n, ps] of sdk) connectors.set(n, { via: 'dep', paths: ps });
    for (const [n, ps] of hostsSeen) if (!connectors.has(n)) connectors.set(n, { via: 'url', paths: ps });
    const hooks = uniq(webhooks.map((w) => w.route)).slice(0, 6);
    // 取り決めの書類（OpenAPI・GraphQL など）と、AI への頼み方の書き置き（prompt のファイル）
    const specs = sortPaths(files.filter((f) => !SKIP_DIR.test(f.path) && !/(^|\/)(tests?|__tests__|fixtures?|spec)\//.test(f.path) && SPEC_FILE.test(basename(f.path))).map((f) => f.path));
    const prompts = sortPaths(files.filter((f) => !f.binary && prod(f.path) && !/(^|\/)\./.test(f.path) &&
      (PROMPT_FILE.test(basename(f.path)) || (/(^|\/)prompts?\//i.test(f.path) && /\.(md|txt|ya?ml|json|j2|jinja2?|hbs|mustache|tmpl|tpl)$/i.test(f.path)))).map((f) => f.path));
    const apiSpecs = specs.filter((p) => !/\.proto$/i.test(p));
    if (connectors.size || hooks.length || apiSpecs.length) {
      // 既知の名前（依存・有名な住所）を先に、知らない住所はその後に
      const names = [...connectors.keys()].sort((a, b) => (a.includes('.') - b.includes('.')) || (connectors.get(b).paths.size - connectors.get(a).paths.size) || (a < b ? -1 : 1));
      const parts = [];
      if (names.length) parts.push(`外とつながる相手: ${names.slice(0, 5).join('、')}${names.length > 5 ? ` ほか ${names.length - 5}` : ''}`);
      if (hooks.length) parts.push(`webhook の受け口「${hooks[0]}」`);
      if (!parts.length) parts.push(`API の取り決めの書類「${apiSpecs[0]}」`);
      const evidence = [...names.flatMap((n) => sortPaths([...connectors.get(n).paths]).slice(0, 3)), ...webhooks.map((w) => w.path), ...apiSpecs];
      // 受付: 同じ道は1つに（受け方の分かるものを残す）
      const seen = new Map();
      for (const r of routeList) {
        const k = `${r.method || ''} ${r.route}`;
        if (seen.has(k)) continue;
        if (!r.method && [...seen.values()].some((x) => x.route === r.route)) continue;
        if (r.method) for (const [k2, x] of seen) if (!x.method && x.route === r.route) seen.delete(k2);
        seen.set(k, r);
      }
      const routes = [...seen.values()].sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : (a.method || '') < (b.method || '') ? -1 : 1));
      const known = names;
      const keys = envNames.filter(isKeyName).slice(0, 20).map((n) => ({ name: n, for: keyFor(n, known), example: exampleSet.has(n) }));
      add('pub', '酒場', parts.join('、'), evidence, {
        connectors: names.map((n) => ({ name: n, via: connectors.get(n).via, paths: byName(n, [...connectors.get(n).paths]).slice(0, 3) })).slice(0, 12),
        webhooks: hooks,
        routes: routes.slice(0, 30), routesTotal: routes.length,
        keys, envExamples: examples.slice(0, 3),
        specs: specs.slice(0, 10),
        prompts: prompts.slice(0, 10), promptsTotal: prompts.length,
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
    const pkgs = read(pkgJsons);
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

  // --- 井戸: env・secrets・config（生活インフラ）。外に建物を持たない（広場の井戸と井戸番） ---
  {
    const loaders = uniq([...depHits(LOADER).keys(), ...loaderSrc]);
    // package.json の scripts の node --env-file
    for (const [, text] of read(pkgJsons.filter((p) => prod(p)))) {
      try { if (Object.values(JSON.parse(text).scripts || {}).some((v) => /--env-file\b/.test(String(v))) && !loaders.includes('node --env-file')) loaders.push('node --env-file'); } catch {}
    }
    const configDirs = new Set(), configFiles = [];
    for (const f of files) {
      if (!prod(f.path)) continue;
      const segs = f.path.split('/');
      const i = segs.findIndex((x, j) => j < Math.min(2, segs.length - 1) && CONFIG_DIR.test(x));
      if (i >= 0) configDirs.add(`${segs.slice(0, i + 1).join('/')}/`);
      else if (segs.length <= 3 && CONFIG_FILE.test(segs[segs.length - 1])) configFiles.push(f.path);
    }
    const configs = [...sortPaths([...configDirs]), ...sortPaths(configFiles)].slice(0, 8);
    const loaderPaths = [...depHits(LOADER).values()].flatMap((x) => [...x]);
    if (examples.length || committedEnv.length || loaders.length || codeNames.length >= 3) {
      const parts = [];
      if (examples.length) parts.push(`設定の見本「${examples[0]}」`);
      if (codeNames.length) parts.push(`コードが読む設定の名前 ${codeNames.length} 個`);
      if (committedEnv.length) parts.push(`記録に入った env ファイル「${committedEnv[0]}」`);
      if (loaders.length) parts.push(`設定を読みこむ道具 ${loaders.slice(0, 2).join('・')}`);
      const codeFiles = sortPaths(uniq(codeNames.slice(0, 12).flatMap((n) => [...envInCode.get(n)])));
      add('well', '井戸', parts.join('、'), [...examples, ...committedEnv, ...loaderPaths, ...codeFiles], {
        examples, names: envNames.slice(0, 40), namesTotal: envNames.length, configs, committed: committedEnv.slice(0, 8), loaders,
        ciSecrets: [...ciSecrets.entries()].sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1)).map(([n]) => n).slice(0, 12),
      });
      facilities[facilities.length - 1].noMerge = true;      // 建物が無いので、モジュールをまとめない
    }
  }

  // --- 船着場: アプリ・パッケージの配布（外の島へ届ける場所） ---
  {
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
    if (apps.length || pubs.length || strongPkg.length) {
      const parts = [];
      if (apps.length) {
        const what = APP_KIND_JA[apps[0].kind] || `${apps[0].kind} のアプリ`;
        parts.push(`「${apps[0].path}」に${/^[A-Za-z]/.test(what) ? ' ' : ''}${what}${apps.length > 1 ? ` ほか ${apps.length - 1}` : ''}`);
      }
      const p0 = packages[0];
      if (p0) parts.push(`荷札「${p0.name}${p0.version ? ` ${p0.version}` : ''}」（${p0.path}）`);
      if (pubs.length) parts.push(`出港の手順「${pubs[0]}」`);
      add('dock', '船着場', parts.join('、'), all, {
        packages: packages.slice(0, 6), apps: apps.slice(0, 6), publish: pubs.slice(0, 6), bins: uniq(bins).slice(0, 6),
      });
    }
  }

  // 酒場の名簿の「じょうたい」: 記録・見張り（見張り台）があるか
  const pubF = facilities.find((f) => f.archetype === 'pub'), tower = facilities.find((f) => f.archetype === 'watchtower');
  if (pubF) Object.assign(pubF.facts, { watchtower: !!tower, watchTools: tower ? tower.facts.tools.slice(0, 4) : [] });

  // 施設が丸ごと覆うモジュール（全ファイルがその施設の証拠）は、施設の建物にまとめる
  const taken = new Set();
  for (const f of facilities) {
    const set = new Set(f.noMerge ? [] : f.all);
    delete f.noMerge;
    f.merged = [];
    for (const g of groups) {
      if (g.path === '.' || taken.has(g.path) || !g.files.length) continue;
      if (g.files.every((x) => set.has(x.path))) { f.merged.push(g.path); taken.add(g.path); }
    }
    delete f.all;
  }
  return facilities;
}
