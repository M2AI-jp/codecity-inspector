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
// validateLayout(...).ok === true.
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
import { GENERATOR_VERSION, FACILITY_KINDS } from '../../src/town/schema.mjs';

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
