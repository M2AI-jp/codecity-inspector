import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectionDigest, worldSeed } from '../../src/town/world-identity.mjs';

const SHA256_HEX = /^[0-9a-f]{64}$/;
const TINY_TOWN_SEED = '192d0f9672655df710e9adeebba1cc30869db3df440789b460e7d5e53c5f8558';
const EMPTY_UTF8_SEED = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('worldSeed is SHA-256 of the exact UTF-8 repository name', () => {
  assert.equal(worldSeed({ repository: { name: 'tiny-town' } }), TINY_TOWN_SEED);
  assert.match(worldSeed({ repository: { name: '街' } }), SHA256_HEX);
  assert.notEqual(worldSeed({ repository: { name: '街' } }), worldSeed({ repository: { name: 'town' } }));
});

test('worldSeed stays stable when the same repository name has different graph facts', () => {
  const before = {
    repository: { name: 'tiny-town' },
    graph: { nodes: [{ path: 'src/main.js', bytes: 10 }], edges: [] }
  };
  const after = {
    repository: { name: 'tiny-town' },
    graph: {
      nodes: [{ path: 'src/main.js', bytes: 99 }, { path: 'src/new.js', bytes: 1 }],
      edges: [{ from: 'src/main.js', to: 'src/new.js', status: 'resolved' }]
    }
  };
  assert.equal(worldSeed(before), TINY_TOWN_SEED);
  assert.equal(worldSeed(after), TINY_TOWN_SEED);
});

test('worldSeed changes when the repository name changes', () => {
  assert.notEqual(
    worldSeed({ repository: { name: 'tiny-town' } }),
    worldSeed({ repository: { name: 'other-town' } })
  );
});

test('worldSeed degrades malformed or inaccessible names to the empty UTF-8 string', () => {
  const throwing = {};
  Object.defineProperty(throwing, 'repository', { get() { throw new Error('inaccessible'); } });
  for (const input of [null, undefined, {}, { repository: null }, { repository: { name: 42 } }, throwing]) {
    assert.doesNotThrow(() => worldSeed(input));
    assert.equal(worldSeed(input), EMPTY_UTF8_SEED);
  }
});

test('inspectionDigest ignores recursive object insertion order', () => {
  const first = {
    inspection: {
      graph: { nodes: [{ path: 'src/a.js', bytes: 4 }], edges: [] },
      repository: { name: 'fixture' }
    },
    model: { facilities: [{ kind: 'gate', present: true }], summary: { files: 1, links: 0 } }
  };
  const reordered = {
    model: { summary: { links: 0, files: 1 }, facilities: [{ present: true, kind: 'gate' }] },
    inspection: {
      repository: { name: 'fixture' },
      graph: { edges: [], nodes: [{ bytes: 4, path: 'src/a.js' }] }
    }
  };
  assert.equal(inspectionDigest(first), inspectionDigest(reordered));
});

test('inspectionDigest preserves array order', () => {
  const forward = { facts: [{ id: 'a' }, { id: 'b' }] };
  const reversed = { facts: [{ id: 'b' }, { id: 'a' }] };
  assert.notEqual(inspectionDigest(forward), inspectionDigest(reversed));
});

test('inspectionDigest changes when a normalized generator input fact changes', () => {
  const observed = { facts: [{ id: 'unresolved-1', evidence: { observed: ['src/a.js'], inferred: [], unknown: [] } }] };
  const changed = { facts: [{ id: 'unresolved-1', evidence: { observed: ['src/b.js'], inferred: [], unknown: [] } }] };
  assert.notEqual(inspectionDigest(observed), inspectionDigest(changed));
});

test('inspectionDigest is deterministic and crash-free for malformed JSON-shaped input', () => {
  const cyclic = { id: 'cycle' };
  cyclic.self = cyclic;
  const throwingValue = {};
  Object.defineProperty(throwingValue, 'fact', { enumerable: true, get() { throw new Error('inaccessible'); } });
  const inputs = [
    null, undefined, 42, 'text', true, 1n, Symbol('x'), () => {},
    Number.NaN, Number.POSITIVE_INFINITY, new Date(0), cyclic, throwingValue,
    [1, , undefined, { z: 2, a: 1 }]
  ];
  for (const input of inputs) {
    let first;
    assert.doesNotThrow(() => { first = inspectionDigest(input); });
    assert.match(first, SHA256_HEX);
    assert.equal(inspectionDigest(input), first);
  }
});

test('inspectionDigest does not mutate frozen generator input', () => {
  const input = Object.freeze({
    z: Object.freeze([Object.freeze({ b: 2, a: 1 })]),
    a: Object.freeze({ y: false, x: true })
  });
  const before = JSON.stringify(input);
  assert.match(inspectionDigest(input), SHA256_HEX);
  assert.equal(JSON.stringify(input), before);
});

test('world identity implementation contains no clock, random, locale sort, or I/O dependency', async () => {
  const source = await readFile(new URL('../../src/town/world-identity.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localeCompare|Math\.random|Date\.now|new Date\s*\(/);
  assert.doesNotMatch(source, /node:(?:fs|http|https|net|child_process)/);
});
