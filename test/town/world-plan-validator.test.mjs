import assert from 'node:assert/strict';
import test from 'node:test';
import { FACILITY_KINDS } from '../../src/town/schema.mjs';
import { generateWorldPlan } from '../../src/town/world-plan-generator.mjs';
import {
  annotateWorldPlan,
  validateWorldPlan
} from '../../src/town/world-plan-validator.mjs';

function inspectionFixture({ entrypoint = true } = {}) {
  const buildings = [
    {
      path: 'src/main.js', bytes: 4_096, kind: 'module', isTest: false, state: 'mapped',
      evidence: { unresolvedLinks: 0, cycle: false, associatedTest: false, reachability: 'reached-from-known-entrypoints' }
    },
    {
      path: 'src/view.js', bytes: 1_024, kind: 'interface', isTest: false, state: 'mapped',
      evidence: { unresolvedLinks: 0, cycle: false, associatedTest: true, reachability: 'reached-from-known-entrypoints' }
    },
    {
      path: 'test/view.test.js', bytes: 1_024, kind: 'module', isTest: true, state: 'mapped',
      evidence: { unresolvedLinks: 0, cycle: false, associatedTest: false, reachability: 'reached-from-known-entrypoints' }
    }
  ];
  const edges = [{ from: 'src/main.js', to: 'src/view.js', kind: 'import', status: 'resolved' }];
  return {
    repository: { name: 'validator-town' },
    summary: { truncated: false },
    city: { buildings },
    graph: {
      nodes: buildings.map(({ path }) => ({ path })),
      edges,
      entrypoints: entrypoint ? [{ path: 'src/main.js', evidence: 'fixture' }] : []
    },
    inspection: {
      observed: { unresolvedLinks: [] },
      inferred: {
        cycles: [],
        testAssociations: [{ source: 'src/view.js', test: 'test/view.test.js', evidence: 'fixture' }]
      },
      unknownDependencies: []
    }
  };
}

function modelFixture({ gate = true } = {}) {
  return {
    facilities: FACILITY_KINDS.map((kind) => ({
      kind,
      present: kind === 'town_hall' || kind === 'dojo' || kind === 'house' || (kind === 'gate' && gate),
      count: 1,
      evidence: { observed: ['fixture'], inferred: [], unknown: [] }
    }))
  };
}

function validFixture() {
  const inspection = inspectionFixture();
  const plan = generateWorldPlan({ inspection, model: modelFixture() });
  return { inspection, plan };
}

function transitionFixture() {
  const inspection = inspectionFixture();
  const extra = {
    path: 'config/settings.js', bytes: 1_024, kind: 'configuration', isTest: false, state: 'mapped',
    evidence: { unresolvedLinks: 0, cycle: false, associatedTest: false, reachability: 'reached-from-known-entrypoints' }
  };
  inspection.city.buildings.push(extra);
  inspection.graph.nodes.push({ path: extra.path });
  return { inspection, plan: generateWorldPlan({ inspection, model: modelFixture() }) };
}

function multiRoomFixture() {
  const buildings = Array.from({ length: 121 }, (_, index) => ({
    path: `src/leaf/file-${index}.js`, bytes: 1_024, kind: 'module', isTest: false, state: 'mapped',
    evidence: { unresolvedLinks: 0, cycle: false, associatedTest: false, reachability: 'reached-from-known-entrypoints' }
  }));
  const inspection = {
    repository: { name: 'room-validator-town' }, city: { buildings },
    graph: { nodes: buildings.map(({ path }) => ({ path })), edges: [], entrypoints: [] },
    inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
  };
  return {
    inspection,
    plan: generateWorldPlan({ inspection, model: modelFixture({ gate: false }) })
  };
}

function terrainAt(plan, x, y) {
  return plan.terrain[y * plan.world.widthTiles + x];
}

test('accepts and freezes a plan that satisfies the player-visible invariants', () => {
  const { inspection, plan } = validFixture();
  const validation = validateWorldPlan(plan, { inspection });
  const annotated = annotateWorldPlan(plan, { inspection });

  assert.deepEqual(validation, { ok: true, issues: [] });
  assert.equal(Object.isFrozen(validation), true);
  assert.equal(annotated.validation.ok, true);
  assert.equal(Object.isFrozen(annotated), true);
  assert.equal(Object.isFrozen(annotated.validation), true);
});

test('SPRITE_CLEARANCE rejects a roof anchor that would crop a 384px exterior', () => {
  const { inspection, plan } = validFixture();
  const changed = structuredClone(plan);
  const building = changed.buildings.find(({ class: buildingClass }) => buildingClass === 'XL');
  building.footprint.y = 0;

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'SPRITE_CLEARANCE' && /384px exterior/.test(message)
  )));
});

test('fails closed with STRUCTURE for malformed input instead of throwing', () => {
  for (const malformed of [null, {}, [], { schemaVersion: 2 }]) {
    const verdict = validateWorldPlan(malformed);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.issues.some(({ code, severity }) => code === 'STRUCTURE' && severity === 'error'));
    assert.equal(Object.isFrozen(verdict), true);
  }
});

test('STREET_CONNECTS_IMPORT rejects invented and missing import bindings', () => {
  const { inspection, plan } = validFixture();
  const changed = structuredClone(plan);
  const street = changed.streets.find(({ kind }) => kind !== 'civic-avenue');
  street.edges = ['invented.js→ghost.js'];
  street.edgeBindings = [{
    from: 'invented.js', to: 'ghost.js', targetHint: null,
    kind: 'import', status: 'resolved'
  }];

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'STREET_CONNECTS_IMPORT' && /unobserved import/.test(message)
  )));
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'STREET_CONNECTS_IMPORT' && /must have 1 street binding/.test(message)
  )));
});

test('STREET_CONNECTS_IMPORT validates kind, status, and multiplicity as a multiset', () => {
  const inspection = inspectionFixture();
  inspection.graph.edges = [
    { from: 'src/main.js', to: 'src/view.js', kind: 'import', status: 'resolved' },
    { from: 'src/main.js', to: 'src/view.js', kind: 'dynamic-import', status: 'resolved' }
  ];
  const plan = generateWorldPlan({ inspection, model: modelFixture() });
  assert.equal(validateWorldPlan(plan, { inspection }).ok, true);
  const changed = structuredClone(plan);
  const dynamicStreet = changed.streets.find((street) => (
    street.edgeBindings[0]?.kind === 'dynamic-import'
  ));
  changed.streets = changed.streets.filter(({ id }) => id !== dynamicStreet.id);

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'STREET_CONNECTS_IMPORT'
      && /dynamic-import\/resolved/.test(message)
      && /found 0/.test(message)
  )));
});

test('STRUCTURE rejects a building file whose corresponding room is removed', () => {
  const { inspection, plan } = validFixture();
  const changed = structuredClone(plan);
  const building = changed.buildings.find(({ files }) => files.length > 0);
  building.rooms = [];

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'STRUCTURE' && /exactly one room/.test(message)
  )));
});

test('INTERIOR_WALKABLE rejects rooms that share floors or residents', () => {
  const { inspection, plan } = multiRoomFixture();
  const changed = structuredClone(plan);
  const rowhouse = changed.buildings.find(({ rooms }) => rooms.length > 1);
  rowhouse.rooms[1].floorNavNodeIds = [...rowhouse.rooms[0].floorNavNodeIds];
  rowhouse.rooms[1].npcId = rowhouse.rooms[0].npcId;

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /lacks its own interior floor node/.test(message)
  )));
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /shared by more than one room/.test(message)
  )));
});

test('INTERIOR_WALKABLE rejects spatially shared room floors and off-floor residents', () => {
  const { inspection, plan } = multiRoomFixture();
  const changed = structuredClone(plan);
  const rowhouse = changed.buildings.find(({ rooms }) => rooms.length > 1);
  const [firstRoom, secondRoom] = rowhouse.rooms;
  const nodeById = new Map(changed.nav.nodes.map((node) => [node.id, node]));
  const firstFloor = nodeById.get(firstRoom.floorNavNodeIds[0]);
  const secondFloor = nodeById.get(secondRoom.floorNavNodeIds[0]);
  secondFloor.x = firstFloor.x;
  secondFloor.y = firstFloor.y;
  const secondResident = changed.npcs.find(({ id }) => id === secondRoom.npcId);
  secondResident.patrol = [[firstFloor.x, firstFloor.y]];

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /floor coordinate/.test(message)
  )));

  const offFloor = structuredClone(plan);
  const offFloorRowhouse = offFloor.buildings.find(({ rooms }) => rooms.length > 1);
  const offFloorNodeById = new Map(offFloor.nav.nodes.map((node) => [node.id, node]));
  const ownRoom = offFloorRowhouse.rooms[1];
  const otherFloor = offFloorNodeById.get(offFloorRowhouse.rooms[0].floorNavNodeIds[0]);
  const resident = offFloor.npcs.find(({ id }) => id === ownRoom.npcId);
  resident.patrol = [[otherFloor.x, otherFloor.y]];
  resident.home = offFloor.buildings.find(({ id }) => id !== offFloorRowhouse.id).id;
  const offFloorVerdict = validateWorldPlan(offFloor, { inspection });
  assert.equal(offFloorVerdict.ok, false);
  assert.ok(offFloorVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /lacks its own resident/.test(message)
  )));
});

test('INTERIOR_WALKABLE binds exactly one door to the owning building entrance', () => {
  const { inspection, plan } = multiRoomFixture();
  const changed = structuredClone(plan);
  const rowhouse = changed.buildings.find(({ rooms }) => rooms.length > 1);
  const nodeById = new Map(changed.nav.nodes.map((node) => [node.id, node]));
  const existingDoor = changed.nav.edges.find((edge) => (
    edge.kind === 'door'
      && [nodeById.get(edge.from), nodeById.get(edge.to)].some((node) => node?.buildingId === rowhouse.id)
  ));
  changed.nav.edges.push({
    id: 'nav.extra-room-door',
    from: existingDoor.from,
    to: rowhouse.rooms[1].floorNavNodeIds[0],
    kind: 'door'
  });
  const extraVerdict = validateWorldPlan(changed, { inspection });
  assert.equal(extraVerdict.ok, false);
  assert.ok(extraVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /exactly one door/.test(message)
  )));

  const wrongEntrance = structuredClone(plan);
  const wrongNodeById = new Map(wrongEntrance.nav.nodes.map((node) => [node.id, node]));
  const door = wrongEntrance.nav.edges.find((edge) => edge.kind === 'door');
  const outdoorField = wrongNodeById.get(door.from).space === 'outdoor' ? 'from' : 'to';
  const interior = wrongNodeById.get(outdoorField === 'from' ? door.to : door.from);
  const building = wrongEntrance.buildings.find(({ id }) => id === interior.buildingId);
  const arbitraryOutdoor = wrongEntrance.nav.nodes.find((node) => (
    node.space === 'outdoor' && (node.x !== building.entrance.x || node.y !== building.entrance.y)
  ));
  door[outdoorField] = arbitraryOutdoor.id;
  const wrongVerdict = validateWorldPlan(wrongEntrance, { inspection });
  assert.equal(wrongVerdict.ok, false);
  assert.ok(wrongVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /exact entrance and interior/.test(message)
  )));
});

test('INTERIOR_WALKABLE rejects a retargeted doorway and indoor elevation drift', () => {
  const { inspection, plan } = multiRoomFixture();
  const retargeted = structuredClone(plan);
  const rowhouse = retargeted.buildings.find(({ rooms }) => rooms.length > 1);
  const nodeById = new Map(retargeted.nav.nodes.map((node) => [node.id, node]));
  const door = retargeted.nav.edges.find((edge) => edge.kind === 'door'
    && [nodeById.get(edge.from), nodeById.get(edge.to)].some((node) => node?.buildingId === rowhouse.id));
  const interiorField = nodeById.get(door.from).space === 'interior' ? 'from' : 'to';
  door[interiorField] = rowhouse.rooms.at(-1).floorNavNodeIds[0];

  const retargetedVerdict = validateWorldPlan(retargeted, { inspection });
  assert.equal(retargetedVerdict.ok, false);
  assert.ok(retargetedVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /immediately-inside tile/.test(message)
  )));

  const elevated = structuredClone(plan);
  const elevatedNodeById = new Map(elevated.nav.nodes.map((node) => [node.id, node]));
  const elevatedDoor = elevated.nav.edges.find((edge) => edge.kind === 'door');
  const elevatedInterior = elevatedNodeById.get(elevatedNodeById.get(elevatedDoor.from).space === 'interior'
    ? elevatedDoor.from : elevatedDoor.to);
  elevatedInterior.elevation += 5;

  const elevatedVerdict = validateWorldPlan(elevated, { inspection });
  assert.equal(elevatedVerdict.ok, false);
  assert.ok(elevatedVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /entrance elevation/.test(message)
  )));
});

test('INTERIOR_WALKABLE rejects every unclaimed or duplicate common interior floor', () => {
  const { inspection, plan } = validFixture();
  const changed = structuredClone(plan);
  const survey = changed.buildings.find(({ id }) => id === 'building.survey_tower');
  const existing = changed.nav.nodes.find((node) => (
    node.space === 'interior' && node.buildingId === survey.id
  ));
  const occupied = new Set(changed.nav.nodes.filter((node) => node.space === 'interior'
    && node.buildingId === survey.id).map(({ x, y }) => `${x},${y}`));
  const [x, y] = [[existing.x - 1, existing.y], [existing.x + 1, existing.y], [existing.x, existing.y - 1]]
    .find(([candidateX, candidateY]) => candidateX >= survey.footprint.x
      && candidateX < survey.footprint.x + survey.footprint.w
      && candidateY >= survey.footprint.y
      && candidateY < survey.footprint.y + survey.footprint.h
      && !occupied.has(`${candidateX},${candidateY}`));
  changed.nav.nodes.push({
    id: 'nav.extra.common', x, y, elevation: existing.elevation,
    space: 'interior', buildingId: survey.id
  });
  changed.nav.edges.push({
    id: 'nav.extra.common.edge', from: existing.id, to: 'nav.extra.common', kind: 'walk'
  });

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /exactly one common interior floor/.test(message)
  )));

  const duplicate = structuredClone(plan);
  const duplicateExisting = duplicate.nav.nodes.find((node) => (
    node.space === 'interior' && node.buildingId === survey.id
  ));
  duplicate.nav.nodes.push({
    id: 'nav.duplicate.common', x: duplicateExisting.x, y: duplicateExisting.y,
    elevation: duplicateExisting.elevation, space: 'interior', buildingId: survey.id
  });
  const duplicateVerdict = validateWorldPlan(duplicate, { inspection });
  assert.equal(duplicateVerdict.ok, false);
  assert.ok(duplicateVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /coordinate.*duplicated/.test(message)
  )));
});

test('INTERIOR_WALKABLE validates every NPC home floor and forbids unassigned residents', () => {
  const { inspection, plan } = validFixture();
  const outsideClerk = structuredClone(plan);
  const clerk = outsideClerk.npcs.find(({ assetId }) => assetId === 'character.town_clerk');
  const townHall = outsideClerk.buildings.find(({ id }) => id === clerk.home);
  clerk.patrol = [[townHall.entrance.x, townHall.entrance.y]];
  const outsideVerdict = validateWorldPlan(outsideClerk, { inspection });
  assert.equal(outsideVerdict.ok, false);
  assert.ok(outsideVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && message.includes(clerk.id)
      && /reachable outdoor tile beside its home entrance/.test(message)
  )));

  const unassigned = structuredClone(plan);
  const survey = unassigned.buildings.find(({ id }) => id === 'building.survey_tower');
  const commonFloor = unassigned.nav.nodes.find((node) => (
    node.space === 'interior' && node.buildingId === survey.id
  ));
  unassigned.npcs.push({
    id: 'npc.extra.unassigned', assetId: 'character.mob.townsfolk_male',
    role: 'resident', home: survey.id, patrol: [[commonFloor.x, commonFloor.y]], factRefs: []
  });
  const unassignedVerdict = validateWorldPlan(unassigned, { inspection });
  assert.equal(unassignedVerdict.ok, false);
  assert.ok(unassignedVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && /assigned to exactly one room/.test(message)
  )));
});

test('INTERIOR_WALKABLE binds semantic NPC roles to matching home facilities only', () => {
  const inspection = inspectionFixture();
  const model = modelFixture();
  for (const facility of model.facilities) {
    if (facility.kind === 'inn' || facility.kind === 'guild') facility.present = true;
  }
  const plan = generateWorldPlan({ inspection, model });
  assert.equal(validateWorldPlan(plan, { inspection }).ok, true);

  const wrongKeeper = structuredClone(plan);
  const innKeeper = wrongKeeper.npcs.find(({ role }) => role === 'keeper.inn');
  const guild = wrongKeeper.buildings.find(({ facilityKind }) => facilityKind === 'guild');
  const guildFloor = wrongKeeper.nav.nodes.find((node) => (
    node.space === 'interior' && node.buildingId === guild.id
  ));
  innKeeper.home = guild.id;
  innKeeper.patrol = [[guildFloor.x, guildFloor.y]];
  const keeperVerdict = validateWorldPlan(wrongKeeper, { inspection });
  assert.equal(keeperVerdict.ok, false);
  assert.ok(keeperVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && message.includes(innKeeper.id) && /must match home facility "guild"/.test(message)
  )));

  const wrongStudent = structuredClone(plan);
  const student = wrongStudent.npcs.find(({ role }) => role === 'dojo-student');
  const inn = wrongStudent.buildings.find(({ facilityKind }) => facilityKind === 'inn');
  const innFloor = wrongStudent.nav.nodes.find((node) => (
    node.space === 'interior' && node.buildingId === inn.id
  ));
  student.home = inn.id;
  student.patrol = [[innFloor.x, innFloor.y]];
  const studentVerdict = validateWorldPlan(wrongStudent, { inspection });
  assert.equal(studentVerdict.ok, false);
  assert.ok(studentVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && message.includes(student.id) && /must have a dojo home/.test(message)
  )));

  const allowedRoles = structuredClone(plan);
  const allowedInn = allowedRoles.buildings.find(({ facilityKind }) => facilityKind === 'inn');
  const allowedInnFloor = allowedRoles.nav.nodes.find((node) => (
    node.space === 'interior' && node.buildingId === allowedInn.id
  ));
  allowedRoles.npcs.push({
    id: 'npc.visitor', assetId: 'character.mob.townsfolk_female', role: 'visitor',
    home: allowedInn.id, patrol: [[allowedInnFloor.x, allowedInnFloor.y]], factRefs: []
  });
  const existingStudent = allowedRoles.npcs.find(({ role }) => role === 'dojo-student');
  allowedRoles.npcs.push({ ...structuredClone(existingStudent), id: 'npc.dojo_student.second' });
  assert.equal(validateWorldPlan(allowedRoles, { inspection }).ok, true);

  const emptyInspection = {
    repository: { name: 'witness-role-town' }, city: { buildings: [] },
    graph: { nodes: [], edges: [], entrypoints: [] },
    inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
  };
  const wrongWitness = structuredClone(generateWorldPlan({ inspection: emptyInspection, model: { facilities: [] } }));
  const witness = wrongWitness.npcs.find(({ role }) => role === 'witness');
  const fieldStation = wrongWitness.buildings.find(({ id }) => id === 'building.witness.field_station');
  witness.home = fieldStation.id;
  witness.patrol = [[fieldStation.entrance.x, fieldStation.entrance.y]];
  const witnessVerdict = validateWorldPlan(wrongWitness, { inspection: emptyInspection });
  assert.equal(witnessVerdict.ok, false);
  assert.ok(witnessVerdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && message.includes(witness.id) && /designated witness home/.test(message)
  )));
});

test('WALKABLE validates terrain elevation and typed bridge/stairs boundaries', () => {
  const { inspection, plan } = transitionFixture();
  const nodeElevation = structuredClone(plan);
  const outdoor = nodeElevation.nav.nodes.find(({ space }) => space === 'outdoor');
  outdoor.elevation += 1;
  const elevationVerdict = validateWorldPlan(nodeElevation, { inspection });
  assert.equal(elevationVerdict.ok, false);
  assert.ok(elevationVerdict.issues.some(({ code, message }) => (
    code === 'WALKABLE' && /elevation differs from its terrain/.test(message)
  )));

  for (const kind of ['bridge', 'stairs']) {
    const missingMarker = structuredClone(plan);
    const edge = missingMarker.nav.edges.find((candidate) => candidate.kind === kind);
    missingMarker.props = missingMarker.props.filter(({ navEdgeId }) => navEdgeId !== edge.id);
    const verdict = validateWorldPlan(missingMarker, { inspection });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.issues.some(({ code, message }) => (
      code === 'WALKABLE' && message.includes(`${kind} edge`) && /exactly one bound transition marker/.test(message)
    )));
  }
});

test('WALKABLE rejects transition bypasses, wrong elevation deltas, and broken boundary terrain', () => {
  const { inspection, plan } = transitionFixture();
  const bypass = structuredClone(plan);
  const bridge = bypass.nav.edges.find(({ kind }) => kind === 'bridge');
  bridge.kind = 'walk';
  bypass.props = bypass.props.filter(({ navEdgeId }) => navEdgeId !== bridge.id);
  const bypassVerdict = validateWorldPlan(bypass, { inspection });
  assert.equal(bypassVerdict.ok, false);
  assert.ok(bypassVerdict.issues.some(({ code, message }) => (
    code === 'WALKABLE' && /lacks its bridge transition marker/.test(message)
  )));

  const wrongDelta = structuredClone(plan);
  const stairs = wrongDelta.nav.edges.find(({ kind }) => kind === 'stairs');
  const wrongDeltaNodes = new Map(wrongDelta.nav.nodes.map((node) => [node.id, node]));
  wrongDeltaNodes.get(stairs.to).elevation = wrongDeltaNodes.get(stairs.from).elevation;
  const deltaVerdict = validateWorldPlan(wrongDelta, { inspection });
  assert.equal(deltaVerdict.ok, false);
  assert.ok(deltaVerdict.issues.some(({ code, message }) => (
    code === 'WALKABLE' && /invalid elevation change/.test(message)
  )));

  const brokenBoundary = structuredClone(plan);
  const brokenBridge = brokenBoundary.nav.edges.find(({ kind }) => kind === 'bridge');
  const prop = brokenBoundary.props.find(({ navEdgeId }) => navEdgeId === brokenBridge.id);
  const brokenNodes = new Map(brokenBoundary.nav.nodes.map((node) => [node.id, node]));
  const from = brokenNodes.get(brokenBridge.from);
  const to = brokenNodes.get(brokenBridge.to);
  const marker = prop.x === from.x && prop.y === from.y ? from : to;
  const other = marker === from ? to : from;
  const dx = marker.x - other.x;
  const dy = marker.y - other.y;
  terrainAt(brokenBoundary, marker.x - dy, marker.y + dx).assetId = 'terrain.grass';
  const boundaryVerdict = validateWorldPlan(brokenBoundary, { inspection });
  assert.equal(boundaryVerdict.ok, false);
  assert.ok(boundaryVerdict.issues.some(({ code, message }) => (
    code === 'WALKABLE' && /does not cross its terrain.water boundary/.test(message)
  )));
});

test('WALKABLE rejects non-adjacent movement edges and terrain/nav mismatches', () => {
  const { inspection, plan } = validFixture();
  const changed = structuredClone(plan);
  const outdoor = changed.nav.nodes.filter(({ space }) => space === 'outdoor');
  changed.nav.edges.push({
    id: 'nav.teleporting-walk', from: outdoor[0].id, to: outdoor.at(-1).id, kind: 'walk'
  });
  const walkableIndex = changed.terrain.findIndex(({ walkable }) => walkable);
  changed.terrain[walkableIndex].walkable = false;

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code, message }) => code === 'WALKABLE' && /adjacent/.test(message)));
  assert.ok(verdict.issues.some(({ code, message }) => code === 'WALKABLE' && /not on walkable terrain/.test(message)));
});

test('INTERIOR_WALKABLE rejects an M+ building whose entrance has no door', () => {
  const { inspection, plan } = validFixture();
  const changed = structuredClone(plan);
  const building = changed.buildings.find(({ facilityKind }) => facilityKind === 'town_hall');
  changed.nav.edges = changed.nav.edges.filter((edge) => !(
    edge.kind === 'door' && (edge.from.includes(building.id) || edge.to.includes(building.id))
  ));

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code, message }) => (
    code === 'INTERIOR_WALKABLE' && message.includes(building.id)
  )));
});

test('SIGHTLINE_TO_LANDMARK requires the permanent survey tower', () => {
  const { inspection, plan } = validFixture();
  const changed = structuredClone(plan);
  const survey = changed.buildings.find(({ id }) => id === 'building.survey_tower');
  survey.id = 'building.renamed_survey_tower';
  for (const district of changed.districts) {
    if (district.landmarkId === 'building.survey_tower') district.landmarkId = survey.id;
  }
  for (const node of changed.nav.nodes) {
    if (node.buildingId === 'building.survey_tower') node.buildingId = survey.id;
  }

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code }) => code === 'SIGHTLINE_TO_LANDMARK'));
});

test('NO_OVERLAP catches colliding building footprints', () => {
  const { inspection, plan } = validFixture();
  const changed = structuredClone(plan);
  const first = changed.buildings.find(({ facilityKind }) => facilityKind === 'town_hall');
  const second = changed.buildings.find(({ facilityKind }) => facilityKind === 'house');
  second.footprint = { ...first.footprint };

  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code }) => code === 'NO_OVERLAP'));
});

test('missing observed entrypoint is an honest warning, not a broken town', () => {
  const inspection = inspectionFixture({ entrypoint: false });
  const plan = generateWorldPlan({ inspection, model: modelFixture({ gate: false }) });
  const verdict = validateWorldPlan(plan, { inspection });

  assert.equal(verdict.ok, true);
  assert.ok(verdict.issues.some(({ code, severity }) => (
    code === 'REACHABLE' && severity === 'warning'
  )));
});

test('WITNESS_INTERACTION rejects a first tour with fewer than three factual non-ledger families', () => {
  const inspection = {
    repository: { name: 'empty-validator-town' },
    city: { buildings: [] },
    graph: { nodes: [], edges: [], entrypoints: [] },
    inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
  };
  const plan = generateWorldPlan({ inspection, model: { facilities: [] } });
  assert.equal(validateWorldPlan(plan, { inspection }).ok, true);

  const changed = structuredClone(plan);
  for (const building of changed.buildings) {
    if (building.id !== 'building.survey_tower'
      && building.facilityKind !== 'town_hall') building.interaction.factRefs = [];
  }
  const verdict = validateWorldPlan(changed, { inspection });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some(({ code }) => code === 'WITNESS_INTERACTION'));
});
