import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseOverlay, validateOverlay, readOverlay, MAX_BYTES } from '../src/overlay/read.mjs';
import { defaultManifest } from '../src/overlay/place.mjs';
import { fixture, record, parsed } from './helpers/overlay-fixtures.mjs';

const manifest = defaultManifest();

test('overlay: bounded local file, malformed JSON, version and CLI exit codes', (t) => {
  const dir = fixture(t), file = join(dir, 'overlay.json');
  for (const [input, reason] of [['{', /JSON/], ['{"version":2}', /version/], ['x'.repeat(MAX_BYTES + 1), /1,000,000/]]) {
    writeFileSync(file, input);
    assert.throws(() => readOverlay(file), reason);
    const run = spawnSync(process.execPath, ['codecity.mjs', dir, '--overlay', file, '--json', join(dir, 'town.json')], { encoding: 'utf8' });
    assert.equal(run.status, 1); assert.match(run.stderr, reason);
  }
  const valid = '{"version":1}';
  assert.equal(parseOverlay(valid + ' '.repeat(MAX_BYTES - Buffer.byteLength(valid))).version, 1);
  assert.throws(() => readOverlay('https://example.invalid/overlay.json'), /local/);
  assert.throws(() => readOverlay(dir), /regular file/);
  assert.throws(() => validateOverlay({ version: 1, seed: 2 }), /seed/);
  assert.throws(() => parseOverlay(Buffer.concat([Buffer.from('{"version":1,"source":{"name":"'), Buffer.from([0xff]), Buffer.from('"}}')])), /JSON/);
});

test('overlay: code point limits and excess entries have explicit diagnostics', () => {
  const a = record('ok'); a.label = '😀'.repeat(60); a.lines = Array(6).fill('😀'.repeat(80));
  assert.equal(parsed({ markers: [a] }).markers.length, 1);
  const fields = { markers: [
    { ...a, id: 'label', label: a.label + '字' },
    { ...a, id: 'line', lines: ['😀'.repeat(81)] },
    { ...a, id: 'count', lines: Array(7).fill('字') },
  ], people: [{ id: 'person', name: '字'.repeat(61), at: { building: 'b1' } }],
  title: { text: 'title', sub: '😀'.repeat(81) } };
  const result = parsed(fields);
  assert.equal(result.markers.length, 0); assert.equal(result.people.length, 0); assert.equal(result.rejected.length, 5);
  const caps = parsed({ markers: Array.from({ length: 2001 }, (_, i) => record(`r${i}`)),
    people: Array.from({ length: 101 }, (_, i) => ({ id: `p${i}`, name: '人', at: { group: 'empty' } })) });
  assert.equal(caps.markers.length, 2000); assert.equal(caps.people.length, 100);
  assert.deepEqual(caps.rejected.map((r) => r.reason), ['markers limit: 2000', 'people limit: 100']);
});

test('overlay: namespace, critical groups, invalid at and producer diagnostics', () => {
  const result = parsed({ groups: [{ id: 'same', paths: [] }], markers: [record('same')],
    people: [{ id: 'same', name: 'duplicate', at: { group: 'same' } }],
    goal: { label: 'end', at: { landmark: 'town_hall' } }, unplaced: [{ id: 'producer', reason: 'ignore' }] });
  assert.equal(result.markers.length, 1); assert.equal(result.rejected[0].reason, 'duplicate id');
  assert.equal(result.goal.id, '$goal'); assert.equal(result.unplaced, undefined);
  for (const groups of [[{ id: 'g', paths: ['../escape'] }], [{ id: 'g', paths: [] }, { id: 'g', paths: [] }]]) {
    assert.throws(() => parsed({ groups }), /group/);
  }
  assert.throws(() => parsed({ seed: 'x'.repeat(MAX_BYTES) }), /seed and groups/);
  const invalid = parsed({ markers: [{ ...record('bad'), at: { marker: 'other' } }, { ...record('bad2'), at: { path: '/etc/passwd' } }] });
  assert.equal(invalid.rejected.length, 2);
});
