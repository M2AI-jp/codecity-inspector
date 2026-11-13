import { basename } from 'node:path';

// ---------- 依存の名前 → 分かりやすい名前 ----------
export const SDK = [   // [正規表現, 名前]（npm・PyPI・RubyGems・Go・Cargo の名前）
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
export const DB = [
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
export const MONITOR = [
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
export const WEB_DEP = [
  [/^express$/, 'Express'], [/^fastify$/, 'Fastify'], [/^koa$/, 'Koa'], [/^hono$|^@hono\/node-server$/, 'Hono'],
  [/^next$/, 'Next.js'], [/^nuxt$/, 'Nuxt'], [/^astro$/, 'Astro'], [/^@sveltejs\/kit$/, 'SvelteKit'], [/^@remix-run\//, 'Remix'],
  [/^gatsby$/, 'Gatsby'], [/^@nestjs\/core$/, 'NestJS'], [/^@hapi\/hapi$/, 'hapi'],
  [/^flask$/i, 'Flask'], [/^django$/i, 'Django'], [/^fastapi$/i, 'FastAPI'], [/^rails$|^railties$/, 'Rails'], [/^sinatra$/, 'Sinatra'],
  [/^github\.com\/gin-gonic\/gin$/, 'Gin'], [/^github\.com\/labstack\/echo/, 'Echo'], [/^github\.com\/gofiber\/fiber/, 'Fiber'],
  [/^actix-web$/, 'actix-web'], [/^axum$/, 'axum'], [/^rocket$/, 'Rocket'], [/^warp$/, 'warp'],
];
export const TEST_DEP = [
  [/^vitest$/, 'Vitest'], [/^jest$/, 'Jest'], [/^mocha$/, 'Mocha'], [/^@playwright\/test$|^playwright$/, 'Playwright'],
  [/^cypress$/, 'Cypress'], [/^ava$/, 'AVA'], [/^tap$/, 'tap'], [/^uvu$/, 'uvu'], [/^pytest$/, 'pytest'],
  [/^rspec$|^rspec-core$/, 'RSpec'], [/^minitest$/, 'Minitest'],
];
// ログイン（本人かどうかを確かめる）の道具。名前だけで分かるものに限る（汎用の SDK・JWT・session は数えない）
export const AUTH_DEP = [
  [/^next-auth$/, 'NextAuth.js'], [/^@auth\//, 'Auth.js'], [/^better-auth$/, 'Better Auth'],
  [/^passport$|^passport-[\w-]+$/, 'Passport'], [/^lucia$|^@lucia-auth\//, 'Lucia'], [/^@clerk\//, 'Clerk'],
  [/^@supabase\/(auth-helpers-[\w-]+|auth-js|auth-ui-react|ssr)$/, 'Supabase Auth'], [/^@auth0\/|^auth0$/, 'Auth0'],
  [/^@firebase\/auth$|^firebaseui$/, 'Firebase Authentication'], [/^@kinde-oss\//, 'Kinde'], [/^@workos-inc\/authkit/, 'WorkOS AuthKit'],
  [/^@okta\//, 'Okta'], [/^keycloak-js$|^keycloak-connect$/, 'Keycloak'],
  [/^devise$/, 'Devise'], [/^omniauth$|^omniauth-[\w-]+$/, 'OmniAuth'], [/^rodauth$|^rodauth-rails$/, 'Rodauth'],
  [/^django-allauth$/, 'django-allauth'], [/^flask-login$/, 'Flask-Login'], [/^flask-security(-too)?$/, 'Flask-Security'],
  [/^fastapi-users$/, 'FastAPI Users'], [/^github\.com\/markbates\/goth$/, 'Goth'],
];
// 公開の段取りの設定ファイル → 行き先の名前（設定があるだけで、公開した証拠ではない）
export const DEPLOY_TARGET = [
  [/^(vercel|now)\.json$/i, 'Vercel'], [/^netlify\.toml$/i, 'Netlify'], [/^fly\.toml$/i, 'Fly.io'], [/^render\.yaml$/i, 'Render'],
  [/^wrangler\.(toml|json|jsonc)$/i, 'Cloudflare Workers'], [/^firebase\.json$/i, 'Firebase Hosting'],
  [/^(dockerfile|containerfile)(\..*)?$/i, 'Docker'],
];
// 有名な API の住所 → 名前
export const HOSTS = [
  [/^api\.openai\.com$/, 'OpenAI'], [/^api\.anthropic\.com$/, 'Anthropic'], [/^api\.stripe\.com$/, 'Stripe'],
  [/^(api|uploads)\.github\.com$/, 'GitHub'], [/^hooks\.slack\.com$|^slack\.com$/, 'Slack'], [/^discord(app)?\.com$/, 'Discord'],
  [/^api\.linear\.app$/, 'Linear'], [/^api\.notion\.com$/, 'Notion'], [/^api\.twilio\.com$/, 'Twilio'],
  [/^api\.sendgrid\.com$/, 'SendGrid'], [/^api\.resend\.com$/, 'Resend'], [/^generativelanguage\.googleapis\.com$/, 'Google Gemini'],
  [/^api\.telegram\.org$/, 'Telegram'], [/^api\.line\.me$/, 'LINE'], [/^api\.(twitter|x)\.com$/, 'X（Twitter）'],
  [/^api\.mistral\.ai$/, 'Mistral'], [/^api\.groq\.com$/, 'Groq'], [/^api\.cohere\.(ai|com)$/, 'Cohere'],
  [/^openrouter\.ai$/, 'OpenRouter'], [/^api\.replicate\.com$/, 'Replicate'], [/\.supabase\.co$/, 'Supabase'],
  [/^api\.cloudflare\.com$/, 'Cloudflare'], [/^api\.vercel\.com$/, 'Vercel'], [/^gitlab\.com$/, 'GitLab'], [/^api\.bitbucket\.org$/, 'Bitbucket'],
];
export const IGNORE_HOST = /(^|\.)(example\.(com|org|net)|localhost|schema\.org|w3\.org|json-schema\.org|github\.io|googleapis\.com\/css)$/;

export const LOADER = [
  [/^dotenv$|^dotenv-expand$|^dotenv-flow$|^dotenv-rails$|^dotenvy$|^github\.com\/joho\/godotenv$/, 'dotenv'],
  [/^@dotenvx\/dotenvx$|^dotenvx$/, 'dotenvx'], [/^python-dotenv$/, 'python-dotenv'], [/^env-cmd$/, 'env-cmd'],
  [/^environs$/, 'environs'], [/^django-environ$/, 'django-environ'], [/^pydantic-settings$/, 'pydantic-settings'],
  [/^figaro$/, 'figaro'], [/^envalid$/, 'envalid'], [/^@t3-oss\/env-/, 't3-env'], [/^config$|^node-config$/, 'node-config'],
];

export const nameIn = (table, dep) => {
  for (const [re, n] of table) if (re.test(dep)) return n;
  return null;
};

// 依存の名前を取り出す（manifest の種類ごと）
export const depsOf = (path, text) => {
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
};

export const MANIFEST = /^(package\.json|requirements[\w.\-]*\.txt|pipfile|pyproject\.toml|gemfile|[\w.\-]+\.gemspec|go\.mod|cargo\.toml)$/i;
