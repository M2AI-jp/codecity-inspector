// test/town/generator.test.mjs
//
// Contract tests for src/town/generator.mjs: generateLayout({ model, seed,
// generatorVersion, repoFingerprint }). Runs the REAL read-only observe
// pipeline once (inspectRepository -> buildTown -> generateLayout) against
// sample/tiny-town, then asserts the determinism, evidence-honesty, and
// spatial-validity guarantees the module's own header comment promises:
// byte-identical output for an identical seed, a different output for a
// different seed, buildings placed only for present facilities (plus the
// always-present town_hall and an evidence-backed gate), every building
// footprint inside the map bounds, and a fresh layout that passes
// validateLayout(...).ok === true. It also covers the v1.1.0 terrain features:
// a waterway crossed by walkable bridges, and a raised plateau ringed by cliff
// and joined to the network by walkable stairs — added deterministically and
// only when they keep the layout valid (else the town stays flat).
//
// SAFETY: the only functions that ever touch sample/tiny-town are
// inspectRepository and collectSignals (via buildTown), both read-only
// static scanners. This file never imports, requires, or otherwise runs
// anything under sample/tiny-town/src or sample/tiny-town/test. Nothing here
// calls Date.now / new Date / Math.random; the seeded PRNG in
// src/town/rng.mjs is the only randomness source generateLayout ever uses.

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRepository } from '../../src/inspector.mjs';
import { buildTown } from '../../src/town/index.mjs';
import { buildTownModel } from '../../src/town/detect.mjs';
import { generateLayout } from '../../src/town/generator.mjs';
import { validateLayout } from '../../src/town/validator.mjs';
import { repoFingerprint } from '../../src/town/rng.mjs';
import { GENERATOR_VERSION, FACILITY_KINDS, WALKABLE_TILE_TYPES } from '../../src/town/schema.mjs';

const SAMPLE_REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../sample/tiny-town');

// Run the real pipeline exactly once; every test below reads these frozen
// results instead of re-scanning, so there is one definition of "what the
// sample looked like" for every assertion to agree on (mirrors
// test/town/detect.test.mjs's convention).
const inspection = await inspectRepository(SAMPLE_REPO);
const { model } = await buildTown(SAMPLE_REPO, inspection);
const fingerprint = repoFingerprint(inspection);

const presentKinds = model.facilities.filter((facility) => facility.present).map((facility) => facility.kind);
const absentKinds = FACILITY_KINDS.filter((kind) => !presentKinds.includes(kind));

test('sample/tiny-town has both a present gate and a present town_hall (sanity check for the rest of this file)', () => {
  assert.ok(presentKinds.includes('gate'), 'expected the sample to have a discoverable entrance');
  assert.ok(presentKinds.includes('town_hall'), 'town_hall is always present per detect.mjs');
  assert.ok(absentKinds.length > 0, 'expected at least one absent facility to exercise evidence honesty');
});

test('generateLayout is byte-identical for the same (model, repoFingerprint, generatorVersion, seed)', () => {
  const layoutA = generateLayout({ model, seed: 'seed-alpha', generatorVersion: GENERATOR_VERSION, repoFingerprint: fingerprint });
  const layoutB = generateLayout({ model, seed: 'seed-alpha', generatorVersion: GENERATOR_VERSION, repoFingerprint: fingerprint });
  assert.equal(JSON.stringify(layoutA), JSON.stringify(layoutB));
  assert.deepEqual(layoutA, layoutB);
});

test('a different seed produces a different layout', () => {
  const layoutA = generateLayout({ model, seed: 'seed-alpha', repoFingerprint: fingerprint });
  const layoutB = generateLayout({ model, seed: 'seed-beta', repoFingerprint: fingerprint });
  assert.notEqual(JSON.stringify(layoutA), JSON.stringify(layoutB));
  assert.equal(layoutA.seed, 'seed-alpha');
  assert.equal(layoutB.seed, 'seed-beta');
});

test('only present facilities are placed — evidence honesty (plus the always-present town_hall)', () => {
  const layout = generateLayout({ model, seed: 'evidence-check', repoFingerprint: fingerprint });
  const placedKinds = layout.buildings.map((building) => building.facilityKind);

  // Every present facility gets exactly one building, in the placement order.
  for (const kind of presentKinds) {
    assert.ok(placedKinds.includes(kind), `present facility "${kind}" must have a building`);
  }
  // No absent facility is ever given a building.
  for (const kind of absentKinds) {
    if (kind === 'town_hall') continue; // town_hall is unconditional; cannot be absent anyway
    assert.ok(!placedKinds.includes(kind), `absent facility "${kind}" must NOT have a building`);
  }
  // No duplicate buildings, and no unknown facility kind slipped in.
  assert.equal(new Set(placedKinds).size, placedKinds.length, 'no facility kind should be placed twice');
  for (const kind of placedKinds) assert.ok(FACILITY_KINDS.includes(kind), `"${kind}" must be a real FACILITY_KIND`);
});

test('town_hall is always placed; gate is placed only when its own Facility is present', () => {
  // Real sample: both town_hall and gate are present.
  const layout = generateLayout({ model, seed: 'town-and-gate', repoFingerprint: fingerprint });
  const townHall = layout.buildings.find((building) => building.facilityKind === 'town_hall');
  const gate = layout.buildings.find((building) => building.facilityKind === 'gate');
  assert.ok(townHall, 'town_hall must always be placed');
  assert.ok(gate, 'the sample repo has a discoverable entrance, so gate must be placed');

  // Degraded/malformed model (buildTownModel tolerates null input and still
  // guarantees town_hall — see detect.mjs / detect.test.mjs) has no evidence
  // for a gate at all: generateLayout must never invent one.
  const degradedModel = buildTownModel(null);
  const degradedPresent = degradedModel.facilities.filter((facility) => facility.present).map((facility) => facility.kind);
  assert.ok(!degradedPresent.includes('gate'), 'sanity check: the degraded fixture truly has no present gate');

  const degradedLayout = generateLayout({ model: degradedModel, seed: 'no-gate', repoFingerprint: 'deadbeef' });
  const degradedKinds = degradedLayout.buildings.map((building) => building.facilityKind);
  assert.deepEqual(degradedKinds, ['town_hall'], 'a gate-less model must yield a gate-less, town_hall-only layout');
});

test('every building footprint lies fully within the map bounds', () => {
  const layout = generateLayout({ model, seed: 'bounds-check', repoFingerprint: fingerprint });
  const { widthTiles, heightTiles } = layout.map;
  assert.ok(widthTiles > 0 && heightTiles > 0, 'map must have positive dimensions');

  for (const building of layout.buildings) {
    const { x, y, footprint } = building;
    assert.ok(Number.isInteger(x) && Number.isInteger(y), `building "${building.id}" coordinates must be integers`);
    assert.ok(x >= 0 && y >= 0, `building "${building.id}" footprint must not start off the top/left edge`);
    assert.ok(
      x + footprint.widthTiles <= widthTiles && y + footprint.heightTiles <= heightTiles,
      `building "${building.id}" footprint (${x},${y}) sized ${footprint.widthTiles}x${footprint.heightTiles} must fit inside the ${widthTiles}x${heightTiles} map`
    );
  }
});

test('the produced layout passes validateLayout(...).ok === true', () => {
  for (const seed of ['seed-alpha', 'seed-beta', repoFingerprint({}), 'another-seed-42']) {
    const layout = generateLayout({ model, seed, repoFingerprint: fingerprint });
    const validation = validateLayout(layout);
    assert.equal(validation.ok, true, `seed "${seed}" must produce a layout that validates: ${JSON.stringify(validation.issues)}`);
    assert.equal(validation.noOverlap, true);
    assert.equal(validation.walkable, true);
    assert.equal(validation.importantBuildingsReachable, true);
    assert.deepEqual(validation.issues.filter((issue) => issue.severity === 'error'), []);
  }
});

test('generateLayout output always reports the frozen GENERATOR_VERSION, regardless of the generatorVersion argument', () => {
  const layout = generateLayout({ model, seed: 's', generatorVersion: 'not-the-real-version', repoFingerprint: fingerprint });
  assert.equal(layout.generatorVersion, GENERATOR_VERSION);
});

// --- v1.1.0 terrain features: waterway+bridge, elevation+stairs --------------
// The sample town has a road network and open grass, so both features are always
// added to it; the assertions below exercise the shape of each, plus the schema
// walkability contract for the four tile ids and that validation still passes.

const WALKABLE_TILE_SET = new Set(WALKABLE_TILE_TYPES);

/** Collect the terrain grid plus tile helpers for one generated layout. */
function terrainOf(layout) {
  const { widthTiles, heightTiles, terrain } = layout.map;
  const at = (x, y) => terrain[y]?.[x];
  const walkableAt = (x, y) => typeof at(x, y) === 'string' && WALKABLE_TILE_SET.has(at(x, y));
  const cells = [];
  for (let y = 0; y < heightTiles; y++) {
    for (let x = 0; x < widthTiles; x++) cells.push({ x, y, tile: terrain[y][x] });
  }
  return { widthTiles, heightTiles, at, walkableAt, cells };
}

test('a waterway is carved and every crossing bridge is walkable and truly spans the water', () => {
  const layout = generateLayout({ model, seed: 'waterway-check', repoFingerprint: fingerprint });
  const g = terrainOf(layout);
  const water = g.cells.filter((c) => c.tile === 'water');
  const bridges = g.cells.filter((c) => c.tile === 'bridge');

  assert.ok(water.length > 0, 'the sample town (with roads) must gain a waterway of water tiles');
  assert.ok(bridges.length > 0, 'a road crossing the waterway must become at least one bridge');

  for (const { x, y } of bridges) {
    assert.ok(g.walkableAt(x, y), `bridge (${x},${y}) must be walkable terrain`);
    // spans: 'water' on both sides of one axis, walkable ground on both sides of the other.
    const waterVertical = g.at(x, y - 1) === 'water' && g.at(x, y + 1) === 'water';
    const waterHorizontal = g.at(x - 1, y) === 'water' && g.at(x + 1, y) === 'water';
    const spans =
      (waterVertical && g.walkableAt(x - 1, y) && g.walkableAt(x + 1, y)) ||
      (waterHorizontal && g.walkableAt(x, y - 1) && g.walkableAt(x, y + 1));
    assert.ok(spans, `bridge (${x},${y}) must carry a road across the water, not dead-end into it`);
  }
  assert.equal(validateLayout(layout).ok, true, 'a bridged waterway must keep the layout valid');
});

test('a raised plateau is ringed with non-walkable cliff and joined by exactly-connecting walkable stairs', () => {
  const layout = generateLayout({ model, seed: 'plateau-check', repoFingerprint: fingerprint });
  const g = terrainOf(layout);
  const cliffs = g.cells.filter((c) => c.tile === 'cliff');
  const stairs = g.cells.filter((c) => c.tile === 'stairs');

  assert.ok(cliffs.length > 0, 'the sample town has room for a plateau ringed by cliff');
  assert.ok(stairs.length > 0, 'the plateau must be linked to the ground by a stairs tile');
  assert.ok(!WALKABLE_TILE_SET.has('cliff'), 'cliff must be a non-walkable tile type');
  for (const { x, y } of cliffs) assert.ok(!g.walkableAt(x, y), `cliff (${x},${y}) must be non-walkable`);

  for (const { x, y } of stairs) {
    assert.ok(g.walkableAt(x, y), `stairs (${x},${y}) must be walkable terrain`);
    const touchesCliff = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]].some(([nx, ny]) => g.at(nx, ny) === 'cliff');
    const throughPath =
      (g.walkableAt(x, y - 1) && g.walkableAt(x, y + 1)) ||
      (g.walkableAt(x - 1, y) && g.walkableAt(x + 1, y));
    assert.ok(touchesCliff, `stairs (${x},${y}) must adjoin the cliff rim it bridges`);
    assert.ok(throughPath, `stairs (${x},${y}) must have walkable ground on two opposite sides`);
  }
  assert.equal(validateLayout(layout).ok, true, 'a stair-linked plateau must keep the layout valid');
});

test('the new terrain tiles honour the schema walkability contract, deterministically, without breaking validation', () => {
  for (const seed of ['t-1', 't-2', 't-3', 't-4', 't-5', repoFingerprint({})]) {
    const first = generateLayout({ model, seed, repoFingerprint: fingerprint });
    const again = generateLayout({ model, seed, repoFingerprint: fingerprint });
    assert.equal(JSON.stringify(first), JSON.stringify(again), `terrain features must be deterministic for seed "${seed}"`);

    const g = terrainOf(first);
    for (const { x, y, tile } of g.cells) {
      if (tile === 'bridge' || tile === 'stairs') assert.ok(g.walkableAt(x, y), `"${tile}" at (${x},${y}) must be walkable`);
      if (tile === 'water' || tile === 'cliff') assert.ok(!g.walkableAt(x, y), `"${tile}" at (${x},${y}) must be non-walkable`);
    }
    assert.equal(validateLayout(first).ok, true, `seed "${seed}" must still validate with terrain features`);
  }
});

test('the large repo-root town actually gains bridge and/or stairs terrain, deterministically, and still validates', async () => {
  // A big map (the whole codecity-inspector repo, not the tiny sample) proves the
  // features really fire on a large layout, not just the sample. inspectRepository
  // is the same read-only static scanner used everywhere else in this file.
  const rootRepo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const rootInspection = await inspectRepository(rootRepo);
  const { model: rootModel } = await buildTown(rootRepo, rootInspection);
  const rootFingerprint = repoFingerprint(rootInspection);

  const first = generateLayout({ model: rootModel, seed: 'root-run', repoFingerprint: rootFingerprint });
  const again = generateLayout({ model: rootModel, seed: 'root-run', repoFingerprint: rootFingerprint });
  assert.equal(JSON.stringify(first), JSON.stringify(again), 'the large town must be byte-identical for the same seed');

  const g = terrainOf(first);
  const bridges = g.cells.filter((c) => c.tile === 'bridge').length;
  const stairs = g.cells.filter((c) => c.tile === 'stairs').length;
  assert.ok(bridges > 0 || stairs > 0, 'a large map must actually gain a bridge and/or stairs, not fall flat');

  const validation = validateLayout(first);
  assert.equal(validation.ok, true, `the large repo-root town must validate: ${JSON.stringify(validation.issues)}`);
});
