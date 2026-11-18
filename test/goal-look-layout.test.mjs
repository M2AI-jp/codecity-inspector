import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRepository } from '../src/analyze.mjs';
import { placeOverlay, defaultManifest } from '../src/overlay/place.mjs';
import { layoutTown, loadArt, loadProps, loadGround } from '../src/layout.mjs';
import { checkSeed, fuzzSeeds } from '../tools/seed-fuzz.mjs';
import { resolveAt } from '../src/overlay/resolve.mjs';
import { goal, overlay } from './helpers/goal-look-fixtures.mjs';

const manifest = defaultManifest();

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
