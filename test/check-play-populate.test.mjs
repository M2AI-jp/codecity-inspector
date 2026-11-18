import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { townFor } from '../tools/check-play/town.mjs';
import { checkPlay, artFrom, buildWorld } from '../tools/check-play.mjs';
import { inhabitantArt } from '../tools/check-play/inhabitants.mjs';
import { createCreatures } from '../web/creatures.js';
import { defaultManifest } from '../src/overlay/place.mjs';
import { readOverlay } from '../src/overlay/read.mjs';
import { simpleTown } from './helpers/overlay-fixtures.mjs';

const manifest = defaultManifest();
const root = fileURLToPath(new URL('../', import.meta.url));
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'check-play-populate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function inhabitedTown() {
  const town = simpleTown();
  town.groundImage = '/ground.png';
  town.residents = [{ id: 'r1', name: 'Author', homes: ['b1', 'b2'], look: 0 }];
  town.contractors = [{ id: 'a1', name: 'Codex', homes: ['b1', 'b2'], commits: 1 }];
  town.crowd = [{ id: 'c1', home: 'b2', look: 1, fact: 0 }];
  town.creatures = [
    { kind: 'pigeon', name: 'dependency', home: { x: 5.5, y: 18.7 }, flock: 0 },
    { kind: 'dog', name: 'dependabot', home: { x: 14.5, y: 18.7 } },
    { kind: 'cat', name: 'job', home: { x: 25.5, y: 18.7 }, meaning: 'job' },
  ];
  return town;
}

test('check-play builds exactly the CLI Town, with bot/agent deduplication before overlay', async (t) => {
  const dir = temporary(t), repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(repo, 'package.json'), '{"name":"sample","dependencies":{"express":"*"}}\n');
  writeFileSync(join(repo, 'main.js'), 'export const value = 1;\n');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'dependabot[bot]', GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env });
  git('init', '--quiet'); git('add', '.'); git('commit', '--quiet', '-m', 'Add package');
  env.GIT_AUTHOR_NAME = 'claude[bot]';
  writeFileSync(join(repo, 'main.js'), 'export const value = 2;\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'Add generated work');
  const overlayFile = join(dir, 'overlay.json');
  writeFileSync(overlayFile, JSON.stringify({ version: 1, seed: 'populated', groups: [{ id: 'app', paths: ['**'] }],
    markers: [{ id: 'note', kind: 'board', at: { group: 'app' }, label: 'Note' }],
    goal: { at: { landmark: 'town_hall' }, label: 'Goal', look: 'castle' } }));
  for (const overlay of [undefined, readOverlay(overlayFile)]) {
    const { town } = await townFor(repo, manifest, overlay);
    // /dev/stdout は CI（Linux・パイプ）で開けないことがあるので、一時ファイルに書いて読む
    const out = join(dir, overlay ? 'cli-overlay.json' : 'cli.json');
    execFileSync(process.execPath, [join(root, 'codecity.mjs'), repo,
      ...(overlay ? ['--overlay', overlayFile] : []), '--json', out], { encoding: 'utf8' });
    const cliJSON = readFileSync(out, 'utf8').trimEnd();
    const hash = (s) => createHash('sha256').update(s).digest('hex');
    assert.equal(hash(JSON.stringify(town, null, 1)), hash(cliJSON));
    assert.equal(town.groundImage, '/ground.png');
    assert.ok(town.creatures.some((c) => c.kind === 'dog' && c.name === 'dependabot'));
    assert.ok(town.creatures.some((c) => c.kind === 'pigeon' && c.name === 'express'));
    assert.equal(town.contractors[0].name, 'Claude Code');
    assert.ok(!town.residents.some((r) => /dependabot|claude/i.test(r.name)));
  }
});

test('saved Town is not populated again; absent population fields produce a warning', async (t) => {
  const file = join(temporary(t), 'town.json'), town = inhabitedTown();
  writeFileSync(file, JSON.stringify(town));
  const before = readFileSync(file, 'utf8');
  const loaded = await townFor(file, manifest);
  assert.deepEqual(loaded.town, town);
  assert.deepEqual(loaded.warnings, []);
  assert.equal(readFileSync(file, 'utf8'), before);
  delete town.creatures; delete town.contractors;
  writeFileSync(file, JSON.stringify(town));
  const legacy = await townFor(file, manifest);
  assert.deepEqual(legacy.town, town);
  assert.match(legacy.warnings[0], /creatures, contractors/);
  await assert.rejects(townFor(file, manifest, { version: 1 }), /requires a repository/);
});

test('check-play sees the browser inhabitants and identical initial positions without a DOM', () => {
  const town = inhabitedTown(), before = JSON.stringify(town);
  const checked = checkPlay(town, manifest);
  assert.equal(checked.failed, 0, checked.lines.join('\n'));
  const { world, npcs } = buildWorld(town, inhabitantArt(artFrom(manifest), manifest));
  for (const [kind, list] of [['residents', npcs.walkers], ['contractors', npcs.contractors], ['locals', npcs.locals]]) {
    assert.equal(checked.inhabitants[kind].created, list.length);
    assert.deepEqual(checked.inhabitants[kind].entries.map(({ x, y }) => [x, y]), list.map(({ x, y }) => [x, y]));
  }
  const creatures = createCreatures(town, world, Object.fromEntries(Object.keys(manifest.creatures).map((k) => [k, {}])));
  assert.deepEqual(checked.inhabitants.creatures.entries.map(({ x, y }) => [x, y]), creatures.list.map(({ x, y }) => [x, y]));
  assert.ok(checked.inhabitants.creatures.entries.every((c) => c.talk));
  assert.equal(JSON.stringify(town), before);
});

test('a contractor home surrounded by water fails the shared checks and the CLI', (t) => {
  const town = inhabitedTown();
  town.ground = town.ground.map((r, y) => y <= 12 ? '~'.repeat(13) + r.slice(13) : r);
  const checked = checkPlay(town, manifest);
  assert.ok(checked.inhabitants.contractors.failed > 0);
  assert.ok(checked.inhabitants.residents.failed > 0);
  assert.ok(checked.inhabitants.contractors.entries[0].reasons.some((r) => r.includes('home b1')));
  const file = join(temporary(t), 'water-home.json');
  writeFileSync(file, JSON.stringify(town));
  const cli = spawnSync(process.execPath, [join(root, 'tools/check-play.mjs'), file], { encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /x contractors a1 Codex/);
});

test('creatures inside buildings, on water, invalid or beyond reachable ground fail', () => {
  for (const condition of ['building', 'water', 'invalid', 'isolated']) {
    const town = inhabitedTown();
    town.creatures = [town.creatures[0]];
    const c = town.creatures[0];
    if (condition === 'building') c.home = { x: 7, y: 6.7 };
    if (condition === 'water') {
      c.home = { x: 5.5, y: 18.7 };
      town.ground[18] = '~'.repeat(12) + town.ground[18].slice(12);
    }
    if (condition === 'invalid') delete c.home;
    if (condition === 'isolated') {
      town.buildings = []; town.residents = []; town.contractors = []; town.crowd = [];
      town.spawn = { x: 4, y: 16 }; c.home = { x: 25.5, y: 18.7 };
      town.ground = town.ground.map((r) => r.slice(0, 12) + '~~~~~~~' + r.slice(19));
    }
    const checked = checkPlay(town, manifest);
    assert.equal(checked.inhabitants.creatures.failed, 1, condition);
    const reasons = checked.inhabitants.creatures.entries[0].reasons.join('; ');
    if (condition === 'building') assert.match(reasons, /inside building b1/);
    if (condition === 'water') assert.match(reasons, /not free/);
    if (condition === 'invalid') assert.match(reasons, /invalid home/);
    if (condition === 'isolated') {
      assert.doesNotMatch(reasons, /not free/);
      assert.match(reasons, /no reachable player position/);
    }
  }
});

test('missing contractor homes or art cannot silently reduce the checked population', () => {
  const town = inhabitedTown();
  town.contractors[0].homes = ['missing'];
  let checked = checkPlay(town, manifest);
  assert.equal(checked.inhabitants.contractors.created, 0);
  assert.equal(checked.inhabitants.contractors.failed, 1);
  assert.match(checked.inhabitants.contractors.entries[0].reasons.join(';'), /does not exist/);
  const noFolk = structuredClone(manifest);
  noFolk.characters.townsfolk = []; delete noFolk.characters.contractor;
  checked = checkPlay(inhabitedTown(), noFolk);
  assert.equal(checked.inhabitants.contractors.created, 0);
  assert.equal(checked.inhabitants.contractors.failed, 1);
  assert.equal(checked.inhabitants.residents.failed, 1);
});
