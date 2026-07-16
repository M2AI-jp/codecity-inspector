import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WORLD_GENERATOR_VERSION,
  WORLD_PLAN_BUILDING_CLASSES,
  WORLD_PLAN_FACINGS,
  WORLD_PLAN_GENERATION_MODES,
  WORLD_PLAN_LIGHT_KINDS,
  WORLD_PLAN_NAV_EDGE_KINDS,
  WORLD_PLAN_NAV_SPACES,
  WORLD_PLAN_ROOM_STATES,
  WORLD_PLAN_STREET_KINDS,
  WORLD_PLAN_TOP_LEVEL_FIELDS,
  WORLD_PLAN_VERSION,
  validateWorldPlanShape
} from '../../src/town/world-plan-schema.mjs';

const DIGEST = 'a'.repeat(64);

function terrainCell(overrides = {}) {
  return {
    assetId: 'terrain.grass',
    variant: 'blob-mask-15-a',
    elevation: 0,
    walkable: true,
    ...overrides
  };
}

function validPlan() {
  return {
    schemaVersion: 2,
    seed: 'stable-world-seed',
    inspectionDigest: DIGEST,
    generatorVersion: '2.0.0',
    generation: { mode: 'primary', attempt: 0 },
    world: { widthTiles: 4, heightTiles: 3, tileSize: 64 },
    terrain: Array.from({ length: 12 }, () => terrainCell()),
    districts: [{
      id: 'district.root',
      dir: '',
      biome: 'old-town',
      bounds: { x: 0, y: 0, w: 4, h: 3 },
      landmarkId: 'building.survey'
    }],
    streets: [{
      id: 'street.civic',
      tiles: [[0, 2], [1, 2]],
      width: 3,
      edges: [],
      kind: 'civic-avenue'
    }],
    buildings: [{
      id: 'building.survey',
      assetId: 'building.survey_tower',
      files: ['src/main.js'],
      class: 'tower',
      facilityKind: 'town_hall',
      footprint: { x: 1, y: 1, w: 1, h: 1 },
      entrance: { x: 1, y: 2, dir: 'south' },
      rooms: [{
        file: 'src/main.js',
        state: 'lit',
        npcId: 'npc.clerk',
        props: ['prop.ledger'],
        floorNavNodeIds: ['nav.room']
      }],
      overlays: ['overlay.ivy_m'],
      interaction: {
        anchor: { x: 1, y: 2 },
        verb: 'inspect-ledger',
        factRefs: ['fact.entrypoint']
      }
    }],
    npcs: [{
      id: 'npc.clerk',
      assetId: 'character.town_clerk',
      role: 'clerk',
      home: 'building.survey',
      patrol: [[1, 2]],
      factRefs: ['fact.entrypoint']
    }],
    props: [{
      id: 'prop.ledger',
      assetId: 'prop.desk_ledger',
      kind: 'ledger',
      x: 1,
      y: 1,
      factRef: 'fact.entrypoint'
    }],
    lights: [{
      x: 1,
      y: 1,
      assetId: 'effect.window_glow',
      kind: 'window',
      roomRef: 'src/main.js',
      on: true
    }],
    facts: [{
      id: 'fact.entrypoint',
      type: 'entrypoint',
      params: { path: 'src/main.js' },
      evidence: { observed: ['src/main.js'], inferred: [], unknown: [] },
      sayings: { primary: 'entrypoint.primary', reflect: [] }
    }],
    nav: {
      nodes: [
        { id: 'nav.start', x: 0, y: 2, elevation: 0, space: 'outdoor' },
        { id: 'nav.room', x: 1, y: 1, elevation: 0, space: 'interior' }
      ],
      edges: [{ id: 'nav.door', from: 'nav.start', to: 'nav.room', kind: 'door' }]
    },
    playerStart: { x: 0, y: 2, facing: 'east', navNodeId: 'nav.start' },
    validation: { ok: true, issues: [] }
  };
}

function clonePlan() {
  return structuredClone(validPlan());
}

function messages(verdict) {
  return verdict.issues.map(({ message }) => message).join('\n');
}

function expectStructureFailure(mutator, pattern) {
  const plan = clonePlan();
  mutator(plan);
  const verdict = validateWorldPlanShape(plan);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.length > 0);
  assert.ok(verdict.issues.every(({ code, severity }) => code === 'STRUCTURE' && severity === 'error'));
  if (pattern) assert.match(messages(verdict), pattern);
  return verdict;
}

test('WorldPlan v2 exports the fixed contract vocabulary as frozen values', () => {
  assert.equal(WORLD_PLAN_VERSION, 2);
  assert.equal(WORLD_GENERATOR_VERSION, '2.0.0');
  assert.deepEqual(WORLD_PLAN_TOP_LEVEL_FIELDS, [
    'schemaVersion', 'seed', 'inspectionDigest', 'generatorVersion',
    'generation', 'world', 'terrain', 'districts', 'streets', 'buildings',
    'npcs', 'props', 'lights', 'facts', 'nav', 'playerStart', 'validation'
  ]);
  assert.deepEqual(WORLD_PLAN_GENERATION_MODES, ['primary', 'retry', 'flat-fallback']);
  assert.deepEqual(WORLD_PLAN_STREET_KINDS, ['avenue', 'street', 'lane', 'seaway', 'civic-avenue']);
  assert.deepEqual(WORLD_PLAN_BUILDING_CLASSES, ['S', 'M', 'L', 'XL', 'rowhouse_s', 'rowhouse_l', 'tower']);
  assert.deepEqual(WORLD_PLAN_ROOM_STATES, ['lit', 'dark', 'ivy', 'warning', 'scaffold']);
  assert.deepEqual(WORLD_PLAN_FACINGS, ['north', 'east', 'south', 'west']);
  assert.deepEqual(WORLD_PLAN_NAV_SPACES, ['outdoor', 'interior']);
  assert.deepEqual(WORLD_PLAN_NAV_EDGE_KINDS, ['walk', 'bridge', 'stairs', 'door']);
  assert.deepEqual(WORLD_PLAN_LIGHT_KINDS, ['window', 'lantern', 'hearth']);
  for (const value of [
    WORLD_PLAN_TOP_LEVEL_FIELDS, WORLD_PLAN_GENERATION_MODES, WORLD_PLAN_STREET_KINDS,
    WORLD_PLAN_BUILDING_CLASSES, WORLD_PLAN_ROOM_STATES, WORLD_PLAN_FACINGS,
    WORLD_PLAN_NAV_SPACES, WORLD_PLAN_NAV_EDGE_KINDS, WORLD_PLAN_LIGHT_KINDS
  ]) assert.ok(Object.isFrozen(value));
});

test('the complete minimal WorldPlan fixture passes the shape contract', () => {
  assert.deepEqual(validateWorldPlanShape(validPlan()), { ok: true, issues: [] });
});

test('top-level fields are exact and all required', () => {
  for (const field of WORLD_PLAN_TOP_LEVEL_FIELDS) {
    expectStructureFailure((plan) => { delete plan[field]; }, new RegExp(`worldPlan\\.${field}`));
  }
  expectStructureFailure((plan) => { plan.legacyLayout = {}; }, /worldPlan\.legacyLayout is not allowed/);
});

test('version, generation, world dimensions, tile size, and digest are fixed', () => {
  expectStructureFailure((plan) => { plan.schemaVersion = 1; }, /schemaVersion/);
  expectStructureFailure((plan) => { plan.generatorVersion = '2.0.1'; }, /generatorVersion/);
  expectStructureFailure((plan) => { plan.inspectionDigest = 'not-a-digest'; }, /inspectionDigest/);
  expectStructureFailure((plan) => { plan.generation.mode = 'lucky'; }, /generation\.mode/);
  expectStructureFailure((plan) => { plan.generation.attempt = 4; }, /generation\.attempt/);
  expectStructureFailure((plan) => { plan.world.widthTiles = 0; }, /world\.widthTiles/);
  expectStructureFailure((plan) => { plan.world.heightTiles = -1; }, /world\.heightTiles/);
  expectStructureFailure((plan) => { plan.world.tileSize = 32; }, /world\.tileSize/);
  expectStructureFailure((plan) => { plan.generation.extra = true; }, /generation\.extra is not allowed/);
});

test('terrain is one exact flat row-major cell array', () => {
  expectStructureFailure((plan) => { plan.terrain.pop(); }, /terrain must contain exactly 12/);
  expectStructureFailure((plan) => { plan.terrain[0].assetId = ''; }, /terrain\[0\]\.assetId/);
  expectStructureFailure((plan) => { plan.terrain[0].variant = ''; }, /terrain\[0\]\.variant/);
  expectStructureFailure((plan) => { plan.terrain[0].elevation = -1; }, /terrain\[0\]\.elevation/);
  expectStructureFailure((plan) => { plan.terrain[0].walkable = 1; }, /terrain\[0\]\.walkable/);
  expectStructureFailure((plan) => { plan.terrain[0].autotile = 15; }, /terrain\[0\]\.autotile is not allowed/);
});

test('only civic avenues may omit repository import-edge bindings', () => {
  const plan = clonePlan();
  plan.streets[0].kind = 'street';
  plan.streets[0].edges = ['src/main.js→src/service.js'];
  assert.equal(validateWorldPlanShape(plan).ok, true);

  expectStructureFailure((candidate) => {
    candidate.streets[0].kind = 'street';
    candidate.streets[0].edges = [];
  }, /may be empty only for a civic-avenue/);
  expectStructureFailure((candidate) => { candidate.streets[0].kind = 'boulevard'; }, /streets\[0\]\.kind/);
  expectStructureFailure((candidate) => { candidate.streets[0].width = 4; }, /streets\[0\]\.width/);
});

test('rendered entities require explicit nonempty asset IDs, including the survey tower', () => {
  expectStructureFailure((plan) => { plan.buildings[0].assetId = ''; }, /buildings\[0\]\.assetId/);
  expectStructureFailure((plan) => { plan.npcs[0].assetId = ''; }, /npcs\[0\]\.assetId/);
  expectStructureFailure((plan) => { plan.props[0].assetId = ''; }, /props\[0\]\.assetId/);
  expectStructureFailure((plan) => { plan.lights[0].assetId = ''; }, /lights\[0\]\.assetId/);
});

test('building cutaway shape includes interaction anchors and room floor-nav bindings', () => {
  expectStructureFailure((plan) => { delete plan.buildings[0].interaction; }, /buildings\[0\]\.interaction/);
  expectStructureFailure((plan) => { plan.buildings[0].interaction.anchor.x = 9; }, /interaction\.anchor must be inside world bounds/);
  expectStructureFailure((plan) => { plan.buildings[0].rooms[0].floorNavNodeIds = []; }, /floorNavNodeIds must not be empty/);
  expectStructureFailure((plan) => { plan.buildings[0].rooms[0].file = 'src/other.js'; }, /must also appear in the building files list/);
  expectStructureFailure((plan) => { plan.buildings[0].rooms[0].state = 'broken'; }, /rooms\[0\]\.state/);
});

test('fact payloads remain extensible while evidence uses exactly three arrays', () => {
  const plan = clonePlan();
  plan.facts[0] = {
    id: 'fact.entrypoint',
    evidence: { observed: [{ path: 'src/main.js' }], inferred: [], unknown: [] },
    workerOwnedPayload: { futureShape: true }
  };
  assert.equal(validateWorldPlanShape(plan).ok, true);

  expectStructureFailure((candidate) => { delete candidate.facts[0].evidence.unknown; }, /evidence\.unknown is required/);
  expectStructureFailure((candidate) => { candidate.facts[0].evidence.status = []; }, /evidence\.status is not allowed/);
  expectStructureFailure((candidate) => { candidate.facts[0].evidence.observed = 'src/main.js'; }, /evidence\.observed must be an array/);
});

test('duplicate entity and graph IDs are rejected within every namespace', () => {
  const cases = [
    [(plan) => plan.districts.push(structuredClone(plan.districts[0])), /districts\[1\]\.id duplicates/],
    [(plan) => plan.streets.push(structuredClone(plan.streets[0])), /streets\[1\]\.id duplicates/],
    [(plan) => plan.buildings.push(structuredClone(plan.buildings[0])), /buildings\[1\]\.id duplicates/],
    [(plan) => plan.npcs.push(structuredClone(plan.npcs[0])), /npcs\[1\]\.id duplicates/],
    [(plan) => plan.props.push(structuredClone(plan.props[0])), /props\[1\]\.id duplicates/],
    [(plan) => plan.facts.push(structuredClone(plan.facts[0])), /facts\[1\]\.id duplicates/],
    [(plan) => plan.nav.nodes.push(structuredClone(plan.nav.nodes[0])), /nav\.nodes\[2\]\.id duplicates/],
    [(plan) => plan.nav.edges.push(structuredClone(plan.nav.edges[0])), /nav\.edges\[1\]\.id duplicates/]
  ];
  for (const [mutator, pattern] of cases) expectStructureFailure(mutator, pattern);
});

test('missing references are rejected across landmarks, rooms, interactions, inhabitants, lights, nav, and spawn', () => {
  const cases = [
    [(plan) => { plan.districts[0].landmarkId = 'missing.landmark'; }, /missing landmark/],
    [(plan) => { plan.buildings[0].rooms[0].npcId = 'missing.npc'; }, /missing npc/],
    [(plan) => { plan.buildings[0].rooms[0].props = ['missing.prop']; }, /missing prop/],
    [(plan) => { plan.buildings[0].rooms[0].floorNavNodeIds = ['missing.node']; }, /missing nav node/],
    [(plan) => { plan.buildings[0].interaction.factRefs = ['missing.fact']; }, /missing fact/],
    [(plan) => { plan.npcs[0].home = 'missing.building'; }, /missing building/],
    [(plan) => { plan.npcs[0].factRefs = ['missing.fact']; }, /missing fact/],
    [(plan) => { plan.props[0].factRef = 'missing.fact'; }, /missing fact/],
    [(plan) => { plan.lights[0].roomRef = 'missing.room'; }, /missing room/],
    [(plan) => { plan.nav.edges[0].from = 'missing.node'; }, /missing nav node/],
    [(plan) => { plan.nav.edges[0].to = 'missing.node'; }, /missing nav node/],
    [(plan) => { plan.playerStart.navNodeId = 'missing.node'; }, /missing nav node/]
  ];
  for (const [mutator, pattern] of cases) expectStructureFailure(mutator, pattern);
});

test('all spatial records reject out-of-bounds coordinates and rectangles', () => {
  const cases = [
    [(plan) => { plan.districts[0].bounds.w = 5; }, /districts\[0\]\.bounds must fit/],
    [(plan) => { plan.streets[0].tiles[0] = [4, 0]; }, /streets\[0\]\.tiles\[0\] must be inside/],
    [(plan) => { plan.buildings[0].footprint.x = 4; }, /buildings\[0\]\.footprint must fit/],
    [(plan) => { plan.buildings[0].entrance.y = 3; }, /buildings\[0\]\.entrance must be inside/],
    [(plan) => { plan.npcs[0].patrol[0] = [-1, 0]; }, /npcs\[0\]\.patrol\[0\]\.x/],
    [(plan) => { plan.props[0].x = 4; }, /props\[0\] must be inside/],
    [(plan) => { plan.lights[0].y = 3; }, /lights\[0\] must be inside/],
    [(plan) => { plan.nav.nodes[0].x = 4; }, /nav\.nodes\[0\] must be inside/],
    [(plan) => { plan.playerStart.y = 3; }, /playerStart must be inside/]
  ];
  for (const [mutator, pattern] of cases) expectStructureFailure(mutator, pattern);
});

test('player start and nav graph use the exact v2 fields and enums', () => {
  expectStructureFailure((plan) => { plan.playerStart.facing = 'down'; }, /playerStart\.facing/);
  expectStructureFailure((plan) => { plan.nav.nodes[0].space = 'roof'; }, /nav\.nodes\[0\]\.space/);
  expectStructureFailure((plan) => { plan.nav.edges[0].kind = 'teleport'; }, /nav\.edges\[0\]\.kind/);
  expectStructureFailure((plan) => { plan.playerStart.z = 0; }, /playerStart\.z is not allowed/);
});

test('embedded validation has only ok and issues fields', () => {
  expectStructureFailure((plan) => { plan.validation.ok = 'yes'; }, /validation\.ok/);
  expectStructureFailure((plan) => { plan.validation.issues = null; }, /validation\.issues/);
  expectStructureFailure((plan) => { plan.validation.passed = true; }, /validation\.passed is not allowed/);
});

test('malformed, cyclic, inaccessible, and proxy inputs are crash-free failures', () => {
  const inaccessible = {};
  Object.defineProperty(inaccessible, 'schemaVersion', {
    enumerable: true,
    get() { throw new Error('must not escape'); }
  });
  const cyclic = validPlan();
  cyclic.validation.issues.push(cyclic);
  const { proxy, revoke } = Proxy.revocable([], {});
  revoke();
  for (const input of [
    null, undefined, true, 1, 'plan', [], {}, Object.create(null), inaccessible, cyclic, proxy
  ]) {
    let verdict;
    assert.doesNotThrow(() => { verdict = validateWorldPlanShape(input); });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.issues.length > 0);
    assert.ok(verdict.issues.every(({ code }) => code === 'STRUCTURE'));
  }
});

test('validation is deterministic, sorted, deeply frozen, and does not mutate input', () => {
  const plan = clonePlan();
  plan.extra = true;
  plan.world.tileSize = 32;
  plan.playerStart.facing = 'down';
  const before = JSON.stringify(plan);
  const first = validateWorldPlanShape(plan);
  const second = validateWorldPlanShape(plan);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(plan), before);
  const sorted = first.issues.slice().sort((left, right) => {
    const leftKey = `${left.code}\u0000${left.message}\u0000${left.severity}`;
    const rightKey = `${right.code}\u0000${right.message}\u0000${right.severity}`;
    return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
  });
  assert.deepEqual(first.issues, sorted);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.issues));
  assert.ok(first.issues.every(Object.isFrozen));
  assert.throws(() => first.issues.push({}), TypeError);
});

test('WorldPlan shape implementation has no I/O, clock, random, or locale-dependent sorting', async () => {
  const source = await readFile(new URL('../../src/town/world-plan-schema.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:(?:fs|http|https|net|child_process)/);
  assert.doesNotMatch(source, /Math\.random|Date\.now|new Date\s*\(|localeCompare/);
});
