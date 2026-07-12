// test/town/validator.test.mjs
//
// Coverage for src/town/validator.mjs: validateLayout(layout) and its
// annotateLayout(layout) wrapper. The baseline fixture is a real, richly
// connected TownLayout produced by the actual ./generator.mjs
// (generateLayout) from a hand-built TownModel with every FACILITY_KIND
// present, so every invariant the validator checks has real geometry to
// break -- these are not synthetic minimal fixtures. Each corruption test
// takes a structuredClone of that baseline and mutates exactly the field(s)
// needed to trip one invariant, then asserts the matching issue code is
// present and validation.ok is false.
//
// SAFETY / DETERMINISM: this file never executes any scanned repository.
// generateLayout and validateLayout are both pure, synchronous, read-only
// functions over plain data (no I/O, no Date.now/new Date/Math.random); the
// one grounding test against the real sample/tiny-town repository only goes
// through inspectRepository / collectSignals, both static-only readers, per
// the same convention test/town/detect.test.mjs and
// test/town/habitability.test.mjs already establish.

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateLayout, annotateLayout } from '../../src/town/validator.mjs';
import { generateLayout } from '../../src/town/generator.mjs';
import { FACILITY_KINDS } from '../../src/town/schema.mjs';
import { inspectRepository } from '../../src/inspector.mjs';
import { collectSignals } from '../../src/town/signals.mjs';
import { buildTownModel } from '../../src/town/detect.mjs';
import { repoFingerprint, defaultSeed } from '../../src/town/rng.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_REPO = path.join(__dirname, '..', '..', 'sample', 'tiny-town');

// --- baseline fixture: a real generated layout with every facility present --
//
// Marking every FACILITY_KIND present (not just a realistic subset) gives the
// generator's uniform-grid placement its maximum building/road count, so
// there is a main facility other than the hub to disconnect, a dock to pull
// off water, and plenty of non-main buildings (house/shop/...) to collide.

function facility(kind) {
  return {
    kind,
    present: true,
    count: 1,
    evidence: { observed: [`${kind}: observed for fixture`], inferred: [], unknown: [] }
  };
}

function fullModel() {
  return {
    repository: { name: 'validator-fixture-town' },
    facilities: FACILITY_KINDS.map(facility),
    guild: {},
    external: { contractorReports: [] },
    summary: {}
  };
}

const SEED = 'validator-test-seed';
const REPO_FINGERPRINT = 'f'.repeat(64);

/** A fresh baseline TownLayout; callers structuredClone before mutating. */
function baselineLayout() {
  return generateLayout({ model: fullModel(), seed: SEED, repoFingerprint: REPO_FINGERPRINT, generatorVersion: '1.0.0' });
}

function buildingById(layout, id) {
  const found = layout.buildings.find((b) => b.id === id);
  assert.ok(found, `expected a "${id}" building in the fixture layout`);
  return found;
}

// --- known-good baseline ------------------------------------------------------

test('validateLayout on the real generated baseline layout: ok true, zero issues, every hard invariant true', () => {
  const layout = baselineLayout();
  const result = validateLayout(layout);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.walkable, true);
  assert.equal(result.importantBuildingsReachable, true);
  assert.equal(result.noOverlap, true);
  assert.ok(result.densityScore > 0 && result.densityScore < 1);
});

test('validateLayout return shape matches the TownLayoutValidation contract and is deep-frozen', () => {
  const result = validateLayout(baselineLayout());
  assert.deepEqual(Object.keys(result).sort(), [
    'densityScore', 'importantBuildingsReachable', 'issues', 'noOverlap', 'ok', 'walkable'
  ].sort());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.issues));
  assert.throws(() => { result.ok = false; }, TypeError);
  assert.throws(() => { result.issues.push({}); }, TypeError);
});

test('validateLayout is pure and deterministic: two calls on structurally identical layouts return deepEqual results', () => {
  const a = validateLayout(baselineLayout());
  const b = validateLayout(baselineLayout());
  assert.deepEqual(a, b);
});

test('validateLayout never mutates its layout argument', () => {
  const layout = baselineLayout();
  const before = JSON.stringify(layout);
  validateLayout(layout);
  assert.equal(JSON.stringify(layout), before);
});

test('annotateLayout returns a NEW object with a freshly computed validation, and never mutates the input', () => {
  const layout = baselineLayout();
  const originalValidation = layout.validation; // the generator's own "not_validated" placeholder
  const annotated = annotateLayout(layout);

  assert.notEqual(annotated, layout);
  assert.equal(layout.validation, originalValidation, 'the input layout must be untouched');
  assert.deepEqual(annotated.validation, validateLayout(layout));
  assert.equal(annotated.buildings, layout.buildings, 'every other field is a shallow reference to the original');
  assert.ok(Object.isFrozen(annotated.validation));
});

test('annotateLayout degrades a non-object layout to { validation } instead of throwing', () => {
  for (const bad of [null, undefined, 42, 'not-a-layout']) {
    let annotated;
    assert.doesNotThrow(() => { annotated = annotateLayout(bad); });
    assert.deepEqual(Object.keys(annotated), ['validation']);
    assert.equal(annotated.validation.ok, false);
  }
});

// --- hand-corrupted layouts: one invariant broken at a time -------------------

test('NO_OVERLAP: two overlapping building footprints fail with ok:false', () => {
  const layout = structuredClone(baselineLayout());
  const house = buildingById(layout, 'building-house');
  const shop = buildingById(layout, 'building-shop');
  house.x = shop.x;
  house.y = shop.y; // house's footprint now exactly covers shop's

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  assert.equal(result.noOverlap, false);
  assert.ok(result.issues.some((i) => i.code === 'NO_OVERLAP' && i.severity === 'error'));
  assert.ok(result.issues.every((i) => i.code === 'NO_OVERLAP'), 'this corruption should trip nothing else');
});

test('ENTRANCE_CLEAR: a blocked (non-walkable) entrance tile fails with ok:false', () => {
  const layout = structuredClone(baselineLayout());
  const well = buildingById(layout, 'building-well');
  layout.map.terrain[well.entrance.y][well.entrance.x] = 'wall'; // door bricked over

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) =>
    i.code === 'ENTRANCE_CLEAR' && i.severity === 'error' && i.message.includes('building-well')
  ));
});

test('disconnected facility: dropping a main facility\'s only road fails REACHABLE and WALKABLE, not NO_OVERLAP/DOCK_ON_WATER', () => {
  const layout = structuredClone(baselineLayout());
  layout.roads = layout.roads.filter((r) => r.id !== 'road-gate-inn'); // inn loses its only road

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  assert.equal(result.walkable, false);
  assert.equal(result.importantBuildingsReachable, false);
  assert.ok(result.issues.some((i) => i.code === 'REACHABLE' && i.message.includes('building-inn')));
  assert.ok(result.issues.some((i) => i.code === 'WALKABLE' && i.message.includes('building-inn')));
  assert.ok(result.issues.every((i) => i.code === 'REACHABLE' || i.code === 'WALKABLE'));
  assert.equal(result.noOverlap, true);
});

test('DOCK_ON_WATER: a dock whose entrance no longer touches water fails with ok:false', () => {
  const layout = structuredClone(baselineLayout());
  for (let y = 0; y < layout.map.heightTiles; y++) {
    for (let x = 0; x < layout.map.widthTiles; x++) {
      if (layout.map.terrain[y][x] === 'water') layout.map.terrain[y][x] = 'grass';
    }
  }

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'DOCK_ON_WATER' && i.severity === 'error' && i.message.includes('dock')));
  assert.ok(result.issues.every((i) => i.code === 'DOCK_ON_WATER'), 'this corruption should trip nothing else');
});

test('NPC_NOT_IN_WALL: an NPC standing inside a building footprint fails with ok:false', () => {
  const layout = structuredClone(baselineLayout());
  const house = buildingById(layout, 'building-house');
  const npc = layout.npcs.find((n) => n.id === 'npc-house');
  assert.ok(npc, 'expected an npc-house fixture NPC');
  npc.x = house.x; // top-left corner of the footprint: always a wall tile
  npc.y = house.y;

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'NPC_NOT_IN_WALL' && i.severity === 'error' && i.message.includes('npc-house')));
  assert.ok(result.issues.every((i) => i.code === 'NPC_NOT_IN_WALL'), 'this corruption should trip nothing else');
});

// --- issue ordering -------------------------------------------------------

test('issues are sorted by (code, message, severity) with plain code-unit comparison', () => {
  const layout = structuredClone(baselineLayout());
  const well = buildingById(layout, 'building-well');
  layout.map.terrain[well.entrance.y][well.entrance.x] = 'wall'; // cascades into multiple codes

  const result = validateLayout(layout);
  assert.ok(result.issues.length > 1, 'need multiple issues to exercise ordering');
  const sorted = [...result.issues].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    if (a.severity !== b.severity) return a.severity < b.severity ? -1 : 1;
    return 0;
  });
  assert.deepEqual(result.issues, sorted);
});

// --- defensive: malformed / missing input never throws ------------------------

test('validateLayout never throws on null, undefined, or structurally malformed input; degrades to a concrete failing issue', () => {
  for (const bad of [null, undefined, {}, 42, 'not-a-layout', [], { buildings: 'nope' }, { map: null, buildings: null, roads: null }]) {
    let result;
    assert.doesNotThrow(() => { result = validateLayout(bad); });
    assert.equal(result.ok, false, `malformed input ${JSON.stringify(bad)} must never validate as ok`);
    assert.ok(result.issues.length > 0);
    assert.ok(Object.isFrozen(result));
    for (const issue of result.issues) {
      assert.equal(typeof issue.code, 'string');
      assert.equal(typeof issue.message, 'string');
      assert.ok(issue.severity === 'error' || issue.severity === 'warning');
    }
  }
});

test('a layout with no buildings at all fails REACHABLE ("no gate") rather than throwing or silently passing', () => {
  const result = validateLayout({ map: { widthTiles: 5, heightTiles: 5, tileSize: 16, terrain: [] }, buildings: [], roads: [], npcs: [], props: [] });
  assert.equal(result.ok, false);
  assert.equal(result.importantBuildingsReachable, false);
  assert.ok(result.issues.some((i) => i.code === 'REACHABLE' && /no gate/.test(i.message)));
});

// --- grounding: the real sample/tiny-town repository ---------------------------
//
// inspectRepository and collectSignals are static-only (AST parse, lstat,
// JSON.parse); sample/tiny-town's own code is never executed.

test('the real sample/tiny-town repository produces a layout that validates ok:true', async () => {
  const inspection = await inspectRepository(SAMPLE_REPO);
  const signals = await collectSignals(SAMPLE_REPO);
  const model = buildTownModel(inspection, signals);
  const seed = defaultSeed(inspection);
  const fingerprint = repoFingerprint(inspection);

  const layout = generateLayout({ model, seed, repoFingerprint: fingerprint, generatorVersion: '1.0.0' });
  const result = validateLayout(layout);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});
