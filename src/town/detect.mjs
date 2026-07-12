// src/town/detect.mjs
//
// Projects one inspection (src/inspector.mjs buildInspection(scan) output,
// schemaVersion 2) plus one RepoSignals bag (from the sibling
// src/town/signals.mjs) onto the town-facility vocabulary: a Facility per
// FACILITY_KIND from ./schema.mjs — present ONLY when backed by real
// evidence — the 接続者ギルド (connections-guild) five-tab roster, and any
// external code-gen contractor self-reports (always pending-inspection,
// never a reward).
//
// PURE, SYNCHRONOUS, DETERMINISTIC: no I/O, no Date.now / Math.random /
// new Date(); same (inspection, signals) in => structurally identical
// TownModel out. The target repository is never read or executed here — that
// already happened upstream in scanner.mjs. This module only re-shapes data
// that was already collected. It also never mutates its arguments: every
// array pulled from `inspection` / `signals` is copied before it can be
// embedded in the (deep-frozen) result, so freezing the model can never
// reach back and freeze a live array still owned by the caller.
//
// ./schema.mjs is the ONLY cross-module contract this file relies on. It is
// built in parallel with signals.mjs and habitability.mjs, so nothing here
// assumes their internals — only the schema shapes. schema.mjs does not (yet)
// declare a RepoSignals typedef, so the shape this module reads is documented
// locally below; every field is read defensively (optional chaining + array
// guards) so a missing, renamed, or malformed signal degrades to "signal
// absent", never a crash and never a fabricated fact.
//
// EVIDENCE SEPARATION is load-bearing: every fact is tagged observed
// (statically read), inferred (derived from observed facts), or unknown
// (needs runtime / not scanned). "Untested" / "not reached" is UNKNOWN, never
// a synonym for "broken".

import { FACILITY_KINDS, GUILD_TABS, isFacilityKind, makeEvidence, deepFreeze } from './schema.mjs';

/** @typedef {import('./schema.mjs').Evidence} Evidence */
/** @typedef {import('./schema.mjs').Facility} Facility */
/** @typedef {import('./schema.mjs').ContractorReport} ContractorReport */
/** @typedef {import('./schema.mjs').TownModel} TownModel */

/**
 * The RepoSignals shape this module reads. schema.mjs does not declare it
 * (signals.mjs owns it and is built in parallel), so it is documented here.
 * DOCUMENTED fields are the ones named in the town-redesign brief. FORWARD
 * fields are optional extras a richer signals.mjs may emit to fill the
 * 接続者ギルド もちもの / じょうたい panels; when absent they degrade to an
 * honest "unknown", never to a negative finding. Every field is optional from
 * this module's point of view.
 *
 * @typedef {Object} RepoSignals
 * // -- documented (brief) --
 * @property {boolean} [hasWebServerDep]        web-server framework dep observed (express/fastify/koa/next/http...)
 * @property {string[]} [webServerDeps]         the dep names behind hasWebServerDep, when known
 * @property {string[]} [llmSdks]               LLM / model-provider SDK dep names (e.g. "@anthropic-ai/sdk", "openai")
 * @property {string[]} [externalServiceDeps]   other external-service client dep names (e.g. "stripe", "twilio")
 * @property {boolean} [webhookHint]            a webhook / inbound-callback route or handler was observed
 * @property {Object}  [distribution]
 * @property {boolean} [distribution.reactNativeOrExpo]
 * @property {boolean} [distribution.electron]
 * @property {boolean} [distribution.hasBinField]
 * @property {boolean} [distribution.isPublishablePackage]
 * @property {string[]} [dbDeps]                database / storage client dep names
 * @property {boolean} [hasEnvFiles]            a .env-shaped file was observed on disk
 * @property {boolean} [hasDotenvDep]           a dotenv-family dep was observed
 * @property {Object}  [scripts]
 * @property {boolean} [scripts.hasBuild]       package.json declares a "build" script
 * @property {boolean} [scripts.hasTest]        package.json declares a "test" script
 * @property {boolean} [hasCI]                  a CI config file was observed (e.g. .github/workflows/*)
 * @property {string[]} [loggerDeps]            logging / monitoring dep names
 * @property {Array<{source?: string, subject?: string}>} [contractorReports] external code-gen self-reports
 * // -- forward-looking (optional; absent => unknown, never a negative finding) --
 * @property {string[]} [apiKeyEnvNames]        env-var names that look like API keys / secrets
 * @property {string[]} [configSchemaFiles]     config / validation schema file paths (zod / JSON schema ...)
 * @property {string[]} [promptFiles]           prompt-template file paths
 * @property {string[]} [toolPermissionHints]   tool-permission / allowlist config hints (e.g. MCP tool grants)
 * @property {string[]} [authDeps]              auth / authorization dep names, when detected
 */

const SAMPLE_LIMIT = 8;

// The interface-kind subset that additionally reads as a request surface.
// service-kind files are already gated by scanner.mjs classify() on a
// /server|api|routes?/ path segment, so they always qualify; interface-kind
// files (components/pages/views/ui) only qualify when their path also names a
// route/handler, so plain UI is not counted as a connection.
const INTERFACE_ROUTE_PATTERN = /(route|routes|endpoint|controller|handler|webhook)/i;

// --- generic, defensive helpers ---------------------------------------------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truthy(value) {
  return value === true;
}

/**
 * Fresh array copy so an array pulled from the caller's inspection / signals
 * can never be frozen in place when the result is deep-frozen. Non-arrays
 * (absent / malformed signal) become an empty array: "signal absent".
 */
function arr(value) {
  return Array.isArray(value) ? [...value] : [];
}

function normalizeCount(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function sortByPath(buildings) {
  return [...buildings].sort((left, right) => String(left?.path ?? '').localeCompare(String(right?.path ?? '')));
}

/** Deterministic, truncated list of building paths for `details.sample`. */
function sampleOf(buildings) {
  return sortByPath(buildings).slice(0, SAMPLE_LIMIT).map((building) => building?.path);
}

/** Deterministic, truncation-aware description of buildings for evidence text. */
function describe(buildings) {
  const sorted = sortByPath(buildings);
  const shown = sorted.slice(0, SAMPLE_LIMIT).map((building) => building?.path);
  if (shown.length === 0) return '(none)';
  const remainder = sorted.length - shown.length;
  return remainder > 0 ? `${shown.join(', ')}, and ${remainder} more` : shown.join(', ');
}

/**
 * A building counts as an API / route-facing "connection" for pub, the guild
 * facility, and the うけつけ tab when the scanner classified it as a service,
 * or when it is an interface-kind file whose path also reads as route-like.
 * Non-throwing: any non-building input returns false.
 * @param {any} building
 * @returns {boolean}
 */
export function isConnectionBuilding(building) {
  if (!building || typeof building !== 'object') return false;
  if (building.kind === 'service') return true;
  if (building.kind === 'interface') return INTERFACE_ROUTE_PATTERN.test(String(building.path ?? ''));
  return false;
}

/**
 * Build one Facility, centralizing the shared invariants so no per-kind
 * builder can violate them: `kind` must be a real FACILITY_KIND, `count` is a
 * non-negative integer, and an absent facility (present:false) always carries
 * at least one reason so "no signal => present:false with a reason" holds even
 * if a builder forgot to add one.
 * @param {string} kind
 * @param {{present?: boolean, count?: number, evidence?: Evidence, details?: object}} [options]
 * @returns {Facility}
 */
function makeFacility(kind, options = {}) {
  if (!isFacilityKind(kind)) throw new TypeError(`buildTownModel: "${String(kind)}" is not a valid FACILITY_KIND`);
  const { present = false, count = 0, evidence, details } = options;
  const bag = isPlainObject(evidence) ? evidence : makeEvidence();
  const observed = Array.isArray(bag.observed) ? bag.observed : [];
  const inferred = Array.isArray(bag.inferred) ? bag.inferred : [];
  const unknown = Array.isArray(bag.unknown) ? bag.unknown : [];
  if (!present && observed.length === 0 && inferred.length === 0 && unknown.length === 0) {
    unknown.push(`no observed or inferred signal for "${kind}" was found in this scan.`);
  }
  const facility = {
    kind,
    present: Boolean(present),
    count: normalizeCount(count),
    evidence: { observed, inferred, unknown }
  };
  if (details !== undefined) facility.details = details;
  return facility;
}

// --- per-facility builders --------------------------------------------------
// Each reads only the shared ctx and returns a Facility. None mutate ctx,
// inspection, signals, or each other's output.

// town_hall (役場) is ALWAYS present: every scanned repository has, at minimum,
// an identity. Contractor self-reports are attached as UNKNOWN / pending —
// a contractor's own "done" claim is never itself evidence of a working town.
function buildTownHall(ctx) {
  const evidence = makeEvidence();
  const name = ctx.repository?.name;
  evidence.observed.push(name ? `repository "${name}" was scanned.` : 'a repository was scanned (no name recorded).');
  evidence.observed.push(`${normalizeCount(ctx.summary.filesScanned)} of ${normalizeCount(ctx.summary.filesDiscovered)} discovered file(s) were scanned.`);
  evidence.unknown.push('git commit history, issues, and releases were not read; only static file contents were scanned.');
  if (ctx.contractorReports.length > 0) {
    evidence.unknown.push(
      `${ctx.contractorReports.length} external code-gen contractor report(s) are pending town-hall inspection; a contractor's own "done" claim is never itself evidence.`
    );
  } else {
    evidence.unknown.push('no external code-gen contractor reports were supplied.');
  }
  return makeFacility('town_hall', {
    present: true,
    count: 1,
    evidence,
    details: { repositoryName: name ?? null, contractorReportCount: ctx.contractorReports.length }
  });
}

// inn (宿屋) = a public web service someone can check into.
function buildInn(ctx) {
  const evidence = makeEvidence();
  const serviceBuildings = ctx.buildings.filter((building) => building?.kind === 'service');
  const hasWebServerDep = truthy(ctx.sig.hasWebServerDep);
  const webServerDeps = arr(ctx.sig.webServerDeps);
  const contributors = serviceBuildings.length + (hasWebServerDep ? 1 : 0);
  if (webServerDeps.length > 0) evidence.observed.push(`web-server dependency: ${webServerDeps.join(', ')}.`);
  else if (hasWebServerDep) evidence.observed.push('a web-server-framework dependency was observed.');
  if (serviceBuildings.length > 0) {
    evidence.observed.push(`${serviceBuildings.length} file(s) classified as a service (server/api/routes path): ${describe(serviceBuildings)}.`);
  }
  const present = contributors > 0;
  if (present) evidence.unknown.push('whether the service is actually deployed, started, or reachable by a real visitor was not scanned (static evidence only).');
  return makeFacility('inn', {
    present,
    count: contributors,
    evidence,
    details: present ? { serviceBuildingCount: serviceBuildings.length, hasWebServerDep, sample: sampleOf(serviceBuildings) } : undefined
  });
}

// pub (酒場) = where the town talks to the outside world: APIs, external
// services, LLM providers, webhooks.
function buildPub(ctx) {
  const evidence = makeEvidence();
  const { llmSdks, externalServiceDeps, webhookHint, buildings: connectionBuildings } = ctx.connection;
  if (llmSdks.length > 0) evidence.observed.push(`LLM SDK dependency: ${llmSdks.join(', ')}.`);
  if (externalServiceDeps.length > 0) evidence.observed.push(`external-service dependency: ${externalServiceDeps.join(', ')}.`);
  if (webhookHint) evidence.observed.push('a webhook / inbound-callback hint was observed.');
  if (connectionBuildings.length > 0) evidence.observed.push(`${connectionBuildings.length} file(s) read as API routes / handlers: ${describe(connectionBuildings)}.`);
  const present = ctx.connection.any;
  const count = llmSdks.length + externalServiceDeps.length + (webhookHint ? 1 : 0) + connectionBuildings.length;
  if (present) evidence.unknown.push('whether these external connections actually succeed at runtime, and any request / cost limits, were not scanned (static evidence only).');
  return makeFacility('pub', {
    present,
    count,
    evidence,
    details: present ? { llmSdks, externalServiceDeps, webhookHint, routeLikeBuildingCount: connectionBuildings.length } : undefined
  });
}

// guild (接続者ギルド) = the roster of whoever the pub talks to. The brief
// specifies present-if rules for every other kind but not for the guild
// facility itself (only for the model.guild panel); by design it shares pub's
// exact connection condition, since "guild = roster of connections" is pub's
// own evidence seen as a roster.
function buildGuildFacility(ctx) {
  const evidence = makeEvidence();
  const { llmSdks, externalServiceDeps, webhookHint, buildings: connectionBuildings } = ctx.connection;
  const rosterSize = llmSdks.length + externalServiceDeps.length + connectionBuildings.length;
  if (rosterSize > 0) {
    evidence.observed.push(
      `${rosterSize} roster member(s): ${llmSdks.length} LLM SDK(s), ${externalServiceDeps.length} external-service dep(s), ${connectionBuildings.length} route-like file(s).`
    );
  }
  if (webhookHint) evidence.observed.push('an inbound webhook / callback hint was observed.');
  const present = ctx.connection.any;
  if (present) evidence.unknown.push('actual connectivity, authentication, and cost limits with these roster members were not tested at runtime.');
  return makeFacility('guild', {
    present,
    count: rosterSize,
    evidence,
    details: present
      ? { memberCount: llmSdks.length + externalServiceDeps.length, receptionCount: connectionBuildings.length, webhookHint }
      : undefined
  });
}

// dock (船着場) = mobile / desktop / package distribution.
function buildDock(ctx) {
  const evidence = makeEvidence();
  const distribution = isPlainObject(ctx.sig.distribution) ? ctx.sig.distribution : {};
  const flagMessages = [
    ['reactNativeOrExpo', 'a React Native or Expo dependency was observed.'],
    ['electron', 'an Electron dependency was observed.'],
    ['hasBinField', 'package.json declares a "bin" field.'],
    ['isPublishablePackage', 'the package is publishable (not marked private).']
  ];
  const flags = {};
  const active = [];
  for (const [key, message] of flagMessages) {
    flags[key] = truthy(distribution[key]);
    if (flags[key]) {
      active.push(key);
      evidence.observed.push(message);
    }
  }
  const present = active.length > 0;
  if (present) evidence.unknown.push('whether a distributable build / package was actually produced, signed, or published was not scanned.');
  return makeFacility('dock', { present, count: active.length, evidence, details: present ? { flags, active } : undefined });
}

// warehouse (倉庫) = databases / storage.
function buildWarehouse(ctx) {
  const evidence = makeEvidence();
  const dbDeps = arr(ctx.sig.dbDeps);
  const dataBuildings = ctx.buildings.filter((building) => building?.kind === 'data');
  const contributors = dbDeps.length + dataBuildings.length;
  if (dbDeps.length > 0) evidence.observed.push(`database / storage dependency: ${dbDeps.join(', ')}.`);
  if (dataBuildings.length > 0) evidence.observed.push(`${dataBuildings.length} file(s) classified as data / model / db: ${describe(dataBuildings)}.`);
  const present = contributors > 0;
  if (present) evidence.unknown.push('actual database connectivity, provisioning, schema, and stored data are unknown without running the code.');
  return makeFacility('warehouse', {
    present,
    count: contributors,
    evidence,
    details: present ? { dbDeps, dataBuildingCount: dataBuildings.length, sample: sampleOf(dataBuildings) } : undefined
  });
}

// well (井戸) = env / secrets / config, the water supply a town needs to live.
function buildWell(ctx) {
  const evidence = makeEvidence();
  const hasEnvFiles = truthy(ctx.sig.hasEnvFiles);
  const hasDotenvDep = truthy(ctx.sig.hasDotenvDep);
  const configBuildings = ctx.buildings.filter((building) => building?.kind === 'configuration');
  const contributors = configBuildings.length + (hasEnvFiles ? 1 : 0) + (hasDotenvDep ? 1 : 0);
  if (hasEnvFiles) evidence.observed.push('one or more .env-shaped files were observed.');
  if (hasDotenvDep) evidence.observed.push('a dotenv-family dependency was observed.');
  if (configBuildings.length > 0) evidence.observed.push(`${configBuildings.length} file(s) classified as configuration: ${describe(configBuildings)}.`);
  const present = contributors > 0;
  if (present) evidence.unknown.push('actual secret values, and whether every required env var is set at runtime, were not read (out of scope) and are unknown.');
  return makeFacility('well', {
    present,
    count: contributors,
    evidence,
    details: present ? { hasEnvFiles, hasDotenvDep, configurationBuildingCount: configBuildings.length, sample: sampleOf(configBuildings) } : undefined
  });
}

// workshop (工房) = build / local run / CI, where the town is assembled.
function buildWorkshop(ctx) {
  const evidence = makeEvidence();
  const hasBuild = truthy(ctx.sig.scripts?.hasBuild);
  const hasCI = truthy(ctx.sig.hasCI);
  const contributors = (hasBuild ? 1 : 0) + (hasCI ? 1 : 0);
  if (hasBuild) evidence.observed.push('package.json declares a "build" script.');
  if (hasCI) evidence.observed.push('a CI configuration was observed.');
  const present = contributors > 0;
  if (present) evidence.unknown.push('whether the build or CI pipeline actually succeeds was not executed; target-repo scripts are never run by this tool.');
  return makeFacility('workshop', { present, count: contributors, evidence, details: present ? { hasBuild, hasCI } : undefined });
}

// dojo (道場) = tests / verification. Untested is not the same as broken.
function buildDojo(ctx) {
  const evidence = makeEvidence();
  const testBuildings = ctx.buildings.filter((building) => building?.isTest);
  const hasTestScript = truthy(ctx.sig.scripts?.hasTest);
  const testAssociations = normalizeCount(ctx.summary.testAssociations);
  const contributors = testBuildings.length + (hasTestScript ? 1 : 0) + (testAssociations > 0 ? 1 : 0);
  if (testBuildings.length > 0) evidence.observed.push(`${testBuildings.length} test file(s) observed: ${describe(testBuildings)}.`);
  if (hasTestScript) evidence.observed.push('package.json declares a "test" script.');
  if (testAssociations > 0) evidence.inferred.push(`${testAssociations} source/test association(s) inferred from direct imports or unique filename matching.`);
  const present = contributors > 0;
  if (present) evidence.unknown.push('whether these tests currently pass was not executed; target-repo tests are never run by this tool. Untested is not broken.');
  return makeFacility('dojo', {
    present,
    count: contributors,
    evidence,
    details: present ? { testBuildingCount: testBuildings.length, hasTestScript, testAssociations, sample: sampleOf(testBuildings) } : undefined
  });
}

// watchtower (見張り台) = logs / monitoring / alerts.
function buildWatchtower(ctx) {
  const evidence = makeEvidence();
  const loggerDeps = arr(ctx.sig.loggerDeps);
  if (loggerDeps.length > 0) evidence.observed.push(`logging / monitoring dependency: ${loggerDeps.join(', ')}.`);
  const present = loggerDeps.length > 0;
  if (present) evidence.unknown.push('whether logs / alerts actually fire at runtime, and where they are shipped or retained, is unknown.');
  return makeFacility('watchtower', { present, count: loggerDeps.length, evidence, details: present ? { loggerDeps } : undefined });
}

// house (住宅) = ordinary living modules (module-kind files).
function buildHouse(ctx) {
  const evidence = makeEvidence();
  const moduleBuildings = ctx.buildings.filter((building) => building?.kind === 'module');
  if (moduleBuildings.length > 0) evidence.observed.push(`${moduleBuildings.length} ordinary module file(s) observed: ${describe(moduleBuildings)}.`);
  const present = moduleBuildings.length > 0;
  return makeFacility('house', {
    present,
    count: moduleBuildings.length,
    evidence,
    details: present ? { sample: sampleOf(moduleBuildings) } : undefined
  });
}

// shop (商店) = interface / UI-facing modules (interface-kind files).
function buildShop(ctx) {
  const evidence = makeEvidence();
  const interfaceBuildings = ctx.buildings.filter((building) => building?.kind === 'interface');
  if (interfaceBuildings.length > 0) evidence.observed.push(`${interfaceBuildings.length} interface / UI-facing file(s) observed: ${describe(interfaceBuildings)}.`);
  const present = interfaceBuildings.length > 0;
  return makeFacility('shop', {
    present,
    count: interfaceBuildings.length,
    evidence,
    details: present ? { sample: sampleOf(interfaceBuildings) } : undefined
  });
}

// ruin (廃屋) = allowed FLAVOR / dirt, NOT a failure: files that are both
// unverified (no associated test, and not otherwise flagged) AND not reached
// from any known entrypoint. An old hut nobody visits yet is dirt, not a bug.
function buildRuin(ctx) {
  const evidence = makeEvidence();
  const ruinBuildings = ctx.buildings.filter(
    (building) => building?.state === 'unverified' && building?.evidence?.reachability === 'not-reached-from-known-entrypoints'
  );
  const present = ruinBuildings.length > 0;
  if (present) {
    evidence.inferred.push(`${ruinBuildings.length} file(s) are unverified (no associated test) and not reached from a known entrypoint: ${describe(ruinBuildings)}.`);
    evidence.unknown.push('flavor, not failure: whether these are dead code, feature-flagged, or reached by a path this static scan cannot see is unknown.');
  }
  return makeFacility('ruin', {
    present,
    count: ruinBuildings.length,
    evidence,
    details: { flavor: true, ...(present ? { sample: sampleOf(ruinBuildings) } : {}) }
  });
}

// A package.json entry field (main / module / bin / exports) that points at a
// scanned source file is real, observed evidence of an entrance even when
// scanner.mjs's strict resolver (which only accepts "./"-prefixed literals) did
// NOT register it as an entrypoint. This keeps a repo like { "bin": "src/x.mjs" }
// from being falsely judged "no way in". Pure: it only matches declared strings
// against the paths of files the scan already knows about — no I/O, no target
// code execution, no proof that the entry actually runs.
const GATE_SOURCE_EXT = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
function declaredEntryPaths(sig, buildings) {
  const pj = isPlainObject(sig) ? sig.packageJson : null;
  if (!isPlainObject(pj)) return [];
  const declared = [];
  const add = (value) => { if (typeof value === 'string' && value) declared.push(value); };
  add(pj.main);
  add(pj.module);
  if (typeof pj.bin === 'string') add(pj.bin);
  else if (isPlainObject(pj.bin)) Object.values(pj.bin).forEach(add);
  if (typeof pj.exports === 'string') add(pj.exports);
  else if (isPlainObject(pj.exports)) {
    for (const value of Object.values(pj.exports)) {
      if (typeof value === 'string') add(value);
      else if (isPlainObject(value)) Object.values(value).forEach(add);
    }
  }

  const knownPaths = new Set(buildings.map((building) => building?.path).filter(Boolean));
  const resolved = [];
  const seen = new Set();
  for (const raw of declared) {
    const base = raw.replace(/^\.\//, '').split(/[?#]/, 1)[0];
    const candidates = [base];
    if (!/\.[cm]?[jt]sx?$/i.test(base)) {
      const stem = base.endsWith('/') ? base.slice(0, -1) : base;
      for (const ext of GATE_SOURCE_EXT) candidates.push(`${stem}${ext}`);
      for (const ext of GATE_SOURCE_EXT) candidates.push(`${stem}/index${ext}`);
    }
    const hit = candidates.find((candidate) => knownPaths.has(candidate));
    if (hit && !seen.has(hit)) {
      seen.add(hit);
      resolved.push({ declared: raw, path: hit });
    }
  }
  return resolved;
}

// gate (門) = a known entry into the town: a resolved package.json entrypoint OR
// a declared entry field that points at a scanned file.
function buildGate(ctx) {
  const evidence = makeEvidence();
  const declared = declaredEntryPaths(ctx.sig, ctx.buildings);
  const hasResolvedEntrypoint = ctx.entrypoints.length > 0;
  const present = hasResolvedEntrypoint || declared.length > 0;

  for (const entry of ctx.entrypoints) {
    evidence.observed.push(`entrypoint "${entry?.path}" resolved via ${entry?.evidence ?? 'a package.json hint'}.`);
  }
  for (const entry of declared) {
    evidence.observed.push(`package.json declares an entry "${entry.declared}" pointing at the scanned file "${entry.path}".`);
  }
  if (present) {
    evidence.unknown.push('whether the entrance actually starts successfully when run is unknown; this tool never executes target code.');
  } else {
    evidence.unknown.push('no package.json entry (main / module / bin / exports) resolved to a scanned file; whether the repo has a real entry is unknown, not proven absent.');
  }

  const entryPaths = new Set([
    ...ctx.entrypoints.map((entry) => entry?.path).filter(Boolean),
    ...declared.map((entry) => entry.path)
  ]);
  return makeFacility('gate', {
    present,
    count: entryPaths.size,
    evidence,
    details: present
      ? {
        entrypoints: ctx.entrypoints.map((entry) => ({ path: entry?.path, evidence: entry?.evidence })),
        declaredEntries: declared
      }
      : undefined
  });
}

/** @type {Record<string, (ctx: object) => Facility>} */
const FACILITY_BUILDERS = {
  inn: buildInn,
  pub: buildPub,
  guild: buildGuildFacility,
  town_hall: buildTownHall,
  dock: buildDock,
  warehouse: buildWarehouse,
  well: buildWell,
  workshop: buildWorkshop,
  dojo: buildDojo,
  watchtower: buildWatchtower,
  house: buildHouse,
  shop: buildShop,
  ruin: buildRuin,
  gate: buildGate
};

// --- external contractor reports --------------------------------------------

/**
 * Normalize raw contractor self-reports. status is ALWAYS "pending-inspection":
 * a contractor's own "done / fixed / tested" report is never itself evidence
 * of a working town, only a claim town_hall inspection may later confirm
 * against real observed signals.
 * @param {RepoSignals} sig
 * @returns {ContractorReport[]}
 */
function buildContractorReports(sig) {
  const reports = [];
  for (const item of arr(sig.contractorReports)) {
    if (!isPlainObject(item)) continue;
    const source = typeof item.source === 'string' && item.source.trim() ? item.source : 'unknown-contractor';
    const subject = typeof item.subject === 'string' && item.subject.trim() ? item.subject : 'unspecified self-report';
    reports.push({ source, subject, status: 'pending-inspection' });
  }
  return reports;
}

// --- 接続者ギルド (model.guild) five-tab panel ------------------------------
// Keys are assembled in canonical GUILD_TABS order so the panel's key order is
// tied to the shared contract, not to literal insertion order. Every じょうたい
// item stays honest as inferred / unknown — static scanning proves none of it.

function buildGuildMembers(ctx) {
  return [
    ...ctx.connection.llmSdks.map((name) => ({ name, type: 'llm-sdk', evidenceClass: 'observed' })),
    ...ctx.connection.externalServiceDeps.map((name) => ({ name, type: 'external-service', evidenceClass: 'observed' }))
  ];
}

function buildGuildReception(ctx) {
  return sortByPath(ctx.connection.buildings).map((building) => ({
    path: building?.path,
    name: building?.name,
    kind: building?.kind,
    evidenceClass: 'observed'
  }));
}

function buildGuildRequests(ctx) {
  const requests = [];
  if (ctx.connection.webhookHint) {
    requests.push({ label: 'webhook', direction: 'inbound', evidenceClass: 'observed', note: 'a webhook / inbound-callback hint was observed in the source.' });
  }
  for (const name of ctx.connection.externalServiceDeps) {
    requests.push({ label: name, direction: 'outbound', evidenceClass: 'inferred', note: 'an outbound call target inferred from a dependency name; the call is not proven.' });
  }
  return requests;
}

function buildGuildBelongings(ctx) {
  const hasEnvSignal = truthy(ctx.sig.hasEnvFiles) || truthy(ctx.sig.hasDotenvDep);
  const apiKeyEnvNames = arr(ctx.sig.apiKeyEnvNames);
  const configSchemaFiles = arr(ctx.sig.configSchemaFiles);
  const dbDeps = arr(ctx.sig.dbDeps);
  const promptFiles = arr(ctx.sig.promptFiles);
  const toolPermissionHints = arr(ctx.sig.toolPermissionHints);

  const belongings = [];
  belongings.push({
    category: 'api-key',
    items: apiKeyEnvNames,
    evidenceClass: apiKeyEnvNames.length > 0 ? 'observed' : 'unknown',
    note: apiKeyEnvNames.length > 0
      ? 'API-key-shaped env-var names were observed; their actual values were not read.'
      : 'no API-key-shaped env-var signal was found (or none was scanned); absence is not confirmed absence.'
  });
  belongings.push({
    category: 'env',
    items: [],
    evidenceClass: hasEnvSignal ? 'observed' : 'unknown',
    note: hasEnvSignal
      ? '.env file(s) and/or a dotenv dependency were observed; actual secret values were not read.'
      : 'no .env file or dotenv dependency signal was found; env presence is unknown.'
  });
  belongings.push({
    category: 'schema',
    items: configSchemaFiles,
    evidenceClass: configSchemaFiles.length > 0 ? 'observed' : dbDeps.length > 0 ? 'inferred' : 'unknown',
    note: configSchemaFiles.length > 0
      ? 'config / validation schema file(s) were observed.'
      : dbDeps.length > 0
        ? 'a database dependency implies some data schema exists; the schema itself was not read.'
        : 'no schema file or database dependency signal was found; schema existence is unknown.'
  });
  belongings.push({
    category: 'prompt',
    items: promptFiles,
    evidenceClass: promptFiles.length > 0 ? 'observed' : 'unknown',
    note: promptFiles.length > 0 ? 'prompt-template file(s) were observed.' : 'no prompt-template signal was found; prompt presence is unknown.'
  });
  belongings.push({
    category: 'tool-permission',
    items: toolPermissionHints,
    evidenceClass: toolPermissionHints.length > 0 ? 'observed' : 'unknown',
    note: toolPermissionHints.length > 0
      ? 'tool-permission / allowlist hint(s) were observed.'
      : 'no tool-permission / allowlist signal was found; tool-grant scope is unknown.'
  });
  return belongings;
}

// Every じょうたい (state) item is honest as inferred / unknown: static
// scanning can never prove connectivity, cost control, auth, or live logging.
function buildGuildStatus(ctx) {
  const llmSdks = ctx.connection.llmSdks;
  const authDeps = arr(ctx.sig.authDeps);
  const loggerDeps = arr(ctx.sig.loggerDeps);
  return [
    {
      label: '疎通',
      value: '未確認',
      evidenceClass: 'unknown',
      note: 'static scanning cannot verify network connectivity; a runtime check is required.'
    },
    {
      label: 'コスト制限',
      value: llmSdks.length > 0 ? '未設定の疑い' : '該当なし',
      evidenceClass: 'inferred',
      note: llmSdks.length > 0
        ? 'an LLM SDK dependency was observed with no explicit cost / rate-limit signal found statically; the runaway-cost risk is unmitigated as far as this scan can tell.'
        : 'no known LLM SDK dependency was observed, so LLM cost control is not applicable to what was scanned.'
    },
    {
      label: '認証',
      value: authDeps.length > 0 ? '依存あり(要確認)' : '未確認',
      evidenceClass: authDeps.length > 0 ? 'inferred' : 'unknown',
      note: authDeps.length > 0
        ? `auth-related dependency observed (${authDeps.join(', ')}); whether endpoints are actually protected is unconfirmed.`
        : 'no auth-related dependency signal was found; whether any endpoint is protected is unknown.'
    },
    {
      label: 'ログ',
      value: loggerDeps.length > 0 ? 'ロガー依存あり' : '未確認',
      evidenceClass: loggerDeps.length > 0 ? 'inferred' : 'unknown',
      note: loggerDeps.length > 0
        ? `a logging / monitoring dependency was observed (${loggerDeps.join(', ')}); whether logs are actually emitted or retained at runtime is unconfirmed.`
        : 'no known logger dependency was detected; native console logging cannot be ruled out statically.'
    }
  ];
}

function buildGuildPanel(ctx) {
  const byTab = {
    なかま: buildGuildMembers(ctx),
    うけつけ: buildGuildReception(ctx),
    いらい: buildGuildRequests(ctx),
    もちもの: buildGuildBelongings(ctx),
    じょうたい: buildGuildStatus(ctx)
  };
  const panel = {};
  for (const tab of GUILD_TABS) panel[tab] = byTab[tab];
  return panel;
}

// --- entry point ------------------------------------------------------------

/**
 * Turn one inspection result plus one RepoSignals bag into a TownModel: a
 * Facility per FACILITY_KIND in FACILITY_KINDS order (present only when backed
 * by evidence, evidence split observed / inferred / unknown), the 接続者ギルド
 * five-tab roster (model.guild), external contractor self-reports (always
 * pending-inspection), and a passthrough summary. Pure and deterministic —
 * same (inspection, signals) in, structurally identical TownModel out; no I/O,
 * no clock, no randomness. The target repository is never read or executed
 * here. Missing / malformed `inspection` or `signals` fields degrade to
 * "signal absent" rather than throwing or being fabricated. The returned model
 * is deep-frozen and never aliases the caller's input arrays.
 *
 * @param {object} inspection - output of src/inspector.mjs buildInspection(scan) (schemaVersion 2)
 * @param {RepoSignals} [signals] - output of the sibling src/town/signals.mjs module
 * @returns {TownModel}
 */
export function buildTownModel(inspection, signals) {
  const insp = isPlainObject(inspection) ? inspection : {};
  const sig = isPlainObject(signals) ? signals : {};

  const repository = isPlainObject(insp.repository) ? { ...insp.repository } : {};
  const buildings = arr(insp.city?.buildings);
  const entrypoints = arr(insp.graph?.entrypoints);
  const summary = isPlainObject(insp.summary) ? insp.summary : {};
  const contractorReports = buildContractorReports(sig);

  const connectionBuildings = buildings.filter(isConnectionBuilding);
  const connection = {
    llmSdks: arr(sig.llmSdks),
    externalServiceDeps: arr(sig.externalServiceDeps),
    webhookHint: truthy(sig.webhookHint),
    buildings: connectionBuildings
  };
  connection.any = connection.llmSdks.length > 0
    || connection.externalServiceDeps.length > 0
    || connection.webhookHint
    || connection.buildings.length > 0;

  const ctx = { sig, repository, buildings, entrypoints, summary, connection, contractorReports };

  const facilities = FACILITY_KINDS.map((kind) => FACILITY_BUILDERS[kind](ctx));
  const guild = buildGuildPanel(ctx);
  const facilitiesPresent = facilities.filter((facility) => facility.present).length;

  const model = {
    repository,
    facilities,
    guild,
    external: { contractorReports },
    summary: {
      filesDiscovered: normalizeCount(summary.filesDiscovered),
      filesScanned: normalizeCount(summary.filesScanned),
      entrypoints: entrypoints.length,
      cycles: normalizeCount(summary.cycles),
      testAssociations: normalizeCount(summary.testAssociations),
      unresolvedLinks: normalizeCount(summary.unresolvedLinks),
      facilitiesPresent,
      facilitiesTotal: facilities.length,
      contractorReportsPending: contractorReports.length
    }
  };

  return deepFreeze(model);
}
