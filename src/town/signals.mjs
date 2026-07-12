// src/town/signals.mjs
//
// Read-only collector of facility EVIDENCE the AST scanner (src/scanner.mjs)
// does not capture: package.json metadata, the presence of well-known infra /
// deploy files, dependency-name signals for the town's service facilities, and
// external code-gen contractor self-reports parsed from the local git reflog.
// It answers questions the dependency graph cannot -- is there a way to run
// this (workshop), somewhere to persist data (warehouse), config / secrets
// (well), a public service (inn), an external API / LLM connection (pub), CI
// (workshop), a way to ship it (dock) -- purely from static reads.
//
// SAFETY (non-negotiable): this module NEVER executes target-repository code,
// scripts, tests, hooks, or a package manager. It only reads a small, fixed
// set of files AS DATA: lstat for presence, readFile + JSON.parse for
// package.json, and readFile as plain text for .git/logs/HEAD (never `git`).
// Symlinks are treated as absent (lstat never follows them) so a link can
// never pull a read outside the repo boundary. Every read is bounded (byte
// caps + a <=200 line cap on the reflog + a cap on workflow filenames) and
// every filesystem / JSON error collapses to "signal absent" -- collectSignals
// itself never throws. Missing files (ENOENT) are simply an absent signal.
//
// PURE and DETERMINISTIC: the result is a plain, JSON-serializable function of
// repoPath's on-disk contents. No Date.now, no Math.random, no new Date().
// Output ordering is stable regardless of the filesystem's raw enumeration or
// object key order: dependency-name arrays, script names, and workflow
// filenames are sorted; reflog reports keep the file's own chronological order.
//
// EVIDENCE SEPARATION: every field here is OBSERVED (a fact read from disk) or
// a plainly-named boolean / array DERIVATION of observed facts. Nothing here is
// an inference about correctness, reachability, or "done". A contractor's own
// "完成しました / 修正しました" report is ALWAYS status "pending-inspection":
// a self-report is a claim awaiting town-hall + dojo confirmation against real
// observed signals, never itself evidence of a working town.

import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Read-size / count caps. Every read is bounded so a hostile or accidentally
 * huge file can never blow up memory; anything over the cap is "signal absent".
 */
const DEFAULT_LIMITS = Object.freeze({
  maxPackageJsonBytes: 2 * 1024 * 1024,
  maxReflogBytes: 2 * 1024 * 1024,
  maxReflogLines: 200,
  maxWorkflowFiles: 200
});

/** Well-known infra / deploy files probed for boolean presence (relative to root). */
const PROBE_FILES = Object.freeze({
  env: '.env',
  envExample: '.env.example',
  envLocal: '.env.local',
  npmrc: '.npmrc',
  dockerfile: 'Dockerfile',
  dockerComposeYml: 'docker-compose.yml',
  dockerComposeYaml: 'docker-compose.yaml',
  wranglerToml: 'wrangler.toml',
  vercelJson: 'vercel.json',
  netlifyToml: 'netlify.toml',
  appJson: 'app.json',
  procfile: 'Procfile',
  prismaSchema: 'prisma/schema.prisma'
});

// --- dependency-name pattern tables (verbatim from the town spec) -----------
// exact: full package name match. scopes: "@scope" matching "@scope/anything".
// prefixes: a literal name prefix (e.g. "expo-" matching "expo-router").

/** hasWebServerDep: a public web service could live here (inn / pub). */
const WEB_SERVER = { exact: ['express', 'fastify', 'koa', 'hapi', 'next', 'nuxt', 'hono', 'http-server'], scopes: ['@hono', '@nestjs'] };
/** llmSdks: LLM API connections at the pub -- the ones that can run up a bill. */
const LLM_SDK = { exact: ['openai', 'cohere-ai', '@google/generative-ai', 'replicate', 'langchain'], scopes: ['@anthropic-ai', '@mistralai', '@langchain'] };
/** externalServiceDeps: outside connections at the pub / guild roster. */
const EXTERNAL_SERVICE = { exact: ['stripe', 'resend', 'firebase', 'firebase-admin', 'nodemailer', 'twilio'], scopes: ['@supabase', '@auth0', '@sentry', '@aws-sdk'] };
/** dbDeps: a warehouse (DB / storage) to persist data. */
const DATABASE = { exact: ['pg', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'prisma', '@prisma/client', 'better-sqlite3', 'sqlite3', 'redis', 'ioredis', 'drizzle-orm', 'kysely', 'typeorm', 'sequelize'], scopes: [] };
/** loggerDeps: a watchtower (logs / monitoring). @sentry doubles as observability. */
const LOGGER = { exact: ['pino', 'winston', 'bunyan'], scopes: ['@sentry', '@opentelemetry'] };
/** distribution.reactNativeOrExpo: a dock that ships a mobile app. */
const MOBILE_DISTRIBUTION = { exact: ['react-native', 'expo'], prefixes: ['expo-'], scopes: ['@expo'] };
/** distribution.electron: a dock that ships a desktop app. */
const ELECTRON = { exact: ['electron'], prefixes: ['electron-'], scopes: ['@electron', '@electron-forge'] };
/** hasDotenvDep: the well is wired to load .env at runtime. */
const DOTENV = { exact: ['dotenv'], prefixes: ['dotenv-'], scopes: [] };

/** A git reflog line: "<old-sha> <new-sha> <name> <email> <ts> <tz>\t<subject>". */
const REFLOG_LINE = /^[0-9a-f]{40,64}\s+[0-9a-f]{40,64}\s+(.+?)\s+<[^>]*>\s+\d+\s+[+-]\d{4}\t(.*)$/;
/** An entry looks like an external code-gen contractor's work. */
const CONTRACTOR_PATTERN = /claude|codex|copilot|cursor|github-actions|\bbot\b/i;
/** A "pub" (incoming external call) hint. */
const WEBHOOK_PATTERN = /webhook/i;

// --- generic fs-as-data helpers (never throw, never execute anything) -------

/**
 * Clamp an option to a positive safe integer, else fall back. Guards against
 * NaN / negative / non-integer overrides so caps can never be defeated.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {boolean} true only for a plain (non-null, non-array) object
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * lstat that never throws (symlinks are NOT followed, so a symlink reports as
 * its link and never as its target).
 * @param {string} targetPath
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function statSafe(targetPath) {
  try {
    return await lstat(targetPath);
  } catch {
    return null;
  }
}

/**
 * True only when `relativePath` under `root` is a regular file. Symlinks
 * (even to a real file) are excluded, keeping presence probes inside the repo
 * boundary. Never throws.
 * @param {string} root
 * @param {string} relativePath
 * @returns {Promise<boolean>}
 */
async function isRegularFile(root, relativePath) {
  const stat = await statSafe(path.join(root, relativePath));
  return Boolean(stat && stat.isFile());
}

/**
 * List workflow filenames (`*.yml` / `*.yaml`, since GitHub Actions honors
 * both) directly inside root/.github/workflows. Symlinked entries are skipped.
 * Names are sorted BEFORE the cap is applied, so which filenames survive
 * truncation is deterministic and never depends on the filesystem's raw
 * enumeration order. Returns [] when the directory is absent / unreadable /
 * not a directory -- never throws.
 * @param {string} root
 * @param {number} maxFiles
 * @returns {Promise<string[]>}
 */
async function listWorkflowFiles(root, maxFiles) {
  let entries;
  try {
    entries = await readdir(path.join(root, '.github', 'workflows'), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .slice(0, maxFiles);
}

/**
 * Best-effort, size-capped read + parse of package.json. Returns the parsed
 * object only when it is a plain object; missing / oversized / unreadable /
 * non-object-JSON all return null (never throws), per "fs error => absent".
 * @param {string} root
 * @param {number} maxBytes
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readPackageJson(root, maxBytes) {
  const packagePath = path.join(root, 'package.json');
  const stat = await statSafe(packagePath);
  if (!stat || !stat.isFile() || stat.size > maxBytes) return null;
  try {
    const parsed = JSON.parse(await readFile(packagePath, 'utf8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// --- package.json field normalization (defensive against malformed input) ---

/** @param {unknown} value @returns {string | null} */
function asStringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

/** @param {unknown} value @returns {string[] | null} a fresh array, or null if not a string[] */
function asStringArrayOrNull(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : null;
}

/**
 * Coerce a name->value map (dependencies / devDependencies / scripts) into a
 * plain string-valued object, dropping any non-string entry so the shape is an
 * honest Record<string,string>.
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function stringMap(value) {
  const out = {};
  if (isPlainObject(value)) {
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'string') out[key] = val;
    }
  }
  return out;
}

/**
 * package.json "bin" may be a string (single bin) or a name->path object; keep
 * either (object shallow-copied) or null.
 * @param {unknown} value
 * @returns {string | Record<string, unknown> | null}
 */
function normalizeBin(value) {
  if (typeof value === 'string') return value;
  if (isPlainObject(value)) return { ...value };
  return null;
}

/** @param {string | Record<string, unknown> | null} bin @returns {boolean} */
function hasNonEmptyBin(bin) {
  if (typeof bin === 'string') return bin.length > 0;
  if (isPlainObject(bin)) return Object.keys(bin).length > 0;
  return false;
}

// --- dependency-name -> facility signal matching ----------------------------

/**
 * Filter `depNames` (already sorted + deduped) to those matching a pattern
 * table. `exact` matches the whole name; `scopes` match "@scope/anything";
 * `prefixes` match any literal name prefix. Order is preserved (input is
 * sorted), so the result is deterministic.
 * @param {string[]} depNames
 * @param {{ exact?: string[], scopes?: string[], prefixes?: string[] }} pattern
 * @returns {string[]}
 */
function matchDeps(depNames, { exact = [], scopes = [], prefixes = [] } = {}) {
  const exactSet = new Set(exact);
  return depNames.filter((name) =>
    exactSet.has(name)
    || prefixes.some((prefix) => name.startsWith(prefix))
    || scopes.some((scope) => name.startsWith(`${scope}/`))
  );
}

/**
 * Union of dependency + devDependency names, deduped and sorted for stable,
 * key-order-independent output.
 * @param {Record<string, string>} dependencies
 * @param {Record<string, string>} devDependencies
 * @returns {string[]}
 */
function unionDependencyNames(dependencies, devDependencies) {
  return [...new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)])].sort();
}

/**
 * "webhook" appearing in a dependency name, a script name or command, or a
 * workflow filename is a soft hint that this town takes incoming external
 * calls at the pub. A HINT, not proof -- purely a substring scan of observed
 * text.
 * @param {{ depNames: string[], scriptTexts: string[], workflowFiles: string[] }} sources
 * @returns {boolean}
 */
function detectWebhookHint({ depNames, scriptTexts, workflowFiles }) {
  return depNames.some((name) => WEBHOOK_PATTERN.test(name))
    || scriptTexts.some((text) => WEBHOOK_PATTERN.test(text))
    || workflowFiles.some((name) => WEBHOOK_PATTERN.test(name));
}

// --- external contractor self-reports (.git/logs/HEAD, read-only text) ------

/**
 * Map free text to a canonical contractor source id (matching the
 * ContractorReport examples in schema.mjs: "claude-code", "codex", ...).
 * Returns null when the text names no known contractor.
 * @param {string} text
 * @returns {string | null}
 */
function sourceFromText(text) {
  if (/claude/i.test(text)) return 'claude-code';
  if (/codex/i.test(text)) return 'codex';
  if (/copilot/i.test(text)) return 'copilot';
  if (/cursor/i.test(text)) return 'cursor';
  if (/github-actions/i.test(text)) return 'github-actions';
  if (/\bbot\b/i.test(text)) return 'bot';
  return null;
}

/**
 * Identify the contractor behind a reflog entry: prefer the committer name
 * (the strongest signal of who produced it), fall back to the subject, and
 * finally to the generic "bot". Only reached for entries already known to
 * match CONTRACTOR_PATTERN, so a non-null id always exists.
 * @param {string} author
 * @param {string} subject
 * @returns {string}
 */
function detectContractorSource(author, subject) {
  return sourceFromText(author) ?? sourceFromText(subject) ?? 'bot';
}

/**
 * Parse the tail (<= maxLines) of .git/logs/HEAD as plain text -- NEVER runs
 * `git` -- into ContractorReport entries whose committer or subject looks like
 * an external code-gen contractor. Entries keep the file's chronological
 * order; unparseable lines are skipped, not thrown on. Missing / oversized /
 * unreadable reflog -> []. Per project rule every report's status is the
 * literal "pending-inspection": a self-report is never itself evidence.
 * @param {string} root
 * @param {{ maxBytes: number, maxLines: number }} limits
 * @returns {Promise<Array<import('./schema.mjs').ContractorReport>>}
 */
async function collectContractorReports(root, { maxBytes, maxLines }) {
  const reflogPath = path.join(root, '.git', 'logs', 'HEAD');
  const stat = await statSafe(reflogPath);
  if (!stat || !stat.isFile() || stat.size > maxBytes) return [];

  let raw;
  try {
    raw = await readFile(reflogPath, 'utf8');
  } catch {
    return [];
  }

  const lines = raw
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0)
    .slice(-maxLines);

  const reports = [];
  for (const line of lines) {
    const match = REFLOG_LINE.exec(line);
    if (!match) continue;
    const author = match[1].trim();
    const subject = match[2].trim();
    if (!CONTRACTOR_PATTERN.test(author) && !CONTRACTOR_PATTERN.test(subject)) continue;
    reports.push({ source: detectContractorSource(author, subject), subject, status: 'pending-inspection' });
  }
  return reports;
}

// --- main entry point -------------------------------------------------------

/**
 * Collect read-only facility evidence from a repository that the AST scanner
 * does not surface. Best-effort and non-throwing: every missing / unreadable
 * source yields an absent (false / empty / null) signal rather than an error.
 * Never executes target-repository code. Deterministic and JSON-serializable.
 * @param {string} repoPath - path to the repository root to inspect
 * @param {{ maxPackageJsonBytes?: number, maxReflogBytes?: number, maxReflogLines?: number, maxWorkflowFiles?: number }} [options]
 * @returns {Promise<RepoSignals>}
 */
export async function collectSignals(repoPath, options = {}) {
  const limits = {
    maxPackageJsonBytes: positiveInteger(options.maxPackageJsonBytes, DEFAULT_LIMITS.maxPackageJsonBytes),
    maxReflogBytes: positiveInteger(options.maxReflogBytes, DEFAULT_LIMITS.maxReflogBytes),
    maxReflogLines: Math.min(positiveInteger(options.maxReflogLines, DEFAULT_LIMITS.maxReflogLines), DEFAULT_LIMITS.maxReflogLines),
    maxWorkflowFiles: Math.min(positiveInteger(options.maxWorkflowFiles, DEFAULT_LIMITS.maxWorkflowFiles), DEFAULT_LIMITS.maxWorkflowFiles)
  };

  const root = path.resolve(repoPath);

  // package.json: a single bounded read, normalized defensively.
  const pkg = (await readPackageJson(root, limits.maxPackageJsonBytes)) ?? null;
  const source = pkg ?? {};
  const dependencies = stringMap(source.dependencies);
  const devDependencies = stringMap(source.devDependencies);
  const scripts = stringMap(source.scripts);
  const bin = normalizeBin(source.bin);
  const depNames = unionDependencyNames(dependencies, devDependencies);

  // Well-known file presence + reflog, gathered concurrently (all non-throwing).
  const probeKeys = Object.keys(PROBE_FILES);
  const [probeResults, workflowFiles, contractorReports] = await Promise.all([
    Promise.all(probeKeys.map((key) => isRegularFile(root, PROBE_FILES[key]))),
    listWorkflowFiles(root, limits.maxWorkflowFiles),
    collectContractorReports(root, { maxBytes: limits.maxReflogBytes, maxLines: limits.maxReflogLines })
  ]);
  const probe = Object.fromEntries(probeKeys.map((key, index) => [key, probeResults[index]]));

  const files = {
    env: probe.env,
    envExample: probe.envExample,
    envLocal: probe.envLocal,
    npmrc: probe.npmrc,
    dockerfile: probe.dockerfile,
    dockerCompose: probe.dockerComposeYml || probe.dockerComposeYaml,
    githubWorkflows: workflowFiles.length > 0,
    githubWorkflowFiles: workflowFiles,
    wranglerToml: probe.wranglerToml,
    vercelJson: probe.vercelJson,
    netlifyToml: probe.netlifyToml,
    appJson: probe.appJson,
    procfile: probe.procfile,
    prismaSchema: probe.prismaSchema
  };

  // Scripts: a base script "build" OR any "build:*" variant counts, so a repo
  // with only "build:web" / "test:unit" is not mis-read as having no build/test.
  const scriptNames = Object.keys(scripts).sort();
  const hasScript = (base) => scriptNames.some((name) => name === base || name.startsWith(`${base}:`));
  const scriptTexts = scriptNames.flatMap((name) => [name, scripts[name]]);

  const webServerDeps = matchDeps(depNames, WEB_SERVER);
  const llmSdks = matchDeps(depNames, LLM_SDK);
  const externalServiceDeps = matchDeps(depNames, EXTERNAL_SERVICE);
  const dbDeps = matchDeps(depNames, DATABASE);
  const loggerDeps = matchDeps(depNames, LOGGER);

  return {
    repository: { name: path.basename(root) },
    packageJson: {
      present: pkg !== null,
      name: asStringOrNull(source.name),
      private: source.private === true,
      dependencies,
      devDependencies,
      scripts,
      bin,
      main: asStringOrNull(source.main),
      module: asStringOrNull(source.module),
      exports: source.exports ?? null,
      files: asStringArrayOrNull(source.files),
      publishConfig: isPlainObject(source.publishConfig) ? { ...source.publishConfig } : null,
      engines: isPlainObject(source.engines) ? { ...source.engines } : null
    },
    files,
    hasWebServerDep: webServerDeps.length > 0,
    webServerDeps,
    llmSdks,
    externalServiceDeps,
    dbDeps,
    loggerDeps,
    distribution: {
      reactNativeOrExpo: matchDeps(depNames, MOBILE_DISTRIBUTION).length > 0,
      electron: matchDeps(depNames, ELECTRON).length > 0,
      hasBinField: hasNonEmptyBin(bin),
      isPublishablePackage: pkg !== null && source.private !== true && typeof source.name === 'string' && source.name.trim().length > 0
    },
    scripts: {
      hasBuild: hasScript('build'),
      hasTest: hasScript('test'),
      hasStart: hasScript('start'),
      hasLint: hasScript('lint'),
      names: scriptNames
    },
    hasCI: files.githubWorkflows,
    hasEnvFiles: files.env || files.envExample || files.envLocal,
    hasDotenvDep: matchDeps(depNames, DOTENV).length > 0,
    hasDockerfile: files.dockerfile,
    webhookHint: detectWebhookHint({ depNames, scriptTexts, workflowFiles }),
    external: { contractorReports }
  };
}

/** The default read caps, exposed so callers / tests can reference them. */
export const signalDefaults = DEFAULT_LIMITS;

// --- Local type contracts (JSDoc @typedef only; no runtime binding) ---------
// RepoSignals is NOT declared in the frozen src/town/schema.mjs, so its shape
// is defined here. Every field is either an OBSERVED fact or a plainly-named
// derivation of observed facts; ContractorReport is imported from the frozen
// schema so contractor self-reports stay exactly {source, subject, status}.

/**
 * @typedef {import('./schema.mjs').ContractorReport} ContractorReport
 */

/**
 * Raw package.json fields relevant to town facilities, read verbatim
 * (best-effort, size-capped) and NEVER executed. `private` is captured because
 * distribution.isPublishablePackage needs it and it comes free from the same
 * parse.
 * @typedef {Object} PackageJsonSignals
 * @property {boolean} present - false when package.json is absent, oversized, or unparseable
 * @property {string|null} name
 * @property {boolean} private
 * @property {Record<string,string>} dependencies
 * @property {Record<string,string>} devDependencies
 * @property {Record<string,string>} scripts - script name -> raw command text (never executed)
 * @property {string|Record<string,unknown>|null} bin
 * @property {string|null} main
 * @property {string|null} module
 * @property {*} exports - raw "exports" field (shape varies by project) or null
 * @property {string[]|null} files - the npm "files" allowlist, or null when absent/malformed
 * @property {Record<string,unknown>|null} publishConfig
 * @property {Record<string,unknown>|null} engines
 */

/**
 * Boolean presence of well-known infra / deploy files, checked via lstat only
 * (symlinks do not count as present). githubWorkflowFiles is sorted and capped.
 * @typedef {Object} FileSignals
 * @property {boolean} env - .env
 * @property {boolean} envExample - .env.example
 * @property {boolean} envLocal - .env.local
 * @property {boolean} npmrc - .npmrc
 * @property {boolean} dockerfile - Dockerfile
 * @property {boolean} dockerCompose - docker-compose.yml or docker-compose.yaml
 * @property {boolean} githubWorkflows - at least one *.yml / *.yaml under .github/workflows
 * @property {string[]} githubWorkflowFiles - those workflow filenames, sorted then capped
 * @property {boolean} wranglerToml - wrangler.toml
 * @property {boolean} vercelJson - vercel.json
 * @property {boolean} netlifyToml - netlify.toml
 * @property {boolean} appJson - app.json
 * @property {boolean} procfile - Procfile
 * @property {boolean} prismaSchema - prisma/schema.prisma
 */

/**
 * @typedef {Object} DistributionSignals
 * @property {boolean} reactNativeOrExpo - a mobile app the dock could ship
 * @property {boolean} electron - a desktop app the dock could ship
 * @property {boolean} hasBinField - package.json declares a non-empty "bin"
 * @property {boolean} isPublishablePackage - present, not private, and named
 */

/**
 * @typedef {Object} ScriptSignals
 * @property {boolean} hasBuild - a script named "build" or "build:*"
 * @property {boolean} hasTest - a script named "test" or "test:*"
 * @property {boolean} hasStart - a script named "start" or "start:*"
 * @property {boolean} hasLint - a script named "lint" or "lint:*"
 * @property {string[]} names - all declared script names, sorted
 */

/**
 * The full read-only signal bag for one repository, consumed by detect.mjs
 * (facility derivation) and, via the TownModel it builds, habitability.mjs.
 * Deterministic for a given on-disk state and plain-JSON serializable; it is
 * intentionally NOT frozen so a downstream builder may fold it into a
 * TownModel freely.
 * @typedef {Object} RepoSignals
 * @property {{ name: string }} repository - repo display name (basename of the resolved path)
 * @property {PackageJsonSignals} packageJson
 * @property {FileSignals} files
 * @property {boolean} hasWebServerDep - a web-server framework is a dependency
 * @property {string[]} webServerDeps - the matched web-server dependency names backing hasWebServerDep
 * @property {string[]} llmSdks - matched LLM SDK dependency names (openai, @anthropic-ai/*, ...)
 * @property {string[]} externalServiceDeps - matched external-service dependency names (stripe, @supabase/*, ...)
 * @property {string[]} dbDeps - matched database / storage dependency names
 * @property {string[]} loggerDeps - matched logging / observability dependency names
 * @property {DistributionSignals} distribution
 * @property {ScriptSignals} scripts
 * @property {boolean} hasCI - at least one workflow file under .github/workflows
 * @property {boolean} hasEnvFiles - any of .env / .env.example / .env.local present
 * @property {boolean} hasDotenvDep - "dotenv" or "dotenv-*" is a dependency
 * @property {boolean} hasDockerfile - convenience alias of files.dockerfile
 * @property {boolean} webhookHint - "webhook" appears in a dep name, script name/command, or workflow filename
 * @property {{ contractorReports: ContractorReport[] }} external - self-reports from .git/logs/HEAD, always status "pending-inspection"
 */
