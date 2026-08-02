import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectRepository } from '../../../ship/10-inspect/index.mjs';

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codecity-inspect-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.mkdir(path.join(root, 'vendor'), { recursive: true });
  await fs.mkdir(path.join(root, 'generated'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-town',
    version: '1.0.0',
    scripts: { test: 'node tests/app.test.mjs' },
    dependencies: { zeta: '^1.0.0' },
  }));
  await fs.writeFile(path.join(root, 'src', 'index.mjs'), "import { helper } from './helper.mjs';\nexport { helper };\n");
  await fs.writeFile(path.join(root, 'src', 'helper.mjs'), "export const helper = 1;\nimport external from 'outside-package';\nimport './missing.mjs';\nvoid external;\n");
  await fs.writeFile(path.join(root, 'tests', 'app.test.mjs'), 'assert(true);\n');
  await fs.writeFile(path.join(root, 'vendor', 'secret.js'), 'throw new Error(\'must not be read\');\n');
  await fs.writeFile(path.join(root, 'generated', 'output.js'), 'throw new Error(\'must not be read\');\n');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'codecity-inspect-outside-'));
  await fs.writeFile(path.join(outside, 'secret.js'), 'not part of fixture\n');
  await fs.symlink(path.join(outside, 'secret.js'), path.join(root, 'linked.js'));
  return { root, outside };
}

test('inspectRepository returns a stable, path-relative v1 report', async (t) => {
  const fixture = await makeFixture();
  t.after(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
    await fs.rm(fixture.outside, { recursive: true, force: true });
  });

  const report = await inspectRepository(fixture.root);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.repository.name.startsWith('codecity-inspect-'), true);
  assert.equal(report.repository.identity, report.repository.name);
  assert.deepEqual(report.summary, {
    filesDiscovered: 4,
    filesInspected: 4,
    truncated: false,
  });
  assert.deepEqual(report.files.map((file) => file.path), [
    'package.json',
    'src/helper.mjs',
    'src/index.mjs',
    'tests/app.test.mjs',
  ]);
  assert.equal(report.files.find((file) => file.path === 'tests/app.test.mjs').isTest, true);
  assert.equal(report.manifests[0].dependencies.zeta, '^1.0.0');
  assert.ok(report.graph.entrypoints.includes('file:src/index.mjs'));
  assert.ok(report.graph.edges.some((edge) => edge.specifier === './helper.mjs'));
  assert.ok(report.graph.edges.some((edge) => edge.specifier === 'outside-package'));
  assert.ok(report.graph.edges.some((edge) => edge.specifier === './missing.mjs' && edge.status === 'unresolved'));
  assert.ok(report.evidence.unknown.some((item) => item.path === 'vendor'));
  assert.ok(report.evidence.unknown.some((item) => item.path === 'generated'));
  assert.ok(report.evidence.unknown.some((item) => item.path === 'linked.js'));
  assert.ok(report.evidence.unknown.some((item) => item.reason === 'relative-import-unresolved'));
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(fixture.root), false);
  assert.equal(serialized.includes(fixture.outside), false);

  const again = await inspectRepository(fixture.root);
  assert.equal(JSON.stringify(again), serialized);
});

test('inspection stops at explicit bounds and reports the unread remainder as unknown', async (t) => {
  const fixture = await makeFixture();
  t.after(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
    await fs.rm(fixture.outside, { recursive: true, force: true });
  });

  const report = await inspectRepository(fixture.root, {
    maxFiles: 2,
    maxFileBytes: 64,
    maxTotalBytes: 64,
  });
  assert.equal(report.summary.truncated, true);
  assert.equal(report.files.length, 2);
  assert.ok(report.evidence.unknown.some((item) => item.reason === 'file-limit' || item.reason === 'total-byte-limit'));
});

test('invalid roots produce an unknown report rather than executing anything', async () => {
  const report = await inspectRepository(path.join(os.tmpdir(), 'codecity-inspect-does-not-exist'));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.files.length, 0);
  assert.equal(report.evidence.observed.length, 0);
  assert.equal(report.evidence.unknown[0].state, 'unknown');
});

test('local-path git remotes never become serialized repository identities', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codecity-inspect-local-origin-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.git'));
  await fs.writeFile(path.join(root, '.git', 'config'), '[remote "origin"]\n\turl = file:///Users/private/project.git\n');
  await fs.writeFile(path.join(root, 'index.mjs'), 'export {};\n');

  const report = await inspectRepository(root);
  assert.equal(report.repository.identity, path.basename(root));
  assert.doesNotMatch(JSON.stringify(report), /\/Users\/private/u);
  assert.ok(report.evidence.inferred.some((entry) => entry.claim === 'repository.identity'));
});
