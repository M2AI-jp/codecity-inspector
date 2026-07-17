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

/** First terrain cell (row-major) equal to `type`, or null. */
function firstTileOfType(layout, type) {
  const { widthTiles, heightTiles, terrain } = layout.map;
  for (let y = 0; y < heightTiles; y++) {
    for (let x = 0; x < widthTiles; x++) {
      if (terrain[y][x] === type) return { x, y };
    }
  }
  return null;
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

test('ENTRANCE_CLEAR: a remote entrance cannot pass merely because its tile is walkable', () => {
  const layout = structuredClone(baselineLayout());
  const inn = buildingById(layout, 'building-inn');
  const road = layout.roads.find((candidate) => candidate.fromBuildingId === inn.id || candidate.toBuildingId === inn.id);
  const remote = road.tiles.find(([x, y]) => (
    Math.abs(x - inn.entrance.x) + Math.abs(y - inn.entrance.y) >= 2
    && !layout.buildings.some((building) => {
      const width = building.footprint.widthTiles;
      const height = building.footprint.heightTiles;
      return x >= building.x && x < building.x + width && y >= building.y && y < building.y + height;
    })
  ));
  assert.ok(remote, 'fixture must expose a remote walkable road tile');
  [inn.entrance.x, inn.entrance.y] = remote;

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === 'ENTRANCE_CLEAR' && /not immediately outside/.test(entry.message)));
});

test('ENTRANCE_CLEAR: the entrance direction must name the footprint side it touches', () => {
  const layout = structuredClone(baselineLayout());
  const inn = buildingById(layout, 'building-inn');
  const alternatives = ['up', 'down', 'left', 'right'].filter((direction) => direction !== inn.entrance.direction);
  inn.entrance.direction = alternatives[0];

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === 'ENTRANCE_CLEAR' && /not immediately outside/.test(entry.message)));
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
  // Dry out only the water the dock's entrance actually touches (its 4-neighbours),
  // not every water tile on the map: the v1.1.0 waterway/bridges live elsewhere and
  // must stay intact, so this corruption isolates DOCK_ON_WATER and nothing else.
  const dock = buildingById(layout, 'building-dock');
  const { x: ex, y: ey } = dock.entrance;
  for (const [nx, ny] of [[ex + 1, ey], [ex - 1, ey], [ex, ey + 1], [ex, ey - 1]]) {
    if (layout.map.terrain[ny]?.[nx] === 'water') layout.map.terrain[ny][nx] = 'grass';
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

// --- v1.1.0 terrain features: bridge spans, stairs connects, cliff obstacle ---
// The baseline is a real generated layout, so it already carries a bridged
// waterway and a stair-linked plateau. The anchor test proves those pass their
// new codes cleanly; each corruption then breaks exactly one feature and asserts
// only its code fires -- proving BRIDGE_SPANS_WATER / STAIRS_CONNECT_ELEVATION
// are live and that a flat/valid layout never trips them spuriously.

test('a valid bridge and stairs in the baseline pass BRIDGE_SPANS_WATER / STAIRS_CONNECT_ELEVATION cleanly', () => {
  const layout = baselineLayout();
  assert.ok(firstTileOfType(layout, 'bridge'), 'the fixture must carve a waterway crossed by at least one bridge');
  assert.ok(firstTileOfType(layout, 'stairs'), 'the fixture must raise a plateau joined by a stairs tile');

  const result = validateLayout(layout);
  assert.equal(result.ok, true);
  assert.ok(result.issues.every((i) => i.code !== 'BRIDGE_SPANS_WATER'), 'a real spanning bridge must not trip BRIDGE_SPANS_WATER');
  assert.ok(result.issues.every((i) => i.code !== 'STAIRS_CONNECT_ELEVATION'), 'a real connecting stairs must not trip STAIRS_CONNECT_ELEVATION');
});

test('BRIDGE_SPANS_WATER: a bridge that no longer spans water fails with ok:false', () => {
  const layout = structuredClone(baselineLayout());
  const bridge = firstTileOfType(layout, 'bridge');
  assert.ok(bridge, 'baseline must contain a bridge to corrupt');
  const T = layout.map.terrain;
  // Dry out one of the two water tiles the bridge spans, so it dead-ends into
  // dry ground instead of carrying the road across a gap.
  if (T[bridge.y - 1]?.[bridge.x] === 'water' && T[bridge.y + 1]?.[bridge.x] === 'water') {
    T[bridge.y - 1][bridge.x] = 'grass';
  } else {
    T[bridge.y][bridge.x - 1] = 'grass';
  }

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'BRIDGE_SPANS_WATER' && i.severity === 'error'
    && i.message.includes(`(${bridge.x},${bridge.y})`)));
  assert.ok(result.issues.every((i) => i.code === 'BRIDGE_SPANS_WATER'), 'this corruption should trip nothing else');
});

test('STAIRS_CONNECT_ELEVATION: a stairs no longer adjoining the cliff rim fails with ok:false', () => {
  const layout = structuredClone(baselineLayout());
  const stairs = firstTileOfType(layout, 'stairs');
  assert.ok(stairs, 'baseline must contain a stairs to corrupt');
  const T = layout.map.terrain;
  // Erase the plateau rim next to the stairs so it adjoins no cliff -- the stairs
  // now "connects" no elevation, which STAIRS_CONNECT_ELEVATION must catch.
  for (const [nx, ny] of [[stairs.x, stairs.y - 1], [stairs.x, stairs.y + 1], [stairs.x - 1, stairs.y], [stairs.x + 1, stairs.y]]) {
    if (T[ny]?.[nx] === 'cliff') T[ny][nx] = 'grass';
  }

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'STAIRS_CONNECT_ELEVATION' && i.severity === 'error'
    && i.message.includes(`(${stairs.x},${stairs.y})`)));
  assert.ok(result.issues.every((i) => i.code === 'STAIRS_CONNECT_ELEVATION'), 'this corruption should trip nothing else');
});

test('NO_OVERLAP: a footprint covering a natural obstacle (water or cliff) fails with ok:false', () => {
  for (const obstacle of ['water', 'cliff']) {
    const layout = structuredClone(baselineLayout());
    const house = buildingById(layout, 'building-house');
    layout.map.terrain[house.y][house.x] = obstacle; // paint the obstacle under the footprint's own tile

    const result = validateLayout(layout);
    assert.equal(result.ok, false, `a footprint over ${obstacle} must fail`);
    assert.equal(result.noOverlap, false);
    assert.ok(result.issues.some((i) => i.code === 'NO_OVERLAP' && i.severity === 'error' && i.message.includes(obstacle)));
    assert.ok(result.issues.every((i) => i.code === 'NO_OVERLAP'), `${obstacle} under a footprint should trip nothing else`);
  }
});

test('NPC_NOT_IN_WALL: an NPC standing on water or cliff fails with ok:false', () => {
  for (const obstacle of ['water', 'cliff']) {
    const layout = structuredClone(baselineLayout());
    const spot = firstTileOfType(layout, obstacle);
    assert.ok(spot, `baseline must contain a ${obstacle} tile`);
    const npc = layout.npcs.find((n) => n.id === 'npc-shop');
    assert.ok(npc, 'expected an npc-shop fixture NPC');
    npc.x = spot.x;
    npc.y = spot.y;

    const result = validateLayout(layout);
    assert.equal(result.ok, false, `an NPC on ${obstacle} must fail`);
    assert.ok(result.issues.some((i) => i.code === 'NPC_NOT_IN_WALL' && i.severity === 'error'
      && i.message.includes('npc-shop') && i.message.includes(obstacle)));
    assert.ok(result.issues.every((i) => i.code === 'NPC_NOT_IN_WALL'), `an NPC on ${obstacle} should trip nothing else`);
  }
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

test('a structurally valid layout with no gate is adoptable but records reachability as unestablished', () => {
  const terrain = Array.from({ length: 5 }, () => Array(5).fill('grass'));
  const result = validateLayout({
    townId: 'empty-town', repoFingerprint: 'a'.repeat(64), generatorVersion: '1.1.0', seed: '',
    map: { widthTiles: 5, heightTiles: 5, tileSize: 16, terrain },
    districts: [], buildings: [], roads: [], npcs: [], props: [], connections: []
  });
  assert.equal(result.ok, true);
  assert.equal(result.importantBuildingsReachable, false);
  assert.ok(result.issues.some((i) => i.code === 'REACHABLE' && i.severity === 'warning' && /no gate/.test(i.message)));
});

test('malformed entity entries and missing layout collections cannot be filtered into a passing layout', () => {
  const terrain = Array.from({ length: 2 }, () => Array(2).fill('grass'));
  const base = {
    townId: 'structure-test', repoFingerprint: 'b'.repeat(64), generatorVersion: '1.1.0', seed: 'test',
    map: { widthTiles: 2, heightTiles: 2, tileSize: 16, terrain },
    districts: [], buildings: [], roads: [], npcs: [], props: [], connections: []
  };
  for (const field of ['districts', 'buildings', 'roads', 'npcs', 'props', 'connections']) {
    const malformed = { ...base, [field]: [null] };
    const result = validateLayout(malformed);
    assert.equal(result.ok, false, `${field}=[null] must fail structural validation`);
    assert.ok(result.issues.some((entry) => entry.code === 'STRUCTURE' && entry.severity === 'error'));
  }
  const missingCollections = validateLayout({ map: base.map, buildings: [], roads: [], npcs: [], props: [] });
  assert.equal(missingCollections.ok, false);
  assert.ok(missingCollections.issues.some((entry) => entry.code === 'STRUCTURE' && /districts/.test(entry.message)));
});

test('missing or malformed deterministic identity fields fail structural validation', () => {
  const layout = structuredClone(baselineLayout());
  delete layout.townId;
  layout.repoFingerprint = 'not-a-digest';
  layout.generatorVersion = '';
  layout.seed = 42;

  const result = validateLayout(layout);
  assert.equal(result.ok, false);
  for (const field of ['townId', 'repoFingerprint', 'generatorVersion', 'seed']) {
    assert.ok(result.issues.some((entry) => entry.code === 'STRUCTURE' && entry.message.includes(field)), field);
  }
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
