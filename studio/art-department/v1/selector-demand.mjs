import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ORIGINAL_REGISTRY,
  verifyOriginalRegistry,
} from '../index.mjs';

/**
 * Demand-driven, non-generative preparation for the bounded v1 art queue.
 *
 * This module reads only public vocabulary exports from shipping modules and
 * the immutable original registry. It never reads a customer repository,
 * creates candidates, writes reports, promotes bytes, or selects a fallback.
 * One bounded exception is the exact `water:default` literal in the public
 * scene-compiler selector implementation. That literal is read once and
 * bound to the source file and literal SHA-256; no arbitrary source parsing
 * or selector guessing is allowed.
 */

export const SELECTOR_DEMAND_FORMAT = 'codecity.v1-selector-demand';
export const SELECTOR_DEMAND_SCHEMA_VERSION = 1;
export const SELECTOR_DEMAND_STATUS = Object.freeze(['provisional', 'ready', 'blocked']);
export const MAX_FINITE_VOCABULARY = 256;

const MODULES = Object.freeze({
  sceneCompiler: 'ship/60-scene-compiler/index.mjs',
  townDomain: 'ship/30-town-domain/index.mjs',
  worldgen: 'ship/40-worldgen/index.mjs',
});

// A name is accepted only when it is an explicit public export. The first
// matching name wins; the bounded water literal below is the only source
// index read and is not a general source-text scrape.
const FAMILY_EXPORTS = Object.freeze([
  Object.freeze({ family: 'product', module: 'sceneCompiler', names: Object.freeze(['PRODUCT_SELECTORS']) }),
  Object.freeze({ family: 'terrain', module: 'worldgen', names: Object.freeze(['PUBLIC_TERRAIN_KINDS', 'PUBLIC_TERRAINS', 'TERRAIN_VOCABULARY']) }),
  Object.freeze({ family: 'water', module: 'worldgen', names: Object.freeze(['PUBLIC_WATER_KINDS', 'PUBLIC_WATERS', 'WATER_VOCABULARY']) }),
  Object.freeze({ family: 'road', module: 'worldgen', names: Object.freeze(['PUBLIC_ROAD_KINDS', 'PUBLIC_ROADS', 'ROAD_VOCABULARY']) }),
  Object.freeze({ family: 'plot', module: 'worldgen', names: Object.freeze(['PUBLIC_PLOT_STATES', 'PUBLIC_OCCUPANCY_STATES', 'PLOT_VOCABULARY']) }),
  Object.freeze({ family: 'building', module: 'worldgen', names: Object.freeze(['PUBLIC_FACILITY_KINDS', 'PUBLIC_BUILDING_KINDS', 'FACILITY_VOCABULARY']) }),
  Object.freeze({ family: 'room', module: 'worldgen', names: Object.freeze(['PUBLIC_ROOM_KINDS', 'ROOM_VOCABULARY']) }),
  Object.freeze({ family: 'npc', module: 'townDomain', names: Object.freeze(['PUBLIC_NPC_ROLES', 'NPC_ROLE_VOCABULARY', 'NPC_VOCABULARY']) }),
  Object.freeze({ family: 'prop', module: 'worldgen', names: Object.freeze(['PUBLIC_PROP_KINDS', 'PROP_VOCABULARY']) }),
  Object.freeze({ family: 'light', module: 'worldgen', names: Object.freeze(['PUBLIC_LIGHT_STATES', 'LIGHT_VOCABULARY']) }),
  Object.freeze({ family: 'quest', module: 'worldgen', names: Object.freeze(['PUBLIC_QUEST_ACTIONS', 'QUEST_ACTION_VOCABULARY']) }),
  Object.freeze({ family: 'effect', module: 'townDomain', names: Object.freeze(['PUBLIC_REWARD_EFFECTS', 'REWARD_EFFECT_VOCABULARY']) }),
]);

const GRAMMAR_EXPORT_NAMES = Object.freeze([
  'WORLD_PLAN_PUBLIC_VOCABULARY',
  'PUBLIC_SELECTOR_VOCABULARY',
  'PUBLIC_SELECTOR_GRAMMAR',
  'SELECTOR_VOCABULARY',
  'SELECTOR_GRAMMAR',
]);

// WORLD_PLAN_PUBLIC_VOCABULARY is a public WorldPlan grammar, so these
// mappings are contract names rather than inferred values. `waterKinds` is
// intentionally not mapped: the current compiler emits the separate
// `water:default` selector, which is bound below to one exact public-index
// literal until the P4 scene-compiler contract exports a finite water selector
// vocabulary.
const WORLD_PLAN_SELECTOR_FAMILIES = Object.freeze({
  terrains: 'terrain',
  roadKinds: 'road',
  occupancyStates: 'plot',
  facilityKinds: 'building',
  roomKinds: 'room',
  npcRoles: 'npc',
  propKinds: 'prop',
  lightStates: 'light',
  questActions: 'quest',
  rewardEffects: 'effect',
});

const DIRECT_EFFECT_EXPORT_NAMES = Object.freeze([
  'REPOSITORY_INSPECTION_BINDING',
  'PUBLIC_REWARD_BINDING',
]);

const ORIGINAL_SOURCE_MAP = Object.freeze({
  player: Object.freeze(['character_style_authority_20260722_v1.png', 'character_style_reference_sheet.png']),
  npc: Object.freeze(['character_style_authority_20260722_v1.png', 'character_style_reference_sheet.png']),
  terrain: Object.freeze(['world_visual_master.png', 'target-town.png']),
  water: Object.freeze(['field_harbor_docks_tiles_sheet.png', 'world_visual_master.png']),
  road: Object.freeze(['field_cobblestone_roads_sheet.png', 'world_visual_master.png']),
  plot: Object.freeze(['world_visual_master.png', 'target-town.png']),
  room: Object.freeze(['world_visual_master.png', 'target-town.png']),
  prop: Object.freeze(['object_street_props_sheet.png']),
  light: Object.freeze(['object_status_markers_sheet.png', 'world_visual_master.png']),
  quest: Object.freeze(['object_status_markers_sheet.png', 'ui_inspection_report_sheet.png']),
  effect: Object.freeze(['object_status_markers_sheet.png', 'world_visual_master.png']),
  ui: Object.freeze([]),
});

const BUILDING_SOURCE_MAP = Object.freeze({
  inn: Object.freeze(['building_inn_sheet.png']),
  town_hall: Object.freeze(['building_town_hall_sheet.png']),
  workshop: Object.freeze(['building_workshop_sheet.png']),
  warehouse: Object.freeze(['building_warehouse_sheet.png']),
  watchtower: Object.freeze(['building_watchtower_sheet.png']),
  guild: Object.freeze([
    'building_guild_variant_01_sheet.png',
    'building_guild_variant_02_sheet.png',
    'building_guild_variant_03_sheet.png',
    'building_guild_variant_04_sheet.png',
  ]),
  house: Object.freeze(['building_houses_shops_ruins_sheet.png']),
  shop: Object.freeze(['building_houses_shops_ruins_sheet.png']),
  ruin: Object.freeze(['building_houses_shops_ruins_sheet.png']),
});

const UI_SOURCE_MAP = Object.freeze({
  'ui:dialogue': Object.freeze(['ui_dialogue_frames_sheet.png']),
  'ui:choice': Object.freeze(['ui_dialogue_frames_sheet.png']),
  'ui:guild-roster': Object.freeze(['ui_guild_roster_sheet.png']),
  'ui:inspection-report': Object.freeze(['ui_inspection_report_sheet.png']),
});

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableClone(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('selector demand values must be finite');
    return value;
  }
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareStrings).map((key) => [key, stableClone(value[key])]));
  }
  throw new TypeError('selector demand values must be JSON-compatible');
}

function stableJson(value) {
  return JSON.stringify(stableClone(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function modulePath(repositoryRoot, moduleId) {
  const relative = MODULES[moduleId];
  if (!relative) throw new TypeError(`unknown selector-demand module ${moduleId}`);
  return path.resolve(repositoryRoot, relative);
}

async function loadModule(repositoryRoot, moduleId) {
  const absolute = modulePath(repositoryRoot, moduleId);
  try {
    const namespace = await import(pathToFileURL(absolute).href);
    return { namespace, absolute, error: null };
  } catch (error) {
    return { namespace: null, absolute, error: `${error.name}: ${error.message}` };
  }
}

function finiteStrings(value, label) {
  let values;
  if (Array.isArray(value)) values = value;
  else if (value instanceof Set) values = [...value];
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    // Grammar families may be declared as { values: [...] } or as a selector
    // map whose keys are the public finite values.
    if (Object.prototype.hasOwnProperty.call(value, 'values')) return finiteStrings(value.values, label);
    values = Object.keys(value);
  } else {
    throw new TypeError(`${label} must be an array, Set, or finite object`);
  }
  const normalized = values.map((value) => {
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} contains an empty/non-string value`);
    if (value.includes('*') || value.includes('?')) throw new TypeError(`${label} contains a wildcard`);
    return value;
  });
  const unique = [...new Set(normalized)].sort(compareStrings);
  if (unique.length === 0) throw new TypeError(`${label} must not be empty`);
  if (unique.length > MAX_FINITE_VOCABULARY) throw new TypeError(`${label} exceeds the finite vocabulary limit`);
  return unique;
}

function sourceTrace(repositoryRoot, moduleId, exportName, raw, values, suffix = '') {
  const absolute = modulePath(repositoryRoot, moduleId);
  const suffixPart = suffix ? `.${suffix}` : '';
  return {
    id: `source.${moduleId}.${exportName}${suffixPart}`,
    module: path.relative(repositoryRoot, absolute).split(path.sep).join('/'),
    export: exportName,
    kind: 'public-export',
    valueDigest: digest(raw),
    values: [...values],
  };
}

function selectorValues(family, raw, label) {
  const values = finiteStrings(raw, label);
  if (family === 'product') {
    if (values.some((value) => !value.includes(':'))) throw new TypeError(`${label} must contain explicit selectors`);
    return values;
  }
  return values.map((value) => value.includes(':') ? value : `${family}:${value}`);
}

function directFamilyRecords(namespace, spec, repositoryRoot) {
  if (!namespace) return { record: null, missing: true, error: null };
  for (const exportName of spec.names) {
    if (!Object.prototype.hasOwnProperty.call(namespace, exportName)) continue;
    const raw = namespace[exportName];
    try {
      const selectors = selectorValues(spec.family, raw, `${spec.module}.${exportName}`);
      return {
        record: {
          family: spec.family,
          exportName,
          selectors,
          source: sourceTrace(repositoryRoot, spec.module, exportName, raw, selectors),
        },
        missing: false,
        error: null,
      };
    } catch (error) {
      return { record: null, missing: false, error: `${error.name}: ${error.message}` };
    }
  }
  return { record: null, missing: true, error: null };
}

function grammarRecords(namespace, moduleId, repositoryRoot) {
  if (!namespace) return { records: [], found: false, errors: [] };
  const errors = [];
  for (const exportName of GRAMMAR_EXPORT_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(namespace, exportName)) continue;
    const raw = namespace[exportName];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${moduleId}.${exportName} must be an object`);
      continue;
    }
    const records = [];
    for (const family of Object.keys(raw).sort(compareStrings)) {
      const selectorFamily = exportName === 'WORLD_PLAN_PUBLIC_VOCABULARY'
        ? WORLD_PLAN_SELECTOR_FAMILIES[family]
        : family;
      if (!selectorFamily) continue;
      const familyValue = raw[family];
      try {
        const selectors = selectorValues(selectorFamily, familyValue, `${moduleId}.${exportName}.${family}`);
        records.push({
          family: selectorFamily,
          exportName,
          selectors,
          source: sourceTrace(repositoryRoot, moduleId, exportName, familyValue, selectors, family),
        });
      } catch (error) {
        errors.push(`${moduleId}.${exportName}.${family}: ${error.message}`);
      }
    }
    if (records.length > 0) return { records, found: true, errors };
  }
  return { records: [], found: false, errors };
}

function explicitEffectRecord(namespace, repositoryRoot) {
  if (!namespace) return null;
  for (const exportName of DIRECT_EFFECT_EXPORT_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(namespace, exportName)) continue;
    const raw = namespace[exportName];
    const effect = raw && typeof raw.effect === 'string' ? raw.effect : null;
    if (!effect || effect.includes('*') || effect.includes('?')) return null;
    return {
      family: 'effect',
      exportName,
      selectors: [`effect:${effect}`],
      source: sourceTrace(repositoryRoot, 'townDomain', exportName, raw, [effect]),
    };
  }
  return null;
}

function originalNamesForSelector(selector) {
  const [family, value = ''] = selector.split(':', 2);
  if (UI_SOURCE_MAP[selector]) return [...UI_SOURCE_MAP[selector]];
  if (family === 'building') return [...(BUILDING_SOURCE_MAP[value] ?? [])];
  return [...(ORIGINAL_SOURCE_MAP[family] ?? [])];
}

function originalCoverage(selector, originalsByName) {
  const mapped = originalNamesForSelector(selector);
  const directOriginals = mapped.filter((file) => originalsByName.has(file));
  return {
    status: directOriginals.length > 0 ? 'reference-available' : 'reference-gap',
    directOriginals,
    // This is deliberately not a claim of visual fit, approval, extraction,
    // or shipping readiness. It only records filename-level source presence.
    interpretation: 'mechanical filename association; not an asset approval',
  };
}

function custodySnapshot(repositoryRoot) {
  const report = verifyOriginalRegistry({ repositoryRoot, strictSet: true });
  const originalsByName = new Map((report.entries ?? []).map((entry) => [entry.file, entry]));
  return {
    ok: report.ok,
    expected: report.expected,
    checked: report.checked,
    failures: report.failures,
    unexpected: report.unexpected,
    originals: ORIGINAL_REGISTRY.originals.map((entry) => ({
      id: entry.id,
      file: entry.file,
      dimensions: { ...entry.dimensions },
      sha256: entry.sha256,
      immutable: entry.immutable,
      observed: originalsByName.has(entry.file),
    })),
    originalsByName,
  };
}

const BOUNDED_WATER_LITERAL = "selectors.add('water:default')";

/**
 * Bind the one selector that the current public scene-compiler implementation
 * emits but does not yet export as a finite vocabulary. This is intentionally
 * a bounded literal read: the implementation must contain exactly one exact
 * `selectors.add('water:default')` occurrence inside the required-selector
 * function. A wildcard (`water:*`/`water:?`), fallback (`water:fallback`),
 * unknown (`water:unknown`), duplicate, or relocated occurrence fails closed
 * and leaves the demand report provisional/blocked.
 */
function boundedWaterSelectorEvidence(repositoryRoot) {
  const absolute = modulePath(repositoryRoot, 'sceneCompiler');
  const bytes = fs.readFileSync(absolute);
  const text = bytes.toString('utf8');
  const exactMatches = text.match(/selectors\.add\('water:default'\)/g) ?? [];
  const occurrence = text.indexOf(BOUNDED_WATER_LITERAL);
  const functionStart = text.lastIndexOf('function requiredSelectorsForPlan', occurrence);
  const functionEnd = occurrence >= 0 ? text.indexOf('export function requiredAssetSelectors', occurrence) : -1;
  const boundedBody = functionStart >= 0 && functionEnd > functionStart ? text.slice(functionStart, functionEnd) : '';
  const forbiddenPatterns = [
    /water:\$\{/u,
    /water:\s*[*?]/u,
    /(?:\?\?|\|\|)\s*['"`]water:default['"`]/u,
    /\bfallback\b/iu,
  ];
  const selectorLines = text.split(/\r?\n/u).filter((line) => /\bselectors\b/u.test(line)).join('\n');
  const forbiddenWaterTokens = [
    /water:\$\{/u,
    /water:\s*[*?]/u,
    /water:\s*(?:fallback|unknown|auto|nearest|any)/u,
  ];
  if (exactMatches.length !== 1
    || occurrence < 0
    || functionStart < 0
    || functionEnd < occurrence
    || forbiddenWaterTokens.some((pattern) => pattern.test(selectorLines))
    || forbiddenPatterns.some((pattern) => pattern.test(boundedBody))) {
    throw new Error('scene compiler must contain exactly one bounded water selector literal in requiredSelectorsForPlan');
  }
  const fileSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const matchedLiteralDigest = crypto.createHash('sha256').update(BOUNDED_WATER_LITERAL, 'utf8').digest('hex');
  const source = {
    id: 'source.sceneCompiler.requiredAssetSelectors.water-default',
    module: path.relative(repositoryRoot, absolute).split(path.sep).join('/'),
    export: 'requiredAssetSelectors',
    kind: 'bounded-public-index-literal',
    valueDigest: digest(['water:default']),
    values: ['water:default'],
    fileSha256,
    matchedLiteral: BOUNDED_WATER_LITERAL,
    matchedLiteralDigest,
    matchCount: exactMatches.length,
  };
  return {
    record: { family: 'water', exportName: 'requiredAssetSelectors', selectors: ['water:default'], source },
    source,
    evidence: {
      path: source.module,
      function: 'requiredSelectorsForPlan',
      literal: BOUNDED_WATER_LITERAL,
      literalDigest: matchedLiteralDigest,
      fileSha256,
      matchCount: exactMatches.length,
      policy: 'exact-single-literal; wildcard/fallback/unknown rejected',
    },
  };
}

function withCoverage(selectors, custody) {
  return selectors.map((selector) => {
    const coverage = originalCoverage(selector, custody.originalsByName);
    return {
      selector,
      family: selector.split(':', 1)[0],
      sourceTraceIds: [],
      originalCoverage: coverage,
      candidate: { state: 'none', path: null, sha256: null },
    };
  });
}

/**
 * Derive a deterministic selector-demand report from public finite exports.
 * The returned object is JSON-compatible and sorted for byte-stable output.
 */
export async function deriveSelectorDemand({ repositoryRoot = rootDirectory } = {}) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const loaded = new Map();
  for (const moduleId of Object.keys(MODULES)) loaded.set(moduleId, await loadModule(resolvedRoot, moduleId));

  const traces = [];
  const records = [];
  const missingFamilies = [];
  const moduleErrors = [];
  const grammarModules = new Set();

  for (const spec of FAMILY_EXPORTS) {
    const module = loaded.get(spec.module);
    if (module.error) {
      moduleErrors.push({ module: spec.module, path: path.relative(resolvedRoot, module.absolute).split(path.sep).join('/'), error: module.error });
      if (spec.family === 'product') missingFamilies.push(spec.family);
      continue;
    }
    const direct = directFamilyRecords(module.namespace, spec, resolvedRoot);
    if (direct.record) {
      records.push(direct.record);
      traces.push(direct.record.source);
    } else if (direct.error) {
      moduleErrors.push({ module: spec.module, export: spec.names.join('|'), error: direct.error });
      missingFamilies.push(spec.family);
    } else if (direct.missing) {
      const grammar = grammarRecords(module.namespace, spec.module, resolvedRoot);
      if (grammar.found) {
        grammarModules.add(spec.module);
        const match = grammar.records.find((record) => record.family === spec.family);
        if (match) {
          records.push(match);
          traces.push(match.source);
        } else {
          missingFamilies.push(spec.family);
        }
      } else {
        missingFamilies.push(spec.family);
      }
      for (const error of grammar.errors) moduleErrors.push({ module: spec.module, error });
    }
  }

  const effectRecord = explicitEffectRecord(loaded.get('townDomain')?.namespace, resolvedRoot);
  if (effectRecord && !records.some((record) => record.family === 'effect')) {
    records.push(effectRecord);
    traces.push(effectRecord.source);
    const index = missingFamilies.indexOf('effect');
    if (index >= 0) missingFamilies.splice(index, 1);
  }

  let boundedWater = null;
  try {
    boundedWater = boundedWaterSelectorEvidence(resolvedRoot);
    records.push(boundedWater.record);
    traces.push(boundedWater.source);
    const index = missingFamilies.indexOf('water');
    if (index >= 0) missingFamilies.splice(index, 1);
  } catch (error) {
    moduleErrors.push({
      module: 'sceneCompiler',
      export: 'requiredAssetSelectors',
      error: `${error.name}: ${error.message}`,
    });
  }

  const productRecord = records.find((record) => record.family === 'product');
  const selectors = [...new Set(records.flatMap((record) => record.selectors))].sort(compareStrings);
  const custody = custodySnapshot(resolvedRoot);
  const selectorRecords = withCoverage(selectors, custody);
  const traceBySelector = new Map();
  for (const record of records) {
    const traceId = record.source.id;
    for (const selector of record.selectors) {
      const existing = traceBySelector.get(selector) ?? [];
      existing.push(traceId);
      traceBySelector.set(selector, existing);
    }
  }
  for (const record of selectorRecords) record.sourceTraceIds = [...new Set(traceBySelector.get(record.selector) ?? [])].sort(compareStrings);

  const missing = [...new Set(missingFamilies)].sort(compareStrings);
  const status = moduleErrors.some((entry) => entry.module && !loaded.get(entry.module)?.namespace)
    ? 'blocked'
    : missing.length > 0 || !productRecord || grammarModules.size === 0 || !boundedWater
      ? 'provisional'
      : 'ready';

  return {
    format: SELECTOR_DEMAND_FORMAT,
    schemaVersion: SELECTOR_DEMAND_SCHEMA_VERSION,
    status,
    derivation: {
      kind: 'boundedPublicIndexLiteralRead',
      repositoryRoot: '.',
      modules: Object.fromEntries(Object.entries(MODULES).map(([id, relative]) => [id, relative])),
      publicExports: [...new Set(traces.map((trace) => trace.id))].sort(compareStrings),
      grammarModules: [...grammarModules].sort(compareStrings),
      missingFamilies: missing,
      boundedWater: boundedWater?.evidence ?? null,
      moduleErrors: moduleErrors.sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
      sourceReadPolicy: 'bounded-exact-public-index-literal-only',
      noWildcardOrFallback: true,
      integrationBlockers: [
        {
          id: 'p4-scene-reward-transition-alignment',
          state: 'known',
          owner: 'P4',
          source: 'ship/60-scene-compiler/index.mjs#REWARD_CHANGES',
          transition: 'repository_inspected',
          effectSelector: 'effect:town_hall_lantern_lit',
          expectedError: 'REWARD_TRANSITION_INVALID',
          limitation: 'selector demand proves finite asset identity and custody only; it does not prove WorldPlan-to-SceneBundle composition or reward-transition acceptance',
        },
      ],
    },
    custody: {
      ok: custody.ok,
      expected: custody.expected,
      checked: custody.checked,
      failures: custody.failures,
      unexpected: custody.unexpected,
      originals: custody.originals,
    },
    selectors: selectorRecords,
    selectorCount: selectorRecords.length,
    candidatePngCount: 0,
    candidatePolicy: 'generation-disabled-for-this-preparation; candidate path is not read or written',
    sourceTraces: traces.sort((left, right) => left.id.localeCompare(right.id)),
    limits: {
      maxFiniteVocabulary: MAX_FINITE_VOCABULARY,
      selectorsSortedUnique: true,
      sourceTracePerSelector: selectorRecords.every((record) => record.sourceTraceIds.length > 0),
      wildcardOrFallbackPresent: selectors.some((selector) => selector.includes('*') || selector.includes('?')),
    },
  };
}

export function assertSelectorDemand(report) {
  if (!report || report.format !== SELECTOR_DEMAND_FORMAT || report.schemaVersion !== SELECTOR_DEMAND_SCHEMA_VERSION) {
    throw new TypeError('selector-demand report format/schema is invalid');
  }
  if (!SELECTOR_DEMAND_STATUS.includes(report.status)) throw new TypeError('selector-demand status is invalid');
  if (!Array.isArray(report.selectors) || report.selectors.some((entry) => typeof entry?.selector !== 'string')) throw new TypeError('selector-demand selectors must be records');
  const selectors = report.selectors.map((entry) => entry.selector);
  if (JSON.stringify([...selectors].sort(compareStrings)) !== JSON.stringify(selectors)) throw new TypeError('selectors must be sorted');
  if (new Set(selectors).size !== selectors.length) throw new TypeError('selectors must be unique');
  if (selectors.some((selector) => selector.includes('*') || selector.includes('?'))) throw new TypeError('wildcard selectors are forbidden');
  if (!Number.isInteger(report.candidatePngCount) || report.candidatePngCount !== 0) throw new TypeError('candidate PNG count must remain zero for non-generative preparation');
  if (report.limits?.wildcardOrFallbackPresent) throw new TypeError('selector-demand wildcard/fallback limit failed');
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const repositoryRoot = rootIndex >= 0 ? args[rootIndex + 1] : rootDirectory;
  if (rootIndex >= 0 && (!repositoryRoot || repositoryRoot.startsWith('-'))) throw new Error('--root requires a directory');
  if (args.includes('--help')) {
    process.stdout.write('Usage: node studio/art-department/v1/selector-demand.mjs [--root <repository>] [--json]\n');
    return;
  }
  const report = await deriveSelectorDemand({ repositoryRoot });
  assertSelectorDemand(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
