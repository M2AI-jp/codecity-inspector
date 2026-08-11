// Pure SemanticModel -> TownModel domain boundary.  This module deliberately
// has no imports: a town is facts and decisions, never I/O, geometry, assets,
// or randomness.

const TOWN_SCHEMA_VERSION = 1;
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);
const CONNECTION_KINDS = Object.freeze([
  'http', 'webhook', 'external-api', 'llm', 'storage', 'unknown',
]);
const CONNECTION_DIRECTIONS = Object.freeze(['internal', 'inbound', 'outbound', 'unknown']);
const DIRT_PATH_TOKENS = Object.freeze(new Set([
  'legacy', 'deprecated', 'unused', 'archive', 'old', 'todo', 'backup',
]));
export const NPC_ROLE_VOCABULARY = Object.freeze([...CONNECTION_KINDS, 'townsperson']);
export const REPOSITORY_INSPECTION_BINDING = Object.freeze({
  id: 'repository_inspected',
  event: 'repository_inspected',
  transition: 'repository_inspected',
  facilityKind: 'town_hall',
  effect: 'town_hall_lantern_lit',
});
const FACILITY_KINDS = Object.freeze([
  'guild', 'town_hall', 'dock', 'warehouse', 'well',
  'workshop', 'dojo', 'watchtower', 'shop', 'ruin', 'gate',
]);
const INVESTIGATION_PRIORITY = Object.freeze([
  'entrypoint', 'persistence', 'configuration', 'test', 'observability', 'recovery',
]);
const INVESTIGATION_COPY = Object.freeze({
  entrypoint: Object.freeze({
    subject: '城門の到着札',
    action: '城門の到着札を確かめる',
    statements: Object.freeze({
      observed: '到着札に、このリポジトリが外から処理を受け取る入口を確認しました。',
      inferred: '到着札の手がかりから、このリポジトリには外から処理を受け取る入口があるようです。',
      unknown: '到着札だけでは、外から処理を受け取る入口があるかは確認できません。',
    }),
  }),
  persistence: Object.freeze({
    subject: '倉庫の台帳',
    action: '倉庫の台帳を開く',
    statements: Object.freeze({
      observed: '台帳に、記録を残す仕組みを確認しました。',
      inferred: '台帳の手がかりから、このリポジトリには記録を残す仕組みがあるようです。',
      unknown: '台帳だけでは、記録を残す仕組みがあるかは確認できません。',
    }),
  }),
  configuration: Object.freeze({
    subject: '井戸の水位札',
    action: '井戸の水位札を読む',
    statements: Object.freeze({
      observed: '水位札に、設定を記すものを確認しました。',
      inferred: '水位札の手がかりから、このリポジトリには設定を記すものがあるようです。',
      unknown: '水位札だけでは、設定を記すものがあるかは確認できません。',
    }),
  }),
  test: Object.freeze({
    subject: '道場の検査印',
    action: '道場の検査印を見比べる',
    statements: Object.freeze({
      observed: '検査印に、確かめるための仕組みを確認しました。結果の成功までは示しません。',
      inferred: '検査印の手がかりから、このリポジトリには確かめるための仕組みがあるようです。成功したかはわかりません。',
      unknown: '検査印だけでは、確かめるための仕組みがあるかは確認できません。',
    }),
  }),
  observability: Object.freeze({
    subject: '見張り台の夜警簿',
    action: '見張り台の夜警簿を読む',
    statements: Object.freeze({
      observed: '夜警簿に、状態を記録する仕組みを確認しました。',
      inferred: '夜警簿の手がかりから、このリポジトリには状態を記録する仕組みがあるようです。',
      unknown: '夜警簿だけでは、状態を記録する仕組みがあるかは確認できません。',
    }),
  }),
  recovery: Object.freeze({
    subject: '修理小屋の復旧道具',
    action: '修理小屋の復旧道具を調べる',
    statements: Object.freeze({
      observed: '道具箱に、不調から戻すための仕組みを確認しました。',
      inferred: '道具箱の手がかりから、このリポジトリには不調から戻すための仕組みがあるようです。',
      unknown: '道具箱だけでは、不調から戻すための仕組みがあるかは確認できません。',
    }),
  }),
});
const LABELS = Object.freeze({
  guild: '接続者ギルド', town_hall: '役場', dock: '船着場',
  warehouse: '倉庫', well: '井戸', workshop: '工房', dojo: '道場', watchtower: '見張り台',
  shop: '商店', ruin: '廃屋', gate: '門',
});
const FACILITY_CAPABILITIES = Object.freeze({
  gate: ['entrypoint'], guild: ['externalConnections'],
  town_hall: ['distribution'], dock: ['distribution'], warehouse: ['persistence'], well: ['configuration'],
  workshop: ['build'], dojo: ['test'], watchtower: ['observability'], shop: ['recovery'],
  ruin: [],
});
const CAPABILITY_FACILITY = Object.freeze({
  entrypoint: 'gate',
  persistence: 'warehouse',
  configuration: 'well',
  build: 'workshop',
  test: 'dojo',
  observability: 'watchtower',
  recovery: 'shop',
  distribution: 'dock',
  externalConnections: 'guild',
});
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
  const connections = normalizeConnections(semanticModel.connections);
  const groups = buildSemanticGroups(files, connections);
  const groupedConnections = connections.map((connection) => ({
    ...connection,
    groupIds: groups
      .filter((group) => connection.sourceFileIds.some((fileId) => group.fileIds.includes(fileId)))
      .map((group) => group.id),
  }));
  const capabilities = normalizeCapabilities(semanticModel.capabilities);
  const evidence = normalizeTopLevelEvidence(semanticModel.evidence);
  const facts = capabilityFacts(capabilities);
  const initialFacilityKinds = selectFacilityKinds(files, capabilities, groupedConnections, groups);
  let facilities = initialFacilityKinds.map((kind) => makeFacility(kind, files, capabilities, groupedConnections));
  const dirt = facilities.find((facility) => facility.kind === 'ruin');
  if (dirt?.presence === 'present') {
    facts.push({ id: 'dirt.legacy', kind: 'dirt', subject: 'ruin', state: 'inferred', evidence: dirt.evidence });
  }
  facts.sort((a, b) => a.id.localeCompare(b.id));
  const investigations = makeInvestigations(capabilities, facilities, groups);
  const facilityKinds = [...new Set([
    ...initialFacilityKinds,
    ...investigations.candidates.map((candidate) => candidate.facilityKind),
  ])].filter((kind) => FACILITY_KINDS.includes(kind));
  facilities = facilityKinds
    .map((kind) => makeFacility(kind, files, capabilities, groupedConnections));
  const rewards = makeRewards(semanticModel);
  return {
    schemaVersion: TOWN_SCHEMA_VERSION,
    repository: normalizeRepository(semanticModel.repository),
    files,
    groups,
    facilities,
    facts,
    connections: groupedConnections,
    investigations,
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
    const rawDirection = stringOrNull(raw.direction);
    const direction = CONNECTION_DIRECTIONS.includes(rawDirection) ? rawDirection : 'unknown';
    if (rawDirection !== null && direction === 'unknown' && rawDirection !== 'unknown') {
      evidence.unknown.push(`connection.${id}.direction.unknown`);
    }
    const item = {
      id,
      direction,
      kind,
      target: stringOrNull(raw.target) ?? id,
      sourceFileIds: uniqueStrings(Array.isArray(raw.sourceFileIds) ? raw.sourceFileIds : []),
      evidence,
      state: connectionState(direction, kind),
    };
    const previous = byId.get(id);
    byId.set(id, previous ? mergeConnection(previous, item) : item);
  }
  return [...byId.values()].sort(compareId);
}

function buildSemanticGroups(files, connections) {
  const root = makeDirectoryNode('');
  for (const file of files) {
    const normalized = file.path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    const segments = normalized.split('/').filter(Boolean);
    const directorySegments = segments.slice(0, -1);
    let node = root;
    for (const segment of directorySegments) {
      const childPath = node.path ? `${node.path}/${segment}` : segment;
      if (!node.children.has(segment)) node.children.set(segment, makeDirectoryNode(childPath));
      node = node.children.get(segment);
    }
    node.directFiles.push(file);
  }

  populateDirectoryFiles(root);
  const partitions = [];
  if (root.directFiles.length > 0) partitions.push({ path: '.', files: root.directFiles });
  for (const child of [...root.children.values()].sort(comparePath)) {
    partitions.push(...partitionDirectory(child, true));
  }

  return partitions
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((group, index) => {
      const fileIds = uniqueStrings(group.files.map((file) => file.fileId));
      const roleMix = {};
      for (const file of group.files) {
        roleMix[file.role] = (roleMix[file.role] ?? 0) + 1;
      }
      const groupConnections = connections.filter((connection) => connection.sourceFileIds.some((fileId) => fileIds.includes(fileId)));
      const evidence = mergeEvidence(
        ...group.files.map((file) => file.evidence),
        ...groupConnections.map((connection) => connection.evidence),
        { observed: [], inferred: [`group.${group.path}.partition`], unknown: [] },
      );
      if (!hasEvidence(evidence)) evidence.unknown.push(`group.${group.path}.unknown`);
      return {
        id: `group.${encodeURIComponent(group.path)}`,
        path: group.path,
        fileIds,
        roles: Object.keys(roleMix).sort(),
        roleMix,
        connectionIds: groupConnections.map((connection) => connection.id).sort(),
        evidence,
        // File existence and hashes are observed provenance for a group, not
        // an observed interpretation of its responsibility boundary.
        state: 'inferred',
        ordinal: index,
      };
    });
}

function makeDirectoryNode(path) {
  return { path, directFiles: [], children: new Map(), files: [] };
}

function populateDirectoryFiles(node) {
  const files = [...node.directFiles];
  for (const child of [...node.children.values()].sort(comparePath)) {
    files.push(...populateDirectoryFiles(child));
  }
  node.files = files;
  return files;
}

function partitionDirectory(node, inspectBranches) {
  const children = [...node.children.values()].filter((child) => child.files.length > 0).sort(comparePath);
  if (!inspectBranches || children.length === 0) return [{ path: node.path, files: node.files }];
  if (children.length === 1 && node.directFiles.length === 0) return partitionDirectory(children[0], true);
  if (children.length === 1) return [{ path: node.path, files: node.files }];

  // A branching directory at the repository boundary is a container, not a
  // neighbourhood. Direct files remain its honest root group, while each real
  // branch becomes a coherent group. A nested branch with its own direct files
  // is the first substantive boundary and keeps its subtree together.
  const groups = [];
  if (node.directFiles.length > 0) groups.push({ path: node.path, files: node.directFiles });
  for (const child of children) {
    groups.push(...partitionDirectory(child, child.directFiles.length === 0));
  }
  return groups;
}

function comparePath(left, right) {
  return left.path.localeCompare(right.path);
}

function selectFacilityKinds(files, capabilities, connections, groups) {
  const kinds = new Set(['gate', 'town_hall']);
  const add = (kind) => { if (FACILITY_KINDS.includes(kind)) kinds.add(kind); };
  for (const [capability, kind] of Object.entries(CAPABILITY_FACILITY)) {
    if (capability === 'externalConnections') {
      if (connections.some(isMeaningfulExternalConnection)) add(kind);
    } else if (capabilities[capability]?.state !== 'unknown') {
      add(kind);
    }
  }
  const roles = new Set(files.map((file) => file.role));
  if (connections.some((connection) => connection.kind === 'storage')) add('warehouse');
  if (roles.has('tooling')) add('workshop');
  if (groups.some((group) => group.path !== '.' && group.roles.includes('test'))) add('dojo');
  if (files.some((file) => isDirtPath(file.path))) add('ruin');
  return [...kinds];
}

function isMeaningfulExternalConnection(connection) {
  return (connection.direction === 'inbound' || connection.direction === 'outbound')
    && connection.kind !== 'unknown';
}

function mergeConnection(a, b) {
  const evidence = mergeEvidence(a.evidence, b.evidence);
  const direction = a.direction === b.direction ? a.direction : 'unknown';
  if (direction === 'unknown' && a.direction !== b.direction) {
    evidence.unknown = uniqueStrings([...evidence.unknown, `connection.${a.id}.direction.conflict`]);
  }
  const kind = a.kind === b.kind ? a.kind : 'unknown';
  if (kind === 'unknown' && a.kind !== b.kind) {
    evidence.unknown = uniqueStrings([...evidence.unknown, `connection.${a.id}.kind.conflict`]);
  }
  const target = a.target === b.target ? a.target : a.target ?? b.target;
  if (a.target !== b.target) {
    evidence.unknown = uniqueStrings([...evidence.unknown, `connection.${a.id}.target.conflict`]);
  }
  const state = a.target === b.target ? connectionState(direction, kind) : 'unknown';
  return {
    ...a,
    direction,
    kind,
    target,
    sourceFileIds: uniqueStrings([...a.sourceFileIds, ...b.sourceFileIds]),
    evidence,
    state,
  };
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

function makeFacility(kind, files, capabilities, connections) {
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
  if (kind === 'guild') {
    for (const connection of connections.filter(isMeaningfulExternalConnection)) {
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
  const explicitMissing = hasExplicitMissingEvidence(kind, evidence);
  const externalFacility = kind === 'guild';
  const capabilityKnown = (FACILITY_CAPABILITIES[kind] ?? []).some((capability) => capabilities[capability].state !== 'unknown')
    && (!externalFacility || connections.some(isMeaningfulExternalConnection));
  const connectionKnown = externalFacility
    && connections.some((connection) => isMeaningfulExternalConnection(connection) && connection.state !== 'unknown');
  const structuralKnown = roles.some((role) => files.some((file) => file.role === role));
  const dirtKnown = kind === 'ruin' && files.some((file) => isDirtPath(file.path));
  const applicableEvidence = capabilityKnown || connectionKnown || structuralKnown || dirtKnown || kind === 'town_hall';
  const presence = explicitMissing ? 'missing' : kind === 'ruin' && !dirtKnown ? 'not_applicable' : applicableEvidence ? 'present' : 'unknown';
  const condition = kind === 'ruin' && presence === 'present' ? 'dirt' : presence === 'present' && observedActiveCondition(kind, evidence) ? 'active' : presence === 'present' ? 'unconfirmed' : presence === 'missing' ? 'missing' : presence === 'not_applicable' ? 'not_applicable' : 'unconfirmed';
  return {
    kind,
    label: LABELS[kind],
    presence,
    condition,
    sourceFileIds: [...sourceFileIds].sort(),
    evidence,
  };
}

function roleSignals(kind) {
  return ({
    gate: ['interface'], well: ['configuration'], workshop: ['tooling'], dojo: ['test'], ruin: [],
  })[kind] ?? [];
}

function makeInvestigations(capabilities, facilities, groups) {
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
  // A discovery is selected from the repository fact itself. Known facts come
  // first; unknown facts fill only the remaining distinct places. No global
  // inspection-completion or runtime-unknown address is mixed into a fact.
  for (const desiredState of EVIDENCE_STATES) {
    for (const capability of INVESTIGATION_PRIORITY) {
      if (candidates.length >= 3) break;
      const fact = capabilities[capability];
      const facilityKind = facilityByCapability[capability];
      const facility = facilities.find((entry) => entry.kind === facilityKind);
      if (fact.state !== desiredState || facility?.presence === 'not_applicable' || usedFacilities.has(facilityKind)) continue;
      const copy = INVESTIGATION_COPY[capability];
      candidates.push({
        id: `investigation.${capability}`,
        capability,
        facilityKind,
        subject: copy.subject,
        action: copy.action,
        statement: copy.statements[fact.state],
        state: fact.state,
        evidence: mergeEvidence(fact.evidence),
      });
      usedFacilities.add(facilityKind);
    }
  }

  if (candidates.length !== 3) {
    throw new TownDomainError('INVESTIGATION_CANDIDATES_INCOMPLETE', 'Three distinct repository-fact investigations could not be formed');
  }
  // A static/data-only repository still has a concrete safe discovery: a
  // semantic group of images or records. Keep the persistence capability
  // unknown; this replaces only the otherwise generic all-unknown question
  // with an inferred group interpretation.
  if (candidates.every((candidate) => candidate.state === 'unknown')) {
    const dataGroup = groups.find((group) => group.roles.includes('data'));
    const persistenceIndex = candidates.findIndex((candidate) => candidate.capability === 'persistence');
    if (dataGroup && persistenceIndex >= 0) {
      const groupPath = dataGroup.path || dataGroup.id;
      candidates[persistenceIndex] = {
        id: 'investigation.data-group',
        capability: null,
        facilityKind: 'warehouse',
        subject: '倉庫の保管札',
        action: '倉庫の保管札を確かめる',
        statement: '画像や記録を収めたまとまりがあるようです。',
        state: 'inferred',
        evidence: {
          observed: [],
          inferred: uniqueStrings([
            ...(dataGroup.evidence?.inferred ?? []),
            `group.${groupPath}.role.data`,
            `investigation.data-group.${dataGroup.id}`,
          ]),
          unknown: uniqueStrings(dataGroup.evidence?.unknown ?? []),
        },
      };
    }
  }
  return { candidates };
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
  return { transitions };
}

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
function observedActiveCondition(kind, evidence) {
  const keys = new Set(evidence?.observed ?? []);
  return keys.has(`facility.${kind}.active`) || keys.has(`facility.${kind}.condition.active`);
}
function hasExplicitMissingEvidence(kind, evidence) {
  const suffixes = new Set(['missing', 'absent', 'not-found', 'not_found', 'notfound', 'unavailable', 'disabled']);
  const prefix = `facility.${kind}.`;
  return (evidence?.observed ?? []).some((key) => typeof key === 'string'
    && key.startsWith(prefix)
    && suffixes.has(key.slice(prefix.length)));
}
function connectionState(direction, kind) {
  if (direction === 'internal') return 'inferred';
  if ((direction === 'inbound' || direction === 'outbound') && kind !== 'unknown') return 'inferred';
  return 'unknown';
}
function isDirtPath(path) {
  const segments = typeof path === 'string'
    ? path.toLowerCase().split(/[\\/]+/u).filter(Boolean)
    : [];
  return segments.some((segment) => segment
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
    .some((token) => DIRT_PATH_TOKENS.has(token)));
}

const CAPABILITY_NAMES = Object.freeze(['entrypoint', 'persistence', 'configuration', 'build', 'test', 'observability', 'recovery', 'distribution', 'externalConnections']);
