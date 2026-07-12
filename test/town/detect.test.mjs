// test/town/detect.test.mjs
//
// Contract tests for src/town/detect.mjs: buildTownModel(inspection, signals)
// and isConnectionBuilding(building). Most tests run the real read-only
// observe pipeline once (inspectRepository -> collectSignals ->
// buildTownModel) against sample/tiny-town; a couple of tests hand-build a
// minimal inspection-shaped fixture to exercise behavior (an actual ruin)
// that the sample repo does not happen to produce on its own.
//
// SAFETY: the only functions that ever touch sample/tiny-town are
// inspectRepository and collectSignals, both read-only static scanners. This
// file never imports, requires, or otherwise runs anything under
// sample/tiny-town/src or sample/tiny-town/test.

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRepository } from '../../src/inspector.mjs';
import { collectSignals } from '../../src/town/signals.mjs';
import { buildTownModel, isConnectionBuilding } from '../../src/town/detect.mjs';
import { FACILITY_KINDS, GUILD_TABS, EVIDENCE_CLASSES } from '../../src/town/schema.mjs';

const SAMPLE_REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../sample/tiny-town');

// Run the real pipeline exactly once; every test below reads these frozen
// results instead of re-scanning, so there is one definition of "what the
// sample looked like" for every assertion to agree on.
const inspection = await inspectRepository(SAMPLE_REPO);
const signals = await collectSignals(SAMPLE_REPO);
const model = buildTownModel(inspection, signals);

function facility(kind) {
  const found = model.facilities.find((entry) => entry.kind === kind);
  assert.ok(found, `expected a "${kind}" facility in the model`);
  return found;
}

test('facilities are exactly one per FACILITY_KIND, in canonical order', () => {
  assert.deepEqual(model.facilities.map((entry) => entry.kind), FACILITY_KINDS);
  assert.equal(model.facilities.length, 14);
});

test('town_hall is always present, backed by both observed and unknown evidence', () => {
  const townHall = facility('town_hall');
  assert.equal(townHall.present, true);
  assert.equal(townHall.count, 1);
  assert.ok(townHall.evidence.observed.length > 0, 'town_hall must cite at least one observed fact');
  assert.ok(townHall.evidence.unknown.length > 0, 'town_hall must admit at least one unknown (git history was not read)');
  assert.match(townHall.evidence.observed.join(' '), /tiny-town/);
  assert.deepEqual(townHall.details, { repositoryName: 'tiny-town', contractorReportCount: 0 });
});

test('town_hall stays present even for missing or malformed inspection input (buildTownModel never throws)', () => {
  for (const bad of [null, undefined, {}, 'not-an-object', 42, []]) {
    const degraded = buildTownModel(bad);
    const townHall = degraded.facilities.find((entry) => entry.kind === 'town_hall');
    assert.equal(townHall.present, true, `town_hall must stay present for input ${JSON.stringify(bad)}`);
    assert.equal(townHall.details.repositoryName, null);
    assert.equal(degraded.facilities.length, 14, 'a degraded model still carries all 14 facility kinds');
  }
});

test('every facility keeps observed / inferred / unknown evidence as separate, non-conflated arrays', () => {
  for (const entry of model.facilities) {
    for (const evidenceClass of EVIDENCE_CLASSES) {
      assert.ok(Array.isArray(entry.evidence[evidenceClass]), `${entry.kind}.evidence.${evidenceClass} must be an array`);
    }
    assert.notEqual(entry.evidence.observed, entry.evidence.inferred, `${entry.kind} must not alias observed/inferred`);
    assert.notEqual(entry.evidence.inferred, entry.evidence.unknown, `${entry.kind} must not alias inferred/unknown`);
    if (!entry.present) {
      const totalReasons = entry.evidence.observed.length + entry.evidence.inferred.length + entry.evidence.unknown.length;
      assert.ok(totalReasons > 0, `absent facility "${entry.kind}" must still carry at least one reason`);
    }
  }

  // The tiny-town sample genuinely has no signal for these kinds: absence
  // must read as "no evidence found", never a fabricated observed/inferred claim.
  for (const kind of ['inn', 'pub', 'guild', 'dock', 'warehouse', 'well', 'workshop', 'watchtower', 'shop']) {
    const entry = facility(kind);
    assert.equal(entry.present, false);
    assert.deepEqual(entry.evidence.observed, []);
    assert.deepEqual(entry.evidence.inferred, []);
    assert.equal(entry.evidence.unknown.length, 1);
    assert.equal(entry.details, undefined, `absent "${kind}" must not carry a details object`);
  }
});

test('dojo, house, and gate are present with evidence grounded in the real sample files', () => {
  const dojo = facility('dojo');
  assert.equal(dojo.present, true);
  assert.equal(dojo.details.testBuildingCount, 1);
  assert.deepEqual(dojo.details.sample, ['test/inn.test.js']);
  assert.equal(dojo.evidence.inferred.length, 1, 'the source/test association is an inferred fact, not an observed one');
  assert.match(dojo.evidence.unknown.join(' '), /untested is not broken/i);

  const house = facility('house');
  assert.equal(house.present, true);
  assert.equal(house.count, 11);

  const gate = facility('gate');
  assert.equal(gate.present, true);
  assert.deepEqual(gate.details.entrypoints, [{ path: 'src/main.js', evidence: 'package.json:main' }]);
});

test('ruin is the one facility whose details.flavor stays true even when absent — dirt is flavor, never a failure', () => {
  const ruin = facility('ruin');
  assert.equal(ruin.present, false, 'the tiny-town sample happens to have no file that is both unverified and unreached');
  assert.ok(ruin.details, 'ruin must carry a details object even while absent (the one facility-kind exception)');
  assert.equal(ruin.details.flavor, true);

  // Contrast: every other absent facility carries no `details` key at all.
  for (const kind of ['inn', 'pub', 'watchtower']) assert.equal(facility(kind).details, undefined);
});

test('a genuinely unreached, unverified file is surfaced as ruin — inferred evidence, flavor language, never "broken"', () => {
  const fixture = {
    repository: { name: 'ruin-fixture' },
    city: {
      buildings: [
        {
          id: 'src/dead.js', name: 'dead', path: 'src/dead.js', district: 'src', kind: 'module', bytes: 10,
          isTest: false, state: 'unverified',
          evidence: { unresolvedLinks: 0, cycle: false, associatedTest: false, reachability: 'not-reached-from-known-entrypoints' }
        },
        {
          id: 'src/live.js', name: 'live', path: 'src/live.js', district: 'src', kind: 'module', bytes: 10,
          isTest: false, state: 'mapped',
          evidence: { unresolvedLinks: 0, cycle: false, associatedTest: true, reachability: 'reachable' }
        }
      ]
    },
    graph: { entrypoints: [{ path: 'src/live.js', evidence: 'package.json:main' }] },
    summary: { filesDiscovered: 2, filesScanned: 2, cycles: 0, testAssociations: 0, unresolvedLinks: 0 }
  };

  const ruinModel = buildTownModel(fixture);
  const ruin = ruinModel.facilities.find((entry) => entry.kind === 'ruin');
  assert.equal(ruin.present, true);
  assert.equal(ruin.count, 1);
  assert.deepEqual(ruin.details.sample, ['src/dead.js']);
  assert.match(ruin.evidence.inferred.join(' '), /src\/dead\.js/);
  assert.match(ruin.evidence.unknown.join(' '), /flavor, not failure/i);
  assert.doesNotMatch(ruin.evidence.inferred.join(' '), /\bbroken\b/i);
  // The paired reachable, tested file must never be swept into ruin.
  assert.ok(!ruin.details.sample.includes('src/live.js'));
});

test('isConnectionBuilding is a pure, non-throwing predicate matching the service / route-like-interface rule', () => {
  assert.equal(isConnectionBuilding(null), false);
  assert.equal(isConnectionBuilding(undefined), false);
  assert.equal(isConnectionBuilding('src/api/foo.js'), false);
  assert.equal(isConnectionBuilding({ kind: 'service', path: 'src/anything.js' }), true);
  assert.equal(isConnectionBuilding({ kind: 'interface', path: 'src/routes/foo.js' }), true);
  assert.equal(isConnectionBuilding({ kind: 'interface', path: 'src/components/foo.js' }), false);
  assert.equal(isConnectionBuilding({ kind: 'module', path: 'src/routes/foo.js' }), false);
});

test('the 接続者ギルド panel exposes exactly the GUILD_TABS keys in order, and じょうたい never claims observed proof', () => {
  assert.deepEqual(Object.keys(model.guild), GUILD_TABS);
  assert.equal(model.guild['もちもの'].length, 5);
  assert.equal(model.guild['じょうたい'].length, 4);
  for (const state of model.guild['じょうたい']) {
    assert.notEqual(state.evidenceClass, 'observed', `guild state "${state.label}" must never claim static-observed proof`);
  }
});

test('the returned TownModel is deep-frozen end to end', () => {
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.facilities));
  assert.ok(Object.isFrozen(model.facilities[0]));
  assert.ok(Object.isFrozen(model.facilities[0].evidence));
  assert.ok(Object.isFrozen(model.guild));
  assert.throws(() => { model.facilities[0].evidence.observed.push('x'); }, TypeError);
});

test('the full pipeline is deterministic: two independent runs on the same repo yield a structurally identical model', async () => {
  const inspectionAgain = await inspectRepository(SAMPLE_REPO);
  const signalsAgain = await collectSignals(SAMPLE_REPO);
  const modelAgain = buildTownModel(inspectionAgain, signalsAgain);
  assert.notEqual(modelAgain, model, 'each buildTownModel call must return a fresh object, not a cached/shared reference');
  assert.deepEqual(modelAgain, model);
});

// Regression: a package.json entry (main / bin / exports) that points at a
// scanned file must light the gate even when the static scanner's strict
// "./"-only resolver produced zero entrypoints. Otherwise a real, runnable repo
// (e.g. { "bin": "src/server.mjs" }) is falsely judged as having no way in.
function gateFixture({ entrypoints = [], buildingPaths = [], packageJson = {} } = {}) {
  const inspectionLike = {
    repository: { name: 'fixture' },
    summary: {},
    city: { buildings: buildingPaths.map((p) => ({ id: p, path: p, kind: 'module', isTest: false, state: 'mapped', evidence: {} })) },
    graph: { entrypoints }
  };
  const signalsLike = { packageJson };
  return buildTownModel(inspectionLike, signalsLike).facilities.find((f) => f.kind === 'gate');
}

test('gate: a bin declared without a "./" prefix that points at a scanned file is an observed entrance', () => {
  const gate = gateFixture({ buildingPaths: ['src/server.mjs'], packageJson: { bin: 'src/server.mjs' } });
  assert.equal(gate.present, true);
  assert.equal(gate.count, 1);
  assert.match(gate.evidence.observed.join(' '), /src\/server\.mjs/);
  assert.ok(gate.evidence.unknown.length > 0, 'gate must still admit that actually starting the entry is unknown');
});

test('gate: an extensionless main and a bin map both resolve against scanned files', () => {
  const gate = gateFixture({
    buildingPaths: ['src/index.js', 'bin/cli.mjs'],
    packageJson: { main: './src/index', bin: { app: 'bin/cli.mjs' } }
  });
  assert.equal(gate.present, true);
  assert.equal(gate.count, 2);
});

test('gate: a declared entry that matches no scanned file leaves the gate honestly absent (unknown, not proven absent)', () => {
  const gate = gateFixture({ buildingPaths: ['src/lib.mjs'], packageJson: { main: 'src/does-not-exist.mjs' } });
  assert.equal(gate.present, false);
  assert.equal(gate.count, 0);
  assert.equal(gate.evidence.observed.length, 0);
  assert.match(gate.evidence.unknown.join(' '), /not proven absent/);
});

test('gate: a resolved scanner entrypoint and a declared entry pointing at the same file are not double-counted', () => {
  const gate = gateFixture({
    entrypoints: [{ path: 'src/main.mjs', evidence: 'package.json:main' }],
    buildingPaths: ['src/main.mjs'],
    packageJson: { main: './src/main.mjs' }
  });
  assert.equal(gate.present, true);
  assert.equal(gate.count, 1, 'the same entry file reached two ways is one gate, not two');
});
