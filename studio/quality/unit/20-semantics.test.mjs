import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  inferSemanticModel,
  normalizeSemanticModel,
} from '../../../ship/20-semantics/index.mjs';
import { buildTownModel, validateTownModel } from '../../../ship/30-town-domain/index.mjs';
import { inspectionReport } from '../fixtures/20-inspection-report.fixture.mjs';

test('exports only the two semantic boundary functions', async () => {
  const module = await import('../../../ship/20-semantics/index.mjs');
  assert.deepEqual(Object.keys(module).sort(), ['inferSemanticModel', 'normalizeSemanticModel']);
});

test('classifies the seven roles and uses module plus unknown for absence', () => {
  const model = inferSemanticModel(inspectionReport);
  const roles = new Map(model.files.map((file) => [file.fileId, file.role]));
  assert.equal(roles.get('file-service'), 'service');
  assert.equal(roles.get('file-api'), 'interface');
  assert.equal(roles.get('file-data'), 'data');
  assert.equal(roles.get('file-config'), 'configuration');
  assert.equal(roles.get('file-test'), 'test');
  assert.equal(roles.get('file-tool'), 'tooling');
  assert.equal(roles.get('file-plain'), 'module');
  assert.deepEqual(model.files.find((file) => file.fileId === 'file-plain').evidence.unknown,
    ['role.unknown.no-signal']);
});

test('copies only matching inspection observed keys and keeps inferred role evidence separate', () => {
  const model = inferSemanticModel(inspectionReport);
  const config = model.files.find((file) => file.fileId === 'file-config');
  assert.deepEqual(config.evidence.observed, ['inspection.config.present']);
  assert.ok(config.evidence.inferred.length > 0);
  assert.ok(!config.evidence.inferred.includes('inspection.config.present'));
  assert.equal(model.capabilities.configuration.state, 'observed');
  assert.deepEqual(model.capabilities.configuration.evidence, ['inspection.config.present']);
});

test('observed filenames never self-upgrade a capability claim', () => {
  const report = structuredClone(inspectionReport);
  report.evidence.observed = [
    { id: 'observed:file:tests/release-config.test.js', claim: 'file.exists', subject: 'file-test', path: 'tests/release-config.test.js', value: true },
  ];
  const model = inferSemanticModel(report);
  assert.equal(model.capabilities.configuration.state, 'inferred');
  assert.equal(model.capabilities.test.state, 'inferred');
  assert.equal(model.capabilities.distribution.state, 'inferred');
  assert.equal(model.capabilities.configuration.evidence.includes('observed:file:tests/release-config.test.js'), false);
});

test('emits graph connections with stable direction, kind, and evidence', () => {
  const model = inferSemanticModel(inspectionReport);
  assert.deepEqual(model.connections.map((connection) => connection.id), ['edge-http', 'edge-internal']);
  const outbound = model.connections.find((connection) => connection.id === 'edge-http');
  assert.equal(outbound.direction, 'outbound');
  assert.equal(outbound.kind, 'http');
  assert.equal(outbound.target, 'https://api.example.test');
  assert.deepEqual(outbound.sourceFileIds, ['file-api']);
  assert.deepEqual(outbound.evidence.observed, []);
  assert.deepEqual(outbound.evidence.inferred, ['connection.graph.edge.edge-http']);
});

test('absence remains unknown rather than inferred negative', () => {
  const report = {
    schemaVersion: 1,
    repository: { name: 'empty', identity: 'empty' },
    summary: { filesDiscovered: 0, filesInspected: 0, truncated: false },
    files: [],
    graph: { nodes: [], edges: [], entrypoints: [] },
    manifests: [],
    evidence: { observed: [], inferred: [], unknown: [] },
  };
  const model = inferSemanticModel(report);
  for (const capability of Object.values(model.capabilities)) {
    assert.equal(capability.state, 'unknown');
    assert.equal(capability.evidence.length, 1);
  }
  assert.deepEqual(model.connections, []);
});

test('annotations join only known files and accept inferred/unknown rationale, never observed', () => {
  const model = normalizeSemanticModel({
    inspection: inspectionReport,
    annotations: [
      { fileId: 'file-plain', role: 'service', state: 'inferred', reason: 'owner annotation' },
      { path: 'src/math.js', role: 'service', state: 'unknown', reason: 'second rationale' },
      { fileId: 'new-file', path: 'new-file.js', role: 'service', state: 'inferred', reason: 'must be ignored' },
      { fileId: 'file-api', role: 'service', state: 'observed', reason: 'must be ignored' },
    ],
  });
  const plain = model.files.find((file) => file.fileId === 'file-plain');
  assert.equal(plain.role, 'service');
  assert.deepEqual(plain.evidence.observed, []);
  assert.deepEqual(plain.evidence.inferred, ['owner annotation']);
  assert.deepEqual(plain.evidence.unknown, ['second rationale']);
  assert.equal(model.files.some((file) => file.fileId === 'new-file'), false);
  assert.equal(model.files.find((file) => file.fileId === 'file-api').role, 'interface');
});

test('normalization is deterministic, order independent, and non-mutating', () => {
  const before = JSON.stringify(inspectionReport);
  const reversed = {
    ...inspectionReport,
    files: [...inspectionReport.files].reverse(),
    graph: {
      ...inspectionReport.graph,
      nodes: [...inspectionReport.graph.nodes].reverse(),
      edges: [...inspectionReport.graph.edges].reverse(),
    },
  };
  const first = inferSemanticModel(inspectionReport);
  const second = inferSemanticModel(reversed);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(inspectionReport), before);
  assert.match(JSON.stringify(first), /"schemaVersion":1/);
  assert.match(first.inspectionDigest, /^[0-9a-f]{64}$/u);
});

test('shipping semantics does not import filesystem/process/network/DOM modules', async () => {
  const source = await readFile(new URL('../../../ship/20-semantics/index.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:fs|process|child_process|net|http|https|DOM|document|window)/iu);
});

// T2 obligation: prevent the customer from receiving fewer than three
// truthful questions or a fabricated execution result. It evidences the
// owner requirement that static inspection retain observed/inferred/unknown
// states and one permitted transition, and prevents repository certification
// harm. Passing does not prove world geometry, art, browser play, packaging,
// persistence, or the KGI journey.
test('T2 carries inspection completion and unknowns into exactly three distinct questions', () => {
  const report = structuredClone(inspectionReport);
  report.evidence.observed = [
    ...report.evidence.observed,
    { id: 'repository.inspection.completed', state: 'observed', claim: 'repository.inspection.completed', value: true },
  ];
  report.evidence.unknown = [
    ...report.evidence.unknown,
    { id: 'repository.inspection.runtime.unknown', state: 'unknown', claim: 'repository.runtime-behavior', reason: 'source-not-executed' },
  ];
  report.connections = [
    ...report.graph.edges,
    { id: 'customer-controlled-arbitrary', from: 'file-api', to: 'customer-controlled-arbitrary', kind: 'customer-controlled-arbitrary' },
  ];
  const semantics = inferSemanticModel(report);
  assert.ok(semantics.evidence.observed.includes('repository.inspection.completed'));
  assert.ok(semantics.evidence.unknown.includes('repository.inspection.runtime.unknown'));
  const town = buildTownModel(semantics);
  assert.equal(town.investigations.candidates.length, 3);
  assert.equal(new Set(town.investigations.candidates.map((candidate) => candidate.id)).size, 3);
  assert.equal(new Set(town.investigations.candidates.map((candidate) => candidate.facilityKind)).size, 3);
  for (const candidate of town.investigations.candidates) {
    assert.ok(candidate.evidence.observed.includes('repository.inspection.completed'));
    assert.ok(candidate.evidence.unknown.length > 0);
  }
  assert.deepEqual(town.rewards.bindings, [{
    id: 'repository_inspected',
    event: 'repository_inspected',
    transition: 'repository_inspected',
    facilityKind: 'town_hall',
    effect: 'town_hall_lantern_lit',
  }]);
  assert.equal(town.rewards.transitions.length, 1);
  assert.equal(town.rewards.transitions[0].evidence.observed[0], 'repository.inspection.completed');
  assert.equal(validateTownModel(town).ok, true);
});
