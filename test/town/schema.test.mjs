// test/town/schema.test.mjs
//
// Coverage for src/town/schema.mjs: the shared vocabulary/contract module for
// the town subsystem. Verifies the runtime constants exist and are aligned
// (FACILITY_KINDS derived from FACILITY_LABELS, no drift), the three guard
// helpers (isFacilityKind, makeEvidence, deepFreeze) behave per contract, and
// that objects built from the documented @typedef shapes are internally
// consistent. schema.mjs itself is import-free and does no I/O; the one
// grounding test below reaches into inspectRepository purely to confirm the
// facility-kind vocabulary never collides with the unrelated building.kind
// vocabulary produced by a real (static-only) scan.

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  deepFreeze,
  EVIDENCE_CLASSES,
  FACILITY_LABELS,
  FACILITY_KINDS,
  HABITABILITY_LEVELS,
  ASSET_CATEGORIES,
  DRAW_LAYERS,
  GUILD_TABS,
  TILE_TYPES,
  WALKABLE_TILE_TYPES,
  GENERATOR_VERSION,
  isFacilityKind,
  isTileType,
  makeEvidence
} from '../../src/town/schema.mjs';
import { inspectRepository } from '../../src/inspector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_REPO = path.join(__dirname, '..', '..', 'sample', 'tiny-town');

// --- FACILITY_KINDS / FACILITY_LABELS alignment -----------------------------

test('FACILITY_KINDS lists all 14 ids in the documented canonical order', () => {
  assert.deepEqual(FACILITY_KINDS, [
    'inn', 'pub', 'guild', 'town_hall', 'dock', 'warehouse', 'well',
    'workshop', 'dojo', 'watchtower', 'house', 'shop', 'ruin', 'gate'
  ]);
  assert.equal(FACILITY_KINDS.length, 14);
});

test('FACILITY_KINDS is derived from FACILITY_LABELS keys, so they cannot drift', () => {
  assert.deepEqual(FACILITY_KINDS, Object.keys(FACILITY_LABELS));
  // every id appears exactly once on both sides
  assert.equal(new Set(FACILITY_KINDS).size, FACILITY_KINDS.length);
  assert.equal(Object.keys(FACILITY_LABELS).length, FACILITY_KINDS.length);
});

test('FACILITY_LABELS maps every facility id to its Japanese town label', () => {
  assert.equal(FACILITY_LABELS.inn, '宿屋');
  assert.equal(FACILITY_LABELS.pub, '酒場');
  assert.equal(FACILITY_LABELS.guild, '接続者ギルド');
  assert.equal(FACILITY_LABELS.town_hall, '役場');
  assert.equal(FACILITY_LABELS.dock, '船着場');
  assert.equal(FACILITY_LABELS.warehouse, '倉庫');
  assert.equal(FACILITY_LABELS.well, '井戸');
  assert.equal(FACILITY_LABELS.workshop, '工房');
  assert.equal(FACILITY_LABELS.dojo, '道場');
  assert.equal(FACILITY_LABELS.watchtower, '見張り台');
  assert.equal(FACILITY_LABELS.house, '住宅');
  assert.equal(FACILITY_LABELS.shop, '商店');
  assert.equal(FACILITY_LABELS.ruin, '廃屋');
  assert.equal(FACILITY_LABELS.gate, '門');
  // every label is a non-empty string, none are placeholders/duplicates
  const labels = Object.values(FACILITY_LABELS);
  assert.ok(labels.every((label) => typeof label === 'string' && label.length > 0));
  assert.equal(new Set(labels).size, labels.length);
});

test('FACILITY_KINDS and FACILITY_LABELS are deep-frozen and reject mutation', () => {
  assert.ok(Object.isFrozen(FACILITY_KINDS));
  assert.ok(Object.isFrozen(FACILITY_LABELS));
  assert.throws(() => FACILITY_KINDS.push('extra'), TypeError);
  assert.throws(() => { FACILITY_LABELS.inn = 'changed'; }, TypeError);
});

// --- isFacilityKind guard ----------------------------------------------------

test('isFacilityKind accepts every id in FACILITY_KINDS and nothing else', () => {
  for (const kind of FACILITY_KINDS) assert.equal(isFacilityKind(kind), true, kind);
  assert.equal(isFacilityKind('village'), false);
  assert.equal(isFacilityKind('Inn'), false); // case-sensitive
  assert.equal(isFacilityKind('inn '), false); // no trimming
  assert.equal(isFacilityKind(''), false);
});

test('isFacilityKind never throws on non-string input and reports false', () => {
  const nonStrings = [null, undefined, 0, 42, NaN, true, false, {}, [], ['inn'], Symbol('inn'), () => 'inn'];
  for (const value of nonStrings) {
    assert.doesNotThrow(() => isFacilityKind(value));
    assert.equal(isFacilityKind(value), false, String(value));
  }
});

// --- makeEvidence guard -------------------------------------------------------

test('makeEvidence returns a fresh Evidence bag matching EVIDENCE_CLASSES', () => {
  const evidence = makeEvidence();
  assert.deepEqual(evidence, { observed: [], inferred: [], unknown: [] });
  assert.deepEqual(Object.keys(evidence), EVIDENCE_CLASSES);
});

test('makeEvidence returns independent, mutable bags on each call', () => {
  const first = makeEvidence();
  const second = makeEvidence();
  assert.notEqual(first, second);
  assert.notEqual(first.observed, second.observed);

  // mutable: pushing must not throw
  first.observed.push('package.json:main resolved');
  first.inferred.push('reachable from entrypoint');
  first.unknown.push('runtime behavior not scanned');

  // and must not leak into the sibling bag
  assert.deepEqual(second, { observed: [], inferred: [], unknown: [] });
  assert.ok(!Object.isFrozen(first));
  assert.ok(!Object.isFrozen(first.observed));
});

// --- deepFreeze guard ---------------------------------------------------------

test('deepFreeze freezes a plain object tree to full depth and returns the same reference', () => {
  const tree = { a: { b: { c: [1, 2, { d: 3 }] } } };
  const result = deepFreeze(tree);
  assert.equal(result, tree); // same reference
  assert.ok(Object.isFrozen(tree));
  assert.ok(Object.isFrozen(tree.a));
  assert.ok(Object.isFrozen(tree.a.b));
  assert.ok(Object.isFrozen(tree.a.b.c));
  assert.ok(Object.isFrozen(tree.a.b.c[2]));
  assert.throws(() => { tree.a.b.c.push(99); }, TypeError);
  assert.throws(() => { tree.a.b.c[2].d = 4; }, TypeError);
});

test('deepFreeze recurses into an already shallow-frozen input to freeze its children too', () => {
  const inner = { x: 1 };
  const outer = Object.freeze({ inner });
  assert.ok(Object.isFrozen(outer));
  assert.ok(!Object.isFrozen(inner)); // not yet frozen

  deepFreeze(outer);
  assert.ok(Object.isFrozen(inner)); // deepFreeze reached full depth anyway
});

test('deepFreeze is circular-safe for self-referential objects and arrays', () => {
  const node = { name: 'self' };
  node.self = node;
  assert.doesNotThrow(() => deepFreeze(node));
  assert.ok(Object.isFrozen(node));
  assert.equal(node.self, node); // structure preserved, no stack overflow

  const loopArray = [];
  loopArray.push(loopArray, { back: loopArray });
  assert.doesNotThrow(() => deepFreeze(loopArray));
  assert.ok(Object.isFrozen(loopArray));
  assert.ok(Object.isFrozen(loopArray[1]));
  assert.equal(loopArray[0], loopArray);
});

test('deepFreeze leaves primitives, functions, and exotic objects untouched', () => {
  assert.equal(deepFreeze(5), 5);
  assert.equal(deepFreeze('str'), 'str');
  assert.equal(deepFreeze(null), null);
  assert.equal(deepFreeze(undefined), undefined);
  assert.equal(deepFreeze(true), true);

  const fn = () => 'unfrozen';
  const fnResult = deepFreeze(fn);
  assert.equal(fnResult, fn);
  assert.ok(!Object.isFrozen(fn));
  fn.tag = 'still-mutable';
  assert.equal(fn.tag, 'still-mutable');

  const map = new Map([['a', 1]]);
  const wrappedMap = { map };
  deepFreeze(wrappedMap);
  assert.ok(Object.isFrozen(wrappedMap));
  assert.ok(!Object.isFrozen(map)); // Map is not a plain object, left alone
  map.set('b', 2); // proves it is still mutable
  assert.equal(map.get('b'), 2);

  class Widget { constructor() { this.count = 1; } }
  const instance = new Widget();
  const wrappedInstance = { instance };
  deepFreeze(wrappedInstance);
  assert.ok(Object.isFrozen(wrappedInstance));
  assert.ok(!Object.isFrozen(instance)); // class instance, not a plain object
  instance.count = 2;
  assert.equal(instance.count, 2);

  const when = new Date(2020, 0, 1);
  const wrappedDate = { when };
  deepFreeze(wrappedDate);
  assert.ok(Object.isFrozen(wrappedDate));
  assert.ok(!Object.isFrozen(when));
  when.tag = 'still-mutable';
  assert.equal(when.tag, 'still-mutable');
});

// --- HABITABILITY_LEVELS / EVIDENCE_CLASSES / ASSET_CATEGORIES / DRAW_LAYERS / GUILD_TABS ---

test('HABITABILITY_LEVELS is a 6-rung ladder with id === array index', () => {
  assert.equal(HABITABILITY_LEVELS.length, 6);
  HABITABILITY_LEVELS.forEach((level, index) => {
    assert.equal(level.id, index);
    assert.equal(typeof level.name, 'string');
    assert.ok(level.name.length > 0);
  });
  assert.deepEqual(HABITABILITY_LEVELS.map((level) => level.name), [
    '設計図だけの街',
    '通電した開拓地',
    '主要動線が通る小村',
    '住める街',
    'にぎわう街',
    '見せたくなる街'
  ]);
  assert.ok(Object.isFrozen(HABITABILITY_LEVELS));
  assert.ok(Object.isFrozen(HABITABILITY_LEVELS[0]));
  assert.throws(() => { HABITABILITY_LEVELS[0].name = 'changed'; }, TypeError);
});

test('EVIDENCE_CLASSES is exactly the three evidence keys, in bag order', () => {
  assert.deepEqual(EVIDENCE_CLASSES, ['observed', 'inferred', 'unknown']);
  assert.ok(Object.isFrozen(EVIDENCE_CLASSES));
  assert.throws(() => EVIDENCE_CLASSES.push('extra'), TypeError);
});

test('ASSET_CATEGORIES lists the 10 documented categories in order', () => {
  assert.deepEqual(ASSET_CATEGORIES, [
    'tile', 'building_exterior', 'building_interior', 'npc', 'mob',
    'creature', 'prop', 'vehicle', 'effect', 'ui'
  ]);
  assert.ok(Object.isFrozen(ASSET_CATEGORIES));
});

test('DRAW_LAYERS lists the 7 back-to-front layers in paint order', () => {
  assert.deepEqual(DRAW_LAYERS, ['ground', 'object', 'building', 'character', 'roof', 'effect', 'ui']);
  assert.ok(Object.isFrozen(DRAW_LAYERS));
});

test('GUILD_TABS lists the 5 connections-guild panel tabs in display order', () => {
  assert.deepEqual(GUILD_TABS, ['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい']);
  assert.ok(Object.isFrozen(GUILD_TABS));
});

// --- terrain tile contract: TILE_TYPES / WALKABLE_TILE_TYPES / GENERATOR_VERSION ---
// This is the byte-for-byte agreement the layout GENERATOR and VALIDATOR both
// import; the bridge/stairs/cliff terrain features live or die on it. water,
// cliff, and wall MUST stay non-walkable so a footprint / entrance / NPC can
// never legally sit on one; bridge and stairs MUST be walkable so a road can
// cross water and a plateau can join the network.

test('TILE_TYPES lists every terrain id in canonical order with no duplicates', () => {
  assert.deepEqual(TILE_TYPES, [
    'grass', 'dirt', 'path', 'road', 'sand', 'water',
    'bridge', 'stairs', 'plaza', 'floor', 'wall', 'rock', 'tree', 'cliff'
  ]);
  assert.equal(new Set(TILE_TYPES).size, TILE_TYPES.length);
  assert.ok(Object.isFrozen(TILE_TYPES));
  assert.throws(() => TILE_TYPES.push('lava'), TypeError);
});

test('WALKABLE_TILE_TYPES is the walkable subset: bridge/stairs walkable, water/cliff/wall not', () => {
  assert.deepEqual(WALKABLE_TILE_TYPES, [
    'grass', 'dirt', 'path', 'road', 'sand', 'bridge', 'stairs', 'plaza', 'floor'
  ]);
  // every walkable tile is a real terrain id (subset invariant, no drift)
  for (const tile of WALKABLE_TILE_TYPES) assert.ok(TILE_TYPES.includes(tile), tile);
  // the road network's two new connectors are walkable
  for (const tile of ['bridge', 'stairs']) assert.ok(WALKABLE_TILE_TYPES.includes(tile), tile);
  // the hard non-walkable tiles block movement (regression guard for reachability)
  for (const tile of ['water', 'cliff', 'wall', 'rock', 'tree']) {
    assert.ok(!WALKABLE_TILE_TYPES.includes(tile), `${tile} must stay non-walkable`);
  }
  assert.ok(Object.isFrozen(WALKABLE_TILE_TYPES));
});

test('isTileType accepts every id in TILE_TYPES and nothing else', () => {
  for (const tile of TILE_TYPES) assert.equal(isTileType(tile), true, tile);
  assert.equal(isTileType('lava'), false);
  assert.equal(isTileType('Bridge'), false); // case-sensitive
  assert.equal(isTileType('cliff '), false); // no trimming
  for (const value of [null, undefined, 0, {}, ['grass']]) {
    assert.doesNotThrow(() => isTileType(value));
    assert.equal(isTileType(value), false, String(value));
  }
});

test('GENERATOR_VERSION is bumped to 1.1.0 for the bridge/stairs/cliff layout shape', () => {
  assert.equal(GENERATOR_VERSION, '1.1.0');
});

// --- typedef sanity: objects shaped per the documented @typedefs -----------

test('a Facility-shaped object built from the helpers satisfies its own contract', () => {
  for (const kind of FACILITY_KINDS) {
    const facility = deepFreeze({
      kind,
      present: true,
      count: 1,
      evidence: (() => {
        const evidence = makeEvidence();
        evidence.observed.push(`${kind} evidence`);
        return evidence;
      })()
    });
    assert.ok(isFacilityKind(facility.kind));
    assert.equal(typeof facility.present, 'boolean');
    assert.ok(Number.isInteger(facility.count) && facility.count >= 0);
    assert.deepEqual(Object.keys(facility.evidence), EVIDENCE_CLASSES);
    assert.ok(Object.isFrozen(facility));
    assert.ok(Object.isFrozen(facility.evidence));
  }
});

test('a ContractorReport-shaped object always carries the pending-inspection literal', () => {
  const report = deepFreeze({ source: 'claude-code', subject: 'fixed the login flow', status: 'pending-inspection' });
  assert.equal(report.status, 'pending-inspection');
  assert.equal(typeof report.source, 'string');
  assert.equal(typeof report.subject, 'string');
  // self-reports are never a synonym for "done": the only legal status literal is this one
  assert.notEqual(report.status, 'done');
  assert.notEqual(report.status, 'verified');
});

test('a Facility for an absent facility still carries at least one evidence entry as its reason', () => {
  const evidence = makeEvidence();
  evidence.unknown.push('no dock signal: no react-native/expo/electron/bin field detected');
  const facility = deepFreeze({ kind: 'dock', present: false, count: 0, evidence });
  assert.equal(facility.present, false);
  const totalEvidence = facility.evidence.observed.length + facility.evidence.inferred.length + facility.evidence.unknown.length;
  assert.ok(totalEvidence >= 1);
});

// --- grounding: facility-kind vocabulary never collides with building.kind --

test('FACILITY_KINDS never collides with the unrelated building.kind vocabulary from a real static scan', async () => {
  // inspectRepository only reads sample/tiny-town's files statically (AST parse via
  // scanner.mjs); it never executes any of the sample repo's own code. This grounds
  // the facility vocabulary against real inspection output without conflating the two
  // namespaces: building.kind is one of cli/service/interface/data/configuration/module/test,
  // which is a wholly different concern from a town FACILITY_KINDS id.
  const report = await inspectRepository(SAMPLE_REPO);
  assert.ok(report.city.buildings.length > 0, 'sample repo should yield at least one building');
  const buildingKinds = new Set(report.city.buildings.map((building) => building.kind));
  for (const buildingKind of buildingKinds) {
    assert.equal(isFacilityKind(buildingKind), false, `building.kind "${buildingKind}" must not double as a facility kind`);
    assert.ok(!FACILITY_KINDS.includes(buildingKind), `FACILITY_KINDS must not contain building.kind "${buildingKind}"`);
  }
});
