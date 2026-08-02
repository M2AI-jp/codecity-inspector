import assert from 'node:assert/strict';
import test from 'node:test';

import { generateWorldPlan, validateWorldPlan, WORLD_PLAN_PUBLIC_VOCABULARY } from '../../../ship/40-worldgen/index.mjs';

const FACILITY_KINDS = [
  'inn', 'pub', 'guild', 'town_hall', 'dock', 'warehouse', 'well', 'workshop',
  'dojo', 'watchtower', 'house', 'shop', 'ruin', 'gate',
];
const PRIORITY = ['entrypoint', 'persistence', 'configuration', 'test', 'observability', 'recovery'];

function evidence() {
  return { observed: ['repository.inspection.completed'], inferred: [], unknown: ['repository.inspection.runtime.unknown'] };
}

function town({ identity = 'fixture-identity', name = 'Fixture Town', level = 1 } = {}) {
  return {
    schemaVersion: 1,
    repository: { name, identity },
    inspectionDigest: 'a'.repeat(64),
    facilities: FACILITY_KINDS.map((kind, index) => ({
      kind,
      label: kind,
      role: kind === 'shop' ? 'repair' : 'role',
      variant: kind === 'shop' ? 'repair' : null,
      presence: index === 0 ? 'not-applicable' : 'present',
      condition: 'active',
      blocksProgress: false,
      sourceFileIds: [],
      evidence: evidence(),
    })),
    facts: Array.from({ length: 9 }, (_, index) => ({
      id: `fact-${index}`,
      kind: 'capability',
      subject: `subject-${index}`,
      state: 'unknown',
      evidence: evidence(),
    })),
    habitability: {
      level,
      label: 'habitable',
      knownCapabilities: [],
      unknownCapabilities: [],
      evidence: evidence(),
    },
    guild: {
      tabs: Array.from({ length: 5 }, (_, index) => ({ id: `tab-${index}`, label: `tab-${index}`, entries: [], evidence: evidence() })),
      representativeConnections: [],
      connections: [],
    },
    investigations: {
      priority: PRIORITY,
      candidates: [
        { id: 'investigation.configuration', capability: 'configuration', facilityKind: 'well', role: 'configuration', variant: null, subject: '井戸の水', statement: '井戸から水が使える', state: 'unknown', evidence: evidence() },
        { id: 'investigation.recovery', capability: 'recovery', facilityKind: 'shop', role: 'repair', variant: 'repair', subject: '修理小屋の道具', statement: '修理小屋に戻すための道具がある', state: 'unknown', evidence: evidence() },
        { id: 'investigation.test', capability: 'test', facilityKind: 'dojo', role: 'verification', variant: null, subject: '道場の検査', statement: '道場に検査済みの印がある', state: 'unknown', evidence: evidence() },
      ],
    },
    rewards: {
      bindings: [{ id: 'repository_inspected', event: 'repository_inspected', transition: 'repository_inspected', facilityKind: 'town_hall', effect: 'town_hall_lantern_lit' }],
      transitions: [{
        id: 'transition.repository_inspected',
        event: 'repository_inspected',
        bindingId: 'repository_inspected',
        facilityKind: 'town_hall',
        effect: 'town_hall_lantern_lit',
        state: 'observed',
        evidence: { observed: ['repository.inspection.completed'], inferred: [], unknown: [] },
      }],
    },
    evidence: evidence(),
  };
}

function l1(plan) {
  return JSON.stringify({
    townType: plan.townType,
    climate: plan.climate,
    terrain: plan.terrain,
    water: plan.water,
    roads: plan.roads,
    topology: plan.topology,
    plotIds: plan.plotIds,
    regions: plan.regions,
    plots: plan.plots,
  });
}

test('generates and validates a complete logical world plan', () => {
  const plan = generateWorldPlan({ town: town() });
  assert.ok(plan.plots.length >= 12 && plan.plots.length <= 20);
  assert.equal(plan.regions.length, 5);
  assert.equal(plan.roads.filter((road) => road.kind === 'main').length, 1);
  assert.ok(plan.roads.filter((road) => road.kind === 'branch').length >= 3);
  assert.ok(plan.roads.filter((road) => road.kind === 'dead-end').length >= 1);
  assert.equal(plan.occupancy.filter((entry) => entry.state === 'occupied').length, 13);
  assert.equal(validateWorldPlan(plan, { town: town() }).schemaVersion, 1);
});

test('identity fixes L1 while changed TownModel contents alter only L2', () => {
  const first = town({ level: 1 });
  const second = town({ level: 3 });
  second.facts[0].state = 'inferred';
  const a = generateWorldPlan({ town: first });
  const b = generateWorldPlan({ town: second });
  assert.equal(l1(a), l1(b));
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
});

test('validator rejects disconnected navigation and unknown TownModel fields', () => {
  const source = town();
  Object.assign(source.facilities.find(({ kind }) => kind === 'shop'), { presence: 'unknown', condition: 'unconfirmed' });
  const plan = generateWorldPlan({ town: source });
  const broken = structuredClone(plan);
  broken.nav.edges = broken.nav.edges.slice(1);
  assert.throws(() => validateWorldPlan(broken), /navigation|reachable|disconnected/i);
  assert.throws(() => generateWorldPlan({ town: { ...source, unexpected: true } }), /TownModel|unknown/i);
});

test('every generated plot stays in bounds and no two plots overlap', () => {
  for (let index = 0; index < 100; index += 1) {
    const source = town({ name: `fixture-${index}`, identity: `fixture-${index}` });
    const plan = generateWorldPlan({ town: source });
    for (const plot of plan.plots) {
      assert.ok(plot.cell.x >= 0 && plot.cell.y >= 0);
      assert.ok(plot.cell.x + plot.cell.width <= plan.grid.columns);
      assert.ok(plot.cell.y + plot.cell.height <= plan.grid.rows);
    }
    for (let leftIndex = 0; leftIndex < plan.plots.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < plan.plots.length; rightIndex += 1) {
        const left = plan.plots[leftIndex].cell;
        const right = plan.plots[rightIndex].cell;
        const overlaps = left.x < right.x + right.width && left.x + left.width > right.x
          && left.y < right.y + right.height && left.y + left.height > right.y;
        assert.equal(overlaps, false, `${plan.identity.key}: ${plan.plots[leftIndex].id}/${plan.plots[rightIndex].id}`);
      }
    }
  }
});

test('validator rejects a serialized plan with overlapping plots', () => {
  const plan = structuredClone(generateWorldPlan({ town: town() }));
  plan.plots[1].cell = { ...plan.plots[0].cell };
  plan.l1.plots = structuredClone(plan.plots);
  assert.throws(() => validateWorldPlan(plan), (error) => error?.issues?.some(({ code }) => code === 'PLOT_OVERLAP'));
});

test('investigations are placed at the corresponding facility or its planned region', () => {
  const source = town();
  const plan = generateWorldPlan({ town: source });
  const candidateById = new Map(plan.townState.investigations.candidates.map((candidate) => [candidate.id, candidate]));
  for (const site of plan.questSites) {
    const candidate = candidateById.get(site.candidateId);
    const occupied = plan.occupancy.find((entry) => entry.occupants.some((occupant) => occupant.kind === candidate.facilityKind));
    if (occupied) assert.equal(site.plotId, occupied.plotId);
    else assert.equal(plan.nav.regionByPlot[site.plotId], 'work');
  }
  const tampered = structuredClone(plan);
  tampered.questSites[0].plotId = tampered.regions.find((region) => region.id === 'past').plotIds[0];
  tampered.l2.questSites = structuredClone(tampered.questSites);
  assert.throws(() => validateWorldPlan(tampered), (error) => error.issues.some(({ code }) => code === 'QUEST_FACILITY_MISMATCH'));
});

// T3 obligation: prevent an arbitrary 30->40 value from becoming an art/NPC
// selector and prevent duplicate quest sites. It evidences the owner's finite
// v1 grammar and repository-safety requirement. Passing does not prove art
// approval, scene compilation, browser movement, or the KGI journey.
test('T3 emits deterministic bytes, finite selectors, three distinct sites, and an unlit baseline lantern', () => {
  for (const invalidTransitions of [[], [
    ...town().rewards.transitions,
    ...town().rewards.transitions,
  ]]) {
    const invalid = town();
    invalid.rewards.transitions = invalidTransitions;
    assert.throws(
      () => generateWorldPlan({ town: invalid }),
      (error) => error?.issues?.some(({ code }) => code === 'INVALID_REWARD_TRANSITION_COUNT'),
    );
  }

  const arbitrary = town();
  arbitrary.guild.representativeConnections = [{
    id: 'customer-controlled-representative',
    kind: 'customer-controlled-arbitrary',
    name: 'customer-controlled-arbitrary',
    evidence: evidence(),
  }];
  assert.throws(
    () => generateWorldPlan({ town: arbitrary }),
    (error) => error?.issues?.some(({ code }) => code === 'INVALID_NPC_ROLE'),
  );

  const validUnknown = town();
  validUnknown.guild.representativeConnections = [{
    id: 'unknown-representative',
    kind: 'unknown',
    name: 'unknown',
    evidence: evidence(),
  }];
  const first = generateWorldPlan({ town: validUnknown });
  const second = generateWorldPlan({ town: validUnknown });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.questSites.length, 3);
  assert.equal(new Set(first.questSites.map((site) => site.candidateId)).size, 3);
  assert.equal(new Set(first.questSites.map((site) => site.plotId)).size, 3);
  assert.ok(first.npcs.some(({ role }) => role === 'unknown'));
  assert.ok(first.npcs.every((npc) => WORLD_PLAN_PUBLIC_VOCABULARY.npcRoles.includes(npc.role)));
  assert.ok(first.props.every((prop) => WORLD_PLAN_PUBLIC_VOCABULARY.propKinds.includes(prop.kind)));
  assert.ok(first.lights.every((light) => WORLD_PLAN_PUBLIC_VOCABULARY.lightStates.includes(light.state)));
  assert.ok(first.rooms.every((room) => WORLD_PLAN_PUBLIC_VOCABULARY.roomKinds.includes(room.kind)));
  assert.deepEqual(first.rewardBindings, [{
    id: 'repository_inspected',
    event: 'repository_inspected',
    transition: 'repository_inspected',
    facilityKind: 'town_hall',
    effect: 'town_hall_lantern_lit',
  }]);
  for (const invalidCount of [0, 2]) {
    const tampered = structuredClone(first);
    tampered.townState.rewards.transitions = invalidCount === 0
      ? []
      : [first.townState.rewards.transitions[0], first.townState.rewards.transitions[0]];
    tampered.l2.townState = structuredClone(tampered.townState);
    assert.throws(
      () => validateWorldPlan(tampered),
      (error) => error?.issues?.some(({ code }) => code === 'INVALID_REWARD_TRANSITION_COUNT'),
    );
  }
  assert.equal(first.lights.find((light) => light.id === 'light-town-hall-lantern').state, 'unlit');
});
