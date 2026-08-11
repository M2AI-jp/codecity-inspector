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
const WORLDVIEW = Object.freeze({ id: 'late-medieval-night', recipeVersion: 'place-recipe-v1' });
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);
const SURFACE_RECIPES = Object.freeze(['ground', 'water', 'bank', 'crossing', 'main_route', 'local_route', 'plaza']);
const ROUTE_RECIPES = Object.freeze(['main', 'local']);
const PLACE_RECIPES = Object.freeze([
  'arrival_gate', 'civic_plaza', 'civic_hall', 'waterfront_dock', 'heritage_ruin',
  'residence', 'facility', 'investigation_site',
]);
const PLACE_CONDITIONS = Object.freeze(['active', 'missing', 'not_applicable', 'unconfirmed', 'dirt']);
const PROP_RECIPES = Object.freeze(['signboard', 'lamp_post', 'tree_cluster']);
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
const INVESTIGATION_TARGET_OFFSETS = Object.freeze({
  threshold: Object.freeze({ x: 0, y: 1 }),
  ledger: Object.freeze({ x: -2, y: -1 }),
  'water-source': Object.freeze({ x: 0, y: 0 }),
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
const DWELLING_APPEARANCES = Object.freeze(['dwelling-gabled', 'dwelling-stone', 'dwelling-tall']);
const PLACE_APPEARANCES = Object.freeze([
  ...new Set([...Object.values(FACILITY_APPEARANCES), ...DWELLING_APPEARANCES]),
]);
const RESIDENT_APPEARANCES = Object.freeze(['keeper', 'artisan', 'porter', 'watcher', 'neighbor', 'traveler']);
const RESIDENT_BEHAVIORS = Object.freeze(['work', 'talk', 'watch', 'walk']);
const RESIDENT_MOTION_KINDS = Object.freeze(['still', 'ping-pong']);
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
  dojo: { width: 11, height: 9 }, watchtower: { width: 9, height: 12 },
  shop: { width: 9, height: 7 }, ruin: { width: 10, height: 8 },
});

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

function generatedFacilityKinds(town) {
  return uniqueSortedStrings([
    'gate',
    'town_hall',
    ...town.candidates.map((candidate) => candidate.facilityKind),
    ...town.facilities
      .filter((facility) => facility.presence !== 'not_applicable')
      .map((facility) => facility.kind),
  ]);
}

function groupHomeSize(group) {
  const appearance = dwellingAppearance(group);
  return appearance === 'dwelling-tall'
    ? { width: 8, height: 11 }
    : appearance === 'dwelling-stone'
      ? { width: 10, height: 8 }
      : { width: 9, height: 8 };
}

// A place consumes more than its visible rectangle.  The authored approach
// is part of its occupied composition: later buildings must not close the
// only way into an earlier one.  Keep this requirement in the provisional
// capacity envelope as well as in collision-aware placement below.
function placementSiteSize(size, routeWidth = 3) {
  const separator = 1.5;
  const approachLength = 6; // entrance offset (1) plus the authored approach (5)
  const routeRadius = routeWidth / 2;
  return {
    width: round(size.width + separator * 2),
    height: round(size.height + approachLength + routeRadius + separator),
  };
}

function placeRouteWidth(facilityKind, recipe = null) {
  return facilityKind === 'gate' || facilityKind === 'town_hall' || recipe === 'civic_plaza' ? 5 : 3;
}

function authoredStructureSizes(town) {
  return [
    ...generatedFacilityKinds(town).map((kind) => placementSiteSize(
      FACILITY_SIZE[kind] ?? { width: 9, height: 7 },
      placeRouteWidth(kind),
    )),
    ...town.groups.map((group) => placementSiteSize(groupHomeSize(group))),
    placementSiteSize({ width: 18, height: 12 }, 5),
  ];
}

function roleStructureSizes(town, roles) {
  const roleIds = new Set(roles);
  const sizesByRole = new Map(roles.map((role) => [role, []]));
  const addSize = (role, size) => {
    if (roleIds.has(role)) sizesByRole.get(role).push(size);
  };
  for (const kind of generatedFacilityKinds(town)) {
    addSize(facilityDistrictRole(kind), placementSiteSize(
      FACILITY_SIZE[kind] ?? { width: 9, height: 7 },
      placeRouteWidth(kind),
    ));
  }
  for (const group of town.groups) addSize(groupDistrict(group, roleIds), placementSiteSize(groupHomeSize(group)));
  addSize('civic', placementSiteSize({ width: 18, height: 12 }, 5));
  return sizesByRole;
}

function roleEnvelope(sizes) {
  if (!sizes.length) return { width: 0, height: 0 };
  const area = sizes.reduce((total, size) => total + size.width * size.height, 0);
  const widest = Math.max(...sizes.map((size) => size.width));
  const tallest = Math.max(...sizes.map((size) => size.height));
  return {
    // Site sizes already include the separator and approach corridor.  Keep
    // the parcel envelope close to the authored packing need; large additive
    // padding here turns a small town into an empty cross-shaped board.
    width: round(Math.max(widest + 6, Math.sqrt(area) * 1.35 + 8)),
    height: round(Math.max(tallest + 6, Math.sqrt(area) * 0.9 + 6)),
  };
}

function makeCompositionBounds(town) {
  // The temporary placement canvas is derived from the authored footprint
  // envelope.  Final assembly crops it to the actual place/route envelope;
  // there is no empty district grid or repository-volume padding here.
  const sizes = authoredStructureSizes(town);
  const area = sizes.reduce((total, size) => total + size.width * size.height, 0);
  const widest = Math.max(...sizes.map((size) => size.width));
  const tallest = Math.max(...sizes.map((size) => size.height));
  return {
    minX: 0,
    maxX: round((Math.sqrt(area) + widest) * 2 + 18),
    minY: 0,
    maxY: round((Math.sqrt(area) + tallest) * 1.55 + 18),
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
    ...town.facilities.map((facility) => facility.kind),
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

function makeDistricts(town, bounds) {
  const roles = activeDistrictRoles(town);
  const sizesByRole = roleStructureSizes(town, roles);
  const envelopes = new Map([...sizesByRole.entries()].map(([role, sizes]) => [role, roleEnvelope(sizes)]));
  const center = point((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
  const centers = new Map([['civic', center]]);
  const placed = [];
  const addCenter = (role, anchor) => {
    const envelope = envelopes.get(role) ?? { width: 0, height: 0 };
    const placedAnchor = point(anchor.x, anchor.y);
    centers.set(role, placedAnchor);
    placed.push({ role, anchor: placedAnchor, envelope });
  };
  if (roles.includes('civic')) addCenter('civic', center);
  if (roles.includes('arrival')) {
    const civicEnvelope = envelopes.get('civic') ?? { width: 0, height: 0 };
    const arrivalEnvelope = envelopes.get('arrival') ?? { width: 0, height: 0 };
    addCenter('arrival', point(
      center.x - (civicEnvelope.width + arrivalEnvelope.width) / 2 - 6,
      center.y,
    ));
  }
  const remainingRoles = roles.filter((role) => role !== 'arrival' && role !== 'civic')
    .sort((left, right) => compareStrings(left, right));
  const directionsForRole = (role) => {
    // These are composition relationships, not map cells: work branches
    // naturally above the civic spine, living below it, and waterside/heritage
    // stay on the nearest open edge.  The actual envelopes decide distance.
    if (role === 'work') return [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 },
      { x: 1, y: -1 }, { x: -1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 },
    ];
    if (role === 'living') return [
      { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 },
    ];
    if (role === 'waterside') return [
      { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 1 },
      { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: -1, y: -1 },
    ];
    if (role === 'heritage') return [
      { x: -1, y: -1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: -1 },
      { x: -1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
    ];
    return [
      { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: -1, y: 0 },
      { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
    ];
  };
  for (const role of remainingRoles) {
    const envelope = envelopes.get(role) ?? { width: 0, height: 0 };
    const candidates = [];
    for (const source of placed) {
      for (const direction of directionsForRole(role)) {
        const distance = (Math.abs(direction.x) > 0
          ? (source.envelope.width + envelope.width) / 2
          : (source.envelope.height + envelope.height) / 2) + 6;
        candidates.push(point(
          source.anchor.x + direction.x * distance,
          source.anchor.y + direction.y * distance,
        ));
      }
    }
    const candidate = candidates.find((value) => {
      const rect = rectangleAround(value, envelope);
      return placed.every((other) => !rectanglesOverlap(expandRectangle(rect, 3), expandRectangle(rectangleAround(other.anchor, other.envelope), 3)));
    });
    if (!candidate) {
      throw new TypeError(`Unable to place the ${role} district parcel without overlap`);
    }
    addCenter(role, candidate);
  }
  const districts = [];
  for (const role of roles) {
    const anchor = centers.get(role) ?? center;
    const envelope = envelopes.get(role) ?? { width: 0, height: 0 };
    // Site envelopes already include the visible separator and approach.  A
    // small authored quiet margin keeps parcels distinct without recreating a
    // padded district matrix that makes empty towns sprawl.
    const edgePadding = 3;
    const parcel = {
      minX: round(anchor.x - envelope.width / 2 - edgePadding),
      maxX: round(anchor.x + envelope.width / 2 + edgePadding),
      minY: round(anchor.y - envelope.height / 2 - edgePadding),
      maxY: round(anchor.y + envelope.height / 2 + edgePadding),
    };
    const evidence = mergeEvidence(
      ...town.facilities.filter((facility) => facilityDistrictRole(facility.kind) === role).map((facility) => facility.evidence),
      ...town.groups.filter((group) => groupDistrict(group, new Set(roles)) === role).map((group) => group.evidence),
    );
    if (!hasEvidence(evidence)) evidence.unknown.push(`district.${role}.unknown`);
    districts.push({
      id: role,
      role,
      anchor,
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

function approachReservation(anchor, size, routeWidth = 3) {
  const footprint = rectangleAround(anchor, size);
  const entrance = point(anchor.x, footprint.y + footprint.height + 1);
  const outer = point(entrance.x, entrance.y + 5);
  return {
    from: outer,
    to: entrance,
    width: routeWidth,
    rectangle: routeSegmentRect(outer, entrance, routeWidth),
  };
}

function rectangleInsideBounds(rectangle, bounds) {
  return rectangle.x >= bounds.minX
    && rectangle.y >= bounds.minY
    && rectangle.x + rectangle.width <= bounds.maxX
    && rectangle.y + rectangle.height <= bounds.maxY;
}

function reservationBounds(footprint, approach) {
  const expanded = expandRectangle(footprint, 1.5);
  return {
    minX: Math.min(expanded.x, approach.rectangle.x),
    maxX: Math.max(expanded.x + expanded.width, approach.rectangle.x + approach.rectangle.width),
    minY: Math.min(expanded.y, approach.rectangle.y),
    maxY: Math.max(expanded.y + expanded.height, approach.rectangle.y + approach.rectangle.height),
  };
}

function makePlaceGeometry(anchor, footprint, facilityKind, needsCutaway, transition) {
  const entranceWidth = 3;
  const entrance = point(anchor.x, footprint.y + footprint.height + 1);
  const approach = [point(entrance.x, entrance.y + 5), entrance];
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
  return {
    entrance: { point: entrance, approach, width: entranceWidth, automatic: Boolean(facilityKind) },
    access: {
      region: needsCutaway ? doorway : expandRectangle(footprint, 2),
      reach: 2,
      automaticEntry: needsCutaway,
    },
    interior,
    occlusion: { roof: footprint, foreground: { ...footprint, y: round(footprint.y + footprint.height * 0.62), height: round(footprint.height * 0.38) }, reveal: facilityKind ? 'inside' : 'open' },
    reportState,
  };
}

function appearanceForFacility(kind) {
  return FACILITY_APPEARANCES[kind] ?? null;
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

function groupDistrict(group, districtIds) {
  if (group.path === '.' && districtIds.has('arrival')) return 'arrival';
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

function makeGroupHomeCompounds(town) {
  const groups = [...town.groups].sort((left, right) => {
    return compareStrings(groupParentPath(left.path), groupParentPath(right.path))
      || compareStrings(left.path, right.path)
      || compareStrings(left.id, right.id);
  });
  return groups.map((group) => ({
    id: `home.${encodeURIComponent(group.id)}`,
    parentPath: groupParentPath(group.path),
    family: groupRoleFamily(group),
    appearance: dwellingAppearance(group),
    groups: [group],
    sourceGroupIds: [group.id],
    evidence: mergeEvidence(group.evidence),
  }));
}

function candidateOffsets(size) {
  const spreadX = Math.max(4, size.width * 0.62);
  const spreadY = Math.max(3, size.height * 0.62);
  const slots = [
    [0, 0], [-spreadX, 0], [spreadX, 0], [0, -spreadY], [0, spreadY],
    [-spreadX, -spreadY], [spreadX, -spreadY], [-spreadX, spreadY], [spreadX, spreadY],
  ];
  // The authored center is always the first choice.  Rotating this list by
  // placement index made a civic building drift merely because another place
  // happened to be emitted before it, which is both spatially noisy and a
  // hidden capacity proxy.
  return slots;
}

function firstOpenAnchor(preferred, size, occupied, bounds, districtId, approachReservations, routeWidth = 3) {
  // Keep a small authored separator at the parcel edge while leaving the
  // composition enough room for the actual form footprints.  Collision
  // search still rejects every occupied candidate and throws when none fits.
  const reservedApproaches = Array.isArray(approachReservations) ? approachReservations : [];
  const candidates = candidateOffsets(size).map(([x, y]) => point(preferred.x + x, preferred.y + y));
  const maxRadius = Math.ceil(Math.max(
    Math.abs(preferred.x - bounds.minX), Math.abs(preferred.x - bounds.maxX),
    Math.abs(preferred.y - bounds.minY), Math.abs(preferred.y - bounds.maxY),
  ));
  // Expand around the intended parcel anchor.  A row-major sweep starts at a
  // parcel edge and turns a coherent compound into a thin, town-spanning row;
  // concentric authored slots keep the actual footprint compact while still
  // letting collision-aware placement fail truthfully when the parcel is full.
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let offset = -radius; offset <= radius; offset += 1) {
      candidates.push(point(preferred.x + offset, preferred.y - radius));
      candidates.push(point(preferred.x + offset, preferred.y + radius));
      if (offset !== -radius && offset !== radius) {
        candidates.push(point(preferred.x - radius, preferred.y + offset));
        candidates.push(point(preferred.x + radius, preferred.y + offset));
      }
    }
  }
  for (const value of candidates) {
    const anchor = point(value.x, value.y);
    const footprint = rectangleAround(anchor, size);
    const approach = approachReservation(anchor, size, routeWidth);
    const reserved = reservationBounds(footprint, approach);
    if (!rectangleInsideBounds({
      x: reserved.minX,
      y: reserved.minY,
      width: reserved.maxX - reserved.minX,
      height: reserved.maxY - reserved.minY,
    }, bounds)) continue;
    if (occupied.some((other) => rectanglesOverlap(expandRectangle(footprint, 1.5), expandRectangle(other, 1.5)))) continue;
    // An approach is a route reservation.  A later footprint may not close
    // it, while approaches themselves may merge into one readable junction.
    if (reservedApproaches.some((other) => rectanglesOverlap(expandRectangle(footprint, 1.5), other.rectangle))) continue;
    if (occupied.some((other) => rectanglesOverlap(approach.rectangle, other))) continue;
    return anchor;
  }
  throw new TypeError(`No non-overlapping ${size.width}x${size.height} placement remains in district ${districtId}`);
}

function makePlaces(town, districts, identitySeed) {
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
    const preferred = facility.kind === 'town_hall'
      ? point(districtRecord.anchor.x - 12, districtRecord.anchor.y)
      : point(districtRecord.anchor.x, districtRecord.anchor.y);
    const routeWidth = placeRouteWidth(facility.kind);
    const anchor = firstOpenAnchor(
      preferred,
      size,
      occupied,
      districtRecord.bounds,
      district,
      approachReservations,
      routeWidth,
    );
    const footprint = rectangleAround(anchor, size);
    occupied.push(footprint);
    approachReservations.push(approachReservation(anchor, size, routeWidth));
    const needsCutaway = facility.kind === 'town_hall' || facility.kind === 'workshop' || candidatesByKind.has(facility.kind);
    records.push({
      id: `place.${facility.kind.replaceAll('_', '-')}`,
      recipe: facilityRecipe(facility.kind),
      district,
      anchor,
      footprint,
      facilityKind: facility.kind,
      appearance: appearanceForFacility(facility.kind),
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
  const plazaSize = { width: 18, height: 12 };
  const plazaAnchor = firstOpenAnchor(
    point(civicDistrict.anchor.x + 12, civicDistrict.anchor.y + 8),
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

  // Each TownModel group is one authored dwelling.  A common parent makes a
  // spatial cluster of nearby buildings; it does not erase the file-group
  // boundary or merge unrelated relationships into one home.
  const districtIds = new Set(districts.map((district) => district.id));
  const gate = records.find((place) => place.facilityKind === 'gate');
  const compounds = makeGroupHomeCompounds(town);
  const homeIndexByCluster = new Map();
  for (const compound of compounds) {
    const sourceGroupIds = [...compound.sourceGroupIds].sort(compareStrings);
    const sourceGroup = compound.groups[0];
    const district = groupDistrict(sourceGroup, districtIds);
    const districtRecord = districtById.get(district) ?? districtById.get('civic');
    const size = {
      width: compound.appearance === 'dwelling-tall' ? 8 : compound.appearance === 'dwelling-stone' ? 10 : 9,
      height: compound.appearance === 'dwelling-tall' ? 11 : 8,
    };
    const clusterKey = `${district}|${compound.parentPath}`;
    const siblingIndex = homeIndexByCluster.get(clusterKey) ?? 0;
    homeIndexByCluster.set(clusterKey, siblingIndex + 1);
    const clusterSeed = hashParts(identitySeed, 'group-cluster', district, compound.parentPath);
    const clusterBase = point(
      districtRecord.anchor.x + signedOffset(hashParts(clusterSeed, 'x'), 6),
      districtRecord.anchor.y + signedOffset(hashParts(clusterSeed, 'y'), 5),
    );
    const siblingOffset = [
      { x: -6, y: -4 }, { x: 6, y: -4 }, { x: -6, y: 5 }, { x: 6, y: 5 },
    ][siblingIndex % 4];
    const base = sourceGroup.path === '.' && gate
      ? point(gate.anchor.x + 8, gate.anchor.y + 5)
      : clusterBase;
    const preferred = point(base.x + siblingOffset.x, base.y + siblingOffset.y);
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
      appearance: compound.appearance,
      sourceGroupIds,
      label: sourceGroup.path === '.' ? '門前の住まい' : `住居群・${sourceGroup.path}`,
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
  ];
  const endpointIds = new Set([fromPlace.id, toPlace.id]);
  const clear = candidates.filter((candidate) => pathClearsPlaces(candidate, width, places, endpointIds));
  if (clear.length === 0) {
    const fallback = orthogonalClearPath(from, to, width, places, bounds, new Set([fromPlace.id, toPlace.id]));
    if (fallback) return fallback;
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

function makeRoutes(places, identitySeed, bounds, town) {
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
    const centerline = routeCenterline(fromPlace, toPlace, places, recipe === 'main' ? 5 : 3, hashParts(identitySeed, 'route', id), bounds);
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
    const localFacilities = places
      .filter((place) => place.district === district && place.facilityKind)
      .sort((left, right) => compareStrings(left.id, right.id));
    const hub = localFacilities[0]
      ?? (district === 'civic' ? plaza : null)
      ?? hall
      ?? gate;
    if (hub) districtHub.set(district, hub);
  }
  const coreAnchor = plaza ?? hall ?? gate;
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
  const crossDistrictPairs = new Set();
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
        if (left.district !== right.district) {
          const pair = [left.district, right.district].sort(compareStrings);
          crossDistrictPairs.add(pair.join('|'));
        }
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
  for (const pair of [...crossDistrictPairs].sort(compareStrings)) {
    const [leftDistrict, rightDistrict] = pair.split('|');
    const leftHub = districtHub.get(leftDistrict);
    const rightHub = districtHub.get(rightDistrict);
    if (!leftHub || !rightHub || leftHub.id === rightHub.id) continue;
    connect(leftHub, rightHub, 'local', `route.local.district-link.${leftDistrict}.${rightDistrict}`);
  }
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

function makeSurfaces(bounds, districts, places, routes, identitySeed) {
  const dock = places.find((place) => place.facilityKind === 'dock');
  const waterPoints = dock ? [
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
  ] : null;
  const crossings = [];
  const crossingSegmentsByRoute = new Map();
  if (waterPoints) {
    for (const route of routes) {
      const sections = routeSectionsInsideSurface(route.centerline, waterPoints, 8);
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
  const plaza = civicPlaza ? [{
    id: 'surface.plaza.civic',
    recipe: 'plaza',
    district: 'civic',
    geometry: { kind: 'area', bounds: rectangleBounds(expandRectangle(civicPlaza.footprint, 2)) },
    links: { placeIds: [civicPlaza.id], routeIds: routes.filter((route) => route.toPlaceId === civicPlaza.id || route.fromPlaceId === civicPlaza.id).map((route) => route.id).sort(compareStrings), districtIds: ['civic'] },
  }] : [];
  if (!dock) return [...ground, ...plaza, ...routeSurfaces].sort((left, right) => compareStrings(left.id, right.id));
  const bankPoints = waterPoints.map((waterPoint, index) => point(waterPoint.x, clamp(waterPoint.y - 2 - (index % 2), bounds.minY + 2, bounds.maxY - 2)));
  const dockCrossings = crossings.filter(({ route }) => route.fromPlaceId === dock.id || route.toPlaceId === dock.id);
  if (dockCrossings.length === 0) throw new TypeError('Dock place must connect to a readable route crossing the declared water surface');
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
      width: 4,
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
    geometry: { kind: 'path', points: waterPoints, width: 8 },
    links: { placeIds: [dock.id], routeIds: crossingRouteIds, districtIds: ['waterside'] },
  }, {
    id: 'surface.bank.waterside',
    recipe: 'bank',
    district: 'waterside',
    geometry: { kind: 'path', points: bankPoints, width: 3 },
    links: { placeIds: [dock.id], routeIds: [], districtIds: ['waterside'] },
  }];
  return [...ground, ...water, ...plaza, ...routeSurfaces, ...crossingSurfaces].sort((left, right) => compareStrings(left.id, right.id));
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

function connectionResidentAppearance(connection) {
  if (connection.role === 'storage') return 'porter';
  if (connection.direction === 'inbound' || connection.direction === 'outbound') return 'traveler';
  return 'keeper';
}

function connectionResidentBehavior(connection, placeRecord = null) {
  if (placeRecord?.requirements?.distinctInterior === true) return connection.role === 'storage' ? 'work' : 'talk';
  if (connection.role === 'storage' || connection.direction === 'inbound' || connection.direction === 'outbound') return 'walk';
  return 'talk';
}

function activityForBehavior(behavior) {
  return behavior === 'walk' ? 'walking'
    : behavior === 'work' ? 'working'
      : behavior === 'watch' ? 'watching'
        : 'speaking';
}

function groupResidentAppearance(group) {
  const family = groupRoleFamily(group);
  if (family === 'heritage') return 'watcher';
  const dominant = dominantGroupRole(group);
  if (dominant === 'tooling') return 'artisan';
  if (dominant === 'test') return 'watcher';
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

function facilityResidentSpec(facilityKind, placeRecord) {
  const copy = FACILITY_RESIDENT_COPY[facilityKind] ?? { name: '町の係', activity: '町を見守る', behavior: 'talk' };
  const behavior = placeRecord.requirements?.distinctInterior === true && copy.behavior === 'walk' ? 'work' : copy.behavior;
  return {
    appearance: FACILITY_RESIDENT_APPEARANCE[facilityKind] ?? 'neighbor',
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

const RESIDENT_MOTION_LENGTH = 3.5;

function shortMotionPrefix(line) {
  const points = [point(line[0].x, line[0].y)];
  let remaining = RESIDENT_MOTION_LENGTH;
  for (let index = 1; index < line.length && points.length < 3 && remaining > 0; index += 1) {
    const from = line[index - 1];
    const to = line[index];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance <= 0) continue;
    if (distance <= remaining) {
      addPoint(points, to);
      remaining -= distance;
      continue;
    }
    const progress = remaining / distance;
    addPoint(points, point(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress));
    remaining = 0;
  }
  return points;
}

function incidentRouteForResident(placeRecord, routes) {
  return routes
    .filter((route) => route.fromPlaceId === placeRecord.id || route.toPlaceId === placeRecord.id)
    .sort((left, right) => compareStrings(left.id, right.id))[0] ?? null;
}

function residentMotion(placeRecord, behavior, routes) {
  if (behavior !== 'walk' || placeRecord.requirements?.distinctInterior === true) return { kind: 'still' };
  const incident = incidentRouteForResident(placeRecord, routes);
  if (!incident || !Array.isArray(incident.centerline) || incident.centerline.length < 2) return { kind: 'still' };
  const line = incident.fromPlaceId === placeRecord.id ? incident.centerline : [...incident.centerline].reverse();
  const points = shortMotionPrefix(line);
  if (points.length < 2) return { kind: 'still' };
  const entrance = placeRecord.geometry?.entrance?.point;
  const approach = placeRecord.geometry?.entrance?.approach?.[0];
  if (!entrance || !approach) return { kind: 'ping-pong', points };
  const approachLength = Math.hypot(approach.x - entrance.x, approach.y - entrance.y);
  if (approachLength <= 0) return { kind: 'ping-pong', points };
  const routeWidth = incident.recipe === 'main' ? 5 : 3;
  const shoulderDistance = Math.min(routeWidth / 2 + 0.75, approachLength * 0.55);
  const offset = {
    x: (approach.x - entrance.x) / approachLength * shoulderDistance,
    y: (approach.y - entrance.y) / approachLength * shoulderDistance,
  };
  const shoulderPoints = points.map((entry) => point(entry.x + offset.x, entry.y + offset.y));
  return { kind: 'ping-pong', points: shoulderPoints };
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

function makeResidents(town, places, routes) {
  const residents = [];
  const movingPlaceRoutes = new Set();
  const usedSlots = new Map();
  const outdoorSlots = [
    { x: 0, y: 0 }, { x: -2, y: 0 }, { x: 2, y: 0 }, { x: -4, y: 0 }, { x: 4, y: 0 },
    { x: -3, y: 2 }, { x: -1, y: 2 }, { x: 1, y: 2 }, { x: 3, y: 2 },
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
    const publicAnchor = placeRecord.requirements.distinctInterior
      ? placeRecord.anchor
      : placeRecord.geometry.entrance.approach[0] ?? placeRecord.geometry.entrance.point;
    const sourceSlots = placeRecord.requirements.distinctInterior ? interiorSlots : outdoorSlots;
    const interiorFootprint = placeRecord.geometry.interior?.footprint;
    const available = placeRecord.requirements.distinctInterior
      ? sourceSlots.filter((offset) => rectangleContainsPoint(interiorFootprint, point(publicAnchor.x + offset.x, publicAnchor.y + offset.y)))
      : sourceSlots;
    let slotIndex = usedSlots.get(placeRecord.id) ?? 0;
    const target = targetByPlaceId.get(placeRecord.id);
    while (slotIndex < available.length) {
      const slot = available[slotIndex];
      slotIndex += 1;
      const anchor = point(publicAnchor.x + slot.x, publicAnchor.y + slot.y);
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
    if (desiredBehavior !== 'walk') return { behavior: desiredBehavior, motion: { kind: 'still' } };
    const incident = incidentRouteForResident(placeRecord, routes);
    const motionKey = incident ? `${placeRecord.id}|${incident.id}` : null;
    if (!motionKey || movingPlaceRoutes.has(motionKey)) {
      return { behavior: fallbackBehavior, motion: { kind: 'still' } };
    }
    const motion = residentMotion(placeRecord, desiredBehavior, routes);
    if (motion.kind !== 'ping-pong') return { behavior: fallbackBehavior, motion: { kind: 'still' } };
    movingPlaceRoutes.add(motionKey);
    return { behavior: desiredBehavior, motion };
  };
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
    const appearance = connectionResidentAppearance(connection);
    const desiredBehavior = connectionResidentBehavior(connection, placeRecord);
    const fallbackBehavior = connection.role === 'storage' ? 'work' : 'talk';
    const intent = residentIntent(placeRecord, desiredBehavior, fallbackBehavior);
    const behavior = intent.behavior;
    const motion = intent.motion;
    residents.push({
      id: `resident.connection.${connection.id}`,
      placeId: placeRecord.id,
      anchor: motion.kind === 'ping-pong' ? motion.points[0] : claimedAnchor,
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
      anchor: motion.kind === 'ping-pong' ? motion.points[0] : claimedAnchor,
      role: 'townsperson',
      name: group.path === '.' ? '町の住人' : '街区の住人',
      activity: activityForBehavior(behavior),
      state,
      evidence,
      appearance: groupResidentAppearance(group),
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
    const spec = facilityResidentSpec(facilityKind, claimedPlace);
    const intent = residentIntent(claimedPlace, spec.behavior, 'talk');
    const behavior = intent.behavior;
    const motion = intent.motion;
    residents.push({
      id: `resident.place.${claimedPlace.id}`,
      placeId: claimedPlace.id,
      anchor: motion.kind === 'ping-pong' ? motion.points[0] : claimedAnchor,
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

function makeProps(places, identitySeed) {
  const specs = [
    ['prop.gate-sign', 'place.gate', 'signboard', 'entrance', { x: 3, y: 0 }],
    ['prop.civic-lamp', 'place.civic-plaza', 'lamp_post', 'anchor', { x: -5, y: -3 }],
    ['prop.heritage-tree', 'place.ruin', 'tree_cluster', 'approach', { x: 4, y: -2 }],
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
  return props.sort((left, right) => compareStrings(left.id, right.id));
}

function makeLights(town, places, identitySeed) {
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
  add('light.arrival-gate', 'place.gate', 'lit', places.find((place) => place.id === 'place.gate')?.evidence, { x: 2, y: 1 });
  add('light.civic-plaza', 'place.civic-plaza', 'lit', places.find((place) => place.id === 'place.civic-plaza')?.evidence, { x: -5, y: -3 });
  add('light.waterside', 'place.dock', 'unknown', places.find((place) => place.facilityKind === 'dock')?.evidence, { x: -2, y: 1 });
  const townHall = places.find((place) => place.facilityKind === 'town_hall');
  if (townHall) {
    lights.push({
      id: 'light.town-hall-lantern',
      placeId: townHall.id,
      recipe: 'town_hall_lantern',
      anchor: point(townHall.anchor.x, townHall.anchor.y - 4),
      state: 'unlit',
      evidence: mergeEvidence(townHall.evidence, town.transition?.evidence),
      reportState: { transitionId: town.transition?.id ?? REPOSITORY_INSPECTION_TRANSITION_ID, before: 'unlit', after: 'lit' },
    });
  }
  return lights.sort((left, right) => compareStrings(left.id, right.id));
}

function makeInvestigations(town, places) {
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

function packedCompositionBounds(initialBounds, composition, districts, places, routes, residents, props, lights, investigations) {
  let minX = initialBounds.minX;
  let minY = initialBounds.minY;
  let maxX = initialBounds.minX;
  let maxY = initialBounds.minY;
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
  const quietMargin = 6;
  return {
    minX: round(minX < initialBounds.minX ? minX - quietMargin : initialBounds.minX),
    maxX: round(Math.max(initialBounds.minX + 24, maxX + quietMargin)),
    minY: round(minY < initialBounds.minY ? minY - quietMargin : initialBounds.minY),
    maxY: round(Math.max(initialBounds.minY + 24, maxY + quietMargin)),
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

function buildPlan(town) {
  const identitySeed = sha256(town.identity.key);
  const semanticHash = sha256(semanticSignature(town));
  const contentSeed = hashParts(identitySeed, 'content', semanticHash);
  const bounds = makeCompositionBounds(town);
  const provisionalDistricts = makeDistricts(town, bounds);
  const places = makePlaces(town, provisionalDistricts, identitySeed);
  const districts = deriveDistrictsFromPlaces(provisionalDistricts, places);
  const gate = places.find((place) => place.facilityKind === 'gate');
  const civicPlace = places.find((place) => place.id === 'place.civic-plaza')
    ?? places.find((place) => place.facilityKind === 'town_hall');
  if (!gate || !civicPlace) throw new TypeError('Place recipes must provide the arrival and civic anchors');
  const composition = {
    bounds,
    entry: gate.geometry.entrance.approach[0],
    spawn: gate.geometry.entrance.point,
    civic: civicPlace.anchor,
  };
  const routes = makeRoutes(places, identitySeed, routingBounds(bounds, districts, places), town);
  const residents = makeResidents(town, places, routes);
  const props = makeProps(places, identitySeed);
  const lights = makeLights(town, places, identitySeed);
  const investigations = makeInvestigations(town, places);
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
  );
  composition.bounds = packedBounds;
  const packedDistricts = clipDistrictsToBounds(districts, packedBounds);
  const surfaces = makeSurfaces(packedBounds, packedDistricts, places, routes, identitySeed);
  return deepFreeze({
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    identity: { key: town.identity.key, name: town.identity.name },
    contentSeed,
    worldview: { ...WORLDVIEW },
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
  if (!assertRecord(plan.worldview, '$.worldview', issues)) {
    // Continue to collect shape issues.
  } else {
    assertExactKeys(plan.worldview, ['id', 'recipeVersion'], '$.worldview', issues);
    if (plan.worldview.id !== WORLDVIEW.id) issues.push(issue('$.worldview.id', 'must use the complete late-medieval-night worldview', 'INVALID_WORLDVIEW'));
    if (plan.worldview.recipeVersion !== WORLDVIEW.recipeVersion) issues.push(issue('$.worldview.recipeVersion', 'must use the bounded place recipe', 'INVALID_RECIPE_VERSION'));
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
      if (place.appearance !== null && !PLACE_APPEARANCES.includes(place.appearance)) issues.push(issue(`${path}.appearance`, 'must use a closed authored place appearance or null for the civic plaza', 'INVALID_APPEARANCE'));
      if (place.recipe === 'civic_plaza' && place.appearance !== null) issues.push(issue(`${path}.appearance`, 'the civic plaza has no authored structure appearance', 'INVALID_APPEARANCE'));
      assertStringArray(place.sourceGroupIds, `${path}.sourceGroupIds`, issues);
      if (!PLACE_CONDITIONS.includes(place.condition)) issues.push(issue(`${path}.condition`, 'must preserve the place condition', 'INVALID_CONDITION'));
      if (OWN_KEYS.call(place, 'facilityKind')) {
        if (!FACILITY_KINDS.includes(place.facilityKind)) issues.push(issue(`${path}.facilityKind`, 'must use a known facility kind', 'INVALID_FACILITY_KIND'));
        if (place.appearance !== FACILITY_APPEARANCES[place.facilityKind]) issues.push(issue(`${path}.appearance`, 'must match the authored appearance for its facility kind', 'APPEARANCE_MISMATCH'));
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
            if (!isRecord(place) || !place.facilityKind) continue;
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
    if (!RESIDENT_APPEARANCES.includes(resident.appearance)) issues.push(issue(`${path}.appearance`, 'must use a known authored resident appearance', 'INVALID_RESIDENT_APPEARANCE'));
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
        if (targetPlace?.geometry?.interior?.kind !== 'cutaway'
          || !rectangleContainsPoint(targetPlace.geometry.interior.footprint, candidate.target.anchor)) {
          issues.push(issue(`${path}.target.anchor`, 'must remain inside the investigation place cutaway', 'TARGET_OUTSIDE_INTERIOR'));
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
