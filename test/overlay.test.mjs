import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { parseOverlay, validateOverlay, readOverlay, MAX_BYTES } from '../src/overlay/read.mjs';
import { globMatch, applyGroups } from '../src/overlay/groups.mjs';
import { resolveAt } from '../src/overlay/resolve.mjs';
import { placeOverlay, defaultManifest } from '../src/overlay/place.mjs';
import { createOverlaySession } from '../src/overlay/live.mjs';
import { analyzeOverlayModel, groupOverlayModel } from '../src/overlay/model.mjs';
import { layoutTown } from '../src/layout.mjs';
import { serveTown } from '../src/serve.mjs';
import { diffById, Overlay } from '../web/overlay.js';
import { artFrom, buildWorld, checkPlay } from '../tools/check-play.mjs';
import { checkSeed, fuzzSeeds } from '../tools/seed-fuzz.mjs';
import { propCells } from '../src/town-grid.mjs';
import { loadProps } from '../src/layout/manifest.mjs';
import { overlayPeople } from '../web/overlay-world.js';
import { overlayGround } from '../src/overlay/terrain.mjs';

const manifest = defaultManifest();
const base = resolve('compare');
function fixture(t) {
  mkdirSync(base, { recursive: true });
  const temp = mkdtempSync(join(base, 'overlay-test-')), dir = join(temp, 'repo');
  mkdirSync(dir, { recursive: true });
  // 親の作業フォルダ（CI の clone など）を、見本のリポジトリとして拾わない（test/groups.test.mjs と同じ）
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = temp;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
    rmSync(temp, { recursive: true, force: true });
  });
  return dir;
}
function simpleTown() {
  const building = (id, x, path, group = 'g') => ({
    id, archetype: 'house_s', x, y: 4, w: 6, h: 4, door: { x: x + 2, y: 7 }, district: group,
    module: { path, group, kind: 'house', files: 1, lines: 20, languages: {}, authors: [], topFiles: [], commits: 0, recent: 0 },
  });
  return { version: 1, repo: { name: 'overlay-fixture' }, cols: 32, rows: 24,
    ground: Array(24).fill('+'.repeat(32)), buildings: [building('b1', 4, 'src'), building('b2', 16, 'lib')],
    props: [], landmarks: [], residents: [], crowd: [], terraces: [], stairs: [], spawn: { x: 14, y: 16 } };
}
const record = (id, at = { building: 'b1' }, state = 'unverified') => ({ id, kind: 'record', state, at, label: id, lines: ['記録'] });
const parsed = (fields = {}) => validateOverlay({ version: 1, ...fields });

test('overlay: bounded local file, malformed JSON, version and CLI exit codes', (t) => {
  const dir = fixture(t), file = join(dir, 'overlay.json');
  for (const [input, reason] of [['{', /JSON/], ['{"version":2}', /version/], ['x'.repeat(MAX_BYTES + 1), /1,000,000/]]) {
    writeFileSync(file, input);
    assert.throws(() => readOverlay(file), reason);
    const run = spawnSync(process.execPath, ['codecity.mjs', dir, '--overlay', file, '--json', join(dir, 'town.json')], { encoding: 'utf8' });
    assert.equal(run.status, 1); assert.match(run.stderr, reason);
  }
  const valid = '{"version":1}';
  assert.equal(parseOverlay(valid + ' '.repeat(MAX_BYTES - Buffer.byteLength(valid))).version, 1);
  assert.throws(() => readOverlay('https://example.invalid/overlay.json'), /local/);
  assert.throws(() => readOverlay(dir), /regular file/);
  assert.throws(() => validateOverlay({ version: 1, seed: 2 }), /seed/);
  assert.throws(() => parseOverlay(Buffer.concat([Buffer.from('{"version":1,"source":{"name":"'), Buffer.from([0xff]), Buffer.from('"}}')])), /JSON/);
});

test('overlay: code point limits and excess entries have explicit diagnostics', () => {
  const a = record('ok'); a.label = '😀'.repeat(60); a.lines = Array(6).fill('😀'.repeat(80));
  assert.equal(parsed({ markers: [a] }).markers.length, 1);
  const fields = { markers: [
    { ...a, id: 'label', label: a.label + '字' },
    { ...a, id: 'line', lines: ['😀'.repeat(81)] },
    { ...a, id: 'count', lines: Array(7).fill('字') },
  ], people: [{ id: 'person', name: '字'.repeat(61), at: { building: 'b1' } }],
  title: { text: 'title', sub: '😀'.repeat(81) } };
  const result = parsed(fields);
  assert.equal(result.markers.length, 0); assert.equal(result.people.length, 0); assert.equal(result.rejected.length, 5);
  const caps = parsed({ markers: Array.from({ length: 2001 }, (_, i) => record(`r${i}`)),
    people: Array.from({ length: 101 }, (_, i) => ({ id: `p${i}`, name: '人', at: { group: 'empty' } })) });
  assert.equal(caps.markers.length, 2000); assert.equal(caps.people.length, 100);
  assert.deepEqual(caps.rejected.map((r) => r.reason), ['markers limit: 2000', 'people limit: 100']);
});

test('overlay: namespace, critical groups, invalid at and producer diagnostics', () => {
  const result = parsed({ groups: [{ id: 'same', paths: [] }], markers: [record('same')],
    people: [{ id: 'same', name: 'duplicate', at: { group: 'same' } }],
    goal: { label: 'end', at: { landmark: 'town_hall' } }, unplaced: [{ id: 'producer', reason: 'ignore' }] });
  assert.equal(result.markers.length, 1); assert.equal(result.rejected[0].reason, 'duplicate id');
  assert.equal(result.goal.id, '$goal'); assert.equal(result.unplaced, undefined);
  for (const groups of [[{ id: 'g', paths: ['../escape'] }], [{ id: 'g', paths: [] }, { id: 'g', paths: [] }]]) {
    assert.throws(() => parsed({ groups }), /group/);
  }
  assert.throws(() => parsed({ seed: 'x'.repeat(MAX_BYTES) }), /seed and groups/);
  const invalid = parsed({ markers: [{ ...record('bad'), at: { marker: 'other' } }, { ...record('bad2'), at: { path: '/etc/passwd' } }] });
  assert.equal(invalid.rejected.length, 2);
});

test('overlay: glob **, *, ?, literal punctuation, first matching group and complete file ownership', (t) => {
  for (const [pattern, path, expected] of [
    ['src/**', 'src', true], ['src/**', 'src/a/b.js', true], ['src/**/*.js', 'src/a.js', true],
    ['src/*.js', 'src/a/b.js', false], ['web/?.js', 'web/字.js', true], ['web/?.js', 'web/ab.js', false],
    ['a[1].js', 'a[1].js', true], ['a[1].js', 'a1.js', false], ['**/x', 'x', true],
  ]) assert.equal(globMatch(pattern, path), expected, `${pattern} -> ${path}`);
  const dir = fixture(t);
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (let i = 0; i < 12; i++) writeFileSync(join(dir, `src/file${i}.js`), 'line\n'.repeat(20 - i));
  const model = analyzeOverlayModel(dir);
  const ov = parsed({ groups: [{ id: 'first', paths: ['src/file11.js'] }, { id: 'second', paths: ['src/**'] }] });
  assert.equal(groupOverlayModel(model, ov).modules.find((m) => m.path === 'src').group, 'first');
  assert.equal(model.modules[0].group, undefined, 'does not mutate the repository facts');
  assert.equal(applyGroups(model, [{ id: 'none', paths: ['missing/**'] }]).modules[0].group, undefined);
});

test('overlay: deepest absorbed module, group and landmark fallbacks', () => {
  const town = simpleTown();
  town.buildings[0].module.merged = ['src/deep'];
  town.buildings[1].module.path = 'src/deepest';
  assert.equal(resolveAt(town, { path: 'src/deep/file.mjs' }).building.id, 'b1');
  assert.equal(resolveAt(town, { path: 'src/deepest/file.mjs' }).building.id, 'b2');
  assert.deepEqual(resolveAt(town, { path: 'unknown/path' }), { ...town.spawn, plaza: true });
  town.landmarks.push({ archetype: 'well', x: 14, y: 12 });
  assert.deepEqual(resolveAt(town, { landmark: 'gate' }), { x: 14, y: 12, plaza: true });
  town.buildings[1].archetype = 'town_hall';
  assert.equal(resolveAt(town, { path: 'unknown/path' }).building.id, 'b2');
  assert.equal(resolveAt(town, { group: 'empty' }, { kind: 'board' }).plaza, true);
  assert.equal(resolveAt(town, { group: 'empty' }, { kind: 'person' }).plaza, true);
  assert.equal(resolveAt(town, { group: 'empty' }, { kind: 'record' }).reason, 'group has no building');
  assert.equal(resolveAt(town, { marker: 'unplaced' }, { kind: 'person' }).reason, 'marker not placed');
});

test('overlay: one object per doorway, overflow within district, protected door front, deterministic positions', () => {
  const base = simpleTown(), before = JSON.stringify(base);
  const ov = parsed({ markers: [record('one'), record('two'), record('three'), { ...record('alien'), kind: 'castle' }] });
  const town = placeOverlay(base, ov, manifest);
  assert.equal(town.overlay.markers.length, 2);
  assert.deepEqual(town.overlay.markers.map((m) => m.building), ['b1', 'b2']);
  assert.ok(town.unplaced.some((u) => u.id === 'three' && u.reason));
  assert.ok(town.unplaced.some((u) => u.id === 'alien' && u.reason === 'unknown kind'));
  const { world } = buildWorld(town, artFrom(manifest));
  for (const prop of town.overlay.props) for (const [x, y] of propCells(prop, loadProps(manifest))) {
    assert.ok(!world.buildings.some((b) => x >= b.doorX0 - 1 && x <= b.doorX1 && y >= b.y + b.h && y <= b.y + b.h + 1));
  }
  assert.equal(JSON.stringify(placeOverlay(base, ov, manifest)), JSON.stringify(town));
  assert.equal(JSON.stringify(base), before);
  assert.equal(checkPlay(town, manifest).failed, 0);
});

test('overlay: record replaces dojo sign without changing repository state; removing it restores the sign', () => {
  const base = simpleTown();
  base.props.push({ type: 'sign-failed', x: 28.5, y: 20 });
  const ov = parsed({ markers: [record('record')] });
  const town = placeOverlay(base, ov, manifest);
  assert.equal(town.props.filter((p) => p.type.startsWith('sign-')).length, 1);
  assert.equal(town.props.find((p) => p.type.startsWith('sign-')).type, 'sign-unverified');
  const noRecords = placeOverlay(base, parsed(), manifest);
  assert.equal(noRecords.props.find((p) => p.type.startsWith('sign-')).type, 'sign-failed');
  assert.equal(base.props[0].type, 'sign-failed');
});

test('overlay: people, goal, absent groups and unresolved marker are accounted for', () => {
  const ov = parsed({ markers: [{ id: 'board', kind: 'board', label: '広場', at: { group: 'absent' } }],
    people: [{ id: 'person', name: '住人', at: { marker: 'board' } },
      { id: 'plaza', name: '広場の人', at: { group: 'absent' } },
      { id: 'missing', name: '未配置', at: { marker: 'missing' } }],
    goal: { label: '終点', at: { landmark: 'town_hall' } } });
  const town = placeOverlay(simpleTown(), ov, manifest), result = checkPlay(town, manifest);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.overlay.markers, { reachable: 1, total: 1 });
  assert.deepEqual(result.overlay.people, { reachable: 2, total: 2 });
  assert.deepEqual(result.overlay.goal, { reachable: 1, total: 1 });
  assert.equal(town.overlay.people[0].look, placeOverlay(simpleTown(), ov, manifest).overlay.people[0].look);
  assert.ok(town.unplaced.some((u) => u.id === 'missing' && u.reason === 'marker not placed'));
});

test('overlay: a gate needs an actual walkable cut point and a reachable guard', () => {
  const ov = parsed({ markers: [{ id: 'gate', kind: 'gate', label: '門', at: { landmark: 'gate' } }] });
  const open = placeOverlay(simpleTown(), ov, manifest);
  assert.equal(open.overlay.markers.length, 0);
  assert.match(open.unplaced[0].reason, /cut point/);
  const town = simpleTown(); town.buildings = []; town.cols = 24; town.rows = 20; town.spawn = { x: 10, y: 15 };
  const ground = Array.from({ length: 20 }, () => Array(24).fill(' '));
  for (let y = 1; y <= 18; y++) for (let x = 2; x <= 21; x++) {
    if (y <= 5 || y >= 10 || x === 10) ground[y][x] = '+';
  }
  for (const x of [7, 8, 12, 13]) ground[7][x] = '.';
  town.ground = ground.map((row) => row.join(''));
  const placed = placeOverlay(town, ov, manifest);
  assert.equal(placed.overlay.markers.length, 1, JSON.stringify(placed.unplaced));
  assert.ok(placed.overlay.markers[0].keeper);
  const checked = checkPlay(placed, manifest);
  assert.equal(checked.failed, 0, checked.lines.join('\n'));
});

test('overlay: live state update changes only one resolved record and no positions', () => {
  const base = simpleTown(), original = parsed({ markers: [record('one'), record('two')] });
  const changed = parsed({ markers: [record('one', { building: 'b1' }, 'passed'), record('two')] });
  const before = placeOverlay(base, original, manifest).overlay, after = placeOverlay(base, changed, manifest).overlay;
  const diff = diffById(before.markers, after.markers);
  assert.deepEqual(diff.changed.map((m) => m.id), ['one']);
  assert.equal(diff.unchanged[0], before.markers[1]);
  assert.equal(diff.added.length + diff.removed.length, 0);
  assert.equal(before.layoutKey, after.layoutKey);
  assert.deepEqual(before.markers.map(({ id, x, y }) => ({ id, x, y })), after.markers.map(({ id, x, y }) => ({ id, x, y })));
});

test('overlay: live serving validates only the named file, retains good snapshots and rebuilds only seed/groups', async (t) => {
  const dir = fixture(t), file = join(dir, 'overlay.json'), baseTown = simpleTown();
  let input = { version: 1, seed: 'a', markers: [record('one')] }, builds = 0;
  writeFileSync(file, JSON.stringify(input));
  const overlay = readOverlay(file), town = placeOverlay(baseTown, overlay, manifest);
  const session = createOverlaySession({ file, overlay, baseTown, town, manifest, makeBase() { builds++; return simpleTown(); } });
  const { server, url } = await serveTown(town, { port: 0, ground: Buffer.from('test'), overlaySession: session });
  t.after(() => new Promise((ok) => server.close(ok)));
  const initial = await (await fetch(url + 'overlay.json')).json();
  input.markers[0].state = 'passed'; writeFileSync(file, JSON.stringify(input));
  const next = await (await fetch(url + 'overlay.json')).json();
  assert.notEqual(next.revision, initial.revision); assert.equal(next.layoutKey, initial.layoutKey); assert.equal(builds, 0);
  writeFileSync(file, '{');
  assert.equal((await fetch(url + 'overlay.json')).status, 422);
  assert.equal((await (await fetch(url + 'town.json')).json()).overlay.revision, next.revision);
  input.seed = 'b'; writeFileSync(file, JSON.stringify(input));
  assert.notEqual((await (await fetch(url + 'overlay.json')).json()).layoutKey, next.layoutKey); assert.equal(builds, 1);
  input.groups = [{ id: 'g', paths: ['src/**'] }]; writeFileSync(file, JSON.stringify(input));
  await fetch(url + 'overlay.json'); assert.equal(builds, 2);
  const forbidden = await new Promise((ok, fail) => {
    const req = request(url + 'overlay.json', { headers: { Host: 'example.invalid' } }, (res) => { res.resume(); ok(res.statusCode); });
    req.on('error', fail); req.end();
  });
  assert.equal(forbidden, 403);
  assert.equal((await fetch(url + 'overlay.json', { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + 'overlay.json?path=/etc/passwd')).status, 200);
  assert.equal((await fetch(url + 'overlay.json/../private')).status, 404);
});

test('overlay: seed is layout-only and seed-fuzz changes it without changing HEAD or facts', (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'test', 'sample.test.mjs'), "import {test} from 'node:test'; test('sample',()=>{});");
  const model = analyzeOverlayModel(dir);
  const original = JSON.stringify(model), heads = [], seeds = [];
  const overlay = parsed({ seed: 'stable', title: { text: 'first' } });
  const report = fuzzSeeds(model, manifest, { count: 2, overlay, layout(repo, opts) {
    heads.push(repo.head); seeds.push(opts.seed); return layoutTown(repo, opts);
  } });
  assert.equal(report.failed, 0, JSON.stringify(report.results));
  assert.ok(heads.every((head) => head === model.head)); assert.equal(new Set(seeds).size, 2);
  assert.equal(JSON.stringify(model), original);
  assert.equal(JSON.stringify(checkSeed(model, manifest, { overlay }).town.buildings),
    JSON.stringify(checkSeed(model, manifest, { overlay: { ...overlay, title: { text: 'renamed' } } }).town.buildings));
});

test('overlay: isolated canal-side dirt is restored without moving a road or changing collisions', () => {
  const town = simpleTown(), ground = town.ground.map((row) => [...row]);
  for (let y = 10; y < 24; y++) { ground[y][25] = '~'; ground[y][26] = '~'; }
  ground[14][27] = ':'; ground[13][27] = ground[15][27] = ground[14][28] = '.';
  ground[18][27] = ground[18][28] = ':'; // connected path must remain
  town.ground = ground.map((row) => row.join(''));
  town.canal = { cells: Array.from({ length: 14 }, (_, i) => [[25, i + 10], [26, i + 10]]).flat(), crossings: [] };
  const fixed = overlayGround(town);
  assert.equal(fixed[14][27], '.'); assert.equal(fixed[18][27], ':');
  assert.equal(town.ground[14][27], ':');
  const before = buildWorld(town, artFrom(manifest)).world;
  const after = buildWorld({ ...town, ground: fixed }, artFrom(manifest)).world;
  assert.deepEqual(after.tileSolid, before.tileSolid);
  assert.deepEqual(after.rects, before.rects);
  assert.equal(overlayGround({ ...town, canal: undefined }), town.ground);
});

test('overlay: runtime retains unchanged objects, removes people collisions, and defers changes onto the player', () => {
  const base = simpleTown(), initial = { markers: [record('one'), record('two')],
    people: [{ id: 'a', name: 'A', at: { group: 'missing' } }, { id: 'b', name: 'B', at: { group: 'missing' } }] };
  const town = placeOverlay(base, parsed(initial), manifest), art = artFrom(manifest);
  art.townsfolk = [{}];
  const { world, start } = buildWorld(town, art), player = { x: start.x, y: start.y };
  const controller = Object.assign(Object.create(Overlay.prototype), {
    town, world, art, characters: [player], data: town.overlay, people: new Map(),
    markers: new Map(town.overlay.markers.map((m) => [m.id, m])),
    metrics: { updates: 0, markerChanges: 0, personChanges: 0, propChanges: 0, reloads: 0, deferred: 0 },
    title() {}, reload() { throw new Error('unexpected reload'); },
  });
  for (const p of overlayPeople(town.overlay)) controller.addPerson(p);
  const first = controller.people.get('person:a'), second = controller.people.get('person:b');
  const beforeMarkers = new Map(controller.markers), beforeProps = new Map(world.props.map((p) => [p.data.overlayId, p]));
  const renamed = { ...initial, people: [{ ...initial.people[0], name: 'A renamed' }, initial.people[1]] };
  assert.equal(controller.apply(placeOverlay(base, parsed(renamed), manifest).overlay), true);
  assert.notEqual(controller.people.get('person:a'), first);
  assert.equal(controller.people.get('person:b'), second);
  for (const [id, m] of beforeMarkers) assert.equal(controller.markers.get(id), m);
  for (const p of world.props) assert.equal(beforeProps.get(p.data.overlayId), p);
  assert.equal(world.rects.filter((r) => r.overlayPerson).length, 2);
  const removed = { ...initial, people: [initial.people[1]] };
  const next = placeOverlay(base, parsed(removed), manifest).overlay;
  assert.equal(controller.apply(next), true);
  assert.equal(world.rects.filter((r) => r.overlayPerson).length, 1);
  assert.equal(world.rects.some((r) => r.overlayPerson === 'person:a'), false);
  const addition = { ...initial, people: [...removed.people, { id: 'c', name: 'C', at: { group: 'missing' } }] };
  const addData = placeOverlay(base, parsed(addition), manifest).overlay;
  const person = addData.people.find((p) => p.id === 'c');
  player.x = person.x * 16; player.y = person.y * 16;
  const revision = controller.data.revision;
  assert.equal(controller.apply(addData), false); assert.equal(controller.data.revision, revision);
  assert.equal(controller.metrics.deferred, 1);
  player.x = start.x; player.y = start.y;
  assert.equal(controller.apply(addData), true);
  assert.equal(controller.people.has('person:c'), true);
  assert.equal(world.rects.filter((r) => r.overlayPerson).length, 2);
});
