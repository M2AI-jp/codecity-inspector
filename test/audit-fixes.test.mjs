import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeRepository } from '../src/analyze.mjs';
import { aggregate, chooseCanalRoute, layoutTown } from '../src/layout.mjs';

function git(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', ...options }).trim();
}

function makeCanalSample() {
  const root = mkdtempSync(join(tmpdir(), 'codecity-canal-'));
  mkdirSync(join(root, 'src', 'engine'), { recursive: true });
  mkdirSync(join(root, 'src', 'ui'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"canal-sample","private":true}\n');
  writeFileSync(join(root, 'src', 'engine', 'main.js'), 'process.env.PORT = 3000;\n'.repeat(24));
  writeFileSync(join(root, 'src', 'ui', 'main.js'), 'document.body;\n'.repeat(24));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'audit@example.test']);
  git(root, ['config', 'user.name', 'Audit Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'sample']);
  return root;
}

test('井戸のある一時リポジトリで、past の地区を通る水路を置ける', () => {
  const root = makeCanalSample();
  try {
    const repo = analyzeRepository(root);
    repo.facilities = [
      { archetype: 'well', name: '井戸', reason: 'test', evidence: [], evidenceCount: 1,
        facts: { envInCode: [{ files: ['src/engine/main.js'] }] } },
      { archetype: 'dock', name: '船着場', reason: 'test', evidence: [], evidenceCount: 1, facts: {} },
    ];
    const town = layoutTown(repo);
    assert.ok(town.canal?.cells.length > 0, '水路が置かれる');
    assert.deepEqual(town.canal.past, ['src/engine'], '水路が設定地区のそばを通る');
    assert.equal((town.unplaced || []).some((x) => x.archetype === 'canal'), false, '水路が未配置にならない');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('水路は全辺の past 経由を試してから past: [] にフォールバックする', () => {
  const edges = [{ name: 'south' }, { name: 'east' }, { name: 'west' }];
  const calls = [];
  const harbourStates = new Set(['harbour']);
  const outsideStates = new Set(['outside']);
  const targetGoals = new Set(['target']);
  const route = chooseCanalRoute(edges, (edge) => [edge.name], {
    past: ['src/engine'],
    targetGoals,
    harbourStates,
    outsideStates,
    astarVia: (starts, _mids, goals) => {
      calls.push(`via:${starts[0]}:${goals === harbourStates ? 'harbour' : 'outside'}`);
      return starts[0] === 'east' && goals === harbourStates ? ['via-east'] : null;
    },
    astar: (starts, goals) => {
      calls.push(`direct:${starts[0]}:${goals === harbourStates ? 'harbour' : 'outside'}`);
      return starts[0] === 'south' && goals === outsideStates ? ['direct-south'] : null;
    },
  });
  assert.deepEqual(route, { path: ['via-east'], past: ['src/engine'], to: 'harbour', edge: 'east' });
  assert.deepEqual(calls, [
    'via:south:harbour', 'via:south:outside',
    'via:east:harbour',
  ]);

  const fallback = chooseCanalRoute(edges, (edge) => [edge.name], {
    past: ['src/engine'],
    targetGoals,
    harbourStates,
    outsideStates,
    astarVia: () => null,
    astar: (starts, goals) => starts[0] === 'south' && goals === outsideStates ? ['direct-south'] : null,
  });
  assert.deepEqual(fallback, { path: ['direct-south'], past: [], to: 'outside', edge: 'south' });
});

test('5000件を超える履歴でも、古いモジュールの最後のコミットを取る', { timeout: 60000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'codecity-history-'));
  try {
    git(root, ['init', '-q']);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Audit Test',
      GIT_AUTHOR_EMAIL: 'audit@example.test',
      GIT_COMMITTER_NAME: 'Audit Test',
      GIT_COMMITTER_EMAIL: 'audit@example.test',
    };
    const stream = [
      'blob\nmark :1\ndata 31\nexport const oldModule = true;\n',
      'blob\nmark :2\ndata 34\nexport const activeModule = true;\n',
    ];
    const author = 'author Audit Test <audit@example.test> 946684800 +0000\n';
    const committer = 'committer Audit Test <audit@example.test> 946684800 +0000\n';
    stream.push(
      `commit refs/heads/main\nmark :3\n${author}${committer}data 10\nold module\nM 100644 :1 old-module/module.js\nM 100644 :2 active.js\n`,
    );
    let parentMark = 3;
    for (let i = 1; i <= 5000; i++) {
      const mark = parentMark + 1;
      const timestamp = 946684800 + i;
      stream.push(
        `commit refs/heads/main\nmark :${mark}\n` +
        `author Audit Test <audit@example.test> ${timestamp} +0000\n` +
        `committer Audit Test <audit@example.test> ${timestamp} +0000\n` +
        `data 11\nmaintenance\nfrom :${parentMark}\n`,
      );
      parentMark = mark;
    }
    execFileSync('git', ['fast-import'], {
      cwd: root,
      input: `${stream.join('')}done\n`,
      env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

    const repo = analyzeRepository(root);
    const oldModule = repo.modules.find((m) => m.path === 'old-module');
    assert.ok(oldModule, '古いモジュールが解析される');
    assert.ok(oldModule.lastCommit, '古いモジュールの lastCommit が null にならない');
    assert.equal(oldModule.lastCommit.subject, 'old module');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('小さなモジュールをまとめた後に recent・kind・reason を再計算する', () => {
  const base = {
    files: 1, lines: 10, bytes: 10, languages: { JavaScript: 10 }, commits: 1,
    authors: [{ name: 'Audit Test', commits: 1 }], topFiles: [],
    works: { clean: 1, dirty: 0 }, lastCommit: { date: '2026-11-01T00:00:00Z' },
  };
  const result = aggregate([
    { ...base, path: 'src/old-code', kind: 'ruin', reason: '古い履歴だけの領域', recent: 0 },
    { ...base, path: 'src/engine', kind: 'workshop', reason: '今週も変更がある工房', recent: 7,
      lastCommit: { date: '2026-11-12T00:00:00Z' } },
  ], 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].recent, 7);
  assert.equal(result[0].kind, 'workshop');
  assert.match(result[0].reason, /今週も変更がある工房/);
  assert.equal(result[0].merged.length, 2);
});
