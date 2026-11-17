import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeRepository } from '../src/analyze.mjs';
import { layoutTown, aggregate, loadArt, loadProps, loadGround } from '../src/layout.mjs';
import { groupComponents } from '../src/group-components.mjs';
import { checkAscii } from '../tools/check-ascii.mjs';
import { fuzzSeeds } from '../tools/seed-fuzz.mjs';

const base = new URL('../compare/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(new URL('../art/game/manifest.json', import.meta.url)));
const options = { art: loadArt(manifest), props: loadProps(manifest), ground: loadGround(manifest) };
const module = (path, group, kind = 'house') => ({
  path, ...(group !== undefined ? { group } : {}), kind, reason: 'fixture',
  files: 1, lines: 80, bytes: 800, languages: { js: 1 }, commits: 0, recent: 0,
  authors: [], lastCommit: null, topFiles: [{ path: `${path}/main.js`, lines: 80 }],
});

test('aggregate は親・兄弟・最上位とも別の group と未指定を混ぜない', () => {
  const mods = [
    module('src', 'engine'), module('src/a', 'ui'), module('src/b', 'engine'),
    module('src/c', undefined), module('plain', undefined), module('other', 'ui'),
  ];
  const original = JSON.stringify(mods);
  const result = aggregate(mods, 1);
  assert.equal(result.length, 3, 'cap を超えても担当境界を守る');
  for (const m of result) {
    const paths = new Set([m.path, ...(m.merged || [])]);
    for (const part of mods.filter((p) => paths.has(p.path))) {
      // 集約で作られた親の path は、別担当の元 path と一致することもある。
      if (m.merged?.includes(part.path) || !m.merged?.length) assert.equal(part.group, m.group);
    }
  }
  assert.equal(result.reduce((n, m) => n + m.files, 0), mods.length);
  assert.equal(JSON.stringify(mods), original);
});

test('group 付き一時リポジトリで種類を保ち、担当を一塊または理由付き未配置として返す', { timeout: 120000 }, (t) => {
  mkdirSync(base, { recursive: true });
  const temp = mkdtempSync(join(base, 'groups-test-')), root = join(temp, 'group-town');
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (let i = 0; i < 6; i++) {
    const dir = join(root, 'src', `part${i}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'main.js'), 'export const sample = 1;\n'.repeat(40 + i));
  }
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(join(root, 'tools', 'build.sh'), '#!/bin/sh\nnode --version\n');
  writeFileSync(join(root, 'package.json'), '{"name":"group-town","private":true,"scripts":{"build":"sh tools/build.sh"}}\n');
  // 親 worktree を fixture のリポジトリとして拾わない。git の初期化は不要。
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  let repo;
  try {
    process.env.GIT_CEILING_DIRECTORIES = temp;
    repo = analyzeRepository(root);
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
  }
  for (const m of repo.modules) m.group = m.path.endsWith('0') || m.path.endsWith('1') ? 'engine' : 'ui';
  assert.ok(repo.modules.some((m) => m.kind === 'workshop'));
  const original = JSON.stringify(repo);
  const report = fuzzSeeds(repo, manifest, { count: 8, onResult(result, checks) {
    assert.deepEqual(result.problems, [], `${result.head}: ${result.problems.join('\n')}`);
    assert.ok(checks.ascii.groups.length === 2);
    assert.ok(checks.ascii.groups.every((g) => g.pieces === 1));
    for (const b of checks.town.buildings) {
      assert.equal(b.district, b.module.group);
      if (!b.module.merged) assert.equal(b.module.kind, repo.modules.find((m) => m.path === b.module.path).kind);
    }
  } });
  assert.equal(report.failed, 0);
  assert.equal(JSON.stringify(repo), original, '入力モデルを変更しない');
});

test('同じ担当だけの施設集約は group を残し、共有施設は別担当を吸収しない', () => {
  const mods = [module('tests/a', 'engine'), module('tests/b', 'ui')];
  const facility = { archetype: 'dojo', name: '道場', reason: 'fixture',
    evidence: ['tests/a', 'tests/b'], evidenceCount: 2, merged: mods.map((m) => m.path), facts: {} };
  for (const shared of [false, true]) {
    const modules = shared ? mods : mods.map((m) => ({ ...m, group: 'engine' }));
    const town = layoutTown({ name: 'group-facility', modules, facilities: [facility] }, options);
    const dojo = town.buildings.find((b) => b.facility);
    assert.ok(dojo, '道場を省略しない');
    assert.equal(dojo.module.group, shared ? undefined : 'engine');
    if (shared) {
      assert.deepEqual(dojo.facility.merged, []);
      assert.equal(town.buildings.filter((b) => !b.facility).length, 2);
    } else assert.deepEqual(dojo.module.merged, ['tests/a', 'tests/b']);
  }
});

test('固定施設同士が離れる担当は位置を崩さず、実測した塊数と理由を unplaced に残す', () => {
  const modules = [module('test', 'team'), module('server', 'team')];
  const facilities = ['dojo', 'inn'].map((archetype, i) => ({
    archetype, name: archetype, reason: 'fixture', facts: {}, evidenceCount: 1,
    evidence: [modules[i].path], merged: [modules[i].path],
  }));
  const repo = { name: 'fixed-groups', modules, facilities };
  const town = layoutTown(repo, options);
  const ordinary = layoutTown({ ...repo, modules: modules.map(({ group, ...m }) => m) }, options);
  const positions = (t) => t.buildings.map((b) => [b.archetype, b.x, b.y, b.w, b.h]);
  assert.deepEqual(positions(town), positions(ordinary));
  assert.equal(groupComponents(town)[0].pieces, 2);
  const gap = town.unplaced.find((u) => u.archetype === 'group');
  assert.equal(gap.pieces, 2);
  assert.deepEqual(gap.modules, []);
  assert.ok(gap.reason.trim());
  assert.deepEqual(checkAscii(town, manifest, { repo }).problems, []);
});

test('塊検査は道路での遠回り・水・別担当・段の縁を連結と数えない', () => {
  const building = (id, x, y, group) => ({ id, x, y, w: 2, h: 2, door: { x, y: y + 1 }, module: module(id, group) });
  const town = {
    cols: 20, rows: 12, ground: Array(12).fill('+'.repeat(20)), props: [], residents: [],
    spawn: { x: 0, y: 0 }, buildings: [building('b1', 2, 2, 'a'), building('b2', 6, 2, 'a')],
  };
  assert.equal(groupComponents(town)[0].pieces, 1, '幅2の路地を挟んだ隣家');
  for (const obstacle of ['water', 'other', 'terrace', 'far']) {
    const copy = structuredClone(town);
    if (obstacle === 'water') copy.ground = copy.ground.map((r) => r.slice(0, 4) + '~' + r.slice(5));
    if (obstacle === 'other') copy.buildings.push({ ...building('b3', 4, 0, 'b'), h: 10 });
    if (obstacle === 'terrace') {
      copy.buildings[1].x = 2; copy.buildings[1].y = 6; copy.buildings[1].door = { x: 2, y: 7 };
      copy.terraces = [{ x: 0, y: 0, w: 12, h: 4 }]; copy.stairs = [];
    }
    if (obstacle === 'far') copy.buildings[1].x = 14;
    assert.equal(groupComponents(copy).find((g) => g.group === 'a').pieces, 2, obstacle);
    assert.ok(checkAscii(copy, manifest).problems.some((p) => p.includes('理由付き unplaced')), obstacle);
    copy.unplaced = [{ archetype: 'group', name: 'a', group: 'a', pieces: 2, buildings: ['b1', 'b2'],
      modules: [], reason: 'fixture: 固定施設の間に障害物がある' }];
    assert.ok(!checkAscii(copy, manifest).problems.some((p) => p.includes('group "a"')), obstacle);
  }
});

test('group の入力モジュールを黙って落とした Town は検査で失敗する', () => {
  const repo = { name: 'missing-group', modules: [module('one', 'a'), module('two', 'b')] };
  const town = layoutTown(repo, options);
  const missing = town.buildings.find((b) => b.module.group === 'b');
  assert.ok(missing);
  town.buildings = town.buildings.filter((b) => b !== missing);
  assert.ok(checkAscii(town, manifest, { repo }).problems.some((p) => p.includes('建物にも理由付き unplaced にも無い')));
});

test('戸口と階段を空けると担当が収まらない格子は、横幅の違う候補でも調べる', { timeout: 120000 }, () => {
  // r9 の再現を配置に必要な入力へ絞る。従来は common の10モジュールが未配置だった。
  const parts = [
    ['common/_root', 'workshop', 6, 762],
    ['common/.claude', 'workshop', 1, 50],
    ['common/bin', 'workshop', 2, 235],
    ['common/demos', 'house', 19, 2661],
    ['common/docs', 'house', 27, 3669],
    ['common/examples/kakeibo', 'house', 58, 30153],
    ['common/examples/memo', 'house', 61, 3281],
    ['common/examples/omikuji', 'house', 46, 29812],
    ['mac/mac', 'house', 5, 759],
    ['common/quests', 'house', 1, 3065],
    ['gmkit/quests', 'house', 11, 1071],
    ['site/site', 'shop', 31, 1416],
    ['gmkit/src', 'house', 2, 321],
    ['common/src/commands', 'house', 2, 82],
    ['engine/src/commands', 'house', 19, 521],
    ['gmkit/src/commands', 'house', 4, 224],
    ['party/src/commands', 'house', 1, 223],
    ['server/src/commands', 'house', 3, 208],
    ['teller/src/commands', 'house', 2, 124],
    ['engine/src/engine', 'house', 24, 4899],
    ['gmkit/src/linear', 'house', 6, 636],
    ['server/src/mcp', 'house', 3, 513],
    ['party/src/party', 'house', 5, 1001],
    ['teller/src/quest', 'house', 8, 1311],
    ['server/src/server', 'house', 4, 1801],
    ['common/tests', 'house', 10, 1514],
    ['common/tests/e2e', 'house', 128, 17366],
    ['site/tools', 'workshop', 1, 189],
    ['board/web', 'shop', 1, 365],
    ['common/web', 'shop', 1, 62],
    ['assets/web/assets', 'shop', 41, 865],
    ['board/web/board', 'shop', 57, 21214],
    ['board/web/fixtures', 'shop', 6, 20009],
  ];
  const modules = parts.map(([path, kind, files, lines]) => ({
    ...module(path, path.split('/')[0], kind), files, lines,
  }));
  const facilities = ['town_hall', 'inn', 'pub', 'dojo', 'well', 'dock', 'gate'].map((archetype) => {
    const merged = archetype === 'dojo' ? ['common/tests', 'common/tests/e2e'] : archetype === 'dock' ? ['mac/mac'] : [];
    return { archetype, name: archetype, reason: 'fixture', facts: {}, evidence: merged, evidenceCount: merged.length, merged };
  });
  // 後の2種は、最終選択した屋根の版も階段の予約とともに引き継ぐ必要がある。
  for (const head of ['0000004', '000001d', '000008b']) {
    const repo = { name: 'gridhub', head, modules, facilities };
    const town = layoutTown(repo, options);
    assert.equal(groupComponents(town).length, 10, head);
    assert.ok(groupComponents(town).every((g) => g.pieces === 1), head);
    assert.deepEqual((town.unplaced || []).filter((u) => u.archetype === 'group'), [], head);
    assert.deepEqual(checkAscii(town, manifest, { repo }).problems, [], head);
  }
});
