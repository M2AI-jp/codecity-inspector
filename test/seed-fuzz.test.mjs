import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeRepository } from '../src/analyze.mjs';
import { fuzzSeeds } from '../tools/seed-fuzz.mjs';
import { artFrom, buildWorld, checkPlay } from '../tools/check-play.mjs';
import { Player } from '../web/player.js';
import { SIM_DT } from '../web/config.js';
import { keepReachableTerraces } from '../src/layout/terraces.mjs';
import { STREET, GRASS, WATER } from '../src/layout/constants.mjs';

const base = new URL('../compare/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(new URL('../art/game/manifest.json', import.meta.url), 'utf8'));

test('一度解析した見本リポジトリの40種でCI検査と階段の上り下りを確かめる', { timeout: 30000 }, (t) => {
  mkdirSync(base, { recursive: true });
  const temp = mkdtempSync(join(base, 'seed-test-')), root = join(temp, 'seed-town');
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const write = (path, text) => {
    const parts = path.split('/'); parts.pop();
    mkdirSync(join(root, ...parts), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (let i = 0; i < 16; i++) write(`src/part${i}/main.js`, `export const value = ${i};\n`.repeat(20 + i));
  write('package.json', '{"name":"seed-town","private":true,"scripts":{"test":"node --test"}}\n');
  write('src/server/main.js', "import http from 'node:http';\nhttp.createServer(() => {}).listen(3000);\n");
  write('test/main.test.js', "import {test} from 'node:test';\ntest('example', () => {});\n");
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: temp,
    GIT_AUTHOR_NAME: 'Seed Test', GIT_AUTHOR_EMAIL: 'seed@example.invalid',
    GIT_COMMITTER_NAME: 'Seed Test', GIT_COMMITTER_EMAIL: 'seed@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  for (const args of [['init', '-q', '--initial-branch=main'], ['add', '.'], ['commit', '-qm', 'Create seed fixture']]) {
    const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', env });
    if (r.stderr) process.stderr.write(r.stderr);
    assert.ifError(r.error); assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  const repo = analyzeRepository(root), original = JSON.stringify(repo);
  let greens = 0, stairs = 0;
  const report = fuzzSeeds(repo, manifest, { count: 40, onResult(result, checks) {
    assert.deepEqual(result.problems, [], `head=${result.head} seed=${result.seed}\n${result.problems.join('\n')}`);
    const town = checks.town;
    if (town.terraces.length > 2) greens++;
    const { world } = buildWorld(town, artFrom(manifest));
    for (const s of town.stairs) for (let dx = 0; dx < s.w; dx++) {
      const x = (s.x + dx + 0.5) * 16, north = (s.y - 2) * 16 + 11, south = (s.y + 2) * 16 + 11;
      for (const direction of [-1, 1]) {
        const player = new Player(x, direction < 0 ? south : north, null);
        assert.equal(world.feetHit(player.x, player.y), false, '階段の前後に立てる');
        const input = { slow: false, axis(o) { o.x = 0; o.y = direction; return o; } };
        for (let n = 0; n < 100; n++) player.update(SIM_DT, input, world);
        assert.ok(direction < 0 ? player.y <= north : player.y >= south,
          `head=${result.head}: stair (${s.x},${s.y}) column=${dx} direction=${direction} end=${player.y}`);
      }
      stairs++;
    }
  } });
  assert.equal(report.failed, 0);
  assert.equal(JSON.stringify(repo), original, 'head以外のモデルと元のheadを変更しない');
  assert.ok(stairs > 0);
  assert.ok(greens > 0, '安全な緑地の段まで一律に除かない');
  t.diagnostic(`40種、階段${stairs}列の上下移動、緑地の段が残る街${greens}件`);
});

test('東向きの水路口が建物に重なる種と、橋の柱脇がふさがる種を再検査する', { timeout: 30000 }, (t) => {
  mkdirSync(base, { recursive: true });
  const temp = mkdtempSync(join(base, 'canal-seed-test-')), root = join(temp, 'gridhub');
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  // 報告された街と同じ地区・建物サイズを作る。実リポジトリやその内容には依存しない。
  // 名前も種の一部なので gridhub に固定し、ファイルはすべて一時フォルダで生成する。
  const modules = [
    ['.', 6, 762], ['.claude', 1, 50], ['.masume', 1, 833],
    ['.masume/maps', 24, 24], ['.masume/outputs', 149, 33825], ['bin', 2, 235],
    ['demos', 19, 2661], ['docs', 27, 3669], ['examples/kakeibo', 58, 30153],
    ['examples/memo', 61, 3281], ['examples/omikuji', 46, 29812], ['quests', 12, 4136],
    ['site', 31, 1416], ['src', 2, 321], ['src/commands', 31, 1382], ['src/engine', 24, 4899],
    ['src/linear', 6, 636], ['src/mcp', 3, 513], ['src/party', 5, 1001], ['src/quest', 8, 1311],
    ['src/server', 4, 1801], ['tests', 10, 1514], ['tests/e2e', 128, 17366], ['tools', 1, 189],
    ['web', 2, 427], ['web/assets', 41, 865], ['web/board', 57, 21214], ['web/fixtures', 6, 20009],
  ];
  for (const [path, count, lines] of modules) {
    mkdirSync(join(root, path), { recursive: true });
    for (let i = 0; i < count; i++) {
      let file = `sample${i}.txt`, text = 'sample\n'.repeat(i === 0 ? lines - count + 1 : 1);
      if (path === 'tests' || path === 'tests/e2e') file = `sample${i}.test.js`;
      if ((path === 'site' || path === 'web') && i < 2) file = `sample${i}.html`;
      if (path === '.' && i === 0) {
        file = 'package.json';
        text = '{"name":"gridhub","version":"1.0.0","main":"index.js","scripts":{"test":"node --test"}}\n';
      }
      if (path === 'src/server' && i === 0) {
        file = 'index.js';
        text = "import http from 'node:http';http.createServer(()=>{}).listen(3000);\nprocess.env.SAMPLE_ROUTE;\n" + text;
      }
      if (path === 'src/engine' && i === 0) {
        file = 'index.js';
        text = 'process.env.SAMPLE_ONE;process.env.SAMPLE_TWO;process.env.SAMPLE_THREE;\n' + text;
      }
      if (path === 'src/linear' && i === 0) {
        file = 'index.js';
        text = "fetch('https://api.openai.com/v1/models');\n" + text;
      }
      writeFileSync(join(root, path, file), text);
    }
  }
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: base,
    GIT_AUTHOR_NAME: 'Seed Test', GIT_AUTHOR_EMAIL: 'seed@example.invalid',
    GIT_COMMITTER_NAME: 'Seed Test', GIT_COMMITTER_EMAIL: 'seed@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  for (const args of [['init', '-q', '--initial-branch=main'], ['add', '.'], ['commit', '-qm', 'Create canal seed fixture']]) {
    const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', env });
    assert.ifError(r.error); assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  const repo = analyzeRepository(root);
  for (const start of [0x21, 0x36]) {
    const report = fuzzSeeds(repo, manifest, { start, count: 1, onResult(result, checks) {
      assert.deepEqual(result.problems, [], `head=${result.head} seed=${result.seed}\n${result.problems.join('\n')}`);
      assert.ok(checks.town.props.some((p) => p.type === 'canal-mouth'), '口を削除して通過させない');
      assert.ok(checks.town.canal?.crossings.length > 0, '橋を含む水路が置かれる');
      assert.deepEqual(checks.town.canal.past, ['src/engine'], '設定地区を経由する');
    } });
    assert.equal(report.failed, 0);
  }
});

test('切り出しや水路で階段の前後を失った緑地だけを平地に戻す', () => {
  const make = () => {
    const cols = 20, rows = 16, id = (x, y) => y * cols + x;
    const terrace = { x: 4, y: 4, w: 8, h: 6, green: {}, stair: { x: 7, w: 2 } };
    const P = { cols, rows, N: cols * rows, id, placed: [], foot: new Int32Array(cols * rows).fill(-1), terraces: [terrace] };
    const F = { g: new Uint8Array(cols * rows).fill(GRASS), crop: { x0: 0, y0: 0, x1: 19, y1: 15 } };
    for (let x = 0; x < cols; x++) F.g[id(x, 11)] = STREET;
    return { P, F };
  };
  for (const obstruction of ['none', 'crop', 'water']) {
    const { P, F } = make();
    if (obstruction === 'crop') F.crop.y1 = 9; // 上面はあるが、階段の行は切り落とされた
    if (obstruction === 'water') F.g[P.id(7, 11)] = WATER;
    keepReachableTerraces(P, F, { x: 2, y: 7 });
    assert.equal(P.terraces.length, obstruction === 'none' ? 1 : 0, obstruction);
  }
});

test('小物と重ならなくても地図の外にある階段は歩行検査で失敗する', () => {
  const town = { repo: { name: 'cropped-stair' }, cols: 12, rows: 10, ground: Array(10).fill('+'.repeat(12)),
    spawn: { x: 4, y: 5 }, buildings: [], props: [], residents: [],
    terraces: [{ x: 3, y: 8, w: 6, h: 2 }], stairs: [{ x: 5, y: 10, w: 2 }] };
  const result = checkPlay(town, manifest);
  assert.ok(result.failed);
  assert.ok(result.problems.some((p) => p.includes('stair (5,10,2) cannot be stood on')));
});
