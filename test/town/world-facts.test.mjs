import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectRepository } from '../../src/inspector.mjs';
import { buildTown } from '../../src/town/index.mjs';
import { buildWorldFacts } from '../../src/town/world-facts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_REPO = path.join(__dirname, '..', '..', 'sample', 'tiny-town');
const inspection = await inspectRepository(SAMPLE_REPO);
const { model } = await buildTown(SAMPLE_REPO, inspection);
const facts = buildWorldFacts(inspection, model);

const MACHINE_KEY = /^[a-z0-9_.-]+$/;

function factsOf(type) {
  return facts.filter((fact) => fact.type === type);
}

test('tiny-town produces the expected structured source and facility fact counts', () => {
  assert.equal(factsOf('entrypoint').length, 1);
  assert.equal(factsOf('unresolved').length, 1);
  assert.equal(factsOf('cycle').length, 1);
  assert.equal(factsOf('test_association').length, 1);
  assert.equal(factsOf('unverified').length, 10);
  assert.equal(factsOf('unreached').length, 1);
  assert.equal(factsOf('runtime_unknown').length, 0);
  assert.equal(factsOf('truncation').length, 0);
  assert.equal(factsOf('facility_present').length, 4);
  assert.equal(factsOf('facility_absent').length, 10);
  assert.equal(facts.length, 29);
});

test('tiny-town facts preserve repository-specific params without copying prose evidence', () => {
  assert.deepEqual(factsOf('entrypoint')[0].params, {
    path: 'src/main.js', source: 'package.json:main'
  });
  assert.deepEqual(factsOf('unresolved')[0].params, {
    from: 'src/main.js', targetHint: 'src/missing-sign.js', kind: 'import', status: 'unresolved'
  });
  assert.deepEqual(factsOf('cycle')[0].params.members, ['src/cycle-a.js', 'src/cycle-b.js']);
  assert.deepEqual(factsOf('test_association')[0].params, {
    source: 'src/inn.js', test: 'test/inn.test.js', method: 'test-directly-imports-source'
  });
  assert.deepEqual(factsOf('unreached')[0].params, {
    path: 'test/inn.test.js', reachability: 'not-reached-from-known-entrypoints'
  });
  assert.equal(factsOf('unverified').some((fact) => fact.params.path === 'src/inn.js'), false);
  assert.equal(factsOf('unverified').every((fact) => fact.params.path.startsWith('src/')), true);
  assert.doesNotMatch(JSON.stringify(facts), /no observed|whether these tests|was scanned|not broken/i);
});

test('every fact has the exact shape, a unique stable id, machine evidence keys, and separated evidence classes', () => {
  assert.equal(new Set(facts.map((fact) => fact.id)).size, facts.length);
  for (const fact of facts) {
    assert.deepEqual(Object.keys(fact), ['id', 'type', 'params', 'evidence', 'sayings']);
    assert.match(fact.id, new RegExp(`^${fact.type}\\.[0-9a-f]{16}$`));
    assert.deepEqual(Object.keys(fact.evidence), ['observed', 'inferred', 'unknown']);
    assert.deepEqual(Object.keys(fact.sayings), ['primary', 'reflect']);
    assert.equal(typeof fact.sayings.primary, 'string');
    assert.equal(Array.isArray(fact.sayings.reflect), true);
    for (const key of [...fact.evidence.observed, ...fact.evidence.inferred, ...fact.evidence.unknown]) {
      assert.match(key, MACHINE_KEY);
    }
  }

  const unresolved = factsOf('unresolved')[0];
  assert.deepEqual(unresolved.evidence.inferred, []);
  assert.deepEqual(unresolved.evidence.unknown, []);
  assert.deepEqual(factsOf('cycle')[0].evidence.observed, []);
  assert.deepEqual(factsOf('cycle')[0].evidence.unknown, []);
  assert.deepEqual(factsOf('test_association')[0].evidence.observed, []);
  assert.deepEqual(factsOf('unverified')[0].evidence.observed, []);
  assert.deepEqual(factsOf('unverified')[0].evidence.inferred, []);
  assert.deepEqual(factsOf('unreached')[0].evidence.observed, []);
  assert.deepEqual(factsOf('unreached')[0].evidence.unknown, []);
});

test('all 14 facility facts are kind-sorted and retain evidence counts without prose', () => {
  const facilityFacts = facts.filter((fact) => fact.type.startsWith('facility_'));
  const kinds = facilityFacts.map((fact) => fact.params.kind);
  assert.deepEqual(kinds, [...kinds].sort());
  assert.deepEqual(kinds, [
    'dock', 'dojo', 'gate', 'guild', 'house', 'inn', 'pub',
    'ruin', 'shop', 'town_hall', 'warehouse', 'watchtower', 'well', 'workshop'
  ]);
  const dojo = facilityFacts.find((fact) => fact.params.kind === 'dojo');
  assert.equal(dojo.type, 'facility_present');
  assert.deepEqual(dojo.params.evidenceCounts, { observed: 2, inferred: 1, unknown: 1 });
  const inn = facilityFacts.find((fact) => fact.params.kind === 'inn');
  assert.equal(inn.type, 'facility_absent');
  assert.deepEqual(inn.params.evidenceCounts, { observed: 0, inferred: 0, unknown: 1 });
});

test('shuffling every authoritative input array produces byte-identical facts', () => {
  const shuffledInspection = structuredClone(inspection);
  shuffledInspection.graph.entrypoints.reverse();
  shuffledInspection.inspection.observed.unresolvedLinks.reverse();
  shuffledInspection.inspection.inferred.cycles.reverse();
  for (const cycle of shuffledInspection.inspection.inferred.cycles) cycle.members.reverse();
  shuffledInspection.inspection.inferred.testAssociations.reverse();
  shuffledInspection.inspection.unknownDependencies.reverse();
  shuffledInspection.city.buildings.reverse();
  const shuffledModel = structuredClone(model);
  shuffledModel.facilities.reverse();
  for (const facility of shuffledModel.facilities) {
    facility.evidence.observed.reverse();
    facility.evidence.inferred.reverse();
    facility.evidence.unknown.reverse();
  }
  assert.equal(
    JSON.stringify(buildWorldFacts(shuffledInspection, shuffledModel)),
    JSON.stringify(facts)
  );
});

test('runtime-unknown and truncation facts preserve status and evidence separation', () => {
  const synthetic = {
    summary: {
      truncated: true,
      omittedFiles: 3,
      edgesOmitted: 2,
      truncation: { traversal: false, discovery: true, analysis: false, files: true, edges: true }
    },
    inspection: {
      unknownDependencies: [
        { from: 'src/a.js', targetHint: null, kind: 'dynamic-import', status: 'runtime-unknown' },
        { from: 'src/b.js', targetHint: null, kind: 'import', status: 'unsupported' }
      ]
    }
  };
  const generated = buildWorldFacts(synthetic, null);
  const runtime = generated.find((fact) => fact.type === 'runtime_unknown');
  const truncation = generated.find((fact) => fact.type === 'truncation');
  assert.deepEqual(runtime.params, {
    from: 'src/a.js', targetHint: null, kind: 'dynamic-import', status: 'runtime-unknown'
  });
  assert.deepEqual(runtime.evidence, {
    observed: [], inferred: [], unknown: ['inspection.dependency.runtime_unknown']
  });
  assert.deepEqual(truncation.params, {
    omittedFiles: 3,
    edgesOmitted: 2,
    limits: { traversal: false, discovery: true, analysis: false, files: true, edges: true }
  });
  assert.deepEqual(truncation.evidence, {
    observed: ['inspection.truncation.observed'],
    inferred: [],
    unknown: ['inspection.truncation.omitted_scope_unknown']
  });
});

test('buildWorldFacts is deterministic, deeply frozen, non-mutating, and crash-free on malformed input', () => {
  assert.ok(Object.isFrozen(facts));
  assert.ok(Object.isFrozen(facts[0]));
  assert.ok(Object.isFrozen(facts[0].params));
  assert.ok(Object.isFrozen(facts[0].evidence.observed));
  assert.ok(Object.isFrozen(facts[0].sayings.reflect));
  assert.throws(() => facts.push({}), TypeError);

  for (const pair of [
    [null, null], [undefined, undefined], [{}, {}],
    [{ graph: { entrypoints: 'bad' }, city: { buildings: [null, 42] } }, { facilities: 'bad' }]
  ]) {
    let first;
    assert.doesNotThrow(() => { first = buildWorldFacts(pair[0], pair[1]); });
    assert.ok(Object.isFrozen(first));
    assert.equal(JSON.stringify(buildWorldFacts(pair[0], pair[1])), JSON.stringify(first));
  }
});

test('world facts implementation contains no clock, random, locale sort, or I/O dependency', async () => {
  const source = await readFile(new URL('../../src/town/world-facts.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localeCompare|Math\.random|Date\.now|new Date\s*\(/);
  assert.doesNotMatch(source, /node:(?:fs|http|https|net|child_process)/);
});
