// test/town/rng.test.mjs
//
// Coverage for src/town/rng.mjs — the ONLY randomness source for the
// "habitable town" spatial subsystem. Verifies:
//   - makeRng determinism: identical seed => identical next()/int()/pick()/
//     shuffle()/chance() sequence, across independent instances, forever.
//   - int/pick/shuffle bounds, non-mutation of caller-supplied arrays, and
//     the documented throw behavior for programming-error inputs.
//   - repoFingerprint: stable across repeated calls, independent of
//     graph.nodes array order, independent of the graph.nodes/city.buildings
//     source split, and crash-proof (never throws) on malformed inspection
//     input.
//   - defaultSeed: reproducible and identical to repoFingerprint.
//
// SAFETY: the only function here that ever touches sample/tiny-town is
// inspectRepository, a read-only static scanner (same pattern as
// test/town/detect.test.mjs). This file never imports, requires, or
// otherwise runs anything under sample/tiny-town/src or
// sample/tiny-town/test.

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng, repoFingerprint, defaultSeed } from '../../src/town/rng.mjs';
import { inspectRepository } from '../../src/inspector.mjs';

const SAMPLE_REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../sample/tiny-town');

/** @param {Array<{path:string,bytes:number}>} nodes */
function inspectionFrom(nodes) {
  return { graph: { nodes } };
}

// --- makeRng: shape -----------------------------------------------------

test('makeRng returns a frozen Rng object exposing next/int/pick/shuffle/chance', () => {
  const rng = makeRng('shape-seed');
  assert.ok(Object.isFrozen(rng));
  for (const name of ['next', 'int', 'pick', 'shuffle', 'chance']) {
    assert.equal(typeof rng[name], 'function', `expected rng.${name} to be a function`);
  }
});

// --- makeRng: determinism -------------------------------------------------

test('same seed produces the identical next() stream across independent instances', () => {
  const a = makeRng('town-42');
  const b = makeRng('town-42');
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('same seed produces identical mixed int/pick/shuffle/chance sequences', () => {
  function run(seed) {
    const rng = makeRng(seed);
    return [
      rng.int(0, 100),
      rng.pick(['a', 'b', 'c', 'd', 'e']),
      rng.shuffle([1, 2, 3, 4, 5]),
      rng.chance(0.5),
      rng.int(-10, 10),
      rng.next()
    ];
  }
  assert.deepEqual(run('replay-seed'), run('replay-seed'));
});

test('different seeds produce different next() streams', () => {
  const a = makeRng('seed-one');
  const b = makeRng('seed-two');
  const seqA = Array.from({ length: 10 }, () => a.next());
  const seqB = Array.from({ length: 10 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test('non-string seeds are coerced deterministically (finite number -> String, nullish -> "")', () => {
  assert.equal(makeRng(42).next(), makeRng('42').next());
  assert.equal(makeRng(undefined).next(), makeRng('').next());
  assert.equal(makeRng(null).next(), makeRng('').next());
});

test('makeRng never throws, even on odd seed input', () => {
  for (const seed of [42, undefined, null, {}, [], true, Symbol('x')]) {
    assert.doesNotThrow(() => makeRng(seed).next());
  }
});

// --- int: bounds + throw contract -----------------------------------------

test('int is inclusive on both ends and hits every value across many draws', () => {
  const rng = makeRng('int-coverage');
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(rng.int(1, 5));
  assert.deepEqual([...seen].sort((x, y) => x - y), [1, 2, 3, 4, 5]);
});

test('int stays within [min,max] and always returns an integer, across varied ranges', () => {
  const rng = makeRng('int-bounds');
  for (let i = 0; i < 200; i++) {
    const v = rng.int(-3, 3);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= -3 && v <= 3, `${v} out of range [-3,3]`);
  }
  // a single-value range always returns that value
  for (let i = 0; i < 10; i++) assert.equal(rng.int(7, 7), 7);
});

test('int throws TypeError on non-finite bounds (NaN/Infinity)', () => {
  const rng = makeRng('int-throws-type');
  assert.throws(() => rng.int(NaN, 5), TypeError);
  assert.throws(() => rng.int(0, Infinity), TypeError);
  assert.throws(() => rng.int(-Infinity, 0), TypeError);
});

test('int throws RangeError on an empty, reversed, or no-integer range', () => {
  const rng = makeRng('int-throws-range');
  assert.throws(() => rng.int(0, -1), RangeError);
  assert.throws(() => rng.int(5, 4), RangeError);
  assert.throws(() => rng.int(1.2, 1.8), RangeError);
});

test('int consumes exactly one next() draw', () => {
  const reference = makeRng('int-consume');
  reference.next(); // draw #1, stands in for whatever int() will consume
  const expected = reference.next(); // draw #2

  const underTest = makeRng('int-consume');
  underTest.int(0, 999); // must consume exactly draw #1
  const actual = underTest.next(); // draw #2

  assert.equal(actual, expected);
});

// --- pick: bounds + non-mutation -------------------------------------------

test('pick always returns an element that belongs to the input array', () => {
  const rng = makeRng('pick-basic');
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 50; i++) assert.ok(items.includes(rng.pick(items)));
});

test('pick draws every element across enough draws (coverage, not strict uniformity)', () => {
  const rng = makeRng('pick-coverage');
  const items = ['w', 'x', 'y', 'z'];
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(rng.pick(items));
  assert.deepEqual([...seen].sort(), [...items].sort());
});

test('pick throws RangeError on an empty array or a non-array input', () => {
  const rng = makeRng('pick-throws');
  assert.throws(() => rng.pick([]), RangeError);
  assert.throws(() => rng.pick(null), RangeError);
  assert.throws(() => rng.pick(undefined), RangeError);
  assert.throws(() => rng.pick('abc'), RangeError);
});

test('pick never mutates the input array', () => {
  const rng = makeRng('pick-nomutate');
  const items = Object.freeze(['p', 'q', 'r']);
  for (let i = 0; i < 20; i++) rng.pick(items); // would throw on any attempted write, since frozen
  assert.deepEqual(items, ['p', 'q', 'r']);
});

// --- shuffle: new array, non-mutation, multiset preservation ---------------

test('shuffle returns a NEW array and never mutates the input, even when frozen', () => {
  const rng = makeRng('shuffle-nomutate');
  const input = Object.freeze([1, 2, 3, 4, 5]);
  const out = rng.shuffle(input);
  assert.notEqual(out, input);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
});

test('shuffle preserves the multiset of elements (including duplicates) and length', () => {
  const rng = makeRng('shuffle-multiset');
  const input = [5, 3, 3, 1, 9, 9, 9];
  const out = rng.shuffle(input);
  assert.equal(out.length, input.length);
  assert.deepEqual(out.slice().sort(), input.slice().sort());
});

test('shuffle of an empty or single-element array returns an equivalent new array without throwing', () => {
  const rng = makeRng('shuffle-edge');
  assert.deepEqual(rng.shuffle([]), []);
  assert.deepEqual(rng.shuffle([1]), [1]);
});

test('shuffle throws TypeError on non-array input', () => {
  const rng = makeRng('shuffle-throws');
  assert.throws(() => rng.shuffle('not-an-array'), TypeError);
  assert.throws(() => rng.shuffle(null), TypeError);
  assert.throws(() => rng.shuffle(undefined), TypeError);
  assert.throws(() => rng.shuffle(42), TypeError);
});

test('shuffle is deterministic: same seed and identical prior draw history => identical result', () => {
  const a = makeRng('shuffle-determinism');
  const b = makeRng('shuffle-determinism');
  assert.deepEqual(a.shuffle([1, 2, 3, 4, 5, 6, 7, 8]), b.shuffle([1, 2, 3, 4, 5, 6, 7, 8]));
});

// --- chance: probability + fixed draw cost ----------------------------------

test('chance(0) is always false and chance(1) is always true, regardless of stream position', () => {
  const rng = makeRng('chance-extremes');
  for (let i = 0; i < 20; i++) {
    assert.equal(rng.chance(0), false);
    assert.equal(rng.chance(1), true);
  }
});

test('chance always consumes exactly one next() draw, so toggling p never desyncs the stream', () => {
  const seed = 'chance-consume';
  const reference = makeRng(seed);
  reference.next(); // draw #1, stands in for whatever chance() will consume
  const expected = reference.next(); // draw #2

  for (const p of [0, 1, 0.5, NaN, -5, 5]) {
    const underTest = makeRng(seed);
    underTest.chance(p); // must consume exactly draw #1, regardless of p
    assert.equal(underTest.next(), expected, `chance(${p}) desynced the stream`);
  }
});

// --- repoFingerprint: shape + stability -------------------------------------

test('repoFingerprint returns a 64-char lowercase hex sha256 digest', () => {
  const inspection = inspectionFrom([{ path: 'src/a.mjs', bytes: 10 }, { path: 'src/b.mjs', bytes: 20 }]);
  assert.match(repoFingerprint(inspection), /^[0-9a-f]{64}$/);
});

test('repoFingerprint is stable across repeated calls on the same inspection', () => {
  const inspection = inspectionFrom([{ path: 'a.mjs', bytes: 1 }, { path: 'b.mjs', bytes: 2 }]);
  assert.equal(repoFingerprint(inspection), repoFingerprint(inspection));
});

test('repoFingerprint is independent of graph.nodes array order', () => {
  const nodes = [{ path: 'a.mjs', bytes: 1 }, { path: 'b.mjs', bytes: 2 }, { path: 'c.mjs', bytes: 3 }];
  const reordered = [nodes[2], nodes[0], nodes[1]];
  assert.equal(repoFingerprint(inspectionFrom(nodes)), repoFingerprint(inspectionFrom(reordered)));
});

test('repoFingerprint changes when the byte count or path set changes', () => {
  const baseline = repoFingerprint(inspectionFrom([{ path: 'a.mjs', bytes: 1 }]));
  assert.notEqual(baseline, repoFingerprint(inspectionFrom([{ path: 'a.mjs', bytes: 2 }])));
  assert.notEqual(baseline, repoFingerprint(inspectionFrom([{ path: 'b.mjs', bytes: 1 }])));
});

test('repoFingerprint falls back to city.buildings when graph.nodes is absent or empty, matching an equivalent graph.nodes source', () => {
  const viaGraph = repoFingerprint({ graph: { nodes: [{ path: 'x.mjs', bytes: 5 }] } });
  const viaCityNoGraph = repoFingerprint({ city: { buildings: [{ path: 'x.mjs', bytes: 5 }] } });
  const viaCityEmptyGraph = repoFingerprint({ graph: { nodes: [] }, city: { buildings: [{ path: 'x.mjs', bytes: 5 }] } });
  assert.equal(viaGraph, viaCityNoGraph);
  assert.equal(viaGraph, viaCityEmptyGraph);
});

test('repoFingerprint degrades gracefully (never throws) on malformed/empty inspection input, all sharing the stable empty-set digest', () => {
  const emptyDigest = repoFingerprint({});
  for (const bad of [null, undefined, 'not-an-object', 42, [], { graph: {} }, { graph: { nodes: 'nope' } }, { graph: { nodes: [null, 42, 'x'] } }]) {
    assert.doesNotThrow(() => repoFingerprint(bad));
    assert.equal(repoFingerprint(bad), emptyDigest, `expected empty-set digest for ${JSON.stringify(bad)}`);
  }
});

test('repoFingerprint drops entries with no usable string path', () => {
  const withJunk = inspectionFrom([
    { path: 'a.mjs', bytes: 5 },
    { path: 42, bytes: 5 },   // dropped: non-string path
    { bytes: 5 },              // dropped: missing path
    null,                      // dropped: not a plain object
    { path: '', bytes: 5 }     // dropped: empty-string path
  ]);
  const clean = inspectionFrom([{ path: 'a.mjs', bytes: 5 }]);
  assert.equal(repoFingerprint(withJunk), repoFingerprint(clean));
});

test('repoFingerprint normalizes bytes like normalizeCount (truncate toward zero, floor at 0)', () => {
  const fractional = repoFingerprint(inspectionFrom([{ path: 'a.mjs', bytes: 5.9 }]));
  const whole = repoFingerprint(inspectionFrom([{ path: 'a.mjs', bytes: 5 }]));
  assert.equal(fractional, whole);

  const negative = repoFingerprint(inspectionFrom([{ path: 'a.mjs', bytes: -5 }]));
  const zero = repoFingerprint(inspectionFrom([{ path: 'a.mjs', bytes: 0 }]));
  assert.equal(negative, zero);

  const malformed = repoFingerprint(inspectionFrom([{ path: 'a.mjs', bytes: 'not-a-number' }]));
  assert.equal(malformed, zero);
});

test('repoFingerprint is stable and independent of node order on a real inspectRepository() run (sample/tiny-town)', async () => {
  const inspection = await inspectRepository(SAMPLE_REPO);
  const first = repoFingerprint(inspection);
  const second = repoFingerprint(inspection);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);

  const reordered = { ...inspection, graph: { ...inspection.graph, nodes: [...inspection.graph.nodes].reverse() } };
  assert.equal(repoFingerprint(reordered), first);
});

// --- defaultSeed -------------------------------------------------------------

test('defaultSeed equals repoFingerprint for the same inspection', () => {
  const inspection = inspectionFrom([{ path: 'a.mjs', bytes: 1 }, { path: 'b.mjs', bytes: 2 }]);
  assert.equal(defaultSeed(inspection), repoFingerprint(inspection));
});

test('defaultSeed is reproducible across repeated calls', () => {
  const inspection = inspectionFrom([{ path: 'a.mjs', bytes: 1 }]);
  assert.equal(defaultSeed(inspection), defaultSeed(inspection));
});

test('defaultSeed on a real inspectRepository() run matches repoFingerprint (sample/tiny-town)', async () => {
  const inspection = await inspectRepository(SAMPLE_REPO);
  assert.equal(defaultSeed(inspection), repoFingerprint(inspection));
});

test('defaultSeed feeds makeRng deterministically end-to-end (same inspection => identical downstream stream)', () => {
  const inspection = inspectionFrom([{ path: 'src/x.mjs', bytes: 100 }, { path: 'src/y.mjs', bytes: 200 }]);
  const rngA = makeRng(defaultSeed(inspection));
  const rngB = makeRng(defaultSeed(inspection));
  assert.deepEqual(Array.from({ length: 20 }, () => rngA.next()), Array.from({ length: 20 }, () => rngB.next()));
});
