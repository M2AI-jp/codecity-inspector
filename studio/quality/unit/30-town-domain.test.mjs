import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTownModel, validateTownModel } from '../../../ship/30-town-domain/index.mjs';

const FACILITY_KINDS = ['inn', 'pub', 'guild', 'town_hall', 'dock', 'warehouse', 'well', 'workshop', 'dojo', 'watchtower', 'house', 'shop', 'ruin', 'gate'];
const GUILD_TABS = ['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい'];
const INVESTIGATION_PRIORITY = ['entrypoint', 'persistence', 'configuration', 'test', 'observability', 'recovery'];

function semantic(overrides = {}) {
  return {
    schemaVersion: 1,
    inspectionDigest: 'a'.repeat(64),
    repository: { name: 'fixture', identity: 'fixture' },
    files: [
      { fileId: 'entry', path: 'src/server.mjs', role: 'interface', evidence: { observed: ['scan.entry'], inferred: [], unknown: [] } },
      { fileId: 'db', path: 'src/data/repository.mjs', role: 'data', evidence: { observed: [], inferred: ['path.data'], unknown: [] } },
      { fileId: 'legacy', path: 'legacy/todo.js', role: 'module', evidence: { observed: [], inferred: ['path.legacy'], unknown: [] } },
    ],
    connections: [{ id: 'api-z', direction: 'outbound', kind: 'http', target: 'payments', sourceFileIds: ['entry'], calls: 7, evidence: { observed: ['graph.edge'], inferred: [], unknown: [] } }],
    capabilities: {
      entrypoint: { state: 'observed', evidence: ['cap.entry'] },
      persistence: { state: 'inferred', evidence: ['cap.db'] },
      configuration: { state: 'unknown', evidence: ['cap.config.unknown'] },
      build: { state: 'unknown', evidence: [] },
      test: { state: 'unknown', evidence: [] },
      observability: { state: 'unknown', evidence: [] },
      recovery: { state: 'unknown', evidence: [] },
      distribution: { state: 'unknown', evidence: [] },
      externalConnections: { state: 'inferred', evidence: ['cap.external'] },
    },
    evidence: {
      observed: ['repository.inspection.completed'],
      inferred: [],
      unknown: ['repository.inspection.runtime.unknown'],
    },
    ...overrides,
  };
}

test('buildTownModel emits canonical facilities, guild tabs, and ordered investigations', () => {
  const source = semantic();
  const before = JSON.stringify(source);
  const model = buildTownModel(source);
  assert.equal(model.schemaVersion, 1);
  assert.deepEqual(model.facilities.map((facility) => facility.kind), FACILITY_KINDS);
  assert.equal(model.facilities.length, 14);
  assert.equal(model.facilities.find((facility) => facility.kind === 'shop').variant, 'repair');
  assert.equal(model.facilities.find((facility) => facility.kind === 'shop').role, 'repair');
  assert.equal(model.facilities.find((facility) => facility.kind === 'ruin').condition, 'dirt');
  assert.equal(model.facilities.find((facility) => facility.kind === 'ruin').blocksProgress, false);
  assert.deepEqual(model.guild.tabs.map((tab) => tab.label), GUILD_TABS);
  assert.deepEqual(model.investigations.priority, INVESTIGATION_PRIORITY);
  assert.deepEqual(model.investigations.candidates.map((candidate) => candidate.capability), ['persistence', 'configuration', 'test']);
  assert.deepEqual(model.investigations.candidates.map(({ subject, statement }) => ({ subject, statement })), [
    { subject: '倉庫の台帳', statement: '倉庫に記録が残る' },
    { subject: '井戸の水', statement: '井戸から水が使える' },
    { subject: '道場の検査', statement: '道場に検査済みの印がある' },
  ]);
  assert.equal(model.guild.representativeConnections.length, 1);
  assert.equal(model.habitability.dirt.includes('ruin'), true);
  assert.equal(JSON.stringify(source), before);
  assert.equal(validateTownModel(model).ok, true);
});

// T2 obligation: prevent reward fabrication from customer-controlled event
// fields and keep the one observed inspection binding explicit. Passing does
// not prove scene composition, browser rendering, or the KGI journey.
test('only observed inspection completion activates the single permitted binding', () => {
  const model = buildTownModel({
    ...semantic(),
    transitions: [
      { id: 'customer-claim', event: 'customer-controlled-arbitrary', state: 'observed', evidence: { observed: ['run.anything'], inferred: [], unknown: [] } },
    ],
  });
  assert.deepEqual(model.rewards.bindings, [{
    id: 'repository_inspected',
    event: 'repository_inspected',
    transition: 'repository_inspected',
    facilityKind: 'town_hall',
    effect: 'town_hall_lantern_lit',
  }]);
  assert.deepEqual(model.rewards.transitions.map((transition) => transition.event), ['repository_inspected']);
  assert.equal(model.rewards.transitions[0].state, 'observed');
  assert.equal(model.rewards.transitions[0].evidence.observed[0], 'repository.inspection.completed');
  const corrupted = structuredClone(model);
  corrupted.rewards.transitions[0].evidence = { observed: [], inferred: [], unknown: ['not-run'] };
  assert.equal(validateTownModel(corrupted).ok, false);
});

test('unknown evidence is not converted into missing and an invalid model is rejected', () => {
  const model = buildTownModel(semantic({ files: [], connections: [], capabilities: Object.fromEntries(INVESTIGATION_PRIORITY.concat(['build', 'distribution', 'externalConnections']).map((name) => [name, { state: 'unknown', evidence: [] }])) }));
  assert.equal(model.facilities.find((facility) => facility.kind === 'warehouse').presence, 'unknown');
  assert.equal(model.facilities.find((facility) => facility.kind === 'ruin').presence, 'not_applicable');
  const invalid = { ...model, facilities: model.facilities.filter((facility) => facility.kind !== 'shop') };
  assert.equal(validateTownModel(invalid).ok, false);
});

test('top-level evidence rejects malformed tri-state bags', () => {
  const malformed = buildTownModel(semantic());
  malformed.evidence = {
    observed: ['repository.inspection.completed'],
    inferred: [],
    unknown: [],
    extra: ['customer-controlled-arbitrary'],
  };
  const result = validateTownModel(malformed);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(({ code, path }) => code === 'EVIDENCE' && path === 'evidence'));
});

test('library personality keeps service-only facilities out of expectations', () => {
  const model = buildTownModel({
    ...semantic(),
    files: [{ fileId: 'index', path: 'src/index.mjs', role: 'module', evidence: { observed: [], inferred: ['path.index'], unknown: [] } }],
    connections: [],
    capabilities: {
      build: { state: 'inferred', evidence: ['build.script'] },
      test: { state: 'inferred', evidence: ['test.tree'] },
    },
  });
  assert.equal(model.facts.find((fact) => fact.id === 'repository.personality').subject, 'workshop_town');
  assert.deepEqual(model.facilities.filter((facility) => ['gate', 'inn'].includes(facility.kind)).map((facility) => facility.presence), ['not_applicable', 'not_applicable']);
  assert.equal(model.investigations.candidates.some((candidate) => candidate.capability === 'entrypoint'), false);
});

test('an inferred entrypoint with an inbound connection is a post town', () => {
  const model = buildTownModel({
    ...semantic(),
    files: [{ fileId: 'handler', path: 'src/handler.mjs', role: 'module', evidence: { observed: [], inferred: ['path.handler'], unknown: [] } }],
    connections: [{ id: 'http-in', direction: 'inbound', kind: 'http', target: '/api', evidence: { observed: [], inferred: ['graph.inbound'], unknown: [] } }],
    capabilities: { entrypoint: { state: 'inferred', evidence: ['graph.entrypoint'] } },
  });
  assert.equal(model.facts.find((fact) => fact.id === 'repository.personality').subject, 'post_town');
  assert.equal(model.facilities.find((facility) => facility.kind === 'gate').presence, 'present');
  assert.equal(model.facilities.find((facility) => facility.kind === 'inn').presence, 'present');
});
