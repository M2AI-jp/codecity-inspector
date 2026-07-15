export const WORLD_IMAGE = Object.freeze({
  src: '/assets/world/codecity-reference-world.png',
  width: 1491,
  height: 1055
});

export const WORLD_DISTRICTS = Object.freeze([
  Object.freeze({ id: 'old_town', label: '旧市街', x: 0, y: 0, width: 1010, height: 620 }),
  Object.freeze({ id: 'snow_quarter', label: '雪の街区', x: 980, y: 0, width: 511, height: 560 }),
  Object.freeze({ id: 'harbor', label: '港と工房街', x: 0, y: 560, width: 1010, height: 495 }),
  Object.freeze({ id: 'woodland', label: '森の街道', x: 930, y: 520, width: 561, height: 535 })
]);

const NODE_POINTS = [
  ['o_gate', 214, 226, 'old_town'], ['o01', 250, 228, 'old_town'],
  ['o02', 292, 250, 'old_town'], ['o03', 335, 278, 'old_town'],
  ['o04', 383, 310, 'old_town'], ['o_hall', 438, 337, 'old_town'],
  ['o06', 438, 372, 'old_town'], ['o07', 438, 414, 'old_town'],
  ['o08', 438, 462, 'old_town'], ['o09', 438, 505, 'old_town'],
  ['o10', 486, 340, 'old_town'], ['o11', 535, 337, 'old_town'],
  ['o12', 585, 337, 'old_town'], ['o13', 635, 349, 'old_town'],
  ['o14', 683, 350, 'old_town'], ['o15', 730, 350, 'old_town'],

  ['m00', 790, 390, 'old_town'], ['m01', 790, 350, 'old_town'],
  ['m_guild', 795, 300, 'old_town'], ['m02', 830, 300, 'old_town'],
  ['m03', 870, 300, 'old_town'], ['m04', 910, 300, 'old_town'],
  ['m_inn', 940, 300, 'old_town'], ['m_pub', 850, 245, 'old_town'],
  ['m_shop', 910, 245, 'old_town'],

  ['d00', 330, 850, 'harbor'], ['d01', 290, 860, 'harbor'],
  ['d02', 250, 880, 'harbor'], ['d_dock', 210, 910, 'harbor'],
  ['j00', 500, 850, 'harbor'], ['j01', 530, 870, 'harbor'],
  ['j_dojo', 565, 900, 'harbor'], ['j02', 620, 900, 'harbor'],
  ['q00', 850, 1000, 'harbor'], ['q01', 845, 950, 'harbor'],
  ['q02', 842, 900, 'harbor'], ['q03', 842, 850, 'harbor'],
  ['q04', 845, 800, 'harbor'], ['q_well', 865, 755, 'harbor'],

  ['s00', 1045, 480, 'snow_quarter'], ['s01', 1070, 455, 'snow_quarter'],
  ['s02', 1100, 435, 'snow_quarter'], ['s03', 1140, 420, 'snow_quarter'],
  ['s04', 1180, 410, 'snow_quarter'], ['s05', 1220, 390, 'snow_quarter'],
  ['s_watch', 1250, 360, 'snow_quarter'],

  ['w00', 1065, 710, 'woodland'], ['w_workshop', 1070, 680, 'woodland'],
  ['w01', 1120, 700, 'woodland'], ['w02', 1170, 700, 'woodland'],
  ['w03', 1220, 695, 'woodland'], ['w_warehouse', 1260, 680, 'woodland'],
  ['w04', 1310, 680, 'woodland'], ['w05', 1360, 675, 'woodland'],
  ['w10', 1060, 730, 'woodland'], ['w11', 1035, 770, 'woodland'],
  ['w12', 1035, 820, 'woodland'], ['w13', 1035, 870, 'woodland'],
  ['w14', 1060, 920, 'woodland'], ['w15', 1110, 945, 'woodland'],
  ['w16', 1160, 945, 'woodland'], ['w_house', 1200, 930, 'woodland'],
  ['w17', 1250, 945, 'woodland'], ['w18', 1280, 950, 'woodland'],
  ['w19', 1320, 940, 'woodland'], ['w20', 1350, 920, 'woodland'],
  ['w21', 1370, 880, 'woodland'], ['w_ruin', 1370, 850, 'woodland']
];

const EDGE_DEFINITIONS = [
  ['o_gate', 'o01'], ['o01', 'o02'], ['o02', 'o03'], ['o03', 'o04'], ['o04', 'o_hall'],
  ['o_hall', 'o06'], ['o06', 'o07'], ['o07', 'o08'], ['o08', 'o09'],
  ['o_hall', 'o10'], ['o10', 'o11'], ['o11', 'o12'], ['o12', 'o13'], ['o13', 'o14'], ['o14', 'o15'],

  ['m00', 'm01'], ['m01', 'm_guild'], ['m_guild', 'm02'], ['m02', 'm03'],
  ['m03', 'm04'], ['m04', 'm_inn'], ['m02', 'm_pub'], ['m_pub', 'm_shop'], ['m_shop', 'm_inn'],

  ['d00', 'd01'], ['d01', 'd02'], ['d02', 'd_dock'],
  ['j00', 'j01'], ['j01', 'j_dojo'], ['j_dojo', 'j02'],
  ['q00', 'q01'], ['q01', 'q02'], ['q02', 'q03'], ['q03', 'q04'], ['q04', 'q_well'],

  ['s00', 's01'], ['s01', 's02'], ['s02', 's03'], ['s03', 's04'], ['s04', 's05'], ['s05', 's_watch'],

  ['w00', 'w_workshop'], ['w00', 'w01'], ['w_workshop', 'w01'], ['w01', 'w02'],
  ['w02', 'w03'], ['w03', 'w_warehouse'], ['w_warehouse', 'w04'], ['w04', 'w05'],
  ['w01', 'w10'], ['w10', 'w11'], ['w11', 'w12'], ['w12', 'w13'],
  ['w13', 'w14'], ['w14', 'w15'], ['w15', 'w16'], ['w16', 'w_house'],
  ['w_house', 'w17'], ['w17', 'w18'], ['w18', 'w19'], ['w19', 'w20'],
  ['w20', 'w21'], ['w21', 'w_ruin'],

  ['o15', 'm00', 'transition'], ['o09', 'd00', 'transition'],
  ['d00', 'j00', 'transition'], ['j02', 'q00', 'transition'],
  ['m_inn', 's00', 'transition'], ['q_well', 'w00', 'transition'],
  ['s00', 'w00', 'transition']
];

export const NAVIGATION_EDGES = Object.freeze(EDGE_DEFINITIONS.map(([from, to, type = 'walk']) => Object.freeze({
  from, to, type
})));

function buildNavigationNodes(points, edges) {
  const neighbors = new Map(points.map(([id]) => [id, new Set()]));
  const links = new Map(points.map(([id]) => [id, []]));
  for (const { from: left, to: right, type } of edges) {
    if (!neighbors.has(left) || !neighbors.has(right)) throw new Error('Navigation edge references an unknown node');
    neighbors.get(left).add(right);
    neighbors.get(right).add(left);
    links.get(left).push(Object.freeze({ id: right, type }));
    links.get(right).push(Object.freeze({ id: left, type }));
  }
  return Object.freeze(points.map(([id, x, y, district]) => Object.freeze({
    id, x, y, district,
    neighbors: Object.freeze([...neighbors.get(id)].sort()),
    links: Object.freeze([...links.get(id)].sort((left, right) => left.id.localeCompare(right.id)))
  })));
}

export const NAVIGATION_NODES = buildNavigationNodes(NODE_POINTS, NAVIGATION_EDGES);

const ANCHOR_SPECS = Object.freeze({
  town_hall: ['役場', 'o_hall'], gate: ['門', 'o_gate'], guild: ['接続者ギルド', 'm_guild'],
  pub: ['酒場', 'm_pub'], shop: ['商店', 'm_shop'], inn: ['宿屋', 'm_inn'],
  dock: ['船着場', 'd_dock'], dojo: ['道場', 'j_dojo'], well: ['井戸', 'q_well'],
  workshop: ['工房', 'w_workshop'], warehouse: ['倉庫', 'w_warehouse'],
  watchtower: ['見張り台', 's_watch'], house: ['住宅', 'w_house'], ruin: ['廃屋', 'w_ruin']
});

export const FACILITY_ANCHORS = Object.freeze(Object.fromEntries(Object.entries(ANCHOR_SPECS).map(([kind, [label, nodeId]]) => {
  const node = NAVIGATION_NODES.find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`Facility anchor references an unknown node: ${kind}`);
  return [kind, Object.freeze({ kind, label, x: node.x, y: node.y, district: node.district, nodeId })];
})));

const DIRECTION_VECTORS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 })
});

export function navigationNodeById(id, nodes = NAVIGATION_NODES) {
  return nodes.find((node) => node.id === id) ?? null;
}

export function navigationEdgeBetween(fromId, toId, edges = NAVIGATION_EDGES) {
  return edges.find((edge) => (edge.from === fromId && edge.to === toId)
    || (edge.from === toId && edge.to === fromId)) ?? null;
}

export function nearestNavigationNode(x, y, nodes = NAVIGATION_NODES) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || nodes.length === 0) return null;
  return [...nodes].sort((left, right) => {
    const leftDistance = ((left.x - x) ** 2) + ((left.y - y) ** 2);
    const rightDistance = ((right.x - x) ** 2) + ((right.y - y) ** 2);
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0] ?? null;
}

export function nextNodeForDirection(currentId, direction, nodes = NAVIGATION_NODES) {
  const current = navigationNodeById(currentId, nodes);
  const vector = DIRECTION_VECTORS[direction];
  if (!current || !vector) return current;
  const candidates = current.links.map((link) => ({ link, node: navigationNodeById(link.id, nodes) })).filter(({ node }) => Boolean(node))
    .map(({ link, node }) => {
      const dx = node.x - current.x;
      const dy = node.y - current.y;
      const distance = Math.hypot(dx, dy);
      const dot = distance > 0 ? ((dx / distance) * vector.x) + ((dy / distance) * vector.y) : -1;
      return { node, dot, distance, type: link.type };
    })
    .filter((candidate) => candidate.dot > 0)
    .sort((left, right) => (left.type === 'transition') - (right.type === 'transition')
      || right.dot - left.dot || left.distance - right.distance
      || left.node.id.localeCompare(right.node.id));
  return candidates[0]?.node ?? current;
}

export function navigationIsConnected(nodes = NAVIGATION_NODES) {
  if (nodes.length === 0) return false;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set([nodes[0].id]);
  const queue = [nodes[0].id];
  while (queue.length) {
    const id = queue.shift();
    for (const neighbor of byId.get(id)?.neighbors ?? []) {
      if (!byId.has(neighbor) || seen.has(neighbor)) continue;
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }
  return seen.size === nodes.length;
}

export function shortestNavigationPath(fromId, toId, nodes = NAVIGATION_NODES) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(fromId) || !byId.has(toId)) return Object.freeze([]);
  if (fromId === toId) return Object.freeze([byId.get(fromId)]);
  const previous = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    for (const neighbor of byId.get(id).neighbors) {
      if (previous.has(neighbor) || !byId.has(neighbor)) continue;
      previous.set(neighbor, id);
      if (neighbor === toId) {
        const path = [];
        let cursor = toId;
        while (cursor !== null) {
          path.push(byId.get(cursor));
          cursor = previous.get(cursor);
        }
        return Object.freeze(path.reverse());
      }
      queue.push(neighbor);
    }
  }
  return Object.freeze([]);
}

export function directionBetweenPoints(from, to, fallback = 'down') {
  if (!from || !to) return fallback;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx < 0 ? 'left' : 'right';
  if (dy !== 0) return dy < 0 ? 'up' : 'down';
  return fallback;
}

export function createInterpolatedMovement(from, to, startedAt, duration = 240) {
  if (!from || !to || !Number.isFinite(startedAt)) return null;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 240;
  return Object.freeze({
    from: Object.freeze({ x: Number(from.x), y: Number(from.y) }),
    to: Object.freeze({ x: Number(to.x), y: Number(to.y) }),
    startedAt,
    duration: safeDuration,
    direction: directionBetweenPoints(from, to)
  });
}

export function sampleInterpolatedMovement(movement, timestamp) {
  if (!movement || !Number.isFinite(timestamp)) return null;
  const progress = Math.max(0, Math.min(1, (timestamp - movement.startedAt) / movement.duration));
  const eased = progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
  return Object.freeze({
    x: movement.from.x + (movement.to.x - movement.from.x) * eased,
    y: movement.from.y + (movement.to.y - movement.from.y) * eased,
    progress,
    done: progress >= 1,
    direction: movement.direction
  });
}

export function worldRenderLayers({
  view = 'overview',
  interactionStarted = false,
  hasPlayerAsset = false,
  hoveredAnchor = null,
  selectedAnchor = null,
  nearbyAnchor = null
} = {}) {
  const anchors = interactionStarted
    ? [hoveredAnchor, selectedAnchor, nearbyAnchor].filter(Boolean)
      .filter((anchor, index, list) => list.findIndex((item) => item.kind === anchor.kind) === index)
    : [];
  return Object.freeze({
    drawPlayer: view === 'world' && interactionStarted && hasPlayerAsset,
    anchors: Object.freeze(anchors)
  });
}

export function anchorsForPresentFacilities(facilities = []) {
  const presentKinds = new Set(facilities.filter((facility) => facility?.present === true).map((facility) => facility.kind));
  return Object.values(FACILITY_ANCHORS).filter((anchor) => presentKinds.has(anchor.kind));
}

export function nearestFacilityAnchor(x, y, anchors, maxDistance = Infinity) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const nearest = [...(anchors ?? [])].map((anchor) => ({
    anchor,
    distance: Math.hypot(anchor.x - x, anchor.y - y)
  })).sort((left, right) => left.distance - right.distance
    || left.anchor.kind.localeCompare(right.anchor.kind))[0];
  return nearest && nearest.distance <= maxDistance ? nearest.anchor : null;
}

function positiveViewport(value) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function computeWorldCamera({
  mode = 'overview',
  viewportWidth,
  viewportHeight,
  focusX = WORLD_IMAGE.width / 2,
  focusY = WORLD_IMAGE.height / 2,
  worldWidth = WORLD_IMAGE.width,
  worldHeight = WORLD_IMAGE.height
} = {}) {
  const width = positiveViewport(viewportWidth);
  const height = positiveViewport(viewportHeight);
  const safeWorldWidth = positiveViewport(worldWidth);
  const safeWorldHeight = positiveViewport(worldHeight);
  if (mode !== 'follow') {
    const scale = Math.min(1, width / safeWorldWidth, height / safeWorldHeight);
    const destWidth = safeWorldWidth * scale;
    const destHeight = safeWorldHeight * scale;
    return {
      mode: 'overview', scale, sourceX: 0, sourceY: 0,
      sourceWidth: safeWorldWidth, sourceHeight: safeWorldHeight,
      destX: (width - destWidth) / 2, destY: (height - destHeight) / 2,
      destWidth, destHeight, viewportWidth: width, viewportHeight: height
    };
  }
  const scale = 1;
  const sourceWidth = Math.min(safeWorldWidth, width / scale);
  const sourceHeight = Math.min(safeWorldHeight, height / scale);
  const maxSourceX = safeWorldWidth - sourceWidth;
  const maxSourceY = safeWorldHeight - sourceHeight;
  const sourceX = Math.max(0, Math.min(maxSourceX, focusX - sourceWidth / 2));
  const sourceY = Math.max(0, Math.min(maxSourceY, focusY - sourceHeight / 2));
  const destWidth = sourceWidth * scale;
  const destHeight = sourceHeight * scale;
  return {
    mode: 'follow', scale, sourceX, sourceY, sourceWidth, sourceHeight,
    destX: (width - destWidth) / 2, destY: (height - destHeight) / 2,
    destWidth, destHeight, viewportWidth: width, viewportHeight: height
  };
}

export function worldToScreen(camera, point) {
  if (!camera || !point) return null;
  return {
    x: camera.destX + (point.x - camera.sourceX) * camera.scale,
    y: camera.destY + (point.y - camera.sourceY) * camera.scale
  };
}

export function screenToWorld(camera, point) {
  if (!camera || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (point.x < camera.destX || point.y < camera.destY
    || point.x > camera.destX + camera.destWidth || point.y > camera.destY + camera.destHeight) return null;
  return {
    x: camera.sourceX + (point.x - camera.destX) / camera.scale,
    y: camera.sourceY + (point.y - camera.destY) / camera.scale
  };
}

export function districtForPoint(x, y, districts = WORLD_DISTRICTS) {
  return districts.find((district) => x >= district.x && x <= district.x + district.width
    && y >= district.y && y <= district.y + district.height) ?? null;
}
