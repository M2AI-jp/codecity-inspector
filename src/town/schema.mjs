// src/town/schema.mjs
//
// Shared vocabulary and contract for the "habitable town" subsystem
// (src/town/**). Every sibling module — signal detection, facility
// derivation, habitability scoring, layout generation, and the render
// adapters — imports its ids, labels, and shapes from here instead of
// re-declaring them, so the "facility = technical meaning" mapping and the
// observed / inferred / unknown evidence split live in exactly one place.
//
// This file is PURE and DEPENDENCY-FREE: no imports, no Node builtins, no
// I/O, and no Date.now / Math.random / new Date(). It never reads or runs
// target-repo code — it only defines vocabulary and data shapes. Every
// exported constant is deeply frozen so a downstream module can never mutate
// the shared contract out from under its siblings.
//
// EVIDENCE SEPARATION (see EVIDENCE_CLASSES) is load-bearing: every fact the
// subsystem surfaces is tagged observed (statically read), inferred (derived
// from observed facts), or unknown (needs runtime / not scanned). "Untested"
// or "not reached" is UNKNOWN, never a synonym for "broken".

/**
 * Recursively freeze a plain-data tree (plain objects and arrays) in place
 * and return it. Primitives, functions, and exotic objects (class instances,
 * Map, Set, Date, ...) are returned untouched rather than frozen, since only
 * plain data literals are meant to travel through this contract. Circular
 * references are handled: a self-referential object will not overflow the
 * stack. Always recurses to full depth, so a shallow-frozen input still gets
 * its nested children frozen.
 *
 * @template T
 * @param {T} value
 * @returns {T} the same reference, deeply frozen when it was a plain object or array
 */
export function deepFreeze(value) {
  const seen = new WeakSet();
  const freeze = (node) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return node;
    const proto = Object.getPrototypeOf(node);
    if (!Array.isArray(node) && proto !== Object.prototype && proto !== null) return node;
    seen.add(node);
    for (const key of Object.keys(node)) freeze(node[key]);
    return Object.freeze(node);
  };
  return freeze(value);
}

/**
 * The three evidence classes that must never be conflated: observed
 * (statically read facts), inferred (derived guesses), unknown (needs
 * runtime / not scanned). Order matches the keys of every Evidence bag.
 * @type {ReadonlyArray<'observed' | 'inferred' | 'unknown'>}
 */
export const EVIDENCE_CLASSES = deepFreeze(['observed', 'inferred', 'unknown']);

/**
 * Facility kind id -> Japanese JRPG display label, and the single source of
 * truth for which facility kinds exist. facility = technical meaning:
 * inn = public web service; pub = API / external connections / LLM API /
 * webhook; guild = roster of connections; town_hall = repo / git / issue /
 * release + external code-gen build reports; dock = mobile / package
 * distribution; warehouse = DB / storage; well = env / secrets / config;
 * workshop = build / local run / CI; dojo = tests / verification;
 * watchtower = logs / monitoring / alerts; house & shop = feature / module /
 * component; ruin = legacy / unused / TODO (allowed flavor, NOT a failure);
 * gate = entry.
 * @type {Readonly<Record<string, string>>}
 */
export const FACILITY_LABELS = deepFreeze({
  inn: '宿屋',
  pub: '酒場',
  guild: '接続者ギルド',
  town_hall: '役場',
  dock: '船着場',
  warehouse: '倉庫',
  well: '井戸',
  workshop: '工房',
  dojo: '道場',
  watchtower: '見張り台',
  house: '住宅',
  shop: '商店',
  ruin: '廃屋',
  gate: '門'
});

/**
 * Every valid facility kind id, in canonical display order. Derived from
 * FACILITY_LABELS keys so the id list and the label map can never drift.
 * @type {ReadonlyArray<string>}
 */
export const FACILITY_KINDS = deepFreeze(Object.keys(FACILITY_LABELS));

const FACILITY_KIND_SET = new Set(FACILITY_KINDS);

/**
 * Non-throwing type guard: true when `x` is one of FACILITY_KINDS. Any
 * non-string input (null, undefined, number, object, ...) returns false,
 * since callers may pass unvalidated data straight from a scan result.
 * @param {unknown} x
 * @returns {boolean}
 */
export function isFacilityKind(x) {
  return typeof x === 'string' && FACILITY_KIND_SET.has(x);
}

/**
 * The habitability ladder, Lv.0 (blueprint only) through Lv.5 (a town worth
 * showing off). `id` doubles as the array index. GOAL is habitable, not
 * clean: dirt (old huts, TODO grass, weird buildings) never lowers the level
 * by itself — only missing life-infra (won't start, no entry, unreachable,
 * no DB, no env, no logs, no tests, no rollback, no LLM cost control) does.
 * @type {ReadonlyArray<{ id: number, name: string }>}
 */
export const HABITABILITY_LEVELS = deepFreeze([
  { id: 0, name: '設計図だけの街' },
  { id: 1, name: '通電した開拓地' },
  { id: 2, name: '主要動線が通る小村' },
  { id: 3, name: '住める街' },
  { id: 4, name: 'にぎわう街' },
  { id: 5, name: '見せたくなる街' }
]);

/**
 * Categories used when cataloguing pixel-art assets for the town renderer.
 * @type {ReadonlyArray<string>}
 */
export const ASSET_CATEGORIES = deepFreeze([
  'tile',
  'building_exterior',
  'building_interior',
  'npc',
  'mob',
  'creature',
  'prop',
  'vehicle',
  'effect',
  'ui'
]);

/**
 * Back-to-front draw order for a single map cell. A renderer sorts sprites
 * by the index of their drawLayer within this list before painting.
 * @type {ReadonlyArray<string>}
 */
export const DRAW_LAYERS = deepFreeze(['ground', 'object', 'building', 'character', 'roof', 'effect', 'ui']);

/**
 * Tab labels for the 接続者ギルド (connections guild) panel, left to right.
 * @type {ReadonlyArray<string>}
 */
export const GUILD_TABS = deepFreeze(['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい']);

// --- Spatial layout vocabulary (Phase 2: deterministic town.layout.json) -----
// The frozen lists below are the shared contract that the layout GENERATOR
// (./generator.mjs) and the layout VALIDATOR (./validator.mjs) must agree on
// byte-for-byte. Like every other export in this file they are pure data: no
// imports, no clock, no randomness, no I/O. The ONLY randomness in the whole
// layout subsystem is the seeded PRNG in ./rng.mjs; nothing here ever samples
// it. All coordinates in a TownLayout are integer TILE units, origin top-left,
// x rightward and y downward.

/**
 * Layout generator contract version, and part of the determinism key together
 * with a layout's repoFingerprint and seed: the SAME (repoFingerprint,
 * generatorVersion, seed) MUST reproduce a byte-identical town.layout.json.
 * Bump this only when a layout-shape or placement-algorithm change intentionally
 * invalidates previously cached layouts.
 * @type {string}
 */
export const GENERATOR_VERSION = '1.0.0';

/**
 * Every valid terrain tile id: the allowed cell values of a
 * TownLayout.map.terrain grid, which is row-major (terrain[y][x]). 'floor' is a
 * building interior and 'wall' a building shell; 'water' is what a dock must sit
 * against; 'path' / 'road' / 'bridge' / 'plaza' carry the walkable road network;
 * 'rock' / 'tree' are natural obstacles.
 * @type {ReadonlyArray<string>}
 */
export const TILE_TYPES = deepFreeze([
  'grass', 'dirt', 'path', 'road', 'sand', 'water',
  'bridge', 'plaza', 'floor', 'wall', 'rock', 'tree'
]);

/**
 * The subset of TILE_TYPES an entity may stand on or move across. Every tile
 * NOT in this list — water, wall, rock, tree — blocks movement. The validator
 * uses exactly this set to decide walkability, unblocked entrances, and whether
 * required buildings are reachable; the generator must route roads and place
 * entrance cells only on these tiles.
 * @type {ReadonlyArray<string>}
 */
export const WALKABLE_TILE_TYPES = deepFreeze([
  'grass', 'dirt', 'path', 'road', 'sand', 'bridge', 'plaza', 'floor'
]);

/**
 * The four cardinal facings, used by a building entrance's `direction` (which
 * way the door opens onto its adjacent walkable tile) and by an NPC's `facing`.
 * @type {ReadonlyArray<'up' | 'down' | 'left' | 'right'>}
 */
export const DIRECTIONS = deepFreeze(['up', 'down', 'left', 'right']);

/**
 * NPC role ids. The facility-anchored roles give a placed facility one
 * representative inhabitant — innkeeper -> inn, barkeep -> pub, guildmaster ->
 * guild, clerk -> town_hall, ferryman -> dock, warehouse_keeper -> warehouse,
 * foreman -> workshop, inspector -> dojo, watch -> watchtower, resident ->
 * house, shopkeeper -> shop, gatekeeper -> gate; a facility with no dedicated
 * role (well, ruin) falls back to a mob. The trailing three (townsfolk,
 * traveler, child) are ambient mobs with no facility meaning.
 * @type {ReadonlyArray<string>}
 */
export const NPC_ROLES = deepFreeze([
  'innkeeper', 'barkeep', 'guildmaster', 'clerk', 'ferryman', 'warehouse_keeper',
  'foreman', 'inspector', 'watch', 'resident', 'shopkeeper', 'gatekeeper',
  'townsfolk', 'traveler', 'child'
]);

/**
 * Decorative / interactive prop ids for TownLayout.props. 'well' renders the
 * 井戸 (env / secrets) facility; 'scaffold' marks a workshop or an
 * under-construction building; 'todo_grass' is the allowed TODO / dirt flavor;
 * 'rubble' dresses a ruin. The rest (barrel, crate, signboard, lamp, plant,
 * fence, flag, bench) are generic set-dressing.
 * @type {ReadonlyArray<string>}
 */
export const PROP_KINDS = deepFreeze([
  'well', 'barrel', 'crate', 'signboard', 'lamp', 'plant',
  'todo_grass', 'scaffold', 'fence', 'flag', 'bench', 'rubble'
]);

/**
 * Canonical values for TownBuilding.state — an advisory render hint derived from
 * a facility's evidence, NOT a habitability verdict: 'occupied' = present and
 * backed by observed / inferred evidence; 'vacant' = present but backed only by
 * unknown-class evidence ("not lit up yet"); 'busy' = a high-count facility;
 * 'under_construction' = a pending contractor build / workshop; 'ruined' = a
 * ruin (allowed flavor, never a failure).
 * @type {ReadonlyArray<string>}
 */
export const BUILDING_STATES = deepFreeze([
  'occupied', 'vacant', 'busy', 'under_construction', 'ruined'
]);

/**
 * Severity levels for a TownLayout.validation issue. An 'error' means the layout
 * violates a hard spatial invariant (overlap, blocked entrance, dock off water,
 * an unreachable required facility) and validation.ok MUST be false; 'warning'
 * and 'info' are advisory and never, by themselves, flip validation.ok.
 * @type {ReadonlyArray<'error' | 'warning' | 'info'>}
 */
export const VALIDATION_SEVERITIES = deepFreeze(['error', 'warning', 'info']);

const TILE_TYPE_SET = new Set(TILE_TYPES);
const NPC_ROLE_SET = new Set(NPC_ROLES);
const PROP_KIND_SET = new Set(PROP_KINDS);

/**
 * Non-throwing type guard: true when `x` is one of TILE_TYPES. Any non-string
 * input (null, undefined, number, object, ...) returns false, since callers may
 * pass unvalidated layout data straight from a generated file.
 * @param {unknown} x
 * @returns {boolean}
 */
export function isTileType(x) {
  return typeof x === 'string' && TILE_TYPE_SET.has(x);
}

/**
 * Non-throwing type guard: true when `x` is one of NPC_ROLES.
 * @param {unknown} x
 * @returns {boolean}
 */
export function isNpcRole(x) {
  return typeof x === 'string' && NPC_ROLE_SET.has(x);
}

/**
 * Non-throwing type guard: true when `x` is one of PROP_KINDS.
 * @param {unknown} x
 * @returns {boolean}
 */
export function isPropKind(x) {
  return typeof x === 'string' && PROP_KIND_SET.has(x);
}

/**
 * Build a fresh, independent, mutable Evidence bag. Each call returns new
 * arrays so callers can safely push while assembling a Facility; deep-freeze
 * it yourself once it is done being populated. Never merge the three arrays,
 * and never treat `unknown` as a negative finding.
 * @returns {Evidence}
 */
export function makeEvidence() {
  return { observed: [], inferred: [], unknown: [] };
}

// --- Shared type contracts (JSDoc @typedef only; no runtime binding) ---------

/**
 * @typedef {Object} Evidence
 * @property {string[]} observed - statically read facts, e.g. "package.json main points here"
 * @property {string[]} inferred - facts derived from observed evidence, e.g. "reachable from an entrypoint"
 * @property {string[]} unknown - things static scanning cannot decide without running the code
 */

/**
 * One town facility: the town-scale projection of a single technical concern
 * onto the scanned repository's evidence.
 * @typedef {Object} Facility
 * @property {string} kind - one of FACILITY_KINDS
 * @property {boolean} present - whether any evidence for this facility was found at all
 * @property {number} count - how many buildings / signals contribute to it
 * @property {Evidence} evidence - observed / inferred / unknown backing `present` and `count`
 * @property {object} [details] - facility-kind-specific extra data (shape varies by kind)
 */

/**
 * A self-report from an external code-gen contractor (Claude Code, Codex,
 * Cursor, ...). Per project rule this is ALWAYS pending-inspection: a
 * contractor's own "done / fixed / tested" claim is never itself evidence of
 * a working town, only a claim that town_hall inspection may confirm against
 * real observed signals.
 * @typedef {Object} ContractorReport
 * @property {string} source - which contractor produced it, e.g. "claude-code", "codex", "cursor"
 * @property {string} subject - what it claims was done, in the contractor's own words
 * @property {"pending-inspection"} status - always this literal; only observed real change counts
 */

/**
 * The full town-domain model derived from one inspection result: every
 * facility, the connections-guild roster, and any contractor self-reports
 * awaiting inspection, plus a passthrough summary for display.
 * @typedef {Object} TownModel
 * @property {object} repository - passthrough of inspection.repository
 * @property {Facility[]} facilities - one entry per evaluated facility kind
 * @property {object} guild - roster / state backing the GUILD_TABS panels (shape owned by the guild module)
 * @property {{ contractorReports: ContractorReport[] }} external - everything sourced from outside the scanned repo
 * @property {object} summary - derived / passthrough summary counts for quick display
 */

/**
 * One entry in the town's sprite / tile asset manifest. Mirrors the asset
 * manifest type from the town-redesign issue. footprint / collision /
 * entrances are expressed in tile-grid units, not pixels. The optional
 * sub-shapes are a best-effort mirror pending the renderer / generator
 * modules; treat the field names as the stable part of the contract.
 * @typedef {Object} AssetManifestItem
 * @property {string} id - unique, regeneration-stable asset id
 * @property {string} category - one of ASSET_CATEGORIES
 * @property {string[]} tags - free-form search / filter tags (e.g. "wood", "night", "broken")
 * @property {{ width: number, height: number }} [footprint] - occupied tile-grid size, defaults to 1x1 when absent
 * @property {boolean} [collision] - whether the asset blocks movement over its footprint
 * @property {Array<{ x: number, y: number }>} [entrances] - walkable entry cells relative to the asset origin
 * @property {string[]} [variants] - alternate visual variant ids of this same asset
 * @property {string[]} [paletteVariants] - alternate colour-palette ids applicable to this asset
 * @property {string[]} [animationStates] - named animation states (e.g. "idle", "work", "broken")
 * @property {string} drawLayer - one of DRAW_LAYERS
 * @property {string[]} [suitableFor] - facility kind ids this asset suits (see FACILITY_KINDS)
 */

/**
 * A tile coordinate pair [x, y] in integer tile units, origin top-left (x
 * rightward, y downward). Used for the ordered points of a road polyline.
 * @typedef {[number, number]} TileXY
 */

/**
 * The tile-grid terrain map. `terrain` is row-major: terrain[y][x] for every
 * 0 <= y < heightTiles and 0 <= x < widthTiles, each cell one of TILE_TYPES.
 * tileSize is the pixel edge of one tile for the renderer only — it never enters
 * the placement math, which is entirely in tile units.
 * @typedef {Object} TownTileMap
 * @property {number} widthTiles - grid width in tiles (integer > 0)
 * @property {number} heightTiles - grid height in tiles (integer > 0)
 * @property {number} tileSize - pixel size of one tile edge (render hint only)
 * @property {string[][]} terrain - terrain[y][x], each cell one of TILE_TYPES; heightTiles rows of widthTiles ids
 */

/**
 * A rectangular zone grouping related buildings (e.g. a harbor around the dock,
 * a civic square around town_hall). Axis-aligned, in tile units.
 * @typedef {Object} TownDistrict
 * @property {string} id - unique, regeneration-stable district id
 * @property {string} kind - zone label (often a FACILITY_KIND, or a grouping name); informational only
 * @property {number} x - left tile x of the district rectangle
 * @property {number} y - top tile y of the district rectangle
 * @property {number} widthTiles - district width in tiles (integer > 0)
 * @property {number} heightTiles - district height in tiles (integer > 0)
 */

/**
 * One placed building instance: an axis-aligned footprint rectangle plus one
 * entrance cell. Buildings never overlap each other, and the entrance is a
 * walkable tile (see WALKABLE_TILE_TYPES) immediately outside the footprint on
 * the side named by `direction`. A building is placed ONLY for a facility the
 * TownModel reports present, plus the always-present town_hall and the gate —
 * never for a facility the model says is absent (evidence honesty).
 * @typedef {Object} TownBuilding
 * @property {string} id - unique, regeneration-stable building id
 * @property {string} facilityKind - one of FACILITY_KINDS (the facility this building renders)
 * @property {number} x - left tile x of the footprint
 * @property {number} y - top tile y of the footprint
 * @property {{ widthTiles: number, heightTiles: number }} footprint - occupied tile-grid size (integers > 0)
 * @property {{ x: number, y: number, direction: string }} entrance - walkable entry tile just outside the footprint; direction is one of DIRECTIONS
 * @property {string} state - one of BUILDING_STATES (advisory render hint, not a habitability verdict)
 */

/**
 * A walkable road connecting two buildings' entrances. `tiles` is the ordered
 * polyline of tile cells the road paints, from the fromBuilding entrance to the
 * toBuilding entrance; every cell is walkable (see WALKABLE_TILE_TYPES).
 * @typedef {Object} TownRoad
 * @property {string} id - unique, regeneration-stable road id
 * @property {string} fromBuildingId - id of the TownBuilding at one end
 * @property {string} toBuildingId - id of the TownBuilding at the other end
 * @property {TileXY[]} tiles - ordered [x, y] cells from the from-entrance to the to-entrance
 */

/**
 * A placed NPC standing on a walkable tile.
 * @typedef {Object} TownNpc
 * @property {string} id - unique, regeneration-stable NPC id
 * @property {string} role - one of NPC_ROLES
 * @property {number} x - tile x
 * @property {number} y - tile y
 * @property {string} facing - one of DIRECTIONS
 */

/**
 * A placed decorative / interactive prop occupying a single tile cell.
 * @typedef {Object} TownProp
 * @property {string} id - unique, regeneration-stable prop id
 * @property {string} kind - one of PROP_KINDS
 * @property {number} x - tile x
 * @property {number} y - tile y
 */

/**
 * An external connection drawn from the 接続者ギルド roster — informational only,
 * it occupies no tiles. Mirrors a guild member / reception entry from the
 * TownModel (the pub's outside-world links).
 * @typedef {Object} TownConnection
 * @property {string} from - source endpoint id (usually a building id, or the townId)
 * @property {string} to - target label (e.g. an LLM SDK, external service, or webhook name)
 * @property {string} kind - connection kind (e.g. 'llm-sdk', 'external-service', 'webhook', 'route')
 */

/**
 * The layout self-check produced by ./validator.mjs. `ok` is the single gate: it
 * MUST be false whenever any issue has severity 'error' (see
 * VALIDATION_SEVERITIES) OR any of the three hard-invariant booleans (walkable,
 * importantBuildingsReachable, noOverlap) is false. densityScore is the fraction
 * of the map covered by building footprints (0..1), used to keep the town from
 * being too sparse or too cramped.
 * @typedef {Object} TownLayoutValidation
 * @property {boolean} ok - overall pass/fail; false if any 'error' issue or any hard invariant below is false
 * @property {Array<{ code: string, message: string, severity: string }>} issues - findings; severity is one of VALIDATION_SEVERITIES
 * @property {number} densityScore - building-footprint coverage of the map, 0..1
 * @property {boolean} walkable - every road cell is walkable and the roads form a connected network
 * @property {boolean} importantBuildingsReachable - every required facility's entrance is reachable via roads
 * @property {boolean} noOverlap - no two building footprints overlap, and no footprint sits on a blocked tile
 */

/**
 * A fully generated, deterministic town layout ready to render, in integer tile
 * coordinates with origin top-left. Generation MUST be a pure function of
 * (repoFingerprint, generatorVersion, seed) plus the TownModel it is built from
 * — the SAME triple MUST reproduce a byte-identical town.layout.json. The only
 * randomness source is the seeded PRNG in ./rng.mjs; nothing in generation may
 * use Date.now / new Date / Math.random. EVIDENCE HONESTY carries over from the
 * TownModel: a building is placed only for a facility the model reports present
 * (plus the always-present town_hall and the gate), never for an absent one.
 * @typedef {Object} TownLayout
 * @property {string} townId - stable id for this generated town
 * @property {string} repoFingerprint - stable fingerprint of the scanned repository (determinism key part)
 * @property {string} generatorVersion - the GENERATOR_VERSION that produced this layout (determinism key part)
 * @property {string} seed - deterministic PRNG seed string driving every placement (determinism key part)
 * @property {TownTileMap} map - the tile-grid terrain map
 * @property {TownDistrict[]} districts - rectangular zones grouping related buildings
 * @property {TownBuilding[]} buildings - placed buildings (one per present facility, plus town_hall and gate)
 * @property {TownRoad[]} roads - walkable roads connecting building entrances
 * @property {TownNpc[]} npcs - placed NPCs
 * @property {TownProp[]} props - placed decorative / interactive props
 * @property {TownConnection[]} connections - external guild connections (informational, non-spatial)
 * @property {TownLayoutValidation} validation - the ./validator.mjs self-check result
 */

/**
 * The habitability verdict for a town. canLive MUST be false whenever
 * `blockers` is non-empty; `warnings` never affect canLive (dirt is
 * allowed). All four message lists hold human-readable town-language strings;
 * the per-fact observed / inferred / unknown classes live on each
 * Facility.evidence, not here.
 * @typedef {Object} Habitability
 * @property {number} level - numeric id 0-5, matching a HABITABILITY_LEVELS entry's `id`
 * @property {string} levelName - the matching HABITABILITY_LEVELS entry's `name`
 * @property {boolean} canLive - whether the town clears the minimum bar to be inhabitable at all
 * @property {string[]} blockers - missing life-infra that must be fixed before anyone can live here
 * @property {string[]} warnings - non-blocking dirt (old huts, TODO grass) that does not block habitability
 * @property {string[]} pendingInspections - contractor self-reports not yet confirmed by observed evidence
 * @property {string[]} reasons - town-language explanations for the assigned level / canLive
 */
