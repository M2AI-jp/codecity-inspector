#!/usr/bin/env node
// 道場の状態判定を、作業ツリーにfixtureを残さずに確かめる。
// 各fixtureは一時ディレクトリの中で作り、記録のmtimeを固定してから
// src/analyze.mjs → src/facilities.mjs の判定を通す。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeRepository } from '../src/analyze.mjs';

const COMMIT_AT = '2026-01-01T00:00:00.000Z';
const specs = [
  { name: 'state-passed', status: 'passed', expected: 'passed', recordAt: '2026-01-01T00:00:10.000Z' },
  { name: 'state-failed-repo', status: 'failed', expected: 'failed', recordAt: '2026-01-01T00:00:10.000Z' },
  { name: 'state-unverified-repo', status: 'passed', expected: 'unverified', recordAt: '2025-12-31T23:59:00.000Z' },
];

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'CodeCity State Check',
  GIT_AUTHOR_EMAIL: 'codecity-state@example.invalid',
  GIT_COMMITTER_NAME: 'CodeCity State Check',
  GIT_COMMITTER_EMAIL: 'codecity-state@example.invalid',
  GIT_AUTHOR_DATE: COMMIT_AT,
  GIT_COMMITTER_DATE: COMMIT_AT,
};

function git(repo, args) {
  execFileSync('git', args, { cwd: repo, env: gitEnv, stdio: 'inherit' });
}

function makeFixture(root, spec) {
  const repo = join(root, spec.name);
  mkdirSync(join(repo, 'tests'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'test-results/\n', 'utf8');
  writeFileSync(join(repo, 'tests/example.test.js'),
    "import test from 'node:test';\ntest('example', () => {});\n", 'utf8');

  git(repo, ['init', '--quiet']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '--quiet', '-m', 'fixture baseline']);

  const record = join(repo, 'test-results/.last-run.json');
  mkdirSync(join(repo, 'test-results'), { recursive: true });
  writeFileSync(record, JSON.stringify({
    status: spec.status,
    failedTests: spec.status === 'failed' ? { 'tests/example.test.js': true } : {},
  }), 'utf8');
  const at = new Date(spec.recordAt);
  utimesSync(record, at, at);
  return repo;
}

let tempRoot = null;
let failed = false;
try {
  tempRoot = mkdtempSync(join(tmpdir(), 'codecity-state-check-'));
  for (const spec of specs) {
    const repo = makeFixture(tempRoot, spec);
    const model = analyzeRepository(repo);
    const dojo = model.facilities.find((f) => f.archetype === 'dojo');
    const actual = dojo?.facts?.state || 'no-dojo';
    const record = dojo?.facts?.latestRecord;
    const ok = actual === spec.expected;
    failed ||= !ok;
    console.log(`${spec.name}: expected=${spec.expected} actual=${actual} `
      + `record=${record ? `${record.tool} failures=${record.failures} mtime=${record.mtime}` : 'none'} `
      + (ok ? 'OK' : 'NG'));
  }
} catch (error) {
  failed = true;
  console.error(`check-state: ${error.message}`);
} finally {
  if (tempRoot) {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      failed = true;
      console.error(`check-state: 一時ディレクトリを消せない: ${error.message}`);
    }
  }
}

if (failed) {
  console.error('check-state: FAILED');
  process.exitCode = 1;
} else {
  console.log('check-state: OK');
}
