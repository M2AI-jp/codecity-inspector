import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GameRuntimeError,
  createGameRuntime,
  createInitialState,
  evidenceSentence,
  gamepadToActions,
  persistenceSnapshot,
  reduceGameState,
  validateSceneBundle,
} from '../../../ship/70-game-runtime/index.mjs';

const HASH = 'a'.repeat(64);

function asset(selector) {
  const character = selector === 'player' || selector === 'npc';
  const player = selector === 'player';
  const directions = ['north', 'south', 'east', 'west'];
  const animation = (frames) => Object.fromEntries(directions.map((direction) => [direction, { frames, fps: 8 }]));
  const usage = character ? {
    kind: 'character',
    layer: 'actor',
    frame: { width: 1, height: 1, columns: 6, rows: player ? 8 : 4 },
    collision: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
    animations: {
      idle: animation([0, 1]),
      walk: animation([0, 1, 2, 3]),
      ...(player ? { run: animation([0, 1, 2, 3, 4, 5]) } : {}),
    },
  } : {
    kind: 'prop',
    layer: 'object',
    frame: { width: 1, height: 1, columns: 1, rows: 1 },
    collision: { kind: 'none' },
  };
  return {
    selector,
    assetId: `asset-${selector}`,
    version: '1.0.0',
    path: `art/${selector}.png`,
    url: `art/${selector}.png`,
    sha256: HASH,
    dimensions: { width: usage.frame.columns, height: usage.frame.rows },
    pivot: { x: 0, y: 0 },
    usage,
  };
}

function bundle({ questCount = 3, reportChange = null } = {}) {
  const assets = [asset('player'), asset('npc'), asset('tile')];
  const quests = Array.from({ length: questCount }, (_, index) => ({
    id: `quest-${index + 1}`,
    siteId: `site-${index + 1}`,
    rect: { x: 4, y: 4, width: 8, height: 8 },
    subject: `調査${index + 1}`,
    statement: `証拠${index + 1}`,
    evidenceAddresses: { observed: [], inferred: [], unknown: [{ address: `$.questSites[${index}].evidence.state`, claim: 'unknown' }] },
  }));
  return {
    format: 'codecity.scene-bundle',
    schemaVersion: 1,
    bindingsVersion: 1,
    world: { identity: { key: 'repo-test', name: 'Test Repo' }, contentDigest: 'b'.repeat(64), seed: 1, townType: 'town', climate: 'clear', terrain: 'grass', grid: { width: 32, height: 23 } },
    assets,
    layers: { terrain: {}, water: {}, roads: [], plots: [], buildings: [], props: [], lights: [] },
    collisions: { blockedPlotIds: [], blockedCells: [], waterCells: [], vacantPlotIds: [] },
    nav: { nodes: [], edges: [] },
    rooms: [{ id: 'room-1', bounds: { x: 80, y: 80, width: 80, height: 60 }, cutawayIds: ['roof-1'], asset: assets[2] }],
    actors: [],
    interactions: [],
    questSites: [],
    evidence: { observed: [], inferred: [], unknown: [] },
    game: {
      logicalSize: { width: 384, height: 216 },
      worldSize: { width: 512, height: 360 },
      spawn: { plotId: 'plot-start', x: 4, y: 4 },
      player: { assetSelector: 'player', footbox: { x: 0, y: 0, width: 4, height: 4 }, speeds: { run: 75, walk: 45 }, interactDistance: 8 },
      collisions: [],
      entrances: [{ id: 'door-1', rect: { x: 20, y: 0, width: 10, height: 20 }, roomId: 'room-1', cutawayIds: ['roof-1'], exteriorSpawn: { x: 8, y: 4 }, interiorSpawn: { x: 100, y: 100 } }],
      rooms: [{ id: 'room-1', bounds: { x: 80, y: 80, width: 80, height: 60 }, cutawayIds: ['roof-1'] }],
      npcs: [{ id: 'npc-1', kind: 'guild', position: { x: 150, y: 40 }, assetSelector: 'npc', footPivot: { x: 0, y: 0 }, interactionRect: { x: 145, y: 35, width: 20, height: 20 }, prompt: '話しますか', dialogue: ['こんにちは。'] }],
      quests,
      request: { id: 'request-1', rect: { x: 4, y: 4, width: 8, height: 8 }, prompt: '掲示板の依頼' },
      report: { id: 'report-1', rect: { x: 4, y: 4, width: 8, height: 8 }, prompt: '報告しますか', change: reportChange },
      guild: { tabs: ['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい'].map((label, index) => ({ id: `tab-${index}`, label, entries: [] })) },
      renderables: [{ id: 'tile-1', assetSelector: 'tile', position: { x: 0, y: 0 }, footPivot: { x: 8, y: 15 }, z: 0 }],
    },
  };
}

function fakeCanvas() {
  const context = { drawImage() {}, clearRect() {}, setTransform() {}, imageSmoothingEnabled: true };
  return { width: 0, height: 0, getContext: () => context };
}

function fakeTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    emit(type, event) { listeners.get(type)?.(event); },
  };
}

function fakeClock() {
  let now = 0;
  let next = 0;
  const callbacks = new Map();
  return {
    now: () => now,
    requestFrame(callback) { const id = ++next; callbacks.set(id, callback); return id; },
    cancelFrame(id) { callbacks.delete(id); },
    advance(milliseconds) { now += milliseconds; const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((callback) => callback(now)); },
  };
}

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { this.writes += 1; values.set(key, value); },
    values,
    writes: 0,
  };
}

function acceptRequest(state, scene) {
  state = reduceGameState(state, { type: 'INTERACT' }, scene);
  assert.equal(state.dialogue?.kind, 'request');
  state = reduceGameState(state, { type: 'INTERACT' }, scene);
  assert.equal(state.quest.status, 'investigating');
  return reduceGameState(state, { type: 'INTERACT' }, scene);
}

test('pure gamepad mapping handles standard buttons, edges, axes, and disconnection', () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  buttons[12] = { pressed: true, value: 1 };
  buttons[0] = { pressed: true, value: 1 };
  buttons[9] = { pressed: true, value: 1 };
  const current = gamepadToActions({ connected: true, buttons, axes: [0, 0] });
  assert.deepEqual(current.actions.map((action) => action.type), ['GAMEPAD_INPUT', 'INTERACT', 'OVERLOOK']);
  assert.equal(current.snapshot.directions.up, true);
  assert.deepEqual(gamepadToActions({ connected: true, buttons, axes: [0, 0] }, current.snapshot).actions, []);
  const disconnected = gamepadToActions({ connected: false }, current.snapshot);
  assert.deepEqual(disconnected.actions, [{ type: 'GAMEPAD_INPUT', directions: { up: false, down: false, left: false, right: false } }]);
});

test('keyboard and gamepad movement use canonical run/walk speeds and stop immediately', () => {
  const scene = bundle({ questCount: 0 });
  scene.game.entrances = [];
  let state = createInitialState(scene);
  state = reduceGameState(state, { type: 'KEY_DOWN', key: 'ArrowRight' }, scene);
  state = reduceGameState(state, { type: 'TICK', dtMs: 200 }, scene);
  assert.equal(state.player.x, 19);
  state = reduceGameState(state, { type: 'KEY_UP', key: 'ArrowRight' }, scene);
  const stopped = reduceGameState(state, { type: 'TICK', dtMs: 200 }, scene);
  assert.equal(stopped.player.x, state.player.x);

  let walk = createInitialState(scene);
  walk = reduceGameState(walk, { type: 'KEY_DOWN', key: 'ShiftLeft' }, scene);
  walk = reduceGameState(walk, { type: 'GAMEPAD_INPUT', directions: { right: true } }, scene);
  walk = reduceGameState(walk, { type: 'TICK', dtMs: 200 }, scene);
  assert.equal(walk.player.x, 13);
});

test('player footbox blocks collisions and entrance transitions use both spawn points', () => {
  const scene = bundle({ questCount: 0 });
  scene.game.collisions = [{ x: 20, y: 0, width: 30, height: 20 }];
  let state = createInitialState(scene);
  state = reduceGameState(state, { type: 'MOVE', direction: 'right', seconds: 0.25 }, scene);
  assert.equal(state.player.x, 16);

  scene.game.collisions = [];
  state = createInitialState(scene);
  state = reduceGameState(state, { type: 'MOVE', direction: 'right', seconds: 0.25 }, scene);
  assert.equal(state.phase, 'room');
  assert.deepEqual({ x: state.player.x, y: state.player.y }, scene.game.entrances[0].interiorSpawn);
  state = reduceGameState(state, { type: 'BACK' }, scene);
  assert.equal(state.phase, 'explore');
  assert.deepEqual({ x: state.player.x, y: state.player.y }, scene.game.entrances[0].exteriorSpawn);
});

test('seamless entry hides the exterior cutaway and reveals only the matching room layer', async () => {
  const scene = bundle({ questCount: 0 });
  scene.assets.push(asset('building'), asset('room'));
  scene.game.renderables.push(
    { id: 'building-1', assetSelector: 'building', position: { x: 20, y: 0 }, footPivot: { x: 0, y: 0 }, z: 20, cutawayId: 'roof-1' },
    { id: 'room-layer-1', assetSelector: 'room', position: { x: 80, y: 80 }, footPivot: { x: 0, y: 0 }, z: 30, roomId: 'room-1' },
  );
  assert.equal(validateSceneBundle(scene).ok, true);
  const context = {
    drawn: [],
    drawImage(image) { this.drawn.push(image.selector); },
    clearRect() { this.drawn = []; },
    setTransform() {},
    imageSmoothingEnabled: true,
  };
  const runtime = createGameRuntime({
    bundle: scene,
    canvas: { width: 0, height: 0, getContext: () => context },
    uiRoot: { textContent: '' }, storage: storage(),
    assetLoader: async (entry) => ({ selector: entry.selector }),
    inputTarget: fakeTarget(), clock: fakeClock(),
  });
  await runtime.start();
  assert.ok(context.drawn.includes('building'));
  assert.equal(context.drawn.includes('room'), false);
  runtime.dispatch({ type: 'MOVE', direction: 'right', seconds: 0.25 });
  assert.equal(runtime.state.phase, 'room');
  assert.equal(context.drawn.includes('building'), false);
  assert.ok(context.drawn.includes('room'));
  runtime.stop();
});

test('zero requests are no_request and cannot unlock a report', () => {
  const state = createInitialState(bundle({ questCount: 0 }));
  assert.equal(state.quest.status, 'no_request');
  assert.equal(state.report.available, false);
  assert.equal(reduceGameState(state, { type: 'INTERACT' }, bundle({ questCount: 0 })).phase, 'explore');
});

test('a real request must be accepted at the clerk before investigation begins', () => {
  const scene = bundle({ questCount: 3 });
  let state = createInitialState(scene);
  assert.equal(state.quest.status, 'available');
  assert.equal(state.quest.accepted, false);
  state = acceptRequest(state, scene);
  assert.equal(state.quest.accepted, true);
  assert.equal(state.dialogue, null);
});

test('three investigations preserve tri-state wording and report change semantics', () => {
  const scene = bundle({ questCount: 3, reportChange: null });
  let state = acceptRequest(createInitialState(scene), scene);
  for (const choice of ['見た', 'そうらしい', 'わからない']) {
    state = reduceGameState(state, { type: 'INTERACT' }, scene);
    assert.equal(state.dialogue.kind, 'quest');
    state = reduceGameState(state, { type: 'CHOOSE', choice }, scene);
    assert.match(state.dialogue.lines[0], choice === '見た' ? /です。$/u : choice === 'そうらしい' ? /のようです。$/u : /まだ、わかりません。$/u);
    state = reduceGameState(state, { type: 'INTERACT' }, scene);
  }
  assert.equal(state.quest.status, 'ready_report');
  state = reduceGameState(state, { type: 'REPORT' }, scene);
  assert.equal(state.quest.reported, true);
  assert.equal(state.townRevision, 0);

  const changed = bundle({ questCount: 3, reportChange: {
    id: 'transition-tests', event: 'tests_passed', bindingId: 'reward.tests_passed',
    facilityKind: 'dojo', effect: 'inspection_stamp', state: 'observed',
    evidence: { observed: ['inspection.test-result'], inferred: [], unknown: [] },
  } });
  let changedState = createInitialState(changed);
  changedState = { ...changedState, quest: { ...changedState.quest, status: 'ready_report' } };
  changedState = reduceGameState(changedState, { type: 'REPORT' }, changed);
  assert.equal(changedState.townRevision, 1);
  assert.deepEqual(changedState.townChange, changed.game.report.change);
});

test('an approved reward effect becomes visibly renderable only after its observed report', async () => {
  const reportChange = {
    id: 'transition-tests', event: 'tests_passed', bindingId: 'reward.tests_passed',
    facilityKind: 'dojo', effect: 'inspection_stamp', state: 'observed',
    evidence: { observed: ['inspection.test-result'], inferred: [], unknown: [] },
  };
  const scene = bundle({ questCount: 1, reportChange });
  scene.assets.push(asset('effect'));
  scene.game.renderables.push({
    id: 'effect:inspection-stamp', assetSelector: 'effect',
    position: { x: 4, y: 4 }, footPivot: { x: 0, y: 0 }, z: 90,
    effect: 'inspection_stamp',
  });
  assert.equal(validateSceneBundle(scene).ok, true);

  const context = {
    frameDraws: 0,
    drawImage() { this.frameDraws += 1; },
    clearRect() { this.frameDraws = 0; },
    setTransform() {},
    imageSmoothingEnabled: true,
  };
  const runtime = createGameRuntime({
    bundle: scene,
    canvas: { width: 0, height: 0, getContext: () => context },
    uiRoot: { textContent: '' }, storage: storage(),
    assetLoader: async () => ({ width: 16, height: 16 }),
    inputTarget: fakeTarget(), clock: fakeClock(),
  });
  await runtime.start();
  const before = context.frameDraws;
  runtime.dispatch({ type: 'INTERACT' });
  runtime.dispatch({ type: 'INTERACT' });
  runtime.dispatch({ type: 'INTERACT' });
  runtime.dispatch({ type: 'INTERACT' });
  runtime.dispatch({ type: 'CHOOSE', choice: '見た' });
  runtime.dispatch({ type: 'INTERACT' });
  runtime.dispatch({ type: 'INTERACT' });
  runtime.dispatch({ type: 'INTERACT' });
  assert.equal(runtime.state.townChange.effect, 'inspection_stamp');
  assert.equal(context.frameDraws, before + 1);
  runtime.stop();
});

test('dialogue controls select choices and interaction confirms the report', () => {
  const scene = bundle({ questCount: 1, reportChange: null });
  let state = acceptRequest(createInitialState(scene), scene);
  state = reduceGameState(state, { type: 'INTERACT' }, scene);
  state = reduceGameState(state, { type: 'KEY_DOWN', key: 'ArrowDown' }, scene);
  assert.equal(state.dialogue.choiceIndex, 1);
  state = reduceGameState(state, { type: 'INTERACT' }, scene);
  assert.equal(state.quest.answers[0].choice, 'そうらしい');
  state = reduceGameState(state, { type: 'INTERACT' }, scene); // dismiss feedback
  state = reduceGameState(state, { type: 'INTERACT' }, scene); // open report prompt
  assert.equal(state.dialogue.kind, 'report');
  state = reduceGameState(state, { type: 'INTERACT' }, scene); // confirm report
  assert.equal(state.quest.reported, true);
});

test('persistence is identity-and-content scoped and quest-id-only; exit and revisit survive', async () => {
  const scene = bundle({ questCount: 3 });
  const store = storage();
  const clock = fakeClock();
  const target = fakeTarget();
  const options = { bundle: scene, canvas: fakeCanvas(), uiRoot: { textContent: '' }, storage: store, assetLoader: async () => ({ width: 16, height: 16 }), inputTarget: target, clock };
  const first = createGameRuntime(options);
  await first.start();
  first.dispatch({ type: 'MOVE', direction: 'right', seconds: 0.25 });
  assert.equal(first.state.phase, 'room');
  first.stop();
  const second = createGameRuntime(options);
  assert.equal(second.state.phase, 'room');
  assert.equal(second.state.roomId, 'room-1');
  assert.equal(second.state.player.direction, 'right');
  second.dispatch({ type: 'BACK' });
  second.dispatch({ type: 'EXIT' });
  second.stop();
  const third = createGameRuntime(options);
  assert.equal(third.state.phase, 'exit');
  third.dispatch({ type: 'INTERACT' });
  assert.equal(third.state.phase, 'explore');
  assert.equal(third.state.exit.revisitCount, 1);

  const changedContent = structuredClone(scene);
  changedContent.world.contentDigest = 'c'.repeat(64);
  const changedRuntime = createGameRuntime({ ...options, bundle: changedContent });
  assert.notEqual(changedRuntime.storageKey, third.storageKey);
  assert.equal(changedRuntime.state.phase, 'explore');
  assert.equal(changedRuntime.state.quest.reported, false);

  const legacy = { version: 1, identity: 'repo-test', answers: { '0': { choice: '見た', sentence: 'xです。' } } };
  assert.equal(createInitialState(scene, legacy).quest.answered, 0);

  const previousRequest = {
    version: 1, identity: 'repo-test', questIds: ['old-quest'],
    answers: { 'old-quest': { choice: '見た', sentence: 'xです。' } }, reported: true,
  };
  assert.equal(createInitialState(scene, previousRequest).quest.status, 'available');
});

test('revisit preserves the exact accepted observed transition and rejects stale positions', () => {
  const acceptedChange = {
    id: 'transition-tests', event: 'tests_passed', bindingId: 'reward.tests_passed',
    facilityKind: 'dojo', effect: 'inspection_stamp', state: 'observed',
    evidence: { observed: ['inspection.test-result'], inferred: [], unknown: [] },
  };
  const newerChange = {
    id: 'transition-build', event: 'build_passed', bindingId: 'reward.build_passed',
    facilityKind: 'workshop', effect: 'forge_fire', state: 'observed',
    evidence: { observed: ['inspection.build-result'], inferred: [], unknown: [] },
  };
  const original = bundle({ questCount: 3, reportChange: acceptedChange });
  let reported = createInitialState(original);
  reported = { ...reported, quest: { ...reported.quest, status: 'ready_report' } };
  reported = reduceGameState(reported, { type: 'REPORT' }, original);
  const persisted = persistenceSnapshot(reported, 'repo-test', original.game.quests.map((quest) => quest.id));
  persisted.player = { x: 99_999, y: 99_999, direction: 'left' };

  const changedRepository = bundle({ questCount: 3, reportChange: newerChange });
  const restored = createInitialState(changedRepository, persisted);
  assert.deepEqual(restored.townChange, acceptedChange);
  assert.notDeepEqual(restored.townChange, newerChange);
  assert.equal(restored.player.x, changedRepository.game.spawn.x);
  assert.equal(restored.player.y, changedRepository.game.spawn.y);
});

test('held movement persistence is throttled instead of writing every frame', async () => {
  const scene = bundle({ questCount: 3 });
  const store = storage();
  const clock = fakeClock();
  const runtime = createGameRuntime({
    bundle: scene,
    canvas: fakeCanvas(),
    uiRoot: { textContent: '' },
    storage: store,
    assetLoader: async () => ({ width: 16, height: 16 }),
    inputTarget: fakeTarget(),
    clock,
  });

  await runtime.start();
  runtime.dispatch({ type: 'KEY_DOWN', key: 'ArrowRight' });
  for (let index = 0; index < 20; index += 1) clock.advance(16);
  assert.equal(store.writes, 1);
  runtime.stop();
  assert.equal(store.writes, 2);
});

test('invalid bundles and missing approved assets are refused without fallback', async () => {
  const scene = bundle();
  const invalid = { ...scene, game: undefined };
  assert.equal(validateSceneBundle(invalid).ok, false);
  assert.throws(() => createGameRuntime({ bundle: invalid }), (error) => error instanceof GameRuntimeError && error.code === 'SCENE_BUNDLE_INVALID');

  const fallback = structuredClone(scene);
  fallback.assets[0].fallback = fallback.assets[1];
  assert.equal(validateSceneBundle(fallback).ok, false);

  const inventedReward = structuredClone(scene);
  inventedReward.game.report.change = { id: 'score', event: 'score', bindingId: 'reward.score', facilityKind: 'guild', effect: 'points', state: 'observed', evidence: { observed: ['self-report'], inferred: [], unknown: [] } };
  assert.equal(validateSceneBundle(inventedReward).ok, false);

  const extra = structuredClone(scene);
  extra.game.compatibilityFallback = true;
  assert.equal(validateSceneBundle(extra).ok, false);

  const runtime = createGameRuntime({ bundle: scene, canvas: fakeCanvas(), uiRoot: { textContent: '' }, storage: storage(), assetLoader: async () => null, inputTarget: fakeTarget(), clock: fakeClock() });
  await assert.rejects(runtime.start(), (error) => error instanceof GameRuntimeError && error.code === 'ASSET_LOAD_FAILED');
});
