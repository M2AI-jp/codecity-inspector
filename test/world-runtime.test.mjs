import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FACILITY_ANCHORS,
  NAVIGATION_EDGES,
  NAVIGATION_NODES,
  WORLD_DISTRICTS,
  WORLD_IMAGE,
  anchorsForPresentFacilities,
  computeWorldCamera,
  createInterpolatedMovement,
  directionBetweenPoints,
  districtForPoint,
  navigationIsConnected,
  navigationEdgeBetween,
  nearestNavigationNode,
  nextNodeForDirection,
  sampleInterpolatedMovement,
  screenToWorld,
  shortestNavigationPath,
  worldRenderLayers,
  worldToScreen
} from '../public/world-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const EXPECTED_FACILITIES = [
  'dock', 'dojo', 'gate', 'guild', 'house', 'inn', 'pub', 'ruin', 'shop',
  'town_hall', 'warehouse', 'watchtower', 'well', 'workshop'
];

test('published world image is the byte-level PNG contract used by navigation', async () => {
  const path = `${root}/public${WORLD_IMAGE.src}`;
  const png = await readFile(path);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1491);
  assert.equal(png.readUInt32BE(20), 1055);
  assert.deepEqual(WORLD_IMAGE, {
    src: '/assets/world/codecity-reference-world.png',
    width: 1491,
    height: 1055
  });
});

test('districts and all facility anchors stay inside the reference world', () => {
  assert.deepEqual(WORLD_DISTRICTS.map((district) => district.id).sort(), [
    'harbor', 'old_town', 'snow_quarter', 'woodland'
  ]);
  for (const district of WORLD_DISTRICTS) {
    assert.ok(district.x >= 0 && district.y >= 0);
    assert.ok(district.width > 0 && district.height > 0);
    assert.ok(district.x + district.width <= WORLD_IMAGE.width);
    assert.ok(district.y + district.height <= WORLD_IMAGE.height);
  }

  assert.deepEqual(Object.keys(FACILITY_ANCHORS).sort(), EXPECTED_FACILITIES);
  for (const anchor of Object.values(FACILITY_ANCHORS)) {
    assert.ok(anchor.x >= 0 && anchor.x <= WORLD_IMAGE.width, `${anchor.kind} x`);
    assert.ok(anchor.y >= 0 && anchor.y <= WORLD_IMAGE.height, `${anchor.kind} y`);
    const district = WORLD_DISTRICTS.find((entry) => entry.id === anchor.district);
    assert.ok(district, `${anchor.kind} district`);
    assert.ok(anchor.x >= district.x && anchor.x <= district.x + district.width, `${anchor.kind} district x`);
    assert.ok(anchor.y >= district.y && anchor.y <= district.y + district.height, `${anchor.kind} district y`);
  }
});

test('navigation graph has four populated districts, symmetric links, and one connected component', () => {
  assert.ok(NAVIGATION_NODES.length >= 50);
  const byId = new Map(NAVIGATION_NODES.map((node) => [node.id, node]));
  assert.equal(byId.size, NAVIGATION_NODES.length);
  assert.deepEqual([...new Set(NAVIGATION_NODES.map((node) => node.district))].sort(), [
    'harbor', 'old_town', 'snow_quarter', 'woodland'
  ]);
  for (const node of NAVIGATION_NODES) {
    assert.ok(node.x >= 0 && node.x <= WORLD_IMAGE.width, `${node.id} x`);
    assert.ok(node.y >= 0 && node.y <= WORLD_IMAGE.height, `${node.id} y`);
    assert.ok(node.neighbors.length > 0, `${node.id} neighbors`);
    assert.equal(node.links.length, node.neighbors.length, `${node.id} links`);
    for (const neighborId of node.neighbors) {
      const neighbor = byId.get(neighborId);
      assert.ok(neighbor, `${node.id} -> ${neighborId}`);
      assert.ok(neighbor.neighbors.includes(node.id), `${neighborId} -> ${node.id}`);
    }
  }
  assert.equal(navigationIsConnected(), true);
});

test('every facility anchor is exactly a remeasured entrance or forecourt node', () => {
  for (const anchor of Object.values(FACILITY_ANCHORS)) {
    const node = NAVIGATION_NODES.find((entry) => entry.id === anchor.nodeId);
    assert.ok(node, anchor.kind);
    assert.deepEqual({ x: anchor.x, y: anchor.y, district: anchor.district }, {
      x: node.x, y: node.y, district: node.district
    }, anchor.kind);
    assert.equal(nearestNavigationNode(anchor.x, anchor.y).id, node.id, anchor.kind);
  }
});

test('only transitions may exceed 96px and every edge has an explicit movement type', () => {
  const byId = new Map(NAVIGATION_NODES.map((node) => [node.id, node]));
  assert.ok(NAVIGATION_EDGES.some((edge) => edge.type === 'transition'));
  for (const edge of NAVIGATION_EDGES) {
    assert.ok(['walk', 'transition'].includes(edge.type));
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    assert.ok(from && to, `${edge.from} -> ${edge.to}`);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance > 96) assert.equal(edge.type, 'transition', `${edge.from} -> ${edge.to}`);
    if (edge.type === 'walk') assert.ok(distance <= 96, `${edge.from} -> ${edge.to} is ${distance}px`);
    assert.equal(navigationEdgeBetween(edge.from, edge.to), edge);
  }
  assert.equal(navigationEdgeBetween('o_gate', 'w_ruin'), null);
});

test('only facilities backed by present evidence receive world anchors', () => {
  const facilities = [
    { kind: 'town_hall', present: true },
    { kind: 'gate', present: false },
    { kind: 'house', present: true },
    { kind: 'castle', present: true }
  ];
  assert.deepEqual(anchorsForPresentFacilities(facilities).map((anchor) => anchor.kind), ['town_hall', 'house']);
});

test('directional movement is deterministic and never chooses a backwards edge', () => {
  const directions = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
  };
  const byId = new Map(NAVIGATION_NODES.map((node) => [node.id, node]));
  for (const node of NAVIGATION_NODES) {
    for (const [direction, vector] of Object.entries(directions)) {
      const first = nextNodeForDirection(node.id, direction);
      const repeat = nextNodeForDirection(node.id, direction);
      assert.equal(first.id, repeat.id);
      if (first.id === node.id) continue;
      assert.ok(node.neighbors.includes(first.id));
      const dx = first.x - node.x;
      const dy = first.y - node.y;
      assert.ok((dx * vector.x) + (dy * vector.y) > 0, `${node.id} ${direction} -> ${first.id}`);
      assert.equal(byId.has(first.id), true);
    }
  }
});

test('click paths follow authored graph edges and interpolation is continuous', () => {
  const path = shortestNavigationPath('o_gate', 'w_ruin');
  assert.equal(path[0].id, 'o_gate');
  assert.equal(path.at(-1).id, 'w_ruin');
  for (let index = 1; index < path.length; index += 1) {
    assert.equal(path[index - 1].neighbors.includes(path[index].id), true);
  }
  assert.ok(path.some((node, index) => index > 0
    && navigationEdgeBetween(path[index - 1].id, node.id)?.type === 'transition'));
  assert.deepEqual(shortestNavigationPath('missing', 'o_gate'), []);
  assert.equal(directionBetweenPoints({ x: 10, y: 10 }, { x: 30, y: 11 }), 'right');
  assert.equal(directionBetweenPoints({ x: 10, y: 10 }, { x: 9, y: 0 }), 'up');
  const movement = createInterpolatedMovement({ x: 0, y: 0 }, { x: 100, y: 40 }, 1000, 400);
  const start = sampleInterpolatedMovement(movement, 1000);
  const middle = sampleInterpolatedMovement(movement, 1200);
  const end = sampleInterpolatedMovement(movement, 1400);
  assert.deepEqual({ x: start.x, y: start.y, done: start.done }, { x: 0, y: 0, done: false });
  assert.ok(middle.x > 0 && middle.x < 100 && middle.y > 0 && middle.y < 40);
  assert.deepEqual({ x: end.x, y: end.y, done: end.done }, { x: 100, y: 40, done: true });
});

test('overview contains the world and follow camera stays at native scale within its edges', () => {
  const overview = computeWorldCamera({ mode: 'overview', viewportWidth: 1000, viewportHeight: 700 });
  assert.ok(overview.scale > 0 && overview.scale <= 1);
  assert.ok(overview.destWidth <= 1000 && overview.destHeight <= 700);
  assert.equal(overview.sourceX, 0);
  assert.equal(overview.sourceY, 0);
  assert.equal(overview.sourceWidth, WORLD_IMAGE.width);
  assert.equal(overview.sourceHeight, WORLD_IMAGE.height);

  for (const focus of [{ x: 0, y: 0 }, { x: WORLD_IMAGE.width, y: WORLD_IMAGE.height }]) {
    const camera = computeWorldCamera({
      mode: 'follow', viewportWidth: 640, viewportHeight: 480, focusX: focus.x, focusY: focus.y
    });
    assert.equal(camera.scale, 1);
    assert.ok(camera.sourceX >= 0 && camera.sourceY >= 0);
    assert.ok(camera.sourceX + camera.sourceWidth <= WORLD_IMAGE.width);
    assert.ok(camera.sourceY + camera.sourceHeight <= WORLD_IMAGE.height);
    const point = { x: camera.sourceX + 100, y: camera.sourceY + 100 };
    const roundTrip = screenToWorld(camera, worldToScreen(camera, point));
    assert.ok(Math.abs(roundTrip.x - point.x) < 1e-9);
    assert.ok(Math.abs(roundTrip.y - point.y) < 1e-9);
  }
});

test('initial render policy is board-only; player and contextual anchors begin after interaction', () => {
  const initial = worldRenderLayers({
    view: 'overview', interactionStarted: false, hasPlayerAsset: true,
    hoveredAnchor: FACILITY_ANCHORS.town_hall,
    selectedAnchor: FACILITY_ANCHORS.gate,
    nearbyAnchor: FACILITY_ANCHORS.guild
  });
  assert.equal(initial.drawPlayer, false);
  assert.deepEqual(initial.anchors, []);
  const active = worldRenderLayers({
    view: 'world', interactionStarted: true, hasPlayerAsset: true,
    hoveredAnchor: FACILITY_ANCHORS.town_hall,
    selectedAnchor: FACILITY_ANCHORS.gate,
    nearbyAnchor: FACILITY_ANCHORS.gate
  });
  assert.equal(active.drawPlayer, true);
  assert.deepEqual(active.anchors.map((anchor) => anchor.kind), ['town_hall', 'gate']);
});

test('default app starts from the authored board and has no legacy/fallback asset path', async () => {
  const app = await readFile(`${root}/public/app.js`, 'utf8');
  const html = await readFile(`${root}/public/index.html`, 'utf8');
  const css = await readFile(`${root}/public/styles.css`, 'utf8');
  assert.doesNotMatch(app, /from ['"]\.\/game-runtime\.mjs['"]/);
  assert.match(app, /loadForgeAssetImages/);
  assert.doesNotMatch(`${app}\n${html}`, /loadLegacyAssetManifest|loadGameAssets|game-runtime\.mjs|fallback.*asset/i);
  assert.equal((app.match(/assets\/forge\/manifest\.json/g) ?? []).length, 0, 'manifest URL belongs in site-runtime only');
  assert.match(html, /id="world-canvas"/);
  assert.match(html, /id="world-help"[^>]*hidden/);
  assert.doesNotMatch(html, /旧素材|技術情報|asset gallery/i);
  assert.doesNotMatch(html, /78\s*\/\s*78/);
  assert.match(css, /grid-template-rows:\s*46px/);
  assert.match(app, /state\.interactionStarted = false|interactionStarted:\s*false/);
  assert.match(app, /worldRenderLayers/);
  assert.match(app, /edge\.type === 'transition'/);
  assert.match(app, /worldTransition = \{ startedAt: timestamp, duration: 180/);
  assert.match(app, /if \(layers\.drawPlayer && !state\.worldTransition\)/);
});

test('completed world walks and transitions refresh the header district at the destination', async () => {
  const app = await readFile(`${root}/public/app.js`, 'utf8');
  const updateStart = app.indexOf('function updateMovements(timestamp)');
  const updateEnd = app.indexOf('\nfunction animationTick', updateStart);
  const updateMovements = app.slice(updateStart, updateEnd);
  assert.match(updateMovements, /state\.worldTransition = null;\s+updateSummary\(\);\s+startNextWorldSegment\(timestamp\)/);
  assert.match(updateMovements, /state\.worldMovement = null;\s+updateNearbyAnchor\(\);\s+updateSummary\(\);\s+startNextWorldSegment\(timestamp\)/);
  assert.equal(districtForPoint(FACILITY_ANCHORS.dock.x, FACILITY_ANCHORS.dock.y)?.label, '港と工房街');
  assert.equal(districtForPoint(FACILITY_ANCHORS.watchtower.x, FACILITY_ANCHORS.watchtower.y)?.label, '雪の街区');
  assert.equal(districtForPoint(FACILITY_ANCHORS.ruin.x, FACILITY_ANCHORS.ruin.y)?.label, '森の街道');
});
