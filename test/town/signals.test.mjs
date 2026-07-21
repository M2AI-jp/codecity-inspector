// test/town/signals.test.mjs
//
// Contract tests for src/town/signals.mjs: collectSignals(repoPath, options)
// and signalDefaults. Exercises three kinds of repository:
//   1. sample/tiny-town  - the project's real, checked-in fixture repo
//      (a package.json with no infra deps at all -> every derived signal
//      should read absent, not fabricated).
//   2. this project's own repo root - a real package.json with a bin field,
//      scripts, and a CI workflow, read via the same read-only path.
//   3. a synthetic mkdtemp fixture - the only way to exercise the dependency
//      -name matcher tables (llmSdks, dbDeps, ...), file probes, docker-
//      compose's .yaml variant, workflow listing/sorting/capping, and the
//      git-reflog contractor-report parser with fully known inputs, since
//      neither real repo above has these deps or a synthetic reflog.
//   4. a path that does not exist on disk at all.
//
// SAFETY: every fixture here is inert JSON/YAML/text data written by this
// test file itself (via node:fs/promises), never executable code, and this
// file never imports or runs anything from sample/tiny-town/src.

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { collectSignals, signalDefaults } from '../../src/town/signals.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const SAMPLE_REPO = path.join(REPO_ROOT, 'sample', 'tiny-town');

const EMPTY_PACKAGE_JSON_SIGNALS = {
  present: false,
  name: null,
  private: false,
  dependencies: {},
  devDependencies: {},
  scripts: {},
  bin: null,
  main: null,
  module: null,
  exports: null,
  files: null,
  publishConfig: null,
  engines: null
};

const ABSENT_FILE_SIGNALS = {
  env: false,
  envExample: false,
  envLocal: false,
  npmrc: false,
  dockerfile: false,
  dockerCompose: false,
  githubWorkflows: false,
  githubWorkflowFiles: [],
  wranglerToml: false,
  vercelJson: false,
  netlifyToml: false,
  appJson: false,
  procfile: false,
  prismaSchema: false
};

/**
 * A from-scratch temp repo exercising every matcher/probe path that neither
 * sample/tiny-town nor this project's own package.json happens to hit:
 * exact/scope/prefix dependency matching across every category, a script
 * name carrying a "webhook" hint, the docker-compose ".yaml" variant, a
 * symlinked probe file (must read as absent), sorted+capped workflow
 * filenames, and a synthetic .git/logs/HEAD reflog covering every
 * contractor-detection branch (author match, subject-fallback match, the
 * "\bbot\b" word-boundary match, a non-contractor line, and a malformed
 * line that must be skipped rather than thrown on).
 * @returns {Promise<string>} the fixture repo root
 */
async function buildRichFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codecity-signals-'));

  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-app',
    private: false,
    main: './index.js',
    bin: 'bin/cli.js',
    dependencies: {
      express: '^4.18.0',
      '@anthropic-ai/sdk': '^1.0.0',
      pg: '^8.11.0',
      dotenv: '^16.0.0'
    },
    devDependencies: {
      stripe: '^10.0.0',
      pino: '^8.0.0',
      'react-native': '^0.70.0',
      '@sentry/node': '^7.0.0',
      'expo-router': '^1.0.0'
    },
    scripts: {
      build: 'tsc',
      'test:unit': 'node --test',
      start: 'node server.js',
      lint: 'eslint .',
      'webhook:deploy': 'echo deploy'
    },
    engines: { node: '>=20' }
  }));

  await writeFile(path.join(root, '.env'), 'SECRET=1\n');
  await writeFile(path.join(root, '.env.example'), 'SECRET=\n');
  await writeFile(path.join(root, '.npmrc'), 'save-exact=true\n');
  await writeFile(path.join(root, 'Dockerfile'), 'FROM node:20\n');
  await writeFile(path.join(root, 'docker-compose.yaml'), 'services: {}\n');
  await writeFile(path.join(root, 'wrangler.toml'), 'name = "fixture"\n');
  await writeFile(path.join(root, 'vercel.json'), '{}\n');
  // netlify.toml is a symlink, never a regular file: this probe must read false.
  await symlink(path.join(root, 'vercel.json'), path.join(root, 'netlify.toml'));
  await mkdir(path.join(root, 'prisma'), { recursive: true });
  await writeFile(path.join(root, 'prisma', 'schema.prisma'), 'datasource db { provider = "postgresql" }\n');

  await mkdir(path.join(root, '.github', 'workflows', 'nested'), { recursive: true });
  await writeFile(path.join(root, '.github', 'workflows', 'b.yml'), 'name: b\n');
  await writeFile(path.join(root, '.github', 'workflows', 'a.yaml'), 'name: a\n');
  await writeFile(path.join(root, '.github', 'workflows', 'deploy.yml'), 'name: deploy\n');
  await writeFile(path.join(root, '.github', 'workflows', 'README.md'), 'not a workflow\n');
  // nested/ycontents must never surface: listing is non-recursive.
  await writeFile(path.join(root, '.github', 'workflows', 'nested', 'c.yml'), 'name: c\n');

  await mkdir(path.join(root, '.git', 'logs'), { recursive: true });
  const sha = (digit) => digit.repeat(40);
  const reflogLines = [
    `${sha('0')} ${sha('1')} Jane Doe <jane@example.com> 1700000000 +0900\tcommit: initial scaffolding`,
    'this line does not look like a reflog entry at all',
    `${sha('1')} ${sha('2')} Claude Code <noreply@anthropic.com> 1700000100 +0900\tcommit: feat: add feature`,
    `${sha('2')} ${sha('3')} release-bot <bot@ci.example.com> 1700000200 +0000\tcommit: chore: bump deps`,
    `${sha('3')} ${sha('4')} Jane Doe <jane@example.com> 1700000300 +0900\tcodex: automated commit`
  ];
  await writeFile(path.join(root, '.git', 'logs', 'HEAD'), `${reflogLines.join('\n')}\n`);

  return root;
}

// --- sample/tiny-town: a real repo with no infra deps at all ---------------

test('collectSignals against sample/tiny-town reads real package.json fields and no fabricated facility signals', async () => {
  const signals = await collectSignals(SAMPLE_REPO);

  assert.equal(signals.repository.name, 'tiny-town');
  assert.equal(signals.packageJson.present, true);
  assert.equal(signals.packageJson.name, 'tiny-town-sample');
  assert.equal(signals.packageJson.private, true);
  assert.equal(signals.packageJson.main, './src/main.js');
  assert.deepEqual(signals.packageJson.dependencies, {});
  assert.deepEqual(signals.packageJson.devDependencies, {});
  assert.deepEqual(signals.packageJson.scripts, { test: 'node --test' });
  assert.equal(signals.packageJson.bin, null);
  assert.equal(signals.packageJson.engines, null);

  assert.deepEqual(signals.scripts, { hasBuild: false, hasTest: true, hasStart: false, hasLint: false, names: ['test'] });

  // No dependency at all in this fixture, so every category-matcher must be empty.
  assert.equal(signals.hasWebServerDep, false);
  assert.deepEqual(signals.webServerDeps, []);
  assert.deepEqual(signals.llmSdks, []);
  assert.deepEqual(signals.externalServiceDeps, []);
  assert.deepEqual(signals.dbDeps, []);
  assert.deepEqual(signals.loggerDeps, []);
  assert.deepEqual(signals.distribution, {
    reactNativeOrExpo: false,
    electron: false,
    hasBinField: false,
    isPublishablePackage: false // private:true disqualifies it even though it is named
  });

  assert.deepEqual(signals.files, ABSENT_FILE_SIGNALS);
  assert.equal(signals.hasCI, false);
  assert.equal(signals.hasEnvFiles, false);
  assert.equal(signals.hasDotenvDep, false);
  assert.equal(signals.hasDockerfile, false);
  assert.equal(signals.webhookHint, false);

  // tiny-town has no .git of its own inside the sample fixture directory.
  assert.deepEqual(signals.external.contractorReports, []);
});

test('collectSignals is deterministic and every call returns a fresh, independently mutable, unfrozen object', async () => {
  const first = await collectSignals(SAMPLE_REPO);
  const second = await collectSignals(SAMPLE_REPO);

  assert.deepEqual(first, second);
  assert.notEqual(first, second, 'two calls must not return the very same object reference');
  assert.notEqual(first.scripts.names, second.scripts.names, 'nested arrays must not be shared/aliased either');
  assert.equal(Object.isFrozen(first), false, 'RepoSignals is documented as NOT frozen');

  first.scripts.names.push('mutated');
  first.llmSdks.push('mutated');
  const third = await collectSignals(SAMPLE_REPO);
  assert.deepEqual(third.scripts.names, ['test'], 'mutating a prior result must not leak into a later call');
  assert.deepEqual(third.llmSdks, []);
});

// --- this project's own repo root: a real bin field + CI workflow ----------

test('collectSignals against this repo root reads its real bin field, scripts, and CI workflow', async () => {
  const signals = await collectSignals(REPO_ROOT);

  assert.equal(signals.repository.name, 'codecity-inspector');
  assert.equal(signals.packageJson.present, true);
  assert.equal(signals.packageJson.name, 'codecity-inspector');
  assert.equal(signals.packageJson.private, false);
  assert.deepEqual(signals.packageJson.bin, { codecity: 'src/server.mjs' });
  assert.deepEqual(signals.packageJson.engines, { node: '>=20' });
  assert.equal(signals.packageJson.module, null);
  assert.deepEqual(signals.packageJson.files, [
    'art/contracts/',
    'CodeCity.command',
    'Fable5ArtContract.md',
    'Fable5PlacementGuide.md',
    'Fable5PlacementMatrix.md',
    'Fable5PrefabSpec.md',
    'Fable5SceneBlueprints.md',
    'Fable5VerticalSlice.md',
    'public/',
    'sample/',
    'src/',
    'tools/asset-forge/contracts/',
    'SECURITY.md',
    'THIRD_PARTY_NOTICES.md'
  ]);

  assert.equal(signals.scripts.hasStart, true);
  assert.equal(signals.scripts.hasTest, true);
  assert.equal(signals.scripts.hasBuild, false);
  assert.equal(signals.scripts.hasLint, false);
  assert.deepEqual(signals.scripts.names, [
    'check',
    'check:launcher',
    'demo',
    'start',
    'test'
  ]);

  assert.equal(signals.distribution.hasBinField, true);
  assert.equal(signals.distribution.isPublishablePackage, true);

  // The only real dependency is @babel/parser, which matches none of the
  // facility category tables.
  assert.equal(signals.hasWebServerDep, false);
  assert.deepEqual(signals.llmSdks, []);
  assert.deepEqual(signals.externalServiceDeps, []);
  assert.deepEqual(signals.dbDeps, []);
  assert.deepEqual(signals.loggerDeps, []);

  assert.equal(signals.files.githubWorkflows, true);
  assert.deepEqual(signals.files.githubWorkflowFiles, ['ci.yml']);
  assert.equal(signals.hasCI, true);
  assert.equal(signals.files.dockerfile, false);
  assert.equal(signals.hasDockerfile, false);
  assert.equal(signals.hasEnvFiles, false);
  assert.equal(signals.webhookHint, false);

  // The real reflog's content is out of this test's control (it grows with
  // every commit in this session), so only assert the documented shape,
  // never exact entries.
  assert.ok(Array.isArray(signals.external.contractorReports));
  for (const report of signals.external.contractorReports) {
    assert.equal(typeof report.source, 'string');
    assert.equal(typeof report.subject, 'string');
    assert.equal(report.status, 'pending-inspection');
  }
});

// --- synthetic fixture: every matcher / probe / reflog branch, known inputs -

test('collectSignals matches dependency-name categories across exact, scope, and prefix patterns', async () => {
  const root = await buildRichFixture();
  const signals = await collectSignals(root);

  assert.equal(signals.hasWebServerDep, true);
  assert.deepEqual(signals.webServerDeps, ['express']);
  assert.deepEqual(signals.llmSdks, ['@anthropic-ai/sdk']); // scope match
  assert.deepEqual(signals.externalServiceDeps, ['@sentry/node', 'stripe']); // scope + exact, sorted
  assert.deepEqual(signals.dbDeps, ['pg']);
  assert.deepEqual(signals.loggerDeps, ['@sentry/node', 'pino']); // @sentry doubles as a logger dep too
  assert.equal(signals.hasDotenvDep, true);
  assert.equal(signals.distribution.reactNativeOrExpo, true); // both exact "react-native" and prefix "expo-router"
  assert.equal(signals.distribution.electron, false);
  assert.equal(signals.distribution.hasBinField, true);
  assert.equal(signals.distribution.isPublishablePackage, true);
});

test('collectSignals reads scripts (including a "name:variant" match), a script-derived webhook hint, and file probes including a symlink-as-absent', async () => {
  const root = await buildRichFixture();
  const signals = await collectSignals(root);

  assert.deepEqual(signals.scripts, {
    hasBuild: true,
    hasTest: true, // "test:unit" counts via the "test:*" prefix rule
    hasStart: true,
    hasLint: true,
    names: ['build', 'lint', 'start', 'test:unit', 'webhook:deploy']
  });
  assert.equal(signals.webhookHint, true); // from the "webhook:deploy" script name, not a dependency or workflow file

  assert.equal(signals.files.env, true);
  assert.equal(signals.files.envExample, true);
  assert.equal(signals.files.envLocal, false);
  assert.equal(signals.files.npmrc, true);
  assert.equal(signals.files.dockerfile, true);
  assert.equal(signals.hasDockerfile, true);
  assert.equal(signals.files.dockerCompose, true); // the ".yaml" variant, not ".yml"
  assert.equal(signals.files.wranglerToml, true);
  assert.equal(signals.files.vercelJson, true);
  assert.equal(signals.files.netlifyToml, false, 'a symlink must never count as a present regular file');
  assert.equal(signals.files.appJson, false);
  assert.equal(signals.files.procfile, false);
  assert.equal(signals.files.prismaSchema, true);
  assert.equal(signals.hasEnvFiles, true);
});

test('collectSignals rejects symlinked ancestor directories instead of reading outside the repository', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codecity-signals-boundary-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'codecity-signals-outside-'));
  await mkdir(path.join(outside, '.github', 'workflows'), { recursive: true });
  await writeFile(path.join(outside, '.github', 'workflows', 'leak.yml'), 'name: outside\n');
  await mkdir(path.join(outside, '.git', 'logs'), { recursive: true });
  const sha = 'a'.repeat(40);
  await writeFile(path.join(outside, '.git', 'logs', 'HEAD'), `${sha} ${sha} Codex <bot@example.com> 1700000000 +0000\tcommit: outside\n`);
  await mkdir(path.join(outside, 'prisma'), { recursive: true });
  await writeFile(path.join(outside, 'prisma', 'schema.prisma'), 'datasource db { provider = "postgresql" }\n');
  await writeFile(path.join(outside, 'package.json'), '{"name":"outside","main":"index.js"}\n');

  await symlink(path.join(outside, '.github'), path.join(root, '.github'));
  await symlink(path.join(outside, '.git'), path.join(root, '.git'));
  await symlink(path.join(outside, 'prisma'), path.join(root, 'prisma'));
  await symlink(path.join(outside, 'package.json'), path.join(root, 'package.json'));

  const signals = await collectSignals(root);
  assert.equal(signals.packageJson.present, false);
  assert.equal(signals.files.githubWorkflows, false);
  assert.deepEqual(signals.files.githubWorkflowFiles, []);
  assert.equal(signals.files.prismaSchema, false);
  assert.deepEqual(signals.external.contractorReports, []);
});

test('collectSignals lists workflow filenames sorted (not in raw filesystem order), non-recursively, capped by maxWorkflowFiles', async () => {
  const root = await buildRichFixture();

  const signals = await collectSignals(root);
  assert.deepEqual(signals.files.githubWorkflowFiles, ['a.yaml', 'b.yml', 'deploy.yml']);
  assert.equal(signals.files.githubWorkflows, true);
  assert.equal(signals.hasCI, true);

  const capped = await collectSignals(root, { maxWorkflowFiles: 2 });
  assert.deepEqual(capped.files.githubWorkflowFiles, ['a.yaml', 'b.yml'], 'cap keeps the alphabetically-first names, deterministically');
  assert.equal(capped.files.githubWorkflows, true, 'workflows are still present even once the filename list is capped');
});

test('collectSignals parses .git/logs/HEAD as plain text into contractor reports, in file order, never running git', async () => {
  const root = await buildRichFixture();
  const signals = await collectSignals(root);

  assert.deepEqual(signals.external.contractorReports, [
    { source: 'claude-code', subject: 'commit: feat: add feature', status: 'pending-inspection' },
    { source: 'bot', subject: 'commit: chore: bump deps', status: 'pending-inspection' },
    { source: 'codex', subject: 'codex: automated commit', status: 'pending-inspection' }
  ]);
});

test('collectSignals options: maxReflogLines clamps to only the tail of the reflog', async () => {
  const root = await buildRichFixture();
  const signals = await collectSignals(root, { maxReflogLines: 1 });

  assert.deepEqual(signals.external.contractorReports, [
    { source: 'codex', subject: 'codex: automated commit', status: 'pending-inspection' }
  ]);
});

test('collectSignals options: invalid numeric overrides (negative / NaN / non-integer) fall back to the documented defaults', async () => {
  const root = await buildRichFixture();
  const baseline = await collectSignals(root);

  for (const bad of [-5, NaN, 1.5, 0, 'not-a-number']) {
    const withBadOption = await collectSignals(root, { maxReflogLines: bad, maxPackageJsonBytes: bad, maxWorkflowFiles: bad });
    assert.deepEqual(withBadOption.external.contractorReports, baseline.external.contractorReports, `maxReflogLines=${bad} must behave like the default`);
    assert.equal(withBadOption.packageJson.present, true, `maxPackageJsonBytes=${bad} must behave like the default (package.json is well under the 2MB cap)`);
    assert.deepEqual(withBadOption.files.githubWorkflowFiles, baseline.files.githubWorkflowFiles, `maxWorkflowFiles=${bad} must behave like the default`);
  }
});

test('collectSignals options: an undersized maxPackageJsonBytes makes package.json read absent without breaking unrelated signals', async () => {
  const root = await buildRichFixture();
  const stat = await lstat(path.join(root, 'package.json'));
  const signals = await collectSignals(root, { maxPackageJsonBytes: stat.size - 1 });

  assert.deepEqual(signals.packageJson, EMPTY_PACKAGE_JSON_SIGNALS);
  // Everything read independently of package.json must be unaffected.
  assert.equal(signals.files.dockerfile, true);
  assert.deepEqual(signals.external.contractorReports.map((report) => report.source), ['claude-code', 'bot', 'codex']);
});

// --- read-only behavior on a repository that does not exist -----------------

test('collectSignals returns every signal absent, gracefully and without throwing, for a nonexistent repo path', async () => {
  const missingPath = path.join(os.tmpdir(), 'codecity-inspector-signals-fixture-that-does-not-exist');
  await assert.rejects(lstat(missingPath), /ENOENT/, 'precondition: the fixture path must not already exist');

  const signals = await collectSignals(missingPath);

  assert.equal(signals.repository.name, path.basename(missingPath));
  assert.deepEqual(signals.packageJson, EMPTY_PACKAGE_JSON_SIGNALS);
  assert.deepEqual(signals.files, ABSENT_FILE_SIGNALS);
  assert.equal(signals.hasWebServerDep, false);
  assert.deepEqual(signals.webServerDeps, []);
  assert.deepEqual(signals.llmSdks, []);
  assert.deepEqual(signals.externalServiceDeps, []);
  assert.deepEqual(signals.dbDeps, []);
  assert.deepEqual(signals.loggerDeps, []);
  assert.deepEqual(signals.distribution, { reactNativeOrExpo: false, electron: false, hasBinField: false, isPublishablePackage: false });
  assert.deepEqual(signals.scripts, { hasBuild: false, hasTest: false, hasStart: false, hasLint: false, names: [] });
  assert.equal(signals.hasCI, false);
  assert.equal(signals.hasEnvFiles, false);
  assert.equal(signals.hasDotenvDep, false);
  assert.equal(signals.hasDockerfile, false);
  assert.equal(signals.webhookHint, false);
  assert.deepEqual(signals.external.contractorReports, []);

  // Read-only: collecting signals for a missing path must never create it.
  await assert.rejects(lstat(missingPath), /ENOENT/, 'collectSignals must not create anything at a nonexistent path');
});

// --- signalDefaults ----------------------------------------------------------

test('signalDefaults exposes the frozen default read caps', () => {
  assert.deepEqual(signalDefaults, {
    maxPackageJsonBytes: 2 * 1024 * 1024,
    maxReflogBytes: 2 * 1024 * 1024,
    maxReflogLines: 200,
    maxWorkflowFiles: 200
  });
  assert.equal(Object.isFrozen(signalDefaults), true);
});

// --- static safety check backing the "never executes" contract -------------

test('signals.mjs never imports a process-execution module (static safety check)', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'src', 'town', 'signals.mjs'), 'utf8');
  assert.doesNotMatch(source, /node:child_process/);
  assert.doesNotMatch(source, /['"]child_process['"]/);
  assert.doesNotMatch(source, /\bchild_process\.|\bexecSync\b|\bspawnSync\b/);
});
