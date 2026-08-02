import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectRepository } from '../../../ship/10-inspect/index.mjs';

// T1 obligation: prevent customer source/hook/script execution and repository
// mutation while proving the accepted-root boundary, completion evidence, and
// truthful unknowns. Passing does not prove semantics, world generation,
// browser delivery, packaging, or the KGI journey.

async function fileSnapshot(filePath) {
  const stat = await fs.lstat(filePath);
  const bytes = await fs.readFile(filePath);
  return {
    mode: stat.mode,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.toString('base64'),
  };
}

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
  await fs.writeFile(path.join(root, 'trap.sh'), '#!/bin/sh\necho executed > SHOULD_NOT_EXIST\n', { mode: 0o755 });
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
    filesDiscovered: 5,
    filesInspected: 5,
    truncated: false,
  });
  assert.deepEqual(report.files.map((file) => file.path), [
    'package.json',
    'src/helper.mjs',
    'src/index.mjs',
    'tests/app.test.mjs',
    'trap.sh',
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
  assert.ok(report.evidence.observed.some((item) => item.id === 'repository.inspection.completed'));
  assert.ok(report.evidence.unknown.some((item) => item.id === 'repository.inspection.runtime.unknown'));
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(fixture.root), false);
  assert.equal(serialized.includes(fixture.outside), false);

  const again = await inspectRepository(fixture.root);
  assert.equal(JSON.stringify(again), serialized);
});

test('T1 rejects a symlink root, skips internal symlinks, and preserves bytes and metadata', async (t) => {
  const fixture = await makeFixture();
  const rootLink = `${fixture.root}-root-link`;
  t.after(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
    await fs.rm(fixture.outside, { recursive: true, force: true });
    await fs.rm(rootLink, { recursive: true, force: true });
  });

  const tracked = [path.join(fixture.root, 'package.json'), path.join(fixture.root, 'trap.sh')];
  const before = await Promise.all(tracked.map(fileSnapshot));
  const sentinel = path.join(fixture.root, 'SHOULD_NOT_EXIST');
  const report = await inspectRepository(fixture.root);
  assert.equal(report.files.some((file) => file.path === 'linked.js'), false);
  assert.equal(await fs.stat(sentinel).then(() => true, () => false), false);
  const after = await Promise.all(tracked.map(fileSnapshot));
  assert.deepEqual(after, before);

  await fs.symlink(fixture.root, rootLink);
  const rejected = await inspectRepository(rootLink);
  assert.equal(rejected.files.length, 0);
  assert.equal(rejected.evidence.observed.length, 0);
  assert.ok(rejected.evidence.unknown.some((entry) => entry.reason === 'repository-root-symlink'));
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
