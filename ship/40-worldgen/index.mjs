import { createHash } from 'node:crypto';

/**
 * The logical world boundary.  World generation intentionally knows nothing
 * about pixels, Canvas, or a renderer.  A cell is simply one addressable
 * location in the town grid.
 */
const WORLD_PLAN_SCHEMA_VERSION = 1;

const FORMAT = 'codecity.world-plan';
const TOWN_TYPES = Object.freeze(['river', 'harbor', 'hill', 'valley', 'plain']);
const CLIMATES = Object.freeze(['spring', 'summer', 'autumn', 'winter', 'mist']);
const TERRAINS = Object.freeze(['meadow', 'coast', 'terrace', 'basin', 'plain']);
const REGION_IDS = Object.freeze(['entrance', 'life', 'work', 'edge', 'past']);
const REGION_EDGES = Object.freeze([
  Object.freeze({ from: 'entrance', to: 'life' }),
  Object.freeze({ from: 'life', to: 'work' }),
  Object.freeze({ from: 'life', to: 'edge' }),
  Object.freeze({ from: 'life', to: 'past' }),
]);
const TOWN_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'inspectionDigest',
  'facilities',
  'facts',
  'habitability',
  'guild',
  'investigations',
  'rewards',
]);
const PLAN_KEYS = Object.freeze([
  'format',
  'schemaVersion',
  'repository',
  'identity',
  'seed',
  'contentSeed',
  'townType',
  'climate',
  'terrain',
  'grid',
  'elevation',
  'water',
  'roads',
  'roadNetwork',
  'topology',
  'regions',
  'plotIds',
  'plots',
  'sightlines',
  'nav',
  'occupancy',
  'facilityAssignments',
  'rooms',
  'npcs',
  'props',
  'lights',
  'questSites',
  'rewardBindings',
  'townState',
  'evidence',
  'l1',
  'l2',
]);
const EVIDENCE_STATES = new Set(['observed', 'inferred', 'unknown']);
const HASH_RE = /^[0-9a-f]{64}$/u;
const OWN_KEYS = Object.prototype.hasOwnProperty;
const MAX_RECORD_DEPTH = 20;

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

function assertRecord(value, path, issues) {
  if (!isRecord(value)) issues.push(issue(path, 'must be a plain object', 'INVALID_OBJECT'));
  return isRecord(value);
}

function assertNonEmptyString(value, path, issues) {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(issue(path, 'must be a non-empty string', 'MISSING_STRING'));
  }
}

function assertNullableString(value, path, issues) {
  if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
    issues.push(issue(path, 'must be a non-empty string or null', 'INVALID_STRING'));
  }
}

function assertInteger(value, path, issues, { min = null, max = null } = {}) {
  if (!Number.isInteger(value)) {
    issues.push(issue(path, 'must be an integer', 'INVALID_INTEGER'));
    return;
  }
  if (min !== null && value < min) issues.push(issue(path, `must be >= ${min}`, 'OUT_OF_RANGE'));
  if (max !== null && value > max) issues.push(issue(path, `must be <= ${max}`, 'OUT_OF_RANGE'));
}

function assertArray(value, path, issues) {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'must be an array', 'INVALID_ARRAY'));
    return false;
  }
  return true;
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortStrings(values) {
  return [...values].sort(compareStrings);
}

function stableClone(value, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_RECORD_DEPTH) {
    throw new TypeError('TownModel records are too deeply nested');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('TownModel numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('TownModel contains a non-serializable value');
  if (seen.has(value)) throw new TypeError('TownModel must not contain cycles');
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = value.map((entry) => stableClone(entry, depth + 1, seen));
  } else if (isRecord(value)) {
    output = {};
    for (const key of Object.keys(value).sort(compareStrings)) {
      output[key] = stableClone(value[key], depth + 1, seen);
    }
  } else {
    throw new TypeError('TownModel contains a non-plain object');
  }
  seen.delete(value);
  return output;
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

function uint32FromHex(hex, offset = 0) {
  return Number.parseInt(hex.slice(offset, offset + 8), 16) >>> 0;
}

/** A small, local PRNG with no ambient clock or global randomness. */
function makeRng(hash) {
  let state = uint32FromHex(hash) || 0x9e3779b9;
  return {
    next() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0x100000000;
    },
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) return 0;
      return Math.floor(this.next() * maxExclusive);
    },
    sign() {
      return this.int(2) === 0 ? -1 : 1;
    },
  };
}

function canonicalSeed(value) {
  if (typeof value === 'string') {
    if (value.trim() === '') throw new TypeError('seed must not be empty');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new TypeError('seed must be a non-empty string or finite number');
}

function assertEvidenceState(value, path, issues) {
  if (!EVIDENCE_STATES.has(value)) {
    issues.push(issue(path, 'must be observed, inferred, or unknown', 'INVALID_EVIDENCE_STATE'));
  }
}

function validateEvidenceBag(value, path, issues) {
  if (!assertRecord(value, path, issues)) return;
  const expected = ['inferred', 'observed', 'unknown'];
  const keys = Object.keys(value).sort(compareStrings);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    issues.push(issue(path, 'must contain exactly observed, inferred, and unknown arrays', 'INVALID_EVIDENCE_BAG'));
  }
  for (const state of expected) {
    if (!Array.isArray(value[state])) {
      issues.push(issue(`${path}.${state}`, 'must be an array', 'INVALID_EVIDENCE_ARRAY'));
    }
  }
}

function mergeEvidenceBags(...bags) {
  const result = { observed: [], inferred: [], unknown: [] };
  for (const bag of bags) {
    if (!isRecord(bag)) continue;
    for (const state of Object.keys(result)) {
      if (Array.isArray(bag[state])) result[state].push(...bag[state]);
    }
  }
  for (const state of Object.keys(result)) result[state] = sortStrings([...new Set(result[state].filter((entry) => typeof entry === 'string'))]);
  return result;
}

function scanEvidenceStates(value, path, issues, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanEvidenceStates(entry, `${path}[${index}]`, issues, seen));
    return;
  }
  if (!isRecord(value)) return;
  if (OWN_KEYS.call(value, 'state') && typeof value.state === 'string') {
    assertEvidenceState(value.state, `${path}.state`, issues);
  }
  if (OWN_KEYS.call(value, 'evidence') && isRecord(value.evidence)) {
    const evidence = value.evidence;
    if (OWN_KEYS.call(evidence, 'state') && typeof evidence.state === 'string') {
      assertEvidenceState(evidence.state, `${path}.evidence.state`, issues);
    }
    if (['observed', 'inferred', 'unknown'].some((key) => OWN_KEYS.call(evidence, key))) {
      validateEvidenceBag(evidence, `${path}.evidence`, issues);
    }
  }
  for (const [key, child] of Object.entries(value)) {
    scanEvidenceStates(child, `${path}.${key}`, issues, seen);
  }
}

function recordIdentity(record, index, prefix) {
  if (!isRecord(record)) return `${prefix}-${String(index).padStart(4, '0')}`;
  for (const key of ['id', 'key', 'facilityId', 'factId', 'candidateId', 'rewardId', 'memberId', 'slug', 'name', 'label']) {
    if (typeof record[key] === 'string' && record[key].trim() !== '') return record[key];
  }
  return `${prefix}-${String(index).padStart(4, '0')}`;
}

function recordKind(record, fallback = 'unknown') {
  if (!isRecord(record)) return fallback;
  for (const key of ['kind', 'type', 'role', 'category', 'facilityType']) {
    if (typeof record[key] === 'string' && record[key].trim() !== '') return record[key].trim().toLowerCase();
  }
  return fallback;
}

function normalizeRecordArray(value, path, issues, prefix) {
  if (!assertArray(value, path, issues)) return [];
  const records = [];
  const ids = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const record = value[index];
    if (!assertRecord(record, `${path}[${index}]`, issues)) continue;
    const id = recordIdentity(record, index, prefix);
    if (ids.has(id)) issues.push(issue(`${path}[${index}]`, `duplicate record identity ${id}`, 'DUPLICATE_ID'));
    ids.add(id);
    scanEvidenceStates(record, `${path}[${index}]`, issues);
    records.push({ id, kind: recordKind(record), value: stableClone(record) });
  }
  records.sort((a, b) => compareStrings(a.id, b.id) || compareStrings(stableStringify(a.value), stableStringify(b.value)));
  return records;
}

function normalizeTownModel(town) {
  const issues = [];
  if (!assertRecord(town, '$', issues)) fail('TownModel must be a plain object', issues);
  const unknown = Object.keys(town).filter((key) => !TOWN_KEYS.includes(key));
  for (const key of unknown) issues.push(issue(`$.${key}`, 'unknown TownModel field', 'UNKNOWN_FIELD'));
  if (town.schemaVersion !== 1) issues.push(issue('$.schemaVersion', 'must be exactly 1', 'UNSUPPORTED_SCHEMA'));
  if (!assertRecord(town.repository, '$.repository', issues)) {
    // Continue to collect errors below.
  } else {
    const repositoryKeys = Object.keys(town.repository).sort(compareStrings);
    if (repositoryKeys.length !== 2 || repositoryKeys[0] !== 'identity' || repositoryKeys[1] !== 'name') {
      issues.push(issue('$.repository', 'must contain exactly name and identity', 'INVALID_REPOSITORY'));
    }
    assertNonEmptyString(town.repository.name, '$.repository.name', issues);
    assertNonEmptyString(town.repository.identity, '$.repository.identity', issues);
  }
  if (typeof town.inspectionDigest !== 'string' || !HASH_RE.test(town.inspectionDigest)) {
    issues.push(issue('$.inspectionDigest', 'must be a lowercase SHA-256', 'INVALID_HASH'));
  }

  const facilities = normalizeRecordArray(town.facilities, '$.facilities', issues, 'facility');
  if (Array.isArray(town.facilities) && town.facilities.length !== 14) {
    issues.push(issue('$.facilities', 'must contain the fourteen canonical facilities', 'INVALID_FACILITY_COUNT'));
  }
  const canonicalFacilityKinds = new Set([
    'inn', 'pub', 'guild', 'town_hall', 'dock', 'warehouse', 'well', 'workshop',
    'dojo', 'watchtower', 'house', 'shop', 'ruin', 'gate',
  ]);
  if (Array.isArray(town.facilities)) {
    for (const [index, facility] of town.facilities.entries()) {
      const path = `$.facilities[${index}]`;
      if (!assertRecord(facility, path, issues)) continue;
      const keys = Object.keys(facility).sort(compareStrings);
      const expected = ['blocksProgress', 'condition', 'evidence', 'kind', 'label', 'presence', 'role', 'sourceFileIds', 'variant'];
      if (JSON.stringify(keys) !== JSON.stringify(expected)) issues.push(issue(path, 'must contain the canonical facility fields', 'INVALID_FACILITY'));
      if (!canonicalFacilityKinds.has(facility.kind)) issues.push(issue(`${path}.kind`, 'unknown canonical facility kind', 'INVALID_FACILITY_KIND'));
      for (const key of ['label', 'role', 'presence', 'condition']) assertNonEmptyString(facility[key], `${path}.${key}`, issues);
      assertNullableString(facility.variant, `${path}.variant`, issues);
      if (facility.kind === 'shop' && (facility.variant !== 'repair' || facility.role !== 'repair')) {
        issues.push(issue(`${path}.variant`, 'shop must use the repair variant and role', 'REPAIR_VARIANT'));
      }
      if (typeof facility.blocksProgress !== 'boolean') issues.push(issue(`${path}.blocksProgress`, 'must be boolean', 'INVALID_FACILITY'));
      if (!assertArray(facility.sourceFileIds, `${path}.sourceFileIds`, issues)) continue;
      validateEvidenceBag(facility.evidence, `${path}.evidence`, issues);
      scanEvidenceStates(facility, path, issues);
    }
  }
  const facts = normalizeRecordArray(town.facts, '$.facts', issues, 'fact');
  if (Array.isArray(town.facts)) {
    for (const [index, fact] of town.facts.entries()) {
      const path = `$.facts[${index}]`;
      if (!assertRecord(fact, path, issues)) continue;
      const keys = Object.keys(fact).sort(compareStrings);
      if (JSON.stringify(keys) !== JSON.stringify(['evidence', 'id', 'kind', 'state', 'subject'])) issues.push(issue(path, 'must contain id, kind, subject, state, and evidence', 'INVALID_FACT'));
      assertNonEmptyString(fact.id, `${path}.id`, issues);
      assertNonEmptyString(fact.kind, `${path}.kind`, issues);
      assertNonEmptyString(fact.subject, `${path}.subject`, issues);
      assertEvidenceState(fact.state, `${path}.state`, issues);
      validateEvidenceBag(fact.evidence, `${path}.evidence`, issues);
    }
  }

  if (!assertRecord(town.habitability, '$.habitability', issues)) {
    // Keep collecting errors for the other fields.
  } else {
    const habitabilityKeys = Object.keys(town.habitability).sort(compareStrings);
    const expectedHabitabilityKeys = ['dirt', 'evidence', 'knownCapabilities', 'label', 'level', 'unknownCapabilities'];
    const withoutOptionalDirt = habitabilityKeys.filter((key) => key !== 'dirt');
    if (JSON.stringify(withoutOptionalDirt) !== JSON.stringify(expectedHabitabilityKeys.filter((key) => key !== 'dirt')) || (habitabilityKeys.includes('dirt') && !Array.isArray(town.habitability.dirt))) {
      issues.push(issue('$.habitability', 'must contain exactly level, label, knownCapabilities, and unknownCapabilities', 'INVALID_HABITABILITY'));
    }
    assertInteger(town.habitability.level, '$.habitability.level', issues, { min: 0, max: 5 });
    assertNonEmptyString(town.habitability.label, '$.habitability.label', issues);
    assertArray(town.habitability.knownCapabilities, '$.habitability.knownCapabilities', issues);
    assertArray(town.habitability.unknownCapabilities, '$.habitability.unknownCapabilities', issues);
    validateEvidenceBag(town.habitability.evidence, '$.habitability.evidence', issues);
    scanEvidenceStates(town.habitability, '$.habitability', issues);
  }

  let guild = null;
  if (!assertRecord(town.guild, '$.guild', issues)) {
    // Keep collecting errors for investigations and rewards.
  } else {
    const guildKeys = Object.keys(town.guild).sort(compareStrings);
    if (JSON.stringify(guildKeys) !== JSON.stringify(['connections', 'representativeConnections', 'tabs'])) {
      issues.push(issue('$.guild', 'must contain exactly tabs, representativeConnections, and connections', 'INVALID_GUILD'));
    }
    if (assertArray(town.guild.tabs, '$.guild.tabs', issues) && town.guild.tabs.length !== 5) {
      issues.push(issue('$.guild.tabs', 'must contain exactly five tabs', 'INVALID_GUILD_TABS'));
    }
    if (Array.isArray(town.guild.tabs)) {
      for (const [index, tab] of town.guild.tabs.entries()) {
        const path = `$.guild.tabs[${index}]`;
        if (!assertRecord(tab, path, issues)) continue;
        const keys = Object.keys(tab).sort(compareStrings);
        if (JSON.stringify(keys) !== JSON.stringify(['entries', 'evidence', 'id', 'label'])) issues.push(issue(path, 'must contain id, label, entries, and evidence', 'INVALID_GUILD_TAB'));
        assertNonEmptyString(tab.id, `${path}.id`, issues);
        assertNonEmptyString(tab.label, `${path}.label`, issues);
        validateEvidenceBag(tab.evidence, `${path}.evidence`, issues);
        if (assertArray(tab.entries, `${path}.entries`, issues)) {
          for (const [entryIndex, entry] of tab.entries.entries()) {
            if (!assertRecord(entry, `${path}.entries[${entryIndex}]`, issues)) continue;
            scanEvidenceStates(entry, `${path}.entries[${entryIndex}]`, issues);
          }
        }
      }
    }
    if (assertArray(town.guild.representativeConnections, '$.guild.representativeConnections', issues) && town.guild.representativeConnections.length > 3) {
      issues.push(issue('$.guild.representativeConnections', 'must contain at most three representatives', 'INVALID_GUILD_REPRESENTATIVES'));
    }
    const representatives = normalizeRecordArray(town.guild.representativeConnections, '$.guild.representativeConnections', issues, 'representative');
    const connections = normalizeRecordArray(town.guild.connections, '$.guild.connections', issues, 'connection');
    guild = {
      tabs: Array.isArray(town.guild.tabs) ? stableClone(town.guild.tabs) : [],
      representativeConnections: representatives,
      connections,
    };
  }

  let investigations = null;
  if (!assertRecord(town.investigations, '$.investigations', issues)) {
    // Keep collecting errors for rewards.
  } else {
    const investigationKeys = Object.keys(town.investigations).sort(compareStrings);
    if (JSON.stringify(investigationKeys) !== JSON.stringify(['candidates', 'priority'])) {
      issues.push(issue('$.investigations', 'must contain exactly candidates and priority', 'INVALID_INVESTIGATIONS'));
    }
    const candidates = normalizeRecordArray(town.investigations.candidates, '$.investigations.candidates', issues, 'candidate');
    if (Array.isArray(town.investigations.candidates) && town.investigations.candidates.length > 3) {
      issues.push(issue('$.investigations.candidates', 'must contain at most three candidates', 'INVALID_CANDIDATE_COUNT'));
    }
    const expectedPriority = ['entrypoint', 'persistence', 'configuration', 'test', 'observability', 'recovery'];
    if (JSON.stringify(town.investigations.priority) !== JSON.stringify(expectedPriority)) {
      issues.push(issue('$.investigations.priority', 'must preserve the six habitability priorities', 'INVALID_INVESTIGATION_PRIORITY'));
    }
    if (Array.isArray(town.investigations.candidates)) {
      for (const [index, candidate] of town.investigations.candidates.entries()) {
        const path = `$.investigations.candidates[${index}]`;
        if (!assertRecord(candidate, path, issues)) continue;
        const keys = Object.keys(candidate).sort(compareStrings);
        const expected = ['capability', 'evidence', 'facilityKind', 'id', 'role', 'state', 'statement', 'subject', 'variant'];
        if (JSON.stringify(keys) !== JSON.stringify(expected)) issues.push(issue(path, 'must contain the canonical candidate fields', 'INVALID_CANDIDATE'));
        assertNonEmptyString(candidate.id, `${path}.id`, issues);
        assertNullableString(candidate.capability, `${path}.capability`, issues);
        assertNonEmptyString(candidate.facilityKind, `${path}.facilityKind`, issues);
        assertNonEmptyString(candidate.role, `${path}.role`, issues);
        assertNullableString(candidate.variant, `${path}.variant`, issues);
        assertNonEmptyString(candidate.subject, `${path}.subject`, issues);
        assertNonEmptyString(candidate.statement, `${path}.statement`, issues);
        assertEvidenceState(candidate.state, `${path}.state`, issues);
        validateEvidenceBag(candidate.evidence, `${path}.evidence`, issues);
      }
    }
    investigations = {
      candidates,
      priority: Array.isArray(town.investigations.priority) ? [...town.investigations.priority] : [],
    };
  }

  let rewards = null;
  if (!assertRecord(town.rewards, '$.rewards', issues)) {
    // no-op
  } else {
    const rewardKeys = Object.keys(town.rewards).sort(compareStrings);
    if (JSON.stringify(rewardKeys) !== JSON.stringify(['bindings', 'transitions'])) {
      issues.push(issue('$.rewards', 'must contain exactly bindings and transitions', 'INVALID_REWARDS'));
    }
    const bindings = normalizeRecordArray(town.rewards.bindings, '$.rewards.bindings', issues, 'reward');
    if (Array.isArray(town.rewards.bindings) && town.rewards.bindings.length !== 9) {
      issues.push(issue('$.rewards.bindings', 'must contain exactly nine reward bindings', 'INVALID_REWARD_COUNT'));
    }
    const transitions = Array.isArray(town.rewards.transitions) ? stableClone(town.rewards.transitions) : [];
    if (Array.isArray(town.rewards.transitions)) {
      for (const [index, transition] of town.rewards.transitions.entries()) {
        scanEvidenceStates(transition, `$.rewards.transitions[${index}]`, issues);
        const state = transition?.state ?? transition?.evidence?.state ?? transition?.evidence;
        if (state !== 'observed') issues.push(issue(`$.rewards.transitions[${index}]`, 'reward transitions must be observed events', 'UNOBSERVED_REWARD_TRANSITION'));
      }
    } else {
      issues.push(issue('$.rewards.transitions', 'must be an array', 'INVALID_ARRAY'));
    }
    rewards = { bindings, transitions };
  }

  if (issues.length > 0) fail('TownModel failed the version 1 contract', issues, 'TOWN_MODEL_INVALID');
  const identity = {
    key: town.repository.identity,
    name: town.repository.name,
  };
  const evidenceBags = [
    ...((Array.isArray(town.facilities) ? town.facilities : []).map((entry) => entry.evidence)),
    ...((Array.isArray(town.facts) ? town.facts : []).map((entry) => entry.evidence)),
    town.habitability?.evidence,
    ...((guild?.connections ?? []).map((entry) => entry.value?.evidence ?? entry.evidence)),
    ...((guild?.tabs ?? []).map((entry) => entry.evidence)),
    ...((investigations?.candidates ?? []).map((entry) => entry.value?.evidence ?? entry.evidence)),
    ...((rewards?.transitions ?? []).map((entry) => entry.evidence)),
  ];
  const evidence = mergeEvidenceBags(...evidenceBags);
  const normalized = {
    schemaVersion: 1,
    repository: {
      name: town.repository.name,
      identity: town.repository.identity,
    },
    identity,
    inspectionDigest: town.inspectionDigest,
    facilities,
    facts,
    habitability: stableClone(town.habitability),
    guild,
    // Internal names are the direct v1 fields, not compatibility aliases.
    investigations,
    rewards,
    evidence,
  };
  return deepFreeze(normalized);
}

function pickNumber(hash, maxExclusive) {
  return uint32FromHex(hash) % maxExclusive;
}

function chooseType(identityHash) {
  return TOWN_TYPES[pickNumber(hashParts(identityHash, 'town-type'), TOWN_TYPES.length)];
}

function chooseClimate(identityHash) {
  return CLIMATES[pickNumber(hashParts(identityHash, 'climate'), CLIMATES.length)];
}

function terrainFor(type) {
  return {
    river: 'meadow',
    harbor: 'coast',
    hill: 'terrace',
    valley: 'basin',
    plain: 'plain',
  }[type];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function addPoint(points, point) {
  const previous = points.at(-1);
  if (!previous || previous.x !== point.x || previous.y !== point.y) points.push(point);
}

function makeWater(type, identityHash, grid) {
  const rng = makeRng(hashParts(identityHash, 'water'));
  const horizontal = rng.int(2) === 0;
  const points = [];
  if (horizontal) {
    let y = 5 + rng.int(grid.rows - 10);
    let drift = rng.sign();
    for (let x = 0; x <= grid.columns - 1; x += 1) {
      if (x > 0 && x % 4 === 0) {
        y = clamp(y + drift, 1, grid.rows - 2);
        if (rng.int(4) === 0) drift *= -1;
      }
      addPoint(points, { x, y });
    }
  } else {
    let x = 5 + rng.int(grid.columns - 10);
    let drift = rng.sign();
    for (let y = 0; y <= grid.rows - 1; y += 1) {
      if (y > 0 && y % 4 === 0) {
        x = clamp(x + drift, 1, grid.columns - 2);
        if (rng.int(4) === 0) drift *= -1;
      }
      addPoint(points, { x, y });
    }
  }
  const waterKind = type === 'harbor' ? 'estuary' : type === 'river' ? 'river' : 'stream';
  return {
    id: 'water-01',
    kind: waterKind,
    crossesMap: true,
    entry: points[0],
    exit: points.at(-1),
    path: points,
  };
}

function rotatePoint(point, rotation, grid) {
  const maxX = grid.columns - 1;
  const maxY = grid.rows - 1;
  if (rotation === 1) return { x: maxY - point.y, y: point.x };
  if (rotation === 2) return { x: maxX - point.x, y: maxY - point.y };
  if (rotation === 3) return { x: point.y, y: maxX - point.x };
  return { x: point.x, y: point.y };
}

function makeRegionCenters(identityHash, grid) {
  const rng = makeRng(hashParts(identityHash, 'region-centers'));
  const base = {
    entrance: { x: 5, y: 16 },
    life: { x: 22, y: 16 },
    work: { x: 38, y: 8 },
    edge: { x: 38, y: 24 },
    past: { x: 22, y: 4 },
  };
  const rotation = rng.int(4);
  const centers = {};
  for (const id of REGION_IDS) {
    const rotated = rotatePoint(base[id], rotation, grid);
    const jitter = id === 'life' ? 0 : 1 + rng.int(2);
    centers[id] = {
      x: clamp(rotated.x + rng.sign() * jitter, 4, grid.columns - 5),
      y: clamp(rotated.y + rng.sign() * jitter, 3, grid.rows - 4),
    };
  }
  return centers;
}

function makePlotPositions(region, count, centers, identityHash, grid) {
  const center = centers[region];
  const rng = makeRng(hashParts(identityHash, 'plots', region));
  const offsets = [
    { x: -5, y: -3 },
    { x: 4, y: -3 },
    { x: -5, y: 3 },
    { x: 4, y: 3 },
    { x: 0, y: -6 },
    { x: 0, y: 6 },
    { x: -8, y: 0 },
    { x: 8, y: 0 },
  ];
  const positions = [];
  for (let index = 0; index < count; index += 1) {
    const offset = offsets[index % offsets.length];
    const extra = index >= offsets.length ? Math.floor(index / offsets.length) : 0;
    const x = clamp(center.x + offset.x + (extra * rng.sign()), 1, grid.columns - 7);
    const y = clamp(center.y + offset.y + (extra * rng.sign()), 1, grid.rows - 6);
    positions.push({
      x,
      y,
      width: 4 + rng.int(3),
      height: 3 + rng.int(2),
    });
  }
  return positions;
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function reservePlotPosition(desired, reserved, grid) {
  const candidates = [];
  const maxX = grid.columns - desired.width - 1;
  const maxY = grid.rows - desired.height - 1;
  for (let y = 1; y <= maxY; y += 1) {
    for (let x = 1; x <= maxX; x += 1) {
      candidates.push({
        x,
        y,
        width: desired.width,
        height: desired.height,
        distance: ((x - desired.x) ** 2) + ((y - desired.y) ** 2),
      });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance || left.y - right.y || left.x - right.x);
  const available = candidates.find((candidate) => reserved.every((placed) => !rectanglesOverlap(candidate, placed)));
  if (!available) throw new TypeError('WorldPlan grid cannot place every plot without overlap');
  const { distance: _distance, ...cell } = available;
  reserved.push(cell);
  return cell;
}

function makeL1(identityKey) {
  const identityHash = sha256(identityKey);
  const townType = chooseType(identityHash);
  const climate = chooseClimate(identityHash);
  const terrain = terrainFor(townType);
  const grid = Object.freeze({ columns: 48, rows: 32 });
  const baseRng = makeRng(hashParts(identityHash, 'elevation'));
  const elevationLevels = 2 + baseRng.int(2);
  const elevation = {
    levels: elevationLevels,
    bands: Array.from({ length: elevationLevels }, (_, index) => ({
      id: `elevation-${index}`,
      level: index,
      share: index === 0 ? 0.55 : Number((0.45 / (elevationLevels - 1)).toFixed(3)),
    })),
  };
  const water = makeWater(townType, identityHash, grid);
  const centers = makeRegionCenters(identityHash, grid);
  const countRng = makeRng(hashParts(identityHash, 'plot-count'));
  const totalPlots = 12 + countRng.int(9);
  const regionCounts = Object.fromEntries(REGION_IDS.map((id) => [id, 2]));
  for (let extra = totalPlots - 10, index = 0; extra > 0; extra -= 1, index += 1) {
    const region = REGION_IDS[(countRng.int(REGION_IDS.length) + index) % REGION_IDS.length];
    regionCounts[region] += 1;
  }

  const plots = [];
  const regions = [];
  const plotIdsByRegion = {};
  const reservedPlots = [];
  let plotNumber = 1;
  for (const region of REGION_IDS) {
    const positions = makePlotPositions(region, regionCounts[region], centers, identityHash, grid);
    const ids = [];
    for (let index = 0; index < positions.length; index += 1) {
      const position = reservePlotPosition(positions[index], reservedPlots, grid);
      const id = `plot-${String(plotNumber).padStart(2, '0')}`;
      const level = region === 'work' ? elevationLevels - 1 : region === 'past' ? Math.max(1, elevationLevels - 1) : index % elevationLevels;
      plots.push({
        id,
        region,
        cell: { ...position },
        elevation: level,
        terrain,
      });
      ids.push(id);
      plotNumber += 1;
    }
    plotIdsByRegion[region] = ids;
    regions.push({
      id: region,
      kind: region,
      plotIds: ids,
      anchorPlotId: ids[0],
    });
  }

  const centerByPlotId = new Map();
  for (const plot of plots) {
    centerByPlotId.set(plot.id, {
      x: plot.cell.x + Math.floor(plot.cell.width / 2),
      y: plot.cell.y + Math.floor(plot.cell.height / 2),
    });
  }

  const roads = [];
  const route = (fromPlotId, toPlotId, id, kind) => {
    const from = centerByPlotId.get(fromPlotId);
    const to = centerByPlotId.get(toPlotId);
    const routeRng = makeRng(hashParts(identityHash, 'road', id));
    const path = [];
    addPoint(path, from);
    let x = from.x;
    let y = from.y;
    const horizontalFirst = routeRng.int(2) === 0;
    const stepAxis = (target, axis) => {
      while ((axis === 'x' ? x : y) !== target) {
        const current = axis === 'x' ? x : y;
        const direction = target > current ? 1 : -1;
        const step = Math.min(Math.abs(target - current), 2 + routeRng.int(3));
        if (axis === 'x') x += direction * step;
        else y += direction * step;
        addPoint(path, { x, y });
        if (routeRng.int(3) === 0) {
          if (axis === 'x') y = clamp(y + routeRng.sign(), 0, grid.rows - 1);
          else x = clamp(x + routeRng.sign(), 0, grid.columns - 1);
          addPoint(path, { x, y });
        }
      }
    };
    if (horizontalFirst) {
      stepAxis(to.x, 'x');
      stepAxis(to.y, 'y');
    } else {
      stepAxis(to.y, 'y');
      stepAxis(to.x, 'x');
    }
    addPoint(path, to);
    return { id, kind, fromPlotId, toPlotId, width: kind === 'main' ? 3 : 2, path };
  };

  roads.push(route(plotIdsByRegion.entrance[0], plotIdsByRegion.life[0], 'road-main', 'main'));
  const branchTargets = [
    ['work', 'road-branch-work'],
    ['edge', 'road-branch-edge'],
    ['past', 'road-branch-past'],
  ];
  const branchRng = makeRng(hashParts(identityHash, 'branch-roads'));
  if (branchRng.int(3) > 0) branchTargets.push(['life', 'road-branch-life']);
  if (branchRng.int(3) === 0) branchTargets.push(['entrance', 'road-branch-entrance']);
  for (const [region, id] of branchTargets) {
    const target = plotIdsByRegion[region][region === 'life' ? 1 % plotIdsByRegion[region].length : 0];
    roads.push(route(plotIdsByRegion.life[0], target, id, 'branch'));
  }
  const deadEndRng = makeRng(hashParts(identityHash, 'dead-ends'));
  const deadEndCount = 1 + deadEndRng.int(2);
  for (let index = 0; index < deadEndCount; index += 1) {
    const region = REGION_IDS[(deadEndRng.int(REGION_IDS.length) + index) % REGION_IDS.length];
    const ids = plotIdsByRegion[region];
    const target = ids[ids.length - 1];
    roads.push(route(ids[0], target, `road-dead-end-${index + 1}`, 'dead-end'));
  }

  const adjacency = new Map(plots.map((plot) => [plot.id, new Set()]));
  const connect = (a, b) => {
    if (a === b || !adjacency.has(a) || !adjacency.has(b)) return;
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  };
  for (const ids of Object.values(plotIdsByRegion)) {
    for (let index = 1; index < ids.length; index += 1) connect(ids[index - 1], ids[index]);
  }
  for (const road of roads) connect(road.fromPlotId, road.toPlotId);
  const navEdges = [];
  for (const [from, targets] of adjacency.entries()) {
    for (const to of sortStrings([...targets])) {
      if (from < to) navEdges.push({ from, to, kind: 'walk' });
    }
  }
  const topology = {
    entryRegion: 'entrance',
    regionOrder: [...REGION_IDS],
    edges: REGION_EDGES.map((edge) => ({ ...edge })),
    adjacency: Object.fromEntries(REGION_IDS.map((region) => [region, REGION_EDGES
      .filter((edge) => edge.from === region || edge.to === region)
      .map((edge) => edge.from === region ? edge.to : edge.from)])),
  };
  const plotIds = plots.map((plot) => plot.id);
  const sightlines = [
    { id: 'sightline-gate-to-plaza', fromPlotId: plotIdsByRegion.entrance[0], toPlotId: plotIdsByRegion.life[0], focus: 'arrival' },
    { id: 'sightline-plaza-to-work', fromPlotId: plotIdsByRegion.life[0], toPlotId: plotIdsByRegion.work[0], focus: 'work' },
    { id: 'sightline-plaza-to-water', fromPlotId: plotIdsByRegion.life[0], toPlotId: plotIdsByRegion.edge[0], focus: 'water' },
  ];
  const nav = {
    startPlotId: plotIdsByRegion.entrance[0],
    edges: navEdges,
    reachablePlotIds: plotIds,
    regionByPlot: Object.fromEntries(plots.map((plot) => [plot.id, plot.region])),
  };
  const roadNetwork = {
    mainRoadIds: roads.filter((road) => road.kind === 'main').map((road) => road.id),
    branchRoadIds: roads.filter((road) => road.kind === 'branch').map((road) => road.id),
    deadEndRoadIds: roads.filter((road) => road.kind === 'dead-end').map((road) => road.id),
  };
  const l1 = {
    townType,
    climate,
    terrain,
    grid,
    elevation,
    water,
    roads,
    roadNetwork,
    topology,
    regions,
    plotIds,
    plots,
    sightlines,
    nav,
  };
  return { identityHash, l1 };
}

function matchesKind(value, words) {
  const text = String(value ?? '').toLowerCase();
  return words.some((word) => text.includes(word));
}

function preferredRegion(record) {
  const text = `${record.kind} ${record.id} ${stableStringify(record.value)}`.toLowerCase();
  if (matchesKind(text, ['web', 'public', 'entry', 'portal', 'inn', 'hostel', 'hotel', 'gateway', 'frontdoor', 'auth'])) return 'entrance';
  if (matchesKind(text, ['api', 'http', 'external', 'network', 'webhook', 'llm', 'mobile', 'package', 'deploy', 'edge', 'connector'])) return 'edge';
  if (matchesKind(text, ['repo', 'git', 'build', 'test', 'ci', 'config', 'monitor', 'tool', 'work', 'factory', 'service', 'job'])) return 'work';
  if (matchesKind(text, ['legacy', 'unknown', 'ruin', 'old', 'history', 'deprecated'])) return 'past';
  return 'life';
}

function facilityRegion(kind) {
  return ({
    gate: 'entrance', inn: 'entrance',
    pub: 'life', guild: 'life', town_hall: 'life', house: 'life',
    dock: 'edge',
    warehouse: 'work', well: 'work', workshop: 'work', dojo: 'work', watchtower: 'work', shop: 'work',
    ruin: 'past',
  })[kind] ?? 'life';
}

function facilityIsApplicable(record) {
  const presence = String(record?.value?.presence ?? '').trim().toLowerCase();
  return presence === 'present';
}

function makeOccupancy(town, l1, contentHash) {
  const byRegion = Object.fromEntries(REGION_IDS.map((region) => [region, l1.regions.find((entry) => entry.id === region).plotIds]));
  const plotMap = new Map(l1.plots.map((plot) => [plot.id, plot]));
  const assignments = new Map(l1.plotIds.map((plotId) => [plotId, []]));
  const occupancyRng = makeRng(hashParts(contentHash, 'occupancy'));
  // The canonical catalogue is always present in TownModel, but only an
  // observed-present facility becomes a named building in L2.  Unknown and
  // missing states stay represented by investigation sites, never fabricated
  // occupancy.
  const facilities = town.facilities.filter(facilityIsApplicable);
  const assignedKinds = new Map();
  const adjacency = new Map(l1.plotIds.map((plotId) => [plotId, new Set()]));
  for (const edge of l1.nav.edges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  for (const facility of facilities) {
    const preferred = preferredRegion(facility);
    const candidates = [...byRegion[preferred], ...REGION_IDS.filter((id) => id !== preferred).flatMap((id) => byRegion[id])];
    const kind = facility.kind;
    let target = candidates.find((plotId) => {
      const occupants = assignments.get(plotId);
      if (!occupants || occupants.length > 0) return false;
      return ![...(adjacency.get(plotId) ?? [])].some((neighbor) => assignedKinds.get(neighbor) === kind);
    });
    if (!target) target = candidates.find((plotId) => assignments.get(plotId).length === 0);
    if (!target) target = candidates[occupancyRng.int(candidates.length)];
    const entry = {
      facilityId: facility.id,
      plotId: target,
      kind,
      name: typeof facility.value.label === 'string' ? facility.value.label : facility.id,
      state: facility.value.state ?? facility.value.status ?? facility.value.condition ?? 'unknown',
      evidence: isRecord(facility.value.evidence) ? stableClone(facility.value.evidence) : undefined,
    };
    if (entry.evidence === undefined) delete entry.evidence;
    assignments.get(target).push(entry);
    if (!assignedKinds.has(target)) assignedKinds.set(target, kind);
  }
  const occupancy = l1.plotIds.map((plotId) => ({
    plotId,
    state: assignments.get(plotId).length > 0 ? 'occupied' : 'vacant',
    occupants: assignments.get(plotId),
  }));
  // Keep an explicit, deterministic assignment index for scene compilers.
  const facilityAssignments = occupancy.flatMap((entry) => entry.occupants.map((occupant) => ({
    facilityId: occupant.facilityId,
    plotId: entry.plotId,
  })));
  return { occupancy, facilityAssignments, plotMap };
}

function makeL2(town, l1, contentHash) {
  const { occupancy, facilityAssignments } = makeOccupancy(town, l1, contentHash);
  const occupied = occupancy.flatMap((entry) => entry.occupants);
  const rooms = occupied.map((occupant) => ({
    id: `room-${occupant.facilityId}`,
    plotId: occupant.plotId,
    facilityId: occupant.facilityId,
    kind: occupant.kind,
    state: occupant.state,
  }));
  const roster = town.guild.representativeConnections.length > 0
    ? town.guild.representativeConnections
    : (town.guild.connections.length > 0
      ? town.guild.connections.slice(0, 3)
      : [{ id: 'ambient-townsperson', kind: 'townsperson', value: { name: 'townsperson' } }]);
  const npcs = roster.map((member, index) => {
    const plot = occupied[index % Math.max(1, occupied.length)]?.plotId ?? l1.regions[index % REGION_IDS.length].anchorPlotId;
    return {
      id: `npc-${member.id}`,
      plotId: plot,
      memberId: member.id,
      role: member.kind,
      name: typeof member.value.name === 'string' ? member.value.name : (typeof member.value.label === 'string' ? member.value.label : member.id),
      movement: index % 2 === 0 ? 'patrol' : 'idle',
    };
  });
  const propKinds = ['well', 'tree', 'sign', 'lamp'];
  const props = l1.roads.flatMap((road, roadIndex) => road.path
    .filter((_, pointIndex) => pointIndex > 0 && pointIndex < road.path.length - 1 && pointIndex % 3 === 0)
    .slice(0, 2)
    .map((point, index) => ({
      id: `prop-${road.id}-${index + 1}`,
      kind: propKinds[(roadIndex + index) % propKinds.length],
      cell: point,
      roadId: road.id,
    })));
  const lights = [
    { id: 'light-gate', plotId: l1.regions.find((region) => region.id === 'entrance').anchorPlotId, state: 'lit' },
    { id: 'light-plaza', plotId: l1.regions.find((region) => region.id === 'life').anchorPlotId, state: town.habitability.level > 0 ? 'lit' : 'unknown' },
    ...rooms.map((room) => ({ id: `light-${room.id}`, plotId: room.plotId, state: room.state === 'closed' ? 'unlit' : 'lit' })),
  ];
  const candidates = town.investigations.candidates;
  const occupantPlotByKind = new Map(occupied.map((occupant) => [occupant.kind, occupant.plotId]));
  const questPlots = new Set();
  const questSites = candidates.map((candidate, index) => {
    const facilityKind = candidate.value.facilityKind;
    const matchingFacilityPlot = occupantPlotByKind.get(facilityKind);
    const region = facilityRegion(facilityKind);
    const regionPlots = l1.regions.find((entry) => entry.id === region)?.plotIds ?? l1.plotIds;
    const vacantInRegion = regionPlots.find((plotId) => !questPlots.has(plotId) && occupancy.find((entry) => entry.plotId === plotId)?.state === 'vacant');
    const anyInRegion = regionPlots.find((plotId) => !questPlots.has(plotId));
    const plotId = matchingFacilityPlot ?? vacantInRegion ?? anyInRegion ?? l1.plotIds[index % l1.plotIds.length];
    questPlots.add(plotId);
    const evidence = isRecord(candidate.value.evidence) ? stableClone(candidate.value.evidence) : { observed: [], inferred: [], unknown: [`candidate.${candidate.id}.unknown`] };
    return {
      id: `quest-site-${candidate.id}`,
      candidateId: candidate.id,
      plotId,
      action: candidate.value.action ?? 'inspect',
      evidence,
    };
  });
  const l2 = {
    occupancy,
    facilityAssignments,
    rooms,
    npcs,
    props,
    lights,
    questSites,
    evidence: town.evidence,
  };
  return l2;
}

function geometrySnapshot(plan) {
  return {
    townType: plan.townType,
    climate: plan.climate,
    terrain: plan.terrain,
    grid: plan.grid,
    elevation: plan.elevation,
    water: plan.water,
    roads: plan.roads,
    roadNetwork: plan.roadNetwork,
    topology: plan.topology,
    regions: plan.regions,
    plotIds: plan.plotIds,
    plots: plan.plots,
    sightlines: plan.sightlines,
    nav: plan.nav,
  };
}

function townStateSnapshot(town) {
  const unwrap = (record) => stableClone(record?.value ?? record);
  return {
    habitability: stableClone(town.habitability),
    guild: {
      tabs: stableClone(town.guild.tabs),
      representativeConnections: town.guild.representativeConnections.map(unwrap),
      connections: town.guild.connections.map(unwrap),
    },
    investigations: {
      priority: [...town.investigations.priority],
      candidates: town.investigations.candidates.map(unwrap),
    },
    rewards: {
      bindings: town.rewards.bindings.map(unwrap),
      transitions: stableClone(town.rewards.transitions),
    },
  };
}

function buildPlan(town, seedValue) {
  const identityKey = town.identity.key;
  const identityHash = sha256(identityKey);
  const l1Result = makeL1(identityKey);
  const contentInput = seedValue === undefined ? identityKey : canonicalSeed(seedValue);
  const contentHash = hashParts(contentInput, stableStringify({
    facilities: town.facilities,
    facts: town.facts,
    habitability: town.habitability,
    guild: town.guild,
    investigations: town.investigations,
    rewards: town.rewards,
  }));
  const l2 = makeL2(town, l1Result.l1, contentHash);
  const base = {
    format: FORMAT,
    schemaVersion: WORLD_PLAN_SCHEMA_VERSION,
    repository: town.repository,
    identity: town.identity,
    seed: identityHash,
    contentSeed: contentHash,
    ...l1Result.l1,
    ...l2,
    rewardBindings: town.rewards.bindings,
    townState: townStateSnapshot(town),
    evidence: town.evidence,
  };
  base.l1 = {
    townType: base.townType,
    climate: base.climate,
    terrain: base.terrain,
    grid: base.grid,
    elevation: base.elevation,
    water: base.water,
    roads: base.roads,
    roadNetwork: base.roadNetwork,
    topology: base.topology,
    regions: base.regions,
    plotIds: base.plotIds,
    plots: base.plots,
    sightlines: base.sightlines,
    nav: base.nav,
  };
  base.l2 = {
    occupancy: base.occupancy,
    facilityAssignments: base.facilityAssignments,
    rooms: base.rooms,
    npcs: base.npcs,
    props: base.props,
    lights: base.lights,
    questSites: base.questSites,
    townState: base.townState,
    evidence: base.evidence,
  };
  return deepFreeze(base);
}

function validatePlanShape(plan) {
  const issues = [];
  if (!assertRecord(plan, '$', issues)) fail('WorldPlan must be a plain object', issues);
  const unknown = Object.keys(plan).filter((key) => !PLAN_KEYS.includes(key));
  for (const key of unknown) issues.push(issue(`$.${key}`, 'unknown WorldPlan field', 'UNKNOWN_FIELD'));
  if (plan.format !== FORMAT) issues.push(issue('$.format', `must be exactly ${FORMAT}`, 'INVALID_FORMAT'));
  if (plan.schemaVersion !== WORLD_PLAN_SCHEMA_VERSION) issues.push(issue('$.schemaVersion', 'must be exactly 1', 'UNSUPPORTED_SCHEMA'));
  if (!assertRecord(plan.repository, '$.repository', issues)) {
    // no-op
  } else {
    const repositoryKeys = Object.keys(plan.repository).sort(compareStrings);
    if (repositoryKeys.length !== 2 || repositoryKeys[0] !== 'identity' || repositoryKeys[1] !== 'name') {
      issues.push(issue('$.repository', 'must contain exactly name and identity', 'INVALID_REPOSITORY'));
    }
    assertNonEmptyString(plan.repository.name, '$.repository.name', issues);
    assertNonEmptyString(plan.repository.identity, '$.repository.identity', issues);
  }
  if (!assertRecord(plan.identity, '$.identity', issues)) {
    // Continue to gather shape issues.
  } else {
    const keys = Object.keys(plan.identity).sort(compareStrings);
    if (keys.length !== 2 || keys[0] !== 'key' || keys[1] !== 'name') issues.push(issue('$.identity', 'must contain exactly key and name', 'INVALID_IDENTITY'));
    assertNonEmptyString(plan.identity.key, '$.identity.key', issues);
    assertNonEmptyString(plan.identity.name, '$.identity.name', issues);
  }
  for (const key of ['seed', 'contentSeed']) {
    if (typeof plan[key] !== 'string' || !HASH_RE.test(plan[key])) issues.push(issue(`$.${key}`, 'must be a lowercase SHA-256', 'INVALID_HASH'));
  }
  if (!TOWN_TYPES.includes(plan.townType)) issues.push(issue('$.townType', 'unknown town type', 'INVALID_ENUM'));
  if (!CLIMATES.includes(plan.climate)) issues.push(issue('$.climate', 'unknown climate', 'INVALID_ENUM'));
  if (!TERRAINS.includes(plan.terrain)) issues.push(issue('$.terrain', 'unknown terrain', 'INVALID_ENUM'));
  if (!assertRecord(plan.grid, '$.grid', issues)) {
    // no-op
  } else {
    assertInteger(plan.grid.columns, '$.grid.columns', issues, { min: 8, max: 512 });
    assertInteger(plan.grid.rows, '$.grid.rows', issues, { min: 8, max: 512 });
  }
  if (!assertRecord(plan.elevation, '$.elevation', issues)) {
    // no-op
  } else {
    assertInteger(plan.elevation.levels, '$.elevation.levels', issues, { min: 2, max: 3 });
    if (assertArray(plan.elevation.bands, '$.elevation.bands', issues) && plan.elevation.bands.length !== plan.elevation.levels) {
      issues.push(issue('$.elevation.bands', 'must contain one band per level', 'INVALID_ELEVATION'));
    }
  }
  if (!assertRecord(plan.water, '$.water', issues)) {
    // no-op
  } else {
    if (plan.water.crossesMap !== true) issues.push(issue('$.water.crossesMap', 'water must cross the map', 'WATER_NOT_THROUGH'));
    if (!assertArray(plan.water.path, '$.water.path', issues) || plan.water.path.length < 2) {
      issues.push(issue('$.water.path', 'must contain at least two cells', 'INVALID_WATER_PATH'));
    } else if (isRecord(plan.grid)) {
      for (const [index, point] of plan.water.path.entries()) {
        if (!assertRecord(point, `$.water.path[${index}]`, issues)) continue;
        assertInteger(point.x, `$.water.path[${index}].x`, issues, { min: 0, max: plan.grid.columns - 1 });
        assertInteger(point.y, `$.water.path[${index}].y`, issues, { min: 0, max: plan.grid.rows - 1 });
      }
      const start = plan.water.path[0];
      const end = plan.water.path.at(-1);
      const startsBoundary = start && (start.x === 0 || start.y === 0 || start.x === plan.grid.columns - 1 || start.y === plan.grid.rows - 1);
      const endsBoundary = end && (end.x === 0 || end.y === 0 || end.x === plan.grid.columns - 1 || end.y === plan.grid.rows - 1);
      if (!startsBoundary || !endsBoundary) issues.push(issue('$.water.path', 'must enter and leave at map boundaries', 'WATER_NOT_THROUGH'));
    }
  }
  const plotIds = new Set();
  if (!assertArray(plan.plots, '$.plots', issues)) {
    // no-op
  } else {
    if (plan.plots.length < 12 || plan.plots.length > 20) issues.push(issue('$.plots', 'must contain 12 to 20 plots', 'INVALID_PLOT_COUNT'));
    for (const [index, plot] of plan.plots.entries()) {
      const path = `$.plots[${index}]`;
      if (!assertRecord(plot, path, issues)) continue;
      assertNonEmptyString(plot.id, `${path}.id`, issues);
      if (plotIds.has(plot.id)) issues.push(issue(`${path}.id`, 'plot IDs must be unique', 'DUPLICATE_ID'));
      plotIds.add(plot.id);
      if (!REGION_IDS.includes(plot.region)) issues.push(issue(`${path}.region`, 'unknown region', 'INVALID_REGION'));
      if (!assertRecord(plot.cell, `${path}.cell`, issues)) continue;
      assertInteger(plot.cell.x, `${path}.cell.x`, issues, { min: 0, max: isRecord(plan.grid) ? plan.grid.columns - 1 : null });
      assertInteger(plot.cell.y, `${path}.cell.y`, issues, { min: 0, max: isRecord(plan.grid) ? plan.grid.rows - 1 : null });
      assertInteger(plot.cell.width, `${path}.cell.width`, issues, { min: 1, max: 128 });
      assertInteger(plot.cell.height, `${path}.cell.height`, issues, { min: 1, max: 128 });
      if (isRecord(plan.grid)
        && Number.isInteger(plot.cell.x) && Number.isInteger(plot.cell.y)
        && Number.isInteger(plot.cell.width) && Number.isInteger(plot.cell.height)
        && (plot.cell.x + plot.cell.width > plan.grid.columns || plot.cell.y + plot.cell.height > plan.grid.rows)) {
        issues.push(issue(`${path}.cell`, 'plot rectangle must remain inside the logical grid', 'PLOT_OUT_OF_BOUNDS'));
      }
      assertInteger(plot.elevation, `${path}.elevation`, issues, { min: 0, max: 2 });
      assertNonEmptyString(plot.terrain, `${path}.terrain`, issues);
    }
  }
  if (Array.isArray(plan.plots)) {
    for (let leftIndex = 0; leftIndex < plan.plots.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < plan.plots.length; rightIndex += 1) {
        const left = plan.plots[leftIndex]?.cell;
        const right = plan.plots[rightIndex]?.cell;
        if (isRecord(left) && isRecord(right)
          && ['x', 'y', 'width', 'height'].every((key) => Number.isInteger(left[key]) && Number.isInteger(right[key]))
          && rectanglesOverlap(left, right)) {
          issues.push(issue(`$.plots[${rightIndex}].cell`, `must not overlap $.plots[${leftIndex}].cell`, 'PLOT_OVERLAP'));
        }
      }
    }
  }
  if (!assertArray(plan.plotIds, '$.plotIds', issues)) {
    // no-op
  } else if (JSON.stringify(plan.plotIds) !== JSON.stringify([...plotIds])) {
    issues.push(issue('$.plotIds', 'must be the plots in stable order', 'PLOT_INDEX_MISMATCH'));
  }
  const regionIds = new Set();
  if (!assertArray(plan.regions, '$.regions', issues)) {
    // no-op
  } else {
    if (plan.regions.length !== REGION_IDS.length) issues.push(issue('$.regions', 'must contain all five regions', 'INVALID_REGION_COUNT'));
    for (const [index, region] of plan.regions.entries()) {
      const path = `$.regions[${index}]`;
      if (!assertRecord(region, path, issues)) continue;
      if (!REGION_IDS.includes(region.id)) issues.push(issue(`${path}.id`, 'unknown region', 'INVALID_REGION'));
      if (regionIds.has(region.id)) issues.push(issue(`${path}.id`, 'region IDs must be unique', 'DUPLICATE_ID'));
      regionIds.add(region.id);
      if (!assertArray(region.plotIds, `${path}.plotIds`, issues)) continue;
      if (region.plotIds.length < 2) issues.push(issue(`${path}.plotIds`, 'each region needs at least two plots', 'REGION_TOO_SMALL'));
      for (const plotId of region.plotIds) if (!plotIds.has(plotId)) issues.push(issue(`${path}.plotIds`, `unknown plot ${plotId}`, 'UNKNOWN_PLOT'));
      if (!plotIds.has(region.anchorPlotId)) issues.push(issue(`${path}.anchorPlotId`, 'must reference a plot', 'UNKNOWN_PLOT'));
    }
  }
  if (!assertRecord(plan.topology, '$.topology', issues)) {
    // no-op
  } else {
    if (plan.topology.entryRegion !== 'entrance') issues.push(issue('$.topology.entryRegion', 'must be entrance', 'INVALID_TOPOLOGY'));
    if (JSON.stringify(plan.topology.regionOrder) !== JSON.stringify(REGION_IDS)) issues.push(issue('$.topology.regionOrder', 'must preserve the stable region order', 'INVALID_TOPOLOGY'));
    if (!assertArray(plan.topology.edges, '$.topology.edges', issues)) {
      // no-op
    } else {
      if (JSON.stringify(plan.topology.edges) !== JSON.stringify(REGION_EDGES)) issues.push(issue('$.topology.edges', 'must be entrance -> life -> work with life branches', 'INVALID_TOPOLOGY'));
    }
  }
  const roadIds = new Set();
  if (!assertArray(plan.roads, '$.roads', issues)) {
    // no-op
  } else {
    const counts = { main: 0, branch: 0, 'dead-end': 0 };
    for (const [index, road] of plan.roads.entries()) {
      const path = `$.roads[${index}]`;
      if (!assertRecord(road, path, issues)) continue;
      assertNonEmptyString(road.id, `${path}.id`, issues);
      if (roadIds.has(road.id)) issues.push(issue(`${path}.id`, 'road IDs must be unique', 'DUPLICATE_ID'));
      roadIds.add(road.id);
      if (!OWN_KEYS.call(counts, road.kind)) issues.push(issue(`${path}.kind`, 'must be main, branch, or dead-end', 'INVALID_ROAD_KIND'));
      else counts[road.kind] += 1;
      if (!plotIds.has(road.fromPlotId) || !plotIds.has(road.toPlotId)) issues.push(issue(path, 'road endpoints must reference plots', 'UNKNOWN_PLOT'));
      if (!assertArray(road.path, `${path}.path`, issues) || road.path.length < 2) continue;
      for (const [pointIndex, point] of road.path.entries()) {
        if (!assertRecord(point, `${path}.path[${pointIndex}]`, issues)) continue;
        assertInteger(point.x, `${path}.path[${pointIndex}].x`, issues, { min: 0, max: isRecord(plan.grid) ? plan.grid.columns - 1 : null });
        assertInteger(point.y, `${path}.path[${pointIndex}].y`, issues, { min: 0, max: isRecord(plan.grid) ? plan.grid.rows - 1 : null });
      }
    }
    if (counts.main !== 1) issues.push(issue('$.roads', 'must contain exactly one main road', 'INVALID_ROAD_COUNT'));
    if (counts.branch < 3 || counts.branch > 5) issues.push(issue('$.roads', 'must contain three to five branch roads', 'INVALID_ROAD_COUNT'));
    if (counts['dead-end'] < 1 || counts['dead-end'] > 2) issues.push(issue('$.roads', 'must contain one to two dead ends', 'INVALID_ROAD_COUNT'));
  }
  if (!assertRecord(plan.roadNetwork, '$.roadNetwork', issues)) {
    // no-op
  } else {
    for (const key of ['mainRoadIds', 'branchRoadIds', 'deadEndRoadIds']) {
      if (!assertArray(plan.roadNetwork[key], `$.roadNetwork.${key}`, issues)) continue;
      for (const roadId of plan.roadNetwork[key]) if (!roadIds.has(roadId)) issues.push(issue(`$.roadNetwork.${key}`, `unknown road ${roadId}`, 'UNKNOWN_ROAD'));
    }
  }
  if (!assertArray(plan.sightlines, '$.sightlines', issues)) {
    // no-op
  } else {
    for (const [index, sightline] of plan.sightlines.entries()) {
      const path = `$.sightlines[${index}]`;
      if (!assertRecord(sightline, path, issues)) continue;
      for (const key of ['fromPlotId', 'toPlotId']) if (!plotIds.has(sightline[key])) issues.push(issue(`${path}.${key}`, 'must reference a plot', 'UNKNOWN_PLOT'));
    }
  }
  if (!assertRecord(plan.nav, '$.nav', issues)) {
    // no-op
  } else {
    if (!plotIds.has(plan.nav.startPlotId)) issues.push(issue('$.nav.startPlotId', 'must reference a plot', 'UNKNOWN_PLOT'));
    if (!assertArray(plan.nav.edges, '$.nav.edges', issues)) {
      // no-op
    } else {
      for (const [index, edge] of plan.nav.edges.entries()) {
        if (!assertRecord(edge, `$.nav.edges[${index}]`, issues)) continue;
        if (!plotIds.has(edge.from) || !plotIds.has(edge.to)) issues.push(issue(`$.nav.edges[${index}]`, 'must reference known plots', 'UNKNOWN_PLOT'));
      }
    }
    if (!assertArray(plan.nav.reachablePlotIds, '$.nav.reachablePlotIds', issues)) {
      // no-op
    } else if (new Set(plan.nav.reachablePlotIds).size !== plotIds.size || plan.nav.reachablePlotIds.some((plotId) => !plotIds.has(plotId))) {
      issues.push(issue('$.nav.reachablePlotIds', 'must list every plot exactly once', 'UNREACHABLE_PLOT'));
    }
    if (!assertRecord(plan.nav.regionByPlot, '$.nav.regionByPlot', issues)) {
      // no-op
    } else {
      for (const plotId of plotIds) if (!REGION_IDS.includes(plan.nav.regionByPlot[plotId])) issues.push(issue(`$.nav.regionByPlot.${plotId}`, 'must name a known region', 'INVALID_REGION'));
    }
  }
  for (const key of ['occupancy', 'facilityAssignments', 'rooms', 'npcs', 'props', 'lights', 'questSites']) {
    if (!assertArray(plan[key], `$.${key}`, issues)) continue;
    for (const [index, entry] of plan[key].entries()) {
      if (!assertRecord(entry, `$.${key}[${index}]`, issues)) continue;
      if (OWN_KEYS.call(entry, 'plotId') && !plotIds.has(entry.plotId)) issues.push(issue(`$.${key}[${index}].plotId`, 'must reference a plot', 'UNKNOWN_PLOT'));
    }
  }
  if (Array.isArray(plan.questSites) && isRecord(plan.townState?.investigations)) {
    const candidates = new Map((plan.townState.investigations.candidates ?? []).map((candidate) => [candidate.id, candidate]));
    const occupantPlotByKind = new Map(plan.occupancy.flatMap((entry) => entry.occupants.map((occupant) => [occupant.kind, entry.plotId])));
    const seenCandidates = new Set();
    for (const [index, site] of plan.questSites.entries()) {
      const path = `$.questSites[${index}]`;
      if (!isRecord(site)) continue;
      if (JSON.stringify(Object.keys(site).sort(compareStrings)) !== JSON.stringify(['action', 'candidateId', 'evidence', 'id', 'plotId'])) issues.push(issue(path, 'must contain exactly id, candidateId, plotId, action, and evidence', 'INVALID_QUEST_SITE'));
      assertNonEmptyString(site.id, `${path}.id`, issues);
      assertNonEmptyString(site.candidateId, `${path}.candidateId`, issues);
      assertNonEmptyString(site.action, `${path}.action`, issues);
      validateEvidenceBag(site.evidence, `${path}.evidence`, issues);
      const candidate = candidates.get(site.candidateId);
      if (!candidate) issues.push(issue(`${path}.candidateId`, 'must reference a TownModel investigation candidate', 'UNKNOWN_CANDIDATE'));
      if (seenCandidates.has(site.candidateId)) issues.push(issue(`${path}.candidateId`, 'candidate may be placed only once', 'DUPLICATE_ID'));
      seenCandidates.add(site.candidateId);
      if (candidate) {
        const occupiedPlot = occupantPlotByKind.get(candidate.facilityKind);
        const actualRegion = plan.nav.regionByPlot[site.plotId];
        if (occupiedPlot && site.plotId !== occupiedPlot) issues.push(issue(`${path}.plotId`, 'must use the plot occupied by the corresponding facility', 'QUEST_FACILITY_MISMATCH'));
        if (!occupiedPlot && actualRegion !== facilityRegion(candidate.facilityKind)) issues.push(issue(`${path}.plotId`, 'must use a vacant/planned plot in the corresponding facility region', 'QUEST_FACILITY_MISMATCH'));
      }
    }
    if (seenCandidates.size !== candidates.size) issues.push(issue('$.questSites', 'must place every real investigation candidate exactly once', 'QUEST_UNASSIGNED'));
  }
  if (!assertArray(plan.rewardBindings, '$.rewardBindings', issues)) {
    // no-op
  } else {
    for (const [index, binding] of plan.rewardBindings.entries()) {
      if (!assertRecord(binding, `$.rewardBindings[${index}]`, issues)) continue;
      assertNonEmptyString(binding.id, `$.rewardBindings[${index}].id`, issues);
    }
    if (plan.rewardBindings.length !== 9) issues.push(issue('$.rewardBindings', 'must contain exactly nine bindings', 'INVALID_REWARD_COUNT'));
  }
  if (!assertRecord(plan.townState, '$.townState', issues)) {
    // Domain content is required by the scene compiler and runtime.
  } else {
    const townStateKeys = Object.keys(plan.townState).sort(compareStrings);
    if (JSON.stringify(townStateKeys) !== JSON.stringify(['guild', 'habitability', 'investigations', 'rewards'])) {
      issues.push(issue('$.townState', 'must contain guild, habitability, investigations, and rewards', 'INVALID_TOWN_STATE'));
    }
    if (!assertRecord(plan.townState.habitability, '$.townState.habitability', issues)) {
      // no-op
    }
    if (!assertRecord(plan.townState.guild, '$.townState.guild', issues)) {
      // no-op
    } else {
      for (const key of ['tabs', 'representativeConnections', 'connections']) assertArray(plan.townState.guild[key], `$.townState.guild.${key}`, issues);
      if (Array.isArray(plan.townState.guild.tabs) && plan.townState.guild.tabs.length !== 5) issues.push(issue('$.townState.guild.tabs', 'must contain five tabs', 'INVALID_GUILD_TABS'));
    }
    if (!assertRecord(plan.townState.investigations, '$.townState.investigations', issues)) {
      // no-op
    } else {
      assertArray(plan.townState.investigations.priority, '$.townState.investigations.priority', issues);
      assertArray(plan.townState.investigations.candidates, '$.townState.investigations.candidates', issues);
    }
    if (!assertRecord(plan.townState.rewards, '$.townState.rewards', issues)) {
      // no-op
    } else {
      assertArray(plan.townState.rewards.bindings, '$.townState.rewards.bindings', issues);
      assertArray(plan.townState.rewards.transitions, '$.townState.rewards.transitions', issues);
    }
  }
  if (assertArray(plan.occupancy, '$.occupancy', issues)) {
    const occupancyPlots = new Set();
    for (const entry of plan.occupancy) {
      if (!isRecord(entry)) continue;
      if (occupancyPlots.has(entry.plotId)) issues.push(issue('$.occupancy', 'each plot may have one occupancy record', 'DUPLICATE_ID'));
      occupancyPlots.add(entry.plotId);
      if (!plotIds.has(entry.plotId)) issues.push(issue('$.occupancy', 'unknown plot', 'UNKNOWN_PLOT'));
      if (!['occupied', 'vacant'].includes(entry.state)) issues.push(issue('$.occupancy.state', 'must be occupied or vacant', 'INVALID_OCCUPANCY'));
      if (!Array.isArray(entry.occupants)) issues.push(issue('$.occupancy.occupants', 'must be an array', 'INVALID_ARRAY'));
    }
    if (occupancyPlots.size !== plotIds.size) issues.push(issue('$.occupancy', 'must include every plot', 'INVALID_OCCUPANCY'));
  }
  validateEvidenceBag(plan.evidence, '$.evidence', issues);
  if (!assertRecord(plan.l1, '$.l1', issues)) {
    // no-op
  }
  if (!assertRecord(plan.l2, '$.l2', issues)) {
    // no-op
  }
  if (isRecord(plan.l1) && JSON.stringify(plan.l1) !== JSON.stringify(geometrySnapshot(plan))) {
    issues.push(issue('$.l1', 'must mirror the top-level L1 geometry exactly', 'LAYER_MISMATCH'));
  }
  if (isRecord(plan.l2)) {
    const expectedL2 = {
      occupancy: plan.occupancy,
      facilityAssignments: plan.facilityAssignments,
      rooms: plan.rooms,
      npcs: plan.npcs,
      props: plan.props,
      lights: plan.lights,
      questSites: plan.questSites,
      townState: plan.townState,
      evidence: plan.evidence,
    };
    if (JSON.stringify(plan.l2) !== JSON.stringify(expectedL2)) issues.push(issue('$.l2', 'must mirror the top-level L2 data exactly', 'LAYER_MISMATCH'));
  }
  if (issues.length > 0) fail('WorldPlan failed the version 1 contract', issues);
  return true;
}

function graphReachable(plan) {
  const graph = new Map(plan.plotIds.map((plotId) => [plotId, new Set()]));
  for (const edge of plan.nav.edges) {
    graph.get(edge.from)?.add(edge.to);
    graph.get(edge.to)?.add(edge.from);
  }
  const seen = new Set([plan.nav.startPlotId]);
  const queue = [plan.nav.startPlotId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const target of graph.get(current) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

function assertRegionReachability(plan) {
  const reachable = graphReachable(plan);
  const issues = [];
  for (const region of plan.regions) {
    if (!region.plotIds.some((plotId) => reachable.has(plotId))) {
      issues.push(issue(`$.regions.${region.id}`, 'region is not reachable from entrance', 'UNREACHABLE_REGION'));
    }
  }
  if (reachable.size !== plan.plotIds.length) issues.push(issue('$.nav', 'not every plot is reachable from entrance', 'UNREACHABLE_PLOT'));
  if (issues.length > 0) fail('WorldPlan navigation is disconnected', issues, 'WORLD_PLAN_UNREACHABLE');
}

function assertNoPixelFields(value, path = '$', seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const issues = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => issues.push(...assertNoPixelFields(entry, `${path}[${index}]`, seen)));
    return issues;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:pixel|px|image|texture|canvas|dom|render)/iu.test(key)) {
      issues.push(issue(`${path}.${key}`, 'WorldPlan may contain logical cells only', 'PIXEL_FIELD_FORBIDDEN'));
    }
    issues.push(...assertNoPixelFields(child, `${path}.${key}`, seen));
  }
  return issues;
}

/**
 * Generate a deterministic logical town.  The L1 structure is derived only
 * from town.identity.key; the optional seed changes L2's deterministic stream
 * without moving the town's face.
 */
export function generateWorldPlan({ town, seed } = {}) {
  const normalizedTown = normalizeTownModel(town);
  const plan = buildPlan(normalizedTown, seed);
  validateWorldPlan(plan);
  return plan;
}

/**
 * Validate a serialized WorldPlan.  A valid plan is returned as a frozen,
 * non-mutating clone.  Invalid plans throw WorldPlanValidationError with an
 * `issues` array; no best-effort fallback is ever selected.
 */
export function validateWorldPlan(plan, { town } = {}) {
  validatePlanShape(plan);
  const pixelIssues = assertNoPixelFields(plan);
  if (pixelIssues.length > 0) fail('WorldPlan contains renderer-specific fields', pixelIssues, 'PIXEL_FIELD_FORBIDDEN');
  assertRegionReachability(plan);
  if (town !== undefined) {
    const normalizedTown = normalizeTownModel(town);
    if (plan.identity.key !== normalizedTown.identity.key || plan.identity.name !== normalizedTown.identity.name) {
      fail('WorldPlan identity does not match TownModel identity', [issue('$.identity', 'must match town.identity', 'IDENTITY_MISMATCH')], 'IDENTITY_MISMATCH');
    }
    const expected = buildPlan(normalizedTown);
    if (JSON.stringify(geometrySnapshot(plan)) !== JSON.stringify(geometrySnapshot(expected))) {
      fail('WorldPlan L1 geometry is unstable for this identity', [issue('$', 'terrain, roads, topology, and plots must derive only from identity', 'L1_UNSTABLE')], 'L1_UNSTABLE');
    }
    const assigned = new Set(plan.occupancy.flatMap((entry) => entry.occupants.map((occupant) => occupant.facilityId)));
    for (const facility of normalizedTown.facilities.filter(facilityIsApplicable)) {
      if (!assigned.has(facility.id)) fail('WorldPlan occupancy dropped a facility', [issue('$.occupancy', `facility ${facility.id} is not assigned`, 'FACILITY_UNASSIGNED')], 'FACILITY_UNASSIGNED');
    }
    const candidateIds = new Set(plan.questSites.map((site) => site.candidateId));
    for (const candidate of normalizedTown.investigations.candidates) {
      if (!candidateIds.has(candidate.id)) fail('WorldPlan quest sites dropped a candidate', [issue('$.questSites', `candidate ${candidate.id} is not placed`, 'QUEST_UNASSIGNED')], 'QUEST_UNASSIGNED');
    }
  }
  return deepFreeze(stableClone(plan));
}
