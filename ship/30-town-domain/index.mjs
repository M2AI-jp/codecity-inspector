// Pure SemanticModel -> TownModel domain boundary.  This module deliberately
// has no imports: a town is facts and decisions, never I/O, geometry, assets,
// or randomness.

const TOWN_SCHEMA_VERSION = 1;
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);
const FACILITY_KINDS = Object.freeze([
  'inn', 'pub', 'guild', 'town_hall', 'dock', 'warehouse', 'well',
  'workshop', 'dojo', 'watchtower', 'house', 'shop', 'ruin', 'gate',
]);
const GUILD_TABS = Object.freeze(['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい']);
const INVESTIGATION_PRIORITY = Object.freeze([
  'entrypoint', 'persistence', 'configuration', 'test', 'observability', 'recovery',
]);
const INVESTIGATION_COPY = Object.freeze({
  entrypoint: Object.freeze({ subject: '城門と宿屋の入口', statement: '城門から人が入れる' }),
  persistence: Object.freeze({ subject: '倉庫の台帳', statement: '倉庫に記録が残る' }),
  configuration: Object.freeze({ subject: '井戸の水', statement: '井戸から水が使える' }),
  test: Object.freeze({ subject: '道場の検査', statement: '道場に検査済みの印がある' }),
  observability: Object.freeze({ subject: '見張り台の記録', statement: '見張り台に夜の記録がある' }),
  recovery: Object.freeze({ subject: '修理小屋の道具', statement: '修理小屋に戻すための道具がある' }),
  ruin: Object.freeze({ subject: '廃屋に残された物', statement: '廃屋に由来のわかる物が残っている' }),
});

const LABELS = Object.freeze({
  inn: '宿屋', pub: '酒場', guild: '接続者ギルド', town_hall: '役場', dock: '船着場',
  warehouse: '倉庫', well: '井戸', workshop: '工房', dojo: '道場', watchtower: '見張り台',
  house: '住宅', shop: '商店', ruin: '廃屋', gate: '門',
});
const LEVEL_LABELS = Object.freeze([
  'まだ、誰も来ていません。', '明かりがひとつ、つきました。', 'このままだと誰も住めません！',
  '人が住めます。', 'にぎわっています。', '見せたくなる街です。',
]);
const FACILITY_CAPABILITIES = Object.freeze({
  gate: ['entrypoint'], inn: ['entrypoint'], pub: ['externalConnections'], guild: ['externalConnections'],
  town_hall: ['distribution'], dock: ['distribution'], warehouse: ['persistence'], well: ['configuration'],
  workshop: ['build'], dojo: ['test'], watchtower: ['observability'], shop: ['recovery'],
  house: [], ruin: [],
});
const FACILITY_ROLES = Object.freeze({
  gate: 'entrypoint', inn: 'service', pub: 'external-connections', guild: 'connection-roster',
  town_hall: 'governance', dock: 'distribution', warehouse: 'persistence', well: 'configuration',
  workshop: 'build', dojo: 'verification', watchtower: 'observability', house: 'module',
  shop: 'repair', ruin: 'dirt',
});
const TAB_IDS = Object.freeze(['companions', 'reception', 'requests', 'items', 'status']);
const TAB_KINDS = Object.freeze({ companions: ['llm', 'external-api'], reception: ['inbound'], requests: ['outbound', 'http', 'webhook'], });

// The nine bindings are the complete reward vocabulary.  A binding is only
// activated by an explicitly observed transition; static semantic evidence or
// a contractor's claim never activates one.
const REWARD_BINDINGS = Object.freeze([
  { id: 'reward.build_passed', event: 'build_passed', transition: 'build_passed', facilityKind: 'workshop', effect: 'forge_fire' },
  { id: 'reward.local_run', event: 'local_run', transition: 'local_run', facilityKind: 'town_hall', effect: 'town_powered' },
  { id: 'reward.public_url_responded', event: 'public_url_responded', transition: 'public_url_responded', facilityKind: 'inn', effect: 'inn_lit' },
  { id: 'reward.real_access', event: 'real_access', transition: 'real_access', facilityKind: 'inn', effect: 'traveler_arrived' },
  { id: 'reward.external_api_responded', event: 'external_api_responded', transition: 'external_api_responded', facilityKind: 'pub', effect: 'pub_bustle' },
  { id: 'reward.distribution_released', event: 'distribution_released', transition: 'distribution_released', facilityKind: 'dock', effect: 'ship_departed' },
  { id: 'reward.logs_recorded', event: 'logs_recorded', transition: 'logs_recorded', facilityKind: 'watchtower', effect: 'watch_lit' },
  { id: 'reward.tests_passed', event: 'tests_passed', transition: 'tests_passed', facilityKind: 'dojo', effect: 'inspection_stamp' },
  { id: 'reward.rollback_confirmed', event: 'rollback_confirmed', transition: 'rollback_confirmed', facilityKind: 'shop', effect: 'repair_tools' },
]);
const REWARD_BY_EVENT = new Map(REWARD_BINDINGS.map((binding) => [binding.event, binding]));

class TownDomainError extends TypeError {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'TownDomainError';
    this.code = code;
    this.issues = issues;
  }
}

export function buildTownModel(semanticModel) {
  assertSemanticModel(semanticModel);
  const files = normalizeFiles(semanticModel.files);
  const capabilities = normalizeCapabilities(semanticModel.capabilities);
  const connections = normalizeConnections(semanticModel.connections);
  const personality = derivePersonality(files, capabilities, connections);
  const facts = capabilityFacts(capabilities);
  facts.push({ id: 'repository.personality', kind: 'personality', subject: personality, state: 'inferred', evidence: { observed: [], inferred: [`personality.${personality}`], unknown: [] } });
  const facilities = FACILITY_KINDS.map((kind) => makeFacility(kind, files, capabilities, connections, personality));
  const dirt = facilities.find((facility) => facility.kind === 'ruin');
  if (dirt?.presence === 'present') {
    facts.push({ id: 'dirt.legacy', kind: 'dirt', subject: 'ruin', state: 'inferred', evidence: dirt.evidence });
  }
  facts.sort((a, b) => a.id.localeCompare(b.id));
  const guild = makeGuild(connections, files);
  const investigations = makeInvestigations(capabilities, facilities, dirt);
  const habitability = makeHabitability(capabilities, facilities);
  const rewards = makeRewards(semanticModel);
  return {
    schemaVersion: TOWN_SCHEMA_VERSION,
    inspectionDigest: stringOrNull(semanticModel.inspectionDigest),
    repository: normalizeRepository(semanticModel.repository),
    facilities,
    facts,
    guild,
    investigations,
    habitability,
    rewards,
  };
}

function assertSemanticModel(model) {
  if (!isRecord(model) || model.schemaVersion !== 1) {
    throw new TownDomainError('SEMANTIC_SCHEMA_UNSUPPORTED', 'Town domain requires SemanticModel v1');
  }
}

function normalizeRepository(repository) {
  return { name: stringOrNull(repository?.name), identity: stringOrNull(repository?.identity) };
}

function normalizeFiles(source) {
  const byId = new Map();
  for (const raw of Array.isArray(source) ? source : []) {
    if (!isRecord(raw)) continue;
    const fileId = stringOrNull(raw.fileId) ?? stringOrNull(raw.id) ?? stringOrNull(raw.path);
    const path = stringOrNull(raw.path) ?? fileId;
    if (!fileId || !path) continue;
    const file = { fileId, path, role: validRole(raw.role), evidence: normalizeEvidence(raw.evidence) };
    if (!hasEvidence(file.evidence)) file.evidence.unknown.push(`file.${fileId}.unknown`);
    const current = byId.get(fileId);
    if (!current || path.localeCompare(current.path) < 0) byId.set(fileId, file);
  }
  return [...byId.values()].sort((a, b) => a.fileId.localeCompare(b.fileId));
}

function normalizeCapabilities(source) {
  const result = {};
  for (const name of CAPABILITY_NAMES) {
    const raw = isRecord(source?.[name]) ? source[name] : {};
    const state = EVIDENCE_STATES.includes(raw.state) ? raw.state : 'unknown';
    const evidence = evidenceForState(raw.evidence, state, `capability.${name}.${state}`);
    result[name] = { state, evidence };
  }
  return result;
}

function normalizeConnections(source) {
  const byId = new Map();
  for (const raw of Array.isArray(source) ? source : []) {
    if (!isRecord(raw)) continue;
    const id = stringOrNull(raw.id) ?? stringOrNull(raw.connectionId);
    if (!id) continue;
    const evidence = normalizeEvidence(raw.evidence);
    if (!hasEvidence(evidence)) evidence.unknown.push(`connection.${id}.unknown`);
    const count = finiteCount(raw);
    const item = {
      id,
      direction: stringOrNull(raw.direction) ?? 'internal',
      kind: stringOrNull(raw.kind) ?? 'unknown',
      target: stringOrNull(raw.target) ?? id,
      sourceFileIds: uniqueStrings(Array.isArray(raw.sourceFileIds) ? raw.sourceFileIds : []),
      evidence,
      state: evidenceState(evidence),
      invocationCount: count,
    };
    const previous = byId.get(id);
    byId.set(id, previous ? mergeConnection(previous, item) : item);
  }
  return [...byId.values()].sort(compareId);
}

function mergeConnection(a, b) {
  return { ...a, sourceFileIds: uniqueStrings([...a.sourceFileIds, ...b.sourceFileIds]), evidence: mergeEvidence(a.evidence, b.evidence), state: evidenceState(mergeEvidence(a.evidence, b.evidence)), invocationCount: Math.max(a.invocationCount, b.invocationCount) };
}

function capabilityFacts(capabilities) {
  return CAPABILITY_NAMES.map((name) => ({
    id: `capability.${name}`,
    kind: 'capability',
    subject: name,
    state: capabilities[name].state,
    evidence: capabilities[name].evidence,
  }));
}

function makeFacility(kind, files, capabilities, connections, personality) {
  let evidence = emptyEvidence();
  const sourceFileIds = new Set();
  for (const capability of FACILITY_CAPABILITIES[kind] ?? []) evidence = mergeEvidence(evidence, capabilities[capability].evidence);
  const roles = roleSignals(kind);
  for (const file of files) {
    if (roles.includes(file.role) || (kind === 'ruin' && isDirtPath(file.path))) {
      sourceFileIds.add(file.fileId);
      evidence = mergeEvidence(evidence, file.evidence);
    }
  }
  if (kind === 'pub' || kind === 'guild') {
    for (const connection of connections) {
      evidence = mergeEvidence(evidence, connection.evidence);
      for (const id of connection.sourceFileIds) sourceFileIds.add(id);
    }
  }
  if (kind === 'ruin') {
    const dirty = files.filter((file) => isDirtPath(file.path));
    if (dirty.length) evidence = mergeEvidence(evidence, { inferred: ['facility.ruin.dirt'], unknown: [], observed: [] });
  }
  if (kind === 'town_hall') evidence = mergeEvidence(evidence, { observed: [], inferred: ['facility.town_hall.repository'], unknown: [] });
  if (!hasEvidence(evidence)) evidence.unknown.push(`facility.${kind}.unknown`);
  if (isPersonalityIrrelevant(kind, personality)) evidence = mergeEvidence(evidence, { observed: [], inferred: [`facility.${kind}.not_applicable.${personality}`], unknown: [] });
  const explicitMissing = evidence.observed.some((key) => /(?:missing|absent|not[-_. ]?found|unavailable|disabled)/i.test(key));
  const capabilityKnown = (FACILITY_CAPABILITIES[kind] ?? []).some((capability) => capabilities[capability].state !== 'unknown');
  const connectionKnown = (kind === 'pub' || kind === 'guild') && connections.some((connection) => connection.state !== 'unknown');
  const structuralKnown = kind === 'house' && roles.some((role) => files.some((file) => file.role === role));
  const dirtKnown = kind === 'ruin' && files.some((file) => isDirtPath(file.path));
  const applicableEvidence = capabilityKnown || connectionKnown || structuralKnown || dirtKnown || kind === 'town_hall';
  const presence = isPersonalityIrrelevant(kind, personality) ? 'not_applicable' : explicitMissing ? 'missing' : kind === 'ruin' && !dirtKnown ? 'not_applicable' : applicableEvidence ? 'present' : 'unknown';
  const condition = kind === 'ruin' && presence === 'present' ? 'dirt' : presence === 'present' ? 'active' : presence === 'missing' ? 'missing' : presence === 'not_applicable' ? 'not_applicable' : 'unconfirmed';
  return {
    kind,
    label: LABELS[kind],
    role: FACILITY_ROLES[kind],
    variant: kind === 'shop' ? 'repair' : null,
    presence,
    condition,
    blocksProgress: kind !== 'ruin' && presence === 'missing',
    sourceFileIds: [...sourceFileIds].sort(),
    evidence,
  };
}

function roleSignals(kind) {
  return ({
    gate: ['interface'], inn: ['interface', 'service'], pub: ['interface', 'service'], guild: ['interface', 'service', 'data'],
    town_hall: ['tooling', 'configuration'], dock: ['tooling'], warehouse: ['data'], well: ['configuration'],
    workshop: ['tooling', 'service'], dojo: ['test'], watchtower: ['service', 'interface'], house: ['module', 'service'], shop: ['service', 'tooling'], ruin: [],
  })[kind] ?? [];
}

function makeGuild(connections, files) {
  const all = connections.map((connection) => ({ ...connection, evidence: normalizeEvidence(connection.evidence) }));
  const entries = (kind) => all.filter((connection) => (TAB_KINDS[kind] ?? []).some((token) => token === connection.direction || token === connection.kind)).map(tabEntry);
  const items = files.filter((file) => ['configuration', 'data', 'interface'].includes(file.role)).map((file) => ({ id: `item.${file.fileId}`, name: file.path, state: evidenceState(file.evidence), evidence: file.evidence }));
  const tabs = TAB_IDS.map((id, index) => {
    const tabEntries = id === 'items' ? items : id === 'status' ? all.map((connection) => ({ id: connection.id, name: connection.target, state: connection.state, status: statusLabel(connection.state), evidence: connection.evidence })) : entries(id);
    return { id, label: GUILD_TABS[index], entries: tabEntries, evidence: tabEntries.reduce((bag, entry) => mergeEvidence(bag, entry.evidence), emptyEvidence()) };
  });
  const representativeConnections = [...all].sort((a, b) => b.invocationCount - a.invocationCount || a.id.localeCompare(b.id)).slice(0, 3);
  return { tabs, representativeConnections, connections: all };
}

function tabEntry(connection) { return { id: connection.id, name: connection.target, state: connection.state, evidence: connection.evidence }; }
function statusLabel(state) { return state === 'observed' ? '観測済み' : state === 'inferred' ? '推定' : '未確認'; }

function makeInvestigations(capabilities, facilities, ruin) {
  const candidates = [];
  for (const capability of INVESTIGATION_PRIORITY) {
    const fact = capabilities[capability];
    const facilityKind = ({ entrypoint: 'gate', persistence: 'warehouse', configuration: 'well', test: 'dojo', observability: 'watchtower', recovery: 'shop' })[capability];
    const facility = facilities.find((entry) => entry.kind === facilityKind);
    if (fact.state === 'observed' || facility?.presence === 'not_applicable') continue;
    candidates.push({
      id: `investigation.${capability}`,
      capability,
      facilityKind,
      role: FACILITY_ROLES[facilityKind],
      variant: facilityKind === 'shop' ? 'repair' : null,
      subject: INVESTIGATION_COPY[capability].subject,
      statement: INVESTIGATION_COPY[capability].statement,
      state: fact.state,
      evidence: fact.evidence,
    });
    if (candidates.length === 3) break;
  }
  if (candidates.length < 3 && ruin?.presence === 'present') {
    const dirtSources = ruin.sourceFileIds.length ? ruin.sourceFileIds : ['dirt'];
    for (const [index, source] of dirtSources.entries()) {
      if (candidates.length === 3) break;
      candidates.push({
        id: index === 0 ? 'investigation.ruin' : `investigation.ruin.${source}`,
        capability: null,
        facilityKind: 'ruin',
        role: 'dirt',
        variant: null,
        subject: INVESTIGATION_COPY.ruin.subject,
        statement: INVESTIGATION_COPY.ruin.statement,
        state: 'inferred',
        evidence: ruin.evidence,
      });
    }
  }
  return { priority: [...INVESTIGATION_PRIORITY], candidates };
}

function makeHabitability(capabilities, facilities) {
  const knownCapabilities = CAPABILITY_NAMES.filter((name) => capabilities[name].state !== 'unknown');
  const unknownCapabilities = CAPABILITY_NAMES.filter((name) => capabilities[name].state === 'unknown');
  const criticalKnown = INVESTIGATION_PRIORITY.filter((name) => capabilities[name].state !== 'unknown').length;
  const level = criticalKnown === 0 ? (knownCapabilities.length ? 1 : 0) : criticalKnown === 1 ? 1 : criticalKnown === 2 ? 2 : criticalKnown <= 4 ? 3 : criticalKnown === 5 ? 4 : 5;
  let evidence = emptyEvidence();
  for (const name of CAPABILITY_NAMES) evidence = mergeEvidence(evidence, capabilities[name].evidence);
  const dirt = facilities.filter((facility) => facility.condition === 'dirt').map((facility) => facility.kind);
  return { level, label: LEVEL_LABELS[level], knownCapabilities, unknownCapabilities, dirt, evidence };
}

function makeRewards(semanticModel) {
  const transitions = [];
  const sources = [];
  for (const raw of Array.isArray(semanticModel.observedTransitions) ? semanticModel.observedTransitions : []) sources.push(raw);
  for (const raw of Array.isArray(semanticModel.transitions) ? semanticModel.transitions : []) sources.push(raw);
  for (const raw of Array.isArray(semanticModel.events) ? semanticModel.events : []) sources.push(raw);
  for (const raw of sources) {
    if (!isRecord(raw) || isSelfReport(raw)) continue;
    const event = canonicalEvent(raw.event ?? raw.transition ?? raw.name ?? raw.type ?? raw.id);
    const binding = REWARD_BY_EVENT.get(event);
    if (!binding) continue;
    const evidence = normalizeEvidence(raw.evidence);
    // A field name or state label is not proof. Reward activation requires an
    // actual observed evidence address preserved from the upstream report.
    if (evidence.observed.length === 0) continue;
    transitions.push({ id: stringOrNull(raw.id) ?? `transition.${event}.${transitions.length + 1}`, event, bindingId: binding.id, facilityKind: binding.facilityKind, effect: binding.effect, state: 'observed', evidence });
  }
  transitions.sort(compareId);
  return { bindings: REWARD_BINDINGS.map((binding) => ({ ...binding })), transitions };
}

const EVENT_ALIASES = Object.freeze({ build: 'build_passed', build_passed: 'build_passed', local_run: 'local_run', localrun: 'local_run', public_url: 'public_url_responded', public_url_responded: 'public_url_responded', real_access: 'real_access', visitor_access: 'real_access', external_api: 'external_api_responded', external_api_responded: 'external_api_responded', distribution: 'distribution_released', distribution_released: 'distribution_released', release: 'distribution_released', logs: 'logs_recorded', logs_recorded: 'logs_recorded', tests: 'tests_passed', tests_passed: 'tests_passed', rollback: 'rollback_confirmed', rollback_confirmed: 'rollback_confirmed' });
function canonicalEvent(value) { const key = String(value ?? '').toLowerCase().replace(/[- ]/g, '_'); return EVENT_ALIASES[key] ?? key; }
function isSelfReport(raw) { return raw.selfReport === true || /self[-_ ]?report|claim|contractor/i.test(String(raw.source ?? raw.actor ?? raw.actorType ?? '')); }

export function validateTownModel(model) {
  const issues = [];
  if (!isRecord(model) || model.schemaVersion !== TOWN_SCHEMA_VERSION) issues.push(issue('SCHEMA_VERSION', 'schemaVersion', 'TownModel v1 required'));
  if (typeof model?.inspectionDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(model.inspectionDigest)) issues.push(issue('INSPECTION_DIGEST', 'inspectionDigest', 'lowercase SHA-256 required'));
  if (!isRecord(model?.repository) || typeof model.repository.name !== 'string' || !model.repository.name || typeof model.repository.identity !== 'string' || !model.repository.identity) issues.push(issue('REPOSITORY', 'repository', 'name and identity required'));
  const facilities = Array.isArray(model?.facilities) ? model.facilities : [];
  const kinds = facilities.map((facility) => facility?.kind);
  if (facilities.length !== FACILITY_KINDS.length || new Set(kinds).size !== FACILITY_KINDS.length || FACILITY_KINDS.some((kind) => !kinds.includes(kind))) issues.push(issue('FACILITIES_CANONICAL', 'facilities', 'exactly one entry for each canonical facility kind required'));
  for (const facility of facilities) {
    if (!facility || !FACILITY_KINDS.includes(facility.kind)) continue;
    if (!isEvidence(facility.evidence)) issues.push(issue('EVIDENCE_BAG', `facilities.${facility.kind}.evidence`, 'tri-bag required'));
    if (facility.kind === 'shop' && (facility.variant !== 'repair' || facility.role !== 'repair')) issues.push(issue('REPAIR_VARIANT', 'facilities.shop', 'repair must be shop role variant'));
    if (facility.kind === 'ruin' && (facility.condition !== 'dirt' || facility.blocksProgress !== false) && facility.presence === 'present') issues.push(issue('DIRT_NOT_MISSING', 'facilities.ruin', 'dirt is present and walkable'));
  }
  if (!Array.isArray(model?.facts)) issues.push(issue('FACTS_ARRAY', 'facts', 'facts array required'));
  if (!Array.isArray(model?.guild?.tabs) || model.guild.tabs.length !== 5 || model.guild.tabs.some((tab, index) => tab?.label !== GUILD_TABS[index])) issues.push(issue('GUILD_TABS', 'guild.tabs', 'five canonical guild tabs required'));
  if (!Array.isArray(model?.guild?.representativeConnections) || model.guild.representativeConnections.length > 3) issues.push(issue('REPRESENTATIVES', 'guild.representativeConnections', 'at most three representative connections'));
  if (JSON.stringify(model?.investigations?.priority) !== JSON.stringify(INVESTIGATION_PRIORITY)) issues.push(issue('INVESTIGATION_PRIORITY', 'investigations.priority', 'priority order is fixed'));
  if (!Array.isArray(model?.investigations?.candidates) || model.investigations.candidates.length > 3) {
    issues.push(issue('INVESTIGATION_CANDIDATES', 'investigations.candidates', 'zero through three real candidates required'));
  } else {
    const expectedKeys = ['capability', 'evidence', 'facilityKind', 'id', 'role', 'state', 'statement', 'subject', 'variant'];
    for (const [index, candidate] of model.investigations.candidates.entries()) {
      const path = `investigations.candidates[${index}]`;
      if (!isRecord(candidate) || JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(expectedKeys)) {
        issues.push(issue('INVESTIGATION_CANDIDATE', path, 'candidate fields must be exact'));
        continue;
      }
      if (![candidate.id, candidate.facilityKind, candidate.role, candidate.subject, candidate.statement].every((value) => typeof value === 'string' && value.length > 0)) issues.push(issue('INVESTIGATION_CANDIDATE', path, 'candidate identity and domain copy are required'));
      if (!EVIDENCE_STATES.includes(candidate.state) || !isEvidence(candidate.evidence)) issues.push(issue('INVESTIGATION_CANDIDATE', path, 'candidate state and tri-state evidence are required'));
    }
  }
  if (!Number.isInteger(model?.habitability?.level) || model.habitability.level < 0 || model.habitability.level > 5) issues.push(issue('LEVEL', 'habitability.level', 'Lv must be 0..5'));
  if (!Array.isArray(model?.rewards?.bindings) || model.rewards.bindings.length !== REWARD_BINDINGS.length || model.rewards.bindings.some((binding, index) => binding?.id !== REWARD_BINDINGS[index].id)) issues.push(issue('REWARD_BINDINGS', 'rewards.bindings', 'exactly nine allowed bindings required'));
  for (const transition of Array.isArray(model?.rewards?.transitions) ? model.rewards.transitions : []) {
    if (transition?.state !== 'observed' || !REWARD_BY_EVENT.has(transition.event) || isSelfReport(transition) || !isEvidence(transition?.evidence) || transition.evidence.observed.length === 0) {
      issues.push(issue('REWARD_TRANSITION', 'rewards.transitions', 'only transitions with preserved observed evidence may activate rewards'));
    }
  }
  return { ok: issues.length === 0, issues };
}
function issue(code, path, message) { return { code, path, message }; }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function stringOrNull(value) { return typeof value === 'string' && value.length ? value : null; }
function validRole(value) { return ['service', 'interface', 'data', 'configuration', 'test', 'tooling', 'module'].includes(value) ? value : 'module'; }
function uniqueStrings(values) { return [...new Set((values ?? []).filter((value) => typeof value === 'string' && value.length))].sort(); }
function compareId(a, b) { return a.id.localeCompare(b.id); }
function emptyEvidence() { return { observed: [], inferred: [], unknown: [] }; }
function hasEvidence(evidence) { return EVIDENCE_STATES.some((state) => evidence[state].length > 0); }
function normalizeEvidence(value) { const result = emptyEvidence(); if (Array.isArray(value)) result.unknown.push(...uniqueStrings(value)); else if (isRecord(value)) for (const state of EVIDENCE_STATES) result[state].push(...uniqueStrings(value[state])); for (const state of EVIDENCE_STATES) result[state] = uniqueStrings(result[state]); return result; }
function mergeEvidence(...bags) { const result = emptyEvidence(); for (const bag of bags) for (const state of EVIDENCE_STATES) result[state].push(...(bag?.[state] ?? [])); for (const state of EVIDENCE_STATES) result[state] = uniqueStrings(result[state]); return result; }
function evidenceForState(value, state, fallback) {
  const target = EVIDENCE_STATES.includes(state) ? state : value === 'observed' ? 'observed' : 'unknown';
  if (Array.isArray(value)) {
    const result = emptyEvidence();
    result[target].push(...uniqueStrings(value));
    if (hasEvidence(result)) return result;
  }
  const bag = normalizeEvidence(value);
  if (hasEvidence(bag)) return bag;
  const result = emptyEvidence();
  result[target].push(fallback);
  return result;
}
function evidenceState(evidence) { return evidence.observed.length ? 'observed' : evidence.inferred.length ? 'inferred' : 'unknown'; }
function isEvidence(value) { return isRecord(value) && EVIDENCE_STATES.every((state) => Array.isArray(value[state]) && value[state].every((entry) => typeof entry === 'string')); }
function finiteCount(raw) { for (const key of ['invocationCount', 'count', 'calls', 'requestCount', 'usageCount', 'frequency']) if (Number.isFinite(raw?.[key]) && raw[key] >= 0) return raw[key]; return 0; }
function isDirtPath(path) { return /(^|[/\\])(legacy|deprecated|unused|archive|old|todo|backup)([/\\]|$)/i.test(path) || /(?:legacy|deprecated|unused|todo|old[-_.])/i.test(path); }

function derivePersonality(files, capabilities, connections) {
  const paths = files.map((file) => file.path.toLowerCase());
  const hasEntrypoint = capabilities.entrypoint.state !== 'unknown'
    && (files.some((file) => ['interface', 'service'].includes(file.role))
      || paths.some((path) => /(^|[/\\])(api|route|routes|server|web|public)([/\\]|$)/i.test(path))
      || connections.some((connection) => connection.direction === 'inbound'));
  const hasCliSignal = paths.some((path) => /(^|[/\\])(bin|cli|command|commands)([/\\]|$)/i.test(path) || /(^|[/\\])cli(?:\.|[-_])/i.test(path));
  const hasWorkerSignal = paths.some((path) => /(^|[/\\])(worker|workers|job|jobs|cron|daemon|consumer)([/\\]|$)/i.test(path));
  if (hasCliSignal || (!hasEntrypoint && capabilities.distribution.state !== 'unknown')) return 'port_town';
  if (hasWorkerSignal || (!hasEntrypoint && capabilities.observability.state !== 'unknown' && capabilities.recovery.state !== 'unknown')) return 'watch_post';
  if (hasEntrypoint) return 'post_town';
  if (capabilities.build.state !== 'unknown' || capabilities.test.state !== 'unknown') return 'workshop_town';
  return 'research_village';
}

function isPersonalityIrrelevant(kind, personality) { return ['gate', 'inn'].includes(kind) && personality !== 'post_town'; }

const CAPABILITY_NAMES = Object.freeze(['entrypoint', 'persistence', 'configuration', 'build', 'test', 'observability', 'recovery', 'distribution', 'externalConnections']);
