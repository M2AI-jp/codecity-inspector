import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { REQUIRED_ASSET_IDS } from '../public/site-runtime.mjs';
import {
  FACILITY_ANCHORS,
  NAVIGATION_EDGES,
  NAVIGATION_NODES,
  PLAYER_START_NODE_ID,
  WORLD_DISTRICTS,
  WORLD_EFFECTS,
  WORLD_MAP,
  WORLD_NPCS,
  WORLD_PROPS,
  WORLD_STRUCTURES,
  anchorsForPresentFacilities,
  auditWorldMap,
  collectWorldAssetUsage,
  computeWorldCamera,
  createInterpolatedMovement,
  directionBetweenPoints,
  districtForPoint,
  groundAssetAt,
  groundTransformAt,
  navigationEdgeBetween,
  navigationIsConnected,
  navigationNodeById,
  nearestNavigationNode,
  nextNodeForDirection,
  sampleInterpolatedMovement,
  screenToWorld,
  shortestNavigationPath,
  worldNodeIdAt,
  worldRenderLayers,
  worldToScreen
} from '../public/world-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const EXPECTED_FACILITIES = [
  'dock', 'dojo', 'gate', 'guild', 'house', 'inn', 'pub', 'ruin', 'shop',
  'town_hall', 'warehouse', 'watchtower', 'well', 'workshop'
];
const EXPECTED_FIELDS = [
  'field.bridge_stone', 'field.bridge_wood', 'field.cliff', 'field.cobblestone',
  'field.dirt_path', 'field.dock_floor', 'field.fence_wood', 'field.grass',
  'field.plaza', 'field.river_edge', 'field.road_corner', 'field.road_edge',
  'field.road_intersection', 'field.rock', 'field.snow', 'field.stairs_stone',
  'field.tree', 'field.wall_stone', 'field.water'
];

test('world is a native 32x24 approved-asset map with no image-board contract', async () => {
  assert.deepEqual({
    columns: WORLD_MAP.columns,
    rows: WORLD_MAP.rows,
    cellSize: WORLD_MAP.cellSize,
    width: WORLD_MAP.width,
    height: WORLD_MAP.height
  }, { columns: 32, rows: 24, cellSize: 64, width: 2048, height: 1536 });
  assert.equal(WORLD_MAP.ground.length, 24);
  assert.equal(WORLD_MAP.ground.every((row) => row.length === 32), true);
  const runtimeSource = await readFile(`${root}/public/world-runtime.mjs`, 'utf8');
  assert.doesNotMatch(runtimeSource, /WORLD_IMAGE|assets\/world|reference-world|\.png/i);
  assert.doesNotMatch(runtimeSource, /transition/);
});

test('old town, snow, harbor, and woodland form one non-overlapping world', () => {
  assert.deepEqual(WORLD_DISTRICTS.map((district) => district.id).sort(), [
    'harbor', 'old_town', 'snow_quarter', 'woodland'
  ]);
  assert.deepEqual(WORLD_MAP.districts, WORLD_DISTRICTS);
  for (const district of WORLD_DISTRICTS) {
    assert.ok(district.x >= 0 && district.y >= 0);
    assert.ok(district.width > 0 && district.height > 0);
    assert.ok(district.x + district.width <= WORLD_MAP.width);
    assert.ok(district.y + district.height <= WORLD_MAP.height);
  }
  for (let left = 0; left < WORLD_DISTRICTS.length; left += 1) {
    for (let right = left + 1; right < WORLD_DISTRICTS.length; right += 1) {
      const a = WORLD_DISTRICTS[left];
      const b = WORLD_DISTRICTS[right];
      const overlap = a.x < b.x + b.width && a.x + a.width > b.x
        && a.y < b.y + b.height && a.y + a.height > b.y;
      assert.equal(overlap, false, `${a.id} / ${b.id}`);
    }
  }
  assert.equal(districtForPoint(100, 100)?.id, 'old_town');
  assert.equal(districtForPoint(1500, 100)?.id, 'snow_quarter');
  assert.equal(districtForPoint(100, 1200)?.id, 'harbor');
  assert.equal(districtForPoint(1500, 1200)?.id, 'woodland');
});

test('all approved 78 assets have an observable semantic world render binding', () => {
  const usage = collectWorldAssetUsage();
  assert.equal(usage.length, 78);
  assert.deepEqual(usage, REQUIRED_ASSET_IDS);
  assert.deepEqual([...new Set(WORLD_MAP.ground.flat())].sort(), EXPECTED_FIELDS);
  assert.equal(WORLD_STRUCTURES.length, 17);
  assert.equal(new Set(WORLD_STRUCTURES.map((entry) => entry.assetId)).size, 17);
  assert.equal(WORLD_NPCS.length, 21);
  assert.equal(new Set(WORLD_NPCS.map((entry) => entry.assetId)).size, 21);
  assert.ok(WORLD_PROPS.length >= 36);
  assert.equal(new Set(WORLD_PROPS.map((entry) => entry.assetId)).size, 18);
  assert.equal(WORLD_EFFECTS.length, 2);
  assert.deepEqual(WORLD_EFFECTS.map((entry) => entry.assetId).sort(), [
    'effect.construction_dust', 'effect.water_ripple'
  ]);
});

test('world audit checks exact coverage, geography, native scale, and reachability', () => {
  const first = auditWorldMap();
  const second = auditWorldMap();
  assert.deepEqual(first, second);
  assert.equal(first.ok, true, first.issues.join('\n'));
  assert.deepEqual(first.issues, []);
  assert.deepEqual(first.usage, REQUIRED_ASSET_IDS);
  assert.deepEqual(first.counts, {
    fields: 19,
    structures: 17,
    npcs: 22,
    props: WORLD_PROPS.length,
    effects: 2,
    navigationNodes: NAVIGATION_NODES.length,
    navigationEdges: NAVIGATION_EDGES.length
  });
});

test('17 buildings keep native size, do not overlap, and meet visible entrance nodes', () => {
  for (let index = 0; index < WORLD_STRUCTURES.length; index += 1) {
    const building = WORLD_STRUCTURES[index];
    assert.equal(building.width, 256, building.id);
    assert.equal(building.height, 256, building.id);
    assert.equal(building.x % 64, 0, building.id);
    assert.equal(building.y % 64, 0, building.id);
    assert.ok(building.x >= 0 && building.y >= 0);
    assert.ok(building.x + building.width <= WORLD_MAP.width);
    assert.ok(building.y + building.height <= WORLD_MAP.height);
    assert.deepEqual(building.entrance, {
      x: building.x / 64 + 2,
      y: building.y / 64 + 4
    }, building.id);
    const entrance = navigationNodeById(building.entranceNodeId);
    assert.ok(entrance, building.id);
    assert.equal(entrance.cellX, building.entrance.x);
    assert.equal(entrance.cellY, building.entrance.y);
    assert.ok(shortestNavigationPath(PLAYER_START_NODE_ID, building.entranceNodeId).length > 0, building.id);
    for (const other of WORLD_STRUCTURES.slice(index + 1)) {
      const overlap = building.x < other.x + other.width && building.x + building.width > other.x
        && building.y < other.y + other.height && building.y + building.height > other.y;
      assert.equal(overlap, false, `${building.id} / ${other.id}`);
    }
  }
});

test('all 14 evidence-backed facility anchors are on reachable entrances', () => {
  assert.deepEqual(Object.keys(FACILITY_ANCHORS).sort(), EXPECTED_FACILITIES);
  for (const anchor of Object.values(FACILITY_ANCHORS)) {
    const building = WORLD_STRUCTURES.find((entry) => entry.id === anchor.structureId);
    const node = navigationNodeById(anchor.nodeId);
    assert.ok(building, anchor.kind);
    assert.ok(node, anchor.kind);
    assert.equal(building.entranceNodeId, anchor.nodeId, anchor.kind);
    assert.deepEqual({ x: anchor.x, y: anchor.y, cellX: anchor.cellX, cellY: anchor.cellY }, {
      x: node.x, y: node.y, cellX: node.cellX, cellY: node.cellY
    }, anchor.kind);
    assert.ok(shortestNavigationPath(PLAYER_START_NODE_ID, anchor.nodeId).length > 0, anchor.kind);
  }
  const present = anchorsForPresentFacilities([
    { kind: 'town_hall', present: true },
    { kind: 'gate', present: false },
    { kind: 'house', present: true },
    { kind: 'castle', present: true }
  ]);
  assert.deepEqual(present.map((entry) => entry.kind), ['town_hall', 'house']);
});

test('one four-directional graph connects every road without teleports', () => {
  assert.ok(NAVIGATION_NODES.length >= 80);
  assert.equal(navigationIsConnected(), true);
  const byId = new Map(NAVIGATION_NODES.map((node) => [node.id, node]));
  assert.equal(byId.size, NAVIGATION_NODES.length);
  assert.equal(byId.has(PLAYER_START_NODE_ID), true);
  for (const node of NAVIGATION_NODES) {
    assert.equal(node.id, worldNodeIdAt(node.cellX, node.cellY));
    assert.ok(node.cellX >= 0 && node.cellX < WORLD_MAP.columns);
    assert.ok(node.cellY >= 0 && node.cellY < WORLD_MAP.rows);
    assert.ok(node.neighbors.length > 0);
    assert.equal(node.links.length, node.neighbors.length);
    assert.equal(node.groundAssetId, groundAssetAt(node.cellX, node.cellY));
    for (const neighborId of node.neighbors) {
      const neighbor = byId.get(neighborId);
      assert.ok(neighbor, `${node.id} -> ${neighborId}`);
      assert.equal(neighbor.neighbors.includes(node.id), true);
      assert.equal(Math.abs(node.cellX - neighbor.cellX) + Math.abs(node.cellY - neighbor.cellY), 1);
    }
  }
  for (const edge of NAVIGATION_EDGES) {
    assert.ok(['walk', 'bridge', 'stairs'].includes(edge.type));
    assert.ok(byId.has(edge.from) && byId.has(edge.to));
    assert.equal(navigationEdgeBetween(edge.from, edge.to), edge);
  }
});

test('the first journey to the snow dojo visibly crosses stone bridge and cliff stairs', () => {
  const path = shortestNavigationPath(PLAYER_START_NODE_ID, FACILITY_ANCHORS.dojo.nodeId);
  assert.equal(path[0].id, PLAYER_START_NODE_ID);
  assert.equal(path.at(-1).id, FACILITY_ANCHORS.dojo.nodeId);
  const types = path.slice(1).map((node, index) => navigationEdgeBetween(path[index].id, node.id)?.type);
  assert.ok(types.includes('bridge'));
  assert.ok(types.includes('stairs'));
  assert.ok(path.some((node) => node.groundAssetId === 'field.bridge_stone'));
  assert.ok(path.some((node) => node.groundAssetId === 'field.stairs_stone'));
  assert.deepEqual(shortestNavigationPath('missing', FACILITY_ANCHORS.dojo.nodeId), []);
});

test('two bridges cross the continuous waterway and stairs join the snow cliff', () => {
  const bridgeCells = new Map([
    ['field.bridge_stone', []],
    ['field.bridge_wood', []]
  ]);
  const stairCells = [];
  for (let y = 0; y < WORLD_MAP.rows; y += 1) for (let x = 0; x < WORLD_MAP.columns; x += 1) {
    const assetId = groundAssetAt(x, y);
    if (bridgeCells.has(assetId)) bridgeCells.get(assetId).push([x, y]);
    if (assetId === 'field.stairs_stone') stairCells.push([x, y]);
  }
  for (const [assetId, cells] of bridgeCells) {
    assert.equal(cells.length, 2, assetId);
    for (const [x, y] of cells) {
      assert.equal(groundAssetAt(x, y - 1), 'field.water', `${assetId}:${x},${y} north`);
      assert.equal(groundAssetAt(x, y + 1), 'field.water', `${assetId}:${x},${y} south`);
      const node = navigationNodeById(worldNodeIdAt(x, y));
      assert.ok(node, `${assetId}:${x},${y}`);
      assert.ok(node.links.some((link) => link.type === 'bridge'));
    }
  }
  assert.deepEqual(stairCells, [[20, 7]]);
  assert.equal(groundAssetAt(19, 7), 'field.cliff');
  assert.equal(groundAssetAt(21, 7), 'field.cliff');
  const stairNode = navigationNodeById(worldNodeIdAt(20, 7));
  assert.ok(stairNode.links.some((link) => link.type === 'stairs'));
  assert.equal(groundAssetAt(15, 8), 'field.water');
  assert.equal(groundAssetAt(16, 23), 'field.water');
  assert.equal(groundAssetAt(17, 23), 'field.river_edge');
});

test('harbor, snow, and woodland materials retain geographic meaning', () => {
  assert.equal(groundAssetAt(8, 20), 'field.dock_floor');
  assert.equal(groundAssetAt(9, 20), 'field.dock_floor');
  assert.equal(groundAssetAt(10, 20), 'field.water');
  assert.equal(groundAssetAt(WORLD_EFFECTS[0].x, WORLD_EFFECTS[0].y), 'field.water');
  assert.equal(WORLD_EFFECTS[0].context, 'water');
  assert.equal(WORLD_EFFECTS[1].context, 'ruin');
  assert.equal(groundAssetAt(25, 8), 'field.snow');
  assert.equal(groundAssetAt(22, 17), 'field.fence_wood');
  assert.equal(groundAssetAt(22, 20), 'field.rock');
  assert.equal(groundAssetAt(30, 23), 'field.tree');
  assert.equal(groundAssetAt(4, 0), 'field.wall_stone');
});

test('objects and role NPCs are in bounds and carry semantic context', () => {
  for (const entry of [...WORLD_PROPS, ...WORLD_NPCS, ...WORLD_EFFECTS]) {
    assert.ok(Number.isInteger(entry.x) && entry.x >= 0 && entry.x < WORLD_MAP.columns, entry.assetId);
    assert.ok(Number.isInteger(entry.y) && entry.y >= 0 && entry.y < WORLD_MAP.rows, entry.assetId);
  }
  assert.equal(WORLD_PROPS.every((entry) => typeof entry.context === 'string' && entry.context.length > 0), true);
  assert.equal(WORLD_NPCS.every((entry) => typeof entry.role === 'string' && entry.role.length > 0), true);
  assert.equal(WORLD_NPCS.every((entry) => EXPECTED_FACILITIES.includes(entry.facilityKind)), true);
  assert.equal(WORLD_NPCS.every((entry) => WORLD_DISTRICTS.some((district) => district.id === entry.district)), true);
});

test('ground transforms are deterministic and native-safe', () => {
  const signatures = new Set();
  for (let y = 0; y < WORLD_MAP.rows; y += 1) for (let x = 0; x < WORLD_MAP.columns; x += 1) {
    const first = groundTransformAt(x, y);
    const second = groundTransformAt(x, y);
    assert.deepEqual(first, second, `${x},${y}`);
    assert.ok(Number.isInteger(first.quarterTurns) && first.quarterTurns >= 0 && first.quarterTurns <= 3);
    assert.equal(typeof first.flipX, 'boolean');
    signatures.add(`${first.quarterTurns}:${first.flipX}`);
  }
  assert.ok(signatures.size >= 4);
  assert.equal(groundAssetAt(-1, 0), null);
  assert.equal(groundAssetAt(32, 0), null);
});

test('directional movement and interpolation remain deterministic', () => {
  const directions = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
  };
  for (const node of NAVIGATION_NODES) {
    for (const [direction, vector] of Object.entries(directions)) {
      const first = nextNodeForDirection(node.id, direction);
      const repeat = nextNodeForDirection(node.id, direction);
      assert.equal(first.id, repeat.id);
      if (first.id === node.id) continue;
      assert.ok(node.neighbors.includes(first.id));
      assert.ok(((first.x - node.x) * vector.x) + ((first.y - node.y) * vector.y) > 0);
    }
  }
  assert.equal(directionBetweenPoints({ x: 10, y: 10 }, { x: 30, y: 11 }), 'right');
  assert.equal(directionBetweenPoints({ x: 10, y: 10 }, { x: 9, y: 0 }), 'up');
  const movement = createInterpolatedMovement({ x: 0, y: 0 }, { x: 64, y: 64 }, 1000, 400);
  assert.deepEqual(sampleInterpolatedMovement(movement, 1000), {
    x: 0, y: 0, progress: 0, done: false, direction: 'right'
  });
  const middle = sampleInterpolatedMovement(movement, 1200);
  assert.ok(middle.x > 0 && middle.x < 64 && middle.y > 0 && middle.y < 64);
  assert.deepEqual(sampleInterpolatedMovement(movement, 1400), {
    x: 64, y: 64, progress: 1, done: true, direction: 'right'
  });
});

test('world camera and screen transforms use the authored map dimensions', () => {
  const overview = computeWorldCamera({ mode: 'overview', viewportWidth: 1200, viewportHeight: 800 });
  assert.ok(overview.scale > 0 && overview.scale <= 1);
  assert.equal(overview.sourceWidth, WORLD_MAP.width);
  assert.equal(overview.sourceHeight, WORLD_MAP.height);
  assert.ok(overview.destWidth <= 1200 && overview.destHeight <= 800);
  for (const focus of [{ x: 0, y: 0 }, { x: WORLD_MAP.width, y: WORLD_MAP.height }]) {
    const camera = computeWorldCamera({
      mode: 'follow', viewportWidth: 640, viewportHeight: 480, focusX: focus.x, focusY: focus.y
    });
    assert.equal(camera.scale, 1);
    assert.ok(camera.sourceX >= 0 && camera.sourceY >= 0);
    assert.ok(camera.sourceX + camera.sourceWidth <= WORLD_MAP.width);
    assert.ok(camera.sourceY + camera.sourceHeight <= WORLD_MAP.height);
    const point = { x: camera.sourceX + 100, y: camera.sourceY + 100 };
    assert.deepEqual(screenToWorld(camera, worldToScreen(camera, point)), point);
  }
  assert.equal(nearestNavigationNode(FACILITY_ANCHORS.town_hall.x, FACILITY_ANCHORS.town_hall.y).id,
    FACILITY_ANCHORS.town_hall.nodeId);
});

test('initial render exposes the player and nearby entrance before interaction', () => {
  const initial = worldRenderLayers({
    view: 'overview',
    interactionStarted: false,
    hasPlayerAsset: true,
    selectedAnchor: FACILITY_ANCHORS.town_hall,
    nearbyAnchor: FACILITY_ANCHORS.town_hall
  });
  assert.equal(initial.drawPlayer, true);
  assert.deepEqual(initial.anchors.map((anchor) => anchor.kind), ['town_hall']);
  const site = worldRenderLayers({ view: 'site', interactionStarted: true, hasPlayerAsset: true });
  assert.equal(site.drawPlayer, false);
});
