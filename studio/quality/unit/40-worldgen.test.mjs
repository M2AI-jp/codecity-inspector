import assert from 'node:assert/strict';
import test from 'node:test';

import { generateWorldPlan, validateWorldPlan } from '../../../ship/40-worldgen/index.mjs';

const FACILITY_KINDS = [
  'inn', 'pub', 'guild', 'town_hall', 'dock', 'warehouse', 'well', 'workshop',
  'dojo', 'watchtower', 'house', 'shop', 'ruin', 'gate',
];
const PRIORITY = ['entrypoint', 'persistence', 'configuration', 'test', 'observability', 'recovery'];

function evidence() {
  return { observed: [], inferred: [], unknown: [] };
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
      condition: 'ready',
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
    investigations: { priority: PRIORITY, candidates: [] },
    rewards: {
      bindings: Array.from({ length: 9 }, (_, index) => ({ id: `reward-${index}`, kind: 'reward' })),
      transitions: [],
    },
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
  source.investigations.candidates = [
    { id: 'investigation.configuration', capability: 'configuration', facilityKind: 'well', role: 'configuration', variant: null, subject: '井戸の水', statement: '井戸から水が使える', state: 'unknown', evidence: evidence() },
    { id: 'investigation.recovery', capability: 'recovery', facilityKind: 'shop', role: 'repair', variant: 'repair', subject: '修理小屋の道具', statement: '修理小屋に戻すための道具がある', state: 'unknown', evidence: evidence() },
  ];
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
