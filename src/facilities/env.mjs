import { basename } from 'node:path';
import { sortPaths, uniq } from './common.mjs';
import { SKIP_DIR } from './scan.mjs';
import { LOADER } from './sdk-names.mjs';

// ---------- 井戸（env・secrets・config） ----------
// コードが読む環境変数の名前（値は読まない・出さない）。大文字の名前だけ
export const ENV_REF = new RegExp([
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
export const isSystemEnv = (n) => SYSTEM_ENV.has(n) || /^(XDG_|RUNNER_|npm_)/.test(n) ||
  /^GITHUB_(OUTPUT|ENV|PATH|STEP_SUMMARY|STATE|REPOSITORY(_OWNER|_ID)?|RUN_(ID|NUMBER|ATTEMPT)|SHA|REF(_NAME|_TYPE)?|BASE_REF|HEAD_REF|EVENT_(NAME|PATH)|ACTOR(_ID)?|TRIGGERING_ACTOR|WORKFLOW(_REF|_SHA)?|JOB|ACTION(_PATH|_REPOSITORY)?|ACTIONS|SERVER_URL|API_URL|GRAPHQL_URL|WORKSPACE|RETENTION_DAYS)$/.test(n);
export const ENV_EXAMPLE = /^(\.env([.-][\w-]+)*[.-](example|sample|template|dist|tmpl|tpl)|(example|sample|template)\.env|env\.(example|sample|template))$/i;
export const isSecretEnv = (b) => /^\.env(\.[\w.-]+)?$/i.test(b) && !/[.-](example|sample|template|dist|tmpl|tpl|defaults?)$/i.test(b) && !/^\.env\.vault$/i.test(b);
export const CONFIG_FILE = /^(config|settings|appsettings([.-][\w-]+)?|application([.-][\w-]+)?)\.(json|jsonc|ya?ml|toml|ini|properties|[cm]?js|ts|py|rb)$/i;
export const CONFIG_DIR = /^(config|configs|settings|conf)$/i;

// 鍵らしい名前（API キー・トークン・秘密）と、その相手
const KEY_TOKEN = new Set('KEY APIKEY TOKEN SECRET PASSWORD PASSWD PASS CREDENTIAL CREDENTIALS PAT DSN'.split(' '));
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
export const isKeyName = (n) => {
  const t = n.split('_').filter(Boolean);
  return t.some((x) => KEY_TOKEN.has(x)) && !/^(PATH|DIR|URL|NAME|FILE)$/.test(t[t.length - 1]);
};
export const keyFor = (n, known) => {
  const t = n.split('_');
  for (const x of t) if (KEY_FOR[x]) return KEY_FOR[x];
  for (const k of known) {
    // 名前（Linear）か、住所のいちばん大事な部分（www.patreon.com → PATREON）
    const c = (k.includes('.') ? k.split('.').slice(-2, -1)[0] : k).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length >= 3 && t.includes(c)) return k;
  }
  return null;
};

export function collectEnvironment({ files, examples, pkgJsons, workflows, read, depHits, prod, isGit, envInCode, loaderSrc }) {
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
  let well = null;
  if (examples.length || committedEnv.length || loaders.length || codeNames.length >= 3) {
    const parts = [];
    if (examples.length) parts.push(`設定の見本「${examples[0]}」`);
    if (codeNames.length) parts.push(`コードが読む設定の名前 ${codeNames.length} 個`);
    if (committedEnv.length) parts.push(`記録に入った env ファイル「${committedEnv[0]}」`);
    if (loaders.length) parts.push(`設定を読みこむ道具 ${loaders.slice(0, 2).join('・')}`);
    const codeFiles = sortPaths(uniq(codeNames.slice(0, 12).flatMap((n) => [...envInCode.get(n)])));
    const envInCodeFacts = codeNames.slice(0, 40).map((name) => ({
      name,
      files: sortPaths([...envInCode.get(name)]).slice(0, 20),
    }));
    well = {
      reason: parts.join('、'),
      evidence: [...examples, ...committedEnv, ...loaderPaths, ...codeFiles],
      facts: {
        examples, names: envNames.slice(0, 40), namesTotal: envNames.length, configs, committed: committedEnv.slice(0, 8), loaders,
        envInCode: envInCodeFacts,
        ciSecrets: [...ciSecrets.entries()].sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1)).map(([n]) => n).slice(0, 12),
      },
    };
  }
  return { exampleSet, envNames, workflowText, well };
}
