import { createHash } from 'node:crypto';

import {
  NPC_ROLE_VOCABULARY,
  REPOSITORY_INSPECTION_BINDING,
} from '../30-town-domain/index.mjs';

/*
 * World generation is a small declarative place compiler.  It writes one
 * abstract geometry for the scene compiler to use for surfaces, structures,
 * access, occlusion, actors, and interaction.  It does not know about art or
 * the browser.
 */
const FORMAT = 'codecity.world-plan';
const SCHEMA_VERSION = 2;
const WORLDVIEWS = Object.freeze({
  lateMedieval: Object.freeze({ id: 'late-medieval-night', recipeVersion: 'place-recipe-v1' }),
  snowHarbor: Object.freeze({ id: 'snow-harbor-night', recipeVersion: 'place-recipe-v1' }),
});
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);
const SURFACE_RECIPES = Object.freeze(['ground', 'water', 'bank', 'crossing', 'main_route', 'local_route', 'plaza']);
const ROUTE_RECIPES = Object.freeze(['main', 'local']);
const PLACE_RECIPES = Object.freeze([
  'arrival_gate', 'civic_plaza', 'civic_hall', 'waterfront_dock', 'heritage_ruin',
  'residence', 'facility', 'investigation_site',
]);
const PLACE_CONDITIONS = Object.freeze(['active', 'missing', 'not_applicable', 'unconfirmed', 'dirt']);
const PROP_RECIPES = Object.freeze([
  'signboard', 'lamp_post', 'tree_cluster',
  'work_clutter', 'civic_planter', 'living_woodpile', 'edge_stone_stair', 'edge_hedge_curb',
  'snow_evergreen', 'snow_harbor_lamp', 'snow_dock_cargo',
  'snow_edge_evergreen_yard', 'snow_edge_harbor_shore',
]);
const LIGHT_STATES = Object.freeze(['lit', 'unlit', 'unknown']);
const INVESTIGATION_TARGET_BY_FACILITY = Object.freeze({
  gate: 'threshold',
  warehouse: 'ledger',
  well: 'water-source',
  dojo: 'inspection-mark',
  watchtower: 'night-log',
  shop: 'repair-tools',
});
const INVESTIGATION_TARGET_RECIPES = Object.freeze(Object.values(INVESTIGATION_TARGET_BY_FACILITY));
const ENCLOSED_INVESTIGATION_FACILITIES = Object.freeze(new Set([
  // The bounded clues for the training yard, watchtower, and shop live in the
  // visible court, tower threshold, and shopfront. Inventing unrelated rooms
  // for those source roles would weaken place truth. The ledger belongs inside
  // the warehouse, which keeps its same-coordinate automatic cutaway.
  'warehouse',
]));
const INVESTIGATION_TARGET_OFFSETS = Object.freeze({
  threshold: Object.freeze({ x: 0, y: 1 }),
  ledger: Object.freeze({ x: -2, y: -1 }),
  // Keep the well clue on the front rim.  The matching well entrance is
  // authored below, so the outdoor scene target and the logical evidence
  // anchor remain the same reachable point.
  'water-source': Object.freeze({ x: -3.5, y: 3.5 }),
  'inspection-mark': Object.freeze({ x: 2, y: -1 }),
  'night-log': Object.freeze({ x: 0, y: -2 }),
  'repair-tools': Object.freeze({ x: -1, y: 0 }),
});
const DISTRICT_ROLES = Object.freeze(['arrival', 'civic', 'heritage', 'work', 'living', 'waterside']);
const FACILITY_KINDS = Object.freeze([
  'guild', 'town_hall', 'dock', 'warehouse', 'well', 'workshop',
  'dojo', 'watchtower', 'shop', 'ruin', 'gate',
]);
const FACILITY_APPEARANCES = Object.freeze({
  gate: 'gate',
  town_hall: 'town-hall',
  warehouse: 'warehouse',
  well: 'well',
  workshop: 'workshop',
  dojo: 'dojo',
  watchtower: 'watchtower',
  shop: 'shop',
  guild: 'guild',
  dock: 'dock',
  ruin: 'ruin',
});
const DWELLING_APPEARANCES = Object.freeze([
  'dwelling-gabled', 'dwelling-stone', 'dwelling-tall',
  'dwelling-stone-bay', 'dwelling-tall-narrow',
]);
const PLACE_APPEARANCES = Object.freeze([
  ...new Set([...Object.values(FACILITY_APPEARANCES), ...DWELLING_APPEARANCES]),
]);
const RESIDENT_APPEARANCES = Object.freeze(['keeper', 'artisan', 'porter', 'watcher', 'neighbor', 'traveler']);
const SNOW_PLACE_APPEARANCES = Object.freeze([
  'gate', 'town-hall', 'warehouse', 'well', 'workshop',
  'dwelling-gabled', 'dwelling-stone',
]);
const SNOW_RESIDENT_APPEARANCES = Object.freeze(['keeper', 'artisan', 'neighbor']);
const SNOW_FACILITY_APPEARANCES = Object.freeze({
  gate: 'gate',
  town_hall: 'town-hall',
  dock: 'warehouse',
  warehouse: 'warehouse',
  well: 'well',
  workshop: 'workshop',
});
const SNOW_INVESTIGATION_TARGET_RECIPES = Object.freeze(['threshold', 'ledger', 'water-source']);
const SNOW_RESIDENT_TRANSLATIONS = Object.freeze({
  porter: 'artisan',
  watcher: 'keeper',
  traveler: 'neighbor',
});
const RESIDENT_BEHAVIORS = Object.freeze(['work', 'talk', 'watch', 'walk']);
const GROUP_ROLE_FAMILIES = Object.freeze({
  work: Object.freeze(['data', 'configuration', 'test', 'tooling']),
  living: Object.freeze(['service', 'interface', 'module']),
});
const GROUP_ROLE_ORDER = Object.freeze(['tooling', 'test', 'data', 'configuration', 'service', 'interface', 'module']);
const REPOSITORY_INSPECTION_TRANSITION_ID = 'transition.repository_inspected';
const INSPECTION_COMPLETION_EVIDENCE_ID = 'repository.inspection.completed';
const HASH_RE = /^[0-9a-f]{64}$/u;
const MAX_DEPTH = 32;
const OWN_KEYS = Object.prototype.hasOwnProperty;

const PLAN_KEYS = Object.freeze([
  'composition', 'contentSeed', 'districts', 'evidence', 'format', 'identity', 'investigations',
  'journey', 'lights', 'places', 'props', 'residents', 'routes', 'schemaVersion',
  'surfaces', 'worldview',
]);

const FACILITY_SIZE = Object.freeze({
  gate: { width: 8, height: 8 },
  guild: { width: 11, height: 9 }, town_hall: { width: 14, height: 10 }, dock: { width: 12, height: 8 },
  warehouse: { width: 12, height: 8 }, well: { width: 7, height: 7 }, workshop: { width: 11, height: 8 },
  dojo: { width: 11, height: 9 }, watchtower: { width: 9, height: 10 },
  shop: { width: 9, height: 7 }, ruin: { width: 10, height: 8 },
});
// The civic space is a small forecourt. It supports a readable gathering
// point without turning half the town into an empty paving card.
const CIVIC_PLAZA_SIZE = Object.freeze({ width: 8, height: 5 });
// The approach is a visible street join, not a detached road leading to a
// building. Two logical units leaves a readable opening at the gate while
// keeping the authored town inside the native 1280 by 720 view.
const AUTHORED_APPROACH_LENGTH = 2;
const STREET_GAP = 1.75;
// The well's authored clue sits on its left front rim. A small extra gap
// keeps a waterside dock's approach out of the well footprint.
const DOCK_WELL_STREET_EXTRA_GAP = 1.25;

class WorldPlanValidationError extends Error {
  constructor(message, issues = [], code = 'WORLD_PLAN_INVALID') {
    super(message);
    this.name = 'WorldPlanValidationError';
    this.code = code;
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function issue(path, message, code = 'INVALID_FIELD') {
  return { path, message, code };
}

function fail(message, issues, code = 'WORLD_PLAN_INVALID') {
  throw new WorldPlanValidationError(message, issues, code);
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSortedStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.length > 0))]
    .sort(compareStrings);
}

function stableClone(value, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DEPTH) throw new TypeError('WorldPlan data is too deeply nested');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('WorldPlan numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('WorldPlan data must be serialisable');
  if (seen.has(value)) throw new TypeError('WorldPlan data must not contain cycles');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((child) => stableClone(child, depth + 1, seen));
  } else if (isRecord(value)) {
    result = {};
    for (const key of Object.keys(value).sort(compareStrings)) result[key] = stableClone(value[key], depth + 1, seen);
  } else {
    throw new TypeError('WorldPlan data must use plain objects');
  }
  seen.delete(value);
  return result;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  Object.freeze(value);
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableClone(value));
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hashParts(...parts) {
  return sha256(parts.map((part) => String(part)).join('\u001f'));
}

function uint32FromHex(value, offset = 0) {
  return Number.parseInt(value.slice(offset, offset + 8), 16) >>> 0;
}

function unitFromHash(...parts) {
  return uint32FromHex(hashParts(...parts)) / 0x100000000;
}

function signedOffset(seed, magnitude) {
  return (unitFromHash(seed) * 2 - 1) * magnitude;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function point(x, y) {
  return { x: round(x), y: round(y) };
}

function samePoint(left, right) {
  return left?.x === right?.x && left?.y === right?.y;
}

function addPoint(points, next) {
  if (!samePoint(points.at(-1), next)) points.push(point(next.x, next.y));
}

function evidenceBag(value, fallback = null) {
  const source = isRecord(value) ? value : {};
  const result = {
    observed: uniqueSortedStrings(source.observed),
    inferred: uniqueSortedStrings(source.inferred),
    unknown: uniqueSortedStrings(source.unknown),
  };
  if (fallback && result.observed.length === 0 && result.inferred.length === 0 && result.unknown.length === 0) {
    result.unknown.push(fallback);
  }
  return result;
}

function mergeEvidence(...values) {
  const result = { observed: [], inferred: [], unknown: [] };
  for (const value of values) {
    const bag = evidenceBag(value);
    for (const state of EVIDENCE_STATES) result[state].push(...bag[state]);
  }
  for (const state of EVIDENCE_STATES) result[state] = uniqueSortedStrings(result[state]);
  return result;
}

function hasEvidence(value) {
  return EVIDENCE_STATES.some((state) => Array.isArray(value?.[state]) && value[state].length > 0);
}

function evidenceState(value) {
  if (value === 'observed' || value === 'inferred' || value === 'unknown') return value;
  const bag = evidenceBag(value);
  return bag.observed.length > 0 ? 'observed' : bag.inferred.length > 0 ? 'inferred' : 'unknown';
}

function nonEmpty(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function normaliseTown(town) {
  const issues = [];
  if (!isRecord(town)) fail('TownModel must be a plain object', [issue('$', 'must be a plain object', 'INVALID_OBJECT')], 'TOWN_MODEL_INVALID');
  if (town.schemaVersion !== 1) issues.push(issue('$.schemaVersion', 'must be exactly 1', 'UNSUPPORTED_SCHEMA'));
  if (!isRecord(town.repository)) issues.push(issue('$.repository', 'must be a plain object', 'INVALID_OBJECT'));
  const identity = {
    key: nonEmpty(town.repository?.identity, ''),
    name: nonEmpty(town.repository?.name, ''),
  };
  if (!identity.key) issues.push(issue('$.repository.identity', 'must be a non-empty string', 'MISSING_STRING'));
  if (!identity.name) issues.push(issue('$.repository.name', 'must be a non-empty string', 'MISSING_STRING'));
  const files = (Array.isArray(town.files) ? town.files : []).map((raw, index) => ({
    fileId: nonEmpty(raw?.fileId, `file.${String(index).padStart(3, '0')}`),
    path: nonEmpty(raw?.path, `file.${String(index).padStart(3, '0')}`),
    role: nonEmpty(raw?.role, 'module'),
    evidence: evidenceBag(raw?.evidence, `file.${index}.unknown`),
    value: stableClone(raw),
  })).sort((left, right) => compareStrings(left.fileId, right.fileId));
  if (!Array.isArray(town.facilities)) issues.push(issue('$.facilities', 'must be an array', 'INVALID_ARRAY'));
  if (!isRecord(town.investigations) || !Array.isArray(town.investigations?.candidates)) {
    issues.push(issue('$.investigations.candidates', 'must contain an array', 'INVALID_ARRAY'));
  }
  if (!Array.isArray(town.rewards?.transitions)) issues.push(issue('$.rewards.transitions', 'must be an array', 'INVALID_ARRAY'));
  if (issues.length > 0) fail('TownModel failed the version 1 contract', issues, 'TOWN_MODEL_INVALID');

  const facilities = town.facilities.map((raw, index) => {
    const kind = nonEmpty(raw?.kind, `unknown-${index}`);
    const value = stableClone(raw);
    return {
      id: `facility.${kind}`,
      kind,
      label: nonEmpty(raw?.label, kind),
      presence: nonEmpty(raw?.presence, 'unknown'),
      condition: PLACE_CONDITIONS.includes(raw?.condition) ? raw.condition : 'unconfirmed',
      sourceFileIds: uniqueSortedStrings(raw?.sourceFileIds),
      evidence: evidenceBag(raw?.evidence, `facility.${kind}.unknown`),
      value,
    };
  }).sort((left, right) => compareStrings(left.kind, right.kind));

  const groups = (Array.isArray(town.groups) ? town.groups : []).map((raw, index) => {
    const id = nonEmpty(raw?.id, `group.${String(index).padStart(3, '0')}`);
    const fileIds = uniqueSortedStrings(raw?.fileIds);
    const roles = uniqueSortedStrings(raw?.roles);
    const roleMix = isRecord(raw?.roleMix)
      ? Object.fromEntries(Object.entries(raw.roleMix).filter(([key, value]) => roles.includes(key) && Number.isFinite(value) && value > 0).sort(([left], [right]) => compareStrings(left, right)))
      : {};
    return {
      id,
      path: nonEmpty(raw?.path, id),
      fileIds,
      roles,
      roleMix,
      connectionIds: uniqueSortedStrings(raw?.connectionIds),
      ordinal: Number.isFinite(raw?.ordinal) ? raw.ordinal : index,
      state: EVIDENCE_STATES.includes(raw?.state) ? raw.state : evidenceState(raw?.evidence),
      evidence: evidenceBag(raw?.evidence, `group.${id}.unknown`),
      value: stableClone(raw),
    };
  }).sort((left, right) => compareStrings(left.id, right.id));

  const facts = (Array.isArray(town.facts) ? town.facts : []).map((raw, index) => ({
    id: nonEmpty(raw?.id, `fact.${String(index).padStart(3, '0')}`),
    kind: nonEmpty(raw?.kind, 'fact'),
    subject: nonEmpty(raw?.subject, 'unknown'),
    state: evidenceState(raw?.state),
    evidence: evidenceBag(raw?.evidence, `fact.${index}.unknown`),
    value: stableClone(raw),
  })).sort((left, right) => compareStrings(left.id, right.id));

  const connections = (Array.isArray(town.connections) ? town.connections : []).map((raw, index) => {
    const id = nonEmpty(raw?.id, `connection.${String(index).padStart(3, '0')}`);
    const role = NPC_ROLE_VOCABULARY.includes(raw?.kind) ? raw.kind : 'unknown';
    const direction = ['internal', 'inbound', 'outbound', 'unknown'].includes(raw?.direction) ? raw.direction : 'unknown';
    return {
      id,
      direction,
      role,
      target: nonEmpty(raw?.target, id),
      groupIds: uniqueSortedStrings(raw?.groupIds),
      state: evidenceState(raw?.state ?? raw?.evidence),
      evidence: evidenceBag(raw?.evidence, `connection.${id}.unknown`),
      value: stableClone(raw),
    };
  }).sort((left, right) => compareStrings(left.id, right.id));

  const candidates = town.investigations.candidates.map((raw, index) => {
    const id = nonEmpty(raw?.id, `investigation.${String(index).padStart(3, '0')}`);
    const facilityKind = nonEmpty(raw?.facilityKind, 'unknown');
    return {
      id,
      capability: raw?.capability === null ? null : nonEmpty(raw?.capability, 'unknown'),
      facilityKind,
      subject: nonEmpty(raw?.subject, `Investigation ${index + 1}`),
      action: nonEmpty(raw?.action, ''),
      statement: nonEmpty(raw?.statement, 'The repository state is not confirmed.'),
      state: evidenceState(raw?.state),
      evidence: evidenceBag(raw?.evidence, `investigation.${id}.unknown`),
      value: stableClone(raw),
    };
  });
  if (candidates.length !== 3) {
    fail('TownModel must provide exactly three investigation candidates', [issue('$.investigations.candidates', 'must contain exactly three candidates', 'INVALID_CANDIDATE_COUNT')], 'TOWN_MODEL_INVALID');
  }
  const candidateKinds = new Set();
  for (const candidate of candidates) {
    if (!OWN_KEYS.call(INVESTIGATION_TARGET_BY_FACILITY, candidate.facilityKind)) {
      issues.push(issue(`$.investigations.candidates.${candidate.id}.facilityKind`, 'must use a facility with a complete investigation target recipe', 'INVALID_FACILITY_KIND'));
    }
    if (candidateKinds.has(candidate.facilityKind)) {
      issues.push(issue(`$.investigations.candidates.${candidate.id}.facilityKind`, 'investigation facilities must be distinct', 'DUPLICATE_FACILITY'));
    }
    if (!candidate.action) {
      issues.push(issue(`$.investigations.candidates.${candidate.id}.action`, 'must describe the place-specific inspection action', 'MISSING_STRING'));
    }
    if (candidate.state !== evidenceState(candidate.evidence)) {
      issues.push(issue(`$.investigations.candidates.${candidate.id}.state`, 'must match the highest-priority non-empty evidence bucket', 'EVIDENCE_STATE_MISMATCH'));
    }
    candidateKinds.add(candidate.facilityKind);
  }
  if (issues.length > 0) fail('TownModel failed the version 1 contract', issues, 'TOWN_MODEL_INVALID');

  const transitions = town.rewards.transitions.map((entry) => stableClone(entry));
  const transition = transitions.find((entry) => entry?.id === REPOSITORY_INSPECTION_TRANSITION_ID) ?? null;
  if (!transition) {
    fail('TownModel must preserve the observed repository inspection transition', [
      issue('$.rewards.transitions', 'must contain transition.repository_inspected', 'MISSING_TRANSITION'),
    ], 'TOWN_MODEL_INVALID');
  }
  const evidence = evidenceBag(town.evidence, 'repository.inspection.runtime.unknown');
  return deepFreeze({
    identity,
    files,
    groups,
    facilities,
    facts,
    connections,
    candidates,
    transitions,
    transition,
    evidence,
  });
}

function semanticSignature(town) {
  return stableStringify({
    identity: town.identity,
    files: town.files.map(({ value }) => value),
    groups: town.groups.map(({ value }) => value),
    facilities: town.facilities.map(({ value }) => value),
    facts: town.facts.map(({ value }) => value),
    connections: town.connections.map(({ value }) => value),
    investigations: town.candidates.map(({ value }) => value),
    rewards: town.transitions,
    evidence: town.evidence,
  });
}

function groupHomeSize(group) {
  const appearance = typeof group === 'string' ? group : dwellingAppearance(group);
  return homeSizeForAppearance(appearance);
}

function homeSizeForAppearance(appearance) {
  return appearance === 'dwelling-tall' || appearance === 'dwelling-tall-narrow'
    ? { width: 8, height: 10 }
    : appearance === 'dwelling-stone' || appearance === 'dwelling-stone-bay'
      ? { width: 10, height: 8 }
      : { width: 9, height: 8 };
}

function placeRouteWidth(facilityKind, recipe = null) {
  return facilityKind === 'gate' || facilityKind === 'town_hall' || recipe === 'civic_plaza' ? 5 : 3;
}

function placeIdForFacility(kind) {
  return `place.${String(kind).replaceAll('_', '-')}`;
}

function placeIdForCompound(compound) {
  return `place.${compound.id}`;
}

function facilityRecordByKind(town) {
  const records = new Map(town.facilities.map((facility) => [facility.kind, facility]));
  for (const candidate of town.candidates) {
    if (records.has(candidate.facilityKind)) continue;
    records.set(candidate.facilityKind, {
      id: `facility.${candidate.facilityKind}`,
      kind: candidate.facilityKind,
      presence: 'unknown',
      condition: 'unconfirmed',
      sourceFileIds: [],
      evidence: candidate.evidence,
      value: {},
    });
  }
  for (const kind of ['gate', 'town_hall']) {
    if (records.has(kind)) continue;
    records.set(kind, {
      id: `facility.${kind}`,
      kind,
      presence: 'unknown',
      condition: 'unconfirmed',
      sourceFileIds: [],
      evidence: evidenceBag(null, `facility.${kind}.unknown`),
      value: {},
    });
  }
  return records;
}

function itemSize(item) {
  return item.kind === 'civic_plaza'
    ? CIVIC_PLAZA_SIZE
    : item.facilityKind
      ? (FACILITY_SIZE[item.facilityKind] ?? { width: 9, height: 7 })
      : groupHomeSize(item.appearance);
}

function itemRouteWidth(item) {
  return placeRouteWidth(item.facilityKind, item.kind === 'civic_plaza' ? 'civic_plaza' : null);
}

// The compact late-medieval composition is a bounded recipe for the current
// small repository shape. It is intentionally exact: a different facility
// set or a different district population uses the normal authored frontage
// grammar below instead of inheriting this town's street walls.
function isCompactLateShape(values) {
  if (!Array.isArray(values) || values.length !== 12) return false;
  const facilities = values
    .filter((value) => value?.facilityKind)
    .map((value) => value.facilityKind)
    .sort(compareStrings);
  if (JSON.stringify(facilities) !== JSON.stringify(['gate', 'town_hall', 'warehouse', 'well', 'workshop'])) return false;
  const homes = values.filter((value) => value?.kind === 'residence' || value?.recipe === 'residence');
  if (homes.length !== 6) return false;
  const familyOf = (value) => value.family ?? value.district;
  if (homes.filter((value) => familyOf(value) === 'work').length !== 3) return false;
  if (homes.filter((value) => familyOf(value) === 'living').length !== 3) return false;
  return values.some((value) => value?.kind === 'civic_plaza' || value?.recipe === 'civic_plaza');
}

function isSmallLateShape(values) {
  if (!Array.isArray(values) || values.length !== 5) return false;
  const facilities = values
    .filter((value) => value?.facilityKind)
    .map((value) => value.facilityKind)
    .sort(compareStrings);
  return JSON.stringify(facilities) === JSON.stringify(['gate', 'town_hall', 'warehouse', 'well'])
    && values.every((value) => value?.kind !== 'residence' && value?.recipe !== 'residence')
    && values.some((value) => value?.kind === 'civic_plaza' || value?.recipe === 'civic_plaza');
}

const BROAD_LATE_FACILITIES = Object.freeze([
  'dock', 'dojo', 'gate', 'guild', 'ruin', 'shop', 'town_hall',
  'warehouse', 'watchtower', 'well', 'workshop',
]);

// Extended late repositories share one bounded town grammar. Optional
// facilities occupy authored parcels and absent roles leave useful gardens or
// work yards in the environment backplate; the repository still determines
// which live structures, residents and investigations appear. Exact compact
// and small towns retain their already-reviewed compositions.
function isBroadLateShape(values) {
  if (!Array.isArray(values) || isCompactLateShape(values) || isSmallLateShape(values)) return false;
  const facilities = values.filter((value) => value?.facilityKind);
  const homes = values.filter((value) => value?.kind === 'residence' || value?.recipe === 'residence');
  const hasPlaza = values.some((value) => value?.kind === 'civic_plaza' || value?.recipe === 'civic_plaza');
  const facilityKinds = facilities.map((value) => value.facilityKind);
  const extended = facilityKinds.some((kind) => !['gate', 'town_hall', 'warehouse', 'well', 'workshop'].includes(kind));
  return hasPlaza
    && facilities.some((value) => value.facilityKind === 'gate')
    && facilities.some((value) => value.facilityKind === 'town_hall')
    && facilities.every((value) => BROAD_LATE_FACILITIES.includes(value.facilityKind))
    && homes.length <= 6
    && (extended || facilities.length >= 5 || homes.length >= 2);
}

function isCompactSnowShape(values) {
  if (!Array.isArray(values)) return false;
  const facilities = values
    .filter((value) => value?.facilityKind)
    .map((value) => value.facilityKind)
    .sort(compareStrings);
  if (JSON.stringify(facilities) !== JSON.stringify(['dock', 'gate', 'town_hall', 'warehouse', 'well', 'workshop'])) return false;
  const homes = values.filter((value) => value?.kind === 'residence' || value?.recipe === 'residence');
  if (homes.length !== 2) return false;
  const familyOf = (value) => value.family ?? value.district;
  return homes.filter((value) => familyOf(value) === 'work').length === 1
    && homes.filter((value) => familyOf(value) === 'living').length === 1
    && values.some((value) => value?.kind === 'civic_plaza' || value?.recipe === 'civic_plaza');
}

function authoredStreetGap(left, right) {
  const dockWellPair = (left.facilityKind === 'dock' && right.facilityKind === 'well')
    || (left.facilityKind === 'well' && right.facilityKind === 'dock');
  return STREET_GAP + (dockWellPair ? DOCK_WELL_STREET_EXTRA_GAP : 0);
}

function rowWidth(items) {
  return items.reduce((total, item, index) => total
    + (index > 0 ? authoredStreetGap(items[index - 1], item) : 0)
    + itemSize(item).width, 0);
}

function stableCompositionItemOrder(left, right) {
  const leftFacility = left.facilityKind ? 0 : 1;
  const rightFacility = right.facilityKind ? 0 : 1;
  return leftFacility - rightFacility
    || compareStrings(left.kind ?? '', right.kind ?? '')
    || compareStrings(left.sortKey, right.sortKey)
    || compareStrings(left.id, right.id);
}

/*
 * The town is an authored set of semantic frontages, not a packing grid. A
 * frontage is a deterministic street wall: items are ordered by meaning and
 * laid side-by-side with the declared gap. This gives every facility and home
 * compound a real place without a fallback search that can move one building
 * away from the route grammar.
 *
 * Late-medieval and snow-harbor keep their established west gate / civic
 * hinge, upper work-and-heritage quarter, and lower living / waterside edge.
 * The frontages grow outward when a repository has more compounds; their
 * exact footprints remain disjoint by construction.
 */
function makeAuthoredComposition(town, worldview = WORLDVIEWS.lateMedieval) {
  const snow = isSnowWorldview(worldview);
  const sourceCompounds = makeGroupHomeCompounds(town);
  const facilities = [...facilityRecordByKind(town).values()]
    .filter((facility) => facility.kind === 'gate'
      || facility.kind === 'town_hall'
      || facility.presence !== 'not_applicable'
      || town.candidates.some((candidate) => candidate.facilityKind === facility.kind))
    .map((facility) => ({
      id: placeIdForFacility(facility.kind),
      kind: 'facility',
      facilityKind: facility.kind,
      sortKey: facility.kind,
      size: FACILITY_SIZE[facility.kind] ?? { width: 9, height: 7 },
    }));
  const broadExtendedFacility = facilities.some((facility) => ![
    'gate', 'town_hall', 'warehouse', 'well', 'workshop',
  ].includes(facility.facilityKind));
  const broadParcelShape = !snow
    && facilities.some((facility) => facility.facilityKind === 'gate')
    && facilities.some((facility) => facility.facilityKind === 'town_hall')
    && facilities.every((facility) => BROAD_LATE_FACILITIES.includes(facility.facilityKind))
    && (broadExtendedFacility || facilities.length > 5 || sourceCompounds.length < 6);
  const broadHomeDensity = broadParcelShape
    && sourceCompounds.length < 6
    && sourceCompounds.some((compound) => compound.groups.length > 1);
  const compounds = snow
    ? sourceCompounds
    : boundedLateHomeCompounds(broadHomeDensity
      ? splitLateHomeCompounds(sourceCompounds)
      : sourceCompounds, broadParcelShape ? 5 : 6);
  const homes = compounds.map((compound) => ({
    id: placeIdForCompound(compound),
    kind: 'residence',
    appearance: dwellingAppearanceForWorldview(compound.appearance, worldview),
    family: compound.family,
    parentPath: compound.parentPath,
    root: compound.groups.some((group) => group.path === '.'),
    sourceGroupIds: compound.sourceGroupIds,
    sortKey: `${compound.parentPath}|${compound.family}|${compound.id}`,
  }));
  const plaza = { id: 'place.civic-plaza', kind: 'civic_plaza', sortKey: 'civic-plaza' };
  const allItems = [...facilities, ...homes, plaza];
  const anchors = new Map();
  const placeAnchor = (item, value) => {
    const anchor = point(value.x, value.y);
    anchors.set(item.id, anchor);
    return anchor;
  };
  const byFacility = new Map(facilities.map((item) => [item.facilityKind, item]));
  const gate = byFacility.get('gate');
  const hall = byFacility.get('town_hall');

  const broadLate = !snow && isBroadLateShape(allItems);
  if (broadLate) {
    const facilityAnchors = Object.freeze({
      watchtower: { x: 5.5, y: 8.5 },
      town_hall: { x: 28, y: 13.5 },
      ruin: { x: 40.5, y: 9.5 },
      workshop: { x: 52, y: 13.5 },
      gate: { x: 5, y: 22.5 },
      // Keep the low, dark guild facade out of the civic junction.  The
      // recognizable shop front owns the inner street; the larger guild sits
      // on the quieter east parcel where its approach still joins the same
      // civic/work route.
      guild: { x: 42, y: 23 },
      shop: { x: 15, y: 22.5 },
      well: { x: 5.5, y: 37.5 },
      dojo: { x: 28, y: 32 },
      warehouse: { x: 41, y: 36.5 },
      dock: { x: 53.5, y: 37.5 },
    });
    for (const facility of facilities) placeAnchor(facility, facilityAnchors[facility.facilityKind]);
    placeAnchor(plaza, { x: 25, y: 21.5 });

    const slots = Object.freeze({
      northWest: { x: 15.5, y: 8.5 },
      northEast: { x: 62.5, y: 8.5 },
      midEast: { x: 61, y: 22.5 },
      southWest: { x: 14.5, y: 37.5 },
      southEast: { x: 64.5, y: 33.5 },
    });
    const preference = Object.freeze({
      heritage: ['northWest', 'northEast', 'midEast', 'southWest', 'southEast'],
      work: ['midEast', 'northEast', 'southEast', 'northWest', 'southWest'],
      living: ['southWest', 'southEast', 'midEast', 'northWest', 'northEast'],
      civic: ['northWest', 'midEast', 'southWest', 'northEast', 'southEast'],
      arrival: ['northWest', 'southWest', 'midEast', 'northEast', 'southEast'],
    });
    const slotAppearances = Object.freeze({
      northWest: 'dwelling-stone',
      northEast: 'dwelling-tall',
      midEast: 'dwelling-stone-bay',
      southWest: 'dwelling-tall-narrow',
      southEast: 'dwelling-gabled',
    });
    const usedSlots = new Set();
    const residenceAppearances = new Map();
    for (const home of homes.slice().sort(stableCompositionItemOrder)) {
      const order = preference[home.family] ?? preference.civic;
      const slotId = order.find((candidate) => !usedSlots.has(candidate));
      if (!slotId) throw new TypeError(`Broad late composition has no authored home slot for ${home.id}`);
      usedSlots.add(slotId);
      placeAnchor(home, slots[slotId]);
      residenceAppearances.set(home.id, slotAppearances[slotId]);
    }
    return {
      layout: 'late-broad',
      originX: -2,
      originY: 1.5,
      width: 73,
      height: 45.5,
      items: allItems,
      rows: [{ items: allItems }],
      anchors,
      residenceAppearances,
      compounds,
    };
  }

  // The first street is always recognizable: arrival threshold -> hall ->
  // small civic apron. These coordinates are deliberately retained from the
  // established late/snow recipes so the opening view does not drift.
  if (gate) placeAnchor(gate, snow ? { x: 7, y: 27 } : { x: 7, y: 22 });
  if (hall) placeAnchor(hall, snow ? { x: 20, y: 21 } : { x: 32, y: 11.5 });
  // Compact towns share one civic court.  Keep the plaza below the hall and
  // above the well so the three landmarks read as one walkable hinge rather
  // than three isolated cards.
  placeAnchor(plaza, snow ? { x: 31, y: 28.5 } : { x: 31, y: 28 });

  const ordered = (items) => items.slice().sort(stableCompositionItemOrder);
  const frontage = (items, left, centerY) => {
    const sorted = ordered(items);
    let cursor = left;
    let right = left;
    for (const item of sorted) {
      const size = itemSize(item);
      const anchor = placeAnchor(item, { x: cursor + size.width / 2, y: centerY });
      cursor = round(cursor + size.width + STREET_GAP);
      right = round(cursor - STREET_GAP);
      // Keep the exact point available to callers that need semantic rows.
      void anchor;
    }
    return { items: sorted, right };
  };
  const facilitiesOf = (kinds) => facilities.filter((item) => kinds.includes(item.facilityKind));

  // Root compounds remain a visible arrival lane. In snow, work/living roots
  // belong to their semantic quarters as in the existing harbor grammar.
  const arrivalHomes = homes.filter((item) => item.root
    && !['work', 'living'].includes(item.family));
  const arrivalFront = frontage(arrivalHomes, 6, 11);

  // Heritage and work share the upper street but retain distinct frontages;
  // their explicit boundary is a quiet gap, not an overlap search.
  const heritageItems = [
    ...facilitiesOf(['watchtower', 'ruin']),
    ...homes.filter((item) => item.family === 'heritage' && !item.root),
  ];
  // The upper heritage wall sits beyond the civic apron. Its y band is
  // intentionally higher than the plaza, so start at the plaza's far edge
  // plus a quiet frontage gap before adding the tower/ruin sequence. The
  // hall shares this upper band, so its right wall is also an authoritative
  // boundary; ignoring it let a watchtower or ruin enter the hall by one
  // logical unit in broad repositories.
  const plazaRight = (snow ? 31 : 32) + CIVIC_PLAZA_SIZE.width / 2;
  const hallRight = hall
    ? (anchors.get(hall.id)?.x ?? (snow ? 20 : 32)) + itemSize(hall).width / 2
    : 0;
  const heritageFront = frontage(
    heritageItems,
    round(Math.max(6, arrivalFront.right + 6, plazaRight + 2, hallRight + STREET_GAP)),
    14,
  );
  const workFacilities = facilitiesOf(['warehouse', 'workshop', 'dojo', 'shop']);
  const workHomes = homes.filter((item) => item.family === 'work');
  const workItems = [...workFacilities, ...workHomes];
  // A small repository with a real distribution edge should become one
  // harbour neighbourhood, not three catalogue rows. Keep this authored
  // arrangement bounded to the complete nine-place snow recipe: the civic
  // hinge remains the entrance, work fronts its short upper lane, and the
  // living shoulder continues directly into the dock cove.
  const compactSnow = snow
    && heritageItems.length === 0
    && arrivalHomes.length === 0
    && workFacilities.length === 2
    && workFacilities.every((item) => ['warehouse', 'workshop'].includes(item.facilityKind))
    && workHomes.length === 1
    && homes.length === 2
    && homes.filter((item) => item.family === 'living').length === 1
    && facilities.every((item) => ['gate', 'town_hall', 'dock', 'warehouse', 'well', 'workshop'].includes(item.facilityKind))
    && facilitiesOf(['dock', 'well']).length === 2;
  if (compactSnow) {
    // The gate, hall door, and civic apron share one south-facing street
    // line. The hall sits one unit higher than its older catalogue position,
    // so following the visible main road now reaches the automatic doorway
    // instead of the hall's side collision.
    placeAnchor(hall, { x: 20, y: 21 });
    placeAnchor(plaza, { x: 31, y: 28.5 });
  }
  // The common late-medieval repository has one or two work facilities and a
  // small number of work compounds. Keep that town as one walkable court:
  // facilities sit immediately behind the civic hinge and homes make a short
  // lower street wall. The all-role/broad case intentionally keeps the larger
  // frontage grammar below, so adding a new semantic facility never gets
  // silently forced into this compact composition.
  const compactLate = !snow && isCompactLateShape(allItems);
  // When no heritage frontage exists (the common compact harbor), the work
  // court can sit directly behind the civic hinge. Avoid reserving the empty
  // heritage edge as if it were a building row; that pushed one small snow
  // repository beyond the native overview and made the town feel sparse.
  const workStart = heritageItems.length > 0
    ? round(Math.max(6, heritageFront.right + 6))
    : snow
      ? 24
      // The general late grammar shares the hall's upper frontage. Start a
      // work parcel after the hall's right wall plus one authored street gap;
      // the old fixed x=35 began a warehouse inside the hall whenever a
      // small repository had no residence compounds and therefore did not
      // select the compact-town composition.
      : round((anchors.get(hall?.id)?.x ?? 32)
        + (hall ? itemSize(hall).width / 2 : 7)
        + STREET_GAP);
  let workFront;
  // A normal repository has a small work court (two facilities and a few
  // work compounds). Keep the facilities as the upper street wall and wrap
  // homes onto its lower court instead of producing one catalogue row. The
  // larger all-role case retains the longer authored frontage deliberately.
  if (compactSnow) {
    const facilityAnchor = {
      warehouse: { x: 34, y: 13 },
      workshop: { x: 46.5, y: 14 },
    };
    for (const facility of ordered(workFacilities)) {
      placeAnchor(facility, facilityAnchor[facility.facilityKind]);
    }
    const home = ordered(workHomes)[0];
    // Turn the final frontage down onto the civic street. Its entrance lands
    // on the same line as the hall and plaza, closing the work lane into an
    // L-shaped neighbourhood instead of leaving a detached upper row.
    placeAnchor(home, { x: 47, y: 25 });
    workFront = {
      items: [...ordered(workFacilities), home],
      right: 47 + itemSize(home).width / 2,
    };
  } else if (compactLate) {
    const facilityAnchor = {
      // Keep the upper work wall close to the civic hinge, but clear the
      // hall's 14x10 envelope and retain a real half-unit alley between the
      // warehouse and workshop footprints.
      warehouse: { x: 19, y: 11.5 },
      workshop: { x: 45, y: 11.5 },
    };
    for (const facility of ordered(workFacilities)) {
      const anchor = facilityAnchor[facility.facilityKind];
      if (anchor) placeAnchor(facility, anchor);
    }
    // The work wall bends around the civic apron. Unequal baselines keep the
    // three semantic compounds legible as one close street without turning
    // their repeated 240px canvases into a ruler-straight catalogue row.
    const homeAnchors = [
      { x: 50, y: 22 },
      // Stagger the middle frontage eastward.  All three sprites face south;
      // a tight vertical stack put the middle resident under the next roof.
      // This shallow bend keeps each threshold open to the same east lane.
      { x: 58, y: 30.5 },
      // Close the east frontage one unit sooner.  At y=40 this final home
      // and its resident extended the authored opening just beyond the
      // native 720px view, forcing the whole town to half scale.  The two
      // neighbouring footprints now meet at a shared street-wall edge while
      // the south lane remains clear.
      { x: 50, y: 39 },
    ];
    for (const [index, home] of ordered(workHomes).entries()) {
      placeAnchor(home, homeAnchors[index]);
    }
    workFront = {
      items: [...ordered(workFacilities), ...ordered(workHomes)],
      right: Math.max(...ordered(workFacilities).map((item) => {
        const anchor = facilityAnchor[item.facilityKind];
        return anchor.x + itemSize(item).width / 2;
      }), ...ordered(workHomes).map((item, index) => homeAnchors[index].x + itemSize(item).width / 2)),
    };
  } else if (!snow && workFacilities.length > 0 && workHomes.length > 0 && workItems.length <= 6) {
    // Half-unit vertical separation lets tall dwelling envelopes touch the
    // lower edge of the facility wall without crossing it.
    const facilityFront = frontage(workFacilities, workStart, 10.5);
    // Keep a dry walking shoulder below the heritage/work facility row.  A
    // centre at 21 leaves the three-unit district approach touching a home
    // footprint at y=17; the lower row must start at y=19 instead.
    const homeFront = frontage(workHomes, round(workStart + 1), 23);
    workFront = { items: [...facilityFront.items, ...homeFront.items], right: Math.max(facilityFront.right, homeFront.right) };
  } else {
    workFront = frontage(workItems, workStart, snow ? 13 : 12);
  }

  // Civic extras sit beyond the plaza on the same street hinge. This is where
  // guild frontage and non-root civic compounds belong; none can intersect
  // the fixed hall or plaza because the row starts at their right edge.
  const assignedHomes = new Set([
    ...arrivalHomes,
    ...heritageItems.filter((item) => item.kind === 'residence'),
    ...workItems.filter((item) => item.kind === 'residence'),
  ].map((item) => item.id));
  const civicItems = [
    ...facilitiesOf(['guild']),
    ...homes.filter((item) => !assignedHomes.has(item.id)),
    ...facilities.filter((item) => !['gate', 'town_hall', 'warehouse', 'workshop', 'dojo', 'shop', 'watchtower', 'ruin', 'guild', 'well', 'dock'].includes(item.facilityKind)),
  ];
  const civicFront = frontage(civicItems, round(plazaRight + STREET_GAP), snow ? 31 : 31);

  // The living lane stays below the civic spine. Waterside frontage follows
  // it on the lower-right edge, preserving the snow harbor's shore reading.
  const livingItems = [
    ...facilitiesOf(['well']),
    ...homes.filter((item) => item.family === 'living'),
  ];
  let livingFront;
  if (compactSnow) {
    const livingHome = homes.find((item) => item.family === 'living');
    const well = facilitiesOf(['well'])[0];
    // Keep the well on the left shoulder of the civic-to-harbour lane. The
    // plaza's five-unit main road can then reach its entrance without its
    // final stroke entering the well body.
    placeAnchor(well, { x: 24, y: 36 });
    placeAnchor(livingHome, { x: 37, y: 36.5 });
    livingFront = {
      items: [well, livingHome],
      right: 37 + itemSize(livingHome).width / 2,
    };
  } else if (compactLate) {
    const well = facilitiesOf(['well'])[0];
    // The well and plaza are one civic court. Keep a quiet passage between
    // their footprints; the well's left-front door then opens to the south
    // lane without blocking the court's central view.
    if (well) placeAnchor(well, { x: 23, y: 31.5 });
    // Living homes make the lower foreground wall. Unequal widths are
    // deliberate; the quiet gaps read as yards rather than a house catalog.
    const homeAnchors = [
      { x: 11, y: 37.5 },
      { x: 27, y: 39 },
      { x: 39, y: 37.5 },
    ];
    for (const [index, home] of homes.filter((item) => item.family === 'living').sort(stableCompositionItemOrder).entries()) {
      placeAnchor(home, homeAnchors[index]);
    }
    livingFront = {
      items: [...(well ? [well] : []), ...homes.filter((item) => item.family === 'living').sort(stableCompositionItemOrder)],
      right: Math.max(
        ...(well ? [25 + itemSize(well).width / 2] : []),
        ...homes.filter((item) => item.family === 'living').sort(stableCompositionItemOrder).map((item, index) => homeAnchors[index].x + itemSize(item).width / 2),
      ),
    };
  } else {
    livingFront = frontage(livingItems, 6, snow ? 37 : 40);
  }
  const watersideItems = facilitiesOf(['dock']);
  if (compactSnow) {
    placeAnchor(watersideItems[0], { x: 49, y: 37 });
  } else {
    // In the broad role-complete town the civic guild and waterside dock are
    // both real frontages. Start the shore after both the living and civic
    // walls, or their authored envelopes overlap before routing begins.
    frontage(watersideItems, round(Math.max(
      snow ? 54 : 46,
      livingFront.right + 8,
      civicFront.right + 8,
    )), 34);
  }

  // Every authored item must have one deterministic frontage. If a future
  // declared role is added, placing it in the civic frontage is an explicit
  // semantic choice rather than a hidden nearest-slot fallback.
  const unplaced = allItems.filter((item) => !anchors.has(item.id));
  if (unplaced.length > 0) {
    throw new TypeError(`Authored composition lacks a frontage for ${unplaced.map((item) => item.id).join(', ')}`);
  }
  const maxX = Math.max(...allItems.map((item) => {
    const anchor = anchors.get(item.id);
    return anchor.x + itemSize(item).width / 2;
  }));
  const maxY = Math.max(...allItems.map((item) => {
    const anchor = anchors.get(item.id);
    return anchor.y + itemSize(item).height / 2;
  }));
  const styleBands = [
    arrivalHomes,
    heritageItems,
    workItems,
    civicItems,
    livingItems,
  ];
  const residenceAppearances = applyNeighbourDwellingStyles(town, styleBands);
  return {
    originX: 0,
    originY: 0,
    width: round(Math.max(snow ? 54 : 60, maxX)),
    height: round(Math.max(42, maxY)),
    items: allItems,
    rows: [{ items: allItems }],
    anchors,
    residenceAppearances,
    compounds,
  };
}

function makeCompositionBounds(town, grammar = makeAuthoredComposition(town)) {
  if (grammar.layout === 'late-broad') {
    return { minX: -2, maxX: 71, minY: 1.5, maxY: 47 };
  }
  // The placement canvas is only a small guard around the authored streets.
  // The final packed bounds are cropped from actual places and routes below.
  return {
    minX: 0,
    maxX: round(grammar.originX + grammar.width + 8),
    minY: 0,
    maxY: round(grammar.originY + grammar.height + 8),
  };
}

function facilityDistrictRole(kind) {
  return ({
    gate: 'arrival',
    guild: 'civic', town_hall: 'civic',
    dock: 'waterside', warehouse: 'work', workshop: 'work', dojo: 'work', shop: 'work',
    well: 'living', watchtower: 'heritage', ruin: 'heritage',
  })[kind] ?? 'civic';
}

function activeDistrictRoles(town) {
  const roles = new Set(['arrival', 'civic']);
  const facilities = new Set([
    ...town.facilities
      .filter((facility) => facility.kind === 'gate'
        || facility.kind === 'town_hall'
        || facility.presence !== 'not_applicable'
        || town.candidates.some((candidate) => candidate.facilityKind === facility.kind))
      .map((facility) => facility.kind),
    ...town.candidates.map((candidate) => candidate.facilityKind),
  ]);
  const groups = town.groups;
  if (['warehouse', 'workshop', 'dojo', 'shop'].some((kind) => facilities.has(kind))
      || groups.some((group) => ['data', 'tooling', 'test', 'configuration'].some((role) => group.roles.includes(role)))) {
    roles.add('work');
  }
  if (['well'].some((kind) => facilities.has(kind))
      || groups.some((group) => ['service', 'module'].some((role) => group.roles.includes(role)))) {
    roles.add('living');
  }
  if (['watchtower', 'ruin'].some((kind) => facilities.has(kind))
      || groups.some((group) => /(?:legacy|deprecated|archive|old|backup)/iu.test(group.path))) {
    roles.add('heritage');
  }
  if (facilities.has('dock')) roles.add('waterside');
  return [...roles].filter((role) => DISTRICT_ROLES.includes(role));
}

function makeDistricts(
  town,
  bounds,
  grammar = makeAuthoredComposition(town),
  worldview = WORLDVIEWS.lateMedieval,
) {
  const candidateRoles = activeDistrictRoles(town);
  const candidateDistrictIds = new Set(candidateRoles);
  const placeRole = (item) => {
    if (item.facilityKind) return facilityDistrictRole(item.facilityKind);
    if (item.kind === 'civic_plaza') return 'civic';
    if (item.root && candidateDistrictIds.has('arrival')
      && !['work', 'living'].includes(item.family)) return 'arrival';
    if (item.family === 'heritage' && candidateDistrictIds.has('heritage')) return 'heritage';
    if (candidateDistrictIds.has(item.family)) return item.family;
    return candidateDistrictIds.has('civic') ? 'civic' : candidateRoles[0];
  };
  const itemsById = new Map(grammar.rows.flatMap((row) => row.items.map((item) => [item.id, item])));
  // Semantic evidence can request a district whose facility was explicitly
  // declared not applicable.  Districts describe the authored town, so keep
  // only roles that own at least one placed street item; evidence remains on
  // the nearest truthful compound instead of manufacturing an empty parcel.
  const roles = candidateRoles.filter((role) => [...itemsById.values()]
    .some((item) => placeRole(item) === role));
  const districtIds = new Set(roles);
  const envelopeForItem = (item) => {
    const anchor = grammar.anchors.get(item.id);
    if (!anchor) return null;
    const size = itemSize(item);
    const footprint = rectangleAround(anchor, size);
    const approach = approachReservation(anchor, size, itemRouteWidth(item), item.facilityKind);
    return {
      minX: Math.min(footprint.x, approach.rectangle.x),
      maxX: Math.max(footprint.x + footprint.width, approach.rectangle.x + approach.rectangle.width),
      minY: Math.min(footprint.y, approach.rectangle.y),
      maxY: Math.max(footprint.y + footprint.height, approach.rectangle.y + approach.rectangle.height),
    };
  };
  const districts = [];
  for (const role of roles) {
    const roleItems = [...itemsById.values()].filter((item) => placeRole(item) === role);
    const envelopes = roleItems.map(envelopeForItem).filter(Boolean);
    if (envelopes.length === 0) throw new TypeError(`District ${role} has no authored street place`);
    const margin = 6;
    const minX = Math.max(bounds.minX, Math.min(...envelopes.map((entry) => entry.minX)) - margin);
    const maxX = Math.min(bounds.maxX, Math.max(...envelopes.map((entry) => entry.maxX)) + margin);
    const minY = Math.max(bounds.minY, Math.min(...envelopes.map((entry) => entry.minY)) - margin);
    const maxY = Math.min(bounds.maxY, Math.max(...envelopes.map((entry) => entry.maxY)) + margin);
    const parcel = { minX: round(minX), maxX: round(maxX), minY: round(minY), maxY: round(maxY) };
    const evidence = mergeEvidence(
      ...town.facilities.filter((facility) => facilityDistrictRole(facility.kind) === role).map((facility) => facility.evidence),
      ...town.groups.filter((group) => groupDistrict(group, districtIds, worldview) === role).map((group) => group.evidence),
    );
    if (!hasEvidence(evidence)) evidence.unknown.push(`district.${role}.unknown`);
    districts.push({
      id: role,
      role,
      anchor: point((parcel.minX + parcel.maxX) / 2, (parcel.minY + parcel.maxY) / 2),
      bounds: parcel,
      evidence,
    });
  }
  return districts;
}

function facilityRecipe(kind) {
  if (kind === 'gate') return 'arrival_gate';
  if (kind === 'town_hall') return 'civic_hall';
  if (kind === 'dock') return 'waterfront_dock';
  if (kind === 'ruin') return 'heritage_ruin';
  return 'facility';
}

function districtForPlace(kind) {
  return facilityDistrictRole(kind);
}

function rectangleAround(anchor, size) {
  return {
    x: round(anchor.x - size.width / 2),
    y: round(anchor.y - size.height / 2),
    width: size.width,
    height: size.height,
  };
}

function expandRectangle(rectangle, amount) {
  return {
    x: round(rectangle.x - amount),
    y: round(rectangle.y - amount),
    width: round(rectangle.width + amount * 2),
    height: round(rectangle.height + amount * 2),
  };
}

function rectangleBounds(rectangle) {
  return {
    minX: round(rectangle.x),
    maxX: round(rectangle.x + rectangle.width),
    minY: round(rectangle.y),
    maxY: round(rectangle.y + rectangle.height),
  };
}

function rectanglesOverlap(left, right) {
  if (![left, right].every((value) => isRecord(value)
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.width) && value.width > 0
    && Number.isFinite(value.height) && value.height > 0)) return false;
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function rectangleContainsPoint(rectangle, value) {
  return isRecord(rectangle) && isRecord(value)
    && [rectangle.x, rectangle.y, rectangle.width, rectangle.height, value.x, value.y].every(Number.isFinite)
    && value.x >= rectangle.x && value.x <= rectangle.x + rectangle.width
    && value.y >= rectangle.y && value.y <= rectangle.y + rectangle.height;
}

function placeEntrancePoint(anchor, footprint, facilityKind = null) {
  // Keep the well clue on the left front rim so the authored outdoor target
  // remains separate from the resident and from the neighbouring dock.
  const x = facilityKind === 'well' ? footprint.x - 2 : anchor.x;
  return point(x, footprint.y + footprint.height + 1);
}

function approachReservation(anchor, size, routeWidth = 3, facilityKind = null) {
  const footprint = rectangleAround(anchor, size);
  const entrance = placeEntrancePoint(anchor, footprint, facilityKind);
  const outer = point(entrance.x, entrance.y + AUTHORED_APPROACH_LENGTH);
  return {
    from: outer,
    to: entrance,
    width: routeWidth,
    rectangle: routeSegmentRect(outer, entrance, routeWidth),
  };
}

function makePlaceGeometry(anchor, footprint, facilityKind, needsCutaway, transition) {
  const entranceWidth = 3;
  const entrance = placeEntrancePoint(anchor, footprint, facilityKind);
  const approach = [point(entrance.x, entrance.y + AUTHORED_APPROACH_LENGTH), entrance];
  const interiorFootprint = expandRectangle(footprint, -2);
  const doorway = {
    x: round(entrance.x - entranceWidth / 2),
    y: interiorFootprint.y,
    width: entranceWidth,
    height: round(footprint.y + footprint.height + 2 - interiorFootprint.y),
  };
  const interior = needsCutaway
    ? {
      kind: 'cutaway',
      footprint: interiorFootprint,
      entrance,
      exit: point(entrance.x, entrance.y + 1),
    }
    : { kind: 'open' };
  const reportState = facilityKind === 'town_hall'
    ? { transitionId: transition?.id ?? REPOSITORY_INSPECTION_TRANSITION_ID, before: 'unlit', after: 'lit' }
    : null;
  const accessRegion = needsCutaway
    ? doorway
    : facilityKind === 'gate'
      ? {
        // The gate is an outdoor threshold. Keep only its narrow opening
        // clear so the visual gate remains solid on both sides of the route.
        x: round(entrance.x - entranceWidth / 2),
        y: round(footprint.y + footprint.height - 2),
        width: entranceWidth,
        height: 4,
      }
      : expandRectangle(footprint, 2);
  return {
    entrance: { point: entrance, approach, width: entranceWidth, automatic: Boolean(facilityKind) },
    access: {
      region: accessRegion,
      reach: 2,
      automaticEntry: needsCutaway,
    },
    interior,
    occlusion: { roof: footprint, foreground: { ...footprint, y: round(footprint.y + footprint.height * 0.62), height: round(footprint.height * 0.38) }, reveal: facilityKind ? 'inside' : 'open' },
    reportState,
  };
}

function isSnowWorldview(worldview) {
  return worldview?.id === WORLDVIEWS.snowHarbor.id;
}

function appearanceForFacility(kind, worldview = WORLDVIEWS.lateMedieval) {
  if (isSnowWorldview(worldview)) return SNOW_FACILITY_APPEARANCES[kind] ?? null;
  return FACILITY_APPEARANCES[kind] ?? null;
}

function dwellingAppearanceForWorldview(appearance, worldview = WORLDVIEWS.lateMedieval) {
  if (isSnowWorldview(worldview) && appearance === 'dwelling-tall') return 'dwelling-stone';
  return appearance;
}

function sourceGroupsForFileIds(town, fileIds) {
  const sourceIds = new Set(uniqueSortedStrings(fileIds));
  return town.groups
    .filter((group) => group.fileIds.some((fileId) => sourceIds.has(fileId)))
    .map((group) => group.id)
    .sort(compareStrings);
}

function groupParentPath(groupPath) {
  if (groupPath === '.') return '.';
  const segments = String(groupPath ?? '').split('/').filter(Boolean);
  return segments.length > 1 ? segments.slice(0, -1).join('/') : '.';
}

function dominantGroupRole(group) {
  const roles = uniqueSortedStrings(group.roles);
  const entries = roles.map((role) => [role, Number.isFinite(group.roleMix?.[role]) ? group.roleMix[role] : 0]);
  entries.sort((left, right) => (right[1] - left[1])
    || (GROUP_ROLE_ORDER.indexOf(left[0]) - GROUP_ROLE_ORDER.indexOf(right[0]))
    || compareStrings(left[0], right[0]));
  return entries[0]?.[0] ?? 'module';
}

function groupRoleFamily(group) {
  if (/(?:legacy|deprecated|archive|old|backup|migration)/iu.test(group.path)) return 'heritage';
  const dominant = dominantGroupRole(group);
  if (GROUP_ROLE_FAMILIES.work.includes(dominant)) return 'work';
  if (GROUP_ROLE_FAMILIES.living.includes(dominant)) return 'living';
  return 'civic';
}

function groupDistrict(group, districtIds, worldview = WORLDVIEWS.lateMedieval) {
  if (group.path === '.' && districtIds.has('arrival')
    && !['work', 'living'].includes(groupRoleFamily(group))) return 'arrival';
  const family = groupRoleFamily(group);
  if (family === 'heritage' && districtIds.has('heritage')) return 'heritage';
  if (districtIds.has(family)) return family;
  return districtIds.has('civic') ? 'civic' : [...districtIds][0];
}

function dwellingAppearance(group) {
  const family = groupRoleFamily(group);
  if (family === 'heritage') return 'dwelling-stone';
  switch (dominantGroupRole(group)) {
    case 'configuration':
    case 'test':
    case 'interface':
      return 'dwelling-tall';
    case 'data':
    case 'tooling':
      return 'dwelling-stone';
    case 'service':
    case 'module':
    default:
      return family === 'civic' ? 'dwelling-tall' : 'dwelling-gabled';
  }
}

function compoundDwellingAppearance(groups) {
  if (groups.some((group) => groupRoleFamily(group) === 'heritage')) return 'dwelling-stone';
  const roleMix = new Map();
  for (const group of groups) {
    for (const [role, value] of Object.entries(group.roleMix ?? {})) {
      roleMix.set(role, (roleMix.get(role) ?? 0) + value);
    }
  }
  const dominantRole = [...roleMix.entries()]
    .sort((left, right) => (right[1] - left[1])
      || (GROUP_ROLE_ORDER.indexOf(left[0]) - GROUP_ROLE_ORDER.indexOf(right[0]))
      || compareStrings(left[0], right[0]))[0]?.[0] ?? dominantGroupRole(groups[0]);
  switch (dominantRole) {
    case 'configuration':
    case 'test':
    case 'interface':
      return 'dwelling-tall';
    case 'data':
    case 'tooling':
      return 'dwelling-stone';
    case 'service':
    case 'module':
    default:
      return groupRoleFamily(groups[0]) === 'civic' ? 'dwelling-tall' : 'dwelling-gabled';
  }
}

function makeGroupHomeCompounds(town) {
  const groups = [...town.groups].sort((left, right) => {
    return compareStrings(groupParentPath(left.path), groupParentPath(right.path))
      || compareStrings(left.path, right.path)
      || compareStrings(left.id, right.id);
  });
  const compoundsByKey = new Map();
  for (const group of groups) {
    const parentPath = groupParentPath(group.path);
    const family = groupRoleFamily(group);
    const key = `${parentPath}\u001f${family}`;
    const compound = compoundsByKey.get(key) ?? {
      parentPath,
      family,
      groups: [],
    };
    compound.groups.push(group);
    compoundsByKey.set(key, compound);
  }
  return [...compoundsByKey.values()]
    .sort((left, right) => compareStrings(left.parentPath, right.parentPath)
      || compareStrings(left.family, right.family))
    .map((compound) => {
      const sourceGroupIds = compound.groups.map((group) => group.id).sort(compareStrings);
      return {
        id: `home.${encodeURIComponent(`${compound.parentPath}|${compound.family}`)}`,
        parentPath: compound.parentPath,
        family: compound.family,
        appearance: compoundDwellingAppearance(compound.groups),
        groups: compound.groups,
        sourceGroupIds,
        evidence: mergeEvidence(...compound.groups.map((group) => group.evidence)),
      };
    });
}

function commonCompoundParentPath(left, right) {
  const leftParts = left === '.' ? [] : String(left).split('/').filter(Boolean);
  const rightParts = right === '.' ? [] : String(right).split('/').filter(Boolean);
  const common = [];
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] !== rightParts[index]) break;
    common.push(leftParts[index]);
  }
  return common.join('/') || '.';
}

// A broad repository often has several meaningful groups beneath one common
// top-level directory.  The compact compound pass correctly treats that
// directory as one home, but doing so in the six-parcel broad town hides the
// repository's neighbourhood density.  Split only that broad input into
// group-caused parcels, then let the existing bounded merge reduce it to the
// six authored residence slots while preserving every source group.
function splitLateHomeCompounds(compounds) {
  return compounds.flatMap((compound) => compound.groups.map((group) => ({
    id: `home.${encodeURIComponent(`${group.path}|${compound.family}|${group.id}`)}`,
    parentPath: group.path,
    family: compound.family,
    appearance: compoundDwellingAppearance([group]),
    groups: [group],
    sourceGroupIds: [group.id],
    evidence: mergeEvidence(group.evidence),
  }))).sort((left, right) => compareStrings(left.parentPath, right.parentPath)
    || compareStrings(left.family, right.family)
    || compareStrings(left.id, right.id));
}

// A broad environment has six authored residence parcels. When a large
// repository has more visual compounds, merge only the closest two compounds
// in the same semantic family. All source groups and evidence survive; this
// changes visual aggregation, never repository truth or investigation state.
function boundedLateHomeCompounds(compounds, limit = 6) {
  const bounded = compounds.map((compound) => ({
    ...compound,
    groups: compound.groups.slice(),
    sourceGroupIds: compound.sourceGroupIds.slice(),
  }));
  while (bounded.length > limit) {
    const candidates = [];
    for (let leftIndex = 0; leftIndex < bounded.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bounded.length; rightIndex += 1) {
        const left = bounded[leftIndex];
        const right = bounded[rightIndex];
        if (left.family !== right.family) continue;
        const parentPath = commonCompoundParentPath(left.parentPath, right.parentPath);
        const depth = parentPath === '.' ? 0 : parentPath.split('/').length;
        candidates.push({ leftIndex, rightIndex, parentPath, depth, key: `${left.id}\u001f${right.id}` });
      }
    }
    candidates.sort((left, right) => right.depth - left.depth || compareStrings(left.key, right.key));
    const selected = candidates[0];
    if (!selected) throw new TypeError(`Broad late composition cannot truthfully aggregate ${bounded.length} residence compounds into ${limit} parcels`);
    const left = bounded[selected.leftIndex];
    const right = bounded[selected.rightIndex];
    const groups = [...left.groups, ...right.groups]
      .sort((first, second) => compareStrings(first.path, second.path) || compareStrings(first.id, second.id));
    const sourceGroupIds = uniqueSortedStrings([...left.sourceGroupIds, ...right.sourceGroupIds]);
    const family = left.family;
    const merged = {
      id: `home.${encodeURIComponent(`${selected.parentPath}|${family}|${sha256(sourceGroupIds.join('\u001f')).slice(0, 12)}`)}`,
      parentPath: selected.parentPath,
      family,
      appearance: compoundDwellingAppearance(groups),
      groups,
      sourceGroupIds,
      evidence: mergeEvidence(left.evidence, right.evidence),
    };
    bounded.splice(selected.rightIndex, 1);
    bounded.splice(selected.leftIndex, 1, merged);
    bounded.sort((first, second) => compareStrings(first.parentPath, second.parentPath)
      || compareStrings(first.family, second.family)
      || compareStrings(first.id, second.id));
  }
  return bounded;
}

function neighbourDwellingAppearance(town, item, previousAppearance) {
  const base = item.appearance;
  const pair = base === 'dwelling-stone'
    ? ['dwelling-stone', 'dwelling-gabled']
    : base === 'dwelling-gabled'
      ? ['dwelling-gabled', 'dwelling-stone']
      : null;
  if (!pair) return base;
  // The semantic role remains the preferred form.  A stable identity hash
  // gives each compound a repeatable first choice, then the neighbour rule
  // flips only when two adjacent homes would otherwise clone one another.
  const preferred = unitFromHash(
    hashParts(town.identity?.key ?? '', 'dwelling-style', item.id, item.parentPath, item.family),
  ) < 0.68 ? pair[0] : pair[1];
  if (previousAppearance !== preferred) return preferred;
  return preferred === pair[0] ? pair[1] : pair[0];
}

function applyNeighbourDwellingStyles(town, rows) {
  const residenceAppearances = new Map();
  for (const row of rows) {
    let previousAppearance = null;
    for (const item of row) {
      if (item.kind !== 'residence') {
        previousAppearance = null;
        continue;
      }
      item.appearance = neighbourDwellingAppearance(town, item, previousAppearance);
      previousAppearance = item.appearance;
      residenceAppearances.set(item.id, item.appearance);
    }
  }
  return residenceAppearances;
}

function firstOpenAnchor(
  preferred,
  size,
  occupied,
  bounds,
  districtId,
  approachReservations,
  routeWidth = 3,
  facilityKind = null,
) {
  if (!point(preferred)) throw new TypeError(`No authored anchor exists for ${districtId}${facilityKind ? ` (${facilityKind})` : ''}`);
  const footprint = rectangleAround(preferred, size);
  if (occupied.some((other) => rectanglesOverlap(footprint, other))) {
    throw new TypeError(`Authored ${districtId} frontage overlaps near ${preferred.x},${preferred.y}${facilityKind ? ` (${facilityKind})` : ''}`);
  }
  // The neighbourhood grammar owns parcel selection. This stage deliberately
  // does not search for a free cell: moving one place after composition makes
  // roads, facades, and repository meaning disagree. Bounds and approaches
  // are validated against the finished plan below.
  void bounds;
  void approachReservations;
  void routeWidth;
  return preferred;
}

function makePlaces(
  town,
  districts,
  identitySeed,
  grammar = makeAuthoredComposition(town),
  worldview = WORLDVIEWS.lateMedieval,
) {
  const districtById = new Map(districts.map((district) => [district.id, district]));
  const candidatesByKind = new Map(town.candidates.map((candidate) => [candidate.facilityKind, candidate]));
  const facilityByKind = new Map(town.facilities.map((facility) => [facility.kind, facility]));
  for (const coreKind of ['gate', 'town_hall']) {
    if (!facilityByKind.has(coreKind)) {
      facilityByKind.set(coreKind, {
        id: `facility.${coreKind}`,
        kind: coreKind,
        label: coreKind === 'gate' ? '門' : '役場',
        presence: 'unknown',
        condition: 'unconfirmed',
        sourceFileIds: [],
        evidence: evidenceBag(null, `facility.${coreKind}.unknown`),
        value: {},
      });
    }
  }
  for (const candidate of town.candidates) {
    if (!facilityByKind.has(candidate.facilityKind)) {
      facilityByKind.set(candidate.facilityKind, {
        id: `facility.${candidate.facilityKind}`,
        kind: candidate.facilityKind,
        label: candidate.facilityKind,
        presence: 'unknown',
        condition: 'unconfirmed',
        sourceFileIds: [],
        evidence: candidate.evidence,
        value: {},
      });
    }
  }

  const records = [];
  const occupied = [];
  const approachReservations = [];
  const facilityRecords = [...facilityByKind.values()]
    .filter((facility) => facility.kind === 'gate' || facility.kind === 'town_hall' || facility.presence !== 'not_applicable' || candidatesByKind.has(facility.kind))
    .sort((left, right) => {
      const coreOrder = { gate: 0, town_hall: 1 };
      return (coreOrder[left.kind] ?? 2) - (coreOrder[right.kind] ?? 2) || compareStrings(left.kind, right.kind);
    });
  const placeFacility = (facility) => {
    const district = districtForPlace(facility.kind);
    const districtRecord = districtById.get(district) ?? districtById.get('civic');
    const size = FACILITY_SIZE[facility.kind] ?? { width: 9, height: 7 };
    const authoredAnchor = grammar.anchors.get(placeIdForFacility(facility.kind));
    const preferred = authoredAnchor ?? (facility.kind === 'town_hall'
      ? point(districtRecord.anchor.x - 12, districtRecord.anchor.y)
      : point(districtRecord.anchor.x, districtRecord.anchor.y));
    const routeWidth = placeRouteWidth(facility.kind);
    const anchor = firstOpenAnchor(
      preferred,
      size,
      occupied,
      districtRecord.bounds,
      district,
      approachReservations,
      routeWidth,
      facility.kind,
    );
    const footprint = rectangleAround(anchor, size);
    occupied.push(footprint);
    approachReservations.push(approachReservation(anchor, size, routeWidth, facility.kind));
    // A threshold or a well is an outdoor place-specific discovery. Forcing
    // those clues into invented rooms made the journey less legible and made
    // unused interiors into an asset-production target. Enclosed facilities
    // keep a same-coordinate cutaway; open civic objects stay in the town.
    const needsCutaway = facility.kind === 'town_hall'
      || facility.kind === 'workshop'
      || (candidatesByKind.has(facility.kind) && ENCLOSED_INVESTIGATION_FACILITIES.has(facility.kind));
    records.push({
      id: `place.${facility.kind.replaceAll('_', '-')}`,
      recipe: facilityRecipe(facility.kind),
      district,
      anchor,
      footprint,
      facilityKind: facility.kind,
      appearance: appearanceForFacility(facility.kind, worldview),
      sourceGroupIds: sourceGroupsForFileIds(town, facility.sourceFileIds),
      label: facility.label,
      condition: facility.condition,
      evidence: facility.evidence,
      geometry: makePlaceGeometry(anchor, footprint, facility.kind, needsCutaway, town.transition),
      requirements: {
        connectToRoute: true,
        clearApproach: true,
        distinctInterior: needsCutaway,
        reportState: facility.kind === 'town_hall',
      },
    });
  };
  const coreFacilities = facilityRecords.filter((facility) => facility.kind === 'gate' || facility.kind === 'town_hall');
  for (const facility of coreFacilities) placeFacility(facility);

  const civicDistrict = districtById.get('civic');
  const plazaSize = CIVIC_PLAZA_SIZE;
  const authoredPlazaAnchor = grammar.anchors.get('place.civic-plaza');
  const plazaAnchor = firstOpenAnchor(
    authoredPlazaAnchor ?? point(civicDistrict.anchor.x + 12, civicDistrict.anchor.y + 8),
    plazaSize,
    occupied,
    civicDistrict.bounds,
    'civic',
    approachReservations,
    5,
  );
  const plazaFootprint = rectangleAround(plazaAnchor, plazaSize);
  occupied.push(plazaFootprint);
  approachReservations.push(approachReservation(plazaAnchor, plazaSize, 5));
  records.push({
    id: 'place.civic-plaza',
    recipe: 'civic_plaza',
    district: 'civic',
    anchor: plazaAnchor,
    footprint: plazaFootprint,
    appearance: null,
    sourceGroupIds: [],
    label: '広場',
    condition: 'active',
    evidence: mergeEvidence(civicDistrict.evidence, town.evidence),
    geometry: makePlaceGeometry(plazaAnchor, plazaFootprint, null, false, town.transition),
    requirements: { connectToRoute: true, clearApproach: true, distinctInterior: false, reportState: false },
  });
  const nonCoreFacilities = facilityRecords.filter((facility) => facility.kind !== 'gate' && facility.kind !== 'town_hall');
  for (const facility of nonCoreFacilities) placeFacility(facility);

  // A home represents one coherent sibling compound.  The compound keeps all
  // source groups and evidence, while related files share one visible place
  // instead of becoming a row of cloned houses.
  const districtIds = new Set(districts.map((district) => district.id));
  const gate = records.find((place) => place.facilityKind === 'gate');
  // Placement must consume the same bounded/split compound set that authored
  // the neighbourhood anchors. Re-deriving raw compounds here discards the
  // broad grammar's source-group parcels and sends those homes to unrelated
  // district centroids.
  const compounds = grammar.compounds ?? makeGroupHomeCompounds(town);
  const homeIndexByCluster = new Map();
  for (const compound of compounds) {
    const sourceGroupIds = [...compound.sourceGroupIds].sort(compareStrings);
    const sourceGroup = compound.groups[0];
    const district = groupDistrict(sourceGroup, districtIds, worldview);
    const districtRecord = districtById.get(district) ?? districtById.get('civic');
    const appearance = grammar.residenceAppearances?.get(placeIdForCompound(compound))
      ?? dwellingAppearanceForWorldview(compound.appearance, worldview);
    const size = groupHomeSize(appearance);
    const clusterKey = `${district}|${compound.parentPath}|${compound.family}`;
    const siblingIndex = homeIndexByCluster.get(clusterKey) ?? 0;
    homeIndexByCluster.set(clusterKey, siblingIndex + 1);
    const clusterSeed = hashParts(identitySeed, 'group-cluster', district, compound.parentPath);
    const clusterBase = point(
      districtRecord.anchor.x + signedOffset(hashParts(clusterSeed, 'x'), 2.5),
      districtRecord.anchor.y + signedOffset(hashParts(clusterSeed, 'y'), 2.5),
    );
    const siblingOffset = [
      { x: -2.5, y: -2.5 }, { x: 2.5, y: -2.5 }, { x: -2.5, y: 2.5 }, { x: 2.5, y: 2.5 },
    ][siblingIndex % 4];
    const base = sourceGroup.path === '.' && gate
      ? point(gate.anchor.x + 6, gate.anchor.y + 5)
      : clusterBase;
    const authoredHomeAnchor = grammar.anchors.get(placeIdForCompound(compound));
    const preferred = authoredHomeAnchor ?? point(base.x + siblingOffset.x, base.y + siblingOffset.y);
    const anchor = firstOpenAnchor(
      preferred,
      size,
      occupied,
      districtRecord.bounds,
      district,
      approachReservations,
      3,
    );
    const footprint = rectangleAround(anchor, size);
    occupied.push(footprint);
    approachReservations.push(approachReservation(anchor, size, 3));
    records.push({
      id: `place.${compound.id}`,
      recipe: 'residence',
      district,
      anchor,
      footprint,
      appearance,
      sourceGroupIds,
      label: compound.parentPath === '.' ? '門前の住まい' : `住居群・${compound.parentPath}`,
      condition: 'active',
      evidence: compound.evidence,
      geometry: makePlaceGeometry(anchor, footprint, null, false, town.transition),
      requirements: {
        connectToRoute: true,
        clearApproach: true,
        distinctInterior: false,
        reportState: false,
      },
    });
  }
  records.sort((left, right) => compareStrings(left.id, right.id));
  return records;
}

function deriveDistrictsFromPlaces(districts, places) {
  const placeEnvelope = (place) => {
    const footprint = expandRectangle(place.footprint, 1.5);
    const approach = place.geometry?.entrance?.approach ?? [];
    const routeWidth = placeRouteWidth(place.facilityKind, place.recipe);
    const rectangles = [footprint];
    for (let index = 1; index < approach.length; index += 1) {
      rectangles.push(routeSegmentRect(approach[index - 1], approach[index], routeWidth));
    }
    return {
      minX: Math.min(...rectangles.map((rectangle) => rectangle.x)),
      maxX: Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width)),
      minY: Math.min(...rectangles.map((rectangle) => rectangle.y)),
      maxY: Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height)),
    };
  };
  return districts.map((district) => {
    const rolePlaces = places.filter((place) => place.district === district.id);
    if (rolePlaces.length === 0) {
      throw new TypeError(`District ${district.id} has no placed structure envelope`);
    }
    const margin = 1;
    const envelopes = rolePlaces.map(placeEnvelope);
    const minX = Math.min(...envelopes.map((envelope) => envelope.minX)) - margin;
    const maxX = Math.max(...envelopes.map((envelope) => envelope.maxX)) + margin;
    const minY = Math.min(...envelopes.map((envelope) => envelope.minY)) - margin;
    const maxY = Math.max(...envelopes.map((envelope) => envelope.maxY)) + margin;
    const parcel = { minX: round(minX), maxX: round(maxX), minY: round(minY), maxY: round(maxY) };
    return {
      ...district,
      anchor: point((parcel.minX + parcel.maxX) / 2, (parcel.minY + parcel.maxY) / 2),
      bounds: parcel,
    };
  });
}

function routeSegmentRect(from, to, width) {
  const radius = width / 2;
  return {
    x: Math.min(from.x, to.x) - radius,
    y: Math.min(from.y, to.y) - radius,
    width: Math.abs(to.x - from.x) + width,
    height: Math.abs(to.y - from.y) + width,
  };
}

function simplifiedPath(points) {
  const unique = [];
  points.forEach((value) => addPoint(unique, value));
  return unique.filter((value, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const before = unique[index - 1];
    const after = unique[index + 1];
    return !((before.x === value.x && value.x === after.x) || (before.y === value.y && value.y === after.y));
  });
}

function pathClearsPlaces(points, width, places, endpointIds) {
  for (let index = 1; index < points.length; index += 1) {
    for (const place of places) {
      if (place.recipe === 'civic_plaza' || !place.appearance) continue;
      const testedWidth = endpointIds.has(place.id) ? 0 : width;
      if (rectanglesOverlap(routeSegmentRect(points[index - 1], points[index], testedWidth), place.footprint)) return false;
    }
  }
  return true;
}

function routeCenterline(fromPlace, toPlace, places, width, seed, bounds) {
  const from = fromPlace.geometry.entrance.point;
  const to = toPlace.geometry.entrance.point;
  const clearance = width / 2 + 1;
  const xValues = [
    round((from.x + to.x) / 2 + signedOffset(hashParts(seed, 'mid-x'), 3)),
    bounds.minX + clearance,
    bounds.maxX - clearance,
  ];
  const yValues = [
    round((from.y + to.y) / 2 + signedOffset(hashParts(seed, 'mid-y'), 3)),
    bounds.minY + clearance,
    bounds.maxY - clearance,
  ];
  for (const place of places.filter((entry) => entry.appearance && entry.recipe !== 'civic_plaza')) {
    xValues.push(place.footprint.x - clearance, place.footprint.x + place.footprint.width + clearance);
    yValues.push(place.footprint.y - clearance, place.footprint.y + place.footprint.height + clearance);
  }
  const boundedUnique = (values, minimum, maximum) => [...new Set(values
    .map((value) => round(clamp(value, minimum, maximum))))];
  const corridorsX = boundedUnique(xValues, bounds.minX + clearance, bounds.maxX - clearance);
  const corridorsY = boundedUnique(yValues, bounds.minY + clearance, bounds.maxY - clearance);
  const candidates = [
    ...corridorsX.map((x) => simplifiedPath([from, point(x, from.y), point(x, to.y), to])),
    ...corridorsY.map((y) => simplifiedPath([from, point(from.x, y), point(to.x, y), to])),
    // A single corridor coordinate is not enough when a route must first
    // pass below one authored row and then turn through the gap before its
    // destination row. Keep the search orthogonal and bounded by the same
    // authored clearances, but include both corridor dimensions so the path
    // can step out, cross, and approach the endpoint from a dry side.
    ...corridorsX.flatMap((x) => corridorsY.map((y) => simplifiedPath([
      from,
      point(from.x, y),
      point(x, y),
      point(x, to.y),
      to,
    ]))),
  ];
  const endpointIds = new Set([fromPlace.id, toPlace.id]);
  const clear = candidates.filter((candidate) => pathClearsPlaces(candidate, width, places, endpointIds));
  if (clear.length === 0) {
    const fallback = orthogonalClearPath(from, to, width, places, bounds, new Set([fromPlace.id, toPlace.id]));
    if (fallback && pathClearsPlaces(fallback, width, places, endpointIds)) return fallback;
    throw new TypeError(`No clear route corridor connects ${fromPlace.id} to ${toPlace.id}`);
  }
  const length = (points) => points.slice(1).reduce((total, value, index) => total
    + Math.abs(value.x - points[index].x) + Math.abs(value.y - points[index].y), 0);
  clear.sort((left, right) => length(left) - length(right)
    || left.length - right.length
    || compareStrings(hashParts(seed, stableStringify(left)), hashParts(seed, stableStringify(right))));
  return clear[0];
}

function orthogonalClearPath(from, to, width, places, bounds, endpointIds) {
  const start = point(Math.round(from.x), Math.round(from.y));
  const goal = point(Math.round(to.x), Math.round(to.y));
  const key = (value) => `${value.x},${value.y}`;
  const queue = [start];
  const parent = new Map([[key(start), null]]);
  const directions = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  ];
  const clearStep = (left, right) => {
    const segment = routeSegmentRect(left, right, width);
    return places.every((place) => place.recipe === 'civic_plaza' || !place.appearance || endpointIds.has(place.id) || !rectanglesOverlap(segment, place.footprint));
  };
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.x === goal.x && current.y === goal.y) break;
    for (const direction of directions) {
      const next = point(current.x + direction.x, current.y + direction.y);
      if (next.x < bounds.minX + 1 || next.x > bounds.maxX - 1 || next.y < bounds.minY + 1 || next.y > bounds.maxY - 1) continue;
      const nextKey = key(next);
      if (parent.has(nextKey) || !clearStep(current, next)) continue;
      parent.set(nextKey, current);
      queue.push(next);
    }
  }
  if (!parent.has(key(goal))) return null;
  const path = [];
  let cursor = goal;
  while (cursor) {
    path.push(cursor);
    cursor = parent.get(key(cursor));
  }
  return simplifiedPath(path.reverse());
}

function snowAuthoredRoute(fromPlace, toPlace, places) {
  const byFacility = new Map(places.filter((place) => place.facilityKind).map((place) => [place.facilityKind, place]));
  const workHome = places.find((place) => place.recipe === 'residence' && place.district === 'work');
  const livingHome = places.find((place) => place.recipe === 'residence' && place.district === 'living');
  const gate = byFacility.get('gate');
  const hall = byFacility.get('town_hall');
  const plaza = places.find((place) => place.id === 'place.civic-plaza');
  const warehouse = byFacility.get('warehouse');
  const workshop = byFacility.get('workshop');
  const well = byFacility.get('well');
  const dock = byFacility.get('dock');
  const key = [fromPlace.id, toPlace.id].sort(compareStrings).join('|');
  const entrance = (place) => place?.geometry?.entrance?.point ?? place?.anchor;
  const gateEntry = entrance(gate);
  const hallEntry = entrance(hall);
  const plazaEntry = entrance(plaza);
  const workEntry = entrance(workHome);
  const livingEntry = entrance(livingHome);
  const warehouseEntry = entrance(warehouse);
  const workshopEntry = entrance(workshop);
  const wellEntry = entrance(well);
  const coordinate = (value) => value ?? point(0, 0);
  const dockEntry = entrance(dock);
  const pair = (left, right, points) => {
    if (!left || !right || key !== [left.id, right.id].sort(compareStrings).join('|')) return null;
    return points;
  };
  return pair(gate, hall, simplifiedPath([
    // Turn inward before the living shoulder. A straight horizontal stroke
    // to the hall would make its wide main-road cap enter the nearby well.
    coordinate(gateEntry),
    point(coordinate(gateEntry).x + 6, coordinate(gateEntry).y),
    point(coordinate(hallEntry).x - 4, coordinate(hallEntry).y),
    coordinate(hallEntry),
  ]))
    ?? pair(hall, plaza, simplifiedPath([
      coordinate(hallEntry), point(coordinate(plazaEntry).x, coordinate(hallEntry).y), coordinate(plazaEntry),
    ]))
    ?? pair(hall, workHome, [
      coordinate(hallEntry), point(coordinate(hallEntry).x, coordinate(workEntry).y), coordinate(workEntry),
    ])
    ?? pair(hall, livingHome, [
      coordinate(hallEntry), point(coordinate(hallEntry).x, coordinate(livingEntry).y), point(coordinate(livingEntry).x, coordinate(livingEntry).y), coordinate(livingEntry),
    ])
    ?? pair(hall, dock, [
      // Share the living/harbour lane, then meet the dock from its landward
      // lower edge. The dock porter can visibly walk on this same packed-snow
      // path instead of following an invisible vertical route behind the
      // building.
      coordinate(hallEntry),
      point(coordinate(plazaEntry).x, coordinate(hallEntry).y),
      point(coordinate(plazaEntry).x, coordinate(dockEntry).y),
      coordinate(dockEntry),
    ])
    ?? pair(workHome, warehouse, [
      coordinate(workEntry), point(coordinate(workEntry).x, coordinate(warehouseEntry).y), coordinate(warehouseEntry),
    ])
    ?? pair(warehouse, workshop, [
      coordinate(warehouseEntry), point(coordinate(workshopEntry).x, coordinate(warehouseEntry).y), coordinate(workshopEntry),
    ])
    ?? pair(livingHome, well, [
      coordinate(livingEntry), point(coordinate(wellEntry).x, coordinate(livingEntry).y), coordinate(wellEntry),
    ]);
}

function compactLateRoutePoints(fromPlace, toPlace, places) {
  if (!isCompactLateShape(places)) return null;
  const byFacility = new Map(places.filter((place) => place.facilityKind).map((place) => [place.facilityKind, place]));
  const gate = byFacility.get('gate');
  const hall = byFacility.get('town_hall');
  const warehouse = byFacility.get('warehouse');
  const workshop = byFacility.get('workshop');
  const well = byFacility.get('well');
  const plaza = places.find((place) => place.recipe === 'civic_plaza');
  const workHomes = places
    .filter((place) => place.recipe === 'residence' && place.district === 'work')
    .sort((left, right) => left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x || compareStrings(left.id, right.id));
  const livingHomes = places
    .filter((place) => place.recipe === 'residence' && place.district === 'living')
    .sort((left, right) => left.anchor.x - right.anchor.x || left.anchor.y - right.anchor.y || compareStrings(left.id, right.id));
  const entrance = (place) => place?.geometry?.entrance?.point ?? place?.anchor;
  const gateEntry = entrance(gate);
  const hallEntry = entrance(hall);
  const warehouseEntry = entrance(warehouse);
  const workshopEntry = entrance(workshop);
  const wellEntry = entrance(well);
  const plazaEntry = entrance(plaza);
  const workEntries = workHomes.map(entrance);
  const livingEntries = livingHomes.map(entrance);
  if ([gateEntry, hallEntry, warehouseEntry, workshopEntry, wellEntry, plazaEntry, ...workEntries, ...livingEntries].some((value) => !value)) return null;
  const pairKey = (left, right) => [left?.id, right?.id].sort(compareStrings).join('|');
  const requested = pairKey(fromPlace, toPlace);
  const route = (left, right, points) => pairKey(left, right) === requested ? points.map((value) => point(value.x, value.y)) : null;
  const northY = round(Math.max(warehouseEntry.y, hallEntry.y, workshopEntry.y) + 4);
  // The lower lane runs through the deepest authored threshold instead of
  // dropping below every home.  That keeps the route visibly attached to the
  // front doors and prevents a decorative empty strip from enlarging the
  // opening camera.
  const southY = round(Math.max(...livingEntries.map((value) => value.y)));
  // Keep the arrival leg west of the well, then turn under the north wall.
  // The extra corner is intentional: a diagonal bounding corridor must not
  // cut through the court's well footprint.
  const mainWest = point(hallEntry.x - 19, hallEntry.y + 4.5);
  const mainTurn = point(hallEntry.x - 4, hallEntry.y + 4.5);
  const plazaTurn = point(hallEntry.x, plazaEntry.y - 7);
  // The well entrance is on its left/front rim.  Keep the local road one
  // quiet unit above the well's top edge, then descend on the entrance's
  // narrow left corridor.  This keeps the three-unit road (half-width 1.5)
  // clear of both the well footprint and the first living home.
  const wellUpperShoulderY = round(well.footprint.y - 2.5);
  return route(gate, hall, [
    gateEntry,
    point(gateEntry.x + 7, gateEntry.y),
    mainWest,
    mainTurn,
    hallEntry,
  ])
    ?? route(hall, plaza, [
      hallEntry,
      plazaTurn,
      plazaEntry,
    ])
    ?? route(hall, well, [
      hallEntry,
      point(hallEntry.x, wellUpperShoulderY),
      point(wellEntry.x, wellUpperShoulderY),
      wellEntry,
    ])
    ?? route(hall, warehouse, [
      hallEntry,
      point(hallEntry.x, northY),
      point(warehouseEntry.x, northY),
      warehouseEntry,
    ])
    ?? route(warehouse, workshop, [
      warehouseEntry,
      point(warehouseEntry.x, northY),
      point(workshopEntry.x, northY),
      workshopEntry,
    ])
    ?? route(workshop, workHomes[0], [
      workshopEntry,
      point(workshopEntry.x, northY),
      point(workEntries[0].x, northY),
      workEntries[0],
    ])
    ?? workHomes.slice(0, -1).map((home, index) => {
      const left = workEntries[index];
      const right = workEntries[index + 1];
      // Join neighbouring east-frontage thresholds with one dry shoulder.
      // The prior fixed `next.y - 8` shelf sat above both doors after the
      // frontage was staggered, so a walking resident could be logically on
      // its route while visibly outside the compiled street.
      // Put the shared walking shoulder one body-height below the shallower
      // doorway.  A half-unit shelf made the next walking resident cross the
      // neighbour who is standing at that doorway, although both actors were
      // individually on valid street pixels.
      const shoulderY = round(Math.min(left.y, right.y) + 2);
      return route(home, workHomes[index + 1], [
        left,
        point(left.x, shoulderY),
        point(right.x, shoulderY),
        right,
      ]);
    }).find(Boolean)
    ?? route(well, livingHomes[0], [
      wellEntry,
      point(wellEntry.x, livingEntries[0].y - 7),
      point(livingEntries[0].x, livingEntries[0].y - 7),
      livingEntries[0],
    ])
    ?? livingHomes.slice(0, -1).map((home, index) => route(home, livingHomes[index + 1], [
      livingEntries[index],
      point(livingEntries[index].x, southY),
      point(livingEntries[index + 1].x, southY),
      livingEntries[index + 1],
    ])).find(Boolean)
    ?? null;
}

function lateAuthoredRoute(fromPlace, toPlace, places) {
  const compact = compactLateRoutePoints(fromPlace, toPlace, places);
  if (compact) return compact;
  const byId = new Map(places.map((place) => [place.id, place]));
  const gate = byId.get('place.gate');
  const hall = byId.get('place.town-hall');
  const plaza = byId.get('place.civic-plaza');
  const entrance = (place) => place?.geometry?.entrance?.point ?? place?.anchor;
  const gateEntry = entrance(gate);
  const hallEntry = entrance(hall);
  const plazaEntry = entrance(plaza);
  const key = [fromPlace?.id, toPlace?.id].sort(compareStrings).join('|');
  const pair = (left, right, points) => {
    if (!left || !right || key !== [left.id, right.id].sort(compareStrings).join('|')) return null;
    return points;
  };
  const commonCompactTown = Boolean(gate && hall && plaza)
    && places.filter((place) => place.recipe === 'residence' && place.district === 'work').length <= 3
    && places.every((place) => !place.facilityKind
      || ['gate', 'town_hall', 'warehouse', 'workshop', 'well'].includes(place.facilityKind));
  return pair(gate, hall, commonCompactTown ? [
    gateEntry,
    point(gateEntry.x + 5, gateEntry.y + 1),
    point(hallEntry.x - 4, hallEntry.y - 1),
    hallEntry,
  ] : [
    gateEntry,
    point(gateEntry.x, Math.max(gateEntry.y, hallEntry.y) + 2),
    point(hallEntry.x, Math.max(gateEntry.y, hallEntry.y) + 2),
    hallEntry,
  ]) ?? pair(hall, plaza, commonCompactTown ? [
    // Keep the civic spine on the upper shoulder, then drop straight into
    // the plaza. This leaves the well's lower footprint outside the route
    // envelope while preserving a single readable court approach.
    hallEntry,
    point(plazaEntry.x - 7, hallEntry.y),
    point(plazaEntry.x, hallEntry.y),
    plazaEntry,
  ] : [
    hallEntry,
    point(hallEntry.x + 4, hallEntry.y),
    point(hallEntry.x + 4, plazaEntry.y),
    plazaEntry,
  ]);
}

function makeRoutes(places, identitySeed, bounds, town, worldview = WORLDVIEWS.lateMedieval) {
  const placeById = new Map(places.map((placeRecord) => [placeRecord.id, placeRecord]));
  const gate = placeById.get('place.gate');
  const hall = placeById.get('place.town-hall');
  const plaza = placeById.get('place.civic-plaza');
  const routes = [];
  const seen = new Set();
  const connect = (fromPlace, toPlace, recipe, id) => {
    if (!fromPlace || !toPlace || fromPlace.id === toPlace.id) return;
    const key = [fromPlace.id, toPlace.id].sort(compareStrings).join('|');
    if (seen.has(key)) return;
    const authored = isSnowWorldview(worldview)
      ? snowAuthoredRoute(fromPlace, toPlace, places)
      : lateAuthoredRoute(fromPlace, toPlace, places);
    // The compact recipes are complete, fixed street compositions. Keep
    // their established core-street points so late/snow camera framing does
    // not drift. Every noncompact authored route, including a main route,
    // must pass the same footprint clearance check before it is accepted.
    const routeWidth = recipe === 'main' ? 5 : 3;
    const endpointIds = new Set([fromPlace.id, toPlace.id]);
    const authoredClear = authored && pathClearsPlaces(authored, routeWidth, places, endpointIds);
    const compactCoreStreet = authored && recipe === 'main'
      && (isCompactLateShape(places) || (isSnowWorldview(worldview) && isCompactSnowShape(places)))
      // Compact snow's fixed plaza apron meets the authored living shoulder
      // at the edge of its five-unit road. Keep that exact street only when
      // its structural footprints remain clear; home overlap is part of the
      // established packed composition and is not a facility collision.
      && pathClearsPlaces(authored, routeWidth, places.filter((place) => place.facilityKind), endpointIds);
    const centerline = authored && (authoredClear || compactCoreStreet)
      ? authored
      : routeCenterline(fromPlace, toPlace, places, routeWidth, hashParts(identitySeed, 'route', id), bounds);
    seen.add(key);
    routes.push({
      id,
      recipe,
      fromPlaceId: fromPlace.id,
      toPlaceId: toPlace.id,
      centerline,
      districtIds: uniqueSortedStrings([fromPlace.district, toPlace.district]),
    });
  };
  connect(gate, hall, 'main', 'route.main.arrival-civic');
  connect(hall, plaza, 'main', 'route.main.civic-plaza');
  if (!isSnowWorldview(worldview) && isCompactLateShape(places)) {
    // The compact town has one authored route tree. It is a U-shaped street
    // system, not a nearest-place graph: north frontage, east work lane,
    // centre court, and south living lane all keep their door aprons.
    const warehouse = placeById.get('place.warehouse');
    const workshop = placeById.get('place.workshop');
    const well = placeById.get('place.well');
    const workHomes = places
      .filter((place) => place.recipe === 'residence' && place.district === 'work')
      .sort((left, right) => left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x || compareStrings(left.id, right.id));
    const livingHomes = places
      .filter((place) => place.recipe === 'residence' && place.district === 'living')
      .sort((left, right) => left.anchor.x - right.anchor.x || left.anchor.y - right.anchor.y || compareStrings(left.id, right.id));
    connect(hall, well, 'local', 'route.local.district.living');
    connect(hall, warehouse, 'local', 'route.local.district.work');
    connect(warehouse, workshop, 'local', 'route.local.work.01');
    connect(workshop, workHomes[0], 'local', 'route.local.work.02');
    for (let index = 0; index < workHomes.length - 1; index += 1) {
      connect(workHomes[index], workHomes[index + 1], 'local', `route.local.work.${String(index + 3).padStart(2, '0')}`);
    }
    connect(well, livingHomes[0], 'local', 'route.local.living.01');
    for (let index = 0; index < livingHomes.length - 1; index += 1) {
      connect(livingHomes[index], livingHomes[index + 1], 'local', `route.local.living.${String(index + 2).padStart(2, '0')}`);
    }
    routes.sort((left, right) => compareStrings(left.id, right.id));
    return routes;
  }
  // Every group has exactly one home/compound representative.  Routes use
  // those representatives directly; no group is rotated through an unrelated
  // facility merely because it happens to share a district.
  const representativeByGroup = new Map();
  for (const place of places) {
    if (!Array.isArray(place.sourceGroupIds) || place.sourceGroupIds.length === 0) continue;
    if (place.facilityKind) continue;
    for (const groupId of place.sourceGroupIds) representativeByGroup.set(groupId, place);
  }
  const homes = [...new Set(representativeByGroup.values())].sort((left, right) => compareStrings(left.id, right.id));
  const districtHub = new Map();
  for (const district of [...new Set(places.map((place) => place.district))].sort(compareStrings)) {
    const districtPlaces = places
      .filter((place) => place.district === district && place.appearance)
      .sort((left, right) => {
        const leftDistance = Math.hypot(left.anchor.x - (hall ?? plaza ?? gate).anchor.x, left.anchor.y - (hall ?? plaza ?? gate).anchor.y);
        const rightDistance = Math.hypot(right.anchor.x - (hall ?? plaza ?? gate).anchor.x, right.anchor.y - (hall ?? plaza ?? gate).anchor.y);
        return leftDistance - rightDistance || compareStrings(left.id, right.id);
      });
    const hub = districtPlaces[0]
      ?? (district === 'civic' ? plaza : null)
      ?? hall
      ?? gate;
    if (hub) districtHub.set(district, hub);
  }
  // The hall is the civic street hinge.  Short vertical or stepped joins to
  // the top and bottom rows start here, while the plaza remains the final
  // main-route apron.
  const coreAnchor = hall ?? plaza ?? gate;
  if (!coreAnchor) throw new TypeError('The route graph has no civic anchor');
  let localIndex = 1;
  for (const [district, hub] of [...districtHub.entries()].sort(([left], [right]) => compareStrings(left, right))) {
    if (!hub || hub.id === gate?.id || hub.id === hall?.id || hub.id === plaza?.id) continue;
    connect(coreAnchor, hub, 'local', `route.local.district.${district}`);
  }
  // Internal relationships shape which nearby home joins the local tree. The
  // relation is intentionally not painted as a dedicated road: short branches
  // and shared trunks carry meaning without repository-wide spaghetti.
  const homeByGroup = new Map();
  for (const home of homes) for (const groupId of home.sourceGroupIds) homeByGroup.set(groupId, home);
  const relationNeighbors = new Map(homes.map((home) => [home.id, new Set()]));
  for (const connection of town.connections
    .filter((entry) => entry.direction === 'internal')
    .sort((left, right) => compareStrings(left.id, right.id))) {
    const relatedHomes = [...new Map(connection.groupIds
      .map((groupId) => [homeByGroup.get(groupId)?.id, homeByGroup.get(groupId)])
      .filter(([id, home]) => id && home)).values()]
      .sort((left, right) => compareStrings(left.id, right.id));
    if (relatedHomes.length < 2) continue;
    for (const left of relatedHomes) {
      for (const right of relatedHomes) {
        if (left.id === right.id) continue;
        relationNeighbors.get(left.id)?.add(right.id);
      }
    }
  }
  const parentPathsByHome = new Map();
  for (const home of homes) {
    const sourceGroup = home.sourceGroupIds
      .map((groupId) => town.groups.find((group) => group.id === groupId))
      .find(Boolean);
    parentPathsByHome.set(home.id, sourceGroup ? groupParentPath(sourceGroup.path) : '');
  }
  const districtMembers = new Map();
  for (const district of districtHub.keys()) {
    const hub = districtHub.get(district);
    const members = places
      .filter((place) => place.district === district && place.appearance && place.id !== hub?.id)
      .sort((left, right) => {
        const leftHome = left.recipe === 'residence' ? 0 : 1;
        const rightHome = right.recipe === 'residence' ? 0 : 1;
        return leftHome - rightHome || compareStrings(left.id, right.id);
      });
    districtMembers.set(district, members);
  }
  for (const [district, members] of [...districtMembers.entries()].sort(([left], [right]) => compareStrings(left, right))) {
    const hub = districtHub.get(district);
    if (!hub) throw new TypeError(`District ${district} has no route hub`);
    const connected = new Set([hub.id]);
    const remaining = new Set(members.map((place) => place.id));
    while (remaining.size > 0) {
      const connectedPlaces = places.filter((place) => connected.has(place.id));
      const candidates = members
        .filter((place) => remaining.has(place.id))
        .map((place) => {
          const nearest = connectedPlaces
            .slice()
            .sort((left, right) => Math.hypot(left.anchor.x - place.anchor.x, left.anchor.y - place.anchor.y)
              - Math.hypot(right.anchor.x - place.anchor.x, right.anchor.y - place.anchor.y)
              || compareStrings(left.id, right.id))[0] ?? hub;
          const nearestDistance = Math.hypot(nearest.anchor.x - place.anchor.x, nearest.anchor.y - place.anchor.y);
          const localDistanceLimit = nearestDistance * 1.2;
          const relatedTarget = [...(relationNeighbors.get(place.id) ?? [])]
            .map((placeId) => connectedPlaces.find((entry) => entry.id === placeId))
            .filter(Boolean)
            .slice()
            .sort((left, right) => Math.hypot(left.anchor.x - place.anchor.x, left.anchor.y - place.anchor.y)
              - Math.hypot(right.anchor.x - place.anchor.x, right.anchor.y - place.anchor.y)
              || compareStrings(left.id, right.id))
            .find((entry) => Math.hypot(entry.anchor.x - place.anchor.x, entry.anchor.y - place.anchor.y) <= localDistanceLimit);
          const parentPath = parentPathsByHome.get(place.id);
          const sibling = parentPath
            ? connectedPlaces
              .filter((entry) => parentPathsByHome.get(entry.id) === parentPath)
              .sort((left, right) => Math.hypot(left.anchor.x - place.anchor.x, left.anchor.y - place.anchor.y)
                - Math.hypot(right.anchor.x - place.anchor.x, right.anchor.y - place.anchor.y)
                || compareStrings(left.id, right.id))
              .find((entry) => Math.hypot(entry.anchor.x - place.anchor.x, entry.anchor.y - place.anchor.y) <= localDistanceLimit)
            : null;
          const target = relatedTarget ?? sibling ?? nearest;
          return {
            place,
            target,
            relationRank: relatedTarget && target.id === relatedTarget.id ? 0 : sibling ? 1 : 2,
            distance: Math.hypot(target.anchor.x - place.anchor.x, target.anchor.y - place.anchor.y),
          };
        })
        .sort((left, right) => left.relationRank - right.relationRank
          || left.distance - right.distance
          || compareStrings(left.place.id, right.place.id));
      const selected = candidates[0];
      if (!selected) throw new TypeError(`District ${district} cannot grow a local route tree`);
      connect(selected.target, selected.place, 'local', `route.local.${district}.${String(localIndex).padStart(2, '0')}`);
      localIndex += 1;
      connected.add(selected.place.id);
      remaining.delete(selected.place.id);
    }
  }
  // District hubs already connect every authored neighbourhood to the civic
  // hinge. A second cross-district trunk creates long loops across quiet
  // ground and makes the route surface read like a diagram. Relationships
  // still choose local neighbours inside their authored district.
  routes.sort((left, right) => compareStrings(left.id, right.id));
  return routes;
}

function distancePointToSegment(value, from, to) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(value.x - from.x, value.y - from.y);
  const progress = clamp(((value.x - from.x) * deltaX + (value.y - from.y) * deltaY) / lengthSquared, 0, 1);
  return Math.hypot(value.x - (from.x + deltaX * progress), value.y - (from.y + deltaY * progress));
}

function distancePointToPath(value, points) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distancePointToSegment(value, points[index - 1], points[index]));
  }
  return distance;
}

function sampledPath(points, spacing = 0.25) {
  const samples = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
      const progress = step / steps;
      addPoint(samples, point(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress));
    }
  }
  return samples;
}

function routeSectionsInsideSurface(routePoints, surfacePoints, surfaceWidth) {
  const runs = [];
  let current = [];
  const flush = () => {
    const crossing = simplifiedPath(current);
    if (crossing.length >= 2) runs.push(crossing);
    current = [];
  };
  for (const value of sampledPath(routePoints)) {
    if (distancePointToPath(value, surfacePoints) <= surfaceWidth / 2 + 1) {
      addPoint(current, value);
    } else if (current.length > 0) {
      flush();
    }
  }
  if (current.length > 0) flush();
  return runs;
}

function axisSegment(from, to) {
  const horizontal = Math.abs(from.y - to.y) <= 0.05;
  const vertical = Math.abs(from.x - to.x) <= 0.05;
  if (!horizontal && !vertical) return null;
  return {
    axis: horizontal ? 'x' : 'y',
    line: horizontal ? from.y : from.x,
    start: horizontal ? from.x : from.y,
    end: horizontal ? to.x : to.y,
  };
}

function localRoutePieces(points, coveredSegments) {
  const pieces = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const local = axisSegment(from, to);
    if (!local || local.start === local.end) continue;
    const covered = [];
    for (const main of coveredSegments) {
      if (main.axis !== local.axis || Math.abs(main.line - local.line) > 0.05) continue;
      const overlapStart = Math.max(Math.min(local.start, local.end), Math.min(main.start, main.end));
      const overlapEnd = Math.min(Math.max(local.start, local.end), Math.max(main.start, main.end));
      if (overlapEnd - overlapStart <= 0.05) continue;
      const first = clamp((overlapStart - local.start) / (local.end - local.start), 0, 1);
      const second = clamp((overlapEnd - local.start) / (local.end - local.start), 0, 1);
      covered.push({ start: Math.min(first, second), end: Math.max(first, second) });
    }
    covered.sort((left, right) => left.start - right.start || left.end - right.end);
    let cursor = 0;
    for (const interval of covered) {
      if (interval.start > cursor + 0.01) {
        const fromProgress = cursor;
        const toProgress = interval.start;
        pieces.push([
          point(from.x + (to.x - from.x) * fromProgress, from.y + (to.y - from.y) * fromProgress),
          point(from.x + (to.x - from.x) * toProgress, from.y + (to.y - from.y) * toProgress),
        ]);
      }
      cursor = Math.max(cursor, interval.end);
      if (cursor >= 1) break;
    }
    if (cursor < 1 - 0.01) {
      pieces.push([
        point(from.x + (to.x - from.x) * cursor, from.y + (to.y - from.y) * cursor),
        point(from.x + (to.x - from.x) * 1, from.y + (to.y - from.y) * 1),
      ]);
    }
  }
  return pieces.filter(([from, to]) => Math.hypot(to.x - from.x, to.y - from.y) > 0.05);
}

function makeSurfaces(bounds, districts, places, routes, identitySeed, worldview = WORLDVIEWS.lateMedieval) {
  const dock = places.find((place) => place.facilityKind === 'dock');
  const broadLate = !isSnowWorldview(worldview) && isBroadLateShape(places);
  // Snow harbour water is an edge feature. Keep it beside the dock instead of
  // turning the whole lower district into an L-shaped water ribbon. The
  // shoreline is a short, top-facing inlet. Its width stays below the dock
  // approach so the dock remains on land and the water does not swallow the
  // route or the neighboring living lane.
  const snowHarbourWaterWidth = 6;
  const broadLateWaterWidth = 6;
  const waterPoints = dock
    ? isSnowWorldview(worldview)
      ? (() => {
        const waterY = clamp(
          dock.geometry.entrance.point.y + 2,
          bounds.minY + 8,
          bounds.maxY - snowHarbourWaterWidth / 2 - 1,
        );
        // Start the cove inland of the dock so the water sits under its
        // shoreline edge and continues out of the scene. This gives the dock
        // a real harbour edge instead of a detached blue card.
        const inletX = clamp(dock.geometry.entrance.point.x - 4, bounds.minX + 8, bounds.maxX - 8);
        return [
          point(inletX, waterY),
          // Let the inlet open toward the lower-right world edge. The slight
          // diagonal carries both water edges out of frame, so the cove no
          // longer ends as an exposed rectangular card inside the snowfield.
          point(bounds.maxX - 2, waterY + 1.5),
        ];
      })()
      : broadLate
        ? [
          // The broad late town ends at a compact southeast quay. Keep the
          // blocked water below the dock and optional waterside home instead
          // of sending a river ribbon beneath the warehouse and civic lane.
          point(dock.geometry.entrance.point.x, bounds.maxY - broadLateWaterWidth / 2),
          point(bounds.maxX - 2, bounds.maxY - broadLateWaterWidth / 2),
        ]
        : [
        point(
          clamp(dock.geometry.entrance.point.x - 10, bounds.minX + 4, bounds.maxX - 20),
          clamp(dock.geometry.entrance.point.y, bounds.minY + 7, bounds.maxY - 7),
        ),
        point(
          clamp(dock.geometry.entrance.point.x + 4, bounds.minX + 8, bounds.maxX - 12),
          clamp(dock.geometry.entrance.point.y, bounds.minY + 7, bounds.maxY - 7)
            + signedOffset(hashParts(identitySeed, 'water', 'middle'), 0.8),
        ),
        point(
          bounds.maxX - 2,
          clamp(dock.geometry.entrance.point.y, bounds.minY + 7, bounds.maxY - 7)
            + signedOffset(hashParts(identitySeed, 'water', 'edge'), 1.1),
        ),
      ]
    : null;
  const crossings = [];
  const crossingSegmentsByRoute = new Map();
  if (waterPoints) {
    for (const route of routes) {
      const snowDockRoute = isSnowWorldview(worldview)
        && (route.fromPlaceId === dock.id || route.toPlaceId === dock.id);
      // The snow harbour is a short cove with a tapered inland cap. A broad
      // distance-to-path sample includes the land beside that cap and turns
      // the dock approach into a long plank slab. Keep the road on land, then
      // author only the cove edge-to-entrance continuation as the crossing.
      const sections = snowDockRoute
        ? [[point(waterPoints[0].x, dock.geometry.entrance.point.y), dock.geometry.entrance.point]]
        : routeSectionsInsideSurface(
          route.centerline,
          waterPoints,
          isSnowWorldview(worldview) ? snowHarbourWaterWidth : broadLate ? broadLateWaterWidth : 8,
        );
      const segments = sections.flatMap((section) => section
        .slice(1)
        .map((entry, index) => axisSegment(section[index], entry))
        .filter(Boolean));
      if (segments.length > 0) crossingSegmentsByRoute.set(route.id, segments);
      for (const [sectionIndex, points] of sections.entries()) crossings.push({ route, sectionIndex, points });
    }
  }
  const acceptedSegments = [];
  const routeSurfaceGroups = new Map();
  const orderedRoutes = [...routes].sort((left, right) => {
    const recipeOrder = (left.recipe === 'main' ? 0 : 1) - (right.recipe === 'main' ? 0 : 1);
    return recipeOrder || compareStrings(left.id, right.id);
  });
  for (const route of orderedRoutes) {
    const crossingSegments = crossingSegmentsByRoute.get(route.id) ?? [];
    const pieces = route.recipe === 'local'
      ? localRoutePieces(route.centerline, [...acceptedSegments, ...crossingSegments])
      : crossingSegments.length > 0
        ? localRoutePieces(route.centerline, crossingSegments)
      : [route.centerline];
    pieces.forEach((centerline, pieceIndex) => {
      if (!Array.isArray(centerline) || centerline.length < 2) return;
      const forward = stableStringify(centerline);
      const reverse = stableStringify([...centerline].reverse());
      const geometryKey = `${route.recipe}|${forward < reverse ? forward : reverse}`;
      const current = routeSurfaceGroups.get(geometryKey) ?? {
        id: `surface.${route.id}${pieces.length > 1 ? `.piece.${pieceIndex}` : ''}`,
        recipe: route.recipe === 'main' ? 'main_route' : 'local_route',
        district: route.districtIds[0] ?? 'civic',
        geometry: { kind: 'path', points: centerline, width: route.recipe === 'main' ? 5 : 3 },
        links: { placeIds: [], routeIds: [], districtIds: [] },
      };
      current.links.placeIds.push(route.fromPlaceId, route.toPlaceId);
      current.links.routeIds.push(route.id);
      current.links.districtIds.push(...route.districtIds);
      routeSurfaceGroups.set(geometryKey, current);
      for (let index = 1; index < centerline.length; index += 1) {
        const segment = axisSegment(centerline[index - 1], centerline[index]);
        if (segment) acceptedSegments.push(segment);
      }
    });
  }
  const routeSurfaces = [...routeSurfaceGroups.values()].map((surface) => ({
    ...surface,
    links: {
      placeIds: uniqueSortedStrings(surface.links.placeIds),
      routeIds: uniqueSortedStrings(surface.links.routeIds),
      districtIds: uniqueSortedStrings(surface.links.districtIds),
    },
  }));
  const ground = [{
    id: 'surface.ground.world',
    recipe: 'ground',
    district: 'civic',
    geometry: { kind: 'area', bounds },
    links: {
      placeIds: places.map((place) => place.id).sort(compareStrings),
      routeIds: routes.map((route) => route.id).sort(compareStrings),
      districtIds: districts.map((district) => district.id).sort(compareStrings),
    },
  }];
  const civicPlaza = places.find((place) => place.id === 'place.civic-plaza');
  const civicHall = places.find((place) => place.facilityKind === 'town_hall');
  const civicWell = places.find((place) => place.facilityKind === 'well');
  const compactCivicCourt = civicPlaza && civicHall && civicWell
    && places.every((place) => !place.facilityKind
      || ['gate', 'town_hall', 'warehouse', 'workshop', 'well', 'dock'].includes(place.facilityKind));
  const compactTown = Boolean(compactCivicCourt)
    && places.filter((place) => place.recipe === 'residence').length <= (isSnowWorldview(worldview) ? 2 : 6);
  const compactStreetBeds = compactTown
    ? (() => {
      const gate = places.find((place) => place.facilityKind === 'gate');
      const warehouse = places.find((place) => place.facilityKind === 'warehouse');
      const workshop = places.find((place) => place.facilityKind === 'workshop');
      const workHomes = places
        .filter((place) => place.recipe === 'residence' && place.district === 'work')
        // Match compactLateRoutePoints exactly.  The east frontage is a
        // vertical, staggered street: sorting it left-to-right silently
        // skipped the middle home's route when the same logical routes were
        // assembled into the visual backplate.
        .sort((left, right) => left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x || compareStrings(left.id, right.id));
      const livingHomes = places
        .filter((place) => place.recipe === 'residence' && place.district === 'living')
        .sort((left, right) => left.anchor.x - right.anchor.x || left.anchor.y - right.anchor.y || compareStrings(left.id, right.id));
      const dockPlace = places.find((place) => place.facilityKind === 'dock');
      const pointOf = (place) => place?.geometry?.entrance?.point ?? null;
      const uniquePoints = (values) => values.filter(Boolean).filter((value, index, all) => (
        index === 0 || value.x !== all[index - 1].x || value.y !== all[index - 1].y
      ));
      const linkValues = (linkedPlaces, routeIds, district) => ({
        placeIds: uniqueSortedStrings(linkedPlaces.filter(Boolean).map((place) => place.id)),
        routeIds: uniqueSortedStrings(routeIds),
        districtIds: uniqueSortedStrings([district, 'civic']),
      });
      const makeSpine = (id, recipe, district, values, width, linkedPlaces, routeIds = []) => {
        const points = uniquePoints(values);
        // A district with no authored neighbour does not need a decorative
        // one-point road. Emitting that degenerate path made small, truthful
        // repositories fail the surface contract before the browser opened.
        if (points.length < 2) return null;
        return {
          id,
          recipe,
          district,
          geometry: { kind: 'path', points, width },
          links: linkValues(linkedPlaces, routeIds, district),
        };
      };
      const compactLate = !isSnowWorldview(worldview) && isCompactLateShape(places);
      if (compactLate) {
        // These roads are the same authored shapes used by makeRoutes. The
        // world therefore has one canonical north/east/south street grammar,
        // with short door aprons instead of a second decorative road layer.
        const compactPointOf = (place) => place?.geometry?.entrance?.point ?? place?.anchor ?? null;
        const hall = places.find((place) => place.facilityKind === 'town_hall');
        const well = places.find((place) => place.facilityKind === 'well');
        const plaza = places.find((place) => place.recipe === 'civic_plaza');
        const pairRouteIds = (pairs) => routes
          .filter((route) => pairs.some(([left, right]) => route.fromPlaceId === left?.id && route.toPlaceId === right?.id
            || route.fromPlaceId === right?.id && route.toPlaceId === left?.id))
          .map((route) => route.id);
        const joinPaths = (...paths) => {
          const joined = [];
          for (const path of paths) {
            for (const value of path ?? []) {
              if (!value) continue;
              addPoint(joined, value);
            }
          }
          return joined;
        };
        const pairPath = (left, right) => compactLateRoutePoints(left, right, places) ?? [];
        const gateHall = pairPath(gate, hall);
        const hallPlaza = pairPath(hall, plaza);
        const hallWell = pairPath(hall, well);
        const hallWarehouse = pairPath(hall, warehouse);
        const warehouseWorkshop = pairPath(warehouse, workshop);
        const workshopHome = pairPath(workshop, workHomes[0]);
        const workHomePairs = workHomes.slice(0, -1).map((home, index) => [home, workHomes[index + 1]]);
        const workHomePaths = workHomePairs.map(([left, right]) => pairPath(left, right));
        const wellHome = pairPath(well, livingHomes[0]);
        const livingHomePairs = livingHomes.slice(0, -1).map((home, index) => [home, livingHomes[index + 1]]);
        const livingHomePaths = livingHomePairs.map(([left, right]) => pairPath(left, right));
        const northY = round(Math.max(
          compactPointOf(warehouse).y,
          compactPointOf(hall).y,
          compactPointOf(workshop).y,
        ) + 4);
        const hallApron = [compactPointOf(hall), point(compactPointOf(hall).x, northY)];
        // Paint the same upper/left detour as the hall->well logical route.
        // Starting at the plaza's right shoulder keeps the court road clear
        // of the well and the first living-home footprint before it drops
        // down the narrow corridor to the authored entrance.
        const wellUpperShoulderY = round(well.footprint.y - 2.5);
        const plazaWell = [
          compactPointOf(plaza),
          point(compactPointOf(plaza).x, wellUpperShoulderY),
          point(compactPointOf(well).x, wellUpperShoulderY),
          compactPointOf(well),
        ];
        const northPairs = [[hall, warehouse], [warehouse, workshop]];
        const eastPairs = [[workshop, workHomes[0]], ...workHomePairs];
        const southPairs = [[well, livingHomes[0]], ...livingHomePairs];
        return [
          makeSpine(
            'surface.precinct.civic',
            'main_route',
            'civic',
            joinPaths(gateHall, hallPlaza),
            5,
            [gate, hall, plaza],
            pairRouteIds([[gate, hall], [hall, plaza]]),
          ),
          makeSpine(
            'surface.precinct.court',
            'local_route',
            'living',
            plazaWell,
            3,
            [plaza, well],
            pairRouteIds([[hall, well]]),
          ),
          makeSpine(
            'surface.precinct.north',
            'local_route',
            'work',
            warehouseWorkshop,
            3,
            [warehouse, workshop],
            pairRouteIds([[warehouse, workshop]]),
          ),
          makeSpine(
            'surface.precinct.north.apron.hall',
            'local_route',
            'civic',
            hallApron,
            3,
            [hall, warehouse],
            pairRouteIds([[hall, warehouse]]),
          ),
          makeSpine(
            'surface.precinct.east',
            'local_route',
            'work',
            joinPaths(workshopHome, ...workHomePaths),
            3,
            [workshop, ...workHomes],
            pairRouteIds(eastPairs),
          ),
          makeSpine(
            'surface.precinct.south',
            'local_route',
            'living',
            joinPaths(wellHome, ...livingHomePaths),
            3,
            [well, ...livingHomes],
            pairRouteIds(southPairs),
          ),
        ].filter(Boolean);
      }
      const mainRouteIds = routes.filter((route) => route.recipe === 'main').map((route) => route.id);
      const workRouteIds = routes.filter((route) => route.districtIds.includes('work')).map((route) => route.id);
      const livingRouteIds = routes.filter((route) => route.districtIds.includes('living')).map((route) => route.id);
      const watersideRouteIds = routes.filter((route) => route.districtIds.includes('waterside')).map((route) => route.id);
      const hallEntry = pointOf(civicHall);
      const plazaEntry = pointOf(civicPlaza);
      const gateEntry = pointOf(gate);
      const warehouseEntry = pointOf(warehouse);
      const workshopEntry = pointOf(workshop);
      const wellEntry = pointOf(civicWell);
      const workHomeEntries = workHomes.map(pointOf);
      const livingHomeEntries = livingHomes.map(pointOf);
      const snow = isSnowWorldview(worldview);
      const surfaces = [
        // One readable arrival-to-civic spine replaces the old route tubes.
        makeSpine(
          'surface.precinct.civic',
          'main_route',
          'civic',
          snow
            ? [gateEntry, point(13, 32), hallEntry, point(26, 27), plazaEntry]
            : [gateEntry, point(12, 32), point(17, 28), hallEntry, point(27, 26), plazaEntry],
          5,
          [gate, civicHall, civicPlaza],
          mainRouteIds,
        ),
        // Work court/lane: a narrow L-shaped spine touches both facilities
        // and the work homes without filling their whole district.
        makeSpine(
          'surface.precinct.work.north',
          'local_route',
          'work',
          snow
            ? [
              plazaEntry,
              point(40, 32),
              workHomeEntries[0],
              point(workHomeEntries[0]?.x ?? 47, 22),
              workshopEntry,
              warehouseEntry,
            ]
            : [plazaEntry, point(40, 29.5), workshopEntry, warehouseEntry],
          3,
          [civicPlaza, warehouse, workshop, ...workHomes],
          workRouteIds,
        ),
        ...((!snow && workHomeEntries.length > 0) ? [makeSpine(
          'surface.precinct.work.east',
          'local_route',
          'work',
          workHomeEntries.length > 1
            ? [workHomeEntries[0], point(workHomeEntries[0].x, workHomeEntries[1].y), ...workHomeEntries.slice(1)]
            : workHomeEntries,
          3,
          [workshop, ...workHomes],
          workRouteIds,
        )] : []),
        // Living lane and its well connector stay separate so a branch does
        // not retrace through the home lane as a giant painted card.
        makeSpine(
          'surface.precinct.living.connector',
          'local_route',
          'living',
          snow
            ? [plazaEntry, point(31, 40), point(wellEntry?.x ?? 27, 40), wellEntry]
            : [
              wellEntry,
              point(wellEntry?.x ?? 25, 40),
              point(livingHomeEntries[0]?.x ?? wellEntry?.x ?? 25, 40),
              livingHomeEntries[0],
            ],
          3,
          [civicPlaza, civicWell],
          livingRouteIds,
        ),
        makeSpine(
          'surface.precinct.living.lane',
          'local_route',
          'living',
          snow
            ? [wellEntry, point(31, 40.5), pointOf(livingHomes[0])]
            : livingHomeEntries.length > 0 ? livingHomeEntries : [wellEntry],
          3,
          [civicWell, ...livingHomes],
          livingRouteIds,
        ),
      ];
      // In the snow worldview the living lane ends at the harbour edge. The
      // water/bank/crossing surfaces remain the authored harbour treatment.
      if (snow && dockPlace) surfaces.push(makeSpine(
        'surface.precinct.harbor.edge',
        'local_route',
        'waterside',
        [pointOf(livingHomes[0]), pointOf(dockPlace)],
        3,
        [dockPlace, ...livingHomes],
        watersideRouteIds,
      ));
      return surfaces.filter(Boolean);
    })()
    : [];
  const civicCourtBounds = compactCivicCourt
    ? {
      minX: round(Math.min(civicHall.footprint.x + civicHall.footprint.width - 2, civicPlaza.footprint.x - 1)),
      maxX: round(Math.max(civicPlaza.footprint.x + civicPlaza.footprint.width + 2, civicWell.footprint.x + civicWell.footprint.width - 1)),
      minY: round(Math.min(civicHall.geometry.entrance.point.y - 1, civicPlaza.footprint.y - 1)),
      maxY: round(Math.max(civicPlaza.footprint.y + civicPlaza.footprint.height + 2, civicWell.footprint.y + 1)),
    }
    : null;
  const plaza = civicPlaza ? [{
    id: 'surface.plaza.civic',
    recipe: 'plaza',
    district: 'civic',
    geometry: { kind: 'area', bounds: civicCourtBounds ?? rectangleBounds(expandRectangle(civicPlaza.footprint, 2)) },
    links: { placeIds: [civicPlaza.id], routeIds: routes.filter((route) => route.toPlaceId === civicPlaza.id || route.fromPlaceId === civicPlaza.id).map((route) => route.id).sort(compareStrings), districtIds: ['civic'] },
  }] : [];
  if (!dock) return [
    ...ground,
    ...plaza,
    ...(compactTown ? compactStreetBeds : routeSurfaces),
  ].sort((left, right) => compareStrings(left.id, right.id));
  const bankPoints = isSnowWorldview(worldview)
    ? [
      // A shallow upper bank follows the opening inlet rather than ending as
      // a straight underline. Its final point leaves through the same world
      // edge as the water, while the small middle bend keeps a natural cove
      // shoulder beneath the dock.
      point(waterPoints[0].x, waterPoints[0].y - snowHarbourWaterWidth / 2 - 0.75),
      point(
        round((waterPoints[0].x + waterPoints.at(-1).x) / 2),
        round((waterPoints[0].y + waterPoints.at(-1).y) / 2 - snowHarbourWaterWidth / 2 - 1),
      ),
      point(waterPoints.at(-1).x, waterPoints.at(-1).y - snowHarbourWaterWidth / 2 - 0.75),
    ]
    : broadLate
      ? [
        point(waterPoints[0].x, waterPoints[0].y - broadLateWaterWidth / 2 - 0.75),
        point(round((waterPoints[0].x + waterPoints.at(-1).x) / 2), waterPoints[0].y - broadLateWaterWidth / 2 - 1),
        point(waterPoints.at(-1).x, waterPoints.at(-1).y - broadLateWaterWidth / 2 - 0.75),
      ]
      : waterPoints.map((waterPoint, index) => point(waterPoint.x, clamp(waterPoint.y - 2 - (index % 2), bounds.minY + 2, bounds.maxY - 2)));
  const dockCrossings = crossings.filter(({ route }) => route.fromPlaceId === dock.id || route.toPlaceId === dock.id);
  if (dockCrossings.length === 0 && !isSnowWorldview(worldview)) {
    throw new TypeError('Dock place must connect to a readable route crossing the declared water surface');
  }
  // Crossing runs are assembled from the same route/water intersections as
  // the route-surface subtraction above.  Union collinear intervals before
  // emitting a surface so shared or partially overlapping crossings are one
  // authored geometry with all causal links, never two painted strips.
  const crossingIntervals = [];
  for (const { route, points } of crossings) {
    for (let index = 1; index < points.length; index += 1) {
      const segment = axisSegment(points[index - 1], points[index]);
      if (!segment || segment.start === segment.end) continue;
      crossingIntervals.push({
        ...segment,
        route,
        start: Math.min(segment.start, segment.end),
        end: Math.max(segment.start, segment.end),
      });
    }
  }
  const crossingLineGroups = new Map();
  for (const entry of crossingIntervals) {
    const key = `${entry.axis}|${round(entry.line)}`;
    const bucket = crossingLineGroups.get(key) ?? [];
    let merged = bucket.find((candidate) => entry.start <= candidate.end + 0.05 && entry.end >= candidate.start - 0.05);
    if (!merged) {
      merged = {
        axis: entry.axis,
        line: entry.line,
        start: entry.start,
        end: entry.end,
        placeIds: [],
        routeIds: [],
        districtIds: [],
      };
      bucket.push(merged);
    } else {
      merged.start = Math.min(merged.start, entry.start);
      merged.end = Math.max(merged.end, entry.end);
    }
    merged.placeIds.push(entry.route.fromPlaceId, entry.route.toPlaceId);
    merged.routeIds.push(entry.route.id);
    merged.districtIds.push(...entry.route.districtIds, 'waterside');
    // A newly widened interval may now touch a second interval in this line;
    // fold those intervals and their links into the same geometry as well.
    for (const other of [...bucket]) {
      if (other === merged || entry.start > other.end + 0.05 || entry.end < other.start - 0.05) continue;
      merged.start = Math.min(merged.start, other.start);
      merged.end = Math.max(merged.end, other.end);
      merged.placeIds.push(...other.placeIds);
      merged.routeIds.push(...other.routeIds);
      merged.districtIds.push(...other.districtIds);
      bucket.splice(bucket.indexOf(other), 1);
    }
    crossingLineGroups.set(key, bucket);
  }
  const mergedCrossings = [...crossingLineGroups.values()].flat()
    .sort((left, right) => left.axis.localeCompare(right.axis)
      || left.line - right.line
      || left.start - right.start
      || left.end - right.end);
  const crossingSurfaces = mergedCrossings.map((surface, index) => ({
    id: `surface.crossing.waterside.${index + 1}`,
    recipe: 'crossing',
    district: 'waterside',
    geometry: {
      kind: 'path',
      points: surface.axis === 'x'
        ? [point(surface.start, surface.line), point(surface.end, surface.line)]
        : [point(surface.line, surface.start), point(surface.line, surface.end)],
      width: isSnowWorldview(worldview) || broadLate ? 3 : 4,
    },
    links: {
      placeIds: uniqueSortedStrings(surface.placeIds),
      routeIds: uniqueSortedStrings(surface.routeIds),
      districtIds: uniqueSortedStrings(surface.districtIds),
    },
  }));
  const crossingRouteIds = uniqueSortedStrings(crossings.map(({ route }) => route.id));
  const water = [{
    id: 'surface.water.waterside',
    recipe: 'water',
    district: 'waterside',
    geometry: { kind: 'path', points: waterPoints, width: isSnowWorldview(worldview) ? snowHarbourWaterWidth : broadLate ? broadLateWaterWidth : 8 },
    links: { placeIds: [dock.id], routeIds: crossingRouteIds, districtIds: ['waterside'] },
  }, {
    id: 'surface.bank.waterside',
    recipe: 'bank',
    district: 'waterside',
    geometry: {
      kind: 'path',
      points: bankPoints,
      width: isSnowWorldview(worldview) || broadLate ? 1.5 : 3,
    },
    links: { placeIds: [dock.id], routeIds: [], districtIds: ['waterside'] },
  }];
  return [
    ...ground,
    ...water,
    ...plaza,
    ...(compactTown ? compactStreetBeds : routeSurfaces),
    ...crossingSurfaces,
  ].sort((left, right) => compareStrings(left.id, right.id));
}

function placesForConnection(connection, places) {
  const byFacility = new Map(places.filter((place) => place.facilityKind).map((place) => [place.facilityKind, place]));
  const civicPlaza = places.find((place) => place.id === 'place.civic-plaza');
  const desired = connection.direction === 'inbound'
    ? [byFacility.get('gate'), byFacility.get('guild'), byFacility.get('town_hall'), civicPlaza]
    : connection.role === 'storage'
      ? [byFacility.get('warehouse'), byFacility.get('guild'), byFacility.get('town_hall'), civicPlaza]
      : connection.role === 'unknown'
        ? [byFacility.get('town_hall'), byFacility.get('guild'), civicPlaza]
        : [byFacility.get('guild'), byFacility.get('town_hall'), civicPlaza];
  return [...new Map(desired.filter(Boolean).map((place) => [place.id, place])).values()];
}

function certaintyRank(state) {
  return state === 'unknown' ? 0 : state === 'inferred' ? 1 : state === 'observed' ? 2 : 0;
}

function leastCertainState(...states) {
  const valid = states.filter((state) => EVIDENCE_STATES.includes(state));
  if (valid.length === 0) return 'unknown';
  return valid.reduce((least, state) => certaintyRank(state) < certaintyRank(least) ? state : least, 'observed');
}

function externalConnections(connections) {
  const byEndpoint = new Map();
  for (const connection of connections) {
    if (connection.direction !== 'inbound' && connection.direction !== 'outbound') continue;
    if (connection.role === 'unknown') continue;
    const key = connection.target;
    const previous = byEndpoint.get(key);
    if (!previous) {
      byEndpoint.set(key, { ...connection });
      continue;
    }
    const evidence = mergeEvidence(previous.evidence, connection.evidence);
    const directionConflict = previous.direction !== connection.direction;
    const direction = directionConflict ? 'unknown' : previous.direction;
    if (directionConflict) {
      evidence.unknown = uniqueSortedStrings([...evidence.unknown, `connection.${previous.id}.direction.conflict`]);
    }
    const roleConflict = previous.role !== connection.role;
    const role = roleConflict ? 'unknown' : previous.role;
    if (roleConflict) {
      evidence.unknown = uniqueSortedStrings([...evidence.unknown, `connection.${previous.id}.role.conflict`]);
    }
    byEndpoint.set(key, {
      ...previous,
      direction,
      role,
      groupIds: uniqueSortedStrings([...previous.groupIds, ...connection.groupIds]),
      evidence,
      // A declaration's observed evidence must not upgrade an inferred or
      // unknown relation.  Dedupe retains the least certain semantic state;
      // conflicts remain unknown even when one edge was observed.
      state: directionConflict || roleConflict ? 'unknown' : leastCertainState(previous.state, connection.state),
    });
  }
  return [...byEndpoint.values()].sort((left, right) => compareStrings(left.id, right.id));
}

function connectionResidentName(connection) {
  if (connection.direction === 'inbound') return '来訪者';
  if (connection.role === 'storage') return '保管先の運び手';
  if (connection.role === 'http' || connection.role === 'webhook') return '往来の使者';
  if (connection.role === 'llm' || connection.role === 'external-api') return '遠方の使者';
  return '外との連絡役';
}

function connectionResidentAppearance(connection, worldview = WORLDVIEWS.lateMedieval) {
  const appearance = connection.role === 'storage' ? 'porter'
    : connection.direction === 'inbound' || connection.direction === 'outbound' ? 'traveler'
      : 'keeper';
  return isSnowWorldview(worldview) ? SNOW_RESIDENT_TRANSLATIONS[appearance] ?? appearance : appearance;
}

function connectionResidentBehavior(connection, placeRecord = null) {
  if (placeRecord?.requirements?.distinctInterior === true) return connection.role === 'storage' ? 'work' : 'talk';
  // The gate entrance is also the player's authored spawn. An inbound visitor
  // waits on the gate shoulder instead of walking the same first route point;
  // this keeps the arrival open while still making the external relationship
  // visible as a traveler at the threshold.
  if (connection.direction === 'inbound' && placeRecord?.facilityKind === 'gate') return 'talk';
  if (connection.role === 'storage' || connection.direction === 'inbound' || connection.direction === 'outbound') return 'walk';
  return 'talk';
}

function activityForBehavior(behavior) {
  return behavior === 'walk' ? 'walking'
    : behavior === 'work' ? 'working'
      : behavior === 'watch' ? 'watching'
        : 'speaking';
}

function groupResidentAppearance(group, worldview = WORLDVIEWS.lateMedieval) {
  const family = groupRoleFamily(group);
  if (family === 'heritage') return isSnowWorldview(worldview) ? 'keeper' : 'watcher';
  const dominant = dominantGroupRole(group);
  if (dominant === 'tooling') return 'artisan';
  if (dominant === 'test') return isSnowWorldview(worldview) ? 'keeper' : 'watcher';
  if (dominant === 'data' || dominant === 'configuration') return 'keeper';
  return family === 'living' ? 'neighbor' : 'keeper';
}

function groupResidentBehavior(group, walksIncidentRoute = false) {
  if (walksIncidentRoute) return 'walk';
  const family = groupRoleFamily(group);
  if (family === 'heritage' || dominantGroupRole(group) === 'test') return 'watch';
  if (family === 'work') return 'work';
  return family === 'living' ? 'talk' : 'watch';
}

function groupResidentClusterKey(group) {
  return `${groupParentPath(group.path)}|${groupRoleFamily(group)}`;
}

const FACILITY_RESIDENT_APPEARANCE = Object.freeze({
  gate: 'keeper', town_hall: 'keeper', warehouse: 'keeper', well: 'neighbor',
  workshop: 'artisan', dojo: 'watcher', watchtower: 'watcher', shop: 'artisan',
  guild: 'traveler', dock: 'porter', ruin: 'watcher',
});

const FACILITY_RESIDENT_COPY = Object.freeze({
  gate: Object.freeze({ name: '門番', activity: '門を見守る', behavior: 'talk' }),
  town_hall: Object.freeze({ name: '役場の係', activity: '報告を待つ', behavior: 'talk' }),
  warehouse: Object.freeze({ name: '倉庫番', activity: '台帳を扱う', behavior: 'work' }),
  well: Object.freeze({ name: '井戸守', activity: '水場を見守る', behavior: 'watch' }),
  workshop: Object.freeze({ name: '工房の職人', activity: '道具を扱う', behavior: 'work' }),
  dojo: Object.freeze({ name: '道場の番人', activity: '印を見守る', behavior: 'watch' }),
  watchtower: Object.freeze({ name: '見張り台の番', activity: '夜を見張る', behavior: 'watch' }),
  shop: Object.freeze({ name: '修理屋', activity: '道具を整える', behavior: 'work' }),
  guild: Object.freeze({ name: '接続者', activity: '往来を語る', behavior: 'talk' }),
  dock: Object.freeze({ name: '船着場の運び手', activity: '荷を運ぶ', behavior: 'walk' }),
  ruin: Object.freeze({ name: '廃屋の見張り', activity: '跡を見守る', behavior: 'watch' }),
});

function facilityResidentSpec(facilityKind, placeRecord, worldview = WORLDVIEWS.lateMedieval) {
  const copy = FACILITY_RESIDENT_COPY[facilityKind] ?? { name: '町の係', activity: '町を見守る', behavior: 'talk' };
  const behavior = placeRecord.requirements?.distinctInterior === true && copy.behavior === 'walk' ? 'work' : copy.behavior;
  const appearance = FACILITY_RESIDENT_APPEARANCE[facilityKind] ?? 'neighbor';
  return {
    appearance: isSnowWorldview(worldview) ? SNOW_RESIDENT_TRANSLATIONS[appearance] ?? appearance : appearance,
    behavior,
    name: copy.name,
    activity: copy.activity,
  };
}

function facilityResidentState(town, facilityKind) {
  const candidate = town.candidates.find((entry) => entry.facilityKind === facilityKind);
  if (candidate) return candidate.state;
  const facility = town.facilities.find((entry) => entry.kind === facilityKind);
  if (!facility || facility.presence === 'unknown') return 'unknown';
  if ((facility.condition === 'active' || facility.condition === 'missing')
    && facility.evidence?.observed?.length > 0) return 'observed';
  if (facility.presence === 'present' || facility.condition === 'dirt' || facilityKind === 'town_hall') return 'inferred';
  return 'unknown';
}

// Keep walking residents on the local route before its next authored turn.
// A longer prefix can carry the body into the neighbouring home at a tight
// route junction, even though the route endpoint itself is valid.
const RESIDENT_MOTION_LENGTH = 2.5;

const LOGICAL_RESIDENT_BODY = Object.freeze({ x: -0.375, y: -0.6875, width: 0.75, height: 0.75 });

function residentBodyAt(anchor) {
  return {
    x: anchor.x + LOGICAL_RESIDENT_BODY.x,
    y: anchor.y + LOGICAL_RESIDENT_BODY.y,
    width: LOGICAL_RESIDENT_BODY.width,
    height: LOGICAL_RESIDENT_BODY.height,
  };
}

function residentPathClearsPlaces(anchor, places) {
  const body = residentBodyAt(anchor);
  return places.every((place) => place.recipe === 'civic_plaza'
    || !place.appearance
    || !rectanglesOverlap(body, place.footprint));
}

function clearStandingResidentAnchor(placeRecord, places) {
  const entrance = placeRecord.geometry?.entrance?.point;
  const approach = placeRecord.geometry?.entrance?.approach?.[0];
  const base = standingResidentAnchor(placeRecord);
  const footprint = placeRecord.footprint;
  const candidates = [
    footprint && entrance ? point(entrance.x, footprint.y + footprint.height + 0.75) : null,
    footprint && entrance ? point(footprint.x - 0.75, entrance.y) : null,
    footprint && entrance ? point(footprint.x + footprint.width + 0.75, entrance.y) : null,
    approach,
    approach ? point(approach.x - 2, approach.y) : null,
    approach ? point(approach.x + 2, approach.y) : null,
    approach ? point(approach.x, approach.y + 1.5) : null,
    base,
    entrance && approach ? point(base.x - 2, base.y) : null,
    entrance && approach ? point(base.x + 2, base.y) : null,
    entrance && approach ? point(base.x, base.y + 1.5) : null,
    entrance && approach ? point(base.x - 3, base.y + 1.5) : null,
    entrance && approach ? point(base.x + 3, base.y + 1.5) : null,
    entrance && approach ? point(base.x - 4, base.y - 1.5) : null,
    entrance && approach ? point(base.x + 4, base.y - 1.5) : null,
  ].filter(Boolean);
  return candidates.find((anchor) => residentPathClearsPlaces(anchor, places))
    ?? placeRecord.geometry?.entrance?.approach?.[0]
    ?? base;
}

function clearRouteMotion(line, placeRecord, places) {
  const samples = sampledPath(line, 0.25);
  const safe = samples.map((value) => residentPathClearsPlaces(value, places));
  let best = null;
  let runStart = -1;
  for (let index = 0; index <= samples.length; index += 1) {
    if (index < samples.length && safe[index]) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart >= 0) {
      const runEnd = index - 1;
      if (runEnd > runStart) {
        const run = samples.slice(runStart, runEnd + 1);
        const distance = Math.hypot(run.at(-1).x - run[0].x, run.at(-1).y - run[0].y);
        if (distance >= RESIDENT_MOTION_LENGTH) {
          const proximity = Math.hypot(run[0].x - placeRecord.anchor.x, run[0].y - placeRecord.anchor.y);
          if (!best || proximity < best.proximity) best = { run, proximity };
        }
      }
      runStart = -1;
    }
  }
  if (!best) return null;
  const start = best.run[0];
  let travelled = 0;
  for (let index = 1; index < best.run.length; index += 1) {
    const from = best.run[index - 1];
    const to = best.run[index];
    const segment = Math.hypot(to.x - from.x, to.y - from.y);
    if (travelled + segment >= RESIDENT_MOTION_LENGTH) {
      const progress = (RESIDENT_MOTION_LENGTH - travelled) / segment;
      return [point(start.x, start.y), point(
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
      )];
    }
    travelled += segment;
  }
  return null;
}

function incidentRouteForResident(placeRecord, routes) {
  return routes
    .filter((route) => route.fromPlaceId === placeRecord.id || route.toPlaceId === placeRecord.id)
    .sort((left, right) => compareStrings(left.id, right.id))[0] ?? null;
}

function residentMotion(placeRecord, behavior, routes, places) {
  if (behavior !== 'walk' || placeRecord.requirements?.distinctInterior === true) return { kind: 'still' };
  const incident = incidentRouteForResident(placeRecord, routes);
  if (!incident || !Array.isArray(incident.centerline) || incident.centerline.length < 2) return { kind: 'still' };
  const line = incident.fromPlaceId === placeRecord.id ? incident.centerline : [...incident.centerline].reverse();
  const clearPoints = clearRouteMotion(line, placeRecord, places);
  // A tight authored street has no obligation to turn every resident into a
  // walker. If this place has no clear stretch, the resident works or idles at
  // its doorway instead of clipping a neighbouring façade.
  if (!clearPoints) return { kind: 'still' };
  const points = clearPoints;
  if (points.length < 2) return { kind: 'still' };
  if (clearPoints) return { kind: 'ping-pong', points };
  const entrance = placeRecord.geometry?.entrance?.point;
  const approach = placeRecord.geometry?.entrance?.approach?.[0];
  if (!entrance || !approach) return { kind: 'ping-pong', points };
  const approachLength = Math.hypot(approach.x - entrance.x, approach.y - entrance.y);
  if (approachLength <= 0) return { kind: 'ping-pong', points };
  const routeWidth = incident.recipe === 'main' ? 5 : 3;
  // Keep the resident just outside the entrance while its authored body still
  // overlaps the visible route strip. A wider shoulder put the compiled
  // 12-by-12 body one pixel beyond a three-unit local road.
  const shoulderDistance = Math.min(routeWidth / 2 + 0.5, approachLength * 0.45);
  const offset = {
    x: (approach.x - entrance.x) / approachLength * shoulderDistance,
    y: (approach.y - entrance.y) / approachLength * shoulderDistance,
  };
  const shoulderPoints = points.map((entry) => point(entry.x + offset.x, entry.y + offset.y));
  return { kind: 'ping-pong', points: shoulderPoints };
}

function standingResidentAnchor(placeRecord) {
  const entrance = placeRecord.geometry?.entrance?.point;
  const approach = placeRecord.geometry?.entrance?.approach?.[0];
  if (!entrance || !approach) return placeRecord.anchor;
  return point((entrance.x + approach.x) / 2, (entrance.y + approach.y) / 2);
}

function investigationTargetAnchor(placeRecord, candidate) {
  const recipe = INVESTIGATION_TARGET_BY_FACILITY[candidate.facilityKind];
  if (!recipe) return null;
  const offset = INVESTIGATION_TARGET_OFFSETS[recipe];
  const interior = placeRecord.geometry.interior?.footprint;
  const rawAnchor = point(placeRecord.anchor.x + offset.x, placeRecord.anchor.y + offset.y);
  return interior
    ? point(
      clamp(rawAnchor.x, interior.x + 1, interior.x + interior.width - 1),
      clamp(rawAnchor.y, interior.y + 1, interior.y + interior.height - 1),
    )
    : rawAnchor;
}

function makeResidents(town, places, routes, worldview = WORLDVIEWS.lateMedieval) {
  const residents = [];
  const movingPlaceRoutes = new Set();
  const usedSlots = new Map();
  const outdoorSlots = [
    { x: 0, y: 0 }, { x: -2, y: 0 }, { x: 2, y: 0 }, { x: -4, y: 0 }, { x: 4, y: 0 },
    // A compact work court can put a home directly across from an open yard.
    // These outer shoulders keep the yard keeper beside that place without
    // embedding the actor in the facing home or widening the whole town.
    { x: -6, y: 0 }, { x: 6, y: 0 },
    { x: -3, y: 2 }, { x: -1, y: 2 }, { x: 1, y: 2 }, { x: 3, y: 2 },
  ];
  const gateShoulderSlots = [
    // Keep the straight spawn-to-gate route open.  The first keeper stands
    // on its left cobbled shoulder, close enough to address from the road
    // without sharing the player's spawn body. A second slot remains on the
    // right if a future truthful role also belongs at the threshold.
    { x: -1.5, y: 0 }, { x: 3.5, y: 0 }, { x: -4, y: 1.5 }, { x: 4, y: 1.5 },
  ];
  const wellShoulderSlots = isSnowWorldview(worldview)
    // Snow keeps the resident left of the well, away from the dock inlet.
    ? [{ x: -3, y: -6 }, { x: -4, y: -5 }, { x: -2, y: -7 }]
    // Late-medieval keeps the resident on the left shoulder. The well entrance
    // is itself authored on the left front rim, so a right-side slot would
    // fall into the neighbouring living compound at dense frontages.
    : [{ x: -1, y: -3 }, { x: -2, y: -2 }, { x: 0, y: -4 }];
  // A guild can host several distinct external relationships. Keep its
  // messengers along the dry frontage above the approach; the lower shoulder
  // can coincide with an authored late-harbor bank in a repository that also
  // exposes distribution roles.
  const guildShoulderSlots = [
    // External arrivals line the dry left shoulder. The dock and water can
    // occupy the guild's right/lower frontage in distribution-heavy towns.
    { x: -6, y: -2 }, { x: -7, y: -1 }, { x: -8, y: -3 },
    { x: -9, y: -1 }, { x: -10, y: -3 },
    // A broad all-role frontage can place a living home immediately below
    // this shoulder. Keep reserve messengers above that home's top edge and
    // left of the guild footprint; these anchors also stay above the late
    // waterside bank, so they remain dry in the dock-bearing composition.
    { x: -6, y: -4 }, { x: -8, y: -4 }, { x: -10, y: -4 },
  ];
  const interiorSlots = [
    { x: 0, y: 0 }, { x: -2, y: 0 }, { x: 2, y: 0 },
    { x: 0, y: -2 }, { x: -2, y: -2 }, { x: 2, y: -2 },
    { x: 0, y: 2 }, { x: -2, y: 2 }, { x: 2, y: 2 },
    { x: -1.5, y: -1.5 }, { x: 1.5, y: -1.5 },
    { x: -1.5, y: 1.5 }, { x: 1.5, y: 1.5 },
  ];
  const targetByPlaceId = new Map();
  for (const candidate of town.candidates) {
    const placeRecord = places.find((place) => place.facilityKind === candidate.facilityKind);
    const target = placeRecord ? investigationTargetAnchor(placeRecord, candidate) : null;
    if (placeRecord && target) targetByPlaceId.set(placeRecord.id, target);
  }
  const claimAnchor = (placeRecord) => {
    const interiorFootprint = placeRecord.geometry.interior?.footprint;
    const publicAnchor = placeRecord.requirements.distinctInterior && interiorFootprint
      ? point(
        placeRecord.geometry.interior.entrance?.x ?? (interiorFootprint.x + interiorFootprint.width / 2),
        interiorFootprint.y + interiorFootprint.height - 0.5,
      )
      : placeRecord.geometry.entrance.approach[0] ?? placeRecord.geometry.entrance.point;
    const sourceSlots = placeRecord.requirements.distinctInterior
      ? interiorSlots
      : placeRecord.facilityKind === 'gate'
        ? gateShoulderSlots
        : placeRecord.facilityKind === 'well'
          ? wellShoulderSlots
          : placeRecord.facilityKind === 'guild'
            ? guildShoulderSlots
          : outdoorSlots;
    const available = placeRecord.requirements.distinctInterior
      ? sourceSlots.filter((offset) => rectangleContainsPoint(interiorFootprint, point(publicAnchor.x + offset.x, publicAnchor.y + offset.y)))
      : sourceSlots;
    let slotIndex = usedSlots.get(placeRecord.id) ?? 0;
    const target = targetByPlaceId.get(placeRecord.id);
    while (slotIndex < available.length) {
      const slot = available[slotIndex];
      slotIndex += 1;
      const anchor = point(publicAnchor.x + slot.x, publicAnchor.y + slot.y);
      // Outdoor slots share a street frontage with neighbouring places. A
      // slot is usable only when the actor's actual body clears every visible
      // footprint; otherwise a dojo/shop resident can appear embedded in the
      // home immediately across the lane.
      if (!placeRecord.requirements.distinctInterior && !residentPathClearsPlaces(anchor, places)) continue;
      if (target && Math.hypot(anchor.x - target.x, anchor.y - target.y) <= 2) continue;
      usedSlots.set(placeRecord.id, slotIndex);
      return anchor;
    }
    usedSlots.set(placeRecord.id, slotIndex);
    return null;
  };
  const claimPlace = (candidates) => {
    for (const placeRecord of candidates) {
      const anchor = claimAnchor(placeRecord);
      if (anchor) return { placeRecord, anchor };
    }
    return null;
  };
  const residentIntent = (placeRecord, desiredBehavior, fallbackBehavior = 'talk') => {
    if (desiredBehavior !== 'walk') {
      const standingAnchor = isSnowWorldview(worldview)
        && !placeRecord.facilityKind
        && placeRecord.district === 'living'
        ? point(placeRecord.geometry.entrance.point.x + 1, placeRecord.geometry.entrance.point.y)
        : standingResidentAnchor(placeRecord);
      return {
        behavior: desiredBehavior,
        motion: { kind: 'still' },
        ...(placeRecord.requirements.distinctInterior || placeRecord.facilityKind
          ? {}
          : { anchor: standingAnchor }),
      };
    }
    const incident = incidentRouteForResident(placeRecord, routes);
    const motionKey = incident ? `${placeRecord.id}|${incident.id}` : null;
    if (!motionKey || movingPlaceRoutes.has(motionKey)) {
      return { behavior: fallbackBehavior, motion: { kind: 'still' } };
    }
    const motion = residentMotion(placeRecord, desiredBehavior, routes, places);
    if (motion.kind !== 'ping-pong') return { behavior: fallbackBehavior, motion: { kind: 'still' }, anchor: standingResidentAnchor(placeRecord) };
    movingPlaceRoutes.add(motionKey);
    return { behavior: desiredBehavior, motion };
  };
  const stationaryAnchor = (placeRecord, preferred) => (
    placeRecord.requirements.distinctInterior
      ? preferred
      : preferred && residentPathClearsPlaces(preferred, places)
        ? preferred
        : clearStandingResidentAnchor(placeRecord, places)
  );
  const clusterByGroup = new Map(town.groups.map((group) => [group.id, groupResidentClusterKey(group)]));
  const groupWalksIncidentRoute = (group, placeRecord) => town.connections.some((connection) => {
    if (connection.direction !== 'internal' || !connection.groupIds.includes(group.id)) return false;
    return connection.groupIds.some((groupId) => groupId !== group.id && clusterByGroup.get(groupId) !== clusterByGroup.get(group.id))
      && routes.some((route) => route.fromPlaceId === placeRecord.id || route.toPlaceId === placeRecord.id);
  });
  for (const connection of externalConnections(town.connections)) {
    const claimed = claimPlace(placesForConnection(connection, places));
    if (!claimed) continue;
    const { placeRecord, anchor: claimedAnchor } = claimed;
    const appearance = connectionResidentAppearance(connection, worldview);
    const desiredBehavior = connectionResidentBehavior(connection, placeRecord);
    const fallbackBehavior = connection.role === 'storage' ? 'work' : 'talk';
    const intent = residentIntent(placeRecord, desiredBehavior, fallbackBehavior);
    const behavior = intent.behavior;
    const motion = intent.motion;
    residents.push({
      id: `resident.connection.${connection.id}`,
      placeId: placeRecord.id,
      anchor: motion.kind === 'ping-pong'
        ? motion.points[0]
        : stationaryAnchor(placeRecord, intent.anchor ?? claimedAnchor),
      role: connection.role,
      name: connectionResidentName(connection),
      activity: activityForBehavior(behavior),
      state: connection.state,
      evidence: connection.evidence,
      appearance,
      behavior,
      motion,
      ...(placeRecord.requirements.distinctInterior ? { interiorPlaceId: placeRecord.id } : {}),
    });
  }
  const homes = places
    .filter((place) => !place.facilityKind && Array.isArray(place.sourceGroupIds) && place.sourceGroupIds.length > 0)
    .sort((left, right) => compareStrings(left.id, right.id));
  const homesByCluster = new Map();
  for (const placeRecord of homes) {
    const sourceGroups = placeRecord.sourceGroupIds
      .map((groupId) => town.groups.find((group) => group.id === groupId))
      .filter(Boolean)
      .sort((left, right) => compareStrings(left.id, right.id));
    const group = sourceGroups[0];
    if (!group) continue;
    const clusterKey = groupResidentClusterKey(group);
    const cluster = homesByCluster.get(clusterKey) ?? { places: [], groups: [] };
    cluster.places.push(placeRecord);
    cluster.groups.push(...sourceGroups);
    homesByCluster.set(clusterKey, cluster);
  }
  for (const [clusterKey, cluster] of [...homesByCluster.entries()].sort(([left], [right]) => compareStrings(left, right))) {
    const representativePlace = [...cluster.places].sort((left, right) => compareStrings(left.id, right.id))[0];
    const sourceGroups = [...new Map(cluster.groups.map((group) => [group.id, group])).values()]
      .sort((left, right) => compareStrings(left.id, right.id));
    const group = sourceGroups[0];
    if (!group || !representativePlace) continue;
    const claimed = claimPlace([representativePlace]);
    if (!claimed) continue;
    const { placeRecord: claimedPlace, anchor: claimedAnchor } = claimed;
    const evidence = mergeEvidence(...sourceGroups.map((entry) => entry.evidence));
    const state = sourceGroups.reduce((least, entry) => leastCertainState(least, entry.state), 'observed');
    const desiredBehavior = groupResidentBehavior(group, sourceGroups.some((entry) => groupWalksIncidentRoute(entry, claimedPlace)));
    const intent = residentIntent(claimedPlace, desiredBehavior, groupResidentBehavior(group, false));
    const behavior = intent.behavior;
    const motion = intent.motion;
    residents.push({
      id: `resident.cluster.${encodeURIComponent(clusterKey)}`,
      placeId: claimedPlace.id,
      anchor: motion.kind === 'ping-pong'
        ? motion.points[0]
        : stationaryAnchor(claimedPlace, intent.anchor ?? claimedAnchor),
      role: 'townsperson',
      name: group.path === '.' ? '町の住人' : '街区の住人',
      activity: activityForBehavior(behavior),
      state,
      evidence,
      appearance: groupResidentAppearance(group, worldview),
      behavior,
      motion,
      ...(claimedPlace.requirements.distinctInterior ? { interiorPlaceId: claimedPlace.id } : {}),
    });
  }

  // Keep the town inhabited even when there are no semantic groups.  These
  // actors are attached to journey and investigation places (plus genuinely
  // present facility roles); their evidence is the place evidence, so an
  // unknown facility remains unknown rather than becoming a repository claim.
  const requiredFacilityKinds = uniqueSortedStrings([
    'gate',
    'town_hall',
    ...town.candidates.map((candidate) => candidate.facilityKind),
    ...town.facilities.filter((facility) => facility.presence === 'present').map((facility) => facility.kind),
  ]);
  const journeyFacilityKinds = new Set(['gate', 'town_hall', ...town.candidates.map((candidate) => candidate.facilityKind)]);
  const occupiedResidentPlaces = new Set(residents.map((resident) => resident.placeId));
  for (const facilityKind of requiredFacilityKinds) {
    const placeRecord = places.find((place) => place.facilityKind === facilityKind);
    if (!placeRecord) {
      if (journeyFacilityKinds.has(facilityKind)) throw new TypeError(`Required journey resident place is missing for ${facilityKind}`);
      continue;
    }
    if (occupiedResidentPlaces.has(placeRecord.id)) continue;
    const claimed = claimPlace([placeRecord]);
    if (!claimed) {
      if (journeyFacilityKinds.has(facilityKind)) throw new TypeError(`No safe authored resident slot remains for required place ${placeRecord.id}`);
      continue;
    }
    const { placeRecord: claimedPlace, anchor: claimedAnchor } = claimed;
    const spec = facilityResidentSpec(facilityKind, claimedPlace, worldview);
    const intent = residentIntent(claimedPlace, spec.behavior, 'talk');
    const behavior = intent.behavior;
    const motion = intent.motion;
    residents.push({
      id: `resident.place.${claimedPlace.id}`,
      placeId: claimedPlace.id,
      anchor: motion.kind === 'ping-pong'
        ? motion.points[0]
        : stationaryAnchor(claimedPlace, intent.anchor ?? claimedAnchor),
      role: 'townsperson',
      name: spec.name,
      activity: behavior === spec.behavior ? spec.activity : activityForBehavior(behavior),
      state: facilityResidentState(town, facilityKind),
      evidence: placeEvidence(claimedPlace),
      appearance: spec.appearance,
      behavior,
      motion,
      ...(claimedPlace.requirements.distinctInterior ? { interiorPlaceId: claimedPlace.id } : {}),
    });
    occupiedResidentPlaces.add(claimedPlace.id);
  }
  return residents.sort((left, right) => compareStrings(left.id, right.id));
}

function placeEvidence(place) {
  return evidenceBag(place.evidence, `${place.id}.unknown`);
}

function makeProps(places, identitySeed, worldview = WORLDVIEWS.lateMedieval) {
  if (isSnowWorldview(worldview)) {
    const compactSnow = places.length <= 9
      && places.some((place) => place.facilityKind === 'dock')
      && places.some((place) => place.facilityKind === 'well')
      && places.filter((place) => place.recipe === 'residence').length <= 2
      && places.every((place) => !place.facilityKind
        || ['gate', 'town_hall', 'dock', 'warehouse', 'well', 'workshop'].includes(place.facilityKind));
    // The compact snow environment already carries its continuous forest,
    // yard boundary, quay, shore and working clutter in the repository-
    // selected terrain image. Repeating those same jobs as large foreground
    // cut-outs made the live buildings look pasted onto a second asset sheet.
    // Keep functional residents, clues and causal lights live, but do not
    // duplicate the supplied environment with freestanding decoration.
    if (compactSnow) return [];
    const specs = [
      // A single evergreen marks the quiet outer edge. It is not a repeated
      // filler tree and it stays outside the arrival and dock approaches.
      ['prop.snow-evergreen-edge', null, 'snow_evergreen', 'anchor', { x: 5, y: 1 }],
      // Cargo sits on the dry right-front working shoulder. Its authored
      // collision remains above the cove and clear of the approach, while
      // its lower baseline keeps it beside the dock instead of above its roof.
      ['prop.snow-dock-cargo', 'place.dock', 'snow_dock_cargo', 'anchor', { x: 4, y: 2 }],
    ];
    const props = [];
    for (const [id, desiredPlaceId, recipe, anchorRole, offset] of specs) {
      const placeRecord = desiredPlaceId
        ? places.find((place) => place.id === desiredPlaceId)
        : places.find((place) => place.id.startsWith('place.home.') && place.id.includes('%7Cliving'));
      if (!placeRecord) continue;
      const state = evidenceState(placeRecord.evidence);
      const baseAnchor = anchorRole === 'entrance'
        ? placeRecord.geometry.entrance.point
        : anchorRole === 'approach'
          ? placeRecord.geometry.entrance.approach[0]
          : placeRecord.anchor;
      props.push({
        id,
        placeId: placeRecord.id,
        recipe,
        anchor: point(baseAnchor.x + offset.x + signedOffset(hashParts(identitySeed, id), 0.35), baseAnchor.y + offset.y),
        state,
        evidence: placeEvidence(placeRecord),
      });
    }
    return props.sort((left, right) => compareStrings(left.id, right.id));
  }
  const broadLate = !isSnowWorldview(worldview) && isBroadLateShape(places);
  if (broadLate) return [];
  const compactLate = !isSnowWorldview(worldview) && isCompactLateShape(places);
  const specs = [
    // Keep the request board beside the open arch. It must not occupy the
    // player's arrival opening or merge with the gate silhouette.
    ['prop.gate-sign', 'place.gate', 'signboard', 'entrance', { x: 5, y: 1 }],
    // The well is a living-district edge in small repositories. A single
    // tree gives that quiet boundary depth when no heritage ruin exists.
    ...(!compactLate ? [['prop.heritage-tree', 'place.well', 'tree_cluster', 'anchor', { x: 7, y: -2 }]] : []),
    // Small material clusters join the authored places into lived-in
    // neighbourhoods. They sit at the side of an entrance or civic pocket,
    // never in the route centreline or the player's doorway.
    ['prop.work-clutter', 'place.workshop', 'work_clutter', 'entrance', { x: 6, y: -1 }],
    ...(!compactLate ? [['prop.civic-planter', 'place.civic-plaza', 'civic_planter', 'entrance', { x: 7, y: 4 }]] : []),
    // The well resident uses the left shoulder; lower the woodpile one more
    // unit so its authored collision does not meet that actor's body.
    ['prop.living-woodpile', 'place.well', 'living_woodpile', 'anchor', { x: -11, y: 3 }],
  ];
  const props = [];
  for (const [id, desiredPlaceId, recipe, anchorRole, offset] of specs) {
    const placeRecord = places.find((place) => place.id === desiredPlaceId);
    if (!placeRecord) continue;
    const state = evidenceState(placeRecord.evidence);
    const baseAnchor = anchorRole === 'entrance'
      ? placeRecord.geometry.entrance.point
      : anchorRole === 'approach'
        ? placeRecord.geometry.entrance.approach[0]
        : placeRecord.anchor;
    props.push({
      id,
      placeId: placeRecord.id,
      recipe,
      anchor: point(baseAnchor.x + offset.x + signedOffset(hashParts(identitySeed, id), 0.5), baseAnchor.y + offset.y),
      state,
      evidence: placeEvidence(placeRecord),
    });
  }
  // Compact late towns keep only the causal sign, work clutter, and woodpile
  // above. Detached stair, hedge, tree, and planter props had no spatial
  // cause in this flat court and made the scene read as a prop catalog.
  return props.sort((left, right) => compareStrings(left.id, right.id));
}

function makeLights(town, places, identitySeed, worldview) {
  const lights = [];
  const add = (id, desiredPlaceId, state, evidence, offset = { x: 0, y: 0 }) => {
    const placeRecord = places.find((place) => place.id === desiredPlaceId);
    if (!placeRecord) return;
    lights.push({
      id,
      placeId: placeRecord.id,
      recipe: 'street_lantern',
      anchor: point(placeRecord.anchor.x + offset.x + signedOffset(hashParts(identitySeed, id), 0.4), placeRecord.anchor.y + offset.y),
      state,
      evidence: evidenceBag(evidence, `${id}.unknown`),
    });
  };
  add('light.arrival-gate', 'place.gate', 'lit', places.find((place) => place.id === 'place.gate')?.evidence, { x: -3, y: 1 });
  // Keep the civic lantern on a building-side shoulder instead of leaving a
  // freestanding pole at the visual center of the plaza.  Snow's hall sits on
  // the west side of its apron; the late hall sits north of the court.
  const civicLightOffset = isSnowWorldview(worldview) ? { x: -7, y: 0.5 } : { x: 5, y: -9 };
  const broadLate = !isSnowWorldview(worldview) && isBroadLateShape(places);
  if (!broadLate) {
    add('light.civic-plaza', 'place.civic-plaza', 'lit', places.find((place) => place.id === 'place.civic-plaza')?.evidence, civicLightOffset);
  }
  add('light.waterside', 'place.dock', 'unknown', places.find((place) => place.facilityKind === 'dock')?.evidence, { x: -7, y: -1 });
  const townHall = places.find((place) => place.facilityKind === 'town_hall');
  if (townHall) {
    lights.push({
      id: 'light.town-hall-lantern',
      placeId: townHall.id,
      recipe: 'town_hall_lantern',
      anchor: point(townHall.anchor.x, townHall.anchor.y + (broadLate ? -1 : -4)),
      state: 'unlit',
      evidence: mergeEvidence(townHall.evidence, town.transition?.evidence),
      reportState: { transitionId: town.transition?.id ?? REPOSITORY_INSPECTION_TRANSITION_ID, before: 'unlit', after: 'lit' },
    });
  }
  return lights.sort((left, right) => compareStrings(left.id, right.id));
}

function makeInvestigations(town, places, worldview = WORLDVIEWS.lateMedieval) {
  if (isSnowWorldview(worldview) && !town.candidates.every((candidate) => snowInvestigationSupported(candidate))) {
    throw new TypeError('Snow-harbor worldview needs threshold, ledger, and water-source investigations');
  }
  const placeByFacility = new Map(places.filter((place) => place.facilityKind).map((place) => [place.facilityKind, place]));
  return town.candidates.map((candidate) => {
    const placeRecord = placeByFacility.get(candidate.facilityKind);
    if (!placeRecord) throw new TypeError(`No place recipe for investigation facility ${candidate.facilityKind}`);
    const recipe = INVESTIGATION_TARGET_BY_FACILITY[candidate.facilityKind];
    if (!recipe) throw new TypeError(`No investigation target recipe for ${candidate.facilityKind}`);
    const targetAnchor = investigationTargetAnchor(placeRecord, candidate);
    return {
      id: candidate.id,
      candidateId: candidate.id,
      placeId: placeRecord.id,
      facilityKind: candidate.facilityKind,
      capability: candidate.capability,
      subject: candidate.subject,
      action: candidate.action,
      statement: candidate.statement,
      state: candidate.state,
      evidence: candidate.evidence,
      target: {
        recipe,
        anchor: targetAnchor,
        reach: 2,
      },
    };
  });
}

function makeJourney(town, places, investigations) {
  const request = places.find((place) => place.facilityKind === 'gate') ?? places.find((place) => place.id === 'place.civic-plaza');
  const report = places.find((place) => place.facilityKind === 'town_hall');
  if (!request || !report || request.id === report.id) throw new TypeError('Place recipes must provide distinct request and report places');
  return {
    requestPlaceId: request.id,
    reportPlaceId: report.id,
    townHallLanternPlaceId: report.id,
    transition: town.transition,
    evidence: mergeEvidence(town.evidence, ...investigations.map((entry) => entry.evidence)),
  };
}

function packedCompositionBounds(
  initialBounds,
  composition,
  districts,
  places,
  routes,
  residents,
  props,
  lights,
  investigations,
  worldview = WORLDVIEWS.lateMedieval,
) {
  if (!isSnowWorldview(worldview) && isBroadLateShape(places)) {
    return { minX: -2, maxX: 71, minY: 1.5, maxY: 47 };
  }
  // The provisional canvas only gives placement search room. Keeping its
  // origin in the packed scene leaves a large empty moat above and beside the
  // actual town, making the overview shrink the authored buildings and actors
  // into a tiny island. Pack around the placed world instead, with one quiet
  // edge margin for arrival and camera breathing room.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const includePoint = (value) => {
    if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
    minX = Math.min(minX, value.x);
    minY = Math.min(minY, value.y);
    maxX = Math.max(maxX, value.x);
    maxY = Math.max(maxY, value.y);
  };
  const includeRectangle = (value) => {
    if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)
      || !Number.isFinite(value.width) || !Number.isFinite(value.height)) return;
    minX = Math.min(minX, value.x);
    minY = Math.min(minY, value.y);
    maxX = Math.max(maxX, value.x + value.width);
    maxY = Math.max(maxY, value.y + value.height);
  };
  includePoint(composition.entry);
  includePoint(composition.spawn);
  includePoint(composition.civic);
  for (const district of districts) includePoint(district.anchor);
  for (const place of places) {
    includePoint(place.anchor);
    includeRectangle(place.footprint);
    includeRectangle(place.geometry?.access?.region);
    includeRectangle(place.geometry?.interior?.footprint);
    includeRectangle(place.geometry?.occlusion?.roof);
    includeRectangle(place.geometry?.occlusion?.foreground);
    includePoint(place.geometry?.entrance?.point);
    for (const approach of place.geometry?.entrance?.approach ?? []) includePoint(approach);
    includePoint(place.geometry?.interior?.entrance);
    includePoint(place.geometry?.interior?.exit);
  }
  for (const route of routes) for (const entry of route.centerline ?? []) includePoint(entry);
  for (const resident of residents) {
    includePoint(resident.anchor);
    for (const entry of resident.motion?.points ?? []) includePoint(entry);
  }
  for (const prop of props) includePoint(prop.anchor);
  for (const light of lights) includePoint(light.anchor);
  for (const investigation of investigations) includePoint(investigation.target?.anchor);
  // Two logical units leave a visible breathing edge at the packed camera
  // without shrinking the authored streets back to a half-size overview.
  const quietMargin = 2;
  if (!Number.isFinite(minX) || !Number.isFinite(minY)
    || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { ...initialBounds };
  }
  const authoredEnvelope = isSnowWorldview(worldview) ? initialBounds : null;
  const snowDock = isSnowWorldview(worldview)
    ? places.find((place) => place.facilityKind === 'dock')
    : null;
  // The snow inlet is authored after packing. Reserve its full lower half
  // here so makeSurfaces never has to clamp the water back through the dock
  // footprint. The dock entrance sits at the crossing on the upper edge;
  // six units carry the water centre, half-width, and one quiet edge unit.
  const snowCoveMaxY = snowDock?.geometry?.entrance?.point
    ? snowDock.geometry.entrance.point.y + 6
    : Number.NEGATIVE_INFINITY;
  return {
    // Snow harbour rows use the complete authored street envelope. This keeps
    // a small but valid harbour composition inside the native useful view;
    // late-medieval towns remain tightly packed around their placed geometry.
    minX: round(Math.min(minX - quietMargin, authoredEnvelope?.minX ?? minX - quietMargin)),
    // The packed world must leave enough horizontal breathing room for the
    // native 1280px view at the compiler's 112px edge margin. This is a quiet
    // ground edge, not another place or route, and prevents the game view from
    // becoming wider than its own world when a repository has a compact town.
    maxX: round(Math.max(minX + 66, maxX + quietMargin, authoredEnvelope?.maxX ?? Number.NEGATIVE_INFINITY)),
    minY: round(minY - quietMargin),
    maxY: round(Math.max(minY + 24, maxY + quietMargin, snowCoveMaxY)),
  };
}

function clipDistrictsToBounds(districts, bounds) {
  return districts.map((district) => ({
    ...district,
    bounds: {
      minX: round(Math.max(bounds.minX, district.bounds.minX)),
      maxX: round(Math.min(bounds.maxX, district.bounds.maxX)),
      minY: round(Math.max(bounds.minY, district.bounds.minY)),
      maxY: round(Math.min(bounds.maxY, district.bounds.maxY)),
    },
  }));
}

function routingBounds(initialBounds, districts, places) {
  const minX = Math.min(
    initialBounds.minX,
    ...districts.map((district) => district.bounds.minX),
    ...places.map((place) => place.footprint.x),
  );
  const maxX = Math.max(
    initialBounds.maxX,
    ...districts.map((district) => district.bounds.maxX),
    ...places.map((place) => place.footprint.x + place.footprint.width),
  );
  const minY = Math.min(
    initialBounds.minY,
    ...districts.map((district) => district.bounds.minY),
    ...places.map((place) => place.footprint.y),
  );
  const maxY = Math.max(
    initialBounds.maxY,
    ...districts.map((district) => district.bounds.maxY),
    ...places.map((place) => place.footprint.y + place.footprint.height),
  );
  return {
    minX: round(minX - 4),
    maxX: round(maxX + 12),
    minY: round(minY - 4),
    maxY: round(maxY + 12),
  };
}

function directDistributionSignalTokens(evidence) {
  return uniqueSortedStrings([
    ...(evidence?.inferred ?? []),
    ...(evidence?.observed ?? []),
  ]
    .filter((entry) => typeof entry === 'string' && entry.startsWith('capability.distribution.path.'))
    .map((entry) => entry.slice('capability.distribution.path.'.length).toLowerCase())
    .filter((entry) => entry.length > 0));
}

function hasDirectDockEvidence(town, dock) {
  if (!dock || dock.kind !== 'dock' || dock.presence !== 'present') return false;
  const dockEvidence = dock.evidence;
  const hasDockEvidence = dockEvidence?.observed?.length > 0 || dockEvidence?.inferred?.length > 0;
  if (!hasDockEvidence) return false;
  if (Array.isArray(dock.sourceFileIds) && dock.sourceFileIds.length > 0) return true;

  // Town-domain currently carries distribution evidence on the dock but does
  // not attach the source file IDs for that capability.  Recover only a
  // bounded direct file signal already present in TownModel: the same
  // distribution path token must occur in a repository file path and that
  // file must retain observed or inferred evidence.  A bare capability label,
  // unknown file, or global repository evidence stays late-medieval.
  const tokens = directDistributionSignalTokens(dockEvidence);
  if (tokens.length === 0 || !Array.isArray(town?.files)) return false;
  return town.files.some((file) => {
    if (!file || typeof file.path !== 'string') return false;
    const fileEvidence = file.evidence;
    if (!(fileEvidence?.observed?.length > 0 || fileEvidence?.inferred?.length > 0)) return false;
    const pathTokens = file.path.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
    return tokens.some((token) => pathTokens.includes(token));
  });
}

function snowFacilityRoleSupported(kind) {
  return typeof SNOW_FACILITY_APPEARANCES[kind] === 'string';
}

function snowInvestigationSupported(candidate) {
  const recipe = INVESTIGATION_TARGET_BY_FACILITY[candidate.facilityKind];
  return snowFacilityRoleSupported(candidate.facilityKind)
    && SNOW_INVESTIGATION_TARGET_RECIPES.includes(recipe);
}

function selectedWorldview(town) {
  // A repository with direct distribution structure becomes a frontier
  // harbor. The snow harbor is caused by repository meaning (a real dock and
  // deployment frontier), not by a random seed or a palette selector.
  const dock = town.facilities.find((facility) => facility.kind === 'dock');
  if (!hasDirectDockEvidence(town, dock)) return WORLDVIEWS.lateMedieval;
  const facilityKinds = [
    ...town.facilities
      .filter((facility) => facility.presence !== 'not_applicable')
      .map((facility) => facility.kind),
    ...town.candidates.map((candidate) => candidate.facilityKind),
  ];
  if (!facilityKinds.every((kind) => snowFacilityRoleSupported(kind))) return WORLDVIEWS.lateMedieval;
  if (!town.candidates.every((candidate) => snowInvestigationSupported(candidate))) return WORLDVIEWS.lateMedieval;
  return WORLDVIEWS.snowHarbor;
}

function buildPlan(town) {
  const identitySeed = sha256(town.identity.key);
  const semanticHash = sha256(semanticSignature(town));
  const contentSeed = hashParts(identitySeed, 'content', semanticHash);
  const worldview = selectedWorldview(town);
  const grammar = makeAuthoredComposition(town, worldview);
  const bounds = makeCompositionBounds(town, grammar);
  const provisionalDistricts = makeDistricts(town, bounds, grammar, worldview);
  const places = makePlaces(town, provisionalDistricts, identitySeed, grammar, worldview);
  const districts = deriveDistrictsFromPlaces(provisionalDistricts, places);
  const gate = places.find((place) => place.facilityKind === 'gate');
  const civicPlace = places.find((place) => place.id === 'place.civic-plaza')
    ?? places.find((place) => place.facilityKind === 'town_hall');
  if (!gate || !civicPlace) throw new TypeError('Place recipes must provide the arrival and civic anchors');
  const composition = {
    bounds,
    entry: gate.geometry.entrance.approach[0],
    // The smallest town has only one gate keeper at the opening. Stage the
    // player one short step into the same main-road segment so both actors are
    // immediately readable while the request rectangle still overlaps the
    // player's footbox. Larger
    // towns retain the gate threshold as their authored spawn.
    spawn: !isSnowWorldview(worldview) && isSmallLateShape(places)
      ? point(gate.geometry.entrance.point.x + 1.5, gate.geometry.entrance.point.y + 1)
      : grammar.layout === 'late-broad'
        // The broad gate has a resident on its west shoulder.  One logical
        // step east keeps the player inside the request reach and on the same
        // authored road while separating the two silhouettes at first view.
        ? point(gate.geometry.entrance.point.x + 1, gate.geometry.entrance.point.y)
        : gate.geometry.entrance.point,
    civic: civicPlace.anchor,
  };
  const routes = makeRoutes(places, identitySeed, routingBounds(bounds, districts, places), town, worldview);
  const residents = makeResidents(town, places, routes, worldview);
  const props = makeProps(places, identitySeed, worldview);
  const lights = makeLights(town, places, identitySeed, worldview);
  const investigations = makeInvestigations(town, places, worldview);
  const journey = makeJourney(town, places, investigations);
  const packedBounds = packedCompositionBounds(
    bounds,
    composition,
    districts,
    places,
    routes,
    residents,
    props,
    lights,
    investigations,
    worldview,
  );
  composition.bounds = packedBounds;
  const packedDistricts = clipDistrictsToBounds(districts, packedBounds);
  const surfaces = makeSurfaces(packedBounds, packedDistricts, places, routes, identitySeed, worldview);
  return deepFreeze({
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    identity: { key: town.identity.key, name: town.identity.name },
    contentSeed,
    worldview: { ...worldview },
    composition,
    districts: packedDistricts,
    surfaces,
    places,
    routes,
    residents,
    props,
    lights,
    investigations,
    journey,
    evidence: town.evidence,
  });
}

function assertRecord(value, path, issues) {
  if (!isRecord(value)) issues.push(issue(path, 'must be a plain object', 'INVALID_OBJECT'));
  return isRecord(value);
}

function assertExactKeys(value, expected, path, issues) {
  if (!isRecord(value)) return;
  const actual = Object.keys(value).sort(compareStrings);
  const wanted = [...expected].sort(compareStrings);
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) issues.push(issue(path, `must contain exactly ${wanted.join(', ')}`, 'INVALID_KEYS'));
}

function assertNonEmptyString(value, path, issues) {
  if (typeof value !== 'string' || value.trim().length === 0) issues.push(issue(path, 'must be a non-empty string', 'MISSING_STRING'));
}

function assertFiniteNumber(value, path, issues) {
  if (typeof value !== 'number' || !Number.isFinite(value)) issues.push(issue(path, 'must be a finite number', 'INVALID_NUMBER'));
}

function assertPoint(value, path, issues, bounds = null) {
  if (!assertRecord(value, path, issues)) return;
  assertExactKeys(value, ['x', 'y'], path, issues);
  assertFiniteNumber(value.x, `${path}.x`, issues);
  assertFiniteNumber(value.y, `${path}.y`, issues);
  if (bounds && Number.isFinite(value.x) && (value.x < bounds.minX || value.x > bounds.maxX)) issues.push(issue(`${path}.x`, 'must remain inside composition bounds', 'OUT_OF_BOUNDS'));
  if (bounds && Number.isFinite(value.y) && (value.y < bounds.minY || value.y > bounds.maxY)) issues.push(issue(`${path}.y`, 'must remain inside composition bounds', 'OUT_OF_BOUNDS'));
}

function assertBounds(value, path, issues) {
  if (!assertRecord(value, path, issues)) return;
  assertExactKeys(value, ['minX', 'maxX', 'minY', 'maxY'], path, issues);
  for (const key of ['minX', 'maxX', 'minY', 'maxY']) assertFiniteNumber(value[key], `${path}.${key}`, issues);
  if (Number.isFinite(value.minX) && Number.isFinite(value.maxX) && value.maxX <= value.minX) issues.push(issue(path, 'maxX must be greater than minX', 'INVALID_BOUNDS'));
  if (Number.isFinite(value.minY) && Number.isFinite(value.maxY) && value.maxY <= value.minY) issues.push(issue(path, 'maxY must be greater than minY', 'INVALID_BOUNDS'));
}

function assertRectangle(value, path, issues, bounds = null) {
  if (!assertRecord(value, path, issues)) return;
  assertExactKeys(value, ['x', 'y', 'width', 'height'], path, issues);
  for (const key of ['x', 'y', 'width', 'height']) assertFiniteNumber(value[key], `${path}.${key}`, issues);
  if (Number.isFinite(value.width) && value.width <= 0) issues.push(issue(`${path}.width`, 'must be greater than zero', 'INVALID_SIZE'));
  if (Number.isFinite(value.height) && value.height <= 0) issues.push(issue(`${path}.height`, 'must be greater than zero', 'INVALID_SIZE'));
  if (bounds && Number.isFinite(value.x) && Number.isFinite(value.width) && (value.x < bounds.minX || value.x + value.width > bounds.maxX)) issues.push(issue(path, 'must remain inside composition bounds', 'OUT_OF_BOUNDS'));
  if (bounds && Number.isFinite(value.y) && Number.isFinite(value.height) && (value.y < bounds.minY || value.y + value.height > bounds.maxY)) issues.push(issue(path, 'must remain inside composition bounds', 'OUT_OF_BOUNDS'));
}

function assertEvidence(value, path, issues) {
  if (!assertRecord(value, path, issues)) return;
  assertExactKeys(value, EVIDENCE_STATES, path, issues);
  for (const state of EVIDENCE_STATES) {
    if (!Array.isArray(value[state])) {
      issues.push(issue(`${path}.${state}`, 'must be an array', 'INVALID_ARRAY'));
    } else {
      for (const [index, entry] of value[state].entries()) assertNonEmptyString(entry, `${path}.${state}[${index}]`, issues);
    }
  }
}

function assertStringArray(value, path, issues) {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'must be an array', 'INVALID_ARRAY'));
    return;
  }
  for (const [index, entry] of value.entries()) assertNonEmptyString(entry, `${path}[${index}]`, issues);
  if (new Set(value).size !== value.length) issues.push(issue(path, 'must not contain duplicate IDs', 'DUPLICATE_ID'));
  if (JSON.stringify(value) !== JSON.stringify([...value].sort(compareStrings))) issues.push(issue(path, 'must be sorted for deterministic plans', 'UNSORTED_IDS'));
}

function assertGeometry(value, path, issues, bounds) {
  if (!assertRecord(value, path, issues)) return;
  assertExactKeys(value, ['access', 'entrance', 'interior', 'occlusion', 'reportState'], path, issues);
  if (assertRecord(value.entrance, `${path}.entrance`, issues)) {
    assertExactKeys(value.entrance, ['approach', 'automatic', 'point', 'width'], `${path}.entrance`, issues);
    assertPoint(value.entrance.point, `${path}.entrance.point`, issues, bounds);
    if (!Array.isArray(value.entrance.approach) || value.entrance.approach.length < 2) issues.push(issue(`${path}.entrance.approach`, 'must contain an approach', 'INVALID_PATH'));
    else value.entrance.approach.forEach((entry, index) => assertPoint(entry, `${path}.entrance.approach[${index}]`, issues, bounds));
    assertFiniteNumber(value.entrance.width, `${path}.entrance.width`, issues);
    if (typeof value.entrance.automatic !== 'boolean') issues.push(issue(`${path}.entrance.automatic`, 'must be a boolean', 'INVALID_BOOLEAN'));
  }
  if (assertRecord(value.access, `${path}.access`, issues)) {
    assertExactKeys(value.access, ['automaticEntry', 'reach', 'region'], `${path}.access`, issues);
    assertRectangle(value.access.region, `${path}.access.region`, issues, bounds);
    assertFiniteNumber(value.access.reach, `${path}.access.reach`, issues);
    if (typeof value.access.automaticEntry !== 'boolean') issues.push(issue(`${path}.access.automaticEntry`, 'must be a boolean', 'INVALID_BOOLEAN'));
  }
  if (assertRecord(value.interior, `${path}.interior`, issues)) {
    if (value.interior.kind === 'cutaway') {
      assertExactKeys(value.interior, ['entrance', 'exit', 'footprint', 'kind'], `${path}.interior`, issues);
      assertRectangle(value.interior.footprint, `${path}.interior.footprint`, issues, bounds);
      assertPoint(value.interior.entrance, `${path}.interior.entrance`, issues, bounds);
      assertPoint(value.interior.exit, `${path}.interior.exit`, issues, bounds);
    } else {
      assertExactKeys(value.interior, ['kind'], `${path}.interior`, issues);
      if (value.interior.kind !== 'open') issues.push(issue(`${path}.interior.kind`, 'must be cutaway or open', 'INVALID_INTERIOR'));
    }
  }
  if (assertRecord(value.occlusion, `${path}.occlusion`, issues)) {
    assertExactKeys(value.occlusion, ['foreground', 'reveal', 'roof'], `${path}.occlusion`, issues);
    assertRectangle(value.occlusion.roof, `${path}.occlusion.roof`, issues, bounds);
    assertRectangle(value.occlusion.foreground, `${path}.occlusion.foreground`, issues, bounds);
    assertNonEmptyString(value.occlusion.reveal, `${path}.occlusion.reveal`, issues);
  }
  if (value.reportState !== null && assertRecord(value.reportState, `${path}.reportState`, issues)) {
    assertExactKeys(value.reportState, ['after', 'before', 'transitionId'], `${path}.reportState`, issues);
    assertNonEmptyString(value.reportState.transitionId, `${path}.reportState.transitionId`, issues);
    assertNonEmptyString(value.reportState.before, `${path}.reportState.before`, issues);
    assertNonEmptyString(value.reportState.after, `${path}.reportState.after`, issues);
  }
}

function assertLinks(value, path, issues, ids) {
  if (!assertRecord(value, path, issues)) return;
  assertExactKeys(value, ['districtIds', 'placeIds', 'routeIds'], path, issues);
  for (const key of ['districtIds', 'placeIds', 'routeIds']) {
    if (!Array.isArray(value[key])) {
      issues.push(issue(`${path}.${key}`, 'must be an array', 'INVALID_ARRAY'));
    } else {
      for (const [index, entry] of value[key].entries()) {
        assertNonEmptyString(entry, `${path}.${key}[${index}]`, issues);
        if (ids[key] && !ids[key].has(entry)) issues.push(issue(`${path}.${key}[${index}]`, 'must reference a known world item', 'UNKNOWN_REFERENCE'));
      }
    }
  }
}

function assertNoForbiddenFields(value, path = '$', seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const issues = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => issues.push(...assertNoForbiddenFields(entry, `${path}[${index}]`, seen)));
    return issues;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/pixel|px|image|texture|canvas|dom|render/iu.test(key)) issues.push(issue(`${path}.${key}`, 'WorldPlan may contain logical data only', 'FORBIDDEN_RENDER_FIELD'));
    issues.push(...assertNoForbiddenFields(child, `${path}.${key}`, seen));
  }
  return issues;
}

function validatePlanShape(plan) {
  const issues = [];
  if (!assertRecord(plan, '$', issues)) fail('WorldPlan must be a plain object', issues);
  for (const key of Object.keys(plan)) if (!PLAN_KEYS.includes(key)) issues.push(issue(`$.${key}`, 'unknown WorldPlan field', 'UNKNOWN_FIELD'));
  if (plan.format !== FORMAT) issues.push(issue('$.format', `must be ${FORMAT}`, 'INVALID_FORMAT'));
  if (plan.schemaVersion !== SCHEMA_VERSION) issues.push(issue('$.schemaVersion', `must be ${SCHEMA_VERSION}`, 'UNSUPPORTED_SCHEMA'));
  if (!assertRecord(plan.identity, '$.identity', issues)) {
    // Continue to collect shape issues.
  } else {
    assertExactKeys(plan.identity, ['key', 'name'], '$.identity', issues);
    assertNonEmptyString(plan.identity.key, '$.identity.key', issues);
    assertNonEmptyString(plan.identity.name, '$.identity.name', issues);
  }
  if (typeof plan.contentSeed !== 'string' || !HASH_RE.test(plan.contentSeed)) issues.push(issue('$.contentSeed', 'must be a lowercase SHA-256', 'INVALID_HASH'));
  const planWorldview = Object.values(WORLDVIEWS).find((candidate) => candidate.id === plan.worldview?.id);
  if (!assertRecord(plan.worldview, '$.worldview', issues)) {
    // Continue to collect shape issues.
  } else {
    assertExactKeys(plan.worldview, ['id', 'recipeVersion'], '$.worldview', issues);
    if (!planWorldview) issues.push(issue('$.worldview.id', 'must use one complete shipping worldview', 'INVALID_WORLDVIEW'));
    if (planWorldview && plan.worldview.recipeVersion !== planWorldview.recipeVersion) issues.push(issue('$.worldview.recipeVersion', 'must use the bounded place recipe', 'INVALID_RECIPE_VERSION'));
  }
  if (!assertRecord(plan.composition, '$.composition', issues)) {
    // Continue to collect shape issues.
  } else {
    assertExactKeys(plan.composition, ['bounds', 'civic', 'entry', 'spawn'], '$.composition', issues);
    assertBounds(plan.composition.bounds, '$.composition.bounds', issues);
    const bounds = plan.composition.bounds;
    for (const key of ['entry', 'civic', 'spawn']) assertPoint(plan.composition[key], `$.composition.${key}`, issues, bounds);
  }
  const bounds = isRecord(plan.composition?.bounds) ? plan.composition.bounds : null;
  const districtIds = new Set();
  if (!Array.isArray(plan.districts) || plan.districts.length < 4) issues.push(issue('$.districts', 'must contain the town districts', 'INVALID_DISTRICTS'));
  else {
    for (const [index, district] of plan.districts.entries()) {
      const path = `$.districts[${index}]`;
      if (!assertRecord(district, path, issues)) continue;
      assertExactKeys(district, ['anchor', 'bounds', 'evidence', 'id', 'role'], path, issues);
      assertNonEmptyString(district.id, `${path}.id`, issues);
      if (districtIds.has(district.id)) issues.push(issue(`${path}.id`, 'district IDs must be unique', 'DUPLICATE_ID'));
      districtIds.add(district.id);
      if (!DISTRICT_ROLES.includes(district.role)) issues.push(issue(`${path}.role`, 'must use a known district role', 'INVALID_DISTRICT_ROLE'));
      assertPoint(district.anchor, `${path}.anchor`, issues, bounds);
      assertBounds(district.bounds, `${path}.bounds`, issues);
      assertEvidence(district.evidence, `${path}.evidence`, issues);
    }
  }
  const placeIds = new Set();
  if (!Array.isArray(plan.places) || plan.places.length < 5) issues.push(issue('$.places', 'must contain the arrival, civic, and meaningful places', 'INVALID_PLACES'));
  else {
    for (const [index, place] of plan.places.entries()) {
      const path = `$.places[${index}]`;
      if (!assertRecord(place, path, issues)) continue;
      const expected = ['anchor', 'appearance', 'condition', 'district', 'evidence', 'footprint', 'geometry', 'id', 'label', 'recipe', 'requirements', 'sourceGroupIds'];
      const expectedWithFacility = [...expected, 'facilityKind'];
      assertExactKeys(place, OWN_KEYS.call(place, 'facilityKind') ? expectedWithFacility : expected, path, issues);
      assertNonEmptyString(place.id, `${path}.id`, issues);
      if (placeIds.has(place.id)) issues.push(issue(`${path}.id`, 'place IDs must be unique', 'DUPLICATE_ID'));
      placeIds.add(place.id);
      if (!PLACE_RECIPES.includes(place.recipe)) issues.push(issue(`${path}.recipe`, 'must use a known place recipe', 'INVALID_PLACE_RECIPE'));
      if (!districtIds.has(place.district)) issues.push(issue(`${path}.district`, 'must reference a known district', 'UNKNOWN_REFERENCE'));
      assertPoint(place.anchor, `${path}.anchor`, issues, bounds);
      assertRectangle(place.footprint, `${path}.footprint`, issues, bounds);
      assertNonEmptyString(place.label, `${path}.label`, issues);
      const allowedPlaceAppearances = planWorldview?.id === WORLDVIEWS.snowHarbor.id
        ? SNOW_PLACE_APPEARANCES
        : PLACE_APPEARANCES;
      if (place.appearance !== null && !allowedPlaceAppearances.includes(place.appearance)) issues.push(issue(`${path}.appearance`, 'must use a closed authored place appearance for the selected worldview or null for the civic plaza', 'INVALID_APPEARANCE'));
      if (place.recipe === 'civic_plaza' && place.appearance !== null) issues.push(issue(`${path}.appearance`, 'the civic plaza has no authored structure appearance', 'INVALID_APPEARANCE'));
      assertStringArray(place.sourceGroupIds, `${path}.sourceGroupIds`, issues);
      if (!PLACE_CONDITIONS.includes(place.condition)) issues.push(issue(`${path}.condition`, 'must preserve the place condition', 'INVALID_CONDITION'));
      if (OWN_KEYS.call(place, 'facilityKind')) {
        if (!FACILITY_KINDS.includes(place.facilityKind)) issues.push(issue(`${path}.facilityKind`, 'must use a known facility kind', 'INVALID_FACILITY_KIND'));
        const expectedAppearance = appearanceForFacility(place.facilityKind, planWorldview ?? WORLDVIEWS.lateMedieval);
        if (place.appearance !== expectedAppearance) issues.push(issue(`${path}.appearance`, 'must match the selected worldview appearance for its facility kind', 'APPEARANCE_MISMATCH'));
      } else if (DWELLING_APPEARANCES.includes(place.appearance)) {
        if (place.recipe !== 'residence') issues.push(issue(`${path}.recipe`, 'group homes must use the residence recipe', 'INVALID_HOME_RECIPE'));
        if (place.sourceGroupIds.length === 0) issues.push(issue(`${path}.sourceGroupIds`, 'group homes must retain their source groups', 'MISSING_SOURCE_GROUPS'));
        if (place.geometry?.interior?.kind !== 'open') issues.push(issue(`${path}.geometry.interior`, 'group homes do not declare an interior cutaway', 'INVALID_HOME_INTERIOR'));
      } else if (place.appearance === null && place.recipe !== 'civic_plaza') {
        issues.push(issue(`${path}.appearance`, 'null appearance is reserved for the civic plaza', 'INVALID_APPEARANCE'));
      }
      assertEvidence(place.evidence, `${path}.evidence`, issues);
      assertGeometry(place.geometry, `${path}.geometry`, issues, bounds);
      if (!assertRecord(place.requirements, `${path}.requirements`, issues)) continue;
      assertExactKeys(place.requirements, ['clearApproach', 'connectToRoute', 'distinctInterior', 'reportState'], `${path}.requirements`, issues);
      for (const key of ['clearApproach', 'connectToRoute', 'distinctInterior', 'reportState']) if (typeof place.requirements[key] !== 'boolean') issues.push(issue(`${path}.requirements.${key}`, 'must be a boolean', 'INVALID_BOOLEAN'));
    }
    for (let leftIndex = 0; leftIndex < plan.places.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < plan.places.length; rightIndex += 1) {
        const left = plan.places[leftIndex];
        const right = plan.places[rightIndex];
        if (!isRecord(left) || !isRecord(right) || !rectanglesOverlap(left.footprint, right.footprint)) continue;
        issues.push(issue(
          `$.places[${rightIndex}].footprint`,
          `must not overlap ${typeof left.id === 'string' ? left.id : `$.places[${leftIndex}]`}`,
          'PLACE_FOOTPRINT_OVERLAP',
        ));
      }
    }
    if (plan.places.some((place) => isRecord(place) && rectangleContainsPoint(place.footprint, plan.composition?.spawn))) {
      issues.push(issue('$.composition.spawn', 'must be in the walkable arrival space outside every place footprint', 'SPAWN_BLOCKED'));
    }
  }
  const routeIds = new Set();
  if (!Array.isArray(plan.routes) || plan.routes.length < 1) issues.push(issue('$.routes', 'must contain connected routes', 'INVALID_ROUTES'));
  else {
    for (const [index, route] of plan.routes.entries()) {
      const path = `$.routes[${index}]`;
      if (!assertRecord(route, path, issues)) continue;
      assertExactKeys(route, ['centerline', 'districtIds', 'fromPlaceId', 'id', 'recipe', 'toPlaceId'], path, issues);
      assertNonEmptyString(route.id, `${path}.id`, issues);
      if (routeIds.has(route.id)) issues.push(issue(`${path}.id`, 'route IDs must be unique', 'DUPLICATE_ID'));
      routeIds.add(route.id);
      if (!ROUTE_RECIPES.includes(route.recipe)) issues.push(issue(`${path}.recipe`, 'must use main or local', 'INVALID_ROUTE_RECIPE'));
      if (!placeIds.has(route.fromPlaceId) || !placeIds.has(route.toPlaceId)) issues.push(issue(path, 'route endpoints must reference places', 'UNKNOWN_REFERENCE'));
      if (!Array.isArray(route.centerline) || route.centerline.length < 2) issues.push(issue(`${path}.centerline`, 'must contain a centerline', 'INVALID_PATH'));
      else {
        route.centerline.forEach((entry, pointIndex) => assertPoint(entry, `${path}.centerline[${pointIndex}]`, issues, bounds));
        const endpointIds = new Set([route.fromPlaceId, route.toPlaceId]);
        const routeWidth = route.recipe === 'main' ? 5 : 3;
        for (let pointIndex = 1; pointIndex < route.centerline.length; pointIndex += 1) {
          for (const place of plan.places) {
            if (!isRecord(place) || !place.facilityKind || endpointIds.has(place.id)) continue;
            const testedWidth = endpointIds.has(place.id) ? 0 : routeWidth;
            if (!rectanglesOverlap(routeSegmentRect(route.centerline[pointIndex - 1], route.centerline[pointIndex], testedWidth), place.footprint)) continue;
            issues.push(issue(`${path}.centerline[${pointIndex}]`, `must not pass through ${place.id}`, 'ROUTE_BLOCKED_BY_PLACE'));
          }
        }
      }
      if (!Array.isArray(route.districtIds)) issues.push(issue(`${path}.districtIds`, 'must be an array', 'INVALID_ARRAY'));
      else route.districtIds.forEach((entry, itemIndex) => {
        assertNonEmptyString(entry, `${path}.districtIds[${itemIndex}]`, issues);
        if (!districtIds.has(entry)) issues.push(issue(`${path}.districtIds[${itemIndex}]`, 'must reference a known district', 'UNKNOWN_REFERENCE'));
      });
    }
  }
  const ids = { districtIds, placeIds, routeIds };
  if (!Array.isArray(plan.surfaces) || plan.surfaces.length < 1) issues.push(issue('$.surfaces', 'must contain declared surfaces', 'INVALID_SURFACES'));
  else {
    const surfaceIds = new Set();
    for (const [index, surface] of plan.surfaces.entries()) {
      const path = `$.surfaces[${index}]`;
      if (!assertRecord(surface, path, issues)) continue;
      assertExactKeys(surface, ['district', 'geometry', 'id', 'links', 'recipe'], path, issues);
      assertNonEmptyString(surface.id, `${path}.id`, issues);
      if (surfaceIds.has(surface.id)) issues.push(issue(`${path}.id`, 'surface IDs must be unique', 'DUPLICATE_ID'));
      surfaceIds.add(surface.id);
      if (!SURFACE_RECIPES.includes(surface.recipe)) issues.push(issue(`${path}.recipe`, 'must use a known surface recipe', 'INVALID_SURFACE_RECIPE'));
      if (!districtIds.has(surface.district)) issues.push(issue(`${path}.district`, 'must reference a known district', 'UNKNOWN_REFERENCE'));
      if (!assertRecord(surface.geometry, `${path}.geometry`, issues)) {
        // Continue to collect link issues.
      } else if (surface.geometry.kind === 'area') {
        assertExactKeys(surface.geometry, ['bounds', 'kind'], `${path}.geometry`, issues);
        assertBounds(surface.geometry.bounds, `${path}.geometry.bounds`, issues);
      } else if (surface.geometry.kind === 'path') {
        assertExactKeys(surface.geometry, ['kind', 'points', 'width'], `${path}.geometry`, issues);
        if (!Array.isArray(surface.geometry.points) || surface.geometry.points.length < 2) issues.push(issue(`${path}.geometry.points`, 'must contain a path', 'INVALID_PATH'));
        else surface.geometry.points.forEach((entry, pointIndex) => assertPoint(entry, `${path}.geometry.points[${pointIndex}]`, issues, bounds));
        assertFiniteNumber(surface.geometry.width, `${path}.geometry.width`, issues);
      } else {
        issues.push(issue(`${path}.geometry.kind`, 'must be area or path', 'INVALID_GEOMETRY'));
      }
      assertLinks(surface.links, `${path}.links`, issues, ids);
    }
  }
  if (!Array.isArray(plan.residents)) issues.push(issue('$.residents', 'must be an array', 'INVALID_ARRAY'));
  else for (const [index, resident] of plan.residents.entries()) {
    const path = `$.residents[${index}]`;
    if (!assertRecord(resident, path, issues)) continue;
    const residentKeys = ['activity', 'anchor', 'appearance', 'behavior', 'evidence', 'id', 'motion', 'name', 'placeId', 'role', 'state'];
    if (OWN_KEYS.call(resident, 'interiorPlaceId')) residentKeys.push('interiorPlaceId');
    assertExactKeys(resident, residentKeys, path, issues);
    assertNonEmptyString(resident.id, `${path}.id`, issues);
    assertNonEmptyString(resident.name, `${path}.name`, issues);
    assertNonEmptyString(resident.activity, `${path}.activity`, issues);
    if (!placeIds.has(resident.placeId)) issues.push(issue(`${path}.placeId`, 'must reference a known place', 'UNKNOWN_REFERENCE'));
    if (OWN_KEYS.call(resident, 'interiorPlaceId') && (!placeIds.has(resident.interiorPlaceId) || resident.interiorPlaceId !== resident.placeId)) {
      issues.push(issue(`${path}.interiorPlaceId`, 'must reference the resident place', 'UNKNOWN_REFERENCE'));
    }
    assertPoint(resident.anchor, `${path}.anchor`, issues, bounds);
    if (!NPC_ROLE_VOCABULARY.includes(resident.role)) issues.push(issue(`${path}.role`, 'must use a known resident role', 'INVALID_RESIDENT_ROLE'));
    const allowedResidentAppearances = planWorldview?.id === WORLDVIEWS.snowHarbor.id
      ? SNOW_RESIDENT_APPEARANCES
      : RESIDENT_APPEARANCES;
    if (!allowedResidentAppearances.includes(resident.appearance)) issues.push(issue(`${path}.appearance`, 'must use a known authored resident appearance for the selected worldview', 'INVALID_RESIDENT_APPEARANCE'));
    if (!RESIDENT_BEHAVIORS.includes(resident.behavior)) issues.push(issue(`${path}.behavior`, 'must use a known resident behavior', 'INVALID_RESIDENT_BEHAVIOR'));
    if (!assertRecord(resident.motion, `${path}.motion`, issues)) {
      // Continue collecting the state and evidence issues.
    } else if (resident.motion.kind === 'still') {
      assertExactKeys(resident.motion, ['kind'], `${path}.motion`, issues);
    } else if (resident.motion.kind === 'ping-pong') {
      assertExactKeys(resident.motion, ['kind', 'points'], `${path}.motion`, issues);
      if (!Array.isArray(resident.motion.points) || ![2, 3].includes(resident.motion.points.length)) {
        issues.push(issue(`${path}.motion.points`, 'ping-pong motion must use exactly two or three logical points', 'INVALID_MOTION_POINTS'));
      } else resident.motion.points.forEach((entry, pointIndex) => assertPoint(entry, `${path}.motion.points[${pointIndex}]`, issues, bounds));
    } else {
      issues.push(issue(`${path}.motion.kind`, 'must be still or ping-pong', 'INVALID_MOTION_KIND'));
    }
    if (!EVIDENCE_STATES.includes(resident.state)) issues.push(issue(`${path}.state`, 'must preserve observed, inferred, or unknown', 'INVALID_EVIDENCE_STATE'));
    assertEvidence(resident.evidence, `${path}.evidence`, issues);
  }
  if (!Array.isArray(plan.props)) issues.push(issue('$.props', 'must be an array', 'INVALID_ARRAY'));
  else for (const [index, prop] of plan.props.entries()) {
    const path = `$.props[${index}]`;
    if (!assertRecord(prop, path, issues)) continue;
    assertExactKeys(prop, ['anchor', 'evidence', 'id', 'placeId', 'recipe', 'state'], path, issues);
    assertNonEmptyString(prop.id, `${path}.id`, issues);
    if (!placeIds.has(prop.placeId)) issues.push(issue(`${path}.placeId`, 'must reference a known place', 'UNKNOWN_REFERENCE'));
    if (!PROP_RECIPES.includes(prop.recipe)) issues.push(issue(`${path}.recipe`, 'must use a known prop recipe', 'INVALID_PROP_RECIPE'));
    if (!EVIDENCE_STATES.includes(prop.state)) issues.push(issue(`${path}.state`, 'must preserve observed, inferred, or unknown', 'INVALID_EVIDENCE_STATE'));
    assertPoint(prop.anchor, `${path}.anchor`, issues, bounds);
    assertEvidence(prop.evidence, `${path}.evidence`, issues);
  }
  if (!Array.isArray(plan.lights)) issues.push(issue('$.lights', 'must be an array', 'INVALID_ARRAY'));
  else for (const [index, light] of plan.lights.entries()) {
    const path = `$.lights[${index}]`;
    if (!assertRecord(light, path, issues)) continue;
    const expected = OWN_KEYS.call(light, 'reportState') ? ['anchor', 'evidence', 'id', 'placeId', 'recipe', 'reportState', 'state'] : ['anchor', 'evidence', 'id', 'placeId', 'recipe', 'state'];
    assertExactKeys(light, expected, path, issues);
    assertNonEmptyString(light.id, `${path}.id`, issues);
    if (!placeIds.has(light.placeId)) issues.push(issue(`${path}.placeId`, 'must reference a known place', 'UNKNOWN_REFERENCE'));
    assertNonEmptyString(light.recipe, `${path}.recipe`, issues);
    if (!LIGHT_STATES.includes(light.state)) issues.push(issue(`${path}.state`, 'must use lit, unlit, or unknown', 'INVALID_LIGHT_STATE'));
    assertPoint(light.anchor, `${path}.anchor`, issues, bounds);
    assertEvidence(light.evidence, `${path}.evidence`, issues);
    if (OWN_KEYS.call(light, 'reportState')) {
      if (!assertRecord(light.reportState, `${path}.reportState`, issues)) continue;
      assertExactKeys(light.reportState, ['after', 'before', 'transitionId'], `${path}.reportState`, issues);
      assertNonEmptyString(light.reportState.transitionId, `${path}.reportState.transitionId`, issues);
      assertNonEmptyString(light.reportState.before, `${path}.reportState.before`, issues);
      assertNonEmptyString(light.reportState.after, `${path}.reportState.after`, issues);
    }
  }
  if (!Array.isArray(plan.investigations) || plan.investigations.length !== 3) issues.push(issue('$.investigations', 'must contain exactly three investigations', 'INVALID_INVESTIGATIONS'));
  else {
    const candidateIds = new Set();
    const investigationPlaces = new Set();
    for (const [index, candidate] of plan.investigations.entries()) {
      const path = `$.investigations[${index}]`;
      if (!assertRecord(candidate, path, issues)) continue;
      assertExactKeys(candidate, ['action', 'candidateId', 'capability', 'evidence', 'facilityKind', 'id', 'placeId', 'state', 'statement', 'subject', 'target'], path, issues);
      assertNonEmptyString(candidate.id, `${path}.id`, issues);
      assertNonEmptyString(candidate.candidateId, `${path}.candidateId`, issues);
      if (candidateIds.has(candidate.candidateId)) issues.push(issue(`${path}.candidateId`, 'candidate IDs must be unique', 'DUPLICATE_ID'));
      candidateIds.add(candidate.candidateId);
      if (!placeIds.has(candidate.placeId)) issues.push(issue(`${path}.placeId`, 'must reference a known place', 'UNKNOWN_REFERENCE'));
      if (investigationPlaces.has(candidate.placeId)) issues.push(issue(`${path}.placeId`, 'investigations must use distinct places', 'DUPLICATE_PLACE'));
      investigationPlaces.add(candidate.placeId);
      if (!OWN_KEYS.call(INVESTIGATION_TARGET_BY_FACILITY, candidate.facilityKind)) issues.push(issue(`${path}.facilityKind`, 'must use a facility with a complete investigation target recipe', 'INVALID_FACILITY_KIND'));
      if (candidate.capability !== null) assertNonEmptyString(candidate.capability, `${path}.capability`, issues);
      assertNonEmptyString(candidate.subject, `${path}.subject`, issues);
      assertNonEmptyString(candidate.action, `${path}.action`, issues);
      assertNonEmptyString(candidate.statement, `${path}.statement`, issues);
      if (!EVIDENCE_STATES.includes(candidate.state)) issues.push(issue(`${path}.state`, 'must preserve observed, inferred, or unknown', 'INVALID_EVIDENCE_STATE'));
      assertEvidence(candidate.evidence, `${path}.evidence`, issues);
      if (EVIDENCE_STATES.includes(candidate.state) && candidate.state !== evidenceState(candidate.evidence)) {
        issues.push(issue(`${path}.state`, 'must match the highest-priority non-empty evidence bucket', 'EVIDENCE_STATE_MISMATCH'));
      }
      if (assertRecord(candidate.target, `${path}.target`, issues)) {
        assertExactKeys(candidate.target, ['anchor', 'reach', 'recipe'], `${path}.target`, issues);
        if (!INVESTIGATION_TARGET_RECIPES.includes(candidate.target.recipe)) issues.push(issue(`${path}.target.recipe`, 'must use the facility-specific investigation target', 'INVALID_TARGET_RECIPE'));
        assertPoint(candidate.target.anchor, `${path}.target.anchor`, issues, bounds);
        assertFiniteNumber(candidate.target.reach, `${path}.target.reach`, issues);
        if (Number.isFinite(candidate.target.reach) && candidate.target.reach <= 0) issues.push(issue(`${path}.target.reach`, 'must be positive', 'INVALID_NUMBER'));
        const targetPlace = plan.places.find((place) => place.id === candidate.placeId);
        const targetRegion = targetPlace?.geometry?.interior?.kind === 'cutaway'
          ? targetPlace.geometry.interior.footprint
          : targetPlace?.footprint;
        if (!targetRegion || !rectangleContainsPoint(targetRegion, candidate.target.anchor)) {
          issues.push(issue(`${path}.target.anchor`, 'must remain inside the investigation place', 'TARGET_OUTSIDE_PLACE'));
        }
      }
    }
  }
  if (!assertRecord(plan.journey, '$.journey', issues)) {
    // Continue to collect top-level evidence issues.
  } else {
    assertExactKeys(plan.journey, ['evidence', 'reportPlaceId', 'requestPlaceId', 'townHallLanternPlaceId', 'transition'], '$.journey', issues);
    for (const key of ['requestPlaceId', 'reportPlaceId', 'townHallLanternPlaceId']) {
      assertNonEmptyString(plan.journey[key], `$.journey.${key}`, issues);
      if (!placeIds.has(plan.journey[key])) issues.push(issue(`$.journey.${key}`, 'must reference a known place', 'UNKNOWN_REFERENCE'));
    }
    if (plan.journey.requestPlaceId === plan.journey.reportPlaceId) issues.push(issue('$.journey', 'request and report places must be distinct', 'INVALID_JOURNEY'));
    if (assertRecord(plan.journey.transition, '$.journey.transition', issues)) {
        assertNonEmptyString(plan.journey.transition.id, '$.journey.transition.id', issues);
        if (plan.journey.transition.id !== REPOSITORY_INSPECTION_TRANSITION_ID) issues.push(issue('$.journey.transition.id', 'must preserve the repository inspection transition', 'INVALID_TRANSITION'));
        if (plan.journey.transition.state !== 'observed') issues.push(issue('$.journey.transition.state', 'must be observed', 'INVALID_TRANSITION'));
        if (plan.journey.transition.event !== REPOSITORY_INSPECTION_BINDING.event) issues.push(issue('$.journey.transition.event', 'must preserve the repository inspection event', 'INVALID_TRANSITION'));
        if (plan.journey.transition.bindingId !== REPOSITORY_INSPECTION_BINDING.id) issues.push(issue('$.journey.transition.bindingId', 'must preserve the repository inspection binding', 'INVALID_TRANSITION'));
        if (plan.journey.transition.facilityKind !== REPOSITORY_INSPECTION_BINDING.facilityKind) issues.push(issue('$.journey.transition.facilityKind', 'must target the town hall', 'INVALID_TRANSITION'));
        if (plan.journey.transition.effect !== REPOSITORY_INSPECTION_BINDING.effect) issues.push(issue('$.journey.transition.effect', 'must preserve the town hall lantern effect', 'INVALID_TRANSITION'));
        assertEvidence(plan.journey.transition.evidence, '$.journey.transition.evidence', issues);
        if (Array.isArray(plan.journey.transition.evidence?.observed) && !plan.journey.transition.evidence.observed.includes(INSPECTION_COMPLETION_EVIDENCE_ID)) {
          issues.push(issue('$.journey.transition.evidence.observed', 'must retain repository inspection completion', 'INVALID_TRANSITION'));
        }
    }
    assertEvidence(plan.journey.evidence, '$.journey.evidence', issues);
  }
  assertEvidence(plan.evidence, '$.evidence', issues);
  if (issues.length > 0) fail('WorldPlan failed the place-recipe contract', issues);
}

function assertReachable(plan) {
  const graph = new Map(plan.places.map((place) => [place.id, new Set()]));
  for (const route of plan.routes) {
    graph.get(route.fromPlaceId)?.add(route.toPlaceId);
    graph.get(route.toPlaceId)?.add(route.fromPlaceId);
  }
  const seen = new Set([plan.journey.requestPlaceId]);
  const queue = [plan.journey.requestPlaceId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const target of graph.get(current) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  const issues = [];
  for (const place of plan.places) if (!seen.has(place.id)) issues.push(issue(`$.places.${place.id}`, 'place must be reachable from the arrival', 'UNREACHABLE_PLACE'));
  if (issues.length > 0) fail('WorldPlan routes are not connected', issues, 'WORLD_PLAN_UNREACHABLE');
}

export function generateWorldPlan({ town } = {}) {
  return buildPlan(normaliseTown(town));
}

export function validateWorldPlan(plan) {
  validatePlanShape(plan);
  const forbidden = assertNoForbiddenFields(plan);
  if (forbidden.length > 0) fail('WorldPlan contains renderer-specific fields', forbidden, 'FORBIDDEN_RENDER_FIELD');
  assertReachable(plan);
  return deepFreeze(stableClone(plan));
}

export { compactLateRoutePoints, pathClearsPlaces };
