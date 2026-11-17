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
