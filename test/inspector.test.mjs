import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInspection } from '../src/inspector.mjs';

function baseScan({ entrypoints = [{ path: 'src/a.js', evidence: 'package.json:main' }] } = {}) {
  return {
    schemaVersion: 1,
    repository: { name: 'fixture' },
    summary: { filesDiscovered: 4, filesScanned: 4, bytesRead: 100, omittedFiles: 0, truncated: false },
    nodes: [
      { id: 'src/a.js', path: 'src/a.js', bytes: 20, kind: 'module', isTest: false },
      { id: 'src/b.js', path: 'src/b.js', bytes: 20, kind: 'module', isTest: false },
      { id: 'src/lonely.js', path: 'src/lonely.js', bytes: 20, kind: 'module', isTest: false },
      { id: 'test/a.test.js', path: 'test/a.test.js', bytes: 40, kind: 'test', isTest: true }
    ],
    edges: [
      { from: 'src/a.js', to: 'src/b.js', targetHint: null, kind: 'import', status: 'resolved' },
      { from: 'src/b.js', to: 'src/a.js', targetHint: null, kind: 'import', status: 'resolved' },
      { from: 'test/a.test.js', to: 'src/a.js', targetHint: null, kind: 'import', status: 'resolved' },
      { from: 'src/b.js', to: null, targetHint: 'src/missing.js', kind: 'import', status: 'unresolved' },
      { from: 'src/a.js', to: null, targetHint: null, kind: 'import', status: 'outside-root' },
      { from: 'src/a.js', to: null, targetHint: null, kind: 'dynamic-import', status: 'runtime-unknown' },
      { from: 'src/a.js', to: null, targetHint: null, kind: 'import', status: 'alias-unknown' },
      { from: 'src/a.js', to: null, targetHint: null, kind: 'import', status: 'unsupported' }
    ],
    entrypoints,
    skips: [],
    skipCounts: {},
    limitations: ['Static evidence only.']
  };
}

test('separates observed link failures, inferred cycles/tests, and unknown behavior', () => {
  const report = buildInspection(baseScan());
  assert.equal(report.summary.unresolvedLinks, 1);
  assert.equal(report.summary.cycles, 1);
  assert.deepEqual(report.inspection.inferred.cycles[0].members, ['src/a.js', 'src/b.js']);
  assert.deepEqual(report.inspection.inferred.testAssociations, [
    { source: 'src/a.js', test: 'test/a.test.js', evidence: 'test-directly-imports-source' }
  ]);
  assert.equal(report.inspection.inferred.reachability['src/b.js'], 'reachable');
  assert.equal(report.inspection.inferred.reachability['src/lonely.js'], 'not-reached-from-known-entrypoints');
  assert.equal(report.city.buildings.find((building) => building.id === 'src/b.js').state, 'unresolved-link');
  assert.notEqual(report.city.buildings.find((building) => building.id === 'src/a.js').state, 'unresolved-link');
  assert.equal(report.city.buildings.find((building) => building.id === 'src/lonely.js').state, 'unverified');
  assert.deepEqual(report.inspection.unknownDependencies.map((edge) => edge.status), [
    'outside-root', 'runtime-unknown', 'alias-unknown', 'unsupported'
  ]);
  assert.match(report.inspection.unknown.join(' '), /unverified, not broken/i);
});

test('does not invent reachability when no package entrypoint was resolved', () => {
  const report = buildInspection(baseScan({ entrypoints: [] }));
  assert.ok(Object.values(report.inspection.inferred.reachability).every((state) => state === 'unknown'));
  assert.match(report.inspection.unknown.join(' '), /reachability is unknown/i);
});
