const WALKABLE_TILES = new Set(['grass', 'dirt', 'path', 'road', 'sand', 'bridge', 'stairs', 'plaza', 'floor']);
const CATEGORIES = new Set(['character', 'building', 'field', 'object', 'ui', 'effect']);
const RENDERER_CATEGORIES = new Set(['tile', 'building_exterior', 'building_interior', 'npc', 'mob', 'creature', 'prop', 'vehicle', 'effect', 'ui']);
const DRAW_LAYERS = new Set(['ground', 'object', 'building', 'character', 'roof', 'effect', 'ui']);
const COVERAGE = new Set(['exact', 'mapped', 'future']);
const VOCABULARIES = new Set(['TILE_TYPES', 'NPC_ROLES', 'PROP_KINDS', 'FACILITY_KINDS', 'BUILDING_STATES']);
const RENDER_KINDS = new Set(['single', 'spritesheet', 'tileset', 'ui-sheet']);
const SPRITE_DIRECTIONS = new Set(['front', 'back', 'left', 'right']);
const SPRITE_AXES = new Set(['column', 'row']);
const FACING_TO_SPRITE_DIRECTION = Object.freeze({
  down: 'front',
  up: 'back',
  left: 'left',
  right: 'right'
});
const CARDINAL_DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);
const ROAD_CONNECTION_TILES = new Set(['road', 'path', 'bridge', 'stairs', 'plaza']);
const ASSET_ID_PATTERN = /^(character|building|field|object|ui|effect)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isUniqueStringArray(value, { allowed, requireItem = false } = {}) {
  return Array.isArray(value) && (!requireItem || value.length > 0) && value.length <= 1000
    && value.every((item) => typeof item === 'string' && item.length > 0 && (!allowed || allowed.has(item)))
    && new Set(value).size === value.length;
}

function isPositiveSize(value) {
  return hasExactKeys(value, ['width', 'height'])
    && isPositiveInteger(value.width) && isPositiveInteger(value.height);
}

function validateRenderSpec(spec) {
  if (!hasExactKeys(spec, [
    'kind', 'logicalSize', 'tileSize', 'nearestNeighbor', 'allowAntiAlias',
    'sprites', 'states', 'variantTags'
  ]) || !RENDER_KINDS.has(spec.kind)
    || (spec.logicalSize !== null && !isPositiveSize(spec.logicalSize))
    || (spec.tileSize !== null && !isPositiveInteger(spec.tileSize))
    || typeof spec.nearestNeighbor !== 'boolean' || typeof spec.allowAntiAlias !== 'boolean'
    || !isUniqueStringArray(spec.states) || !isUniqueStringArray(spec.variantTags)) {
    throw new Error('Invalid game asset render spec');
  }
  if (spec.kind === 'tileset' && !isPositiveInteger(spec.tileSize)) {
    throw new Error('Invalid tileset render spec');
  }
  if (spec.kind !== 'spritesheet') {
    if (spec.sprites !== null) throw new Error('Invalid non-spritesheet render spec');
    return spec;
  }
  const sprites = spec.sprites;
  const grid = sprites?.grid;
  if (!isPositiveSize(spec.logicalSize)
    || !hasExactKeys(sprites, ['directions', 'frames', 'grid', 'directionAxis', 'frameAxis'])
    || !isUniqueStringArray(sprites.directions, { allowed: SPRITE_DIRECTIONS })
    || !isUniqueStringArray(sprites.frames, { requireItem: true })
    || !hasExactKeys(grid, ['columns', 'rows', 'frameWidth', 'frameHeight'])
    || !isPositiveInteger(grid.columns) || !isPositiveInteger(grid.rows)
    || !isPositiveInteger(grid.frameWidth) || !isPositiveInteger(grid.frameHeight)
    || grid.frameWidth !== spec.logicalSize.width || grid.frameHeight !== spec.logicalSize.height
    || !SPRITE_AXES.has(sprites.frameAxis)
    || (sprites.directionAxis !== null && !SPRITE_AXES.has(sprites.directionAxis))) {
    throw new Error('Invalid spritesheet render spec');
  }
  const axisLength = (axis) => axis === 'column' ? grid.columns : grid.rows;
  const otherAxisLength = (axis) => axis === 'column' ? grid.rows : grid.columns;
  if (sprites.directions.length) {
    if (sprites.directionAxis === null || sprites.directionAxis === sprites.frameAxis
      || axisLength(sprites.directionAxis) !== sprites.directions.length
      || axisLength(sprites.frameAxis) !== sprites.frames.length) {
      throw new Error('Invalid spritesheet axes');
    }
  } else if (sprites.directionAxis !== null || axisLength(sprites.frameAxis) !== sprites.frames.length
    || otherAxisLength(sprites.frameAxis) !== 1) {
    throw new Error('Invalid spritesheet axes');
  }
  return spec;
}

export function validateGameAssetManifest(value) {
  const schemaVersion = value?.schemaVersion;
  const manifestKeys = schemaVersion === 2
    ? ['schemaVersion', 'generatedAt', 'complete', 'assets', 'missingBindings', 'missingAssets']
    : ['schemaVersion', 'generatedAt', 'complete', 'assets', 'missingBindings'];
  if (!hasExactKeys(value, manifestKeys)
    || ![1, 2].includes(schemaVersion) || typeof value.complete !== 'boolean'
    || typeof value.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.generatedAt)
    || Number.isNaN(Date.parse(value.generatedAt))
    || !Array.isArray(value.assets) || value.assets.length > 1000
    || !Array.isArray(value.missingBindings) || value.missingBindings.length > 1000
    || (schemaVersion === 2 && (!Array.isArray(value.missingAssets) || value.missingAssets.length > 1000))) {
    throw new Error('Unsupported game asset manifest');
  }
  const seenAssets = new Set();
  const seenBindings = new Set();
  for (const asset of value.assets) {
    const binding = asset?.gameBinding;
    const expectedAssetKeys = value.schemaVersion === 2
      ? ['assetId', 'category', 'sha256', 'publicPath', 'gameBinding', 'renderSpec']
      : ['assetId', 'category', 'sha256', 'publicPath', 'gameBinding'];
    if (!hasExactKeys(asset, expectedAssetKeys)
      || typeof asset.assetId !== 'string' || !asset.assetId || seenAssets.has(asset.assetId)
      || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !CATEGORIES.has(asset.category)
      || !/^\/assets\/forge\/v1\/[a-z0-9_./-]+\.png$/.test(asset.publicPath)
      || asset.publicPath.includes('..')
      || !hasExactKeys(binding, ['rendererCategory', 'semanticKind', 'drawLayer', 'runtimeBindings', 'coverage'])
      || !RENDERER_CATEGORIES.has(binding.rendererCategory)
      || typeof binding.semanticKind !== 'string' || !binding.semanticKind
      || !DRAW_LAYERS.has(binding.drawLayer) || !COVERAGE.has(binding.coverage)
      || !Array.isArray(binding.runtimeBindings) || binding.runtimeBindings.length > 1000) {
      throw new Error('Invalid game asset entry');
    }
    if (value.schemaVersion === 2) validateRenderSpec(asset.renderSpec);
    const expectedSuffix = `/${asset.sha256.slice(0, 16)}/${asset.assetId.replaceAll('.', '_')}.png`;
    if (!asset.publicPath.endsWith(expectedSuffix)) throw new Error('Invalid content-addressed game asset path');
    seenAssets.add(asset.assetId);
    for (const runtimeBinding of binding.runtimeBindings) {
      const key = `${runtimeBinding?.vocabulary}\0${runtimeBinding?.id}`;
      if (!hasExactKeys(runtimeBinding, ['vocabulary', 'id']) || !VOCABULARIES.has(runtimeBinding.vocabulary)
        || typeof runtimeBinding.id !== 'string' || !runtimeBinding.id) {
        throw new Error('Invalid game asset runtime binding');
      }
      seenBindings.add(key);
    }
  }
  const seenMissing = new Set();
  for (const missing of value.missingBindings) {
    const key = `${missing?.vocabulary}\0${missing?.runtimeId}`;
    if (!hasExactKeys(missing, ['vocabulary', 'runtimeId']) || !VOCABULARIES.has(missing.vocabulary)
      || typeof missing.runtimeId !== 'string' || !missing.runtimeId || seenMissing.has(key) || seenBindings.has(key)) {
      throw new Error('Invalid missing runtime binding');
    }
    seenMissing.add(key);
  }
  if (schemaVersion === 2) {
    const seenMissingAssets = new Set();
    let previous = null;
    for (const assetId of value.missingAssets) {
      if (typeof assetId !== 'string' || !ASSET_ID_PATTERN.test(assetId) || seenMissingAssets.has(assetId)
        || seenAssets.has(assetId) || (previous !== null && previous.localeCompare(assetId) >= 0)) {
        throw new Error('Invalid missing asset list');
      }
      seenMissingAssets.add(assetId);
      previous = assetId;
    }
  }
  const complete = value.missingBindings.length === 0
    && (schemaVersion === 1 || value.missingAssets.length === 0);
  if (value.complete !== complete) throw new Error('Invalid manifest completeness flag');
  return value;
}

export function indexGameAssets(manifest) {
  validateGameAssetManifest(manifest);
  const byBinding = new Map();
  const bySemantic = new Map();
  const variantsByBinding = new Map();
  const variantsBySemantic = new Map();
  const byRenderKind = new Map();
  const variantsByTag = new Map();
  for (const asset of [...manifest.assets].sort((left, right) => left.assetId.localeCompare(right.assetId))) {
    const semantic = asset.gameBinding.semanticKind;
    if (!bySemantic.has(semantic)) bySemantic.set(semantic, asset);
    if (!variantsBySemantic.has(semantic)) variantsBySemantic.set(semantic, []);
    variantsBySemantic.get(semantic).push(asset);
    const renderSpec = asset.renderSpec;
    if (renderSpec) {
      if (!byRenderKind.has(renderSpec.kind)) byRenderKind.set(renderSpec.kind, []);
      byRenderKind.get(renderSpec.kind).push(asset);
      for (const tag of renderSpec.variantTags) {
        if (!variantsByTag.has(tag)) variantsByTag.set(tag, []);
        variantsByTag.get(tag).push(asset);
      }
    }
    for (const binding of asset.gameBinding.runtimeBindings) {
      const key = `${binding.vocabulary}\0${binding.id}`;
      if (!byBinding.has(key)) byBinding.set(key, asset);
      if (!variantsByBinding.has(key)) variantsByBinding.set(key, []);
      variantsByBinding.get(key).push(asset);
    }
  }
  return { byBinding, bySemantic, variantsByBinding, variantsBySemantic, byRenderKind, variantsByTag };
}

export function assetForBinding(index, vocabulary, id) {
  return index?.byBinding?.get(`${vocabulary}\0${id}`) ?? null;
}

export function spriteDirectionForFacing(facing) {
  return FACING_TO_SPRITE_DIRECTION[facing] ?? 'front';
}

export function spriteSourceRect(renderSpec, {
  facing = 'down',
  direction,
  frameName = 'idle'
} = {}) {
  if (renderSpec?.kind !== 'spritesheet' || !renderSpec.sprites?.grid) return null;
  const { directions, frames, grid, directionAxis, frameAxis } = renderSpec.sprites;
  if (!Array.isArray(frames) || frames.length === 0) return null;

  const requestedDirection = direction ?? spriteDirectionForFacing(facing);
  const directionIndex = directions.length ? Math.max(0, directions.indexOf(requestedDirection)) : 0;
  let frameIndex = frames.indexOf(frameName);
  if (frameIndex < 0) frameIndex = Math.max(0, frames.indexOf('idle'));

  let column = 0;
  let row = 0;
  if (directionAxis === 'column') column = directionIndex;
  else if (directionAxis === 'row') row = directionIndex;
  if (frameAxis === 'column') column = frameIndex;
  else if (frameAxis === 'row') row = frameIndex;

  return {
    sx: column * grid.frameWidth,
    sy: row * grid.frameHeight,
    sw: grid.frameWidth,
    sh: grid.frameHeight
  };
}

export function staticEffectSourceRect(renderSpec) {
  try {
    validateRenderSpec(renderSpec);
  } catch {
    return null;
  }
  if (renderSpec.kind !== 'spritesheet' || !renderSpec.sprites.frames.includes('frame_1')) return null;
  return spriteSourceRect(renderSpec, { frameName: 'frame_1' });
}

export function selectLoadedStaticEffect(index, semanticKind, availableAssetIds) {
  if (!availableAssetIds?.has) return null;
  const asset = index?.bySemantic?.get(semanticKind);
  if (!asset || asset.gameBinding?.rendererCategory !== 'effect'
    || !availableAssetIds.has(asset.assetId)) return null;
  const source = staticEffectSourceRect(asset.renderSpec);
  return source ? { asset, source } : null;
}

export function buildingStateVisuals(state) {
  return {
    opacity: state === 'vacant' ? 0.55 : 1,
    hatch: state === 'ruined' || state === 'under_construction',
    busy: state === 'busy'
  };
}

function stableHash(text) {
  let value = 2166136261;
  for (const char of String(text)) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function availableCandidates(index, vocabulary, id, availableAssetIds) {
  const candidates = index?.variantsByBinding?.get(`${vocabulary}\0${id}`) ?? [];
  if (!availableAssetIds?.has) return candidates;
  return candidates.filter((asset) => availableAssetIds.has(asset.assetId));
}

function uniqueCandidates(...groups) {
  const result = [];
  const seen = new Set();
  for (const asset of groups.flat()) {
    if (!asset || seen.has(asset.assetId)) continue;
    seen.add(asset.assetId);
    result.push(asset);
  }
  return result;
}

function preferredCandidate(candidates, semanticKinds) {
  for (const semanticKind of semanticKinds) {
    const asset = candidates.find((candidate) => candidate.gameBinding.semanticKind === semanticKind);
    if (asset) return asset;
  }
  return null;
}

function stableSemanticCandidate(candidates, semanticKinds, stableKey) {
  const available = semanticKinds
    .map((semanticKind) => candidates.find((candidate) => candidate.gameBinding.semanticKind === semanticKind))
    .filter(Boolean);
  return available.length ? available[stableHash(stableKey) % available.length] : null;
}

export function cardinalTerrainNeighbors(terrain, x, y) {
  return {
    up: terrain?.[y - 1]?.[x],
    right: terrain?.[y]?.[x + 1],
    down: terrain?.[y + 1]?.[x],
    left: terrain?.[y]?.[x - 1]
  };
}

function roadSelection(candidates, neighbors) {
  const connected = CARDINAL_DIRECTIONS.filter((direction) => ROAD_CONNECTION_TILES.has(neighbors?.[direction]));
  if (connected.length >= 3) {
    return { asset: preferredCandidate(candidates, ['road_intersection', 'cobblestone']), quarterTurns: 0 };
  }
  if (connected.length === 2) {
    const positions = connected.map((direction) => CARDINAL_DIRECTIONS.indexOf(direction));
    const isCorner = Math.abs(positions[0] - positions[1]) % 2 === 1;
    if (isCorner) {
      const cornerTurns = new Map([
        ['up,right', 0], ['right,down', 1], ['down,left', 2], ['up,left', 3]
      ]);
      const key = CARDINAL_DIRECTIONS.filter((direction) => connected.includes(direction)).join(',');
      return { asset: preferredCandidate(candidates, ['road_corner', 'cobblestone']), quarterTurns: cornerTurns.get(key) ?? 0 };
    }
    return { asset: preferredCandidate(candidates, ['cobblestone']), quarterTurns: 0 };
  }
  if (connected.length === 1) {
    return {
      asset: preferredCandidate(candidates, ['road_edge', 'cobblestone']),
      quarterTurns: CARDINAL_DIRECTIONS.indexOf(connected[0])
    };
  }
  return { asset: preferredCandidate(candidates, ['cobblestone']), quarterTurns: 0 };
}

export function selectTerrainAsset(index, {
  tileType,
  neighbors = {},
  x = 0,
  y = 0,
  bridgeStyle,
  availableAssetIds
} = {}) {
  const candidates = availableCandidates(index, 'TILE_TYPES', tileType, availableAssetIds);
  if (candidates.length === 0) return null;
  if (tileType === 'road') {
    const selection = roadSelection(candidates, neighbors);
    return selection.asset ? selection : null;
  }
  if (tileType === 'water') {
    const edgeDirection = CARDINAL_DIRECTIONS.find((direction) => !['water', 'bridge'].includes(neighbors[direction]));
    const asset = preferredCandidate(candidates, edgeDirection ? ['river_edge', 'water'] : ['water', 'river_edge']);
    return asset ? {
      asset,
      quarterTurns: edgeDirection ? CARDINAL_DIRECTIONS.indexOf(edgeDirection) : 0
    } : null;
  }
  if (tileType === 'bridge') {
    const waterUpDown = neighbors.up === 'water' || neighbors.down === 'water';
    const waterLeftRight = neighbors.left === 'water' || neighbors.right === 'water';
    const orientation = waterLeftRight && !waterUpDown ? 'vertical' : 'horizontal';
    const styles = bridgeStyle === 'stone'
      ? ['bridge_stone', 'bridge_wood']
      : bridgeStyle === 'wood'
        ? ['bridge_wood', 'bridge_stone']
        : ['bridge_stone', 'bridge_wood'];
    const asset = bridgeStyle
      ? preferredCandidate(candidates, styles)
      : stableSemanticCandidate(candidates, styles, `bridge:${x},${y}:${orientation}`);
    return asset ? { asset, quarterTurns: orientation === 'vertical' ? 1 : 0, orientation } : null;
  }
  const exact = preferredCandidate(candidates, [tileType]);
  if (exact) return { asset: exact, quarterTurns: 0 };
  return candidates.length === 1 ? { asset: candidates[0], quarterTurns: 0 } : null;
}

export function selectBuildingAsset(index, { building, availableAssetIds } = {}) {
  const kind = building?.facilityKind;
  const candidates = availableCandidates(index, 'FACILITY_KINDS', kind, availableAssetIds);
  if (candidates.length === 0) return null;
  if (kind !== 'house') return preferredCandidate(candidates, [kind]) ?? (candidates.length === 1 ? candidates[0] : null);
  const footprint = building.footprint ?? { widthTiles: 1, heightTiles: 1 };
  let preferences;
  if (building.state === 'ruined' || building.state === 'vacant') preferences = ['old_house', 'hut', 'house_small', 'house_medium'];
  else if (building.state === 'under_construction') preferences = ['hut', 'house_small', 'house_medium', 'old_house'];
  else if (building.state === 'busy' || footprint.widthTiles >= 3 || footprint.heightTiles >= 3) {
    preferences = ['house_medium', 'house_small', 'hut', 'old_house'];
  } else preferences = ['house_small', 'hut', 'house_medium', 'old_house'];
  return preferredCandidate(candidates, preferences);
}

export function selectNpcAsset(index, { npc, availableAssetIds } = {}) {
  const role = npc?.role;
  let candidates = availableCandidates(index, 'NPC_ROLES', role, availableAssetIds);
  const stableKey = npc?.id ?? `${role}:${npc?.x ?? 0},${npc?.y ?? 0}`;
  if (role === 'resident') {
    candidates = uniqueCandidates(candidates, availableCandidates(index, 'NPC_ROLES', 'townsfolk', availableAssetIds));
    return stableSemanticCandidate(candidates, ['artisan', 'townsfolk_male', 'townsfolk_female', 'elder'], stableKey);
  }
  if (role === 'townsfolk') {
    return stableSemanticCandidate(
      candidates,
      ['townsfolk_male', 'townsfolk_female', 'elder', 'tavern_guest', 'inn_guest', 'dock_worker'],
      stableKey
    );
  }
  if (role === 'traveler') {
    return stableSemanticCandidate(candidates, ['traveler', 'delivery_person'], stableKey);
  }
  return preferredCandidate(candidates, [role]) ?? (candidates.length === 1 ? candidates[0] : null);
}

export function selectPropAsset(index, { prop, availableAssetIds } = {}) {
  const kind = prop?.kind;
  const candidates = availableCandidates(index, 'PROP_KINDS', kind, availableAssetIds);
  if (candidates.length === 0) return null;
  const stableKey = prop?.id ?? `${kind}:${prop?.x ?? 0},${prop?.y ?? 0}`;
  const stableFamilies = {
    crate: ['crate', 'stacked_crates'],
    lamp: ['lamp', 'streetlight'],
    signboard: ['signboard', 'notice_board']
  };
  if (stableFamilies[kind]) return stableSemanticCandidate(candidates, stableFamilies[kind], stableKey);
  if (kind === 'plant') return stableSemanticCandidate(candidates, ['flowerbed', 'grass_patch'], stableKey);
  if (kind === 'flag') {
    const explicit = {
      red: 'red_flag', yellow: 'yellow_flag', blue: 'blue_flag', warning: 'warning_stake',
      ruined: 'red_flag', busy: 'yellow_flag', occupied: 'blue_flag'
    }[prop?.color ?? prop?.state];
    return explicit
      ? preferredCandidate(candidates, [explicit])
      : stableSemanticCandidate(candidates, ['red_flag', 'yellow_flag', 'blue_flag', 'warning_stake'], stableKey);
  }
  return preferredCandidate(candidates, [kind]) ?? (candidates.length === 1 ? candidates[0] : null);
}

export function characterDestinationRect(renderSpec, { tileX, tileY, tileSize } = {}) {
  const size = renderSpec?.logicalSize;
  if (!isPositiveSize(size) || !isPositiveInteger(tileSize)
    || !Number.isFinite(tileX) || !Number.isFinite(tileY)) return null;
  const scale = tileSize / 16;
  const dw = size.width * scale;
  const dh = size.height * scale;
  return {
    dx: tileX * tileSize + (tileSize - dw) / 2,
    dy: (tileY + 1) * tileSize - dh,
    dw,
    dh
  };
}

export function isWalkableTile(tileType) {
  return WALKABLE_TILES.has(tileType);
}

export function buildingOccupiesTile(buildings, x, y) {
  return (buildings ?? []).some((building) => {
    const footprint = building.footprint ?? { widthTiles: 1, heightTiles: 1 };
    return x >= building.x && x < building.x + footprint.widthTiles
      && y >= building.y && y < building.y + footprint.heightTiles;
  });
}

export function canPlayerEnter(layout, x, y) {
  const map = layout?.map;
  if (!map || x < 0 || y < 0 || x >= map.widthTiles || y >= map.heightTiles) return false;
  if (!isWalkableTile(map.terrain?.[y]?.[x])) return false;
  return !buildingOccupiesTile(layout.buildings, x, y);
}

export function findPlayerSpawn(layout) {
  const map = layout?.map;
  if (!map) return null;
  const preferred = ['plaza', 'path', 'road', 'grass', 'dirt', 'bridge', 'stairs', 'sand', 'floor'];
  for (const tileType of preferred) {
    for (let y = 0; y < map.heightTiles; y += 1) {
      for (let x = 0; x < map.widthTiles; x += 1) {
        if (map.terrain?.[y]?.[x] === tileType && canPlayerEnter(layout, x, y)) return { x, y, facing: 'down' };
      }
    }
  }
  return null;
}

export function movePlayer(layout, player, direction) {
  const vectors = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const vector = vectors[direction];
  if (!player || !vector) return player;
  const next = { x: player.x + vector[0], y: player.y + vector[1], facing: direction };
  return canPlayerEnter(layout, next.x, next.y) ? next : { ...player, facing: direction };
}

export async function loadGameAssets({ fetchImpl = fetch, createImage = () => new Image() } = {}) {
  let response;
  try {
    response = await fetchImpl('/assets/forge/manifest.json', { cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch {
    return { status: 'fallback', reason: 'asset manifest request failed', manifest: null, index: null, images: new Map() };
  }
  if (!response.ok) return { status: 'fallback', reason: `asset manifest HTTP ${response.status}`, manifest: null, index: null, images: new Map() };
  let manifest;
  let index;
  try {
    manifest = validateGameAssetManifest(await response.json());
    index = indexGameAssets(manifest);
  } catch {
    return { status: 'fallback', reason: 'asset manifest validation failed', manifest: null, index: null, images: new Map() };
  }
  const images = new Map();
  const failures = [];
  await Promise.all(manifest.assets.map((asset) => new Promise((resolve) => {
    const image = createImage();
    image.onload = () => { images.set(asset.assetId, image); resolve(); };
    image.onerror = () => { failures.push(asset.assetId); resolve(); };
    image.src = asset.publicPath;
  })));
  const reason = [
    manifest.schemaVersion === 1
      ? 'legacy manifest lacks v2 render metadata and required-asset inventory'
      : null,
    manifest.missingBindings.length
      ? `${manifest.missingBindings.length} runtime binding(s) lack approved art`
      : null,
    manifest.schemaVersion === 2 && manifest.missingAssets.length
      ? `${manifest.missingAssets.length} required asset(s) lack approved art`
      : null,
    failures.length ? `${failures.length} approved image(s) failed to load` : null
  ].filter(Boolean).join('; ') || null;
  return {
    status: manifest.assets.length === 0 ? 'fallback' : (reason ? 'partial' : 'loaded'),
    reason,
    manifest, index, images, failures
  };
}
