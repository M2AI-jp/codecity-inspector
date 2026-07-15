export const FORGE_MANIFEST_URL = '/assets/forge/manifest.json';
export const SITE_CANVAS = Object.freeze({ width: 768, height: 512, columns: 12, rows: 8, cellSize: 64 });

const BUILDING_IDS = Object.freeze([
  'building.dock', 'building.dojo', 'building.gate', 'building.guild',
  'building.house.medium', 'building.house.small', 'building.hut', 'building.inn',
  'building.old_house', 'building.pub', 'building.ruin', 'building.shop',
  'building.town_hall', 'building.warehouse', 'building.watchtower',
  'building.well', 'building.workshop'
]);

const FIELD_IDS = Object.freeze([
  'field.bridge_stone', 'field.bridge_wood', 'field.cliff', 'field.cobblestone',
  'field.dirt_path', 'field.dock_floor', 'field.fence_wood', 'field.grass',
  'field.plaza', 'field.river_edge', 'field.road_corner', 'field.road_edge',
  'field.road_intersection', 'field.rock', 'field.snow', 'field.stairs_stone',
  'field.tree', 'field.wall_stone', 'field.water'
]);

const CHARACTER_IDS = Object.freeze([
  'character.dock_ferryman', 'character.dojo_inspector', 'character.gatekeeper',
  'character.guildmaster', 'character.innkeeper', 'character.mob.artisan',
  'character.mob.child', 'character.mob.delivery_person', 'character.mob.dock_worker',
  'character.mob.elder', 'character.mob.inn_guest', 'character.mob.merchant',
  'character.mob.tavern_guest', 'character.mob.townsfolk_female',
  'character.mob.townsfolk_male', 'character.mob.traveler', 'character.player',
  'character.tavern_master', 'character.town_clerk', 'character.warehouse_keeper',
  'character.watchtower_guard', 'character.workshop_artisan'
]);

const OBJECT_IDS = Object.freeze([
  'object.barrel', 'object.bench', 'object.blue_flag', 'object.construction_sign',
  'object.crate', 'object.flowerbed', 'object.grass_patch', 'object.lamp',
  'object.notice_board', 'object.red_flag', 'object.rubble', 'object.signboard',
  'object.stacked_crates', 'object.streetlight', 'object.unverified_tag',
  'object.warning_stake', 'object.well', 'object.yellow_flag'
]);

const EFFECT_IDS = Object.freeze(['effect.construction_dust', 'effect.water_ripple']);

export const REQUIRED_ASSET_IDS = Object.freeze([
  ...BUILDING_IDS,
  ...CHARACTER_IDS,
  ...EFFECT_IDS,
  ...FIELD_IDS,
  ...OBJECT_IDS
].sort());

const EXPECTED_CATEGORY_COUNTS = Object.freeze({ building: 17, character: 22, effect: 2, field: 19, object: 18 });
const DIRECTION_COLUMNS = Object.freeze({ down: 0, up: 1, left: 2, right: 3 });
const FRAME_ROWS = Object.freeze({ idle: 0, walk1: 1, walk2: 2 });

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function expectedContract(assetId) {
  if (assetId.startsWith('building.')) {
    return { category: 'building', kind: 'single', width: 256, height: 256, logicalWidth: 256, logicalHeight: 256 };
  }
  if (assetId.startsWith('field.')) {
    return { category: 'field', kind: 'tileset', width: 64, height: 64, tileSize: 64 };
  }
  if (assetId.startsWith('character.')) {
    return {
      category: 'character', kind: 'spritesheet', width: 96, height: 120,
      logicalWidth: 24, logicalHeight: 40,
      grid: { columns: 4, rows: 3, frameWidth: 24, frameHeight: 40 }
    };
  }
  if (assetId.startsWith('object.')) {
    return { category: 'object', kind: 'single', width: 64, height: 64, logicalWidth: 64, logicalHeight: 64 };
  }
  return {
    category: 'effect', kind: 'spritesheet', width: 128, height: 32,
    logicalWidth: 32, logicalHeight: 32,
    grid: { columns: 4, rows: 1, frameWidth: 32, frameHeight: 32 }
  };
}

export const ASSET_CONTRACTS = deepFreeze(Object.fromEntries(
  REQUIRED_ASSET_IDS.map((assetId) => [assetId, expectedContract(assetId)])
));

function sameGrid(left, right) {
  return left?.columns === right.columns && left?.rows === right.rows
    && left?.frameWidth === right.frameWidth && left?.frameHeight === right.frameHeight;
}

export function validateForgeManifest(manifest) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return deepFreeze({ ok: false, issues: ['manifest is not an object'], assetCount: 0 });
  }
  if (manifest.schemaVersion !== 2) issues.push('schemaVersion must be 2');
  if (manifest.complete !== true) issues.push('complete must be true');
  if (!Array.isArray(manifest.missingAssets) || manifest.missingAssets.length !== 0) issues.push('missingAssets must be empty');
  if (!Array.isArray(manifest.missingBindings) || manifest.missingBindings.length !== 0) issues.push('missingBindings must be empty');
  if (!Array.isArray(manifest.assets)) issues.push('assets must be an array');
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  if (assets.length !== REQUIRED_ASSET_IDS.length) issues.push('assets must contain exactly 78 entries');
  const ids = assets.map((entry) => entry?.assetId);
  if (new Set(ids).size !== ids.length) issues.push('asset IDs must be unique');
  const missing = REQUIRED_ASSET_IDS.filter((id) => !ids.includes(id));
  const unexpected = ids.filter((id) => !REQUIRED_ASSET_IDS.includes(id));
  if (missing.length) issues.push(`required asset IDs are missing: ${missing.join(', ')}`);
  if (unexpected.length) issues.push(`unexpected asset IDs are present: ${unexpected.join(', ')}`);

  const categoryCounts = {};
  for (const entry of assets) {
    const contract = ASSET_CONTRACTS[entry?.assetId];
    if (!contract) continue;
    categoryCounts[entry.category] = (categoryCounts[entry.category] ?? 0) + 1;
    if (entry.category !== contract.category) issues.push(`${entry.assetId}: category mismatch`);
    if (typeof entry.publicPath !== 'string'
      || !/^\/assets\/forge\/v[0-9]+\/[a-f0-9]+\/[a-z0-9_]+\.png$/.test(entry.publicPath)) {
      issues.push(`${entry.assetId}: invalid publicPath`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) issues.push(`${entry.assetId}: invalid sha256`);
    const spec = entry.renderSpec;
    if (spec?.kind !== contract.kind) issues.push(`${entry.assetId}: render kind mismatch`);
    if (contract.tileSize && spec?.tileSize !== contract.tileSize) issues.push(`${entry.assetId}: tile size mismatch`);
    if (contract.logicalWidth && (spec?.logicalSize?.width !== contract.logicalWidth
      || spec?.logicalSize?.height !== contract.logicalHeight)) issues.push(`${entry.assetId}: logical size mismatch`);
    if (contract.grid && !sameGrid(spec?.sprites?.grid, contract.grid)) issues.push(`${entry.assetId}: sprite grid mismatch`);
    if (spec?.nearestNeighbor !== true || spec?.allowAntiAlias !== false) issues.push(`${entry.assetId}: pixel rendering contract mismatch`);
  }
  for (const [category, count] of Object.entries(EXPECTED_CATEGORY_COUNTS)) {
    if ((categoryCounts[category] ?? 0) !== count) issues.push(`${category}: expected ${count} assets`);
  }
  return deepFreeze({ ok: issues.length === 0, issues, assetCount: assets.length, missing, unexpected, categoryCounts });
}

export class ForgeAssetError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'ForgeAssetError';
    this.issues = Object.freeze([...issues]);
  }
}

export function createAssetResolver(manifest) {
  const validation = validateForgeManifest(manifest);
  if (!validation.ok) {
    throw new ForgeAssetError('承認済み必須素材78件の公開マニフェストが不完全です。代替素材は使用しません。', validation.issues);
  }
  const byId = new Map(manifest.assets.map((entry) => [entry.assetId, deepFreeze(structuredClone(entry))]));
  return Object.freeze({
    manifest: deepFreeze(structuredClone(manifest)),
    get(assetId) {
      const entry = byId.get(assetId);
      if (!entry) throw new ForgeAssetError(`必須素材 ${assetId} が公開マニフェストにありません。代替素材は使用しません。`);
      return entry;
    },
    has: (assetId) => byId.has(assetId),
    ids: Object.freeze([...byId.keys()].sort())
  });
}

function imagePromise(entry, imageFactory) {
  return new Promise((resolve, reject) => {
    const image = imageFactory();
    image.decoding = 'async';
    image.addEventListener('load', () => {
      const contract = ASSET_CONTRACTS[entry.assetId];
      if (image.naturalWidth !== contract.width || image.naturalHeight !== contract.height) {
        reject(new ForgeAssetError(`${entry.assetId} の画像寸法が完成設計と一致しません。代替素材は使用しません。`));
        return;
      }
      resolve([entry.assetId, image]);
    }, { once: true });
    image.addEventListener('error', () => {
      reject(new ForgeAssetError(`${entry.assetId} を読み込めません。代替素材は使用しません。`));
    }, { once: true });
    image.src = entry.publicPath;
  });
}

export async function loadForgeAssetImages({
  fetchImpl = globalThis.fetch,
  imageFactory = () => new Image(),
  manifestUrl = FORGE_MANIFEST_URL
} = {}) {
  let response;
  try {
    response = await fetchImpl(manifestUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch (error) {
    throw new ForgeAssetError('承認済み必須素材の公開マニフェストを取得できません。代替素材は使用しません。', [error?.message]);
  }
  if (!response?.ok) {
    throw new ForgeAssetError(`承認済み必須素材の公開マニフェストを取得できません（HTTP ${response?.status ?? '-'}）。代替素材は使用しません。`);
  }
  let manifest;
  try {
    manifest = await response.json();
  } catch (error) {
    throw new ForgeAssetError('承認済み必須素材の公開マニフェストを解析できません。代替素材は使用しません。', [error?.message]);
  }
  const resolver = createAssetResolver(manifest);
  const loaded = await Promise.all(resolver.ids.map((id) => imagePromise(resolver.get(id), imageFactory)));
  return Object.freeze({ resolver, images: new Map(loaded) });
}

export const SITE_RENDER_LAYERS = Object.freeze([
  'ground', 'terrain-underlay', 'rear-decor', 'building', 'y-sorted', 'front-occluders-effects'
]);

const ROUTE_FIELD_IDS = new Set([
  'field.bridge_stone', 'field.bridge_wood', 'field.cobblestone', 'field.dirt_path',
  'field.dock_floor', 'field.plaza', 'field.road_corner', 'field.road_edge',
  'field.road_intersection', 'field.snow', 'field.stairs_stone'
]);
const BRIDGE_FIELD_IDS = new Set(['field.bridge_stone', 'field.bridge_wood']);
const BOUNDARY_FIELD_IDS = new Set(['field.cliff', 'field.wall_stone']);
const FEATURE_FIELD_IDS = new Set(['field.tree', 'field.rock']);
const VARIED_GROUND_IDS = new Set(['field.grass', 'field.dirt_path', 'field.snow']);
const DIRECTIONAL_FIELD_IDS = new Set([
  'field.bridge_stone', 'field.bridge_wood', 'field.river_edge', 'field.road_corner',
  'field.road_edge', 'field.stairs_stone'
]);

function prop(assetId, x, y, offsetX, offsetY, flipX = false) {
  const entry = { assetId, x, y };
  if (offsetX !== undefined) entry.offsetX = offsetX;
  if (offsetY !== undefined) entry.offsetY = offsetY;
  if (flipX) entry.flipX = true;
  return entry;
}
const WOODLAND_REAR_TREE_LAYOUT = Object.freeze([
  // Three compact, staggered rear clusters. Their gaps preserve irregular sky/roof silhouettes.
  [0, 0, 8, 8], [1, 0, -24, 16, true], [0, 1, 16, -16], [1, 1, -8, -8, true],
  [0, 2, 0, -24, true], [1, 2, -24, -16], [1, 2, 16, -16, true], [0, 2, 16, -8],
  [4, 0, 8, 8], [5, 0, -16, 16, true], [5, 0, 24, 8], [4, 1, 24, -16, true],
  [5, 1, -8, -8], [6, 1, -24, 8, true], [4, 2, 16, -24], [5, 2, -16, -16, true],
  [10, 0, 0, 8], [10, 0, 24, 16, true], [11, 0, -16, 8], [9, 1, 24, -16, true],
  [10, 1, -8, -8], [11, 1, -24, 8, true], [10, 2, 8, -24], [11, 2, -24, -16, true]
]);
const WOODLAND_SIDE_TREE_LAYOUT = Object.freeze([
  // Two side clusters use only two anchor rows, but their 8px offsets stagger every crown.
  [0, 3, 8, 16, true], [1, 3, -24, 0], [1, 3, 16, 24, true], [0, 3, 24, 0],
  [0, 4, 0, -24], [0, 4, 24, -8, true], [1, 4, -16, 8], [1, 4, 24, 24, true],
  [11, 3, -8, 16], [10, 3, 24, 0, true], [10, 3, -16, 24], [11, 3, -24, 0, true],
  [11, 4, 0, -24, true], [11, 4, -24, -8], [10, 4, 16, 8, true], [10, 4, -24, 24]
]);
const WOODLAND_FRONT_TREE_LAYOUT = Object.freeze([
  // Two compact foreground clusters leave a broad, uneven break around the playable path.
  [0, 6, 8, 16, true], [1, 6, -24, 0], [1, 6, 16, 24, true], [2, 6, -24, 8],
  [0, 7, 0, -24], [0, 7, 24, -8, true], [1, 7, -16, -16], [2, 7, -24, -8, true],
  [11, 6, -8, 16], [10, 6, 24, 0, true], [10, 6, -16, 24], [9, 6, 24, 8, true],
  [11, 7, 0, -24, true], [11, 7, -24, -8], [10, 7, 16, -16, true], [9, 7, 24, -8]
]);
function woodlandTrees(layout, mirror = false) {
  return layout.map(([sourceX, y, sourceOffsetX, offsetY, sourceFlipX]) => {
    const x = mirror ? SITE_CANVAS.columns - 1 - sourceX : sourceX;
    const offsetX = mirror ? -sourceOffsetX : sourceOffsetX;
    const flipX = mirror ? !sourceFlipX : sourceFlipX;
    return prop('field.tree', x, y, offsetX, offsetY, flipX);
  });
}
function npc(assetId, x, y, direction = 'down') { return { assetId, x, y, direction }; }
function effect(assetId, x, y, context) { return { assetId, x, y, context }; }
function contextStructure(assetId, x, y, layer = 'depth') {
  return { assetId, x, y, width: 256, height: 256, baselineY: y + 240, role: 'context', layer };
}

function inferGroundTransforms(groundMap, groundLegend) {
  const at = (x, y) => groundLegend[groundMap[y]?.[x]] ?? null;
  const transforms = {};
  for (let y = 0; y < groundMap.length; y += 1) {
    for (let x = 0; x < groundMap[y].length; x += 1) {
      const assetId = at(x, y);
      if (VARIED_GROUND_IDS.has(assetId)) {
        const phase = (x * 3 + y * 5) % 4;
        transforms[`${x},${y}`] = { quarterTurns: phase >= 2 ? 2 : 0, flipX: phase % 2 === 1 };
        continue;
      }
      if (!DIRECTIONAL_FIELD_IDS.has(assetId)) continue;
      let quarterTurns = 0;
      if (assetId === 'field.river_edge') {
        if (at(x + 1, y) === 'field.water') quarterTurns = 3;
        else if (at(x - 1, y) === 'field.water') quarterTurns = 1;
        else if (at(x, y - 1) === 'field.water') quarterTurns = 2;
      } else if (BRIDGE_FIELD_IDS.has(assetId)) {
        quarterTurns = at(x - 1, y) === 'field.water' && at(x + 1, y) === 'field.water' ? 1 : 0;
      } else if (assetId === 'field.stairs_stone') {
        quarterTurns = BOUNDARY_FIELD_IDS.has(at(x, y - 1)) || BOUNDARY_FIELD_IDS.has(at(x, y + 1)) ? 1 : 0;
      } else if (assetId === 'field.road_edge') {
        const horizontal = ROUTE_FIELD_IDS.has(at(x - 1, y)) || ROUTE_FIELD_IDS.has(at(x + 1, y));
        quarterTurns = horizontal ? 1 : 0;
      }
      transforms[`${x},${y}`] = { quarterTurns, flipX: (x + y) % 2 === 1 };
    }
  }
  return transforms;
}

function centerRoute(left = 2, right = 9) {
  const cells = [[6, 4], [6, 5], [6, 6], [6, 7]];
  for (let x = left; x <= right; x += 1) cells.push([x, 6]);
  const unique = [...new Map(cells.map(([x, y]) => [`${x},${y}`, [x, y]])).values()];
  return unique.map(([x, y]) => ({ id: `${x},${y}`, x, y }));
}

function authoredRoute(cells) {
  return cells.map(([x, y]) => ({ id: `${x},${y}`, x, y }));
}

function site({
  id, label, facilityKind, buildingAssetId, buildingX = 256,
  groundLegend, groundMap, routeLeft = 2, routeRight = 9,
  routeCells = null, playerStartNodeId = '6,7', evidenceNodeId = '6,4',
  contextStructures = [], contextSlots = null, groundTransformOverrides = {},
  rearDecor = [], props = [], npcs = [], frontOccluders = [], effects = []
}) {
  const mainBuilding = {
    assetId: buildingAssetId, x: buildingX, y: 0, width: 256, height: 256,
    baselineY: 240, role: 'main', layer: 'depth'
  };
  const slots = contextSlots ?? [
    { x: -32, y: -64 }, { x: 544, y: -64 }, { x: 64, y: 176 }, { x: 448, y: 176 }
  ];
  const arrangedContexts = contextStructures.map((entry, index) => {
    const slot = slots[index] ?? { x: entry.x, y: entry.y };
    return { ...entry, x: slot.x, y: slot.y, baselineY: slot.y + 240 };
  });
  return {
    id, label, facilityKind,
    building: mainBuilding,
    structures: [...arrangedContexts, mainBuilding],
    groundLegend, groundMap,
    groundTransformMap: { ...inferGroundTransforms(groundMap, groundLegend), ...groundTransformOverrides },
    rearDecor, props, npcs, frontOccluders, effects,
    route: routeCells ? authoredRoute(routeCells) : centerRoute(routeLeft, routeRight),
    playerStartNodeId,
    evidenceNodeId
  };
}

export function groundAssetAt(recipe, x, y) {
  const key = recipe?.groundMap?.[y]?.[x];
  return typeof key === 'string' ? recipe.groundLegend?.[key] ?? null : null;
}

export function groundTransformAt(recipe, x, y) {
  const transform = recipe?.groundTransformMap?.[`${x},${y}`];
  if (transform) return Object.freeze({ quarterTurns: transform.quarterTurns, flipX: transform.flipX });
  const assetId = groundAssetAt(recipe, x, y);
  if (VARIED_GROUND_IDS.has(assetId)) {
    const phase = (x * 3 + y * 5) % 4;
    return Object.freeze({ quarterTurns: phase >= 2 ? 2 : 0, flipX: phase % 2 === 1 });
  }
  return Object.freeze({
    quarterTurns: 0,
    flipX: FEATURE_FIELD_IDS.has(assetId) && (x + y) % 2 === 1
  });
}

const SNOW_OVERLAY_COLORS = Object.freeze(['#a7b9ca', '#b0c0cf', '#9fb2c4']);

function deterministicHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function snowPixelOverlaysAt(recipe, x, y) {
  if (groundAssetAt(recipe, x, y) !== 'field.snow') return Object.freeze([]);
  const seed = deterministicHash(`${recipe.id}:${x},${y}`);
  if (seed % 100 >= 28) return Object.freeze([]);
  const driftCount = 1 + ((seed >>> 7) % 2);
  const drifts = [];
  let cursor = seed;
  for (let driftIndex = 0; driftIndex < driftCount; driftIndex += 1) {
    cursor = (Math.imul(cursor, 1664525) + 1013904223) >>> 0;
    const rectangleCount = 2 + ((cursor >>> 5) % 3);
    const originX = 4 + 2 * ((cursor >>> 9) % 24);
    const originY = 4 + 2 * ((cursor >>> 14) % 24);
    const rectangles = [];
    for (let rectangleIndex = 0; rectangleIndex < rectangleCount; rectangleIndex += 1) {
      cursor = (Math.imul(cursor, 1664525) + 1013904223) >>> 0;
      const width = 4 + 2 * ((cursor >>> 3) % 7);
      const height = 2 + 2 * ((cursor >>> 8) % 3);
      const offsetX = 2 * (((cursor >>> 13) % 5) - 2);
      const offsetY = 2 * (((cursor >>> 17) % 3) - 1);
      rectangles.push(Object.freeze({
        x: Math.max(0, Math.min(64 - width, originX + offsetX)),
        y: Math.max(0, Math.min(64 - height, originY + offsetY)),
        width,
        height
      }));
    }
    drifts.push(Object.freeze({
      color: SNOW_OVERLAY_COLORS[(seed + driftIndex) % SNOW_OVERLAY_COLORS.length],
      rectangles: Object.freeze(rectangles)
    }));
  }
  return Object.freeze(drifts);
}

export function authoredTilePlacement(entry) {
  const offsetX = entry?.offsetX ?? 0;
  const offsetY = entry?.offsetY ?? 0;
  const flipX = entry?.flipX === true;
  const validFlip = entry?.flipX === undefined || typeof entry.flipX === 'boolean';
  const validGridAndOffset = Number.isInteger(entry?.x) && Number.isInteger(entry?.y)
    && Number.isInteger(offsetX) && Number.isInteger(offsetY)
    && offsetX % 8 === 0 && offsetY % 8 === 0
    && Math.abs(offsetX) <= 24 && Math.abs(offsetY) <= 24
    && validFlip;
  const x = validGridAndOffset ? entry.x * SITE_CANVAS.cellSize + offsetX : Number.NaN;
  const y = validGridAndOffset ? entry.y * SITE_CANVAS.cellSize + offsetY : Number.NaN;
  const insideCanvas = validGridAndOffset && x >= 0 && y >= 0
    && x + 64 <= SITE_CANVAS.width && y + 64 <= SITE_CANVAS.height;
  return Object.freeze({
    ok: validGridAndOffset && insideCanvas,
    validGridAndOffset,
    insideCanvas,
    offsetX,
    offsetY,
    flipX,
    x,
    y,
    depth: y + 64
  });
}

export const SITE_RECIPES = deepFreeze([
  site({
    id: 'civic_hall', label: '役場庁舎', facilityKind: 'town_hall', buildingAssetId: 'building.town_hall',
    contextStructures: [contextStructure('building.house.medium', 0, -48), contextStructure('building.guild', 512, -48), contextStructure('building.shop', -176, 128), contextStructure('building.inn', 688, 128)],
    groundLegend: { W: 'field.wall_stone', t: 'field.stairs_stone', g: 'field.grass', p: 'field.plaza', c: 'field.cobblestone', e: 'field.road_edge' },
    groundMap: ['WWWWWttWWWWW', 'cggppppppggg', 'ggppppppppgc', 'gcppppppppgg', 'ggpppppppccg', 'gppeeppccppg', 'eeccccccccee', 'gggggccggggc'],
    rearDecor: [prop('object.blue_flag', 3, 2), prop('object.blue_flag', 8, 2), prop('object.flowerbed', 1, 4), prop('object.flowerbed', 10, 4)],
    props: [prop('object.notice_board', 2, 5), prop('object.lamp', 4, 5), prop('object.lamp', 8, 5), prop('object.bench', 9, 6), prop('object.bench', 1, 6)],
    npcs: [npc('character.town_clerk', 7, 4), npc('character.mob.townsfolk_female', 3, 6, 'right')],
    frontOccluders: [prop('object.grass_patch', 0, 7), prop('object.streetlight', 11, 7)]
  }),
  site({
    id: 'old_town_gate', label: '旧市街の門', facilityKind: 'gate', buildingAssetId: 'building.gate', routeLeft: 3, routeRight: 8,
    contextStructures: [contextStructure('building.house.medium', 0, -48), contextStructure('building.old_house', 512, -48), contextStructure('building.watchtower', -176, 112), contextStructure('building.warehouse', 688, 112)],
    groundLegend: { W: 'field.wall_stone', c: 'field.cobblestone', g: 'field.grass', e: 'field.road_edge' },
    groundMap: ['WWWWWccWWWWW', 'WWWWWccWWWWW', 'cggeecceeggg', 'gggeecceeggc', 'gcgeecceeggg', 'gggeecceecgg', 'cggccccccggg', 'gggggccggggc'],
    rearDecor: [prop('object.red_flag', 3, 2), prop('object.red_flag', 8, 2), prop('object.warning_stake', 2, 4), prop('object.warning_stake', 9, 4)],
    props: [prop('object.notice_board', 3, 5), prop('object.streetlight', 9, 5), prop('object.crate', 4, 6), prop('object.bench', 8, 6), prop('object.barrel', 5, 5)],
    npcs: [npc('character.gatekeeper', 7, 4), npc('character.mob.townsfolk_male', 8, 6, 'left')],
    frontOccluders: [prop('object.warning_stake', 1, 7), prop('object.warning_stake', 10, 7)]
  }),
  site({
    id: 'guild_hall', label: '接続者ギルド', facilityKind: 'guild', buildingAssetId: 'building.guild',
    contextStructures: [contextStructure('building.pub', 0, -48), contextStructure('building.shop', 512, -48), contextStructure('building.inn', -176, 128), contextStructure('building.house.medium', 688, 128)],
    groundLegend: { g: 'field.grass', c: 'field.cobblestone', p: 'field.plaza', i: 'field.road_intersection', e: 'field.road_edge' },
    groundMap: ['cggccccccggg', 'ggccppppccgc', 'gcpppppppccg', 'gccppppppcgg', 'ggcppppppccg', 'gcccpiipcccc', 'eeccccccccee', 'gggggccggggc'],
    rearDecor: [prop('object.yellow_flag', 3, 3), prop('object.yellow_flag', 8, 3), prop('object.flowerbed', 2, 4), prop('object.flowerbed', 9, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.notice_board', 2, 5), prop('object.bench', 9, 5), prop('object.lamp', 4, 6), prop('object.barrel', 9, 6)],
    npcs: [npc('character.guildmaster', 7, 4), npc('character.mob.townsfolk_male', 3, 6, 'right')],
    frontOccluders: [prop('object.streetlight', 1, 7), prop('object.streetlight', 10, 7)]
  }),
  site({
    id: 'tavern', label: '酒場裏の石畳路地', facilityKind: 'pub', buildingAssetId: 'building.pub', buildingX: 192,
    contextStructures: [contextStructure('building.guild', -64, -48), contextStructure('building.shop', 448, -48), contextStructure('building.inn', 640, 112), contextStructure('building.house.small', -192, 128)],
    groundLegend: { g: 'field.grass', c: 'field.cobblestone', p: 'field.plaza', r: 'field.road_corner' },
    groundMap: ['cggccccccggg', 'ggccccccccgc', 'gccccppcccgg', 'ggccccppcccg', 'gccccppccggg', 'cgccccccccgg', 'rrccccccccrr', 'gggggccggggc'],
    rearDecor: [prop('object.lamp', 2, 3), prop('object.lamp', 8, 3), prop('object.barrel', 1, 4), prop('object.barrel', 10, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.bench', 3, 5), prop('object.barrel', 9, 5), prop('object.lamp', 8, 6)],
    npcs: [npc('character.tavern_master', 7, 4), npc('character.mob.tavern_guest', 9, 6, 'left'), npc('character.mob.traveler', 3, 6, 'right')],
    frontOccluders: [prop('object.streetlight', 1, 7), prop('object.stacked_crates', 10, 7)]
  }),
  site({
    id: 'market_shop', label: '市場の商店街', facilityKind: 'shop', buildingAssetId: 'building.shop', buildingX: 320,
    contextStructures: [contextStructure('building.guild', 0, -48), contextStructure('building.pub', 512, -48), contextStructure('building.house.medium', -176, 128), contextStructure('building.inn', 688, 128)],
    groundLegend: { g: 'field.grass', p: 'field.plaza', c: 'field.cobblestone', e: 'field.road_edge', i: 'field.road_intersection' },
    groundMap: ['cggppppppggg', 'ggppccccppgc', 'cppccccccppg', 'gppccccccpgc', 'gppccccccggp', 'cppccccccppg', 'eecccciiccee', 'gggggccggggc'],
    rearDecor: [prop('object.yellow_flag', 2, 3), prop('object.red_flag', 9, 3), prop('object.flowerbed', 1, 4), prop('object.flowerbed', 10, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.crate', 2, 5), prop('object.stacked_crates', 9, 5), prop('object.bench', 4, 6), prop('object.barrel', 8, 6)],
    npcs: [npc('character.mob.merchant', 7, 4), npc('character.mob.delivery_person', 3, 6, 'right'), npc('character.mob.townsfolk_female', 9, 6, 'left')],
    frontOccluders: [prop('object.crate', 1, 7), prop('object.streetlight', 10, 7)]
  }),
  site({
    id: 'travelers_inn', label: '旅人の宿と前庭', facilityKind: 'inn', buildingAssetId: 'building.inn',
    contextStructures: [contextStructure('building.house.small', 0, -48), contextStructure('building.pub', 512, -48), contextStructure('building.hut', -176, 128), contextStructure('building.shop', 688, 128)],
    groundLegend: { T: 'field.tree', g: 'field.grass', f: 'field.fence_wood', d: 'field.dirt_path' },
    groundMap: ['TTTgggggggTT', 'TgggggggggdT', 'gggfffffgggg', 'dggggggggggg', 'gggddddddggd', 'dggddddddggg', 'ggddddddddgd', 'dggggddggggg'],
    rearDecor: [prop('object.flowerbed', 2, 3), prop('object.flowerbed', 9, 3), prop('object.grass_patch', 1, 4), prop('object.grass_patch', 10, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.bench', 3, 5), prop('object.lamp', 9, 5), prop('object.barrel', 8, 6)],
    npcs: [npc('character.innkeeper', 7, 4), npc('character.mob.inn_guest', 9, 6, 'left'), npc('character.mob.traveler', 3, 6, 'right')],
    frontOccluders: [prop('object.grass_patch', 1, 7), prop('object.flowerbed', 10, 7)]
  }),
  site({
    id: 'harbor_dock', label: '港の船着場', facilityKind: 'dock', buildingAssetId: 'building.dock', buildingX: 320,
    contextStructures: [contextStructure('building.warehouse', 64, -64), contextStructure('building.inn', 576, -64), contextStructure('building.pub', -176, 128), contextStructure('building.shop', 688, 128)],
    contextSlots: [{ x: 448, y: -64 }, { x: 576, y: -64 }, { x: 448, y: 176 }, { x: 640, y: 176 }],
    groundLegend: { q: 'field.river_edge', w: 'field.water', k: 'field.dock_floor', c: 'field.cobblestone', b: 'field.bridge_wood' },
    groundMap: ['ccqwkkkkkkkk', 'kcqwkkkkkkkk', 'ccqwkkkkkkkk', 'kcqwkkkkkkkk', 'ccqwkkcckkkk', 'kcqwkkcckkkk', 'cccbcccckkkk', 'ccwwkkcckkkk'],
    rearDecor: [prop('object.blue_flag', 5, 3), prop('object.blue_flag', 10, 3), prop('object.barrel', 4, 4), prop('object.stacked_crates', 10, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.stacked_crates', 8, 5), prop('object.crate', 10, 5), prop('object.barrel', 4, 6)],
    npcs: [npc('character.dock_ferryman', 7, 4), npc('character.mob.dock_worker', 9, 6, 'left'), npc('character.mob.delivery_person', 5, 6, 'right')],
    frontOccluders: [prop('object.crate', 10, 7), prop('object.lamp', 8, 7)],
    effects: [effect('effect.water_ripple', 3, 4, 'water')]
  }),
  site({
    id: 'training_yard', label: '段丘の鍛錬場', facilityKind: 'dojo', buildingAssetId: 'building.dojo', buildingX: 320,
    contextStructures: [contextStructure('building.guild', 0, -64), contextStructure('building.old_house', 512, -64), contextStructure('building.hut', -176, 128), contextStructure('building.watchtower', 688, 128)],
    groundLegend: { R: 'field.rock', p: 'field.plaza', l: 'field.cliff', t: 'field.stairs_stone', g: 'field.grass', d: 'field.dirt_path', r: 'field.road_corner' },
    groundMap: ['RRRpppppppRR', 'RRppppppppRg', 'lllllltlllll', 'Rggddddddggg', 'gggddddddggR', 'Rggddddddddg', 'rrddddddddrg', 'gggggddggggR'],
    rearDecor: [prop('object.red_flag', 2, 3), prop('object.red_flag', 9, 3), prop('object.warning_stake', 1, 4), prop('object.warning_stake', 10, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.bench', 3, 5), prop('object.warning_stake', 9, 5), prop('object.red_flag', 8, 6), prop('object.rubble', 2, 6), prop('object.bench', 9, 6)],
    npcs: [npc('character.dojo_inspector', 7, 4), npc('character.mob.child', 3, 6, 'right')],
    frontOccluders: [prop('object.warning_stake', 1, 7), prop('object.warning_stake', 10, 7)]
  }),
  site({
    id: 'well_square', label: '暮らしの井戸広場', facilityKind: 'well', buildingAssetId: 'building.well',
    contextStructures: [contextStructure('building.house.small', 0, -64), contextStructure('building.house.medium', 512, -64), contextStructure('building.shop', -176, 128), contextStructure('building.inn', 688, 128)],
    groundLegend: { g: 'field.grass', p: 'field.plaza', c: 'field.cobblestone', e: 'field.road_edge' },
    groundMap: ['cggppppppggg', 'ggppppppppgc', 'cppccccccppg', 'gppccccccpgc', 'gppccccccggp', 'cppccccccppg', 'eeccccccccee', 'gggggccggggc'],
    rearDecor: [prop('object.flowerbed', 2, 3), prop('object.flowerbed', 9, 3), prop('object.blue_flag', 1, 4), prop('object.blue_flag', 10, 4)],
    props: [prop('object.notice_board', 5, 4), prop('object.well', 2, 5), prop('object.bench', 9, 5), prop('object.lamp', 4, 6), prop('object.barrel', 8, 6)],
    npcs: [npc('character.mob.townsfolk_female', 7, 4), npc('character.mob.elder', 3, 6, 'right'), npc('character.mob.child', 9, 6, 'left')],
    frontOccluders: [prop('object.grass_patch', 1, 7), prop('object.flowerbed', 10, 7)]
  }),
  site({
    id: 'artisan_workshop', label: '資材に囲まれた職人の工房', facilityKind: 'workshop', buildingAssetId: 'building.workshop', buildingX: 320,
    contextStructures: [contextStructure('building.warehouse', 0, -64), contextStructure('building.hut', 512, -64), contextStructure('building.old_house', -176, 128), contextStructure('building.house.small', 688, 128)],
    groundLegend: { T: 'field.tree', g: 'field.grass', R: 'field.rock', d: 'field.dirt_path' },
    groundMap: ['TTgggggggggT', 'TgggggggggRT', 'ggRRRggRRggg', 'Rggddddddggg', 'gggddddddggR', 'Tgddddddddgg', 'ggddddddddgR', 'Tggggddggggg'],
    rearDecor: [prop('object.construction_sign', 2, 3), prop('object.rubble', 9, 3), prop('object.crate', 1, 4), prop('object.stacked_crates', 10, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.crate', 3, 5), prop('object.rubble', 9, 5), prop('object.warning_stake', 8, 6)],
    npcs: [npc('character.workshop_artisan', 7, 4), npc('character.mob.artisan', 3, 6, 'right')],
    frontOccluders: [prop('object.stacked_crates', 1, 7), prop('object.crate', 10, 7)],
    effects: [effect('effect.construction_dust', 9, 5, 'repair')]
  }),
  site({
    id: 'freight_warehouse', label: '運河沿いの貨物倉庫', facilityKind: 'warehouse', buildingAssetId: 'building.warehouse', buildingX: 320,
    contextStructures: [contextStructure('building.workshop', 0, -64), contextStructure('building.dock', 512, -64), contextStructure('building.inn', -176, 128), contextStructure('building.shop', 688, 128)],
    contextSlots: [{ x: 64, y: -64 }, { x: 576, y: -64 }, { x: 512, y: 176 }, { x: 640, y: 176 }],
    groundLegend: { g: 'field.grass', w: 'field.water', q: 'field.river_edge', k: 'field.dock_floor', c: 'field.cobblestone', B: 'field.bridge_stone' },
    groundMap: ['gwqkkkkkkkkk', 'gwqkkkkkkkkk', 'gwqkkkkkkkkk', 'gwqkkkkkkkkk', 'gwqkkkcckkkk', 'gwqkkkcckkkk', 'cBcccccckkkk', 'gwwkkkcckkkk'],
    rearDecor: [prop('object.yellow_flag', 4, 3), prop('object.yellow_flag', 9, 3), prop('object.stacked_crates', 3, 4), prop('object.barrel', 10, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.stacked_crates', 3, 5), prop('object.crate', 9, 5), prop('object.barrel', 4, 6)],
    npcs: [npc('character.warehouse_keeper', 7, 4), npc('character.mob.delivery_person', 3, 6, 'right'), npc('character.mob.dock_worker', 9, 6, 'left')],
    frontOccluders: [prop('object.stacked_crates', 1, 7), prop('object.crate', 10, 7)]
  }),
  site({
    id: 'snow_watch', label: '北壁の見張り台', facilityKind: 'watchtower', buildingAssetId: 'building.watchtower', buildingX: 320,
    contextStructures: [contextStructure('building.old_house', -160, -104), contextStructure('building.house.small', 96, -112), contextStructure('building.hut', 544, -96), contextStructure('building.warehouse', 656, 128)],
    contextSlots: [{ x: -160, y: -104 }, { x: 96, y: -112 }, { x: 544, y: -96 }, { x: 656, y: 128 }],
    groundLegend: { n: 'field.snow', c: 'field.cobblestone' },
    groundMap: ['nnnnnnnnnnnn', 'nnnnnnnnnnnn', 'nnnnnnnnnnnn', 'nnnnnnnnnnnn', 'nnnnnnncnnnn', 'nnnnnnncnnnn', 'nnnnnnncnnnn', 'nnnnnnncnnnn'],
    routeCells: [[7, 7], [7, 6], [7, 5], [7, 4]],
    playerStartNodeId: '7,7',
    evidenceNodeId: '7,4',
    rearDecor: [prop('object.blue_flag', 2, 3), prop('object.blue_flag', 9, 3), prop('object.warning_stake', 1, 4), prop('object.warning_stake', 10, 4), prop('object.barrel', 3, 4), prop('object.rubble', 2, 2), prop('object.rubble', 9, 2)],
    props: [prop('object.unverified_tag', 8, 4), prop('object.bench', 3, 5), prop('object.warning_stake', 9, 5), prop('object.barrel', 2, 6), prop('object.stacked_crates', 9, 6), prop('object.lamp', 8, 6), prop('object.lamp', 4, 6), prop('object.rubble', 1, 5), prop('object.rubble', 10, 5)],
    npcs: [npc('character.watchtower_guard', 7, 4), npc('character.mob.traveler', 3, 6, 'right')],
    frontOccluders: [prop('object.rubble', 1, 7), prop('object.blue_flag', 10, 7), prop('object.barrel', 9, 7)]
  }),
  site({
    id: 'small_home', label: '花壇のある小さな家', facilityKind: 'house', buildingAssetId: 'building.house.small',
    contextStructures: [contextStructure('building.hut', 0, -64), contextStructure('building.old_house', 512, -64), contextStructure('building.house.medium', -176, 128), contextStructure('building.inn', 688, 128)],
    groundLegend: { T: 'field.tree', g: 'field.grass', f: 'field.fence_wood', d: 'field.dirt_path' },
    groundMap: ['TTgggggggggT', 'TgggggggggdT', 'gggffffffggd', 'dggggggggggg', 'gggddddddggT', 'Tgddddddddgg', 'ggddddddddgT', 'dggggddggggg'],
    rearDecor: [prop('object.flowerbed', 2, 3), prop('object.flowerbed', 9, 3), prop('object.grass_patch', 1, 4), prop('object.grass_patch', 10, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.bench', 3, 5), prop('object.lamp', 9, 5), prop('object.flowerbed', 8, 6), prop('object.bench', 9, 6)],
    npcs: [npc('character.mob.child', 7, 4), npc('character.mob.townsfolk_female', 3, 6, 'right')],
    frontOccluders: [prop('object.grass_patch', 1, 7), prop('object.flowerbed', 10, 7)]
  }),
  site({
    id: 'larger_home', label: '石塀のある大きな家', facilityKind: 'house', buildingAssetId: 'building.house.medium', buildingX: 192,
    contextStructures: [contextStructure('building.house.small', -64, -64), contextStructure('building.shop', 448, -64), contextStructure('building.pub', -192, 128), contextStructure('building.inn', 640, 128)],
    groundLegend: { g: 'field.grass', c: 'field.cobblestone', p: 'field.plaza', f: 'field.fence_wood', e: 'field.road_edge' },
    groundMap: ['cggccccccggg', 'ggccppppccgc', 'ggffffffffff', 'cggppppppggg', 'gggppppppggc', 'cgccccccccgg', 'eeccccccccee', 'gggggccggggc'],
    rearDecor: [prop('object.flowerbed', 2, 3), prop('object.flowerbed', 9, 3), prop('object.streetlight', 1, 4), prop('object.streetlight', 10, 4)],
    props: [prop('object.notice_board', 5, 4), prop('object.bench', 3, 5), prop('object.lamp', 9, 5), prop('object.barrel', 8, 6), prop('object.flowerbed', 9, 6)],
    npcs: [npc('character.mob.townsfolk_male', 7, 4), npc('character.mob.elder', 3, 6, 'right')],
    frontOccluders: [prop('object.grass_patch', 1, 7), prop('object.streetlight', 10, 7)]
  }),
  site({
    id: 'woodland_hut', label: '森の脇道にある小屋', facilityKind: 'house', buildingAssetId: 'building.hut', buildingX: 256,
    contextStructures: [contextStructure('building.old_house', -128, -80), contextStructure('building.workshop', 608, -48), contextStructure('building.ruin', -176, 144)],
    contextSlots: [{ x: -128, y: -80 }, { x: 608, y: -48 }, { x: -176, y: 144 }],
    groundLegend: { g: 'field.grass', R: 'field.rock', d: 'field.dirt_path' },
    groundMap: ['gggggggggggg', 'gRggggggggRg', 'ggggRggRgggg', 'RggggggggggR', 'gggggddggggg', 'gRgggdggggRg', 'gggggddggggg', 'RgggggdggggR'],
    routeCells: [[6, 7], [6, 6], [5, 6], [5, 5], [5, 4], [6, 4]],
    evidenceNodeId: '6,4',
    rearDecor: [
      ...woodlandTrees(WOODLAND_REAR_TREE_LAYOUT),
      prop('object.grass_patch', 2, 0, 8, 8),
      prop('field.rock', 2, 3, 16, 8), prop('field.rock', 3, 3, -16, 8, true),
      prop('field.rock', 2, 4, 16, -24, true), prop('field.rock', 3, 4, -16, -24),
      prop('field.rock', 8, 3, 16, 8, true), prop('field.rock', 9, 4, -16, -24)
    ],
    props: [
      ...woodlandTrees(WOODLAND_SIDE_TREE_LAYOUT),
      prop('object.signboard', 7, 5, 8, 0), prop('object.bench', 8, 6, -16, 8),
      prop('object.grass_patch', 3, 2, 8, 8), prop('object.rubble', 8, 2, -8, 8),
      prop('object.grass_patch', 4, 3, -8, 8), prop('object.grass_patch', 8, 3, 8, -8),
      prop('object.barrel', 4, 5, 8, -8), prop('object.crate', 9, 5, -8, -8)
    ],
    npcs: [npc('character.mob.artisan', 7, 4), npc('character.mob.child', 3, 6, 'right')],
    frontOccluders: [
      ...woodlandTrees(WOODLAND_FRONT_TREE_LAYOUT),
      prop('object.grass_patch', 4, 7, -16, -16), prop('object.grass_patch', 8, 7, 16, -24)
    ]
  }),
  site({
    id: 'old_residence', label: '旧市街の古い住まい', facilityKind: 'house', buildingAssetId: 'building.old_house', buildingX: 192,
    contextStructures: [contextStructure('building.house.small', -64, -64), contextStructure('building.pub', 448, -64), contextStructure('building.hut', -192, 128), contextStructure('building.ruin', 640, 128)],
    groundLegend: { g: 'field.grass', c: 'field.cobblestone', d: 'field.dirt_path', r: 'field.road_corner', e: 'field.road_edge' },
    groundMap: ['cggccccccggg', 'ggccccccccgc', 'dggggggggggg', 'cggddddddggg', 'gggddddddggc', 'rrddddddddrg', 'eeccccccccee', 'dggggccggggg'],
    rearDecor: [prop('object.lamp', 2, 3), prop('object.lamp', 9, 3), prop('object.grass_patch', 1, 4), prop('object.grass_patch', 10, 4)],
    props: [prop('object.signboard', 5, 4), prop('object.bench', 3, 5), prop('object.barrel', 9, 5), prop('object.lamp', 8, 6), prop('object.crate', 4, 6)],
    npcs: [npc('character.mob.traveler', 7, 4), npc('character.mob.townsfolk_male', 3, 6, 'right')],
    frontOccluders: [prop('object.streetlight', 1, 7), prop('object.grass_patch', 10, 7)]
  }),
  site({
    id: 'overgrown_ruin', label: '草に侵食された廃屋', facilityKind: 'ruin', buildingAssetId: 'building.ruin',
    contextStructures: [contextStructure('building.hut', -144, -72), contextStructure('building.old_house', 600, -56), contextStructure('building.workshop', -184, 152)],
    contextSlots: [{ x: -144, y: -72 }, { x: 600, y: -56 }, { x: -184, y: 152 }],
    groundLegend: { g: 'field.grass', l: 'field.cliff', R: 'field.rock', d: 'field.dirt_path' },
    groundMap: ['ggRggggggRgg', 'gglllgggggRg', 'glllgggRgggg', 'gllgggggggRg', 'gglggddggggg', 'gRgggdggggRg', 'gggggddggggg', 'RgggggdggggR'],
    routeCells: [[6, 7], [6, 6], [5, 6], [5, 5], [5, 4], [6, 4]],
    rearDecor: [
      ...woodlandTrees(WOODLAND_REAR_TREE_LAYOUT, true),
      prop('field.rock', 2, 3, 16, 8), prop('field.rock', 3, 3, -16, 8, true),
      prop('field.rock', 2, 4, 16, -24, true), prop('field.rock', 3, 4, -16, -24),
      prop('object.rubble', 4, 2, 16, 8), prop('object.grass_patch', 7, 2, -16, 8)
    ],
    props: [
      ...woodlandTrees(WOODLAND_SIDE_TREE_LAYOUT, true),
      prop('object.unverified_tag', 7, 4, 8, 0), prop('object.construction_sign', 9, 5, 16, -8),
      prop('object.grass_patch', 3, 2, 8, 8), prop('object.rubble', 8, 2, -8, 8),
      prop('object.grass_patch', 8, 3, 8, -8), prop('object.warning_stake', 4, 5, 8, -8),
      prop('object.rubble', 7, 5, 8, -8), prop('object.rubble', 9, 5, -8, -8)
    ],
    npcs: [npc('character.mob.elder', 7, 4), npc('character.mob.artisan', 3, 6, 'right')],
    frontOccluders: [
      ...woodlandTrees(WOODLAND_FRONT_TREE_LAYOUT, true),
      prop('object.grass_patch', 8, 7, 16, -24)
    ],
    effects: [effect('effect.construction_dust', 9, 5, 'ruin')]
  })
]);

export function siteRecipesForFacility(facilityKind) {
  return SITE_RECIPES.filter((recipe) => recipe.facilityKind === facilityKind);
}

export function siteRecipeById(siteId) {
  return SITE_RECIPES.find((recipe) => recipe.id === siteId) ?? null;
}

export function collectRuntimeAssetUsage() {
  const used = new Set(['character.player']);
  for (const recipe of SITE_RECIPES) {
    for (const entry of recipe.structures) used.add(entry.assetId);
    for (let y = 0; y < recipe.groundMap.length; y += 1) {
      for (let x = 0; x < recipe.groundMap[y].length; x += 1) used.add(groundAssetAt(recipe, x, y));
    }
    for (const entry of [...recipe.rearDecor, ...recipe.props, ...recipe.frontOccluders]) used.add(entry.assetId);
    for (const entry of recipe.npcs) used.add(entry.assetId);
    for (const entry of recipe.effects) used.add(entry.assetId);
  }
  used.delete(null);
  return Object.freeze([...used].sort());
}

export function auditRuntimeAssetUsage() {
  const used = collectRuntimeAssetUsage();
  const missing = REQUIRED_ASSET_IDS.filter((id) => !used.includes(id));
  const unexpected = used.filter((id) => !REQUIRED_ASSET_IDS.includes(id));
  return deepFreeze({ ok: missing.length === 0 && unexpected.length === 0 && used.length === 78, used, missing, unexpected });
}

function routeIsConnected(route) {
  const ids = new Set(route.map((node) => node.id));
  if (ids.size !== route.length || route.length === 0) return false;
  const visited = new Set([route[0].id]);
  const queue = [route[0]];
  while (queue.length) {
    const node = queue.shift();
    for (const next of route) {
      if (visited.has(next.id) || Math.abs(next.x - node.x) + Math.abs(next.y - node.y) !== 1) continue;
      visited.add(next.id);
      queue.push(next);
    }
  }
  return visited.size === route.length;
}

function neighboringGroundAssets(recipe, x, y) {
  return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    .map(([nextX, nextY]) => groundAssetAt(recipe, nextX, nextY));
}

function groundCellsFor(recipe, assetId) {
  const cells = [];
  for (let y = 0; y < SITE_CANVAS.rows; y += 1) {
    for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
      if (groundAssetAt(recipe, x, y) === assetId) cells.push([x, y]);
    }
  }
  return cells;
}

export function auditSiteRecipes() {
  const issues = [];
  if (SITE_RECIPES.length !== 17) issues.push('exactly 17 site recipes are required');
  if (new Set(SITE_RECIPES.map((recipe) => recipe.id)).size !== SITE_RECIPES.length) issues.push('site route IDs must be unique');
  if (siteRecipesForFacility('house').length !== 4) issues.push('house must expose exactly four neighboring routes');
  const singletonFacilities = ['town_hall', 'gate', 'guild', 'pub', 'shop', 'inn', 'dock', 'dojo', 'well', 'workshop', 'warehouse', 'watchtower', 'ruin'];
  for (const facilityKind of singletonFacilities) {
    if (siteRecipesForFacility(facilityKind).length !== 1) issues.push(`${facilityKind} must have exactly one semantic route`);
  }
  for (const recipe of SITE_RECIPES) {
    if (!Array.isArray(recipe.groundMap) || recipe.groundMap.length !== SITE_CANVAS.rows
      || recipe.groundMap.some((row) => typeof row !== 'string' || row.length !== SITE_CANVAS.columns)) {
      issues.push(`${recipe.id}: groundMap must be exactly 8 rows by 12 columns`);
      continue;
    }
    const groundAssets = [];
    for (let y = 0; y < SITE_CANVAS.rows; y += 1) {
      for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
        const assetId = groundAssetAt(recipe, x, y);
        if (!FIELD_IDS.includes(assetId)) issues.push(`${recipe.id}: groundMap has an unknown legend key at ${x},${y}`);
        else groundAssets.push(assetId);
      }
    }
    const groundCounts = new Map();
    for (const assetId of groundAssets) groundCounts.set(assetId, (groundCounts.get(assetId) ?? 0) + 1);
    const woodland = ['woodland_hut', 'overgrown_ruin'].includes(recipe.id);
    const winter = recipe.id === 'snow_watch';
    if (groundCounts.size < (winter ? 2 : 3)) issues.push(`${recipe.id}: groundMap does not use enough meaningful field assets`);
    if (Math.max(0, ...groundCounts.values()) > (woodland ? 84 : winter ? 92 : 72)) {
      issues.push(`${recipe.id}: groundMap is dominated by one repeated field`);
    }
    const placedCount = recipe.rearDecor.length + recipe.props.length + recipe.npcs.length
      + recipe.frontOccluders.length + recipe.effects.length + recipe.structures.length;
    const minimumPlacements = woodland ? 70 : 18;
    const maximumPlacements = woodland ? 90 : 28;
    if (placedCount < minimumPlacements || placedCount > maximumPlacements) {
      issues.push(`${recipe.id}: scene placement density must stay between ${minimumPlacements} and ${maximumPlacements} authored placements`);
    }
    const mainStructures = recipe.structures.filter((entry) => entry.role === 'main');
    if (recipe.structures.length < 3 || recipe.structures.length > 5 || mainStructures.length !== 1
      || mainStructures[0]?.assetId !== recipe.building.assetId) {
      issues.push(`${recipe.id}: structures must contain one main and two to four contextual buildings`);
    }
    for (const entry of recipe.structures) {
      if (!BUILDING_IDS.includes(entry.assetId) || entry.width !== 256 || entry.height !== 256
        || !Number.isInteger(entry.x) || !Number.isInteger(entry.y) || !Number.isInteger(entry.baselineY)) {
        issues.push(`${recipe.id}: structure violates the native 256px integer placement contract`);
      }
    }
    for (const [collectionName, entries] of [
      ['rearDecor', recipe.rearDecor], ['props', recipe.props], ['frontOccluders', recipe.frontOccluders]
    ]) {
      for (const entry of entries) {
        const placement = authoredTilePlacement(entry);
        if (!placement.validGridAndOffset) {
          issues.push(`${recipe.id}: ${collectionName} has an invalid authored pixel offset`);
        } else if (!placement.insideCanvas) {
          issues.push(`${recipe.id}: ${collectionName} authored pixel offset leaves the native site canvas`);
        }
      }
    }
    if (woodland) {
      const compositionEntries = [...recipe.rearDecor, ...recipe.props, ...recipe.npcs, ...recipe.frontOccluders];
      const featureDecor = compositionEntries.filter((entry) => FEATURE_FIELD_IDS.has(entry.assetId));
      if (featureDecor.length < 60) issues.push(`${recipe.id}: woodland feature composition must contain at least 60 authored overlays`);
      let visuallyOccupiedCells = 0;
      for (let y = 0; y < SITE_CANVAS.rows; y += 1) {
        for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
          const left = x * SITE_CANVAS.cellSize;
          const top = y * SITE_CANVAS.cellSize;
          const occupied = groundAssetAt(recipe, x, y) !== 'field.grass'
            || compositionEntries.some((entry) => entry.x === x && entry.y === y)
            || recipe.route.some((entry) => entry.x === x && entry.y === y)
            || recipe.structures.some((entry) => entry.x < left + SITE_CANVAS.cellSize && entry.x + entry.width > left
              && entry.y < top + SITE_CANVAS.cellSize && entry.y + entry.height > top);
          if (occupied) visuallyOccupiedCells += 1;
        }
      }
      if (visuallyOccupiedCells / (SITE_CANVAS.columns * SITE_CANVAS.rows) < 0.8) {
        issues.push(`${recipe.id}: woodland visual occupancy must cover at least 80% of site cells`);
      }
      for (let y = 0; y < SITE_CANVAS.rows - 1; y += 1) {
        for (let x = 0; x < SITE_CANVAS.columns - 1; x += 1) {
          const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
          if (!cells.every(([cellX, cellY]) => groundAssetAt(recipe, cellX, cellY) === 'field.grass')) continue;
          const anchored = compositionEntries.some((entry) => entry.x >= x && entry.x <= x + 1
            && entry.y >= y && entry.y <= y + 1);
          const routed = recipe.route.some((entry) => entry.x >= x && entry.x <= x + 1
            && entry.y >= y && entry.y <= y + 1);
          const left = x * SITE_CANVAS.cellSize;
          const top = y * SITE_CANVAS.cellSize;
          const structured = recipe.structures.some((entry) => entry.x < left + 128 && entry.x + entry.width > left
            && entry.y < top + 128 && entry.y + entry.height > top);
          if (!anchored && !routed && !structured) issues.push(`${recipe.id}: unintended 2x2 grass void at ${x},${y}`);
        }
      }
    }
    for (const [key, transform] of Object.entries(recipe.groundTransformMap)) {
      const [x, y] = key.split(',').map(Number);
      const transformedAssetId = groundAssetAt(recipe, x, y);
      const variedGround = VARIED_GROUND_IDS.has(transformedAssetId);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 12 || y < 0 || y >= 8
        || !Number.isInteger(transform.quarterTurns) || transform.quarterTurns < 0 || transform.quarterTurns > 3
        || typeof transform.flipX !== 'boolean'
        || (!DIRECTIONAL_FIELD_IDS.has(transformedAssetId) && !variedGround)
        || (variedGround && transform.quarterTurns !== 0 && transform.quarterTurns !== 2)) {
        issues.push(`${recipe.id}: invalid directional ground transform at ${key}`);
      }
    }
    for (let y = 0; y < SITE_CANVAS.rows; y += 1) {
      for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
        if (DIRECTIONAL_FIELD_IDS.has(groundAssetAt(recipe, x, y)) && !recipe.groundTransformMap[`${x},${y}`]) {
          issues.push(`${recipe.id}: directional field at ${x},${y} lacks an explicit transform`);
        }
      }
    }
    if (!routeIsConnected(recipe.route) || !recipe.route.some((node) => node.id === recipe.playerStartNodeId)
      || !recipe.route.some((node) => node.id === recipe.evidenceNodeId)) issues.push(`${recipe.id}: route is not connected`);
    for (const node of recipe.route) {
      if (!ROUTE_FIELD_IDS.has(groundAssetAt(recipe, node.x, node.y))) {
        issues.push(`${recipe.id}: route node ${node.id} is not on a visible road or floor`);
      }
    }
    const evidenceNode = recipe.route.find((node) => node.id === recipe.evidenceNodeId);
    const entranceX = (recipe.building.x + (recipe.building.width / 2)) / SITE_CANVAS.cellSize;
    const entranceY = (recipe.building.y + recipe.building.height) / SITE_CANVAS.cellSize;
    if (!evidenceNode || Math.abs(evidenceNode.x - entranceX) + Math.abs(evidenceNode.y - entranceY) > 1.1) {
      issues.push(`${recipe.id}: evidence node is not visually aligned with the building entrance`);
    }
    for (const bridgeId of BRIDGE_FIELD_IDS) {
      for (const [x, y] of groundCellsFor(recipe, bridgeId)) {
        const horizontalCrossing = groundAssetAt(recipe, x, y - 1) === 'field.water'
          && groundAssetAt(recipe, x, y + 1) === 'field.water';
        const verticalCrossing = groundAssetAt(recipe, x - 1, y) === 'field.water'
          && groundAssetAt(recipe, x + 1, y) === 'field.water';
        if (!horizontalCrossing && !verticalCrossing) issues.push(`${recipe.id}: ${bridgeId} does not cross a waterway`);
      }
    }
    for (const [x, y] of groundCellsFor(recipe, 'field.stairs_stone')) {
      if (!neighboringGroundAssets(recipe, x, y).some((assetId) => BOUNDARY_FIELD_IDS.has(assetId))) {
        issues.push(`${recipe.id}: stairs do not meet a cliff or stone-wall boundary`);
      }
    }
    for (const barrierId of ['field.water', 'field.river_edge', 'field.wall_stone', 'field.fence_wood']) {
      const cells = groundCellsFor(recipe, barrierId);
      if (cells.length > 1 && cells.some(([x, y]) => {
        const neighbors = neighboringGroundAssets(recipe, x, y);
        return !neighbors.includes(barrierId)
          && !(barrierId === 'field.water' && neighbors.some((assetId) => BRIDGE_FIELD_IDS.has(assetId)));
      })) {
        issues.push(`${recipe.id}: ${barrierId} contains an isolated discontinuity`);
      }
    }
    for (const entry of recipe.effects.filter((item) => item.assetId === 'effect.water_ripple')) {
      const onWater = groundAssetAt(recipe, entry.x, entry.y) === 'field.water';
      if (!onWater || entry.context !== 'water') issues.push(`${recipe.id}: water ripple is not on a water cell`);
    }
    for (const entry of recipe.effects.filter((item) => item.assetId === 'effect.construction_dust')) {
      const activeContext = ['repair', 'ruin'].includes(entry.context)
        && (recipe.building.assetId === 'building.ruin'
          || recipe.props.some((item) => ['object.construction_sign', 'object.rubble'].includes(item.assetId)));
      if (!activeContext) issues.push(`${recipe.id}: construction dust lacks a repair/ruin context`);
    }
  }
  return deepFreeze({ ok: issues.length === 0, issues, routeCount: SITE_RECIPES.length, usage: auditRuntimeAssetUsage() });
}

export function characterFrameRect(direction = 'down', frame = 'idle') {
  const column = DIRECTION_COLUMNS[direction] ?? DIRECTION_COLUMNS.down;
  const row = FRAME_ROWS[frame] ?? FRAME_ROWS.idle;
  return Object.freeze({ x: column * 24, y: row * 40, width: 24, height: 40, column, row });
}

export function effectFrameRect(frameIndex = 0) {
  const frame = ((Math.trunc(frameIndex) % 4) + 4) % 4;
  return Object.freeze({ x: frame * 32, y: 0, width: 32, height: 32, frame });
}

export function siteNodeById(recipe, nodeId) {
  return recipe?.route?.find((node) => node.id === nodeId) ?? null;
}

export function nearestSiteNode(recipe, x, y) {
  if (!recipe || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [...recipe.route].sort((left, right) => {
    const leftDistance = ((left.x - x) ** 2) + ((left.y - y) ** 2);
    const rightDistance = ((right.x - x) ** 2) + ((right.y - y) ** 2);
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0] ?? null;
}

export function nextSiteNodeForDirection(recipe, currentId, direction) {
  const current = siteNodeById(recipe, currentId);
  const vector = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
  if (!current || !vector) return current;
  return recipe.route.find((node) => node.x === current.x + vector[0] && node.y === current.y + vector[1]) ?? current;
}

export function shortestSitePath(recipe, fromId, toId) {
  const byId = new Map((recipe?.route ?? []).map((node) => [node.id, node]));
  if (!byId.has(fromId) || !byId.has(toId)) return Object.freeze([]);
  if (fromId === toId) return Object.freeze([byId.get(fromId)]);
  const previous = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    const current = byId.get(id);
    for (const candidate of byId.values()) {
      if (previous.has(candidate.id)
        || Math.abs(candidate.x - current.x) + Math.abs(candidate.y - current.y) !== 1) continue;
      previous.set(candidate.id, id);
      if (candidate.id === toId) {
        const path = [];
        let cursor = toId;
        while (cursor !== null) {
          path.push(byId.get(cursor));
          cursor = previous.get(cursor);
        }
        return Object.freeze(path.reverse());
      }
      queue.push(candidate.id);
    }
  }
  return Object.freeze([]);
}

export function computeSiteCamera(viewportWidth, viewportHeight) {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1;
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1;
  const scale = Math.min(1, width / SITE_CANVAS.width, height / SITE_CANVAS.height);
  const destWidth = SITE_CANVAS.width * scale;
  const destHeight = SITE_CANVAS.height * scale;
  return Object.freeze({
    scale,
    destX: (width - destWidth) / 2,
    destY: (height - destHeight) / 2,
    destWidth,
    destHeight,
    viewportWidth: width,
    viewportHeight: height
  });
}

export function siteToScreen(camera, point) {
  if (!camera || !point) return null;
  return Object.freeze({ x: camera.destX + point.x * camera.scale, y: camera.destY + point.y * camera.scale });
}

export function screenToSite(camera, point) {
  if (!camera || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < camera.destX || point.y < camera.destY
    || point.x > camera.destX + camera.destWidth || point.y > camera.destY + camera.destHeight) return null;
  return Object.freeze({ x: (point.x - camera.destX) / camera.scale, y: (point.y - camera.destY) / camera.scale });
}
