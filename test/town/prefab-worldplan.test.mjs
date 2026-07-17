import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createWorldRuntime,
  residentConversationTarget,
  validateRuntimeWorldPlan
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

  const playable = structuredClone(plan);
  playable.validation = verdict;
  const runtime = createWorldRuntime(playable);
  const runtimeInn = runtime.buildingById.get(inn.id);
  const runtimeClosed = runtime.buildingById.get(closed.id);
  assert.deepEqual(runtimeInn.prefab, {
    id: inn.prefabId,
    access: 'enterable',
    behaviorId: inn.behaviorId,
    animationSetId: 'animation.building.cutaway.fade',
    cutawayDurationMs: 460,
    cutawayEasing: 'ease-in-out-cubic',
    collision: {
      exterior: 'solid-footprint', entrance: 'door', interior: 'walkable'
    },
    eventIds: inn.eventIds,
    soundSetId: inn.soundSetId,
    labelMode: 'proximity',
    speakerRole: 'keeper.inn',
    interactionVerb: 'talk-innkeeper'
  });
  assert.deepEqual(runtimeClosed.prefab.collision, {
    exterior: 'solid-footprint', entrance: 'blocked', interior: 'none'
  });
  assert.equal(Object.isFrozen(runtimeInn.prefab.collision), true);
  assert.equal(Object.isFrozen(runtimeInn.prefab.eventIds), true);

  const innSpeaker = residentConversationTarget(runtime, runtimeInn, factsById.get(inn.interaction.factRefs[0]));
  assert.equal(innSpeaker.actor.id, inn.rooms[0].npcId);
  assert.equal(innSpeaker.actor.role, 'keeper.inn');
  assert.equal(innSpeaker.actor.home, inn.id);

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

  const unknownPrefab = structuredClone(playable);
  unknownPrefab.buildings.find(({ id }) => id === inn.id).prefabId = 'prefab.invented';
  assert.match(validateRuntimeWorldPlan(unknownPrefab).issues.join('\n'), /unknown prefabId/);
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
