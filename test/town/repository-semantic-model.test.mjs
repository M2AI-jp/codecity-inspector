import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeRepositorySemanticModel,
  REPOSITORY_SEMANTIC_ROLES
} from '../../src/town/repository-semantic-model.mjs';

function inspectionFixture() {
  return {
    city: {
      buildings: [
        { id: 'file.server', path: 'src/server.mjs', kind: 'module', isTest: false },
        { id: 'file.legacy', path: 'src/legacy.mjs', kind: 'module', isTest: false },
        { id: 'file.test', path: 'test/server.test.mjs', kind: 'module', isTest: true }
      ]
    },
    graph: {
      nodes: [
        { path: 'src/server.mjs' },
        { path: 'src/legacy.mjs' },
        { path: 'test/server.test.mjs' }
      ]
    }
  };
}

test('normalizes candidate roles only for inspected files and preserves evidence classes', () => {
  const model = normalizeRepositorySemanticModel({
    inspection: inspectionFixture(),
    annotations: [{
      fileId: 'file.server',
      role: 'service',
      evidence: {
        observed: [],
        inferred: ['inspection.file.kind', 'semantic.llm.service'],
        unknown: ['runtime.service.behavior']
      }
    }]
  });

  assert.equal(Object.isFrozen(model), true);
  assert.deepEqual(model.files.find(({ path }) => path === 'src/server.mjs'), {
    fileId: 'file.server',
    path: 'src/server.mjs',
    role: 'service',
    source: 'candidate',
    evidence: {
      observed: [],
      inferred: ['inspection.file.kind', 'semantic.llm.service'],
      unknown: ['runtime.service.behavior']
    }
  });
  assert.equal(model.files.find(({ path }) => path === 'src/legacy.mjs').role, 'module');
  assert.equal(model.files.find(({ path }) => path === 'test/server.test.mjs').role, 'test');
  assert.ok(model.files.filter(({ source }) => source === 'heuristic')
    .every(({ evidence }) => evidence.observed.length === 0 && evidence.inferred.length === 1));
});

test('rejects hallucinated files, duplicate annotations, unsupported roles, and placement fields', () => {
  const inspection = inspectionFixture();
  assert.throws(() => normalizeRepositorySemanticModel({
    inspection,
    annotations: [{ path: 'src/invented.mjs', role: 'service' }]
  }), /not present in the inspection/);
  assert.throws(() => normalizeRepositorySemanticModel({
    inspection,
    annotations: [
      { path: 'src/server.mjs', role: 'service' },
      { fileId: 'file.server', role: 'module' }
    ]
  }), /duplicates/);
  assert.throws(() => normalizeRepositorySemanticModel({
    inspection,
    annotations: [{ path: 'src/server.mjs', role: 'castle' }]
  }), /role is not supported/);
  assert.throws(() => normalizeRepositorySemanticModel({
    inspection,
    annotations: [{ path: 'src/server.mjs', role: 'service', x: 4 }]
  }), /cannot define placement or game behavior/);
  assert.throws(() => normalizeRepositorySemanticModel({
    inspection,
    annotations: [{
      path: 'src/server.mjs',
      role: 'service',
      evidence: { observed: ['llm.claim'], inferred: [], unknown: [] }
    }]
  }), /only the inspector may assert observed facts/);
});

test('heuristic fallback is deterministic and uses only the closed role vocabulary', () => {
  const first = normalizeRepositorySemanticModel({ inspection: inspectionFixture() });
  const second = normalizeRepositorySemanticModel({ inspection: inspectionFixture() });
  assert.deepEqual(second, first);
  assert.ok(first.files.every(({ role }) => REPOSITORY_SEMANTIC_ROLES.includes(role)));
});
