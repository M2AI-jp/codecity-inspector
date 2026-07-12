const WALKABLE_TILES = new Set(['grass', 'dirt', 'path', 'road', 'sand', 'bridge', 'stairs', 'plaza', 'floor']);
const CATEGORIES = new Set(['character', 'building', 'field', 'object', 'ui', 'effect']);
const RENDERER_CATEGORIES = new Set(['tile', 'building_exterior', 'building_interior', 'npc', 'mob', 'creature', 'prop', 'vehicle', 'effect', 'ui']);
const DRAW_LAYERS = new Set(['ground', 'object', 'building', 'character', 'roof', 'effect', 'ui']);
const COVERAGE = new Set(['exact', 'mapped', 'future']);
const VOCABULARIES = new Set(['TILE_TYPES', 'NPC_ROLES', 'PROP_KINDS', 'FACILITY_KINDS', 'BUILDING_STATES']);

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

export function validateGameAssetManifest(value) {
  if (!hasExactKeys(value, ['schemaVersion', 'generatedAt', 'complete', 'assets', 'missingBindings'])
    || value.schemaVersion !== 1 || typeof value.complete !== 'boolean'
    || typeof value.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.generatedAt)
    || Number.isNaN(Date.parse(value.generatedAt))
    || !Array.isArray(value.assets) || value.assets.length > 1000
    || !Array.isArray(value.missingBindings) || value.missingBindings.length > 1000) {
    throw new Error('Unsupported game asset manifest');
  }
  const seenAssets = new Set();
  const seenBindings = new Set();
  for (const asset of value.assets) {
    const binding = asset?.gameBinding;
    if (!hasExactKeys(asset, ['assetId', 'category', 'sha256', 'publicPath', 'gameBinding'])
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
  if (value.complete !== (value.missingBindings.length === 0)) throw new Error('Invalid manifest completeness flag');
  return value;
}

export function indexGameAssets(manifest) {
  validateGameAssetManifest(manifest);
  const byBinding = new Map();
  const bySemantic = new Map();
  const variantsByBinding = new Map();
  const variantsBySemantic = new Map();
  for (const asset of [...manifest.assets].sort((left, right) => left.assetId.localeCompare(right.assetId))) {
    const semantic = asset.gameBinding.semanticKind;
    if (!bySemantic.has(semantic)) bySemantic.set(semantic, asset);
    if (!variantsBySemantic.has(semantic)) variantsBySemantic.set(semantic, []);
    variantsBySemantic.get(semantic).push(asset);
    for (const binding of asset.gameBinding.runtimeBindings) {
      const key = `${binding.vocabulary}\0${binding.id}`;
      if (!byBinding.has(key)) byBinding.set(key, asset);
      if (!variantsByBinding.has(key)) variantsByBinding.set(key, []);
      variantsByBinding.get(key).push(asset);
    }
  }
  return { byBinding, bySemantic, variantsByBinding, variantsBySemantic };
}

export function assetForBinding(index, vocabulary, id) {
  return index?.byBinding?.get(`${vocabulary}\0${id}`) ?? null;
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
  const manifest = validateGameAssetManifest(await response.json());
  const index = indexGameAssets(manifest);
  const images = new Map();
  const failures = [];
  await Promise.all(manifest.assets.map((asset) => new Promise((resolve) => {
    const image = createImage();
    image.onload = () => { images.set(asset.assetId, image); resolve(); };
    image.onerror = () => { failures.push(asset.assetId); resolve(); };
    image.src = asset.publicPath;
  })));
  const incompleteReason = manifest.complete ? null : `${manifest.missingBindings.length} runtime binding(s) lack approved art`;
  const reason = [
    incompleteReason,
    failures.length ? `${failures.length} approved image(s) failed to load` : null
  ].filter(Boolean).join('; ') || null;
  return {
    status: manifest.assets.length === 0 ? 'fallback' : (reason ? 'partial' : 'loaded'),
    reason,
    manifest, index, images, failures
  };
}
