// src/town/validator.mjs
//
// The layout self-check ("役場検査"): validateLayout(layout) turns one
// generated TownLayout (see ./schema.mjs) into a TownLayoutValidation verdict.
// This is the ONLY gate a generated layout must clear before the pipeline
// adopts it — generation is "done" only once validateLayout(layout).ok === true.
// An LLM is deliberately never allowed to place the town at request time so that
// this check can stay a small, reproducible piece of arithmetic over plain data:
// the same layout in => the identical verdict out, forever, on any machine.
//
// PURE, SYNCHRONOUS, DETERMINISTIC, READ-ONLY. No I/O, no Date.now / new Date() /
// Math.random, and no randomness of any kind — a validator only re-checks
// invariants over data that already exists, so there is nothing to seed. It never
// mutates its `layout` argument. Every issue list is sorted by (code, message,
// severity) with a plain code-unit comparator (never localeCompare, which is
// ICU/locale-dependent) before it is returned, so two calls against structurally
// identical input always produce byte-identical output regardless of Set/Map
// iteration order or the order entities happened to be listed in.
//
// GROUNDING. `walkable`, `importantBuildingsReachable`, and `noOverlap` are
// implemented exactly as the FROZEN TownLayoutValidation JSDoc in ./schema.mjs
// defines them: `walkable` = "every road cell is walkable and the roads form a
// connected network" and `importantBuildingsReachable` = "every required
// facility's entrance is reachable via roads when a gate exists — i.e. as a graph over
// TownRoad.fromBuildingId <-> TownRoad.toBuildingId edges, NOT a raw terrain
// flood-fill. `noOverlap` = "no two building footprints overlap, and no footprint
// sits on a blocked tile"; "blocked tile" here means a NATURAL obstacle
// (water / rock / tree / cliff — 'cliff' being the non-walkable rim of a raised
// plateau), never 'wall' (a building's own shell) or 'floor' (its own interior),
// which a footprint legitimately covers.
//
// Every check maps to exactly one issue code (STRUCTURE, NO_OVERLAP, ENTRANCE_CLEAR,
// WALKABLE, REACHABLE, DOCK_ON_WATER, DENSITY_SPARSE / DENSITY_CRAMPED,
// NPC_NOT_IN_WALL, and the terrain-feature codes BRIDGE_SPANS_WATER /
// STAIRS_CONNECT_ELEVATION). `ok` is false whenever any issue has severity
// 'error'. A missing gate is an honest uninhabitable-repository state rather
// than malformed generated geometry: it leaves importantBuildingsReachable
// false and records a warning, while an existing-but-disconnected gate remains
// an error and therefore cannot be adopted.
//
// DEFENSIVE BY CONSTRUCTION. A malformed / partial TownLayout (missing map,
// non-array buildings, NaN coordinates, a null layout, ...) never throws: each
// unreadable field degrades to a concrete, honest issue instead. An unreadable
// layout is never a passing one.

import {
  BUILDING_STATES, DIRECTIONS, FACILITY_KINDS, NPC_ROLES, PROP_KINDS,
  TILE_TYPES, WALKABLE_TILE_TYPES, deepFreeze
} from './schema.mjs';

/** @typedef {import('./schema.mjs').TownLayout} TownLayout */
/** @typedef {import('./schema.mjs').TownLayoutValidation} TownLayoutValidation */

// The town-redesign issue's "main facility" kinds: whichever of these have a
// building in the layout must be mutually road-connected (WALKABLE) and reachable
// from the gate (REACHABLE). `gate` is deliberately excluded — it is the anchor
// REACHABLE measures FROM, never a target. `town_hall` is always placed, so there
// is always at least one main facility for the gate to reach.
const MAIN_FACILITY_KINDS = ['inn', 'pub', 'town_hall', 'workshop', 'dojo', 'dock', 'watchtower'];

// Tiles a building footprint may NEVER cover. Per ./schema.mjs's TILE_TYPES doc,
// 'wall' is a building's own shell and 'floor' its own interior, so a footprint
// legitimately sits on those; grass / dirt / path / road / sand / bridge /
// stairs / plaza are harmless walkable ground a footprint may render over. It is
// specifically the natural obstacles below — including 'water' (the waterway a
// 'bridge' crosses) and 'cliff' (the non-walkable rim of a raised plateau) — that
// no building can be built on top of ("no footprint sits on a blocked tile", per
// the frozen noOverlap contract). Because 'water' and 'cliff' are also absent
// from WALKABLE_TILE_TYPES, an entrance or NPC landing on one is already caught
// by ENTRANCE_CLEAR / NPC_NOT_IN_WALL; listing them here additionally forbids a
// footprint from covering them.
const NATURAL_OBSTACLE_TILES = new Set(['water', 'rock', 'tree', 'cliff']);

const WALKABLE_TILE_SET = new Set(WALKABLE_TILE_TYPES);
const TILE_TYPE_SET = new Set(TILE_TYPES);
const FACILITY_KIND_SET = new Set(FACILITY_KINDS);
const BUILDING_STATE_SET = new Set(BUILDING_STATES);
const DIRECTION_SET = new Set(DIRECTIONS);
const NPC_ROLE_SET = new Set(NPC_ROLES);
const PROP_KIND_SET = new Set(PROP_KINDS);

// Tiles an NPC may stand on: every walkable tile EXCEPT 'floor'. A 'floor' tile
// is a building interior (see TILE_TYPES), and NPC_NOT_IN_WALL forbids "a
// wall / building-interior / water / cliff tile" (and any other non-walkable
// tile) — i.e. everything except genuine outdoor ground and the walkable road
// network, which now also includes 'bridge' and 'stairs'.
const NPC_STANDABLE_TILE_SET = new Set(WALKABLE_TILE_TYPES.filter((tile) => tile !== 'floor'));

// Advisory footprint-coverage band for DENSITY. Below the floor the town reads as
// an empty field for its map size; above the ceiling buildings crowd out every
// road and plaza. This is a permissive design-sanity band, NOT a hard spatial
// invariant, so a violation is a 'warning' and can never flip `ok` to false —
// tune freely once real generator output exists.
const DENSITY_MIN = 0.03;
const DENSITY_MAX = 0.6;

// --- generic, defensive helpers ---------------------------------------------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

/** @returns {{ code: string, message: string, severity: 'error' | 'warning' }} */
function issue(code, message, severity) {
  return { code, message, severity };
}

/** Stable, regeneration-safe display id for a message; never throws on malformed input. */
function idOf(entity) {
  return typeof entity?.id === 'string' && entity.id ? entity.id : '(unknown)';
}

/** Plain, locale-independent string order (never localeCompare). */
function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// --- terrain-grid helpers ----------------------------------------------------

/** Normalize layout.map into an always-usable shape (0x0 when missing/malformed). */
function mapDims(layout) {
  const map = isPlainObject(layout?.map) ? layout.map : {};
  const widthTiles = Number.isInteger(map.widthTiles) && map.widthTiles > 0 ? map.widthTiles : 0;
  const heightTiles = Number.isInteger(map.heightTiles) && map.heightTiles > 0 ? map.heightTiles : 0;
  const terrain = Array.isArray(map.terrain) ? map.terrain : [];
  return { widthTiles, heightTiles, terrain };
}

function inBounds(dims, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < dims.widthTiles && y < dims.heightTiles;
}

/** terrain[y][x], or undefined when out of bounds / malformed — never throws. */
function terrainAt(dims, x, y) {
  if (!inBounds(dims, x, y)) return undefined;
  const row = dims.terrain[y];
  return Array.isArray(row) ? row[x] : undefined;
}

function isWalkableAt(dims, x, y) {
  const tile = terrainAt(dims, x, y);
  return typeof tile === 'string' && WALKABLE_TILE_SET.has(tile);
}

function checkStructure(layout, dims) {
  const issues = [];
  if (!isPlainObject(layout) || !isPlainObject(layout.map)) {
    issues.push(issue('STRUCTURE', 'layout and layout.map must be objects.', 'error'));
    return issues;
  }
  if (typeof layout.townId !== 'string' || layout.townId.length === 0) {
    issues.push(issue('STRUCTURE', 'layout.townId must be a nonempty string.', 'error'));
  }
  if (typeof layout.repoFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(layout.repoFingerprint)) {
    issues.push(issue('STRUCTURE', 'layout.repoFingerprint must be a 64-character lowercase SHA-256 digest.', 'error'));
  }
  if (typeof layout.generatorVersion !== 'string' || layout.generatorVersion.length === 0) {
    issues.push(issue('STRUCTURE', 'layout.generatorVersion must be a nonempty string.', 'error'));
  }
  if (typeof layout.seed !== 'string') {
    issues.push(issue('STRUCTURE', 'layout.seed must be a string.', 'error'));
  }
  if (dims.widthTiles === 0 || dims.heightTiles === 0 || !Number.isInteger(layout.map.tileSize) || layout.map.tileSize <= 0) {
    issues.push(issue('STRUCTURE', 'map dimensions and tileSize must be positive integers.', 'error'));
  }
  if (dims.terrain.length !== dims.heightTiles) {
    issues.push(issue('STRUCTURE', 'terrain row count must equal map.heightTiles.', 'error'));
  }
  for (let y = 0; y < dims.heightTiles; y += 1) {
    const row = dims.terrain[y];
    if (!Array.isArray(row) || row.length !== dims.widthTiles) {
      issues.push(issue('STRUCTURE', `terrain row ${y} must contain exactly map.widthTiles cells.`, 'error'));
      continue;
    }
    for (let x = 0; x < dims.widthTiles; x += 1) {
      if (!TILE_TYPE_SET.has(row[x])) {
        issues.push(issue('STRUCTURE', `terrain cell (${x},${y}) has an unsupported tile type.`, 'error'));
      }
    }
  }
  for (const field of ['districts', 'buildings', 'roads', 'npcs', 'props', 'connections']) {
    if (!Array.isArray(layout[field])) issues.push(issue('STRUCTURE', `layout.${field} must be an array.`, 'error'));
  }
  const idFields = ['districts', 'buildings', 'roads', 'npcs', 'props'];
  for (const field of idFields) {
    if (!Array.isArray(layout[field])) continue;
    const seen = new Set();
    for (let index = 0; index < layout[field].length; index += 1) {
      const entity = layout[field][index];
      if (!isPlainObject(entity)) {
        issues.push(issue('STRUCTURE', `layout.${field}[${index}] must be an object.`, 'error'));
        continue;
      }
      if (typeof entity.id !== 'string' || entity.id.length === 0) {
        issues.push(issue('STRUCTURE', `layout.${field}[${index}].id must be a nonempty string.`, 'error'));
      } else if (seen.has(entity.id)) {
        issues.push(issue('STRUCTURE', `layout.${field} contains duplicate id "${entity.id}".`, 'error'));
      } else {
        seen.add(entity.id);
      }
    }
  }
  for (const [index, building] of (Array.isArray(layout.buildings) ? layout.buildings : []).entries()) {
    if (!isPlainObject(building)) continue;
    const footprint = building.footprint;
    const entrance = building.entrance;
    if (!FACILITY_KIND_SET.has(building.facilityKind) || !BUILDING_STATE_SET.has(building.state)
      || !Number.isInteger(building.x) || !Number.isInteger(building.y)
      || !isPlainObject(footprint) || !Number.isInteger(footprint.widthTiles) || footprint.widthTiles <= 0
      || !Number.isInteger(footprint.heightTiles) || footprint.heightTiles <= 0
      || !isPlainObject(entrance) || !Number.isInteger(entrance.x) || !Number.isInteger(entrance.y)
      || !DIRECTION_SET.has(entrance.direction)) {
      issues.push(issue('STRUCTURE', `layout.buildings[${index}] does not match the TownBuilding contract.`, 'error'));
    }
  }
  for (const [index, road] of (Array.isArray(layout.roads) ? layout.roads : []).entries()) {
    if (!isPlainObject(road)) continue;
    if (typeof road.fromBuildingId !== 'string' || road.fromBuildingId.length === 0
      || typeof road.toBuildingId !== 'string' || road.toBuildingId.length === 0
      || !Array.isArray(road.tiles) || road.tiles.length === 0
      || road.tiles.some((tile) => !Array.isArray(tile) || tile.length !== 2 || !tile.every(Number.isInteger))) {
      issues.push(issue('STRUCTURE', `layout.roads[${index}] does not match the TownRoad contract.`, 'error'));
    }
  }
  for (const [index, npc] of (Array.isArray(layout.npcs) ? layout.npcs : []).entries()) {
    if (!isPlainObject(npc)) continue;
    if (!NPC_ROLE_SET.has(npc.role) || !Number.isInteger(npc.x) || !Number.isInteger(npc.y) || !DIRECTION_SET.has(npc.facing)) {
      issues.push(issue('STRUCTURE', `layout.npcs[${index}] does not match the TownNpc contract.`, 'error'));
    }
  }
  for (const [index, prop] of (Array.isArray(layout.props) ? layout.props : []).entries()) {
    if (!isPlainObject(prop)) continue;
    if (!PROP_KIND_SET.has(prop.kind) || !Number.isInteger(prop.x) || !Number.isInteger(prop.y)) {
      issues.push(issue('STRUCTURE', `layout.props[${index}] does not match the TownProp contract.`, 'error'));
    }
  }
  for (const [index, district] of (Array.isArray(layout.districts) ? layout.districts : []).entries()) {
    if (!isPlainObject(district)) continue;
    if (typeof district.kind !== 'string' || district.kind.length === 0
      || !Number.isInteger(district.x) || !Number.isInteger(district.y)
      || !Number.isInteger(district.widthTiles) || district.widthTiles <= 0
      || !Number.isInteger(district.heightTiles) || district.heightTiles <= 0) {
      issues.push(issue('STRUCTURE', `layout.districts[${index}] does not match the TownDistrict contract.`, 'error'));
    }
  }
  for (const [index, connection] of (Array.isArray(layout.connections) ? layout.connections : []).entries()) {
    if (!isPlainObject(connection) || !['from', 'to', 'kind'].every((field) => typeof connection[field] === 'string' && connection[field].length > 0)) {
      issues.push(issue('STRUCTURE', `layout.connections[${index}] does not match the TownConnection contract.`, 'error'));
    }
  }
  return issues;
}

/** The first natural-obstacle cell under a footprint rectangle, or null. */
function firstObstacleUnder(rect, dims) {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const tile = terrainAt(dims, x, y);
      if (typeof tile === 'string' && NATURAL_OBSTACLE_TILES.has(tile)) return { tile, x, y };
    }
  }
  return null;
}

/**
 * Every in-bounds terrain cell equal to `type`, in row-major (y, then x) order —
 * deterministic with no further sort. Reads through terrainAt, so a malformed or
 * ragged grid degrades to "no such tiles" instead of throwing.
 * @returns {Array<{ x: number, y: number }>}
 */
function tilesOfType(dims, type) {
  const out = [];
  for (let y = 0; y < dims.heightTiles; y++) {
    for (let x = 0; x < dims.widthTiles; x++) {
      if (terrainAt(dims, x, y) === type) out.push({ x, y });
    }
  }
  return out;
}

// --- building-geometry helpers ------------------------------------------------

/** @returns {{ x: number, y: number, width: number, height: number }} width/height are 0 when the footprint is malformed. */
function buildingRect(building) {
  const footprint = isPlainObject(building?.footprint) ? building.footprint : {};
  const width = Number.isInteger(footprint.widthTiles) && footprint.widthTiles > 0 ? footprint.widthTiles : 0;
  const height = Number.isInteger(footprint.heightTiles) && footprint.heightTiles > 0 ? footprint.heightTiles : 0;
  const x = Number.isInteger(building?.x) ? building.x : NaN;
  const y = Number.isInteger(building?.y) ? building.y : NaN;
  return { x, y, width, height };
}

function rectValid(rect) {
  return Number.isInteger(rect.x) && Number.isInteger(rect.y) && rect.width > 0 && rect.height > 0;
}

/** Half-open AABB overlap: rectangles touching only at an edge/corner do NOT overlap. */
function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function pointInRect(rect, x, y) {
  return rectValid(rect) && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

// --- road-graph helpers (shared by WALKABLE connectivity and REACHABLE) ------

/**
 * Undirected building-id adjacency, one edge per TownRoad. An edge is added only
 * when BOTH endpoints resolve to a real building in `buildingById`; a road with a
 * dangling reference is reported separately (see checkRoadTiles) and left out of
 * the graph so connectivity never reasons over a ghost node.
 * @returns {Map<string, Set<string>>}
 */
function buildRoadAdjacency(roads, buildingById) {
  const adjacency = new Map();
  const link = (from, to) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };
  for (const road of roads) {
    const from = road.fromBuildingId;
    const to = road.toBuildingId;
    if (typeof from === 'string' && typeof to === 'string' && buildingById.has(from) && buildingById.has(to)) {
      link(from, to);
      link(to, from);
    }
  }
  return adjacency;
}

/** Iterative BFS; returns the Set of building ids reachable from startId (startId included). */
function bfsReachable(adjacency, startId) {
  const visited = new Set();
  if (typeof startId !== 'string' || !startId) return visited;
  visited.add(startId);
  const queue = [startId];
  for (let head = 0; head < queue.length; head++) {
    for (const next of adjacency.get(queue[head]) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

/** Present main-facility buildings, sorted by id so the connectivity anchor is order-independent. */
function mainFacilities(buildings) {
  return buildings
    .filter((building) => MAIN_FACILITY_KINDS.includes(building.facilityKind) && typeof building.id === 'string' && building.id)
    .sort((a, b) => compareStrings(a.id, b.id));
}

// --- per-invariant checks -----------------------------------------------------
// Each returns an Array<{ code, message, severity }>; none mutate their inputs.
// `buildings` and `rects` are index-aligned (rects[i] === buildingRect(buildings[i])).

/**
 * NO_OVERLAP: every footprint is a well-formed rectangle inside the map, no
 * footprint cell covers a natural obstacle (water / rock / tree), and no two
 * footprints overlap.
 */
function checkNoOverlap(buildings, rects, dims) {
  const issues = [];

  for (let i = 0; i < buildings.length; i++) {
    const id = idOf(buildings[i]);
    const rect = rects[i];
    if (!rectValid(rect)) {
      issues.push(issue('NO_OVERLAP', `building "${id}" has an invalid or missing footprint.`, 'error'));
      continue;
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > dims.widthTiles || rect.y + rect.height > dims.heightTiles) {
      issues.push(issue(
        'NO_OVERLAP',
        `building "${id}" footprint at (${rect.x},${rect.y}) sized ${rect.width}x${rect.height} falls outside the ${dims.widthTiles}x${dims.heightTiles} map.`,
        'error'
      ));
      continue;
    }
    const obstacle = firstObstacleUnder(rect, dims);
    if (obstacle) {
      issues.push(issue(
        'NO_OVERLAP',
        `building "${id}" footprint covers a natural-obstacle "${obstacle.tile}" tile at (${obstacle.x},${obstacle.y}).`,
        'error'
      ));
    }
  }

  for (let i = 0; i < rects.length; i++) {
    if (!rectValid(rects[i])) continue;
    for (let j = i + 1; j < rects.length; j++) {
      if (!rectValid(rects[j])) continue;
      if (rectsOverlap(rects[i], rects[j])) {
        const pair = [idOf(buildings[i]), idOf(buildings[j])].sort(compareStrings);
        issues.push(issue('NO_OVERLAP', `buildings "${pair[0]}" and "${pair[1]}" have overlapping footprints.`, 'error'));
      }
    }
  }

  return issues;
}

/**
 * ENTRANCE_CLEAR: every building's entrance tile is in bounds, walkable, not
 * covered by any building footprint (even the building's own — the entrance must
 * be just OUTSIDE it), and not covered by a prop.
 */
function checkEntranceClear(buildings, rects, props, dims) {
  const issues = [];
  const propTiles = new Set();
  for (const prop of props) {
    if (Number.isInteger(prop.x) && Number.isInteger(prop.y)) propTiles.add(`${prop.x},${prop.y}`);
  }

  for (let buildingIndex = 0; buildingIndex < buildings.length; buildingIndex += 1) {
    const building = buildings[buildingIndex];
    const id = idOf(building);
    const entrance = isPlainObject(building.entrance) ? building.entrance : null;
    if (!entrance || !Number.isInteger(entrance.x) || !Number.isInteger(entrance.y)) {
      issues.push(issue('ENTRANCE_CLEAR', `building "${id}" has an invalid or missing entrance coordinate.`, 'error'));
      continue;
    }
    const { x, y } = entrance;
    const rect = rects[buildingIndex];
    const onNamedSide = rectValid(rect) && (
      (entrance.direction === 'up' && y === rect.y - 1 && x >= rect.x && x < rect.x + rect.width)
      || (entrance.direction === 'down' && y === rect.y + rect.height && x >= rect.x && x < rect.x + rect.width)
      || (entrance.direction === 'left' && x === rect.x - 1 && y >= rect.y && y < rect.y + rect.height)
      || (entrance.direction === 'right' && x === rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)
    );
    if (!onNamedSide) {
      issues.push(issue(
        'ENTRANCE_CLEAR',
        `building "${id}" entrance (${x},${y}) is not immediately outside the footprint on its "${entrance.direction}" side.`,
        'error'
      ));
    }
    if (!inBounds(dims, x, y)) {
      issues.push(issue('ENTRANCE_CLEAR', `building "${id}" entrance (${x},${y}) is outside the ${dims.widthTiles}x${dims.heightTiles} map.`, 'error'));
      continue;
    }
    if (!isWalkableAt(dims, x, y)) {
      issues.push(issue('ENTRANCE_CLEAR', `building "${id}" entrance (${x},${y}) sits on non-walkable "${terrainAt(dims, x, y)}" terrain.`, 'error'));
    }
    for (let i = 0; i < rects.length; i++) {
      if (pointInRect(rects[i], x, y)) {
        issues.push(issue('ENTRANCE_CLEAR', `building "${id}" entrance (${x},${y}) is covered by building "${idOf(buildings[i])}"'s footprint.`, 'error'));
      }
    }
    if (propTiles.has(`${x},${y}`)) {
      issues.push(issue('ENTRANCE_CLEAR', `building "${id}" entrance (${x},${y}) is covered by a prop.`, 'error'));
    }
  }

  return issues;
}

/**
 * WALKABLE (tile + endpoint half): every road references real buildings, has
 * tiles, every tile is walkable terrain, the polyline is 4-directionally
 * contiguous (no teleport gaps), and it starts / ends on its two buildings'
 * entrances. (The connected-network half is checkConnectivity.)
 */
function checkRoadTiles(roads, buildingById, dims) {
  const issues = [];

  for (const road of roads) {
    const rid = idOf(road);
    const from = road.fromBuildingId;
    const to = road.toBuildingId;
    const fromOk = typeof from === 'string' && buildingById.has(from);
    const toOk = typeof to === 'string' && buildingById.has(to);
    if (!fromOk || !toOk) {
      issues.push(issue('WALKABLE', `road "${rid}" references a building id not present in the layout.`, 'error'));
    }

    const tiles = Array.isArray(road.tiles) ? road.tiles : [];
    if (tiles.length === 0) {
      issues.push(issue('WALKABLE', `road "${rid}" has no tiles.`, 'error'));
      continue;
    }

    let prev = null;
    let malformed = false;
    for (const tile of tiles) {
      if (!Array.isArray(tile) || tile.length !== 2 || !Number.isInteger(tile[0]) || !Number.isInteger(tile[1])) {
        issues.push(issue('WALKABLE', `road "${rid}" has a malformed tile coordinate.`, 'error'));
        malformed = true;
        prev = null;
        continue;
      }
      const [x, y] = tile;
      if (!isWalkableAt(dims, x, y)) {
        issues.push(issue('WALKABLE', `road "${rid}" tile (${x},${y}) is not walkable terrain.`, 'error'));
      }
      if (prev && Math.abs(prev[0] - x) + Math.abs(prev[1] - y) !== 1) {
        issues.push(issue('WALKABLE', `road "${rid}" is not contiguous between (${prev[0]},${prev[1]}) and (${x},${y}).`, 'error'));
      }
      prev = [x, y];
    }

    if (!malformed) {
      const first = tiles[0];
      const last = tiles[tiles.length - 1];
      const fromEntrance = fromOk ? buildingById.get(from).entrance : null;
      const toEntrance = toOk ? buildingById.get(to).entrance : null;
      if (isPlainObject(fromEntrance) && Number.isInteger(fromEntrance.x) && Number.isInteger(fromEntrance.y)
        && (first[0] !== fromEntrance.x || first[1] !== fromEntrance.y)) {
        issues.push(issue('WALKABLE', `road "${rid}" does not start at building "${from}"'s entrance.`, 'error'));
      }
      if (isPlainObject(toEntrance) && Number.isInteger(toEntrance.x) && Number.isInteger(toEntrance.y)
        && (last[0] !== toEntrance.x || last[1] !== toEntrance.y)) {
        issues.push(issue('WALKABLE', `road "${rid}" does not end at building "${to}"'s entrance.`, 'error'));
      }
    }
  }

  return issues;
}

/**
 * WALKABLE (network half): every present main-facility building is mutually
 * reachable from every other via the road graph — "the roads form a connected
 * network". Anchored at the lowest-id main facility for order-independence.
 */
function checkConnectivity(buildings, adjacency) {
  const issues = [];
  const main = mainFacilities(buildings);
  if (main.length <= 1) return issues;

  const anchor = main[0];
  const reachable = bfsReachable(adjacency, anchor.id);
  for (let i = 1; i < main.length; i++) {
    if (!reachable.has(main[i].id)) {
      issues.push(issue(
        'WALKABLE',
        `main facility "${main[i].id}" (${main[i].facilityKind}) is not connected by roads to "${anchor.id}" (${anchor.facilityKind}); the road network is not one connected component.`,
        'error'
      ));
    }
  }
  return issues;
}

/**
 * REACHABLE: the gate connects, via the road graph, to every present main
 * facility (inn / pub / town_hall / workshop / dojo / dock / watchtower, whichever
 * exist). A missing gate means reachability cannot be established, but it is a
 * legitimate degraded town state backed by habitability.canLive=false, so it is
 * a warning rather than a structural layout error. A present gate that cannot
 * reach a main facility is still an error.
 */
function checkReachable(buildings, adjacency) {
  const issues = [];
  const gates = buildings
    .filter((building) => building.facilityKind === 'gate' && typeof building.id === 'string' && building.id)
    .sort((a, b) => compareStrings(a.id, b.id));

  if (gates.length === 0) {
    issues.push(issue('REACHABLE', 'no gate building is present, so reachability from the town entrance cannot be established.', 'warning'));
    return issues;
  }

  const gate = gates[0];
  const reachable = bfsReachable(adjacency, gate.id);
  for (const facility of mainFacilities(buildings)) {
    if (!reachable.has(facility.id)) {
      issues.push(issue(
        'REACHABLE',
        `main facility "${facility.id}" (${facility.facilityKind}) is not reachable by roads from the gate "${gate.id}".`,
        'error'
      ));
    }
  }
  return issues;
}

/** DOCK_ON_WATER: every dock building's entrance is 4-directionally adjacent to a water tile. */
function checkDockOnWater(buildings, dims) {
  const issues = [];
  for (const dock of buildings) {
    if (dock.facilityKind !== 'dock') continue;
    const id = idOf(dock);
    const entrance = isPlainObject(dock.entrance) ? dock.entrance : null;
    if (!entrance || !Number.isInteger(entrance.x) || !Number.isInteger(entrance.y)) {
      issues.push(issue('DOCK_ON_WATER', `dock "${id}" has an invalid entrance, so water adjacency cannot be confirmed.`, 'error'));
      continue;
    }
    const { x, y } = entrance;
    const touchesWater = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      .some(([nx, ny]) => terrainAt(dims, nx, ny) === 'water');
    if (!touchesWater) {
      issues.push(issue('DOCK_ON_WATER', `dock "${id}" entrance (${x},${y}) is not adjacent to a water tile.`, 'error'));
    }
  }
  return issues;
}

/**
 * BRIDGE_SPANS_WATER: every 'bridge' tile is walkable AND actually spans a
 * waterway — a bridge carries a road across the water line the generator carved.
 * The test is symmetric on the two axes: along ONE axis (the waterway) both
 * neighbours are 'water', and along the PERPENDICULAR axis (the road it carries)
 * both neighbours are walkable, so the crossing lands on dry, walkable ground on
 * either bank. A 'bridge' that spans no water gap, or that dead-ends into water
 * instead of connecting both banks, is a broken terrain feature (error). A flat
 * town with no 'bridge' tiles produces no issues, so this can never regress a
 * layout that the generator left flat.
 */
function checkBridgeSpansWater(dims) {
  const issues = [];
  for (const { x, y } of tilesOfType(dims, 'bridge')) {
    if (!isWalkableAt(dims, x, y)) {
      issues.push(issue('BRIDGE_SPANS_WATER', `bridge tile (${x},${y}) is not walkable terrain.`, 'error'));
      continue;
    }
    const waterVertical = terrainAt(dims, x, y - 1) === 'water' && terrainAt(dims, x, y + 1) === 'water';
    const waterHorizontal = terrainAt(dims, x - 1, y) === 'water' && terrainAt(dims, x + 1, y) === 'water';
    const walkVertical = isWalkableAt(dims, x, y - 1) && isWalkableAt(dims, x, y + 1);
    const walkHorizontal = isWalkableAt(dims, x - 1, y) && isWalkableAt(dims, x + 1, y);
    const spans = (waterVertical && walkHorizontal) || (waterHorizontal && walkVertical);
    if (!spans) {
      issues.push(issue(
        'BRIDGE_SPANS_WATER',
        `bridge tile (${x},${y}) does not span a waterway: it needs 'water' on both sides of one axis and walkable ground on both sides of the other.`,
        'error'
      ));
    }
  }
  return issues;
}

/**
 * STAIRS_CONNECT_ELEVATION: every 'stairs' tile is walkable AND is the single
 * walkable seam that joins a raised plateau to the surrounding ground. It must be
 * 4-adjacent to at least one 'cliff' tile (the plateau's non-walkable rim — the
 * 高低差 the stairs bridges) AND have walkable ground on two OPPOSITE sides (the
 * raised interior on one side, the lower ground / road it connects to on the
 * other), so it is a genuine through-path rather than a dead end set into the
 * cliff. A 'stairs' meeting neither is a broken terrain feature (error). A flat
 * town with no 'stairs' tiles produces no issues, so this can never regress a
 * layout that the generator left flat.
 */
function checkStairsConnectElevation(dims) {
  const issues = [];
  for (const { x, y } of tilesOfType(dims, 'stairs')) {
    if (!isWalkableAt(dims, x, y)) {
      issues.push(issue('STAIRS_CONNECT_ELEVATION', `stairs tile (${x},${y}) is not walkable terrain.`, 'error'));
      continue;
    }
    const touchesCliff = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]]
      .some(([nx, ny]) => terrainAt(dims, nx, ny) === 'cliff');
    const throughPath =
      (isWalkableAt(dims, x, y - 1) && isWalkableAt(dims, x, y + 1)) ||
      (isWalkableAt(dims, x - 1, y) && isWalkableAt(dims, x + 1, y));
    if (!touchesCliff || !throughPath) {
      issues.push(issue(
        'STAIRS_CONNECT_ELEVATION',
        `stairs tile (${x},${y}) does not connect a raised plateau to the ground: it needs an adjacent 'cliff' rim tile and walkable ground on two opposite sides.`,
        'error'
      ));
    }
  }
  return issues;
}

/**
 * DENSITY: densityScore = sum(footprint area) / totalTiles. Outside the advisory
 * [DENSITY_MIN, DENSITY_MAX] band this raises a warning (DENSITY_SPARSE below,
 * DENSITY_CRAMPED above) — never an error, so it can never flip `ok`.
 * @returns {{ issues: Array<object>, densityScore: number }}
 */
function checkDensity(rects, dims) {
  const totalTiles = dims.widthTiles * dims.heightTiles;
  let builtTiles = 0;
  for (const rect of rects) if (rectValid(rect)) builtTiles += rect.width * rect.height;
  const densityScore = totalTiles > 0 ? builtTiles / totalTiles : 0;

  const issues = [];
  if (totalTiles > 0) {
    if (densityScore < DENSITY_MIN) {
      issues.push(issue(
        'DENSITY_SPARSE',
        `building density ${densityScore.toFixed(4)} (${builtTiles}/${totalTiles} tiles) is below the ${DENSITY_MIN} floor; the town reads as too empty.`,
        'warning'
      ));
    } else if (densityScore > DENSITY_MAX) {
      issues.push(issue(
        'DENSITY_CRAMPED',
        `building density ${densityScore.toFixed(4)} (${builtTiles}/${totalTiles} tiles) is above the ${DENSITY_MAX} ceiling; the town is too cramped.`,
        'warning'
      ));
    }
  }
  return { issues, densityScore };
}

/**
 * NPC_NOT_IN_WALL: no NPC stands on a wall / building-interior / water tile (or
 * any other blocking tile). An NPC is flagged when it is out of bounds, on a
 * non-standable tile (anything but walkable outdoor ground / road — 'floor' is
 * excluded as a building interior), or inside any building's footprint.
 */
function checkNpcNotInWall(npcs, rects, dims) {
  const issues = [];
  for (const npc of npcs) {
    const id = idOf(npc);
    const { x, y } = npc;
    if (!inBounds(dims, x, y)) {
      issues.push(issue('NPC_NOT_IN_WALL', `npc "${id}" has an invalid or out-of-bounds position.`, 'error'));
      continue;
    }
    const tile = terrainAt(dims, x, y);
    const standable = typeof tile === 'string' && NPC_STANDABLE_TILE_SET.has(tile);
    const insideBuilding = rects.some((rect) => pointInRect(rect, x, y));
    if (!standable || insideBuilding) {
      const reason = insideBuilding ? 'inside a building footprint' : `on a non-standable "${tile}" tile`;
      issues.push(issue('NPC_NOT_IN_WALL', `npc "${id}" stands ${reason} at (${x},${y}).`, 'error'));
    }
  }
  return issues;
}

// --- ordering -----------------------------------------------------------------

/**
 * Deterministic, locale-independent issue order: code, then message, then
 * severity, all by plain code-unit comparison (never localeCompare — ICU
 * collation is locale-dependent and would defeat byte-identical output).
 */
function compareIssues(a, b) {
  if (a.code !== b.code) return compareStrings(a.code, b.code);
  if (a.message !== b.message) return compareStrings(a.message, b.message);
  return compareStrings(a.severity, b.severity);
}

// --- public API ---------------------------------------------------------------

/**
 * Run every spatial invariant check against one TownLayout and return the frozen
 * TownLayoutValidation verdict (see ./schema.mjs). Pure, synchronous,
 * deterministic, and read-only: never mutates `layout`, never throws on malformed
 * input (a missing/malformed field degrades to a concrete issue, never a crash),
 * and `issues` is always sorted by (code, message, severity) so two calls against
 * structurally identical input return byte-identical output.
 *
 * `ok` is false whenever any issue has severity 'error' OR any of noOverlap /
 * walkable is false or any error exists. importantBuildingsReachable remains an
 * independent fact: it is false for the valid-but-uninhabitable no-gate state as
 * well as for a malformed disconnected gate.
 *
 * @param {TownLayout} layout
 * @returns {TownLayoutValidation} deeply frozen; safe to embed directly in a layout
 */
export function validateLayout(layout) {
  const dims = mapDims(layout);
  const buildings = arr(layout?.buildings).filter(isPlainObject);
  const roads = arr(layout?.roads).filter(isPlainObject);
  const npcs = arr(layout?.npcs).filter(isPlainObject);
  const props = arr(layout?.props).filter(isPlainObject);

  const rects = buildings.map(buildingRect);
  const buildingById = new Map();
  for (const building of buildings) {
    if (typeof building.id === 'string' && building.id && !buildingById.has(building.id)) {
      buildingById.set(building.id, building);
    }
  }
  const adjacency = buildRoadAdjacency(roads, buildingById);

  const { issues: densityIssues, densityScore } = checkDensity(rects, dims);
  const issues = [
    ...checkStructure(layout, dims),
    ...checkNoOverlap(buildings, rects, dims),
    ...checkEntranceClear(buildings, rects, props, dims),
    ...checkRoadTiles(roads, buildingById, dims),
    ...checkConnectivity(buildings, adjacency),
    ...checkReachable(buildings, adjacency),
    ...checkDockOnWater(buildings, dims),
    ...checkBridgeSpansWater(dims),
    ...checkStairsConnectElevation(dims),
    ...densityIssues,
    ...checkNpcNotInWall(npcs, rects, dims)
  ].sort(compareIssues);

  const noOverlap = !issues.some((entry) => entry.code === 'NO_OVERLAP');
  const walkable = !issues.some((entry) => entry.code === 'WALKABLE');
  const importantBuildingsReachable = !issues.some((entry) => entry.code === 'REACHABLE');
  const ok = noOverlap
    && walkable
    && !issues.some((entry) => entry.severity === 'error');

  return deepFreeze({
    ok,
    issues,
    densityScore,
    walkable,
    importantBuildingsReachable,
    noOverlap
  });
}

/**
 * Convenience wrapper that RETURNS A COPY: runs validateLayout(layout) and
 * returns a NEW, shallow-copied TownLayout with its `.validation` field set to
 * the fresh result. It never mutates the `layout` argument (matching the
 * "never mutate input" convention across src/town/**, e.g. detect.mjs /
 * habitability.mjs, whose outputs are deep-frozen and could not be mutated in
 * place anyway) and never trusts a stale `layout.validation` — the verdict is
 * always recomputed. Every field other than `validation` is a shallow reference
 * to the original; only the top-level object is new (and the embedded
 * `validation` is itself deep-frozen). A non-object `layout` degrades to
 * `{ validation }` rather than throwing; final deep-freezing of the whole layout
 * is left to the generator.
 *
 * @param {TownLayout} layout
 * @returns {TownLayout} a new object; the input is untouched
 */
export function annotateLayout(layout) {
  const base = isPlainObject(layout) ? layout : {};
  return { ...base, validation: validateLayout(layout) };
}
