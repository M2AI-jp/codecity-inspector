import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRepository } from '../src/analyze.mjs';
import { layoutTown, loadArt, loadProps } from '../src/layout.mjs';
import { largestRectangle, limitLawns, visibleLawn } from '../src/lawn.mjs';
import { stairClearanceConflicts, describeStairConflict } from '../src/stair-clearance.mjs';
import { finishProps } from '../src/layout/props/lawn.mjs';
import { CH, DIRT, GRASS, WATER } from '../src/layout/constants.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const art = loadArt(), props = loadProps();
const maximum = (town) => largestRectangle(visibleLawn(town, art, props), town.cols, town.rows)?.a ?? 0;
const random = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
function run(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 24, ...options });
  if (r.stderr) process.stderr.write(r.stderr);
  assert.equal(r.status, 0, `${command} ${args.join(' ')}\n${r.error || ''}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function temporary(t) {
  const base = join(ROOT, 'compare');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'lawn-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function emptyTown(ground, spawn) {
  return { cols: ground[0].length, rows: ground.length, ground, spawn, props: [], buildings: [], landmarks: [] };
}

test('芝生の最大長方形は全矩形の総当たりと一致し、幅・高さ1は数えない', () => {
  const rng = random(0x1a7f00d);
  for (let n = 0; n < 80; n++) {
    const cols = 2 + n % 6, rows = 2 + n % 5;
    const mask = Uint8Array.from({ length: cols * rows }, () => rng() < 0.7 ? 1 : 0);
    let expected = 0;
    for (let y0 = 0; y0 < rows; y0++) for (let y1 = y0 + 1; y1 < rows; y1++) {
      for (let x0 = 0; x0 < cols; x0++) for (let x1 = x0 + 1; x1 < cols; x1++) {
        let full = true;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) full &&= !!mask[y * cols + x];
        if (full) expected = Math.max(expected, (x1 - x0 + 1) * (y1 - y0 + 1));
      }
    }
    assert.equal(largestRectangle(mask, cols, rows)?.a ?? 0, expected);
  }
  assert.equal(largestRectangle(new Uint8Array(40).fill(1), 1, 40), null);
});

test('見える芝生は小物・屋根の版・段・階段・番人・開始点を除く', () => {
  const town = emptyTown(Array(10).fill('..........'), { x: 9, y: 9 });
  town.buildings = [{ archetype: 'house', variant: 'b', x: 1, y: 3, w: 2, h: 2,
    door: { x: 1, y: 4 }, module: { kind: 'house' } }];
  town.props = [
    { type: 'bush', x: 5.5, y: 2 },
    { type: 'scaffold', x: 6.5, y: 5, w: 1 },
    { type: 'pier', x: 1, y: 7.25 },
    { type: 'gate', x: 7, y: 8 },
  ];
  town.landmarks = [{ keeper: { x: 4.5, y: 4.6875 } }];
  town.terraces = [{ x: 3, y: 5, w: 2, h: 1 }];
  town.stairs = [{ x: 3, y: 6, w: 1 }];
  const a = { house: { variants: [{ id: 'a', cover: [0, 0] }, { id: 'b', cover: [1, 2] }] } };
  const p = { scaffold: { solid: [-16, -16, 32, 16] },
    pier: { deck: [0, 0, 32, 16] },
    gate: { solids: [[-16, -16, 16, 16], [16, -16, 16, 16]], opening: [0, -16, 16, 16] } };
  const lawn = visibleLawn(town, a, p), at = (x, y) => lawn[y * town.cols + x];
  for (const [x, y] of [[1, 3], [2, 4], [1, 2], [2, 1], [5, 1], [6, 4], [1, 7], [2, 8],
    [6, 7], [8, 7], [4, 4], [3, 6], [4, 6], [9, 9]]) assert.equal(at(x, y), 0, `${x},${y}`);
  for (const [x, y] of [[1, 1], [5, 4], [7, 7], [0, 0]]) assert.equal(at(x, y), 1, `${x},${y}`);
  const roof = visibleLawn(town, a, p, { withRoof: true });
  assert.equal(roof[1 * town.cols + 2], 1);
});

test('8マス以下は1バイトも変えず、64個を超える空白もすべて割る', () => {
  const small = emptyTown(['....', '....', '####'], { x: 0, y: 2 });
  const before = JSON.stringify(small);
  limitLawns(small, {}, {}, () => assert.fail('既に8マス以下'));
  assert.equal(JSON.stringify(small), before);

  const large = emptyTown(Array(3).fill('...#'.repeat(100)), { x: 399, y: 2 });
  let cuts = 0;
  limitLawns(large, {}, {}, (r) => {
    const x = Math.floor((r.x0 + r.x1) / 2), y = Math.floor((r.y0 + r.y1) / 2);
    large.ground[y] = large.ground[y].slice(0, x) + ':' + large.ground[y].slice(x + 1);
    cuts++;
  });
  assert.equal(cuts, 100);
  assert.ok(maximum(large) <= 8);
  assert.throws(() => limitLawns(emptyTown(['....', '....', '....'], { x: 0, y: 0 }),
    {}, {}, () => {}), /分割できなかった/);
});

test('水路脇で草地へ戻した道路を芝生の分割で土道へ戻さない', () => {
  // homebrew head=000001e: 水路のために道路を草へ戻した後も road の印は残る。
  // 予約地に小物を置けなくても、土の小道は水路から離れた行に作る。
  const cols = 6, rows = 4, N = cols * rows, id = (x, y) => y * cols + x;
  const crop = { x0: 0, y0: 0, x1: cols - 1, y1: rows - 1 };
  const inC = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;
  const g = Uint8Array.from({ length: N }, (_, k) => k < cols * 2 ? WATER : GRASS);
  const canalCells = Array.from({ length: cols * 2 }, (_, k) => [k % cols, Math.floor(k / cols)]);
  const propList = [], out = { props: propList };
  finishProps({
    cols, N, id, crop, inC, g, canalCells, out, props: propList,
    P: { rows, road: new Int32Array(N) }, placed: [], bridgeCells: [], propArt: {},
    foot: new Int32Array(N).fill(-1), blocked: new Uint8Array(N),
    reserved: new Uint8Array(N).fill(1), roofZ: new Uint8Array(N),
    front: new Uint8Array(N), plazaM: new Uint8Array(N),
    isGrass: (x, y) => inC(x, y) && g[id(x, y)] === GRASS, tryProp: () => false,
  });
  const town = emptyTown(Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => CH[g[id(x, y)]]).join('')), { x: 5, y: 3 });
  out.finishLawn(town, {});
  for (let x = 0; x < cols; x++) assert.equal(g[id(x, 2)], GRASS, `水路の隣 (${x},2)`);
  assert.ok(Array.from(g.slice(cols * 3)).includes(DIRT), '水路から離れた行で芝生を分ける');
  assert.ok(maximum(town) <= 8);
});

test('PR #9 の道場前に芝生が残った入力でも、8マス以下と到達性を保つ', (t) => {
  // 9bd43a7 の配置に必要な名前・種・モジュールの規模だけ。実装ファイルはfixtureに含めない。
  const modules = [
    ['.', 'workshop', 7, 501], ['.github', 'workshop', 1, 45], ['art', 'house', 1, 0],
    ['art/game', 'house', 1, 1916], ['art/game/buildings', 'house', 69, 667],
    ['art/game/creatures', 'house', 10, 5], ['art/game/ground', 'house', 8, 0],
    ['art/game/props', 'house', 66, 63], ['art/game/residents', 'house', 23, 0],
    ['art/references', 'house', 22, 0], ['ship', 'house', 1, 0], ['src', 'house', 6, 2180],
    ['src/analyze', 'house', 9, 641], ['src/creatures', 'house', 7, 344],
    ['src/facilities', 'house', 12, 1170], ['src/layout', 'house', 9, 3404],
    ['test', 'house', 6, 282], ['tools', 'workshop', 18, 2675], ['web', 'shop', 37, 5785],
  ].map(([path, kind, files, lines]) => ({ path, kind, files, lines, bytes: 0, languages: {} }));
  const facilities = ['town_hall', 'inn', 'dojo', 'gate'].map((archetype) => ({
    archetype, merged: archetype === 'dojo' ? ['test'] : [], evidence: [], evidenceCount: 1, facts: {},
  }));
  const town = layoutTown({ name: 'codecity-inspector', head: '9bd43a7', modules, facilities });
  // 戸口前の確保で建物の位置は変わる。以前の絶対座標ではなく、
  // 同じ入力の全芝生と実際のPlayerの到達性を引き続き検査する。
  assert.ok(maximum(town) <= 8);
  const file = join(temporary(t), 'ci.json');
  writeFileSync(file, JSON.stringify(town));
  run(process.execPath, [join(ROOT, 'tools/check-play.mjs'), file]);
});

test('種を固定した30個のリポジトリで芝生8マス以下と実際のPlayerの到達性を保つ', { timeout: 120000 }, async (t) => {
  const root = temporary(t), rng = random(0x9bd43a7), files = [];
  const env = { ...process.env,
    GIT_CEILING_DIRECTORIES: root,
    GIT_AUTHOR_NAME: 'Lawn Test', GIT_AUTHOR_EMAIL: 'lawn@example.invalid',
    GIT_COMMITTER_NAME: 'Lawn Test', GIT_COMMITTER_EMAIL: 'lawn@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  for (let i = 0; i < 30; i++) {
    const name = `lawn-town-${String(i).padStart(2, '0')}`, repo = join(root, name);
    const write = (p, text) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), text); };
    write('README.md', `# ${name}\n`);
    write('test/example.test.js', "import test from 'node:test';\ntest('example', () => {});\n");
    write('package.json', JSON.stringify({ name, private: true, scripts: { test: 'node --test' } }));
    const count = 10 + Math.floor(rng() * 130);
    for (let n = 0; n < count; n++) {
      const depth = 1 + Math.floor(rng() * 4);
      const dirs = Array.from({ length: depth }, (_, d) => `part${d}-${Math.floor(rng() * (d ? 2 : 5))}`);
      write(`src/${dirs.join('/')}/file${n}.js`, 'export const value = 1;\n'.repeat(1 + Math.floor(rng() * 180)));
    }
    if (i % 3 === 0) write('src/server.js', "import http from 'node:http';\nhttp.createServer(() => {}).listen(3000);\n");
    if (i % 5 === 0) write('.env.example', 'APP_PORT=\nAPP_HOST=\nAPP_MODE=\n');
    const git = (...args) => run('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env });
    git('init', '--quiet', '--initial-branch=main');
    git('add', '.');
    git('commit', '--quiet', '-m', 'Create deterministic lawn fixture');
    const model = analyzeRepository(repo), town = layoutTown(model);
    const file = join(root, `${name}.json`);
    writeFileSync(file, JSON.stringify(town));
    files.push(file);
    await t.test(name, () => {
      assert.ok(maximum(town) <= 8, `${name}: 最大 ${maximum(town)}マス`);
      const collisions = stairClearanceConflicts(town, art, props);
      assert.equal(collisions.length, 0, collisions.map(describeStairConflict).join('\n'));
      assert.equal(JSON.stringify(layoutTown(model)), JSON.stringify(town), '同じ入力で同じ街');
      run(process.execPath, [join(ROOT, 'tools/lawn.mjs'), file, '--max', '8']);
    });
  }
  const result = run(process.execPath, [join(ROOT, 'tools/check-play.mjs'), ...files]);
  assert.equal(result.split('\n').filter((l) => l.includes('buildings,')).length, 30);
  t.diagnostic('30街の階段と前後2行の検査・lawn --max 8・check-play: exit 0。一時リポジトリは t.after で削除。');
});
