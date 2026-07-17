import assert from 'node:assert/strict';
import test from 'node:test';
import { FACILITY_KINDS } from '../../src/town/schema.mjs';
import {
  generateWorldPlan,
  worldPlanLodForFileCount
} from '../../src/town/world-plan-generator.mjs';
import { WAVE_A_ASSET_IDS } from '../../public/fable5-v2/site-runtime.mjs';
import { validateWorldPlanShape } from '../../src/town/world-plan-schema.mjs';
import { validateWorldPlan } from '../../src/town/world-plan-validator.mjs';

function building(path, overrides = {}) {
  return {
    path,
    dir: path.includes('/') ? path.split('/')[0] : '',
    bytes: 1_024,
    kind: 'module',
    isTest: false,
    state: 'mapped',
    evidence: {
      unresolvedLinks: 0,
      cycle: false,
      associatedTest: false,
      reachability: 'reached-from-known-entrypoints'
    },
    ...overrides
  };
}

function inspectionFixture() {
  const buildings = [
    building('src/main.js', { bytes: 4_096 }),
    building('src/inn.js', { kind: 'service', evidence: {
      unresolvedLinks: 1,
      cycle: false,
      associatedTest: true,
      reachability: 'reached-from-known-entrypoints'
    } }),
    building('src/cycle.js', { evidence: {
      unresolvedLinks: 0,
      cycle: true,
      associatedTest: false,
      reachability: 'not-reached-from-known-entrypoints'
    } }),
    building('test/inn.test.js', { isTest: true })
  ];
  const edges = [
    { from: 'src/main.js', to: 'src/inn.js', kind: 'import', status: 'resolved' },
    { from: 'src/inn.js', targetHint: './missing.js', kind: 'import', status: 'unresolved' }
  ];
  return {
    schemaVersion: 2,
    repository: { name: 'fixture-town' },
    summary: { truncated: false },
    city: { buildings },
    graph: {
      nodes: buildings.map(({ path }) => ({ path })),
      edges,
      entrypoints: [{ path: 'src/main.js', evidence: 'package.main' }]
    },
    inspection: {
      observed: { unresolvedLinks: [edges[1]] },
      inferred: {
        cycles: [{ members: ['src/cycle.js', 'src/inn.js'] }],
        testAssociations: [{ source: 'src/inn.js', test: 'test/inn.test.js', evidence: 'name-match' }]
      },
      unknownDependencies: []
    }
  };
}

function modelFixture({ gate = true } = {}) {
  return {
    facilities: FACILITY_KINDS.map((kind) => ({
      kind,
      present: kind === 'town_hall' || (kind === 'gate' && gate) || kind === 'dojo' || kind === 'inn' || kind === 'house',
      count: 1,
      evidence: { observed: ['fixture'], inferred: [], unknown: [] }
    }))
  };
}

function terrainAt(plan, x, y) {
  return plan.terrain[y * plan.world.widthTiles + x];
}

function worldPlanAssetIds(plan) {
  return [
    ...plan.terrain.map(({ assetId }) => assetId),
    ...plan.buildings.flatMap(({ assetId, overlays }) => [assetId, ...overlays]),
    ...plan.npcs.map(({ assetId }) => assetId),
    ...plan.props.map(({ assetId }) => assetId),
    ...plan.lights.map(({ assetId }) => assetId)
  ];
}

test('uses the fixed L0/L1/L2 aggregation ladder', () => {
  assert.equal(worldPlanLodForFileCount(0), 'L0');
  assert.equal(worldPlanLodForFileCount(120), 'L0');
  assert.equal(worldPlanLodForFileCount(121), 'L1');
  assert.equal(worldPlanLodForFileCount(600), 'L1');
  assert.equal(worldPlanLodForFileCount(601), 'L2');
  assert.equal(worldPlanLodForFileCount(2_500), 'L2');
});

test('generates a deterministic, shape-valid and semantically valid playable plan', () => {
  const inspection = inspectionFixture();
  const model = modelFixture();
  const first = generateWorldPlan({ inspection, model });
  const second = generateWorldPlan({ inspection, model });

  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(validateWorldPlanShape(first), { ok: true, issues: [] });
  assert.deepEqual(validateWorldPlan(first, { inspection }), { ok: true, issues: [] });
  assert.deepEqual(first.lights, []);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.generatorVersion, '2.2.0');
  assert.equal(first.world.tileSize, 64);
  assert.equal(first.terrain.length, first.world.widthTiles * first.world.heightTiles);
  assert.deepEqual(new Set(first.districts.map(({ biome }) => biome)), new Set([
    'old-town', 'harbor'
  ]));
  assert.ok(first.districts.every(({ dir }) => !dir.startsWith('@environment/')));
  assert.ok(first.buildings.some(({ id }) => id === 'building.survey_tower'));

  const representedFiles = first.buildings.flatMap(({ files }) => files).sort();
  assert.deepEqual(representedFiles, inspection.city.buildings.map(({ path }) => path).sort());
  const importBindings = first.streets.flatMap(({ edges }) => edges).sort();
  assert.deepEqual(importBindings, [
    'src/inn.js→./missing.js',
    'src/main.js→src/inn.js'
  ]);
  assert.deepEqual(first.streets.flatMap(({ edgeBindings }) => edgeBindings), [
    {
      from: 'src/inn.js', to: null, targetHint: './missing.js',
      kind: 'import', status: 'unresolved'
    },
    {
      from: 'src/main.js', to: 'src/inn.js', targetHint: null,
      kind: 'import', status: 'resolved'
    }
  ]);
  const walkable = first.terrain.flatMap((cell, index) => cell.walkable
    ? [`${index % first.world.widthTiles},${Math.floor(index / first.world.widthTiles)}`]
    : []);
  const outdoor = first.nav.nodes.filter(({ space }) => space === 'outdoor')
    .map(({ x, y }) => `${x},${y}`).sort();
  assert.deepEqual(outdoor, walkable.sort());
  assert.ok(first.nav.nodes.filter(({ space }) => space === 'outdoor')
    .every((node) => node.elevation === terrainAt(first, node.x, node.y).elevation));
  const edgeById = new Map(first.nav.edges.map((edge) => [edge.id, edge]));
  const nodeById = new Map(first.nav.nodes.map((node) => [node.id, node]));
  const transitionProps = first.props.filter(({ kind }) => kind === 'bridge' || kind === 'stairs');
  const transitionEdges = first.nav.edges.filter(({ kind }) => kind === 'bridge' || kind === 'stairs');
  assert.equal(transitionProps.length, transitionEdges.length);
  for (const prop of transitionProps) {
    const edge = edgeById.get(prop.navEdgeId);
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    assert.equal(edge.kind, prop.kind);
    assert.ok((prop.x === from.x && prop.y === from.y) || (prop.x === to.x && prop.y === to.y));
    assert.equal(prop.assetId, prop.kind === 'bridge' ? 'structure.bridge_stone' : 'structure.stairs_stone');
  }
});

test('packs a small town into staggered blocks with sprite-safe northern and southern clearance', () => {
  const plan = generateWorldPlan({ inspection: inspectionFixture(), model: modelFixture() });
  const baselines = plan.buildings.map(({ footprint }) => footprint.y + footprint.h);
  assert.ok(baselines.every((y) => y >= 6));
  assert.ok(baselines.every((y) => plan.world.heightTiles - y >= 2));
  for (const building of plan.buildings) {
    const district = plan.districts.find(({ bounds }) => (
      building.footprint.y >= bounds.y && building.footprint.y < bounds.y + bounds.h
    ));
    assert.ok(district, `building ${building.id} belongs to a district`);
    const baseline = building.footprint.y + building.footprint.h;
    assert.ok(district.bounds.y + district.bounds.h - baseline >= 2,
      `building ${building.id} keeps two tiles below its art anchor inside its district`);
  }

  const civic = plan.buildings.filter(({ footprint }) => footprint.y < plan.districts[0].bounds.y + plan.districts[0].bounds.h);
  assert.ok(new Set(civic.map(({ footprint }) => footprint.x)).size >= 3);
  assert.ok(new Set(civic.map(({ footprint }) => footprint.y)).size >= 2);
  const roadTiles = plan.streets.find(({ kind }) => kind === 'civic-avenue').tiles;
  const byX = new Map();
  const byY = new Map();
  for (const [x, y] of roadTiles) {
    byX.set(x, (byX.get(x) ?? 0) + 1);
    byY.set(y, (byY.get(y) ?? 0) + 1);
  }
  assert.ok([...byX.values()].filter((count) => count >= 4).length >= 2, 'connected north-south streets');
  assert.ok([...byY.values()].filter((count) => count >= 4).length >= 2, 'connected east-west streets');
});

test('emits only Wave A asset IDs, including the building replacement for config-like files', () => {
  const inspection = inspectionFixture();
  const well = building('src/well.js');
  inspection.city.buildings.push(well);
  inspection.graph.nodes.push({ path: well.path });
  const plan = generateWorldPlan({ inspection, model: modelFixture() });
  const allowed = new Set(WAVE_A_ASSET_IDS);

  assert.deepEqual([...new Set(worldPlanAssetIds(plan))].filter((assetId) => !allowed.has(assetId)), []);
  assert.equal(plan.buildings.find(({ files }) => files.includes('src/well.js')).assetId, 'building.workshop');
});

test('adds at most three biome-specific decor props per real district without blocking navigation or buildings', () => {
  const plan = generateWorldPlan({ inspection: inspectionFixture(), model: modelFixture() });
  const expectedAssets = {
    'old-town': new Set(['prop.streetlight', 'prop.bench', 'prop.signboard']),
    harbor: new Set(['prop.crate', 'prop.barrel', 'structure.ferry_shelter']),
    snow: new Set(['structure.stone_lantern', 'structure.rock.a', 'prop.warning_stake']),
    woodland: new Set(['structure.tree.a', 'structure.tree.b', 'overlay.flowers.a'])
  };
  const navCoords = new Set(plan.nav.nodes.filter(({ space }) => space === 'outdoor')
    .map(({ x, y }) => `${x},${y}`));
  const decor = plan.props.filter(({ kind }) => kind === 'district-decor');
  const coords = new Set();

  for (const district of plan.districts) {
    const within = decor.filter(({ x, y }) => x >= district.bounds.x && x < district.bounds.x + district.bounds.w
      && y >= district.bounds.y && y < district.bounds.y + district.bounds.h);
    assert.equal(within.length, 3);
    assert.ok(within.every(({ assetId }) => expectedAssets[district.biome].has(assetId)));
  }
  for (const prop of decor) {
    const key = `${prop.x},${prop.y}`;
    assert.equal(coords.has(key), false);
    coords.add(key);
    assert.equal(navCoords.has(key), false);
    assert.equal(plan.buildings.some(({ footprint }) => (
      prop.x >= footprint.x && prop.x < footprint.x + footprint.w
        && prop.y >= footprint.y && prop.y < footprint.y + footprint.h
    )), false);
  }
});

test('places every door, interior floor, and home actor on the playable building graph', () => {
  const inspection = inspectionFixture();
  const plan = generateWorldPlan({ inspection, model: modelFixture() });
  const nodeById = new Map(plan.nav.nodes.map((node) => [node.id, node]));
  const roomNpcIds = new Set(plan.buildings.flatMap(({ rooms }) => rooms.map(({ npcId }) => npcId)));

  for (const building of plan.buildings) {
    const interiors = plan.nav.nodes.filter((node) => (
      node.space === 'interior' && node.buildingId === building.id
    ));
    if (building.class === 'S') {
      assert.equal(interiors.length, 0);
      continue;
    }

    const doors = plan.nav.edges.filter((edge) => edge.kind === 'door'
      && [nodeById.get(edge.from), nodeById.get(edge.to)].some((node) => node?.buildingId === building.id));
    assert.equal(doors.length, 1);
    const outside = nodeById.get(doors[0].from).space === 'outdoor'
      ? nodeById.get(doors[0].from) : nodeById.get(doors[0].to);
    const inside = nodeById.get(doors[0].from).space === 'interior'
      ? nodeById.get(doors[0].from) : nodeById.get(doors[0].to);
    const inward = { north: [0, 1], east: [-1, 0], south: [0, -1], west: [1, 0] }[building.entrance.dir];
    assert.deepEqual([inside.x, inside.y], [outside.x + inward[0], outside.y + inward[1]]);
    assert.equal(inside.elevation, outside.elevation);
    assert.equal(new Set(interiors.map(({ x, y }) => `${x},${y}`)).size, interiors.length);
    assert.ok(interiors.every(({ elevation }) => elevation === outside.elevation));

    const roomFloorIds = building.rooms.flatMap(({ floorNavNodeIds }) => floorNavNodeIds).sort();
    if (building.rooms.length > 0) {
      assert.deepEqual(interiors.map(({ id }) => id).sort(), roomFloorIds);
      assert.ok(interiors.every((node) => Object.hasOwn(node, 'roomRef')));
    } else {
      assert.equal(interiors.length, 1);
      assert.equal(Object.hasOwn(interiors[0], 'roomRef'), false);
    }
  }

  for (const edge of plan.nav.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    assert.equal(Math.abs(from.x - to.x) + Math.abs(from.y - to.y), 1);
  }

  const buildingById = new Map(plan.buildings.map((building) => [building.id, building]));
  for (const npc of plan.npcs) {
    const home = buildingById.get(npc.home);
    const interiors = plan.nav.nodes.filter((node) => (
      node.space === 'interior' && node.buildingId === home.id
    ));
    const allowed = npc.role.startsWith('keeper.')
      ? new Set([`${home.entrance.x - 1},${home.entrance.y}`])
      : interiors.length > 0
      ? new Set(interiors.map(({ x, y }) => `${x},${y}`))
      : new Set([`${home.entrance.x},${home.entrance.y}`]);
    assert.ok(npc.patrol.every(([x, y]) => allowed.has(`${x},${y}`)));
    if (npc.role === 'resident') assert.ok(roomNpcIds.has(npc.id));
  }

  for (const npc of plan.npcs.filter(({ role }) => role === 'dojo-student')) {
    assert.ok(plan.nav.nodes.some((node) => node.space === 'interior'
      && node.buildingId === npc.home
      && npc.patrol.every(([x, y]) => x === node.x && y === node.y)));
  }

  for (const npc of plan.npcs.filter(({ role }) => role.startsWith('keeper.'))) {
    const home = buildingById.get(npc.home);
    const expected = [home.entrance.x - 1, home.entrance.y];
    assert.deepEqual(npc.patrol, [expected]);
    assert.ok(plan.nav.nodes.some((node) => node.space === 'outdoor'
      && node.x === expected[0] && node.y === expected[1]));
  }
  const gateKeeper = plan.npcs.find(({ role }) => role === 'keeper.gate');
  assert.notDeepEqual(gateKeeper.patrol[0], [plan.playerStart.x, plan.playerStart.y]);
});

test('keeps all snowcaps out of the WorldPlan while retaining snow-district rowhouses', () => {
  const configFiles = Array.from({ length: 121 }, (_, index) => (
    building(`config/leaf/file-${String(index).padStart(3, '0')}.js`, { kind: 'configuration' })
  ));
  const buildings = [
    building('src/main.js'),
    building('harbor/api.js', { kind: 'service' }),
    ...configFiles
  ];
  const inspection = {
    repository: { name: 'snow-rowhouse-town' },
    city: { buildings },
    graph: {
      nodes: buildings.map(({ path }) => ({ path })), edges: [],
      entrypoints: [{ path: 'src/main.js', evidence: 'fixture' }]
    },
    inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
  };
  const plan = generateWorldPlan({ inspection, model: modelFixture() });
  const snow = plan.districts.find(({ biome }) => biome === 'snow');
  const rowhouses = plan.buildings.filter(({ class: buildingClass, footprint }) => (
    buildingClass.startsWith('rowhouse_')
      && footprint.y >= snow.bounds.y && footprint.y < snow.bounds.y + snow.bounds.h
  ));

  assert.ok(rowhouses.length > 0);
  assert.ok(plan.buildings.every(({ overlays }) => overlays.every((assetId) => !assetId.startsWith('overlay.snowcap.'))));
  assert.equal(rowhouses.flatMap(({ rooms }) => rooms).length, 121);
});

test('deterministically alternates same-size test-file building assets', () => {
  const buildings = Array.from({ length: 16 }, (_, index) => (
    building(`test/case-${String(index).padStart(2, '0')}.test.js`, { isTest: true })
  ));
  const inspection = {
    repository: { name: 'varied-test-homes' }, city: { buildings },
    graph: { nodes: buildings.map(({ path }) => ({ path })), edges: [], entrypoints: [] },
    inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
  };
  const first = generateWorldPlan({ inspection, model: { facilities: [] } });
  const second = generateWorldPlan({ inspection, model: { facilities: [] } });
  const assets = first.buildings.filter(({ files }) => files.length > 0).map(({ assetId }) => assetId);

  assert.deepEqual(second, first);
  assert.deepEqual(new Set(assets), new Set(['building.hut', 'building.house_s']));
});

test('keeps worldSeed stable while inspectionDigest detects structural change', () => {
  const before = inspectionFixture();
  const after = structuredClone(before);
  const added = building('src/new.js');
  after.city.buildings.push(added);
  after.graph.nodes.push({ path: added.path });
  const model = modelFixture();
  const first = generateWorldPlan({ inspection: before, model });
  const changed = generateWorldPlan({ inspection: after, model });

  assert.equal(changed.seed, first.seed);
  assert.notEqual(changed.inspectionDigest, first.inspectionDigest);
});

test('L1 rowhouses remain reversible and contain no more than twelve files', () => {
  const buildings = Array.from({ length: 121 }, (_, index) => (
    building(`src/leaf/file-${String(index).padStart(3, '0')}.js`)
  ));
  const inspection = {
    repository: { name: 'medium-town' },
    summary: { truncated: false },
    city: { buildings },
    graph: { nodes: buildings.map(({ path }) => ({ path })), edges: [], entrypoints: [] },
    inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
  };
  const plan = generateWorldPlan({ inspection, model: modelFixture({ gate: false }) });
  const rowhouses = plan.buildings.filter(({ class: buildingClass }) => buildingClass.startsWith('rowhouse_'));

  assert.ok(rowhouses.length > 0);
  assert.ok(rowhouses.every(({ files }) => files.length >= 1 && files.length <= 12));
  assert.equal(plan.buildings.flatMap(({ files }) => files).length, 121);
  assert.equal(new Set(plan.buildings.flatMap(({ files }) => files)).size, 121);
  const navById = new Map(plan.nav.nodes.map((node) => [node.id, node]));
  const npcById = new Map(plan.npcs.map((npc) => [npc.id, npc]));
  for (const rowhouse of rowhouses) {
    assert.deepEqual(rowhouse.rooms.map(({ file }) => file).sort(), [...rowhouse.files].sort());
    const floorIds = rowhouse.rooms.flatMap(({ floorNavNodeIds }) => floorNavNodeIds);
    assert.equal(new Set(floorIds).size, rowhouse.rooms.length);
    const npcIds = rowhouse.rooms.map(({ npcId }) => npcId);
    assert.equal(new Set(npcIds).size, rowhouse.rooms.length);
    for (const room of rowhouse.rooms) {
      const floor = navById.get(room.floorNavNodeIds[0]);
      const resident = npcById.get(room.npcId);
      assert.equal(floor.roomRef, room.file);
      assert.equal(floor.buildingId, rowhouse.id);
      assert.equal(resident.home, rowhouse.id);
      assert.ok(resident.patrol.some(([x, y]) => x === floor.x && y === floor.y));
    }
  }
  const verdict = validateWorldPlan(plan, { inspection });
  assert.equal(verdict.ok, true);
  assert.ok(verdict.issues.some(({ code, severity }) => code === 'REACHABLE' && severity === 'warning'));
});

test('preserves import kind, status, and exact multiplicity in structured street bindings', () => {
  const inspection = inspectionFixture();
  inspection.graph.edges = [
    { from: 'src/main.js', to: 'src/inn.js', kind: 'import', status: 'resolved' },
    { from: 'src/main.js', to: 'src/inn.js', kind: 'dynamic-import', status: 'resolved' },
    { from: 'src/main.js', to: 'src/inn.js', kind: 'dynamic-import', status: 'resolved' }
  ];
  const plan = generateWorldPlan({ inspection, model: modelFixture() });
  const bindings = plan.streets.flatMap(({ edgeBindings }) => edgeBindings);

  assert.equal(bindings.length, 3);
  assert.deepEqual(bindings.map(({ kind }) => kind), ['dynamic-import', 'dynamic-import', 'import']);
  assert.ok(bindings.every(({ status }) => status === 'resolved'));
  assert.equal(new Set(plan.streets.map(({ id }) => id)).size, plan.streets.length);
  assert.equal(validateWorldPlan(plan, { inspection }).ok, true);
});

test('generates and validates a 500-file, 500-district plan within three seconds', () => {
  const buildings = Array.from({ length: 500 }, (_, index) => building(
    `district-${String(index).padStart(3, '0')}/file.js`
  ));
  const inspection = {
    repository: { name: 'performance-town' },
    summary: { truncated: false },
    city: { buildings },
    graph: { nodes: buildings.map(({ path }) => ({ path })), edges: [], entrypoints: [] },
    inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
  };
  const started = performance.now();
  const plan = generateWorldPlan({ inspection, model: modelFixture({ gate: false }) });
  const verdict = validateWorldPlan(plan, { inspection });
  const elapsedMs = performance.now() - started;

  assert.equal(verdict.ok, true);
  assert.ok(elapsedMs < 3_000, `500-file generation and validation took ${elapsedMs.toFixed(1)}ms`);
});

test('keeps a 1000-file, 1000-district plan below a non-flaky five-second regression ceiling', () => {
  const buildings = Array.from({ length: 1_000 }, (_, index) => building(
    `district-${String(index).padStart(4, '0')}/file.js`
  ));
  const inspection = {
    repository: { name: 'large-performance-town' },
    summary: { truncated: false },
    city: { buildings },
    graph: { nodes: buildings.map(({ path }) => ({ path })), edges: [], entrypoints: [] },
    inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
  };
  const started = performance.now();
  const plan = generateWorldPlan({ inspection, model: modelFixture({ gate: false }) });
  const verdict = validateWorldPlan(plan, { inspection });
  const elapsedMs = performance.now() - started;

  assert.equal(verdict.ok, true);
  assert.ok(elapsedMs < 5_000, `1000-file generation and validation took ${elapsedMs.toFixed(1)}ms`);
});

test('an empty repository still has three factual non-ledger ways to complete the first tour', () => {
  const inspection = {
    repository: { name: 'empty-town' },
    summary: { truncated: false },
    city: { buildings: [] },
    graph: { nodes: [], edges: [], entrypoints: [] },
    inspection: { observed: { unresolvedLinks: [] }, inferred: { cycles: [], testAssociations: [] }, unknownDependencies: [] }
  };
  const plan = generateWorldPlan({ inspection, model: { facilities: [] } });
  const factIds = new Set(plan.facts.map(({ id }) => id));
  const witnesses = [
    plan.buildings.find(({ id }) => id === 'building.survey_tower'),
    plan.buildings.find(({ id }) => id === 'building.witness.resident'),
    plan.buildings.find(({ id }) => id === 'building.witness.field_station')
  ];

  assert.equal(plan.facts.length, 3);
  assert.ok(plan.facts.every(({ type }) => type === 'survey_scope'));
  assert.deepEqual(plan.facts.map(({ params }) => params.dimension).sort(), [
    'files', 'repository', 'static_dependencies'
  ]);
  assert.ok(plan.facts.every(({ evidence }) => evidence.observed.length === 1
    && evidence.inferred.length === 0 && evidence.unknown.length === 0));
  assert.ok(witnesses.every(Boolean));
  assert.deepEqual(witnesses.map(({ interaction }) => interaction.verb).sort(), [
    'inspect-field-notice', 'talk-neighbor', 'use-telescope'
  ]);
  assert.ok(witnesses.every(({ interaction }) => interaction.factRefs.length > 0
    && interaction.factRefs.every((factId) => factIds.has(factId))));
  assert.equal(validateWorldPlan(plan, { inspection }).ok, true);
});
