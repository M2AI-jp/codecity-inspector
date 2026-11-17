import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRepository } from '../src/analyze.mjs';
import { validateOverlay } from '../src/overlay/read.mjs';
import { placeOverlay, defaultManifest, layoutKey } from '../src/overlay/place.mjs';
import { goalGeometry } from '../src/overlay/goal.mjs';
import { layoutTown, loadArt, loadProps, loadGround } from '../src/layout.mjs';
import { artFrom, buildWorld, checkPlay } from '../tools/check-play.mjs';
import { checkSeed, fuzzSeeds } from '../tools/seed-fuzz.mjs';
import { propCells } from '../src/town-grid.mjs';
import { resolveAt } from '../src/overlay/resolve.mjs';

const manifest = defaultManifest();
const goal = { at: { landmark: 'town_hall' }, label: '完了', lines: ['城の候補'], look: 'castle' };
const overlay = (g = goal, extra = {}) => validateOverlay({ version: 1, goal: g, ...extra });
const openTown = () => ({
  version: 1, repo: { name: 'castle-test' }, cols: 40, rows: 34,
  ground: Array(34).fill('+'.repeat(40)), props: [], buildings: [], landmarks: [],
  residents: [], crowd: [], terraces: [], stairs: [], spawn: { x: 20, y: 28 },
});

test('goal.look: omitted stays absent; unknown strings and invalid types are diagnosed', () => {
  const { look, ...plain } = goal;
  assert.equal(Object.hasOwn(overlay(plain).goal, 'look'), false);
  for (const value of ['unknown', '__proto__', 'constructor', '', 2, null, {}]) {
    const result = overlay({ ...goal, look: value });
    assert.equal(result.goal, undefined);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /look/);
    const placed = placeOverlay(openTown(), result, manifest);
    assert.equal(placed.overlay.goal, null);
    assert.equal(placed.props.length, 0);
    assert.equal(placed.overlay.unplaced[0].scope, 'goal');
  }
  assert.notEqual(layoutKey(overlay(plain)), layoutKey(overlay()));
  assert.equal(layoutKey(overlay()), layoutKey(overlay({ ...goal, label: '別の名札' })));
  assert.notEqual(layoutKey(overlay()), layoutKey(overlay({ ...goal, at: { path: 'src' } })));
});

test('goal.look: castle is solid, not a building or a deck, with reachable label and clear front', () => {
  const base = openTown(), before = JSON.stringify(base);
  const input = overlay(goal, {
    markers: [{ id: 'board', kind: 'board', label: '掲示板', at: { landmark: 'town_hall' } }],
    people: [{ id: 'person', name: '人', at: { landmark: 'town_hall' } }],
  });
  const town = placeOverlay(base, input, manifest), g = town.overlay.goal;
  assert.ok(g, JSON.stringify(town.unplaced));
  assert.equal(JSON.stringify(base), before);
  assert.deepEqual(town.buildings, base.buildings);
  assert.deepEqual(town.landmarks, base.landmarks);
  const prop = town.props.find((p) => p.overlayId === 'goal:$goal');
  assert.equal(prop.look, 'castle-1');
  const def = manifest.props[prop.look], geo = goalGeometry(prop, def);
  assert.equal(def.deck, undefined);
  assert.deepEqual(def.solid, [-96, -96, 192, 96]);
  const { world } = buildWorld(town, artFrom(manifest));
  assert.equal(world.feetHit(prop.x * 16, prop.y * 16 - 20), true);
  assert.equal(world.feetHit(g.x * 16, g.y * 16), false);
  for (const r of [geo.front, ...geo.sides]) assert.equal(world.boxHits(r.x, r.y, r.x + r.w, r.y + r.h), false);
  const reserved = new Set(geo.clearance.map(([x, y]) => `${x},${y}`));
  for (const p of town.props.filter((p) => p !== prop)) {
    assert.ok(propCells(p, loadProps(manifest)).every(([x, y]) => !reserved.has(`${x},${y}`)));
  }
  const checked = checkPlay(town, manifest);
  assert.equal(checked.failed, 0, checked.lines.join('\n'));
  assert.deepEqual(checked.overlay.goal, { reachable: 1, total: 1 });
  assert.deepEqual(checked.overlay.goalFront, { reachable: 28, total: 28 });
  assert.equal(JSON.stringify(placeOverlay(base, input, manifest)), JSON.stringify(town));
  const blocked = structuredClone(town);
  blocked.props.push({ type: 'barrel', x: g.x, y: prop.y + 1 });
  assert.ok(checkPlay(blocked, manifest).failed > 0, 'front obstruction must fail the check');
  const badLabel = structuredClone(town);
  badLabel.overlay.goal.y = prop.y - .5;
  assert.deepEqual(checkPlay(badLabel, manifest).overlay.goal, { reachable: 0, total: 1 }, 'the label must itself be on walkable ground');
});

test('goal.look: missing art, insufficient space and terrace edges preserve the plain label', () => {
  const { look, ...plain } = goal;
  const labelSurvives = (base, art = manifest) => {
    const result = placeOverlay(base, overlay(), art);
    assert.deepEqual(result.overlay.goal, placeOverlay(base, overlay(plain), art).overlay.goal);
    assert.ok(result.overlay.goal);
    assert.equal(Object.hasOwn(result.overlay.goal, 'look'), false);
    assert.equal(result.props.some((p) => p.overlayId === 'goal:$goal'), false);
    const diagnostic = result.overlay.unplaced.find((u) => u.scope === 'goal');
    assert.equal(diagnostic.id, result.overlay.goal.id);
    assert.equal(diagnostic.part, 'landmark');
    assert.equal(diagnostic.look, 'castle');
    assert.ok(result.unplaced.includes(diagnostic));
    assert.deepEqual(checkPlay(result, art).overlay.goal, { reachable: 1, total: 1 });
    return result;
  };
  const noArt = structuredClone(manifest); delete noArt.props['castle-1'];
  const missing = labelSurvives(openTown(), noArt);
  assert.match(missing.overlay.unplaced[0].reason, /missing solid goal art/);
  const tiny = openTown(); tiny.cols = 10; tiny.rows = 10; tiny.ground = Array(10).fill('+'.repeat(10)); tiny.spawn = { x: 5, y: 5 };
  const narrow = labelSurvives(tiny);
  assert.match(narrow.overlay.unplaced[0].reason, /no safe level space/);
  assert.equal(narrow.overlay.unplaced[0].site.stage, 'layout');
  assert.ok(narrow.overlay.unplaced[0].attempts.footprint > 0);
  const stepped = openTown();
  // Every six-row footprint crosses a raised edge.
  stepped.spawn.x = 35; // A narrow flat strip still has room for the plain label.
  stepped.terraces = Array.from({ length: 16 }, (_, i) => ({ x: 0, y: i * 2, w: 30, h: 1 }));
  stepped.stairs = stepped.terraces.map((t) => ({ x: 0, y: t.y + 1, w: 1 }));
  const result = labelSurvives(stepped);
  assert.match(result.overlay.unplaced[0].reason, /no safe level space/);
});

test('goal.look: an unreachable label is diagnosed separately from its missing landmark', () => {
  const town = openTown();
  town.ground = Array(town.rows).fill(' '.repeat(town.cols));
  const result = placeOverlay(town, overlay(), manifest);
  assert.equal(result.overlay.goal, null);
  assert.equal(result.overlay.unplaced.length, 2);
  const [landmark, label] = result.overlay.unplaced;
  assert.equal(landmark.part, 'landmark');
  assert.equal(Object.hasOwn(label, 'part'), false);
  assert.equal(label.reason, 'no reachable goal location');
  assert.equal(landmark.id, label.id);
});

test('goal.look: layout reserves a plot without introducing an enterable castle; fuzz counts fronts', () => {
  const repo = {
    name: 'goal-layout', head: 'abc1234', modules: [
      { path: 'src', kind: 'house', files: 5, lines: 120, bytes: 1000, recent: 0, commits: 0, authors: [], topFiles: [], languages: {} },
    ], facilities: [], contributors: [],
  };
  const input = overlay(goal, { seed: 'memo' });
  const opts = { art: loadArt(manifest), props: loadProps(manifest), ground: loadGround(manifest), seed: input.seed };
  const plain = layoutTown(repo, opts);
  assert.equal(Object.hasOwn(plain, 'goalSite'), false);
  assert.equal(JSON.stringify(plain), JSON.stringify(layoutTown(repo, { ...opts, goalLook: undefined })));
  const result = checkSeed(repo, manifest, { overlay: input });
  assert.equal(result.problems.length, 0, result.problems.join('\n'));
  assert.ok(result.town.overlay.goal, JSON.stringify(result.town.unplaced));
  assert.equal(result.town.overlay.goal.look, 'castle');
  assert.equal(result.town.overlay.goal.landmark.x, result.town.goalSite.x);
  assert.equal(result.town.overlay.goal.landmark.y, result.town.goalSite.y);
  const target = resolveAt(result.town, goal.at, { kind: 'goal' });
  assert.ok(Math.hypot(result.town.goalSite.x - target.x, result.town.goalSite.y - target.y) <= 24);
  assert.equal(result.town.buildings.length, plain.buildings.length);
  assert.ok(result.town.buildings.every((b) => b.archetype !== 'goal-site' && b.archetype !== 'castle'));
  const fuzz = fuzzSeeds(repo, manifest, { count: 3, overlay: input });
  assert.equal(fuzz.failed, 0, JSON.stringify(fuzz.results));
  assert.ok(fuzz.results.some((r) => r.overlay?.goalFront?.reachable === 28));
});

test('goal.look: memo-sized plots keep the castle on the reserved site and preserve canal banks', () => {
  const modules = [
    ['.', 'house', 9, 970], ['.local', 'house', 2, 69],
    ['.local/maps', 'house', 2, 2], ['.local/outputs', 'house', 25, 335],
    ['checks', 'house', 15, 1342], ['src', 'house', 2, 304], ['web', 'shop', 6, 259],
  ].map(([path, kind, files, lines]) => ({
    path, kind, files, lines, bytes: lines * 20, recent: 0, commits: 0, authors: [], languages: {}, topFiles: [],
  }));
  const repo = { name: 'memo', head: 'fixture', modules, contributors: [],
    facilities: ['town_hall', 'inn', 'well', 'gate'].map((archetype) => ({
      archetype, reason: 'fixture', evidence: ['src/server/main.mjs'], evidenceCount: 1, merged: [],
      facts: archetype === 'well' ? { envInCode: [{ name: 'MEMO_DATA_DIR', files: ['src/server/main.mjs'] }] } : {},
    })),
  };
  for (const seed of ['memo', 'memo@fuzz:0000015', 'memo@fuzz:000007b', 'memo@fuzz:0000085']) {
    const input = overlay(goal, { seed, groups: [
      { id: 'store', label: '倉庫番', paths: ['src/**'] }, { id: 'ui', label: '絵師', paths: ['web/**'] },
    ] });
    const result = checkSeed(repo, manifest, { overlay: input }), town = result.town;
    assert.equal(result.problems.length, 0, `${seed}: ${result.problems.join('\n')}`);
    assert.equal(town.overlay.goal?.look, 'castle', seed);
    assert.deepEqual(town.overlay.goal.landmark, { x: town.goalSite.x, y: town.goalSite.y, look: 'castle-1' }, seed);
    assert.deepEqual(result.play.overlay.goalFront, { reachable: 28, total: 28 });
  }
});

test('goal.look: an unplaceable plot preserves retry state and leaves an explained goal', (t) => {
  const base = fileURLToPath(new URL('../compare/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const temp = mkdtempSync(join(base, 'goal-fallback-')), root = join(temp, 'goal-retry-town');
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (let i = 0; i < 16; i++) {
    const dir = join(root, `part${i}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.mjs'), 'export const answer = 42;\n' + '// fixture line\n'.repeat(99 + i * 20));
  }
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  let model;
  try {
    process.env.GIT_CEILING_DIRECTORIES = base;
    model = analyzeRepository(root);
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
  }
  assert.equal(model.head, null, 'the fixture must not inherit the enclosing repository');
  assert.equal(model.modules.length, 16);
  const props = loadProps(manifest);
  // Public input only: a 128-tile plot cannot fit any of this fixture's grids.
  // Keep the real manifest/images and all layout functions untouched.
  props['castle-1'] = { ...props['castle-1'], solid: [-1024, -96, 2048, 96],
    origin: [1024, 224], size: [2048, 224], bounds: [0, 0, 2048, 224] };
  const opts = { seed: 'fallback-retry:0', props };
  for (const grouped of [false, true]) {
    const repo = structuredClone(model);
    if (grouped) for (const m of repo.modules) m.group = 'team';
    const plainDebug = {}, debug = {};
    const plain = layoutTown(repo, { ...opts, debug: plainDebug });
    assert.ok(plainDebug.placementRetries > 0, 'the fallback town itself must need an outer retry');
    const town = layoutTown(repo, { ...opts, goalLook: 'castle', debug });
    assert.equal(Object.hasOwn(town, 'goalSite'), false, 'the unplaceable plot must reach the fallback');
    assert.ok(debug.placementRetries < 128);
    assert.equal(debug.placementRetries, plainDebug.placementRetries, 'fallback retries retain the same exclusions and reservations');
    assert.equal(JSON.stringify(town), JSON.stringify(plain));
    assert.equal(JSON.stringify(layoutTown(repo, { ...opts, goalLook: 'castle' })), JSON.stringify(town));
    const placed = placeOverlay(town, overlay(), manifest);
    assert.ok(placed.overlay.goal);
    assert.equal(Object.hasOwn(placed.overlay.goal, 'look'), false);
    const unplaced = placed.overlay.unplaced.filter((u) => u.scope === 'goal');
    assert.equal(unplaced.length, 1);
    assert.equal(unplaced[0].part, 'landmark');
    assert.equal(unplaced[0].site.stage, 'layout');
    assert.equal(unplaced[0].reason, 'no safe level space for goal landmark and clear front');
    assert.ok(placed.unplaced.includes(unplaced[0]), 'the diagnostic must also be visible in Town.unplaced');
    assert.equal(placed.props.some((p) => p.overlayId === 'goal:$goal'), false);
  }
});

test('goal.look: a temporary memo-shaped fixture keeps its label when the castle cannot fit', (t) => {
  const base = fileURLToPath(new URL('../compare/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const temp = mkdtempSync(join(base, 'memo-goal-')), root = join(temp, 'memo');
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  // The test owns its tiny repository; it never reads or writes gridhub's example.
  for (const file of ['src/server/main.mjs', 'src/store/memo-store.mjs', 'web/app.mjs', 'checks/GOAL.mjs']) {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'export const memo = [];\n');
  }
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  let model;
  try {
    process.env.GIT_CEILING_DIRECTORIES = base;
    model = analyzeRepository(root);
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
  }
  assert.equal(model.head, null);
  const art = structuredClone(manifest);
  // Public geometry input forces a no-plot case regardless of the surrounding git state.
  Object.assign(art.props['castle-1'], { solid: [-1024, -96, 2048, 96],
    origin: [1024, 224], size: [2048, 224], bounds: [0, 0, 2048, 224] });
  const input = overlay({ ...goal, id: 'memo-goal' }, { seed: 'memo' });
  const result = checkSeed(model, art, { overlay: input });
  assert.equal(result.problems.length, 0, result.problems.join('\n'));
  assert.equal(result.town.goalSite, undefined);
  assert.equal(result.town.overlay.goal.id, 'memo-goal');
  assert.equal(result.town.overlay.goal.label, '完了');
  assert.equal(Object.hasOwn(result.town.overlay.goal, 'look'), false);
  const [diagnostic] = result.town.overlay.unplaced;
  assert.equal(diagnostic.scope, 'goal');
  assert.equal(diagnostic.id, 'memo-goal');
  assert.equal(diagnostic.part, 'landmark');
  assert.equal(diagnostic.site.stage, 'layout');
  assert.ok(result.town.unplaced.includes(diagnostic));
  assert.deepEqual(result.play.overlay.goal, { reachable: 1, total: 1 });
});

test('goal.look: sidecar and generated manifest keep the supplied candidate as a non-walkable landmark', () => {
  const side = JSON.parse(readFileSync(new URL('../art/game/landmarks/castle-1.json', import.meta.url)));
  assert.equal(Object.hasOwn(side, 'deck'), false);
  assert.deepEqual(manifest.props['castle-1'].solid, side.solid);
  assert.equal(manifest.props['castle-1'].src, 'landmarks/castle-1.png');
  assert.deepEqual(manifest.props['castle-1'].size, [192, 224]);
});
