export const inspectionReport = Object.freeze({
  schemaVersion: 1,
  repository: Object.freeze({ name: 'fixture-town', identity: 'fixture-identity' }),
  summary: Object.freeze({ filesDiscovered: 8, filesInspected: 8, truncated: false }),
  files: Object.freeze([
    Object.freeze({ id: 'file-main', path: 'src/main.js', kind: 'source', extension: '.js', sizeBytes: 21, isTest: false }),
    Object.freeze({ id: 'file-service', path: 'src/services/accounts.service.js', kind: 'source', extension: '.js', sizeBytes: 42, isTest: false }),
    Object.freeze({ id: 'file-api', path: 'src/api/accounts.route.js', kind: 'source', extension: '.js', sizeBytes: 42, isTest: false }),
    Object.freeze({ id: 'file-data', path: 'src/data/accounts.sql', kind: 'data', extension: '.sql', sizeBytes: 42, isTest: false }),
    Object.freeze({ id: 'file-config', path: 'config/app.yaml', kind: 'configuration', extension: '.yaml', sizeBytes: 42, isTest: false }),
    Object.freeze({ id: 'file-test', path: 'tests/accounts.test.js', kind: 'test', extension: '.js', sizeBytes: 42, isTest: true }),
    Object.freeze({ id: 'file-tool', path: 'tools/release-cli.js', kind: 'tooling', extension: '.js', sizeBytes: 42, isTest: false }),
    Object.freeze({ id: 'file-plain', path: 'src/math.js', kind: 'source', extension: '.js', sizeBytes: 42, isTest: false }),
  ]),
  graph: Object.freeze({
    nodes: Object.freeze([
      Object.freeze({ id: 'file-main', path: 'src/main.js', kind: 'file' }),
      Object.freeze({ id: 'file-api', path: 'src/api/accounts.route.js', kind: 'file' }),
      Object.freeze({ id: 'external-api', kind: 'external', specifier: 'https://api.example.test' }),
    ]),
    edges: Object.freeze([
      Object.freeze({ id: 'edge-http', from: 'file-api', to: 'external-api', kind: 'http' }),
      Object.freeze({ id: 'edge-internal', from: 'file-main', to: 'file-api', kind: 'imports' }),
    ]),
    entrypoints: Object.freeze(['file-main']),
  }),
  manifests: Object.freeze([]),
  evidence: Object.freeze({
    observed: Object.freeze([
      Object.freeze({ id: 'inspection.repository.identity', claim: 'identity', subject: 'repository', value: 'fixture-identity' }),
      Object.freeze({ id: 'inspection.config.present', claim: 'configuration', subject: 'file-config' }),
    ]),
    inferred: Object.freeze([]),
    unknown: Object.freeze([]),
  }),
});
