// src/town/generator.mjs
//
// Deterministic SPATIAL layout generator for the "habitable town" subsystem
// (src/town/**). generateLayout() turns one already-computed TownModel (see
// ./detect.mjs buildTownModel) plus a (repoFingerprint, generatorVersion,
// seed) determinism key into a TownLayout matching the FROZEN contract in
// ./schema.mjs: a tile-grid terrain map, non-overlapping buildings with
// walkable entrances, a road network, NPCs, decorative props, and an
// informational connections list. ./validator.mjs is the module that checks
// that output ("役場検査") and fills in the `validation` field; this generator
// leaves an honest "not yet validated" placeholder and never judges itself.
//
// DETERMINISM IS THE WHOLE POINT. The SAME (model, repoFingerprint,
// generatorVersion, seed) MUST produce a structurally (and once serialized,
// byte-) identical TownLayout, on any machine, forever. The ONLY randomness
// source is the seeded PRNG from ./rng.mjs (makeRng(seed)); this file never
// calls Date.now / new Date / Math.random. Every rng draw happens in a fixed
// sequence dictated by the code path (never by iterating an unordered
// Set/Map), and every returned collection is either built in a fixed order
// (PLACEMENT_ORDER) or explicitly sorted, so no incidental engine iteration
// order can leak into the output.
//
// PURE. No I/O, and the only imports are ./rng.mjs and ./schema.mjs. The
// scanned repository is never re-read or executed here — this module only
// re-shapes the already-computed, in-memory TownModel (plain data) into
// tile-space geometry.
//
// EVIDENCE HONESTY carries over from the TownModel: a building is placed only
// for a Facility the model reports present (facilities[].present === true),
// PLUS the always-present town_hall (forced even if a malformed model forgot
// it, mirroring detect.mjs's "town_hall is always present" invariant) and the
// gate — and the gate ONLY when its own Facility is present. No absent
// facility is ever given a building. A consequence, by design: a repo with no
// discoverable entrance produces a gate-less layout that ./validator.mjs will
// honestly fail on REACHABLE — exactly as ./habitability.mjs raises a "no way
// in" blocker for the same repo. The generator never invents a gate to game
// the check.
//
// LAYOUT STRATEGY (deterministic-by-construction, no pathfinder). Buildings
// are packed into a uniform grid of cells in a fixed PLACEMENT_ORDER (gate
// first, then town_hall, then the rest), so placement never depends on the
// TownModel.facilities array order. Within its cell each building is
// bottom-anchored so every building in one grid row shares a single walkable
// "avenue" tile row at its (down-facing) entrance; a single vertical "spine"
// column in the left margin joins the avenues. Roads are a star from a hub
// (the gate if present, else the always-present town_hall) to every other
// placed building: each road runs from the hub entrance along its avenue to
// the spine, up/down the spine, then along the target avenue to the target
// entrance — a contiguous Manhattan polyline whose every tile is a
// footprint-free margin/avenue cell. This makes every placed building
// road-connected to the hub, so (when a gate exists) the gate reaches every
// present main facility and the whole network is one connected component. A
// placed dock gets a water tile carved just past its entrance so it touches
// water without blocking the entrance itself.
//
// TERRAIN FEATURES (v1.1.0, placeholder tiles only). After the roads and dock
// water are laid down, two optional features are attempted, each guarded by a
// HARD SAFETY re-check (terrainNetworkSafe): a WATERWAY — one deterministically
// chosen full-height column, avoiding every footprint and entrance, flooded to
// 'water' except where it crosses a road, which becomes a walkable 'bridge' (so
// the road keeps crossing and at least one bridge spans the water); and an
// ELEVATION plateau — a small empty grass square whose rim becomes non-walkable
// 'cliff' except one 'stairs' tile that links its raised (still-walkable)
// interior to the network. A feature is committed only if, afterwards, the
// walkable graph still joins the hub to every building entrance and no footprint
// or entrance sits on water/cliff; otherwise it is reverted and the town stays
// flat there. Worst case a layout is identical-quality to the flat pre-1.1.0
// output; best case it gains a bridged waterway and/or a stair-linked plateau —
// never at the cost of REACHABLE / WALKABLE / DOCK_ON_WATER / NPC-not-in-wall.
// Determinism is preserved: the seeded rng only chooses among candidates
// enumerated in a fixed (ascending-x, then row-major) order.

import { makeRng } from './rng.mjs';
import { GENERATOR_VERSION, FACILITY_KINDS, DIRECTIONS, NPC_ROLES, PROP_KINDS, WALKABLE_TILE_TYPES, isFacilityKind } from './schema.mjs';

/** @typedef {import('./schema.mjs').TownModel} TownModel */
/** @typedef {import('./schema.mjs').Facility} Facility */
/** @typedef {import('./schema.mjs').Habitability} Habitability */
/** @typedef {import('./schema.mjs').TownLayout} TownLayout */
/** @typedef {import('./schema.mjs').TownBuilding} TownBuilding */
/** @typedef {import('./schema.mjs').TownRoad} TownRoad */
/** @typedef {import('./schema.mjs').TownNpc} TownNpc */
/** @typedef {import('./schema.mjs').TownProp} TownProp */
/** @typedef {import('./schema.mjs').TownDistrict} TownDistrict */
/** @typedef {import('./schema.mjs').TownConnection} TownConnection */
/** @typedef {import('./schema.mjs').TileXY} TileXY */
/** @typedef {import('./rng.mjs').Rng} Rng */

// --- generator-local placement constants ------------------------------------
// Placement judgment calls specific to THIS generator version, not part of the
// shared ./schema.mjs vocabulary — so they live here, keeping schema.mjs
// vocabulary-only.

/** Pixel edge of one tile for the renderer only; never enters placement math. */
const TILE_SIZE_PX = 16;

/** Vertical road corridor column, kept in the left margin (left of every cell). */
const SPINE_X = 1;
/** Leftmost cell x — leaves columns 0..2 (incl. the spine) clear on the left. */
const FIRST_CELL_X = 3;
/** Topmost cell y — leaves rows 0..1 clear on the top. */
const FIRST_CELL_Y = 2;
/** Horizontal gap (tiles) between grid columns, for spacing / prop breathing room. */
const COL_GAP = 2;
/** Vertical gap (tiles) below each row's avenue: exactly one open row for dock water / separation. */
const ROW_GAP = 2;
/** Clear tiles kept on the right / bottom edges of the map. */
const RIGHT_PAD = 2;
const BOTTOM_PAD = 2;
/** How many tiles out from a footprint counts as "near it" when scattering props. */
const NEARBY_RADIUS = 2;

// --- terrain-feature sizing (v1.1.0: waterway+bridge, elevation+stairs) -------
/**
 * Preferred and minimum square edge (tiles) of a raised plateau. Edge >= 3 so it
 * keeps a walkable interior ringed by cliff; the generator prefers the larger
 * edge and falls back to the smaller so smaller maps can still host one. A map
 * with no empty all-grass square this big simply gets no plateau (flat fallback).
 */
const PLATEAU_MAX_EDGE = 4;
const PLATEAU_MIN_EDGE = 3;

/**
 * Fixed footprint size per facility kind, in tiles. town_hall is the largest
 * (civic center); watchtower is taller than it is wide; the small structures
 * (gate/well/shop/house/ruin) are 2x2. Any kind without an explicit entry (e.g.
 * a future FACILITY_KIND) falls back to DEFAULT_FOOTPRINT so placement can
 * never crash on an unmapped kind.
 * @type {Readonly<Record<string, { w: number, h: number }>>}
 */
const FOOTPRINTS = Object.freeze({
  gate: { w: 2, h: 2 },
  town_hall: { w: 4, h: 4 },
  inn: { w: 3, h: 3 },
  pub: { w: 3, h: 3 },
  dojo: { w: 3, h: 3 },
  workshop: { w: 3, h: 3 },
  watchtower: { w: 2, h: 3 },
  dock: { w: 3, h: 3 },
  warehouse: { w: 3, h: 3 },
  well: { w: 2, h: 2 },
  guild: { w: 3, h: 3 },
  shop: { w: 2, h: 2 },
  house: { w: 2, h: 2 },
  ruin: { w: 2, h: 2 }
});
const DEFAULT_FOOTPRINT = Object.freeze({ w: 2, h: 2 });
const footprintOf = (kind) => FOOTPRINTS[kind] ?? DEFAULT_FOOTPRINT;

/**
 * Fixed, model-independent placement order: gate first (grid cell 0, nearest
 * the map's northwest corner — a sensible edge position for the entrance),
 * then the always-present town_hall, then every remaining FACILITY_KIND in
 * schema.mjs's canonical order. Derived from FACILITY_KINDS so a new kind
 * added to the vocabulary is placed automatically instead of being silently
 * dropped.
 * @type {ReadonlyArray<string>}
 */
const HUB_FIRST = Object.freeze(['gate', 'town_hall']);
const PLACEMENT_ORDER = Object.freeze([
  ...HUB_FIRST,
  ...FACILITY_KINDS.filter((kind) => !HUB_FIRST.includes(kind))
]);

/**
 * Facility-anchored NPC role per FACILITY_KIND, mirroring the mapping
 * documented on schema.mjs's NPC_ROLES. well and ruin intentionally have no
 * entry: they fall back to an ambient MOB_ROLE.
 * @type {Readonly<Record<string, string>>}
 */
const NPC_ROLE_BY_FACILITY = Object.freeze({
  inn: 'innkeeper',
  pub: 'barkeep',
  guild: 'guildmaster',
  town_hall: 'clerk',
  dock: 'ferryman',
  warehouse: 'warehouse_keeper',
  workshop: 'foreman',
  dojo: 'inspector',
  watchtower: 'watch',
  house: 'resident',
  shop: 'shopkeeper',
  gate: 'gatekeeper'
});

/**
 * Ambient mob roles: every NPC_ROLES entry NOT claimed by a facility above
 * (townsfolk / traveler / child per schema.mjs), derived rather than re-typed
 * so this list can never drift from the frozen NPC_ROLES contract.
 * @type {ReadonlyArray<string>}
 */
const CLAIMED_NPC_ROLES = new Set(Object.values(NPC_ROLE_BY_FACILITY));
const MOB_ROLES = Object.freeze(NPC_ROLES.filter((role) => !CLAIMED_NPC_ROLES.has(role)));

/**
 * Thematic prop(s) placed near a facility that carries special flavor meaning.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const SPECIAL_PROPS_BY_FACILITY = Object.freeze({
  ruin: ['todo_grass', 'rubble'],
  well: ['well'],
  workshop: ['scaffold'],
  gate: ['signboard'],
  town_hall: ['flag']
});

/**
 * Generic set-dressing props, derived from PROP_KINDS minus the special-purpose
 * kinds already handled above, so it stays in sync with schema.mjs.
 * @type {ReadonlyArray<string>}
 */
const SPECIAL_PROP_KIND_SET = new Set(Object.values(SPECIAL_PROPS_BY_FACILITY).flat());
const GENERIC_PROP_POOL = Object.freeze(PROP_KINDS.filter((kind) => !SPECIAL_PROP_KIND_SET.has(kind)));

// Guild panel tab ids that name an external connection (see detect.mjs).
const GUILD_MEMBERS_TAB = 'なかま';
const GUILD_RECEPTION_TAB = 'うけつけ';
const GUILD_REQUESTS_TAB = 'いらい';

// --- small, machine-independent helpers -------------------------------------
// Every sort goes through compareStrings (plain code-unit comparison), never
// String#localeCompare, which is ICU/locale-dependent and would break
// cross-machine byte-identity — the same reasoning rng.mjs documents for its
// own fingerprint sort.

/** @param {string} a @param {string} b @returns {-1|0|1} */
function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyFn
 * @returns {T[]} a NEW array sorted ascending by keyFn(item)
 */
function sortByKey(items, keyFn) {
  return [...items].sort((a, b) => compareStrings(keyFn(a), keyFn(b)));
}

/** @param {unknown} value @returns {boolean} true only for a plain (non-array, non-null) object */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {any[]} the value if an array, else a new empty array */
function arr(value) {
  return Array.isArray(value) ? value : [];
}

/** "x,y" tile key for the occupied-tile set. */
const keyOf = (x, y) => `${x},${y}`;

/**
 * Coerce a caller-supplied seed into the exact string fed to makeRng, so
 * TownLayout.seed always equals what actually drove the PRNG. Mirrors
 * rng.mjs's own internal normalizeSeed, so round-tripping through makeRng is a
 * no-op.
 * @param {unknown} seed
 * @returns {string}
 */
function normalizeSeedString(seed) {
  if (typeof seed === 'string') return seed;
  if (typeof seed === 'number' && Number.isFinite(seed)) return String(seed);
  return seed == null ? '' : String(seed);
}

/**
 * Remove and return one uniformly-random element from `pool` (mutating it via
 * splice), or null when the pool is empty. Consuming from a shared pool keeps
 * two props / mobs from ever landing on the same tile.
 * @param {Rng} rng @param {TileXY[]} pool @returns {TileXY | null}
 */
function takeRandomTile(rng, pool) {
  if (pool.length === 0) return null;
  return pool.splice(rng.int(0, pool.length - 1), 1)[0];
}

// --- facility resolution -----------------------------------------------------

/**
 * kind -> Facility for every PRESENT, well-formed facility in the model.
 * Tolerant of a missing / malformed model (degrades to an empty map). Absent
 * or malformed facilities are dropped; the town_hall fallback in
 * resolvePlacedKinds still guarantees a minimal, valid layout.
 * @param {unknown} rawFacilities
 * @returns {Map<string, Facility>}
 */
function indexPresentFacilities(rawFacilities) {
  const index = new Map();
  for (const facility of arr(rawFacilities)) {
    if (isPlainObject(facility) && isFacilityKind(facility.kind) && facility.present === true) {
      index.set(facility.kind, facility);
    }
  }
  return index;
}

/** A safe, always-present stand-in for town_hall when a malformed model omitted it. */
function fallbackTownHall() {
  return { kind: 'town_hall', present: true, count: 1, evidence: { observed: [], inferred: [], unknown: [] } };
}

/**
 * Which FACILITY_KINDS get a building, in fixed PLACEMENT_ORDER: every present
 * kind, PLUS town_hall unconditionally (detect.mjs treats it as always present,
 * and the generator must never produce zero buildings). gate is included only
 * when its own Facility is present — no facility is placed on absent evidence.
 * @param {Map<string, Facility>} present
 * @returns {string[]}
 */
function resolvePlacedKinds(present) {
  return PLACEMENT_ORDER.filter((kind) => kind === 'town_hall' || present.has(kind));
}

/**
 * Advisory BUILDING_STATES render hint, derived only from a facility's own kind
 * and evidence (never a habitability verdict): a ruin is 'ruined'; a facility
 * backed only by unknown-class evidence is 'vacant' ("not lit up yet", never
 * "broken"); a workshop is 'under_construction' (that is what a workshop IS); a
 * high-count facility is 'busy'; anything else present is 'occupied'.
 * @param {Facility} facility @param {string} kind @returns {string} one of BUILDING_STATES
 */
function deriveBuildingState(facility, kind) {
  if (kind === 'ruin') return 'ruined';
  const evidence = isPlainObject(facility?.evidence) ? facility.evidence : {};
  const observed = arr(evidence.observed).length;
  const inferred = arr(evidence.inferred).length;
  const unknown = arr(evidence.unknown).length;
  if (observed === 0 && inferred === 0 && unknown > 0) return 'vacant';
  if (kind === 'workshop') return 'under_construction';
  if (Number.isFinite(facility?.count) && facility.count >= 5) return 'busy';
  return 'occupied';
}

// --- tile-grid geometry ------------------------------------------------------

/**
 * Empty (all-'grass') terrain grid, row-major terrain[y][x].
 * @param {number} width @param {number} height @returns {string[][]}
 */
function makeTerrain(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => 'grass'));
}

/**
 * Paint a building footprint: a 1-tile 'wall' shell with a 'floor' interior
 * when the footprint is at least 3x3, else solid 'wall'. Both are legitimate
 * footprint tiles per schema.mjs (never natural obstacles); nothing in this
 * module ever routes a road, NPC, or prop through a footprint.
 * @param {string[][]} terrain @param {number} x @param {number} y @param {number} w @param {number} h
 */
function paintFootprint(terrain, x, y, w, h) {
  const hasInterior = w >= 3 && h >= 3;
  for (let ry = 0; ry < h; ry++) {
    for (let rx = 0; rx < w; rx++) {
      const isBorder = rx === 0 || ry === 0 || rx === w - 1 || ry === h - 1;
      terrain[y + ry][x + rx] = hasInterior && !isBorder ? 'floor' : 'wall';
    }
  }
}

/**
 * Mark every tile of an ordered polyline 'road', but ONLY where the tile is
 * currently open ground ('grass' / 'road' / 'path') — never over a 'wall' /
 * 'floor' / 'water'. By construction every road tile is a footprint-free
 * margin/avenue cell, so this guard never fires in correct operation; if a
 * routing invariant were ever violated the guard turns silent footprint
 * corruption into a loud validator failure (a non-walkable road tile) instead.
 * @param {string[][]} terrain @param {TileXY[]} tiles
 */
function paintRoad(terrain, tiles) {
  for (const [x, y] of tiles) {
    const tile = terrain[y]?.[x];
    if (tile === 'grass' || tile === 'road' || tile === 'path') terrain[y][x] = 'road';
  }
}

/**
 * Ordered, 4-directionally contiguous Manhattan polyline from tile `from` to
 * tile `to`, routed along `from`'s avenue row, the vertical `spineX` column,
 * then `to`'s avenue row (or a single straight run when both share a row).
 * Consecutive duplicates are dropped so every step is exactly one tile — the
 * contiguity the validator's checkRoadTiles requires. The first tile is
 * exactly `from` and the last exactly `to`.
 * @param {{x:number,y:number}} from @param {{x:number,y:number}} to @param {number} spineX
 * @returns {TileXY[]}
 */
function manhattanPath(from, to, spineX) {
  /** @type {TileXY[]} */
  const tiles = [];
  const push = (x, y) => {
    const last = tiles[tiles.length - 1];
    if (!last || last[0] !== x || last[1] !== y) tiles.push([x, y]);
  };
  push(from.x, from.y);

  if (from.y === to.y) {
    const step = to.x >= from.x ? 1 : -1;
    for (let x = from.x; x !== to.x; x += step) push(x + step, from.y);
    return tiles;
  }

  { // along from's avenue to the spine
    const step = spineX >= from.x ? 1 : -1;
    for (let x = from.x; x !== spineX; x += step) push(x + step, from.y);
  }
  { // down/up the spine to to's avenue
    const step = to.y >= from.y ? 1 : -1;
    for (let y = from.y; y !== to.y; y += step) push(spineX, y + step);
  }
  { // along to's avenue to the target entrance
    const step = to.x >= spineX ? 1 : -1;
    for (let x = spineX; x !== to.x; x += step) push(x + step, to.y);
  }
  return tiles;
}

/**
 * Turn one tile into 'water', but only if it is still plain 'grass' (so it
 * never clobbers a building, road, entrance, or another water tile). Returns
 * whether the tile was converted.
 * @param {string[][]} terrain @param {number} x @param {number} y @returns {boolean}
 */
function tryPlaceWater(terrain, x, y) {
  if (terrain[y]?.[x] !== 'grass') return false;
  terrain[y][x] = 'water';
  return true;
}

/**
 * Every 'grass' tile within `radius` of a footprint rectangle (excluding tiles
 * already in `occupied`), returned in row-major (y, then x) order so the result
 * is deterministic without an extra sort. 'grass' only: this deliberately skips
 * 'road' (the network / entrances) and 'floor' (building interiors), so props
 * placed from here can never cover an entrance or block a road.
 * @param {string[][]} terrain
 * @param {{x:number,y:number,w:number,h:number}} box
 * @param {number} radius @param {number} mapW @param {number} mapH @param {Set<string>} occupied
 * @returns {TileXY[]}
 */
function nearbyGrass(terrain, box, radius, mapW, mapH, occupied) {
  const minX = Math.max(0, box.x - radius);
  const maxX = Math.min(mapW - 1, box.x + box.w - 1 + radius);
  const minY = Math.max(0, box.y - radius);
  const maxY = Math.min(mapH - 1, box.y + box.h - 1 + radius);
  const out = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (terrain[y][x] === 'grass' && !occupied.has(keyOf(x, y))) out.push([x, y]);
    }
  }
  return out;
}

// --- terrain features: waterway+bridge, elevation+stairs (v1.1.0) ------------
// Both run AFTER roads/dock and BEFORE npcs/props, each applied only if the HARD
// SAFETY re-check (terrainNetworkSafe) still holds afterwards; otherwise it is
// reverted so the new water/bridge/cliff/stairs tiles can never regress the
// validator's REACHABLE / WALKABLE / DOCK_ON_WATER / NPC_NOT_IN_WALL invariants.

/** Walkable terrain ids (schema contract) and the blocked ids a footprint /
 *  entrance must never end up on once a feature is carved. */
const WALKABLE_TERRAIN = new Set(WALKABLE_TILE_TYPES);
const FEATURE_BLOCKED_TILES = new Set(['water', 'cliff']);

/** @param {string[][]} terrain @param {number} x @param {number} y @returns {boolean} */
function isWalkableTile(terrain, x, y) {
  const tile = terrain[y]?.[x];
  return typeof tile === 'string' && WALKABLE_TERRAIN.has(tile);
}

/**
 * HARD SAFETY re-check shared by every terrain feature. Over the CURRENT terrain
 * it confirms that (a) no building footprint cell and no entrance sits on a
 * blocked (water/cliff) tile, and (b) a 4-neighbour flood-fill of the walkable
 * terrain from the hub entrance still reaches every placed building's entrance —
 * i.e. the gate-to-facility network the validator grades stays intact. Pure read
 * over `terrain`; never mutates. @returns {boolean}
 * @param {string[][]} terrain @param {number} mapW @param {number} mapH
 * @param {Map<string, { box:{x:number,y:number,w:number,h:number}, entrance:{x:number,y:number} }>} placements
 * @param {{x:number,y:number}} hubEntrance
 */
function terrainNetworkSafe(terrain, mapW, mapH, placements, hubEntrance) {
  for (const { box, entrance } of placements.values()) {
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        if (FEATURE_BLOCKED_TILES.has(terrain[y]?.[x])) return false; // a feature overwrote a footprint
      }
    }
    if (!isWalkableTile(terrain, entrance.x, entrance.y)) return false; // entrance blocked
  }
  if (!isWalkableTile(terrain, hubEntrance.x, hubEntrance.y)) return false;
  const seen = new Set([keyOf(hubEntrance.x, hubEntrance.y)]);
  const stack = [[hubEntrance.x, hubEntrance.y]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
      const key = keyOf(nx, ny);
      if (seen.has(key) || !isWalkableTile(terrain, nx, ny)) continue;
      seen.add(key);
      stack.push([nx, ny]);
    }
  }
  for (const { entrance } of placements.values()) {
    if (!seen.has(keyOf(entrance.x, entrance.y))) return false;
  }
  return true;
}

/**
 * Apply the [x, y, newTile] `cells` to `terrain`, keeping them only if `isSafe()`
 * still holds; otherwise restore every original tile and report failure. The rng
 * draw that chose the feature is spent either way, so a reverted feature stays
 * fully deterministic. @returns {boolean} whether the feature was kept.
 * @param {string[][]} terrain @param {Array<[number,number,string]>} cells @param {() => boolean} isSafe
 */
function commitFeature(terrain, cells, isSafe) {
  if (cells.length === 0) return false;
  const original = cells.map(([x, y]) => terrain[y][x]);
  for (const [x, y, tile] of cells) terrain[y][x] = tile;
  if (isSafe()) return true;
  cells.forEach(([x, y], i) => { terrain[y][x] = original[i]; });
  return false;
}

/**
 * Deterministically choose a full-height column to flood into a waterway: skips
 * the road spine and every column that passes through a building footprint or an
 * entrance, and keeps only columns crossing >= 1 road tile (so a 'bridge' is
 * guaranteed to carry that road across). Returns the chosen x, or null when no
 * such column exists (the town stays flat). One rng draw when >= 1 candidate.
 * @param {string[][]} terrain @param {number} mapW @param {number} mapH
 * @param {Map<string, { box:{x:number,y:number,w:number,h:number}, entrance:{x:number,y:number} }>} placements
 * @param {Rng} rng @returns {number | null}
 */
function chooseWaterwayColumn(terrain, mapW, mapH, placements, rng) {
  const footprintX = new Set();
  const entranceX = new Set();
  for (const { box, entrance } of placements.values()) {
    for (let x = box.x; x < box.x + box.w; x++) footprintX.add(x);
    entranceX.add(entrance.x);
  }
  const candidates = [];
  for (let x = 0; x < mapW; x++) {
    if (x === SPINE_X || footprintX.has(x) || entranceX.has(x)) continue;
    let roadCrossings = 0;
    let carvable = true;
    for (let y = 0; y < mapH; y++) {
      const tile = terrain[y][x];
      if (tile === 'road') roadCrossings++;
      else if (tile !== 'grass' && tile !== 'water') { carvable = false; break; } // wall/floor/etc: not a clean column
    }
    if (carvable && roadCrossings > 0) candidates.push(x);
  }
  return candidates.length > 0 ? rng.pick(candidates) : null;
}

/** The [x,y,tile] edits flooding column `x`: road -> bridge, grass -> water (a
 *  pre-existing dock 'water' tile stays water). @returns {Array<[number,number,string]>}
 *  @param {string[][]} terrain @param {number} mapH @param {number} x */
function waterwayColumnCells(terrain, mapH, x) {
  const cells = [];
  for (let y = 0; y < mapH; y++) {
    const tile = terrain[y][x];
    if (tile === 'road') cells.push([x, y, 'bridge']);
    else if (tile === 'grass') cells.push([x, y, 'water']);
  }
  return cells;
}

/**
 * Choose the plateau's single walkable 'stairs' seam so it satisfies the
 * validator's STAIRS_CONNECT_ELEVATION rule: a NON-corner perimeter (edge-mid)
 * tile whose OUTWARD neighbour — the tile just outside the plateau — is walkable
 * ground. Such a tile then has the raised interior (walkable grass) on its inward
 * side and that lower ground on its outward side, i.e. "walkable ground on two
 * opposite sides", and its two same-edge neighbours are the 'cliff' rim, giving
 * "an adjacent cliff tile". Edge-mid tiles only exist for size >= 3 (which
 * PLATEAU_MIN_EDGE guarantees), so the plateau always keeps an interior. Scanned
 * in a fixed order (top then bottom then left then right, ascending along each),
 * preferring a seam whose outward neighbour is a road so the stairs meet the road
 * network. Returns null when no edge-mid tile has a walkable exterior (the
 * plateau would be a sealed box), so that location is rejected.
 * @param {string[][]} terrain @param {number} px @param {number} py @param {number} size
 * @returns {{x:number,y:number} | null}
 */
function chooseStairsSeam(terrain, px, py, size) {
  /** @type {Array<{x:number,y:number,ox:number,oy:number}>} edge-mid tile + its outward neighbour */
  const seams = [];
  for (let x = px + 1; x < px + size - 1; x++) {
    seams.push({ x, y: py, ox: x, oy: py - 1 });               // top edge, outward = up
    seams.push({ x, y: py + size - 1, ox: x, oy: py + size });  // bottom edge, outward = down
  }
  for (let y = py + 1; y < py + size - 1; y++) {
    seams.push({ x: px, y, ox: px - 1, oy: y });                // left edge, outward = left
    seams.push({ x: px + size - 1, y, ox: px + size, oy: y });  // right edge, outward = right
  }
  let roadSeam = null;
  let walkSeam = null;
  for (const s of seams) {
    if (terrain[s.oy]?.[s.ox] === 'road') { if (!roadSeam) roadSeam = { x: s.x, y: s.y }; }
    else if (isWalkableTile(terrain, s.ox, s.oy) && !walkSeam) walkSeam = { x: s.x, y: s.y };
  }
  return roadSeam ?? walkSeam;
}

/**
 * Generator-side mirror of the validator's BRIDGE_SPANS_WATER rule for a single
 * 'bridge' tile: walkable, with 'water' on both sides of one axis and walkable
 * ground on both sides of the perpendicular axis. Used only as a HARD SAFETY
 * backstop — a waterway whose bridge would not span is reverted to flat.
 * @param {string[][]} terrain @param {number} x @param {number} y @returns {boolean}
 */
function bridgeSpansWater(terrain, x, y) {
  if (!isWalkableTile(terrain, x, y)) return false;
  const waterV = terrain[y - 1]?.[x] === 'water' && terrain[y + 1]?.[x] === 'water';
  const waterH = terrain[y]?.[x - 1] === 'water' && terrain[y]?.[x + 1] === 'water';
  const walkV = isWalkableTile(terrain, x, y - 1) && isWalkableTile(terrain, x, y + 1);
  const walkH = isWalkableTile(terrain, x - 1, y) && isWalkableTile(terrain, x + 1, y);
  return (waterV && walkH) || (waterH && walkV);
}

/**
 * Generator-side mirror of the validator's STAIRS_CONNECT_ELEVATION rule for a
 * single 'stairs' tile: walkable, 4-adjacent to a 'cliff' rim, and with walkable
 * ground on two opposite sides. Used only as a HARD SAFETY backstop — a plateau
 * whose stairs would not connect is reverted to flat.
 * @param {string[][]} terrain @param {number} x @param {number} y @returns {boolean}
 */
function stairsConnectsElevation(terrain, x, y) {
  if (!isWalkableTile(terrain, x, y)) return false;
  const touchesCliff = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]]
    .some(([nx, ny]) => terrain[ny]?.[nx] === 'cliff');
  const throughPath =
    (isWalkableTile(terrain, x, y - 1) && isWalkableTile(terrain, x, y + 1)) ||
    (isWalkableTile(terrain, x - 1, y) && isWalkableTile(terrain, x + 1, y));
  return touchesCliff && throughPath;
}

/**
 * Deterministically choose an empty all-'grass' square plateau that has a valid
 * stairs seam, preferring the larger edge and scanning candidates in row-major
 * order. Returns { px, py, size, seam } or null (flat fallback). One rng draw
 * when >= 1 candidate exists.
 * @param {string[][]} terrain @param {number} mapW @param {number} mapH @param {Rng} rng
 * @returns {{px:number,py:number,size:number,seam:{x:number,y:number}} | null}
 */
function choosePlateau(terrain, mapW, mapH, rng) {
  const allGrass = (px, py, size) => {
    for (let y = py; y < py + size; y++) {
      for (let x = px; x < px + size; x++) if (terrain[y]?.[x] !== 'grass') return false;
    }
    return true;
  };
  for (let size = PLATEAU_MAX_EDGE; size >= PLATEAU_MIN_EDGE; size--) {
    const spots = [];
    for (let py = 0; py + size <= mapH; py++) {
      for (let px = 0; px + size <= mapW; px++) {
        if (!allGrass(px, py, size)) continue;
        const seam = chooseStairsSeam(terrain, px, py, size);
        if (seam) spots.push({ px, py, size, seam });
      }
    }
    if (spots.length > 0) return rng.pick(spots);
  }
  return null;
}

/** The [x,y,tile] edits raising a plateau: perimeter -> cliff except the one
 *  'stairs' seam; the interior stays walkable grass (a raised area).
 *  @returns {Array<[number,number,string]>}
 *  @param {number} px @param {number} py @param {number} size @param {{x:number,y:number}} seam */
function plateauCells(px, py, size, seam) {
  const cells = [];
  for (let y = py; y < py + size; y++) {
    for (let x = px; x < px + size; x++) {
      if (!(x === px || y === py || x === px + size - 1 || y === py + size - 1)) continue; // interior stays grass
      cells.push([x, y, x === seam.x && y === seam.y ? 'stairs' : 'cliff']);
    }
  }
  return cells;
}

// --- connections (informational, from model.guild) --------------------------

/**
 * TownConnection[] from the 接続者ギルド roster (see detect.mjs): なかま members
 * (LLM SDKs / external services) as outbound links from the pub building (or the
 * townId when no pub is placed), うけつけ reception files as inbound 'route'
 * links, and inbound いらい hints as 'webhook' links. Deduplicated by
 * (kind, from, to) and sorted; purely informational, occupies no tiles.
 * @param {TownModel} model @param {string} townId @param {boolean} pubPlaced
 * @returns {TownConnection[]}
 */
function buildConnections(model, townId, pubPlaced) {
  const guild = isPlainObject(model?.guild) ? model.guild : {};
  const anchor = pubPlaced ? 'building-pub' : townId;
  const seen = new Set();
  const connections = [];
  const add = (from, to, kind) => {
    if (typeof from !== 'string' || from === '' || typeof to !== 'string' || to === '') return;
    const dedupe = `${kind}|${from}|${to}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    connections.push({ from, to, kind });
  };

  for (const member of arr(guild[GUILD_MEMBERS_TAB])) {
    if (!isPlainObject(member)) continue;
    add(anchor, typeof member.name === 'string' ? member.name : '', member.type === 'llm-sdk' ? 'llm-sdk' : 'external-service');
  }
  for (const entry of arr(guild[GUILD_RECEPTION_TAB])) {
    if (!isPlainObject(entry)) continue;
    add(typeof entry.path === 'string' ? entry.path : '', anchor, 'route');
  }
  for (const request of arr(guild[GUILD_REQUESTS_TAB])) {
    if (!isPlainObject(request) || request.direction !== 'inbound') continue;
    add(typeof request.label === 'string' && request.label !== '' ? request.label : 'webhook', anchor, 'webhook');
  }

  return connections.sort((a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.from, b.from) || compareStrings(a.to, b.to));
}

// --- entry point -------------------------------------------------------------

/**
 * Deterministically generate a TownLayout from one TownModel plus the
 * (repoFingerprint, generatorVersion, seed) determinism key. Pure: identical
 * inputs always produce a structurally identical (deepEqual) TownLayout; the
 * only randomness is the seeded PRNG built from `seed` via rng.mjs's makeRng.
 *
 * `habitability` is accepted for API symmetry with buildTown()'s result bundle
 * but does NOT steer placement — each building's `state` derives only from its
 * own Facility evidence (see deriveBuildingState), keeping evidence honesty
 * local to the building it describes rather than importing a town-wide verdict.
 *
 * The output `generatorVersion` is always the frozen GENERATOR_VERSION, since
 * the schema.mjs TownLayout contract requires it to equal that constant; the
 * `generatorVersion` argument is accepted for signature completeness.
 *
 * The returned object is a plain, unfrozen TownLayout with a placeholder
 * `validation` — ./validator.mjs validateLayout/annotateLayout is what actually
 * checks the layout and fills that field in.
 *
 * @param {object} input
 * @param {TownModel} input.model - output of ./detect.mjs buildTownModel
 * @param {Habitability} [input.habitability] - accepted for API symmetry; not consumed by placement
 * @param {string} input.seed - PRNG seed string (a non-string is coerced deterministically, never thrown on)
 * @param {string} [input.generatorVersion] - determinism-key part; output always reports GENERATOR_VERSION
 * @param {string} input.repoFingerprint - stable repo fingerprint (determinism-key part; passed through verbatim)
 * @returns {TownLayout}
 */
export function generateLayout({ model, habitability, seed, generatorVersion, repoFingerprint } = {}) {
  void habitability; // accepted for API symmetry; see doc comment above
  void generatorVersion; // output always reports GENERATOR_VERSION per contract

  const seedString = normalizeSeedString(seed);
  const rng = makeRng(seedString);
  const fingerprint = typeof repoFingerprint === 'string' ? repoFingerprint : String(repoFingerprint ?? '');
  const townId = `town-${fingerprint.slice(0, 16) || 'unknown'}`;

  // --- 1. which facilities get a building, in fixed placement order --------
  const present = indexPresentFacilities(model?.facilities);
  const placedKinds = resolvePlacedKinds(present);
  const n = placedKinds.length;

  // --- 2. size the grid to a uniform cell = the largest placed footprint ---
  let maxW = 2;
  let maxH = 2;
  for (const kind of placedKinds) {
    const fp = footprintOf(kind);
    if (fp.w > maxW) maxW = fp.w;
    if (fp.h > maxH) maxH = fp.h;
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellStrideX = maxW + COL_GAP;
  const cellStrideY = maxH + ROW_GAP;
  const cellLeftX = (col) => FIRST_CELL_X + col * cellStrideX;
  const bandTopY = (row) => FIRST_CELL_Y + row * cellStrideY;
  const avenueY = (row) => bandTopY(row) + maxH; // shared entrance row for the grid row

  const mapWidth = FIRST_CELL_X + (cols - 1) * cellStrideX + maxW + RIGHT_PAD;
  const mapHeight = avenueY(rows - 1) + 1 /* dock-water/gap row */ + BOTTOM_PAD;
  const terrain = makeTerrain(mapWidth, mapHeight);

  // --- 3. place every building's footprint + down-facing entrance ----------
  /** @type {Map<string, { box:{x:number,y:number,w:number,h:number}, entrance:{x:number,y:number} }>} */
  const placements = new Map();
  const buildings = [];
  const districts = [];

  placedKinds.forEach((kind, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const { w, h } = footprintOf(kind);
    const x = cellLeftX(col); // left-anchored in the cell
    const y = bandTopY(row) + (maxH - h); // bottom-anchored: footprint bottom sits just above the avenue
    const entranceX = x + Math.floor(w / 2);
    const entranceY = avenueY(row); // one tile below the footprint, on the 'down' side

    paintFootprint(terrain, x, y, w, h);
    placements.set(kind, { box: { x, y, w, h }, entrance: { x: entranceX, y: entranceY } });

    const facility = present.get(kind) ?? (kind === 'town_hall' ? fallbackTownHall() : undefined);
    buildings.push({
      id: `building-${kind}`,
      facilityKind: kind,
      x,
      y,
      footprint: { widthTiles: w, heightTiles: h },
      entrance: { x: entranceX, y: entranceY, direction: 'down' },
      state: deriveBuildingState(facility, kind)
    });
    districts.push({ id: `district-${kind}`, kind, x: cellLeftX(col), y: bandTopY(row), widthTiles: maxW, heightTiles: maxH });
  });

  // --- 4. roads: a star from the hub (gate if present, else town_hall) -----
  const hubKind = placedKinds.includes('gate') ? 'gate' : 'town_hall';
  const hub = placements.get(hubKind);
  const roads = [];
  for (const kind of placedKinds) {
    if (kind === hubKind) continue;
    const tiles = manhattanPath(hub.entrance, placements.get(kind).entrance, SPINE_X);
    paintRoad(terrain, tiles);
    roads.push({ id: `road-${hubKind}-${kind}`, fromBuildingId: `building-${hubKind}`, toBuildingId: `building-${kind}`, tiles });
  }
  // Degenerate single-building town: no road pairs, so the hub entrance stays
  // 'grass' — still walkable, so its ENTRANCE_CLEAR holds with no road needed.

  // --- 5. dock touches water: a short strip just below its entrance ---------
  if (placedKinds.includes('dock')) {
    const dockEntrance = placements.get('dock').entrance;
    for (const dx of [0, -1, 1]) tryPlaceWater(terrain, dockEntrance.x + dx, dockEntrance.y + 1);
  }

  // --- 5.5 terrain features (v1.1.0): waterway+bridge, then elevation+stairs -
  // Carved here so the npcs/props placed below (on entrances, road tiles, and
  // grass) naturally avoid the new water/cliff tiles. Each feature is kept only
  // if the HARD SAFETY re-check still holds; otherwise it reverts and the town
  // stays flat there — never regressing REACHABLE / WALKABLE / DOCK_ON_WATER.
  const hubEntrance = hub.entrance;
  const networkSafe = () => terrainNetworkSafe(terrain, mapWidth, mapHeight, placements, hubEntrance);

  // Waterway: kept only if the network stays intact AND every new bridge truly
  // spans the water (validator BRIDGE_SPANS_WATER), else reverted to flat.
  const waterColumn = chooseWaterwayColumn(terrain, mapWidth, mapHeight, placements, rng);
  if (waterColumn !== null) {
    const cells = waterwayColumnCells(terrain, mapHeight, waterColumn);
    commitFeature(terrain, cells, () => networkSafe()
      && cells.every(([cx, cy, tile]) => tile !== 'bridge' || bridgeSpansWater(terrain, cx, cy)));
  }

  // Plateau: kept only if the network stays intact AND its stairs connects the
  // elevation (validator STAIRS_CONNECT_ELEVATION), else reverted to flat.
  const plateau = choosePlateau(terrain, mapWidth, mapHeight, rng);
  if (plateau) {
    const cells = plateauCells(plateau.px, plateau.py, plateau.size, plateau.seam);
    commitFeature(terrain, cells, () => networkSafe()
      && stairsConnectsElevation(terrain, plateau.seam.x, plateau.seam.y));
  }

  // --- 6. one representative NPC per placed facility, at its entrance -------
  // Entrances are walkable, just outside the footprint, and (well/ruin aside)
  // have a dedicated role. The 'up' facing looks back at the building's door.
  // rng draws here (well/ruin fallback role) happen in fixed placedKinds order.
  const npcs = [];
  const occupied = new Set();
  for (const kind of placedKinds) {
    const { entrance } = placements.get(kind);
    const role = NPC_ROLE_BY_FACILITY[kind] ?? rng.pick(MOB_ROLES);
    npcs.push({ id: `npc-${kind}`, role, x: entrance.x, y: entrance.y, facing: 'up' });
    occupied.add(keyOf(entrance.x, entrance.y)); // reserve entrances: keeps later props off them
  }

  // --- 7. props (flavor + density), then ambient mob NPCs ------------------
  // Fixed rng order: special props (per placedKinds) -> generic props -> mobs.
  const props = [];
  let propCounter = 0;
  const placeProp = (kind, candidates) => {
    if (candidates.length === 0) return;
    const [x, y] = rng.pick(candidates);
    occupied.add(keyOf(x, y));
    props.push({ id: `prop-${String(propCounter++).padStart(3, '0')}-${kind}`, kind, x, y });
  };

  for (const kind of placedKinds) {
    const specials = SPECIAL_PROPS_BY_FACILITY[kind];
    if (!specials) continue;
    for (const propKind of specials) {
      placeProp(propKind, nearbyGrass(terrain, placements.get(kind).box, NEARBY_RADIUS, mapWidth, mapHeight, occupied));
    }
  }

  // Shared global pool of grass tiles near ANY placed building, built once,
  // in deterministic (y, x) order, then consumed via the seeded PRNG.
  const seenGrass = new Set();
  const grassPool = [];
  for (const kind of placedKinds) {
    for (const [x, y] of nearbyGrass(terrain, placements.get(kind).box, NEARBY_RADIUS, mapWidth, mapHeight, occupied)) {
      const key = keyOf(x, y);
      if (seenGrass.has(key)) continue;
      seenGrass.add(key);
      grassPool.push([x, y]);
    }
  }
  const genericPropCount = rng.int(3, 6);
  for (let i = 0; i < genericPropCount; i++) {
    const tile = takeRandomTile(rng, grassPool);
    if (!tile) break;
    const propKind = rng.pick(GENERIC_PROP_POOL);
    occupied.add(keyOf(tile[0], tile[1]));
    props.push({ id: `prop-${String(propCounter++).padStart(3, '0')}-${propKind}`, kind: propKind, x: tile[0], y: tile[1] });
  }

  // Ambient mobs on already-carved road tiles (never a wall/interior/entrance).
  const mobCandidates = [];
  const seenRoad = new Set();
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      if (terrain[y][x] !== 'road') continue;
      const key = keyOf(x, y);
      if (occupied.has(key) || seenRoad.has(key)) continue; // occupied already holds every entrance
      seenRoad.add(key);
      mobCandidates.push([x, y]);
    }
  }
  const mobCount = rng.int(2, 4);
  const shuffledMobTiles = rng.shuffle(mobCandidates);
  for (let i = 0; i < Math.min(mobCount, shuffledMobTiles.length); i++) {
    const [x, y] = shuffledMobTiles[i];
    npcs.push({ id: `npc-mob-${String(i).padStart(2, '0')}`, role: rng.pick(MOB_ROLES), x, y, facing: rng.pick(DIRECTIONS) });
  }

  // --- 8. connections[] (informational, from model.guild) ------------------
  const connections = buildConnections(model, townId, placedKinds.includes('pub'));

  // --- 9. assemble, sorting every collection deterministically -------------
  return {
    townId,
    repoFingerprint: fingerprint,
    generatorVersion: GENERATOR_VERSION,
    seed: seedString,
    map: { widthTiles: mapWidth, heightTiles: mapHeight, tileSize: TILE_SIZE_PX, terrain },
    districts: sortByKey(districts, (d) => d.id),
    buildings: sortByKey(buildings, (b) => b.id),
    roads: sortByKey(roads, (r) => r.id),
    npcs: sortByKey(npcs, (npcEntry) => npcEntry.id),
    props: sortByKey(props, (p) => p.id),
    connections,
    validation: {
      ok: false,
      issues: [{ code: 'not_validated', message: 'Layout has not been validated yet; run validateLayout from ./validator.mjs.', severity: 'info' }],
      densityScore: 0,
      walkable: false,
      importantBuildingsReachable: false,
      noOverlap: false
    }
  };
}
