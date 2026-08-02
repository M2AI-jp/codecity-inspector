// Pure SemanticModel -> TownModel domain boundary.  This module deliberately
// has no imports: a town is facts and decisions, never I/O, geometry, assets,
// or randomness.

const TOWN_SCHEMA_VERSION = 1;
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);
export const CONNECTION_KINDS = Object.freeze([
  'http', 'webhook', 'external-api', 'llm', 'storage', 'unknown',
]);
export const NPC_ROLE_VOCABULARY = Object.freeze([...CONNECTION_KINDS, 'townsperson']);
export const REPOSITORY_INSPECTION_BINDING = Object.freeze({
  id: 'repository_inspected',
  event: 'repository_inspected',
  transition: 'repository_inspected',
  facilityKind: 'town_hall',
  effect: 'town_hall_lantern_lit',
});
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
const UNKNOWN_INVESTIGATION_COPY = Object.freeze({
  gate: Object.freeze({ subject: '城門の手がかり', statement: '城門から人が入れるかは未確認です' }),
  warehouse: Object.freeze({ subject: '倉庫の台帳の手がかり', statement: '倉庫に記録が残るかは未確認です' }),
  well: Object.freeze({ subject: '井戸の水の手がかり', statement: '井戸から水が使えるかは未確認です' }),
  dojo: Object.freeze({ subject: '道場の検査の手がかり', statement: '道場に検査済みの印があるかは未確認です' }),
  watchtower: Object.freeze({ subject: '見張り台の記録の手がかり', statement: '見張り台に夜の記録があるかは未確認です' }),
  shop: Object.freeze({ subject: '修理小屋の道具の手がかり', statement: '修理小屋に戻す道具があるかは未確認です' }),
  ruin: Object.freeze({ subject: '廃屋の手がかり', statement: '廃屋に由来のわかる物があるかは未確認です' }),
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

// The bounded v1 journey has exactly one permitted transition. It is derived
// from the inspection-completed evidence address; no customer claim or
// execution-result event can activate another binding.
const REWARD_BINDINGS = Object.freeze([REPOSITORY_INSPECTION_BINDING]);
const INSPECTION_COMPLETION_EVIDENCE_ID = 'repository.inspection.completed';
const INSPECTION_RUNTIME_UNKNOWN_EVIDENCE_ID = 'repository.inspection.runtime.unknown';

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
  const evidence = normalizeTopLevelEvidence(semanticModel.evidence);
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
  const investigations = makeInvestigations(capabilities, facilities, dirt, evidence);
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
    evidence,
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
    const rawKind = stringOrNull(raw.kind);
    const kind = canonicalConnectionKind(rawKind);
    if (rawKind !== null && kind === 'unknown' && rawKind !== 'unknown') {
      evidence.unknown.push(`connection.${id}.kind.unknown`);
    }
    const count = finiteCount(raw);
    const item = {
      id,
      direction: stringOrNull(raw.direction) ?? 'internal',
      kind,
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

function makeInvestigations(capabilities, facilities, ruin, inspectionEvidence) {
  const candidates = [];
  const usedFacilities = new Set();
  const facilityByCapability = {
    entrypoint: 'gate',
    persistence: 'warehouse',
    configuration: 'well',
    test: 'dojo',
    observability: 'watchtower',
    recovery: 'shop',
  };
  const completionEvidence = {
    observed: inspectionEvidence.observed.filter((key) => key === INSPECTION_COMPLETION_EVIDENCE_ID),
    inferred: [],
    unknown: [],
  };
  const unknownEvidence = inspectionEvidence.unknown.length > 0
    ? inspectionEvidence.unknown
    : [INSPECTION_RUNTIME_UNKNOWN_EVIDENCE_ID];
  const evidenceForQuestion = (base) => {
    const result = mergeEvidence(completionEvidence, base);
    result.unknown = uniqueStrings([...result.unknown, ...unknownEvidence]);
    return result;
  };

  // Prefer real capability signals, but never reuse an observed capability as
  // an unanswered question.  Inferred and unknown capability states remain
  // visible on the candidate and retain their own evidence addresses.
  for (const capability of INVESTIGATION_PRIORITY) {
    if (candidates.length >= 3) break;
    const fact = capabilities[capability];
    const facilityKind = facilityByCapability[capability];
    const facility = facilities.find((entry) => entry.kind === facilityKind);
    if (fact.state === 'observed' || facility?.presence === 'not_applicable' || usedFacilities.has(facilityKind)) continue;
    candidates.push({
      id: `investigation.${capability}`,
      capability,
      facilityKind,
      role: FACILITY_ROLES[facilityKind],
      variant: facilityKind === 'shop' ? 'repair' : null,
      subject: INVESTIGATION_COPY[capability].subject,
      statement: INVESTIGATION_COPY[capability].statement,
      state: fact.state,
      evidence: evidenceForQuestion(fact.evidence),
    });
    usedFacilities.add(facilityKind);
  }

  // A small or highly observed repository can leave fewer than three genuine
  // capability candidates. Fill the fixed journey with distinct, explicitly
  // unknown questions grounded in the observed inspection completion and the
  // inspector's runtime-unknown evidence; this does not invent a capability.
  const fallbackKinds = ['gate', 'warehouse', 'well', 'dojo', 'watchtower', 'shop'];
  if (ruin?.presence === 'present') fallbackKinds.push('ruin');
  for (const facilityKind of fallbackKinds) {
    if (candidates.length >= 3) break;
    if (usedFacilities.has(facilityKind)) continue;
    const facility = facilities.find((entry) => entry.kind === facilityKind);
    if (facility?.presence === 'not_applicable') continue;
    const copy = UNKNOWN_INVESTIGATION_COPY[facilityKind];
    if (!copy) continue;
    candidates.push({
      id: `investigation.unknown.${facilityKind}`,
      capability: null,
      facilityKind,
      role: FACILITY_ROLES[facilityKind],
      variant: facilityKind === 'shop' ? 'repair' : null,
      subject: copy.subject,
      statement: copy.statement,
      state: 'unknown',
      evidence: evidenceForQuestion({ observed: [], inferred: [], unknown: [`investigation.${facilityKind}.unknown`] }),
    });
    usedFacilities.add(facilityKind);
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
  const evidence = normalizeTopLevelEvidence(semanticModel.evidence);
  const transitions = evidence.observed.includes(INSPECTION_COMPLETION_EVIDENCE_ID)
    ? [{
      id: 'transition.repository_inspected',
      event: REPOSITORY_INSPECTION_BINDING.event,
      bindingId: REPOSITORY_INSPECTION_BINDING.id,
      facilityKind: REPOSITORY_INSPECTION_BINDING.facilityKind,
      effect: REPOSITORY_INSPECTION_BINDING.effect,
      state: 'observed',
      evidence: {
        observed: [INSPECTION_COMPLETION_EVIDENCE_ID],
        inferred: [],
        unknown: [],
      },
    }]
    : [];
  return { bindings: REWARD_BINDINGS.map((binding) => ({ ...binding })), transitions };
}

export function validateTownModel(model) {
  const issues = [];
  if (!isRecord(model) || model.schemaVersion !== TOWN_SCHEMA_VERSION) issues.push(issue('SCHEMA_VERSION', 'schemaVersion', 'TownModel v1 required'));
  if (typeof model?.inspectionDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(model.inspectionDigest)) issues.push(issue('INSPECTION_DIGEST', 'inspectionDigest', 'lowercase SHA-256 required'));
  if (!isRecord(model?.repository) || typeof model.repository.name !== 'string' || !model.repository.name || typeof model.repository.identity !== 'string' || !model.repository.identity) issues.push(issue('REPOSITORY', 'repository', 'name and identity required'));
  if (!isStrictEvidence(model?.evidence)) issues.push(issue('EVIDENCE', 'evidence', 'top-level strict tri-state evidence bag required'));
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
  for (const [index, representative] of (Array.isArray(model?.guild?.representativeConnections) ? model.guild.representativeConnections : []).entries()) {
    const kind = representative?.kind;
    if (!CONNECTION_KINDS.includes(kind)) issues.push(issue('REPRESENTATIVE_KIND', `guild.representativeConnections[${index}].kind`, 'representative kind must use the finite connection vocabulary'));
  }
  if (JSON.stringify(model?.investigations?.priority) !== JSON.stringify(INVESTIGATION_PRIORITY)) issues.push(issue('INVESTIGATION_PRIORITY', 'investigations.priority', 'priority order is fixed'));
  if (!Array.isArray(model?.investigations?.candidates) || model.investigations.candidates.length !== 3) {
    issues.push(issue('INVESTIGATION_CANDIDATES', 'investigations.candidates', 'exactly three evidence-grounded candidates required'));
  } else {
    const expectedKeys = ['capability', 'evidence', 'facilityKind', 'id', 'role', 'state', 'statement', 'subject', 'variant'];
    const ids = new Set();
    const facilitiesSeen = new Set();
    const questionsSeen = new Set();
    for (const [index, candidate] of model.investigations.candidates.entries()) {
      const path = `investigations.candidates[${index}]`;
      if (!isRecord(candidate) || JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(expectedKeys)) {
        issues.push(issue('INVESTIGATION_CANDIDATE', path, 'candidate fields must be exact'));
        continue;
      }
      if (![candidate.id, candidate.facilityKind, candidate.role, candidate.subject, candidate.statement].every((value) => typeof value === 'string' && value.length > 0)) issues.push(issue('INVESTIGATION_CANDIDATE', path, 'candidate identity and domain copy are required'));
      if (!FACILITY_KINDS.includes(candidate.facilityKind)) issues.push(issue('INVESTIGATION_CANDIDATE', path, 'candidate facility must use the finite facility vocabulary'));
      if (!EVIDENCE_STATES.includes(candidate.state) || !isEvidence(candidate.evidence)) issues.push(issue('INVESTIGATION_CANDIDATE', path, 'candidate state and tri-state evidence are required'));
      if (ids.has(candidate.id)) issues.push(issue('INVESTIGATION_CANDIDATE', path, 'candidate IDs must be distinct'));
      if (facilitiesSeen.has(candidate.facilityKind)) issues.push(issue('INVESTIGATION_CANDIDATE', path, 'investigation sites must use distinct facility kinds'));
      if (questionsSeen.has(`${candidate.subject}\u0000${candidate.statement}`)) issues.push(issue('INVESTIGATION_CANDIDATE', path, 'investigation questions must be distinct'));
      ids.add(candidate.id);
      facilitiesSeen.add(candidate.facilityKind);
      questionsSeen.add(`${candidate.subject}\u0000${candidate.statement}`);
      if (isEvidence(candidate.evidence)) {
        if (!candidate.evidence.observed.includes(INSPECTION_COMPLETION_EVIDENCE_ID)) issues.push(issue('INVESTIGATION_EVIDENCE', path, 'each question must retain observed inspection completion evidence'));
        if (candidate.evidence.unknown.length === 0) issues.push(issue('INVESTIGATION_EVIDENCE', path, 'each question must retain unknown evidence'));
      }
    }
  }
  if (!Number.isInteger(model?.habitability?.level) || model.habitability.level < 0 || model.habitability.level > 5) issues.push(issue('LEVEL', 'habitability.level', 'Lv must be 0..5'));
  if (!Array.isArray(model?.rewards?.bindings) || model.rewards.bindings.length !== REWARD_BINDINGS.length || model.rewards.bindings.some((binding, index) => JSON.stringify(binding) !== JSON.stringify(REWARD_BINDINGS[index]))) {
    issues.push(issue('REWARD_BINDINGS', 'rewards.bindings', 'exactly one canonical repository_inspected binding required'));
  }
  for (const transition of Array.isArray(model?.rewards?.transitions) ? model.rewards.transitions : []) {
    if (transition?.state !== 'observed'
      || transition?.event !== REPOSITORY_INSPECTION_BINDING.event
      || transition?.bindingId !== REPOSITORY_INSPECTION_BINDING.id
      || transition?.facilityKind !== REPOSITORY_INSPECTION_BINDING.facilityKind
      || transition?.effect !== REPOSITORY_INSPECTION_BINDING.effect
      || !isEvidence(transition?.evidence)
      || JSON.stringify(transition.evidence.observed) !== JSON.stringify([INSPECTION_COMPLETION_EVIDENCE_ID])) {
      issues.push(issue('REWARD_TRANSITION', 'rewards.transitions', 'only the observed repository_inspected transition may activate the town-hall lantern'));
    }
  }
  const completionObserved = isStrictEvidence(model?.evidence) && model.evidence.observed.includes(INSPECTION_COMPLETION_EVIDENCE_ID);
  if (!Array.isArray(model?.rewards?.transitions) || model.rewards.transitions.length !== (completionObserved ? 1 : 0)) {
    issues.push(issue('REWARD_TRANSITIONS', 'rewards.transitions', 'transition count must match observed inspection completion'));
  }
  return { ok: issues.length === 0, issues };
}
function issue(code, path, message) { return { code, path, message }; }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function stringOrNull(value) { return typeof value === 'string' && value.length ? value : null; }
function validRole(value) { return ['service', 'interface', 'data', 'configuration', 'test', 'tooling', 'module'].includes(value) ? value : 'module'; }
function canonicalConnectionKind(value) {
  return CONNECTION_KINDS.includes(value) ? value : 'unknown';
}
function uniqueStrings(values) { return [...new Set((values ?? []).filter((value) => typeof value === 'string' && value.length))].sort(); }
function compareId(a, b) { return a.id.localeCompare(b.id); }
function emptyEvidence() { return { observed: [], inferred: [], unknown: [] }; }
function hasEvidence(evidence) { return EVIDENCE_STATES.some((state) => evidence[state].length > 0); }
function normalizeEvidence(value) { const result = emptyEvidence(); if (Array.isArray(value)) result.unknown.push(...uniqueStrings(value)); else if (isRecord(value)) for (const state of EVIDENCE_STATES) result[state].push(...uniqueStrings(value[state])); for (const state of EVIDENCE_STATES) result[state] = uniqueStrings(result[state]); return result; }
function normalizeTopLevelEvidence(value) {
  const result = normalizeEvidence(value);
  if (!result.observed.includes(INSPECTION_COMPLETION_EVIDENCE_ID)) {
    result.unknown = uniqueStrings([...result.unknown, INSPECTION_RUNTIME_UNKNOWN_EVIDENCE_ID]);
  }
  return result;
}
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
function isStrictEvidence(value) {
  if (!isEvidence(value)) return false;
  const keys = Object.keys(value).sort();
  return JSON.stringify(keys) === JSON.stringify([...EVIDENCE_STATES].sort());
}
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
