const MAP_COLUMNS = 32;
const MAP_ROWS = 24;
const CELL_SIZE = 64;
const WORLD_WIDTH = MAP_COLUMNS * CELL_SIZE;
const WORLD_HEIGHT = MAP_ROWS * CELL_SIZE;

const FIELD_ASSET_IDS = Object.freeze([
  'field.bridge_stone', 'field.bridge_wood', 'field.cliff', 'field.cobblestone',
  'field.dirt_path', 'field.dock_floor', 'field.fence_wood', 'field.grass',
  'field.plaza', 'field.river_edge', 'field.road_corner', 'field.road_edge',
  'field.road_intersection', 'field.rock', 'field.snow', 'field.stairs_stone',
  'field.tree', 'field.wall_stone', 'field.water'
]);

const BUILDING_ASSET_IDS = Object.freeze([
  'building.dock', 'building.dojo', 'building.gate', 'building.guild',
  'building.house.medium', 'building.house.small', 'building.hut', 'building.inn',
  'building.old_house', 'building.pub', 'building.ruin', 'building.shop',
  'building.town_hall', 'building.warehouse', 'building.watchtower',
  'building.well', 'building.workshop'
]);

const CHARACTER_ASSET_IDS = Object.freeze([
  'character.dock_ferryman', 'character.dojo_inspector', 'character.gatekeeper',
  'character.guildmaster', 'character.innkeeper', 'character.mob.artisan',
  'character.mob.child', 'character.mob.delivery_person', 'character.mob.dock_worker',
  'character.mob.elder', 'character.mob.inn_guest', 'character.mob.merchant',
  'character.mob.tavern_guest', 'character.mob.townsfolk_female',
  'character.mob.townsfolk_male', 'character.mob.traveler', 'character.player',
  'character.tavern_master', 'character.town_clerk', 'character.warehouse_keeper',
  'character.watchtower_guard', 'character.workshop_artisan'
]);

const OBJECT_ASSET_IDS = Object.freeze([
  'object.barrel', 'object.bench', 'object.blue_flag', 'object.construction_sign',
  'object.crate', 'object.flowerbed', 'object.grass_patch', 'object.lamp',
  'object.notice_board', 'object.red_flag', 'object.rubble', 'object.signboard',
  'object.stacked_crates', 'object.streetlight', 'object.unverified_tag',
  'object.warning_stake', 'object.well', 'object.yellow_flag'
]);

const EFFECT_ASSET_IDS = Object.freeze(['effect.construction_dust', 'effect.water_ripple']);

export const WORLD_DISTRICTS = Object.freeze([
  Object.freeze({ id: 'old_town', label: '旧市街', x: 0, y: 0, width: 16 * CELL_SIZE, height: 12 * CELL_SIZE }),
  Object.freeze({ id: 'snow_quarter', label: '雪地区', x: 16 * CELL_SIZE, y: 0, width: 16 * CELL_SIZE, height: 12 * CELL_SIZE }),
  Object.freeze({ id: 'harbor', label: '港', x: 0, y: 12 * CELL_SIZE, width: 16 * CELL_SIZE, height: 12 * CELL_SIZE }),
  Object.freeze({ id: 'woodland', label: '森林', x: 16 * CELL_SIZE, y: 12 * CELL_SIZE, width: 16 * CELL_SIZE, height: 12 * CELL_SIZE })
]);

function districtIdForCell(x, y) {
  if (y < 12) return x < 16 ? 'old_town' : 'snow_quarter';
  return x < 16 ? 'harbor' : 'woodland';
}

function cellKey(x, y) {
  return `${x},${y}`;
}

export function worldNodeIdAt(cellX, cellY) {
  return `n-${cellX}-${cellY}`;
}

function insideMap(x, y) {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && y >= 0 && x < MAP_COLUMNS && y < MAP_ROWS;
}

function makeGroundAndRoutes() {
  const ground = Array.from({ length: MAP_ROWS }, (_, y) => Array.from({ length: MAP_COLUMNS }, (_, x) => {
    if (x >= 16 && y < 12) return 'field.snow';
    if (x >= 16 && y >= 12) return 'field.grass';
    return y < 12 ? 'field.grass' : 'field.cobblestone';
  }));
  const walkable = new Set();
  const setGround = (x, y, assetId) => {
    if (insideMap(x, y)) ground[y][x] = assetId;
  };
  const fill = (left, top, right, bottom, assetId) => {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) setGround(x, y, assetId);
    }
  };
  const lineCells = (x1, y1, x2, y2) => {
    if (x1 !== x2 && y1 !== y2) throw new Error('World route lines must be four-directional');
    const cells = [];
    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);
    let x = x1;
    let y = y1;
    while (true) {
      cells.push([x, y]);
      if (x === x2 && y === y2) break;
      x += dx;
      y += dy;
    }
    return cells;
  };
  const route = (x1, y1, x2, y2, assetId) => {
    for (const [x, y] of lineCells(x1, y1, x2, y2)) {
      walkable.add(cellKey(x, y));
      setGround(x, y, assetId);
    }
  };

  // Civic wall, the elevated snow shelf, and the continuous river/harbor.
  fill(0, 0, 15, 0, 'field.wall_stone');
  fill(17, 7, 31, 7, 'field.cliff');
  fill(15, 8, 16, 23, 'field.water');
  fill(0, 19, 16, 23, 'field.water');
  fill(14, 8, 14, 18, 'field.river_edge');
  fill(17, 8, 17, 23, 'field.river_edge');
  fill(0, 18, 14, 18, 'field.river_edge');

  // The snow shelf has a built southern retaining wall, so the lower camera
  // view ends in masonry instead of an empty white rectangle.
  fill(18, 11, 31, 11, 'field.wall_stone');

  // Working harbor quay and pier. The pier remains walkable into the water.
  fill(1, 12, 13, 17, 'field.dock_floor');
  fill(5, 16, 9, 18, 'field.dock_floor');
  fill(7, 19, 9, 21, 'field.dock_floor');

  // Woodland perimeter and lived-in terrain details.
  fill(18, 23, 31, 23, 'field.tree');
  fill(31, 17, 31, 22, 'field.tree');
  for (const x of [22, 27]) fill(x, 12, x, 15, 'field.tree');
  fill(28, 18, 30, 21, 'field.tree');
  fill(22, 17, 30, 17, 'field.fence_wood');
  for (const [x, y] of [[22, 20], [23, 19], [28, 20], [30, 19]]) setGround(x, y, 'field.rock');

  // Old-town streets. Buildings face the two horizontal streets; the eastern
  // riverbank lane connects them without crossing a building footprint.
  route(6, 5, 14, 5, 'field.cobblestone');
  route(14, 5, 14, 10, 'field.cobblestone');
  route(2, 10, 14, 10, 'field.cobblestone');
  for (const x of [5, 6, 7]) {
    walkable.add(cellKey(x, 5));
    setGround(x, 5, 'field.plaza');
  }

  // The only route to the elevated snow district crosses the stone bridge and
  // climbs the cliff stair, making both actions part of the first long journey.
  route(14, 9, 20, 9, 'field.cobblestone');
  route(20, 5, 20, 9, 'field.cobblestone');
  route(20, 5, 29, 5, 'field.cobblestone');
  route(20, 9, 29, 9, 'field.cobblestone');
  setGround(15, 9, 'field.bridge_stone');
  setGround(16, 9, 'field.bridge_stone');
  setGround(20, 7, 'field.stairs_stone');

  // Old town descends into one continuous harbor street.
  route(0, 10, 2, 10, 'field.cobblestone');
  route(0, 10, 0, 16, 'field.cobblestone');
  route(0, 16, 14, 16, 'field.cobblestone');
  route(8, 16, 8, 20, 'field.dock_floor');

  // The wooden bridge joins the harbor to an organic woodland path. A lower
  // path reaches the hut and ruin without entering either footprint.
  route(14, 16, 14, 17, 'field.cobblestone');
  route(14, 17, 17, 17, 'field.dirt_path');
  route(17, 16, 30, 16, 'field.dirt_path');
  route(17, 16, 17, 22, 'field.dirt_path');
  route(17, 22, 26, 22, 'field.dirt_path');
  setGround(15, 17, 'field.bridge_wood');
  setGround(16, 17, 'field.bridge_wood');

  // Authored road joints break up the urban paving while preserving the same
  // four-directional route graph.
  for (const [x, y] of [[14, 5], [14, 10], [20, 9], [0, 10], [0, 16], [14, 16], [17, 16]]) {
    setGround(x, y, 'field.road_corner');
  }
  for (const [x, y] of [[14, 9], [17, 17]]) {
    setGround(x, y, 'field.road_intersection');
  }
  for (const [x, y] of [[13, 9], [17, 9], [0, 12], [0, 15]]) setGround(x, y, 'field.road_edge');

  return {
    ground: ground.map((row) => Object.freeze(row)),
    walkable: Object.freeze([...walkable].map((key) => key.split(',').map(Number))
      .sort((left, right) => left[1] - right[1] || left[0] - right[0])
      .map(([x, y]) => Object.freeze({ id: worldNodeIdAt(x, y), x, y })))
  };
}

const MAP_DATA = makeGroundAndRoutes();

export const WORLD_MAP = Object.freeze({
  columns: MAP_COLUMNS,
  rows: MAP_ROWS,
  cellSize: CELL_SIZE,
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  ground: Object.freeze(MAP_DATA.ground),
  walkable: MAP_DATA.walkable,
  districts: WORLD_DISTRICTS
});

export function groundAssetAt(x, y, map = WORLD_MAP) {
  return Number.isInteger(x) && Number.isInteger(y) ? map?.ground?.[y]?.[x] ?? null : null;
}

const WALKABLE_FIELD_IDS = new Set([
  'field.bridge_stone', 'field.bridge_wood', 'field.cobblestone', 'field.dirt_path',
  'field.dock_floor', 'field.plaza', 'field.road_corner', 'field.road_edge',
  'field.road_intersection', 'field.snow', 'field.stairs_stone'
]);
const BRIDGE_FIELD_IDS = new Set(['field.bridge_stone', 'field.bridge_wood']);
const BOUNDARY_FIELD_IDS = new Set(['field.cliff', 'field.wall_stone']);
const VARIED_FIELD_IDS = new Set(['field.grass', 'field.dirt_path', 'field.snow', 'field.cobblestone']);

export function groundTransformAt(x, y, map = WORLD_MAP) {
  const assetId = groundAssetAt(x, y, map);
  let quarterTurns = 0;
  if (assetId === 'field.river_edge') {
    if (groundAssetAt(x + 1, y, map) === 'field.water') quarterTurns = 3;
    else if (groundAssetAt(x - 1, y, map) === 'field.water') quarterTurns = 1;
    else if (groundAssetAt(x, y - 1, map) === 'field.water') quarterTurns = 2;
  } else if (assetId === 'field.road_edge') {
    const horizontal = WALKABLE_FIELD_IDS.has(groundAssetAt(x - 1, y, map))
      || WALKABLE_FIELD_IDS.has(groundAssetAt(x + 1, y, map));
    quarterTurns = horizontal ? 1 : 0;
  } else if (assetId === 'field.road_corner') {
    const right = WALKABLE_FIELD_IDS.has(groundAssetAt(x + 1, y, map));
    const down = WALKABLE_FIELD_IDS.has(groundAssetAt(x, y + 1, map));
    const left = WALKABLE_FIELD_IDS.has(groundAssetAt(x - 1, y, map));
    quarterTurns = right && down ? 0 : down && left ? 1 : left ? 2 : 3;
  } else if (VARIED_FIELD_IDS.has(assetId)) {
    quarterTurns = (x * 3 + y * 5) % 4 >= 2 ? 2 : 0;
  }
  const mayFlip = VARIED_FIELD_IDS.has(assetId)
    || ['field.plaza', 'field.rock', 'field.tree', 'field.water'].includes(assetId);
  return Object.freeze({ quarterTurns, flipX: mayFlip && ((x * 7 + y * 11) & 1) === 1 });
}

function structure(id, assetId, facilityKind, cellX, cellY, entranceX, entranceY, label, district, anchor = true) {
  const x = cellX * CELL_SIZE;
  const y = cellY * CELL_SIZE;
  return Object.freeze({
    id, assetId, facilityKind, label, district, anchor,
    x, y, width: 256, height: 256, baselineY: y + 240,
    entranceNodeId: worldNodeIdAt(entranceX, entranceY),
    entrance: Object.freeze({ x: entranceX, y: entranceY })
  });
}

export const WORLD_STRUCTURES = Object.freeze([
  structure('town-hall', 'building.town_hall', 'town_hall', 4, 1, 6, 5, '役場', 'old_town'),
  structure('guild-hall', 'building.guild', 'guild', 8, 1, 10, 5, '接続者ギルド', 'old_town'),
  structure('travelers-inn', 'building.inn', 'inn', 12, 1, 14, 5, '宿屋', 'old_town'),
  structure('old-town-gate', 'building.gate', 'gate', 0, 6, 2, 10, '門', 'old_town'),
  structure('tavern', 'building.pub', 'pub', 4, 6, 6, 10, '酒場', 'old_town'),
  structure('market-shop', 'building.shop', 'shop', 8, 6, 10, 10, '商店', 'old_town'),
  structure('training-dojo', 'building.dojo', 'dojo', 18, 1, 20, 5, '道場', 'snow_quarter'),
  structure('snow-residence', 'building.old_house', 'house', 22, 1, 24, 5, '雪地区の住居', 'snow_quarter', false),
  structure('snow-watchtower', 'building.watchtower', 'watchtower', 27, 1, 29, 5, '見張り台', 'snow_quarter'),
  structure('freight-warehouse', 'building.warehouse', 'warehouse', 1, 12, 3, 16, '倉庫', 'harbor'),
  structure('harbor-dock', 'building.dock', 'dock', 6, 12, 8, 16, '船着場', 'harbor'),
  structure('harbor-house', 'building.house.medium', 'house', 10, 12, 12, 16, '港の住居', 'harbor', false),
  structure('artisan-workshop', 'building.workshop', 'workshop', 18, 12, 20, 16, '工房', 'woodland'),
  structure('woodland-well', 'building.well', 'well', 23, 12, 25, 16, '井戸', 'woodland'),
  structure('woodland-home', 'building.house.small', 'house', 28, 12, 30, 16, '住宅', 'woodland'),
  structure('woodland-hut', 'building.hut', 'house', 18, 18, 20, 22, '森の小屋', 'woodland', false),
  structure('overgrown-ruin', 'building.ruin', 'ruin', 24, 18, 26, 22, '廃屋', 'woodland')
]);

function prop(assetId, x, y, context, options = {}) {
  return Object.freeze({ assetId, x, y, context, ...options });
}

export const WORLD_PROPS = Object.freeze([
  prop('object.barrel', 5, 17, 'harbor cargo'),
  prop('object.bench', 3, 5, 'civic plaza edge'),
  prop('object.blue_flag', 4, 5, 'town hall'),
  prop('object.construction_sign', 21, 17, 'workshop yard'),
  prop('object.crate', 10, 17, 'harbor cargo'),
  prop('object.flowerbed', 3, 5, 'old-town residence'),
  prop('object.grass_patch', 23, 17, 'woodland verge'),
  prop('object.lamp', 7, 11, 'tavern street'),
  prop('object.notice_board', 2, 5, 'civic information'),
  prop('object.red_flag', 19, 6, 'dojo marker'),
  prop('object.rubble', 28, 22, 'ruin debris'),
  prop('object.signboard', 3, 11, 'gate direction'),
  prop('object.stacked_crates', 4, 17, 'warehouse freight'),
  prop('object.streetlight', 11, 11, 'market street'),
  prop('object.unverified_tag', 27, 22, 'ruin status'),
  prop('object.warning_stake', 21, 8, 'snow cliff'),
  prop('object.well', 26, 17, 'well square'),
  prop('object.yellow_flag', 8, 0, 'guild banner'),

  // Repeated approved props make the world read as lived-in districts rather
  // than a sparse catalog. Every copy remains off the walkable centerline.
  prop('object.flowerbed', 0, 5, 'gate garden'),
  prop('object.grass_patch', 1, 5, 'gate verge'),
  prop('object.lamp', 3, 4, 'civic lane'),
  prop('object.streetlight', 11, 5, 'market frontage', { offsetX: 20 }),
  prop('object.barrel', 12, 6, 'inn delivery'),
  prop('object.crate', 13, 7, 'inn delivery'),
  prop('object.bench', 12, 11, 'riverside rest'),
  prop('object.notice_board', 1, 11, 'harbor notices'),
  prop('object.blue_flag', 18, 6, 'snow district boundary'),
  prop('object.lamp', 22, 6, 'snow stair lantern'),
  prop('object.bench', 25, 6, 'snow overlook'),
  prop('object.stacked_crates', 26, 6, 'watch supply'),
  prop('object.barrel', 30, 6, 'watch supply'),
  prop('object.rubble', 18, 8, 'cliff scree'),
  prop('object.warning_stake', 22, 8, 'cliff warning'),
  prop('object.crate', 2, 17, 'warehouse freight'),
  prop('object.barrel', 6, 17, 'dock freight'),
  prop('object.stacked_crates', 9, 17, 'dock freight'),
  prop('object.yellow_flag', 13, 15, 'harbor wayfinding'),
  prop('object.lamp', 13, 17, 'bridge lantern'),
  prop('object.construction_sign', 22, 18, 'workshop storage'),
  prop('object.grass_patch', 23, 18, 'forest undergrowth'),
  prop('object.flowerbed', 27, 17, 'home garden'),
  prop('object.bench', 29, 17, 'home garden'),
  prop('object.rubble', 22, 21, 'hut repair'),
  prop('object.warning_stake', 23, 21, 'ruin approach'),
  prop('object.red_flag', 28, 21, 'ruin warning'),
  prop('object.grass_patch', 29, 22, 'ruin overgrowth')
]);

function npc(assetId, x, y, role, facilityKind, district, direction = 'down', offsetX = 0) {
  return Object.freeze({ assetId, x, y, role, facilityKind, district, direction, offsetX });
}

export const WORLD_NPCS = Object.freeze([
  npc('character.town_clerk', 6, 5, '役場の案内係', 'town_hall', 'old_town', 'down', -12),
  npc('character.guildmaster', 10, 5, '接続者ギルド長', 'guild', 'old_town', 'down', -12),
  npc('character.innkeeper', 14, 5, '宿屋の主人', 'inn', 'old_town', 'down', -12),
  npc('character.gatekeeper', 2, 10, '門番', 'gate', 'old_town', 'right', -12),
  npc('character.tavern_master', 6, 10, '酒場の主人', 'pub', 'old_town', 'down', -12),
  npc('character.mob.tavern_guest', 6, 10, '酒場の客', 'pub', 'old_town', 'left', 12),
  npc('character.mob.merchant', 10, 10, '商人', 'shop', 'old_town', 'down', -12),
  npc('character.mob.townsfolk_female', 7, 5, '広場の住民', 'town_hall', 'old_town', 'left', 12),
  npc('character.mob.townsfolk_male', 3, 10, '旧市街の住民', 'gate', 'old_town', 'right', 12),
  npc('character.mob.inn_guest', 13, 5, '宿泊客', 'inn', 'old_town', 'right', 12),
  npc('character.dojo_inspector', 20, 5, '検査官', 'dojo', 'snow_quarter', 'down', -12),
  npc('character.mob.traveler', 24, 5, '雪道の旅人', 'house', 'snow_quarter', 'right', 12),
  npc('character.watchtower_guard', 29, 5, '見張り番', 'watchtower', 'snow_quarter', 'left', -12),
  npc('character.warehouse_keeper', 3, 16, '倉庫番', 'warehouse', 'harbor', 'down', -12),
  npc('character.mob.delivery_person', 3, 16, '配達人', 'warehouse', 'harbor', 'right', 12),
  npc('character.dock_ferryman', 8, 16, '渡し守', 'dock', 'harbor', 'down', -12),
  npc('character.mob.dock_worker', 8, 17, '港湾作業員', 'dock', 'harbor', 'left', 12),
  npc('character.workshop_artisan', 20, 16, '工房の職人', 'workshop', 'woodland', 'down', -12),
  npc('character.mob.artisan', 21, 16, '手伝い職人', 'workshop', 'woodland', 'left', 12),
  npc('character.mob.elder', 25, 16, '井戸端の長老', 'well', 'woodland', 'right', 12),
  npc('character.mob.child', 30, 16, '森の子ども', 'house', 'woodland', 'left', -12)
]);

export const WORLD_EFFECTS = Object.freeze([
  Object.freeze({ assetId: 'effect.water_ripple', x: 10, y: 20, context: 'water' }),
  Object.freeze({ assetId: 'effect.construction_dust', x: 28, y: 22, context: 'ruin', facilityKind: 'ruin' })
]);

function edgeTypeForCells(left, right) {
  const assets = [groundAssetAt(left.x, left.y), groundAssetAt(right.x, right.y)];
  if (assets.some((assetId) => BRIDGE_FIELD_IDS.has(assetId))) return 'bridge';
  if (assets.includes('field.stairs_stone')) return 'stairs';
  return 'walk';
}

function buildNavigationData(walkableCells) {
  const cells = new Map(walkableCells.map(({ x, y }) => [cellKey(x, y), { x, y }]));
  const edgeDefinitions = [];
  for (const cell of cells.values()) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const neighbor = cells.get(cellKey(cell.x + dx, cell.y + dy));
      if (!neighbor) continue;
      edgeDefinitions.push(Object.freeze({
        from: worldNodeIdAt(cell.x, cell.y),
        to: worldNodeIdAt(neighbor.x, neighbor.y),
        type: edgeTypeForCells(cell, neighbor)
      }));
    }
  }
  edgeDefinitions.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
  const neighbors = new Map([...cells.values()].map(({ x, y }) => [worldNodeIdAt(x, y), []]));
  for (const edge of edgeDefinitions) {
    neighbors.get(edge.from).push({ id: edge.to, type: edge.type });
    neighbors.get(edge.to).push({ id: edge.from, type: edge.type });
  }
  const nodes = [...cells.values()].sort((left, right) => left.y - right.y || left.x - right.x).map(({ x, y }) => {
    const links = neighbors.get(worldNodeIdAt(x, y)).sort((left, right) => left.id.localeCompare(right.id));
    return Object.freeze({
      id: worldNodeIdAt(x, y),
      cellX: x,
      cellY: y,
      x: x * CELL_SIZE + CELL_SIZE / 2,
      y: y * CELL_SIZE + 52,
      district: districtIdForCell(x, y),
      groundAssetId: groundAssetAt(x, y),
      neighbors: Object.freeze(links.map((link) => link.id)),
      links: Object.freeze(links.map((link) => Object.freeze(link)))
    });
  });
  return { nodes: Object.freeze(nodes), edges: Object.freeze(edgeDefinitions) };
}

const NAVIGATION_DATA = buildNavigationData(WORLD_MAP.walkable);
export const NAVIGATION_NODES = NAVIGATION_DATA.nodes;
export const NAVIGATION_EDGES = NAVIGATION_DATA.edges;
export const PLAYER_START_NODE_ID = worldNodeIdAt(7, 5);

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

const DIRECTION_VECTORS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 })
});

export function nextNodeForDirection(currentId, direction, nodes = NAVIGATION_NODES) {
  const current = navigationNodeById(currentId, nodes);
  const vector = DIRECTION_VECTORS[direction];
  if (!current || !vector) return current;
  const candidates = current.links.map((link) => navigationNodeById(link.id, nodes)).filter(Boolean)
    .map((node) => {
      const dx = node.x - current.x;
      const dy = node.y - current.y;
      const distance = Math.hypot(dx, dy);
      const dot = distance > 0 ? ((dx / distance) * vector.x) + ((dy / distance) * vector.y) : -1;
      return { node, dot, distance };
    })
    .filter((candidate) => candidate.dot > 0)
    .sort((left, right) => right.dot - left.dot || left.distance - right.distance
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

const ANCHOR_STRUCTURE_IDS = Object.freeze({
  town_hall: 'town-hall', gate: 'old-town-gate', guild: 'guild-hall',
  pub: 'tavern', shop: 'market-shop', inn: 'travelers-inn', dock: 'harbor-dock',
  dojo: 'training-dojo', well: 'woodland-well', workshop: 'artisan-workshop',
  warehouse: 'freight-warehouse', watchtower: 'snow-watchtower',
  house: 'woodland-home', ruin: 'overgrown-ruin'
});

export const FACILITY_ANCHORS = Object.freeze(Object.fromEntries(Object.entries(ANCHOR_STRUCTURE_IDS).map(([kind, structureId]) => {
  const building = WORLD_STRUCTURES.find((entry) => entry.id === structureId);
  const node = navigationNodeById(building?.entranceNodeId);
  if (!building || !node) throw new Error(`Facility anchor is not on a world route: ${kind}`);
  return [kind, Object.freeze({
    kind,
    label: building.label,
    x: node.x,
    y: node.y,
    cellX: node.cellX,
    cellY: node.cellY,
    district: building.district,
    nodeId: node.id,
    structureId: building.id
  })];
})));

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

export function worldRenderLayers({
  view = 'overview',
  interactionStarted = false,
  hasPlayerAsset = false,
  hoveredAnchor = null,
  selectedAnchor = null,
  nearbyAnchor = null
} = {}) {
  void interactionStarted;
  const anchors = [hoveredAnchor, selectedAnchor, nearbyAnchor].filter(Boolean)
    .filter((anchor, index, list) => list.findIndex((item) => item.kind === anchor.kind) === index);
  return Object.freeze({
    drawPlayer: hasPlayerAsset && (view === 'overview' || view === 'world'),
    anchors: Object.freeze(anchors)
  });
}

function positiveViewport(value) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function computeWorldCamera({
  mode = 'overview',
  viewportWidth,
  viewportHeight,
  focusX = WORLD_WIDTH / 2,
  focusY = WORLD_HEIGHT / 2,
  worldWidth = WORLD_WIDTH,
  worldHeight = WORLD_HEIGHT
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
  const sourceWidth = Math.min(safeWorldWidth, width);
  const sourceHeight = Math.min(safeWorldHeight, height);
  const sourceX = Math.max(0, Math.min(safeWorldWidth - sourceWidth, focusX - sourceWidth / 2));
  const sourceY = Math.max(0, Math.min(safeWorldHeight - sourceHeight, focusY - sourceHeight / 2));
  return {
    mode: 'follow', scale, sourceX, sourceY, sourceWidth, sourceHeight,
    destX: (width - sourceWidth) / 2, destY: (height - sourceHeight) / 2,
    destWidth: sourceWidth, destHeight: sourceHeight,
    viewportWidth: width, viewportHeight: height
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
  return districts.find((district) => x >= district.x && x < district.x + district.width
    && y >= district.y && y < district.y + district.height) ?? null;
}

export function collectWorldAssetUsage() {
  const used = new Set(['character.player']);
  for (const row of WORLD_MAP.ground) for (const assetId of row) used.add(assetId);
  for (const entry of WORLD_STRUCTURES) used.add(entry.assetId);
  for (const entry of WORLD_PROPS) used.add(entry.assetId);
  for (const entry of WORLD_NPCS) used.add(entry.assetId);
  for (const entry of WORLD_EFFECTS) used.add(entry.assetId);
  return Object.freeze([...used].sort());
}

function overlapping(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

export function auditWorldMap() {
  const issues = [];
  if (WORLD_MAP.columns !== 32 || WORLD_MAP.rows !== 24 || WORLD_MAP.cellSize !== 64
    || WORLD_MAP.width !== 2048 || WORLD_MAP.height !== 1536) issues.push('world dimensions must be 32x24 at 64px');
  if (WORLD_MAP.ground.length !== 24 || WORLD_MAP.ground.some((row) => row.length !== 32)) {
    issues.push('world ground must be a complete 32x24 grid');
  }
  const groundIds = new Set(WORLD_MAP.ground.flat());
  if (FIELD_ASSET_IDS.some((assetId) => !groundIds.has(assetId)) || groundIds.size !== FIELD_ASSET_IDS.length) {
    issues.push('world ground must use exactly all 19 approved field assets');
  }
  if (!navigationIsConnected()) issues.push('world navigation must be one connected component');
  for (const node of NAVIGATION_NODES) {
    if (!insideMap(node.cellX, node.cellY) || !WALKABLE_FIELD_IDS.has(node.groundAssetId)) {
      issues.push(`navigation node ${node.id} is not on a visible walkable field`);
    }
  }
  for (const edge of NAVIGATION_EDGES) {
    const from = navigationNodeById(edge.from);
    const to = navigationNodeById(edge.to);
    if (!from || !to || Math.abs(from.cellX - to.cellX) + Math.abs(from.cellY - to.cellY) !== 1) {
      issues.push(`navigation edge ${edge.from} -> ${edge.to} is not four-directional`);
    }
    if (!['walk', 'bridge', 'stairs'].includes(edge.type)) issues.push(`navigation edge ${edge.from} -> ${edge.to} has an unknown type`);
  }
  if (WORLD_STRUCTURES.length !== 17 || new Set(WORLD_STRUCTURES.map((entry) => entry.assetId)).size !== 17
    || BUILDING_ASSET_IDS.some((assetId) => !WORLD_STRUCTURES.some((entry) => entry.assetId === assetId))) {
    issues.push('world structures must use exactly all 17 approved buildings');
  }
  for (let index = 0; index < WORLD_STRUCTURES.length; index += 1) {
    const building = WORLD_STRUCTURES[index];
    if (building.width !== 256 || building.height !== 256 || building.x < 0 || building.y < 0
      || building.x + building.width > WORLD_WIDTH || building.y + building.height > WORLD_HEIGHT) {
      issues.push(`${building.id} violates the native 256px world contract`);
    }
    if (!navigationNodeById(building.entranceNodeId)) issues.push(`${building.id} entrance is not on the navigation graph`);
    for (const other of WORLD_STRUCTURES.slice(index + 1)) {
      if (overlapping(building, other)) issues.push(`${building.id} overlaps ${other.id}`);
    }
  }
  if (Object.keys(FACILITY_ANCHORS).length !== 14) issues.push('world must expose exactly 14 facility anchors');
  for (const anchor of Object.values(FACILITY_ANCHORS)) {
    if (shortestNavigationPath(PLAYER_START_NODE_ID, anchor.nodeId).length === 0) {
      issues.push(`${anchor.kind} is unreachable from the player start`);
    }
  }
  for (const bridgeId of BRIDGE_FIELD_IDS) {
    for (let y = 0; y < MAP_ROWS; y += 1) for (let x = 0; x < MAP_COLUMNS; x += 1) {
      if (groundAssetAt(x, y) !== bridgeId) continue;
      const crossesWater = groundAssetAt(x, y - 1) === 'field.water' && groundAssetAt(x, y + 1) === 'field.water';
      if (!crossesWater) issues.push(`${bridgeId} at ${x},${y} does not cross the waterway`);
    }
  }
  for (let y = 0; y < MAP_ROWS; y += 1) for (let x = 0; x < MAP_COLUMNS; x += 1) {
    if (groundAssetAt(x, y) !== 'field.stairs_stone') continue;
    const neighbors = [groundAssetAt(x - 1, y), groundAssetAt(x + 1, y), groundAssetAt(x, y - 1), groundAssetAt(x, y + 1)];
    if (!neighbors.some((assetId) => BOUNDARY_FIELD_IDS.has(assetId))) issues.push(`stairs at ${x},${y} do not meet a cliff or wall`);
  }
  const dojoPath = shortestNavigationPath(PLAYER_START_NODE_ID, FACILITY_ANCHORS.dojo.nodeId);
  const journeyTypes = dojoPath.slice(1).map((node, index) => navigationEdgeBetween(dojoPath[index].id, node.id)?.type);
  if (!journeyTypes.includes('bridge') || !journeyTypes.includes('stairs')) {
    issues.push('the first journey to the snow dojo must cross a bridge and stairs');
  }
  if (WORLD_PROPS.length < 18 || new Set(WORLD_PROPS.map((entry) => entry.assetId)).size !== 18
    || OBJECT_ASSET_IDS.some((assetId) => !WORLD_PROPS.some((entry) => entry.assetId === assetId))) {
    issues.push('world props must use only and at least once all 18 approved objects');
  }
  if (WORLD_NPCS.length !== 21 || new Set(WORLD_NPCS.map((entry) => entry.assetId)).size !== 21
    || CHARACTER_ASSET_IDS.filter((assetId) => assetId !== 'character.player')
      .some((assetId) => !WORLD_NPCS.some((entry) => entry.assetId === assetId))) {
    issues.push('world NPCs must use exactly all 21 non-player characters');
  }
  for (const entry of [...WORLD_PROPS, ...WORLD_NPCS, ...WORLD_EFFECTS]) {
    if (!insideMap(entry.x, entry.y)) issues.push(`${entry.assetId} is outside the world`);
  }
  const waterRipple = WORLD_EFFECTS.find((entry) => entry.assetId === 'effect.water_ripple');
  const dust = WORLD_EFFECTS.find((entry) => entry.assetId === 'effect.construction_dust');
  if (!waterRipple || groundAssetAt(waterRipple.x, waterRipple.y) !== 'field.water' || waterRipple.context !== 'water') {
    issues.push('water ripple must animate on water');
  }
  if (!dust || !['repair', 'ruin'].includes(dust.context)) issues.push('construction dust must belong to repair or ruin work');
  const usage = collectWorldAssetUsage();
  const expectedUsage = [...BUILDING_ASSET_IDS, ...CHARACTER_ASSET_IDS, ...EFFECT_ASSET_IDS, ...FIELD_ASSET_IDS, ...OBJECT_ASSET_IDS].sort();
  if (usage.length !== 78 || usage.some((assetId, index) => assetId !== expectedUsage[index])) {
    issues.push('world render data must use exactly the approved 78 assets');
  }
  return Object.freeze({
    ok: issues.length === 0,
    issues: Object.freeze(issues),
    usage,
    counts: Object.freeze({
      fields: groundIds.size,
      structures: WORLD_STRUCTURES.length,
      npcs: WORLD_NPCS.length + 1,
      props: WORLD_PROPS.length,
      effects: WORLD_EFFECTS.length,
      navigationNodes: NAVIGATION_NODES.length,
      navigationEdges: NAVIGATION_EDGES.length
    })
  });
}
