import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ACTOR_CONTRACT,
  CLUE_INTERACTIONS,
  EXTERIOR_BLOCKERS,
  GAMEPLAY_ZOOM,
  INN_CONTRACT,
  PLAYER_WALK_FRAME_DURATION_MS,
  WALKABLE_ROUTE_POLYGONS,
  evidenceDialoguePages,
  isExteriorWalkable,
  isInteriorWalkable,
  moveActor,
  nearbyInteraction,
  spriteFrame
} from '../../public/fable5-v2/world-runtime.mjs';
import { inspectRepository } from '../../src/inspector.mjs';
import { buildTownPayload } from '../../src/town/index.mjs';
import { PREFAB_CATALOG } from '../../src/town/prefab-catalog.mjs';
import { FACILITY_KINDS } from '../../src/town/schema.mjs';
import { generateWorldPlan } from '../../src/town/world-plan-generator.mjs';
import { validateWorldPlanShape } from '../../src/town/world-plan-schema.mjs';
import { validateWorldPlan } from '../../src/town/world-plan-validator.mjs';

function file(path, overrides = {}) {
  return {
    id: `file.${path}`,
    path,
    bytes: 4_096,
    kind: 'module',
    isTest: false,
    state: 'mapped',
    evidence: {
      unresolvedLinks: 0,
      cycle: false,
      associatedTest: true,
      reachability: 'reachable'
    },
    ...overrides
  };
}

function fixture() {
  const service = file('src/server.mjs');
  const closed = file('src/legacy.mjs', {
    state: 'unverified',
    evidence: {
      unresolvedLinks: 0,
      cycle: false,
      associatedTest: false,
      reachability: 'not-reached-from-known-entrypoints'
    }
  });
  const inspection = {
    schemaVersion: 2,
    repository: { name: 'semantic-prefab-town' },
    summary: { truncated: false },
    city: { buildings: [service, closed] },
    graph: {
      nodes: [service, closed].map(({ id, path }) => ({ id, path })),
      edges: [],
      entrypoints: [{ path: service.path, evidence: 'package.start' }]
    },
    inspection: {
      observed: { unresolvedLinks: [] },
      inferred: { cycles: [], testAssociations: [] },
      unknownDependencies: []
    }
  };
  const model = {
    facilities: FACILITY_KINDS.map((kind) => ({
      kind,
      present: kind === 'town_hall' || kind === 'inn',
      count: kind === 'town_hall' || kind === 'inn' ? 1 : 0,
      evidence: { observed: ['fixture'], inferred: [], unknown: [] }
    }))
  };
  const semanticAnnotations = [
    {
      path: service.path,
      role: 'service',
      evidence: { observed: [], inferred: ['inspection.entrypoint', 'semantic.service'], unknown: [] }
    },
    {
      path: closed.path,
      role: 'module',
      evidence: { observed: [], inferred: ['semantic.module'], unknown: ['runtime.use'] }
    }
  ];
  return { inspection, model, semanticAnnotations };
}

function generate(seed) {
  return generateWorldPlan({ ...fixture(), seed });
}

test('prefab catalog binds media, animation, collision, sound, behavior, and events', () => {
  const inn = PREFAB_CATALOG['prefab.service.inn.enterable'];
  const closed = PREFAB_CATALOG['prefab.module.closed-unreached'];
  for (const prefab of [inn, closed]) {
    assert.match(prefab.assetId, /^building\./);
    assert.match(prefab.animationSetId, /^animation\./);
    assert.match(prefab.behaviorId, /^behavior\./);
    assert.match(prefab.soundSetId, /^sound\./);
    assert.ok(prefab.eventIds.length >= 2);
    assert.equal(prefab.labelMode, 'proximity');
    assert.ok(prefab.collision.exterior);
  }
  assert.equal(inn.cutaway.animationDurationMs, 460);
  assert.equal(inn.cutaway.easing, 'ease-in-out-cubic');
  assert.equal(inn.animationSetId, 'animation.building.cutaway.fade');
  assert.deepEqual(inn.collision, {
    exterior: 'solid-footprint', entrance: 'door', interior: 'walkable'
  });
  assert.ok(inn.eventIds.includes('event.facility.talk-keeper'));
  assert.equal(inn.access, 'enterable');
  assert.equal(closed.access, 'closed');
  assert.deepEqual(closed.visual.overlayAssetIds, ['overlay.ivy.m']);
});

test('maps only the reachable service to an enterable inn and the unverified unreached module to closed', () => {
  const { inspection } = fixture();
  const plan = generate('prefab-seed-a');
  const verdict = validateWorldPlan(plan, { inspection });
  assert.deepEqual(validateWorldPlanShape(plan), { ok: true, issues: [] });
  assert.equal(verdict.ok, true);
  assert.ok(verdict.issues.every(({ severity }) => severity !== 'error'));

  const inn = plan.buildings.find(({ prefabId }) => prefabId === 'prefab.service.inn.enterable');
  const closed = plan.buildings.find(({ prefabId }) => prefabId === 'prefab.module.closed-unreached');
  assert.ok(inn);
  assert.ok(closed);
  assert.equal(inn.access, 'enterable');
  assert.equal(inn.labelMode, 'proximity');
  assert.equal(inn.animationSetId, 'animation.building.cutaway.fade');
  assert.equal(inn.cutawayDurationMs, 460);
  assert.equal(inn.cutawayEasing, 'ease-in-out-cubic');
  assert.equal(inn.collisionExterior, 'solid-footprint');
  assert.equal(inn.collisionEntrance, 'door');
  assert.equal(inn.collisionInterior, 'walkable');
  assert.deepEqual(inn.eventIds, PREFAB_CATALOG[inn.prefabId].eventIds);
  assert.equal(inn.speakerRole, 'keeper.inn');
  assert.equal(closed.access, 'closed');
  assert.equal(closed.collisionExterior, 'solid-footprint');
  assert.equal(closed.collisionEntrance, 'blocked');
  assert.equal(closed.collisionInterior, 'none');
  assert.deepEqual(closed.eventIds, PREFAB_CATALOG[closed.prefabId].eventIds);
  assert.ok(closed.overlays.includes('overlay.ivy.m'));
  assert.equal(closed.interaction.verb, 'inspect-closure-sign');

  const nodeById = new Map(plan.nav.nodes.map((node) => [node.id, node]));
  const prefabDoorBuildingIds = plan.nav.edges.filter(({ kind }) => kind === 'door')
    .flatMap((edge) => {
      const interior = [nodeById.get(edge.from), nodeById.get(edge.to)]
        .find((node) => node?.space === 'interior');
      return interior && [inn.id, closed.id].includes(interior.buildingId)
        ? [interior.buildingId] : [];
    });
  assert.deepEqual(prefabDoorBuildingIds, [inn.id]);
  assert.ok(plan.nav.nodes.some((node) => node.space === 'interior' && node.buildingId === inn.id));
  assert.equal(plan.nav.nodes.some((node) => node.space === 'interior' && node.buildingId === closed.id), false);
  assert.ok(closed.rooms.every(({ npcId }) => npcId === null));
  assert.equal(plan.npcs.some(({ home }) => home === closed.id), false);
  const closedSign = plan.props.find(({ kind }) => kind === 'closed-unreached-needs-confirmation');
  assert.equal(closedSign.assetId, 'structure.signpost_broken');
  assert.equal(Math.abs(closedSign.x - closed.entrance.x) + Math.abs(closedSign.y - closed.entrance.y), 1);
  assert.ok(closed.rooms[0].props.includes(closedSign.id));

  const factsById = new Map(plan.facts.map((fact) => [fact.id, fact]));
  const closedFacts = closed.interaction.factRefs.map((factId) => factsById.get(factId));
  assert.deepEqual(new Set(closedFacts.map(({ type }) => type)), new Set(['unreached', 'unverified']));
  assert.ok(closedFacts.some(({ evidence }) => evidence.inferred.length > 0));
  assert.ok(closedFacts.some(({ evidence }) => evidence.unknown.length > 0));
  assert.ok(closedFacts.every(({ evidence }) => evidence.observed.length === 0));

  const missingSign = structuredClone(plan);
  missingSign.props = missingSign.props.filter(({ id }) => id !== closedSign.id);
  missingSign.buildings.find(({ id }) => id === closed.id).rooms[0].props = [];
  assert.ok(validateWorldPlan(missingSign, { inspection }).issues
    .some(({ code }) => code === 'PREFAB_BINDING'));

  const mismatchedProgram = structuredClone(plan);
  mismatchedProgram.buildings.find(({ id }) => id === inn.id).cutawayDurationMs = 461;
  assert.ok(validateWorldPlan(mismatchedProgram, { inspection }).issues
    .some(({ code }) => code === 'PREFAB_BINDING'));

  const mismatchedCollision = structuredClone(plan);
  mismatchedCollision.buildings.find(({ id }) => id === inn.id).collisionEntrance = 'blocked';
  assert.ok(validateWorldPlan(mismatchedCollision, { inspection }).issues
    .some(({ code }) => code === 'PREFAB_BINDING'));

  const mismatchedEvents = structuredClone(plan);
  mismatchedEvents.buildings.find(({ id }) => id === inn.id).eventIds = ['event.facility.approach'];
  assert.ok(validateWorldPlan(mismatchedEvents, { inspection }).issues
    .some(({ code }) => code === 'PREFAB_BINDING'));

  const malformedProgram = structuredClone(plan);
  malformedProgram.buildings.find(({ id }) => id === inn.id).cutawayDurationMs = -1;
  assert.equal(validateWorldPlanShape(malformedProgram).ok, false);

  const unknownPrefab = structuredClone(plan);
  unknownPrefab.buildings.find(({ id }) => id === inn.id).prefabId = 'prefab.invented';
  assert.ok(validateWorldPlan(unknownPrefab, { inspection }).issues
    .some(({ code }) => code === 'PREFAB_BINDING'));
});

test('target-town n=1 geometry connects the expanded town, inn flow, and measured blockers', () => {
  assert.deepEqual(ACTOR_CONTRACT.spawn, { x: 650, y: 520 });
  assert.equal(ACTOR_CONTRACT.speed, 75);
  assert.equal(GAMEPLAY_ZOOM, 1);
  assert.equal(isExteriorWalkable(ACTOR_CONTRACT.spawn.x, ACTOR_CONTRACT.spawn.y), true);

  const walkTo = (start, destination, mode) => {
    let actor = { ...start, facing: start.facing ?? 'north' };
    let remaining = 2_000;
    while ((actor.x !== destination.x || actor.y !== destination.y) && remaining > 0) {
      const input = actor.x !== destination.x
        ? { x: Math.sign(destination.x - actor.x), y: 0 }
        : { x: 0, y: Math.sign(destination.y - actor.y) };
      const next = moveActor(actor, input, 1 / ACTOR_CONTRACT.speed, mode);
      assert.equal(next.moved, true, `blocked at ${actor.x},${actor.y} toward ${destination.x},${destination.y}`);
      actor = next;
      remaining -= 1;
    }
    assert.ok(remaining > 0, `movement guard exhausted toward ${destination.x},${destination.y}`);
    return actor;
  };

  // These checkpoints cross the measured main-road/inn-route overlap without
  // inventing walkable pixels outside the two production polygons.
  let exteriorActor = { ...ACTOR_CONTRACT.spawn, facing: 'north' };
  for (const point of [
    { x: 226, y: 520 },
    { x: 226, y: 495 },
    { x: 212, y: 495 },
    INN_CONTRACT.door.approachPoint
  ]) {
    exteriorActor = walkTo(exteriorActor, point, 'exterior');
  }

  assert.equal(nearbyInteraction({ x: 212, y: 493 }, 'exterior'), null);
  assert.equal(nearbyInteraction(exteriorActor, 'exterior')?.id, 'enter-inn');
  assert.equal(nearbyInteraction({ x: 250, y: 480 }, 'exterior'), null);
  assert.equal(nearbyInteraction(INN_CONTRACT.door.returnPoint, 'exterior'), null);

  assert.equal(isInteriorWalkable(INN_CONTRACT.interior.entryFoot.x, INN_CONTRACT.interior.entryFoot.y), true);
  assert.equal(isInteriorWalkable(212, 389), true);
  assert.equal(isInteriorWalkable(212, 388), false, 'actor radius keeps feet south of the counter boundary');
  let interiorActor = walkTo(INN_CONTRACT.interior.entryFoot, { x: 212, y: 400 }, 'interior');
  assert.equal(nearbyInteraction(interiorActor, 'interior')?.id, 'talk-innkeeper');
  interiorActor = walkTo(interiorActor, INN_CONTRACT.interior.entryFoot, 'interior');
  assert.equal(nearbyInteraction(interiorActor, 'interior')?.id, 'exit-inn');
  assert.deepEqual(INN_CONTRACT.objects.routeStreetlampFoot, { x: 327, y: 624 });

  const walkExteriorCheckpoints = (checkpoints) => {
    let actor = { ...ACTOR_CONTRACT.spawn, facing: 'north' };
    for (const checkpoint of checkpoints) actor = walkTo(actor, checkpoint, 'exterior');
    return actor;
  };

  const west = walkExteriorCheckpoints([
    { x: 200, y: 520 },
    { x: 200, y: 540 },
    { x: 20, y: 540 }
  ]);
  assert.deepEqual([west.x, west.y], [20, 540]);
  assert.equal(walkExteriorCheckpoints([
    { x: 650, y: 480 },
    { x: 1200, y: 480 },
    { x: 1200, y: 500 },
    { x: 1560, y: 500 }
  ]).x, 1560);
  assert.equal(walkExteriorCheckpoints([{ x: 760, y: 520 }, { x: 760, y: 310 }]).y, 310);
  const south = walkExteriorCheckpoints([
    { x: 720, y: 520 },
    { x: 720, y: 620 },
    { x: 690, y: 700 },
    { x: 650, y: 800 },
    { x: 620, y: 900 },
    { x: 620, y: 960 }
  ]);
  assert.deepEqual([south.x, south.y], [620, 960]);

  assert.deepEqual(CLUE_INTERACTIONS.map(({ id }) => id), [
    'clue-streetlamp',
    'clue-well',
    'clue-east-shop'
  ]);
  assert.deepEqual(CLUE_INTERACTIONS.map(({ shortLabel }) => shortLabel), [
    '古い街灯',
    '中央広場の井戸',
    '東市場の看板'
  ]);
  for (const clue of CLUE_INTERACTIONS) {
    assert.equal(isExteriorWalkable(clue.point.x, clue.point.y), true, `${clue.id} approach`);
    assert.equal(nearbyInteraction(clue.point, 'exterior')?.id, clue.id);
  }

  for (let startY = 472; startY <= 488; startY += 1) {
    let returnTrip = { x: 1200, y: startY, facing: 'west' };
    for (let step = 0; step < 260 && returnTrip.x > 226; step += 1) {
      const moved = moveActor(returnTrip, { x: -1, y: 0 }, 0.06, 'exterior');
      assert.equal(moved.blocked, false, `east-to-inn return blocked from y=${startY} near x=${returnTrip.x}`);
      returnTrip = { ...returnTrip, ...moved };
    }
    assert.ok(returnTrip.x <= 226, `east-to-inn return from y=${startY} ended at x=${returnTrip.x}`);
  }

  for (const [label, point] of Object.entries({
    westRoad: { x: 20, y: 540 },
    civicPlaza: { x: 760, y: 310 },
    eastRoad: { x: 1200, y: 500 },
    southPath: { x: 620, y: 960 },
    // The two east-market lamp posts (formerly 'east-road-west-lamp-base'
    // and 'east-road-east-lamp-base') no longer carry a ground collider: at
    // this road's ~115px width, any nonzero collider centred here, once
    // padded by the actor's own footprint, blocked every westbound return
    // through x~1300/1510 with no way to route around it under pure
    // east-west input. See the EXTERIOR_BLOCKERS comment in world-runtime.mjs.
    eastLampWest: { x: 1308, y: 472 },
    eastLampEast: { x: 1510, y: 474 }
  })) {
    assert.equal(isExteriorWalkable(point.x, point.y), true, label);
  }

  for (const [label, point] of Object.entries({
    innBuilding: { x: 120, y: 450 },
    eastShop: { x: 1200, y: 420 },
    flowerbed: { x: 632, y: 351 },
    well: { x: 850, y: 388 },
    routeLamp: INN_CONTRACT.objects.routeStreetlampFoot,
    westTrees: { x: 520, y: 650 },
    eastTrees: { x: 900, y: 520 },
    northForest: { x: 1450, y: 200 }
  })) {
    assert.equal(isExteriorWalkable(point.x, point.y), false, label);
  }

  assert.ok(WALKABLE_ROUTE_POLYGONS.length >= 8);
  const blockerIds = new Set(EXTERIOR_BLOCKERS.map(({ id }) => id));
  for (const id of [
    'inn-west-frontage',
    'plaza-well',
    'route-streetlamp-base',
    'plaza-east-lamp-base'
  ]) assert.equal(blockerIds.has(id), true, id);
  for (const id of ['east-road-west-lamp-base', 'east-road-east-lamp-base']) {
    assert.equal(blockerIds.has(id), false, `${id} ground collider stays removed`);
  }
});

test('player runtime uses all eight direction frames from a movement-relative phase zero', () => {
  const actor = { facing: 'east', moving: true, walkStartedAt: 1_000 };
  const frames = Array.from({ length: 8 }, (_, phase) => (
    spriteFrame(actor, 1_000 + phase * PLAYER_WALK_FRAME_DURATION_MS)
  ));
  assert.deepEqual(frames.map(({ sx }) => sx), [64, 128, 192, 256, 320, 384, 448, 512]);
  assert.deepEqual(new Set(frames.map(({ sy }) => sy)), new Set([256]));
  assert.ok(frames.every(({ offsetX, offsetY }) => offsetX === 0 && offsetY === 0));
  assert.equal(spriteFrame({ ...actor, moving: false }, 1_900).sx, 0);
  assert.equal(PLAYER_WALK_FRAME_DURATION_MS, 70);
});

test('innkeeper dialogue surfaces repository-specific observed, inferred, and unknown evidence', () => {
  const pages = evidenceDialoguePages({
    repository: { name: 'tiny-town' },
    facts: [
      { type: 'entrypoint', params: { path: 'src/main.js' }, evidence: { observed: ['entry'], inferred: [], unknown: [] } },
      { type: 'unresolved', params: { targetHint: 'src/missing-sign.js' }, evidence: { observed: ['link'], inferred: [], unknown: [] } },
      { type: 'cycle', params: { members: ['src/cycle-a.js', 'src/cycle-b.js'] }, evidence: { observed: [], inferred: ['cycle'], unknown: [] } },
      { type: 'unverified', params: { path: 'src/well.js' }, evidence: { observed: [], inferred: [], unknown: ['runtime'] } }
    ]
  });

  assert.deepEqual(pages.map(({ className }) => className), ['observed', 'inferred', 'unknown']);
  assert.match(pages[0].body, /src\/main\.js/);
  assert.match(pages[0].body, /src\/missing-sign\.js/);
  assert.match(pages[1].body, /src\/cycle-a\.js/);
  assert.match(pages[1].body, /src\/cycle-b\.js/);
  assert.match(pages[2].body, /1件/);
  assert.match(pages[2].body, /故障を意味しません/);
});

test('same seed is byte-stable while a different seed changes valid building placement', () => {
  const { inspection } = fixture();
  const first = generate('prefab-seed-a');
  const repeated = generate('prefab-seed-a');
  const changed = generate('prefab-seed-b');
  const coordinates = (plan) => plan.buildings.map(({ id, footprint }) => [id, footprint.x, footprint.y]);

  assert.deepEqual(repeated, first);
  assert.notDeepEqual(coordinates(changed), coordinates(first));
  assert.equal(validateWorldPlan(first, { inspection }).ok, true);
  assert.equal(validateWorldPlan(changed, { inspection }).ok, true);
});

test('town payload forwards candidate semantics into the generated prefab mapping', async () => {
  const { inspection, semanticAnnotations } = fixture();
  const repoPath = fileURLToPath(new URL('../../sample/tiny-town', import.meta.url));
  const payload = await buildTownPayload(repoPath, inspection, {
    seed: 'payload-prefab-seed',
    semanticAnnotations
  });

  assert.ok(payload.worldPlan.buildings.some(({ prefabId }) => (
    prefabId === 'prefab.service.inn.enterable'
  )));
  assert.ok(payload.worldPlan.buildings.some(({ prefabId }) => (
    prefabId === 'prefab.module.closed-unreached'
  )));
});

test('the bundled read-only sample exposes its reachable inn as an enterable prefab without LLM input', async () => {
  const repoPath = fileURLToPath(new URL('../../sample/tiny-town', import.meta.url));
  const inspection = await inspectRepository(repoPath);
  const payload = await buildTownPayload(repoPath, inspection);
  const inn = payload.worldPlan.buildings.find(({ prefabId }) => (
    prefabId === 'prefab.service.inn.enterable'
  ));

  assert.ok(inn);
  assert.equal(inn.access, 'enterable');
  assert.equal(inn.cutawayDurationMs, 460);
});
