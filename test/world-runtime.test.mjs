import test from 'node:test';
import assert from 'node:assert/strict';

import { validateWorldPlanShape } from '../src/town/world-plan-schema.mjs';
import { generateWorldPlan } from '../src/town/world-plan-generator.mjs';
import {
  INTEGER_ZOOMS,
  TOUR_WITNESS_COUNT,
  buildingFactIds,
  buildingForCutaway,
  computeWorldCamera,
  createInterpolatedMovement,
  createTourState,
  createWorldRuntime,
  describeFact,
  directionBetweenPoints,
  districtForPoint,
  edgeBetween,
  formatDialogueText,
  interactionFamily,
  interactionFactId,
  interactionProtocol,
  isTownHallInteraction,
  navigationIsConnected,
  nearestInteraction,
  nextNodeForDirection,
  playerOccluded,
  progressStorageKey,
  reduceTour,
  residentConversationTarget,
  restoreTourState,
  sampleInterpolatedMovement,
  screenToWorld,
  selectTourQuestions,
  selectableTourQuestions,
  shortestPath,
  terrainCellAt,
  tourObjective,
  visibleDepthEntries,
  validateRuntimeWorldPlan,
  withinBuildingReleaseZone,
  worldToScreen
} from '../public/fable5-v2/world-runtime.mjs';

const DIGEST = 'a'.repeat(64);

function fact(id, type) {
  const evidenceId = id.replaceAll('.', '_');
  return {
    id,
    type,
    params: { path: `src/${id}.mjs` },
    evidence: {
      observed: [`inspection.fixture.${evidenceId}.observed`],
      inferred: [`inspection.fixture.${evidenceId}.inferred`],
      unknown: [`inspection.fixture.${evidenceId}.unknown`]
    },
    sayings: { primary: `${id}を調べよう。`, reflect: [`${id}について分かった。`] }
  };
}

function building({ id, assetId, facilityKind, x, y, factId, verb = 'inspect' }) {
  return {
    id,
    assetId,
    files: [`src/${id}.mjs`],
    class: id === 'survey_tower' ? 'tower' : 'S',
    ...(facilityKind ? { facilityKind } : {}),
    footprint: { x, y, w: 1, h: 1 },
    entrance: { x, y, dir: 'south' },
    rooms: [{
      file: `src/${id}.mjs`,
      state: 'lit',
      npcId: null,
      props: [],
      floorNavNodeIds: [`nav.${id}`]
    }],
    overlays: [],
    interaction: { anchor: { x, y }, verb, factRefs: [factId] }
  };
}

export function makeWorldPlan() {
  const facts = [
    fact('fact.unresolved', 'unresolved'),
    fact('fact.cycle', 'cycle'),
    fact('fact.unverified', 'unverified'),
    fact('fact.entrypoint', 'entrypoint'),
    fact('fact.present', 'facility_present'),
    fact('fact.unknown', 'runtime_unknown')
  ];
  const sites = [
    building({ id: 'town_hall', assetId: 'building.town_hall', facilityKind: 'town_hall', x: 2, y: 6, factId: 'fact.entrypoint', verb: 'receive-journal' }),
    building({ id: 'north_gate', assetId: 'building.gate', facilityKind: 'gate', x: 3, y: 5, factId: 'fact.unresolved', verb: 'inspect-entry-tags' }),
    building({ id: 'old_dojo', assetId: 'building.dojo', facilityKind: 'dojo', x: 4, y: 4, factId: 'fact.cycle', verb: 'watch-forms' }),
    building({ id: 'row_house', assetId: 'building.house_s', facilityKind: 'house', x: 5, y: 3, factId: 'fact.unverified', verb: 'talk-neighbor' }),
    building({ id: 'survey_tower', assetId: 'building.survey_tower', facilityKind: 'survey_tower', x: 6, y: 2, factId: 'fact.unknown', verb: 'use-telescope' }),
    building({ id: 'market_store', assetId: 'building.shop', facilityKind: 'market', x: 7, y: 1, factId: 'fact.present', verb: 'read-away-sign' })
  ];
  const nodes = [
    { id: 'nav.start', x: 1, y: 6, elevation: 0, space: 'outdoor' },
    ...sites.map((site) => ({ id: `nav.${site.id}`, x: site.entrance.x, y: site.entrance.y, elevation: 0, space: 'outdoor' }))
  ];
  const edgeKinds = ['walk', 'bridge', 'stairs', 'door', 'walk', 'walk'];
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge.${index}`,
    from: nodes[index].id,
    to: node.id,
    kind: edgeKinds[index]
  }));
  return {
    schemaVersion: 2,
    seed: 'playable-fixture',
    inspectionDigest: DIGEST,
    generatorVersion: '2.0.0',
    generation: { mode: 'primary', attempt: 0 },
    world: { widthTiles: 10, heightTiles: 8, tileSize: 64 },
    terrain: Array.from({ length: 80 }, (_, index) => ({
      assetId: index % 7 === 0 ? 'terrain.road' : 'terrain.grass',
      variant: String(index % 3),
      elevation: 0,
      walkable: true
    })),
    districts: [{ id: 'district.old_town', dir: 'center', biome: 'old-town', bounds: { x: 0, y: 0, w: 10, h: 8 }, landmarkId: 'town_hall' }],
    streets: [{ id: 'street.main', tiles: nodes.map((node) => [node.x, node.y]), width: 2, edges: [], edgeBindings: [], kind: 'civic-avenue' }],
    buildings: sites,
    npcs: [{
      id: 'npc.witness',
      assetId: 'character.witness',
      role: 'witness',
      home: 'row_house',
      patrol: [[5, 3]],
      factRefs: ['fact.unverified']
    }],
    props: [{ id: 'prop.clue', assetId: 'prop.lamp', kind: 'clue', x: 4, y: 4, factRef: 'fact.cycle' }],
    lights: [{ x: 2, y: 6, assetId: 'effect.window_light', kind: 'window', on: true, roomRef: 'src/town_hall.mjs' }],
    facts,
    nav: { nodes, edges },
    playerStart: { x: 1, y: 6, facing: 'east', navNodeId: 'nav.start' },
    validation: { ok: true, issues: [] }
  };
}

test('fixture is a shape-valid WorldPlan v2 and creates a dynamic runtime', () => {
  const plan = makeWorldPlan();
  assert.deepEqual(validateWorldPlanShape(plan), { ok: true, issues: [] });
  assert.deepEqual(validateRuntimeWorldPlan(plan), { ok: true, issues: [] });

  const runtime = createWorldRuntime(plan);
  assert.equal(runtime.width, 640);
  assert.equal(runtime.height, 512);
  assert.equal(runtime.start.navNodeId, 'nav.start');
  assert.equal(runtime.start.x, 96);
  assert.equal(runtime.terrainRows.length, 8);
  assert.equal(terrainCellAt(runtime, 0, 0).assetId, 'terrain.road');
  assert.equal(terrainCellAt(runtime, -1, 0), null);
  assert.equal(districtForPoint(runtime, 300, 200).id, 'district.old_town');
});

test('runtime rejects a WorldPlan that would strand the first tour before it starts', () => {
  const noLedger = makeWorldPlan();
  noLedger.buildings.find(({ id }) => id === 'town_hall').interaction.verb = 'read-away-sign';
  assert.match(validateRuntimeWorldPlan(noLedger).issues.join('\n'), /playable town hall ledger/);

  const tooFewMethods = makeWorldPlan();
  for (const id of ['old_dojo', 'row_house', 'survey_tower', 'market_store']) {
    tooFewMethods.buildings.find((building) => building.id === id).interaction.factRefs = [];
  }
  assert.match(validateRuntimeWorldPlan(tooFewMethods).issues.join('\n'), /3 distinct fact-bound witness methods/);
  assert.throws(() => createWorldRuntime(tooFewMethods), /first tour/);

  const unknownFacts = makeWorldPlan();
  for (const id of ['north_gate', 'old_dojo', 'row_house']) {
    unknownFacts.buildings.find((building) => building.id === id).interaction.factRefs = ['fact.not-in-plan'];
  }
  assert.match(validateRuntimeWorldPlan(unknownFacts).issues.join('\n'), /3 distinct fact-bound witness methods/);
});

test('navigation uses WorldPlan nodes and preserves bridge, stair, and door edges', () => {
  const runtime = createWorldRuntime(makeWorldPlan());
  assert.equal(navigationIsConnected(runtime), true);
  assert.deepEqual(shortestPath(runtime, 'nav.start', 'nav.market_store'), [
    'nav.start',
    'nav.town_hall',
    'nav.north_gate',
    'nav.old_dojo',
    'nav.row_house',
    'nav.survey_tower',
    'nav.market_store'
  ]);
  assert.equal(edgeBetween(runtime, 'nav.town_hall', 'nav.north_gate').kind, 'bridge');
  assert.equal(edgeBetween(runtime, 'nav.north_gate', 'nav.old_dojo').kind, 'stairs');
  assert.equal(edgeBetween(runtime, 'nav.old_dojo', 'nav.row_house').kind, 'door');
  assert.equal(nextNodeForDirection(runtime, 'nav.start', 'east').id, 'nav.town_hall');
  assert.equal(directionBetweenPoints({ x: 0, y: 0 }, { x: -4, y: 1 }), 'west');
});

test('camera only accepts integer zoom and round-trips screen coordinates', () => {
  assert.deepEqual(INTEGER_ZOOMS, [1, 2, 3]);
  for (const zoom of INTEGER_ZOOMS) {
    const camera = computeWorldCamera({
      viewportWidth: 320,
      viewportHeight: 240,
      worldWidth: 640,
      worldHeight: 512,
      focusX: 300,
      focusY: 200,
      zoom
    });
    const screen = worldToScreen(camera, 245, 177);
    const world = screenToWorld(camera, screen.x, screen.y);
    assert.ok(Math.abs(world.x - 245) < Number.EPSILON);
    assert.ok(Math.abs(world.y - 177) < Number.EPSILON);
  }
  assert.throws(() => computeWorldCamera({
    viewportWidth: 320,
    viewportHeight: 240,
    worldWidth: 640,
    worldHeight: 512,
    focusX: 0,
    focusY: 0,
    zoom: 1.4
  }), /zoom/);
});

test('movement interpolates smoothly and respects reduced motion', () => {
  const movement = createInterpolatedMovement({ from: { x: 0, y: 0 }, to: { x: 64, y: 32 }, startedAt: 100, duration: 200 });
  const middle = sampleInterpolatedMovement(movement, 200);
  assert.ok(middle.x > 32 && middle.x < 64);
  assert.equal(middle.done, false);
  assert.deepEqual(sampleInterpolatedMovement(movement, 300), { x: 64, y: 32, progress: 1, done: true });

  const reduced = createInterpolatedMovement({ from: { x: 0, y: 0 }, to: { x: 64, y: 32 }, reducedMotion: true });
  assert.deepEqual(sampleInterpolatedMovement(reduced, 0), { x: 64, y: 32, progress: 1, done: true });
});

test('cutaway, occlusion, interactions, and evidence derive from plan content', () => {
  const runtime = createWorldRuntime(makeWorldPlan());
  const hall = runtime.buildingById.get('town_hall');
  assert.equal(buildingForCutaway(runtime, hall.entrance.x, hall.entrance.y).id, 'town_hall');
  assert.equal(playerOccluded(runtime, hall.entrance.x, hall.entrance.y), true);
  assert.equal(playerOccluded(runtime, hall.entrance.x, hall.entrance.y, 'town_hall'), false);
  assert.equal(withinBuildingReleaseZone(runtime, hall, hall.entrance.x + 64, hall.entrance.y), true);
  assert.equal(withinBuildingReleaseZone(runtime, hall, hall.entrance.x + 256, hall.entrance.y), false);
  assert.equal(nearestInteraction(runtime, hall.entrance.x, hall.entrance.y).building.id, 'town_hall');
  assert.equal(interactionFamily(hall), 'ledger');
  assert.equal(interactionFamily(runtime.buildingById.get('north_gate')), 'spatial');
  assert.equal(interactionFamily(runtime.buildingById.get('old_dojo')), 'observe');
  assert.equal(interactionFamily(runtime.buildingById.get('row_house')), 'talk');
  assert.equal(interactionFamily(runtime.buildingById.get('survey_tower')), 'operate');
  assert.equal(interactionFamily(runtime.buildingById.get('market_store')), 'inspect');
  assert.equal(interactionProtocol(runtime.buildingById.get('north_gate')).kind, 'entry-tags');
  assert.equal(interactionProtocol(runtime.buildingById.get('old_dojo')).kind, 'forms');
  assert.equal(interactionProtocol(runtime.buildingById.get('row_house')).kind, 'neighbor');
  assert.equal(interactionProtocol(runtime.buildingById.get('survey_tower')).kind, 'overview');
  assert.equal(isTownHallInteraction(hall), true);
  assert.equal(isTownHallInteraction({ ...hall, facilityKind: 'guild' }), false);
  assert.equal(interactionFamily({ ...hall, facilityKind: 'guild' }), 'unsupported');
  assert.deepEqual(buildingFactIds(runtime, runtime.buildingById.get('row_house')), ['fact.unverified']);
  assert.deepEqual(buildingFactIds(runtime, runtime.buildingById.get('old_dojo')), ['fact.cycle']);
});

test('the first tour requires deliberate actions; entry alone never progresses', () => {
  const questions = selectTourQuestions(makeWorldPlan().facts);
  assert.deepEqual(questions.map((entry) => entry.type), ['unresolved', 'cycle', 'unverified']);

  let state = createTourState();
  const runtime = createWorldRuntime(makeWorldPlan());
  const hall = runtime.buildingById.get('town_hall');
  assert.equal(reduceTour(state, { type: 'enter', buildingId: 'town_hall' }, runtime), state);
  assert.equal(reduceTour(state, { type: 'receiveJournal', buildingId: 'guild' }, runtime), state);
  const guildPlan = makeWorldPlan();
  guildPlan.buildings.at(-1).facilityKind = 'guild';
  guildPlan.buildings.at(-1).interaction.verb = 'receive-journal';
  const guildRuntime = createWorldRuntime(guildPlan);
  assert.equal(reduceTour(state, { type: 'receiveJournal', buildingId: 'market_store' }, guildRuntime), state);
  state = reduceTour(state, { type: 'receiveJournal', buildingId: hall.id }, runtime);
  assert.equal(state.status, 'choose-question');
  assert.equal(reduceTour(state, { type: 'selectQuestion', questionId: 'fact.entrypoint' }, runtime), state);
  assert.equal(reduceTour(state, { type: 'selectQuestion', questionId: 'fact.present' }, runtime), state);
  state = reduceTour(state, { type: 'selectQuestion', questionId: questions[0].id }, runtime);
  assert.equal(state.status, 'investigating');

  const unchanged = reduceTour(state, { type: 'enter', buildingId: 'north_gate' }, runtime);
  assert.equal(unchanged, state);
  const forgedWitness = reduceTour(state, { type: 'witness', buildingId: 'north_gate', family: 'spatial', factId: 'forged.fact' }, runtime);
  assert.equal(forgedWitness, state);
  state = reduceTour(state, { type: 'witness', buildingId: 'north_gate', family: 'spatial', factId: 'fact.unresolved' }, runtime);
  assert.deepEqual(state.witnesses[0].factIds, ['fact.unresolved']);
  const duplicateFamily = reduceTour(state, { type: 'witness', buildingId: 'other_gate', family: 'spatial' }, runtime);
  assert.equal(duplicateFamily, state);
  state = reduceTour(state, { type: 'witness', buildingId: 'old_dojo', family: 'observe', factId: 'fact.cycle' }, runtime);
  state = reduceTour(state, { type: 'witness', buildingId: 'row_house', family: 'talk', factId: 'fact.unverified' }, runtime);
  assert.equal(state.witnesses.length, TOUR_WITNESS_COUNT);
  assert.equal(state.status, 'return-town-hall');
  assert.match(tourObjective(state), /市庁舎/);

  assert.equal(reduceTour(state, { type: 'report', buildingId: 'guild' }, runtime), state);
  state = reduceTour(state, { type: 'report', buildingId: hall.id }, runtime);
  assert.equal(state.status, 'answer');
  state = reduceTour(state, { type: 'answer', value: false }, runtime);
  assert.equal(state.status, 'complete');
  assert.equal(state.answer, false);
  assert.equal(restoreTourState(JSON.parse(JSON.stringify(state)), runtime).status, 'complete');
});

test('the displayed interaction fact is canonical unless the selected question is bound there', () => {
  const plan = makeWorldPlan();
  plan.buildings.find(({ id }) => id === 'north_gate').interaction.factRefs = ['fact.present', 'fact.unresolved'];
  const runtime = createWorldRuntime(plan);
  const gate = runtime.buildingById.get('north_gate');
  assert.deepEqual(selectableTourQuestions(runtime).map(({ id }) => id), [
    'fact.unresolved',
    'fact.cycle',
    'fact.unverified'
  ]);
  assert.equal(interactionFactId(runtime, gate), 'fact.present');
  assert.equal(interactionFactId(runtime, gate, 'fact.unresolved'), 'fact.unresolved');

  let state = reduceTour(createTourState(), { type: 'receiveJournal', buildingId: 'town_hall' }, runtime);
  state = reduceTour(state, { type: 'selectQuestion', questionId: 'fact.unresolved' }, runtime);
  assert.equal(reduceTour(state, {
    type: 'witness', buildingId: gate.id, family: 'spatial', factId: 'fact.present'
  }, runtime), state);
  state = reduceTour(state, {
    type: 'witness', buildingId: gate.id, family: 'spatial', factId: 'fact.unresolved'
  }, runtime);
  assert.deepEqual(state.witnesses[0].factIds, ['fact.unresolved']);
  assert.equal(reduceTour(state, {
    type: 'witness', buildingId: gate.id, family: 'spatial', factId: 'fact.unresolved'
  }, runtime), state);

  const files = Array.from({ length: 121 }, (_, index) => {
    const path = `src/rooms/file-${String(index).padStart(3, '0')}.js`;
    return {
      path,
      dir: 'src',
      bytes: 1_024,
      kind: 'module',
      isTest: false,
      state: 'mapped',
      evidence: {
        unresolvedLinks: 0,
        cycle: false,
        associatedTest: false,
        reachability: 'reached-from-known-entrypoints'
      }
    };
  });
  const generated = structuredClone(generateWorldPlan({
    inspection: {
      schemaVersion: 2,
      repository: { name: 'second-room-repro' },
      summary: { truncated: false },
      city: { buildings: files },
      graph: { nodes: files.map(({ path }) => ({ path })), edges: [], entrypoints: [] },
      inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
    },
    model: { facilities: [] }
  }));
  generated.validation.ok = true;
  const generatedRuntime = createWorldRuntime(generated);
  const rowhouse = generatedRuntime.buildings.find((candidate) => candidate.rooms.length > 1);
  assert.ok(rowhouse, '121 files must exercise an L1 multi-room rowhouse');
  const secondRoom = rowhouse.rooms[1];
  const secondRoomFact = generatedRuntime.facts.find((candidate) => (
    candidate.type === 'unverified' && candidate.params.path === secondRoom.file
  ));
  assert.ok(secondRoomFact);
  const target = residentConversationTarget(generatedRuntime, rowhouse, secondRoomFact);
  assert.equal(target.exactRoom, true);
  assert.equal(target.room.file, secondRoom.file);
  assert.equal(target.actor.id, secondRoom.npcId);
  assert.equal(target.actor.home, rowhouse.id);
  assert.notEqual(target.actor.id, rowhouse.rooms[0].npcId);
  for (const params of [
    { source: secondRoom.file },
    { test: secondRoom.file },
    { from: secondRoom.file },
    { members: ['elsewhere.mjs', secondRoom.file] }
  ]) {
    assert.equal(residentConversationTarget(generatedRuntime, rowhouse, { params }).room.file, secondRoom.file);
  }
  const roomsWithMissingExactActor = rowhouse.rooms.map((room, index) => (
    index === 1 ? { ...room, npcId: 'npc.missing' } : room
  ));
  const missingExactActor = residentConversationTarget(
    generatedRuntime,
    { ...rowhouse, rooms: roomsWithMissingExactActor },
    secondRoomFact
  );
  assert.equal(missingExactActor.room.file, secondRoom.file);
  assert.equal(missingExactActor.actor, null);
});

test('a selected-question site replaces an earlier witness in the same family', () => {
  const plan = makeWorldPlan();
  plan.buildings.find(({ id }) => id === 'north_gate').interaction.factRefs = ['fact.present'];
  plan.buildings.push(building({
    id: 'selected_gate', assetId: 'building.gate', facilityKind: 'gate', x: 8, y: 2,
    factId: 'fact.unresolved', verb: 'inspect-entry-tags'
  }));
  const runtime = createWorldRuntime(plan);
  let state = reduceTour(createTourState(), { type: 'receiveJournal', buildingId: 'town_hall' }, runtime);
  state = reduceTour(state, { type: 'selectQuestion', questionId: 'fact.unresolved' }, runtime);
  state = reduceTour(state, { type: 'witness', buildingId: 'north_gate', family: 'spatial', factId: 'fact.present' }, runtime);
  state = reduceTour(state, { type: 'witness', buildingId: 'old_dojo', family: 'observe', factId: 'fact.cycle' }, runtime);
  state = reduceTour(state, { type: 'witness', buildingId: 'row_house', family: 'talk', factId: 'fact.unverified' }, runtime);
  assert.equal(state.status, 'investigating');
  assert.equal(state.witnesses.length, 3);

  state = reduceTour(state, {
    type: 'witness', buildingId: 'selected_gate', family: 'spatial', factId: 'fact.unresolved'
  }, runtime);
  assert.equal(state.status, 'return-town-hall');
  assert.equal(state.witnesses.length, 3);
  assert.equal(state.witnesses.some(({ buildingId }) => buildingId === 'north_gate'), false);
  assert.deepEqual(state.witnesses.find(({ family }) => family === 'spatial').factIds, ['fact.unresolved']);
});

test('tour completion requires a witness that contains the selected question fact', () => {
  const runtime = createWorldRuntime(makeWorldPlan());
  const hall = runtime.buildingById.get('town_hall');
  let state = reduceTour(createTourState(), { type: 'receiveJournal', buildingId: hall.id }, runtime);
  state = reduceTour(state, { type: 'selectQuestion', questionId: 'fact.unresolved' }, runtime);
  state = reduceTour(state, { type: 'witness', buildingId: 'old_dojo', family: 'observe', factId: 'fact.cycle' }, runtime);
  state = reduceTour(state, { type: 'witness', buildingId: 'row_house', family: 'talk', factId: 'fact.unverified' }, runtime);
  state = reduceTour(state, { type: 'witness', buildingId: 'survey_tower', family: 'operate', factId: 'fact.unknown' }, runtime);
  assert.equal(state.witnesses.length, 3);
  assert.equal(state.status, 'investigating');
  state = reduceTour(state, { type: 'witness', buildingId: 'north_gate', family: 'spatial', factId: 'fact.unresolved' }, runtime);
  assert.equal(state.status, 'return-town-hall');
});

test('saved tour state is re-derived from runtime entities and invalid state resets', () => {
  const runtime = createWorldRuntime(makeWorldPlan());
  const hall = runtime.buildingById.get('town_hall');
  let state = reduceTour(createTourState(), { type: 'receiveJournal', buildingId: hall.id }, runtime);
  state = reduceTour(state, { type: 'selectQuestion', questionId: 'fact.unresolved' }, runtime);
  state = reduceTour(state, { type: 'witness', buildingId: 'north_gate', family: 'spatial', factId: 'fact.unresolved' }, runtime);
  const restored = restoreTourState(JSON.parse(JSON.stringify(state)), runtime);
  assert.deepEqual(restored.witnesses[0].factIds, ['fact.unresolved']);

  const forgedFact = structuredClone(state);
  forgedFact.witnesses[0].factIds = ['fact.present'];
  assert.deepEqual(restoreTourState(forgedFact, runtime), createTourState());
  const nonSelectableQuestion = structuredClone(state);
  nonSelectableQuestion.questionId = 'fact.present';
  assert.deepEqual(restoreTourState(nonSelectableQuestion, runtime), createTourState());

  const forgedFamily = structuredClone(state);
  forgedFamily.witnesses[0].family = 'operate';
  assert.deepEqual(restoreTourState(forgedFamily, runtime), createTourState());
  const forgedStatus = structuredClone(state);
  forgedStatus.status = 'complete';
  forgedStatus.answer = true;
  assert.deepEqual(restoreTourState(forgedStatus, runtime), createTourState());
  const fourWitnesses = {
    version: 1,
    status: 'return-town-hall',
    journalReceived: true,
    questionId: 'fact.unresolved',
    witnesses: [
      { buildingId: 'north_gate', family: 'spatial', factIds: ['fact.unresolved'] },
      { buildingId: 'old_dojo', family: 'observe', factIds: ['fact.cycle'] },
      { buildingId: 'row_house', family: 'talk', factIds: ['fact.unverified'] },
      { buildingId: 'survey_tower', family: 'operate', factIds: ['fact.unknown'] }
    ],
    answer: null
  };
  assert.deepEqual(restoreTourState(fourWitnesses, runtime), createTourState());
  assert.deepEqual(restoreTourState(state, null), createTourState());
});

test('visible depth entries use sorted depth range and AABB intersection', () => {
  const entries = [
    { id: 'above', depth: 10, bounds: { x: 0, y: 0, width: 10, height: 10 } },
    { id: 'visible', depth: 120, bounds: { x: 110, y: 110, width: 20, height: 20 } },
    { id: 'side', depth: 130, bounds: { x: 500, y: 110, width: 20, height: 20 } },
    { id: 'below', depth: 500, bounds: { x: 110, y: 490, width: 20, height: 20 } }
  ];
  assert.deepEqual(visibleDepthEntries(entries, {
    sourceX: 100, sourceY: 100, sourceWidth: 100, sourceHeight: 100
  }, 30).map((entry) => entry.id), ['visible']);
});

test('saved progress is isolated by repository name and inspection digest', () => {
  const left = progressStorageKey('example/repo', 'a'.repeat(64));
  const rightRepo = progressStorageKey('other/repo', 'a'.repeat(64));
  const rightDigest = progressStorageKey('example/repo', 'b'.repeat(64));
  assert.notEqual(left, rightRepo);
  assert.notEqual(left, rightDigest);
  assert.match(left, /example%2Frepo/);
});

test('survey-scope fallback facts keep observed and unknown language honest', () => {
  assert.equal(describeFact({
    type: 'survey_scope',
    params: { dimension: 'repository', name: 'tiny-town' },
    evidence: { observed: ['inspection.repository.name.observed'], inferred: [], unknown: [] },
    sayings: { primary: 'fact.survey_scope.primary' }
  }), 'この街は「tiny-town」リポジトリの測量結果です。');
  assert.equal(describeFact({
    type: 'survey_scope',
    params: { dimension: 'files', count: 0 },
    evidence: { observed: [], inferred: [], unknown: ['inspection.file.inventory.unknown'] },
    sayings: { primary: 'fact.survey_scope.primary' }
  }), 'この検査では、街を作るファイルの総数はまだ分かりません。');
  assert.equal(describeFact({
    type: 'survey_scope',
    params: { dimension: 'static_dependencies', count: 7 },
    evidence: { observed: ['inspection.dependency.inventory.observed'], inferred: [], unknown: [] },
    sayings: { primary: 'fact.survey_scope.primary' }
  }), 'ファイル同士を結ぶ静的な道を 7 本、直接確認しました。');
});

test('dialogue copy is at most three Japanese-readable lines of forty characters', () => {
  const formatted = formatDialogueText('これは長い会話です。'.repeat(30));
  const lines = formatted.split('\n');
  assert.ok(lines.length <= 3);
  assert.ok(lines.every((line) => Array.from(line).length <= 40));
  assert.match(lines.at(-1), /…$/);
  assert.equal(formatDialogueText('一行目です。 二行目も同じ入力です。'), '一行目です。 二行目も同じ入力です。');
});

test('unverified wording does not claim an inactive dojo is broken', () => {
  const copy = describeFact({
    id: 'fact.unverified',
    type: 'unverified',
    params: { path: 'src/dojo.mjs' },
    evidence: { observed: [], inferred: [], unknown: ['inspection.file.unverified'] },
    sayings: { primary: 'fact.unverified.primary', reflect: [] }
  });
  assert.match(copy, /まだ道場に通っていないだけ/);
  assert.match(copy, /壊れているとは確認されていません/);
  assert.doesNotMatch(copy, /src\//);
  assert.match(copy, /dojo\.mjs/);
});
