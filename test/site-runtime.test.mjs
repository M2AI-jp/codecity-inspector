import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ASSET_CONTRACTS,
  FORGE_MANIFEST_URL,
  REQUIRED_ASSET_IDS,
  SITE_CANVAS,
  SITE_RECIPES,
  SITE_RENDER_LAYERS,
  authoredTilePlacement,
  auditRuntimeAssetUsage,
  auditSiteRecipes,
  characterFrameRect,
  computeSiteCamera,
  createAssetResolver,
  effectFrameRect,
  groundAssetAt,
  groundTransformAt,
  loadForgeAssetImages,
  nextSiteNodeForDirection,
  shortestSitePath,
  snowPixelOverlaysAt,
  siteRecipesForFacility,
  validateForgeManifest
} from '../public/site-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

async function requiredCatalogDefinitions() {
  const directory = `${root}/tools/asset-forge/data/asset-definitions`;
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  const catalogs = await Promise.all(files.map(async (file) => JSON.parse(await readFile(`${directory}/${file}`, 'utf8'))));
  return catalogs.flatMap((catalog) => catalog.assets).filter((asset) => asset.required === true)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function manifestEntryFromCatalogDefinition(definition, index) {
  const kind = definition.output.kind;
  return {
    assetId: definition.id,
    category: definition.category,
    publicPath: `/assets/forge/v1/${index.toString(16).padStart(16, '0')}/${definition.id.replaceAll('.', '_')}.png`,
    sha256: index.toString(16).padStart(64, '0'),
    renderSpec: {
      kind,
      logicalSize: definition.pixelArt.logicalSpriteSize ? { ...definition.pixelArt.logicalSpriteSize } : null,
      tileSize: definition.pixelArt.tileSize ?? null,
      nearestNeighbor: definition.pixelArt.nearestNeighbor,
      allowAntiAlias: definition.pixelArt.allowAntiAlias,
      sprites: kind === 'spritesheet' ? { grid: { ...definition.sprites.grid } } : null
    }
  };
}

function manifestFixture() {
  return {
    schemaVersion: 2,
    complete: true,
    missingAssets: [],
    missingBindings: [],
    generatedAt: '2026-07-14T00:00:00.000Z',
    assets: REQUIRED_ASSET_IDS.map((assetId, index) => {
      const contract = ASSET_CONTRACTS[assetId];
      return {
        assetId,
        category: contract.category,
        publicPath: `/assets/forge/v1/${String(index).padStart(16, 'a')}/${assetId.replaceAll('.', '_')}.png`,
        sha256: index.toString(16).padStart(64, '0'),
        renderSpec: {
          kind: contract.kind,
          nearestNeighbor: true,
          allowAntiAlias: false,
          tileSize: contract.tileSize ?? null,
          logicalSize: contract.logicalWidth
            ? { width: contract.logicalWidth, height: contract.logicalHeight }
            : null,
          sprites: contract.grid ? { grid: contract.grid } : null
        }
      };
    })
  };
}

test('strict manifest accepts exactly the 78 completion assets and rejects partial or extra sets', () => {
  const manifest = manifestFixture();
  const validation = validateForgeManifest(manifest);
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.equal(validation.assetCount, 78);
  assert.deepEqual(validation.categoryCounts, { building: 17, character: 22, effect: 2, field: 19, object: 18 });
  const resolver = createAssetResolver(manifest);
  assert.deepEqual(resolver.ids, REQUIRED_ASSET_IDS);
  assert.equal(resolver.get('character.player').assetId, 'character.player');
  assert.throws(() => resolver.get('ui.dialogue'), /代替素材は使用しません/);

  const missing = structuredClone(manifest);
  missing.assets.pop();
  missing.complete = false;
  missing.missingAssets = [REQUIRED_ASSET_IDS.at(-1)];
  assert.equal(validateForgeManifest(missing).ok, false);
  assert.throws(() => createAssetResolver(missing), /公開マニフェストが不完全/);

  const extra = structuredClone(manifest);
  extra.assets.push({ ...extra.assets[0], assetId: 'ui.asset_gallery' });
  assert.equal(validateForgeManifest(extra).ok, false);
});

test('runtime required IDs exactly match the current Asset Forge required catalog', async () => {
  const definitions = await requiredCatalogDefinitions();
  const catalogIds = definitions.map((definition) => definition.id);
  assert.equal(catalogIds.length, 78);
  assert.deepEqual(REQUIRED_ASSET_IDS, catalogIds);

  const manifest = {
    schemaVersion: 2,
    complete: true,
    missingAssets: [],
    missingBindings: [],
    generatedAt: '2026-07-14T00:00:00.000Z',
    assets: definitions.map(manifestEntryFromCatalogDefinition)
  };
  const validation = validateForgeManifest(manifest);
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.deepEqual(validation.missing, []);
  assert.deepEqual(validation.unexpected, []);
});

test('loader fetches only manifest.json as its Forge entry and verifies every master dimension', async () => {
  const manifest = manifestFixture();
  const dimensionsByPath = new Map(manifest.assets.map((entry) => {
    const contract = ASSET_CONTRACTS[entry.assetId];
    return [entry.publicPath, { width: contract.width, height: contract.height }];
  }));
  const fetches = [];
  const fetchImpl = async (url) => {
    fetches.push(url);
    return { ok: true, status: 200, json: async () => structuredClone(manifest) };
  };
  class FakeImage {
    listeners = new Map();
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    set src(value) {
      const dimensions = dimensionsByPath.get(value);
      this.naturalWidth = dimensions?.width ?? 0;
      this.naturalHeight = dimensions?.height ?? 0;
      queueMicrotask(() => this.listeners.get(dimensions ? 'load' : 'error')?.());
    }
  }
  const loaded = await loadForgeAssetImages({ fetchImpl, imageFactory: () => new FakeImage() });
  assert.deepEqual(fetches, [FORGE_MANIFEST_URL]);
  assert.equal(loaded.images.size, 78);
  assert.equal(loaded.resolver.get('building.town_hall').publicPath.includes('/assets/forge/'), true);

  const brokenManifest = manifestFixture();
  const brokenPlayer = brokenManifest.assets.find((entry) => entry.assetId === 'character.player');
  brokenPlayer.renderSpec.sprites.grid = { ...brokenPlayer.renderSpec.sprites.grid, frameWidth: 20 };
  await assert.rejects(
    () => loadForgeAssetImages({
      fetchImpl: async () => ({ ok: true, json: async () => brokenManifest }),
      imageFactory: () => new FakeImage()
    }),
    /公開マニフェストが不完全/
  );
});

test('17 deterministic sites provide four house stops and semantic singleton entrances', () => {
  const audit = auditSiteRecipes();
  assert.equal(audit.ok, true, audit.issues.join('\n'));
  assert.equal(SITE_RECIPES.length, 17);
  assert.equal(siteRecipesForFacility('house').length, 4);
  assert.deepEqual(siteRecipesForFacility('house').map((site) => site.building.assetId).sort(), [
    'building.house.medium', 'building.house.small', 'building.hut', 'building.old_house'
  ]);
  for (const kind of ['town_hall', 'gate', 'guild', 'pub', 'shop', 'inn', 'dock', 'dojo', 'well', 'workshop', 'warehouse', 'watchtower', 'ruin']) {
    const routes = siteRecipesForFacility(kind);
    assert.equal(routes.length, 1, kind);
    assert.equal(routes[0].facilityKind, kind);
  }
  for (const site of SITE_RECIPES) {
    assert.equal(site.evidence, undefined, `${site.id} must not invent repository evidence`);
    assert.equal(shortestSitePath(site, site.playerStartNodeId, site.evidenceNodeId).length > 1, true, site.id);
  }
});

test('all 17 scenes are authored 8x12 districts with varied ground and sufficient lived-in density', () => {
  const serializedMaps = new Set();
  for (const site of SITE_RECIPES) {
    assert.equal(site.groundMap.length, 8, site.id);
    assert.equal(site.groundMap.every((row) => row.length === 12), true, site.id);
    const cells = site.groundMap.flatMap((row, y) => [...row].map((_, x) => groundAssetAt(site, x, y)));
    assert.equal(cells.length, 96, site.id);
    assert.equal(cells.every((assetId) => assetId?.startsWith('field.')), true, site.id);
    const counts = new Map(cells.map((assetId) => [assetId, cells.filter((value) => value === assetId).length]));
    assert.ok(counts.size >= (site.id === 'snow_watch' ? 2 : 3), site.id);
    const woodland = ['woodland_hut', 'overgrown_ruin'].includes(site.id);
    assert.ok(Math.max(...counts.values()) <= (woodland ? 84 : site.id === 'snow_watch' ? 92 : 72), site.id);
    const placed = site.structures.length + site.rearDecor.length + site.props.length + site.npcs.length
      + site.frontOccluders.length + site.effects.length;
    assert.ok(placed >= (woodland ? 70 : 18) && placed <= (woodland ? 90 : 28), site.id);
    assert.ok(site.structures.length >= 3 && site.structures.length <= 5, site.id);
    assert.equal(site.structures.filter((entry) => entry.role === 'main').length, 1, site.id);
    assert.equal(site.structures.every((entry) => entry.width === 256 && entry.height === 256
      && Number.isInteger(entry.x) && Number.isInteger(entry.y) && Number.isInteger(entry.baselineY)), true, site.id);
    for (const node of site.route) {
      const point = { x: node.x * 64 + 32, y: node.y * 64 + 52 };
      assert.equal(site.structures.some((entry) => point.x >= entry.x && point.x <= entry.x + entry.width
        && point.y >= entry.y && point.y <= entry.y + entry.height), false, `${site.id}:${node.id} crosses a structure`);
    }
    if (!woodland && site.id !== 'snow_watch') {
      assert.ok(site.groundMap.filter((row) => row === [...row].reverse().join('')).length <= 2, `${site.id} is overly symmetric`);
    }
    serializedMaps.add(site.groundMap.join('\n'));
  }
  assert.equal(serializedMaps.size, 17, 'every outdoor district must have a distinct authored ground map');
});

test('directional field transforms match waterways, boundaries, and road orientation without enlargement', () => {
  const directional = new Set([
    'field.bridge_stone', 'field.bridge_wood', 'field.river_edge',
    'field.road_corner', 'field.road_edge', 'field.stairs_stone'
  ]);
  for (const site of SITE_RECIPES) {
    const directionalTransforms = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const assetId = groundAssetAt(site, x, y);
        if (!directional.has(assetId)) continue;
        const transform = groundTransformAt(site, x, y);
        assert.ok(Number.isInteger(transform.quarterTurns) && transform.quarterTurns >= 0 && transform.quarterTurns <= 3);
        assert.equal(typeof transform.flipX, 'boolean');
        directionalTransforms.push(`${transform.quarterTurns}:${transform.flipX}`);
        if (assetId === 'field.river_edge') {
          const expectedTurn = groundAssetAt(site, x + 1, y) === 'field.water' ? 3
            : groundAssetAt(site, x - 1, y) === 'field.water' ? 1
              : groundAssetAt(site, x, y - 1) === 'field.water' ? 2
                : groundAssetAt(site, x, y + 1) === 'field.water' ? 0 : null;
          assert.notEqual(expectedTurn, null, `${site.id}:${x},${y}`);
          assert.equal(transform.quarterTurns, expectedTurn, `${site.id}:${x},${y}`);
        }
        if (assetId === 'field.bridge_stone' || assetId === 'field.bridge_wood') {
          assert.equal(groundAssetAt(site, x, y - 1), 'field.water', `${site.id}:${x},${y}`);
          assert.equal(groundAssetAt(site, x, y + 1), 'field.water', `${site.id}:${x},${y}`);
          assert.equal(transform.quarterTurns, 0, `${site.id}:${x},${y}`);
        }
        if (assetId === 'field.stairs_stone') assert.equal(transform.quarterTurns, 0, `${site.id}:${x},${y}`);
        if (assetId === 'field.road_edge') assert.equal(transform.quarterTurns, 1, `${site.id}:${x},${y}`);
      }
    }
    if (directionalTransforms.length > 1) assert.ok(new Set(directionalTransforms).size > 1, `${site.id} repeats a directional stripe`);
  }
});

test('grass, dirt, and snow use deterministic native-safe four-phase variation without 90-degree rotation', () => {
  const varied = new Set(['field.grass', 'field.dirt_path', 'field.snow']);
  const phases = new Set();
  for (const site of SITE_RECIPES) for (let y = 0; y < SITE_CANVAS.rows; y += 1) {
    for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
      if (!varied.has(groundAssetAt(site, x, y))) continue;
      const first = groundTransformAt(site, x, y);
      const second = groundTransformAt(site, x, y);
      assert.deepEqual(first, second, `${site.id}:${x},${y}`);
      assert.equal(first.quarterTurns === 0 || first.quarterTurns === 2, true, `${site.id}:${x},${y}`);
      assert.equal(typeof first.flipX, 'boolean');
      phases.add(`${first.quarterTurns}:${first.flipX}`);
      const centerX = x * SITE_CANVAS.cellSize + SITE_CANVAS.cellSize / 2;
      const centerY = y * SITE_CANVAS.cellSize + SITE_CANVAS.cellSize / 2;
      assert.equal(centerX - 32 >= 0 && centerX + 32 <= SITE_CANVAS.width, true);
      assert.equal(centerY - 32 >= 0 && centerY + 32 <= SITE_CANVAS.height, true);
    }
  }
  assert.deepEqual([...phases].sort(), ['0:false', '0:true', '2:false', '2:true']);
});

test('routes stay on visible floors and bridges/stairs retain terrain meaning', () => {
  const routeFields = new Set([
    'field.bridge_stone', 'field.bridge_wood', 'field.cobblestone', 'field.dirt_path',
    'field.dock_floor', 'field.plaza', 'field.road_corner', 'field.road_edge',
    'field.road_intersection', 'field.snow', 'field.stairs_stone'
  ]);
  const bridgeFields = new Set(['field.bridge_stone', 'field.bridge_wood']);
  const boundaryFields = new Set(['field.cliff', 'field.wall_stone']);
  const neighbors = (site, x, y) => [
    groundAssetAt(site, x - 1, y), groundAssetAt(site, x + 1, y),
    groundAssetAt(site, x, y - 1), groundAssetAt(site, x, y + 1)
  ];
  for (const site of SITE_RECIPES) {
    assert.equal(site.route.every((node) => routeFields.has(groundAssetAt(site, node.x, node.y))), true, site.id);
    assert.ok(shortestSitePath(site, site.playerStartNodeId, site.evidenceNodeId).length > 1, site.id);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const assetId = groundAssetAt(site, x, y);
        if (bridgeFields.has(assetId)) {
          const spans = (groundAssetAt(site, x, y - 1) === 'field.water' && groundAssetAt(site, x, y + 1) === 'field.water')
            || (groundAssetAt(site, x - 1, y) === 'field.water' && groundAssetAt(site, x + 1, y) === 'field.water');
          assert.equal(spans, true, `${site.id}:${x},${y}`);
        }
        if (assetId === 'field.stairs_stone') {
          assert.equal(neighbors(site, x, y).some((neighbor) => boundaryFields.has(neighbor)), true, `${site.id}:${x},${y}`);
        }
      }
    }
  }
});

test('snow watch uses real snow while harbor uses a meaningful dock waterway without sand', () => {
  assert.equal(REQUIRED_ASSET_IDS.includes('field.snow'), true);
  assert.equal(REQUIRED_ASSET_IDS.includes('field.sand'), false);

  const snow = SITE_RECIPES.find((site) => site.id === 'snow_watch');
  const snowCells = snow.groundMap.flatMap((row, y) => [...row].map((_, x) => groundAssetAt(snow, x, y)));
  const winterTerrain = new Set(['field.snow', 'field.cobblestone']);
  assert.deepEqual([...new Set(snowCells)].sort(), [...winterTerrain].sort());
  assert.equal(snowCells.every((assetId) => winterTerrain.has(assetId)), true);
  for (const greenBaseTerrain of ['field.grass', 'field.rock', 'field.wall_stone', 'field.cliff', 'field.stairs_stone', 'field.dirt_path']) {
    assert.equal(snowCells.includes(greenBaseTerrain), false, greenBaseTerrain);
  }
  const snowCount = snowCells.filter((assetId) => assetId === 'field.snow').length;
  const masonryCount = snowCells.filter((assetId) => assetId === 'field.cobblestone').length;
  assert.ok(snowCount >= 33 && snowCount > masonryCount,
    `snow ${snowCount} must be the district's primary exposed ground, ahead of masonry ${masonryCount}`);
  assert.equal(snow.building.x, 320);
  assert.equal(snow.evidenceNodeId, '7,4');
  assert.equal(snow.route.every((node) => groundAssetAt(snow, node.x, node.y) === 'field.cobblestone'), true);
  for (let y = 0; y < SITE_CANVAS.rows; y += 1) {
    const road = [...snow.groundMap[y]].map((_, x) => groundAssetAt(snow, x, y) === 'field.cobblestone' ? 'c' : 'n').join('');
    assert.ok((road.match(/c/g) ?? []).length <= 1, `snow_watch:${y} road must stay exactly one tile wide`);
  }
  const winterContextAssets = snow.structures.filter((entry) => entry.role === 'context').map((entry) => entry.assetId);
  const darkSlateBlueRoofs = new Set(['building.old_house', 'building.house.small', 'building.hut', 'building.warehouse']);
  assert.equal(winterContextAssets.length, 4);
  assert.equal(winterContextAssets.every((assetId) => darkSlateBlueRoofs.has(assetId)), true);
  assert.equal(snow.structures.filter((entry) => entry.role === 'context').some((entry) => entry.x < 0 || entry.x + entry.width > SITE_CANVAS.width || entry.y < 0), true,
    'winter village context should clip naturally against the upper and side boundaries');

  const snowOverlayCells = [];
  const overlaySignatures = new Set();
  const overlayColors = new Set();
  for (let y = 0; y < SITE_CANVAS.rows; y += 1) for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
    const first = snowPixelOverlaysAt(snow, x, y);
    const second = snowPixelOverlaysAt(snow, x, y);
    assert.deepEqual(first, second, `${x},${y}: deterministic overlay`);
    if (groundAssetAt(snow, x, y) !== 'field.snow') {
      assert.deepEqual(first, [], `${x},${y}: overlay must stay on snow`);
      continue;
    }
    assert.ok(first.length <= 2, `${x},${y}: at most two drifts`);
    if (first.length === 0) continue;
    snowOverlayCells.push(`${x},${y}`);
    overlaySignatures.add(JSON.stringify(first));
    for (const drift of first) {
      overlayColors.add(drift.color);
      assert.ok(drift.rectangles.length >= 2 && drift.rectangles.length <= 4);
      for (const rectangle of drift.rectangles) {
        assert.equal([rectangle.x, rectangle.y, rectangle.width, rectangle.height].every((value) => value % 2 === 0), true);
        assert.ok(rectangle.width >= 4 && rectangle.width <= 16);
        assert.ok(rectangle.height >= 2 && rectangle.height <= 6);
        assert.ok(rectangle.x >= 0 && rectangle.y >= 0 && rectangle.x + rectangle.width <= 64 && rectangle.y + rectangle.height <= 64);
      }
    }
  }
  assert.ok(snowOverlayCells.length / snowCount >= 0.2 && snowOverlayCells.length / snowCount <= 0.35,
    `snow overlay coverage ${snowOverlayCells.length}/${snowCount}`);
  assert.equal(overlaySignatures.size, snowOverlayCells.length, 'snow overlay patterns must not cycle');
  assert.ok(overlayColors.size <= 3);

  const nonWinterTerrain = SITE_RECIPES.filter((site) => site.id !== 'snow_watch')
    .flatMap((site) => site.groundMap.flatMap((row, y) => [...row].map((_, x) => groundAssetAt(site, x, y))));
  for (const relocatedTerrain of ['field.cliff', 'field.stairs_stone']) {
    assert.equal(nonWinterTerrain.includes(relocatedTerrain), true, relocatedTerrain);
  }

  const harbor = SITE_RECIPES.find((site) => site.id === 'harbor_dock');
  const harborCells = harbor.groundMap.flatMap((row, y) => [...row].map((_, x) => groundAssetAt(harbor, x, y)));
  assert.equal(harborCells.includes('field.sand'), false);
  for (const requiredTerrain of ['field.water', 'field.river_edge', 'field.dock_floor', 'field.cobblestone', 'field.bridge_wood']) {
    assert.equal(harborCells.includes(requiredTerrain), true, requiredTerrain);
  }
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 12; x += 1) {
    if (groundAssetAt(harbor, x, y) !== 'field.bridge_wood') continue;
    assert.equal(groundAssetAt(harbor, x, y - 1), 'field.water');
    assert.equal(groundAssetAt(harbor, x, y + 1), 'field.water');
  }
});

test('woodland sites have dense irregular perimeters, organic paths, and four depth bands', () => {
  const ruggedGround = new Set(['field.tree', 'field.rock', 'field.cliff']);
  const perimeter = [];
  for (let x = 0; x < SITE_CANVAS.columns; x += 1) perimeter.push([x, 0], [x, SITE_CANVAS.rows - 1]);
  for (let y = 1; y < SITE_CANVAS.rows - 1; y += 1) perimeter.push([0, y], [SITE_CANVAS.columns - 1, y]);

  for (const id of ['woodland_hut', 'overgrown_ruin']) {
    const site = SITE_RECIPES.find((entry) => entry.id === id);
    const placements = site.structures.length + site.rearDecor.length + site.props.length
      + site.npcs.length + site.frontOccluders.length + site.effects.length;
    assert.ok(placements >= 70 && placements <= 90, `${id}:${placements}`);
    assert.ok(site.structures.length >= 3 && site.structures.length <= 4, id);
    assert.ok(site.rearDecor.length >= 30 && site.props.length >= 20 && site.frontOccluders.length >= 14, id);
    assert.ok(new Set(site.structures.map((entry) => entry.baselineY)).size >= 4, `${id}: structure depth bands`);

    const decor = [...site.rearDecor, ...site.props, ...site.frontOccluders];
    for (const node of site.route) assert.equal(groundAssetAt(site, node.x, node.y), 'field.dirt_path', `${id}:${node.id}`);
    for (let y = 0; y < SITE_CANVAS.rows; y += 1) {
      const assetIds = [...site.groundMap[y]].map((_, x) => groundAssetAt(site, x, y));
      assert.doesNotMatch(assetIds.map((assetId) => assetId === 'field.dirt_path' ? 'd' : 'g').join(''), /ddd/,
        `${id}: dirt path must never widen to three cells`);
    }
    const vectors = [];
    for (let index = 1; index < site.route.length; index += 1) {
      const previous = site.route[index - 1];
      const current = site.route[index];
      assert.equal(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y), 1, `${id}: path discontinuity`);
      vectors.push(`${current.x - previous.x},${current.y - previous.y}`);
    }
    assert.ok(new Set(vectors).size >= 3, `${id}: path must turn organically`);
    const evidenceNode = site.route.find((node) => node.id === site.evidenceNodeId);
    assert.equal(evidenceNode.x, (site.building.x + site.building.width / 2) / SITE_CANVAS.cellSize, `${id}: entrance x`);
    assert.equal(evidenceNode.y, (site.building.y + site.building.height) / SITE_CANVAS.cellSize, `${id}: entrance y`);

    const composition = [...site.rearDecor, ...site.props, ...site.npcs, ...site.frontOccluders];
    let visuallyOccupiedCells = 0;
    for (let y = 0; y < SITE_CANVAS.rows; y += 1) for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
      const left = x * SITE_CANVAS.cellSize;
      const top = y * SITE_CANVAS.cellSize;
      const occupied = groundAssetAt(site, x, y) !== 'field.grass'
        || composition.some((entry) => entry.x === x && entry.y === y)
        || site.route.some((entry) => entry.x === x && entry.y === y)
        || site.structures.some((entry) => entry.x < left + SITE_CANVAS.cellSize && entry.x + entry.width > left
          && entry.y < top + SITE_CANVAS.cellSize && entry.y + entry.height > top);
      if (occupied) visuallyOccupiedCells += 1;
    }
    assert.ok(visuallyOccupiedCells / (SITE_CANVAS.columns * SITE_CANVAS.rows) >= 0.8,
      `${id}: visual occupancy ${visuallyOccupiedCells}/96`);

    const offsetEntries = decor.filter((entry) => entry.offsetX !== undefined || entry.offsetY !== undefined);
    assert.ok(offsetEntries.length >= 20, `${id}: offset density`);
    assert.ok(new Set(offsetEntries.map((entry) => `${entry.offsetX ?? 0},${entry.offsetY ?? 0}`)).size >= 8, `${id}: offset variety`);
    assert.equal(offsetEntries.every((entry) => authoredTilePlacement(entry).ok), true, `${id}: offset safety`);

    const groundTreeCells = [];
    for (let y = 0; y < SITE_CANVAS.rows; y += 1) for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
      if (groundAssetAt(site, x, y) === 'field.tree') groundTreeCells.push(`${x},${y}`);
    }
    assert.deepEqual(groundTreeCells, [], `${id}: tree crowns belong to authored decor, not repeating ground tiles`);
  }
});

test('tree and rock are transparent grass-backed feature overlays with irregular authored woodland overlap', async () => {
  const featureIds = new Set(['field.tree', 'field.rock']);
  for (const id of ['woodland_hut', 'overgrown_ruin']) {
    const site = SITE_RECIPES.find((entry) => entry.id === id);
    const featureDecor = [...site.rearDecor, ...site.props, ...site.frontOccluders]
      .filter((entry) => featureIds.has(entry.assetId));
    assert.ok(featureDecor.length >= 60, `${id}: transparent feature overlap density`);
    assert.equal(featureDecor.every((entry) => authoredTilePlacement(entry).ok), true, id);
    assert.ok(new Set(featureDecor.map((entry) => `${entry.offsetX},${entry.offsetY}`)).size >= 8, id);
    assert.ok(featureDecor.some((entry) => entry.flipX === true), `${id}: explicit mirrored overlays`);
    assert.ok(featureDecor.some((entry) => entry.flipX !== true), `${id}: original-facing overlays`);
    const treeCenters = featureDecor.filter((entry) => entry.assetId === 'field.tree').map((entry) => {
      const placement = authoredTilePlacement(entry);
      return { x: placement.x + 32, y: placement.y + 32 };
    });
    assert.ok(treeCenters.length >= 45 && treeCenters.length <= 60, `${id}: 45-60 authored crowns frame the woodland`);
    const overlappingCrowns = treeCenters.filter((point, index) => treeCenters.some((candidate, candidateIndex) => {
      if (candidateIndex === index) return false;
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      return distance >= 40 && distance <= 56;
    }));
    assert.ok(overlappingCrowns.length >= 45, `${id}: at least 45 crowns overlap neighbors by 8-24px`);

    const groundTrees = [];
    for (let y = 0; y < SITE_CANVAS.rows; y += 1) for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
      if (groundAssetAt(site, x, y) === 'field.tree') groundTrees.push([x, y]);
    }
    assert.deepEqual(groundTrees, [], `${id}: authored crowns must not be a repeating ground wall`);
    const clustered = new Set();
    const clusterSizes = [];
    for (let start = 0; start < treeCenters.length; start += 1) {
      if (clustered.has(start)) continue;
      const queue = [start];
      const component = [];
      clustered.add(start);
      while (queue.length > 0) {
        const index = queue.shift();
        component.push(index);
        for (let candidate = 0; candidate < treeCenters.length; candidate += 1) {
          if (clustered.has(candidate)) continue;
          if (Math.hypot(treeCenters[index].x - treeCenters[candidate].x,
            treeCenters[index].y - treeCenters[candidate].y) <= 72) {
            clustered.add(candidate);
            queue.push(candidate);
          }
        }
      }
      clusterSizes.push(component.length);
    }
    assert.deepEqual(clusterSizes.sort((left, right) => left - right), [8, 8, 8, 8, 8, 8, 8],
      `${id}: crowns form seven compact masses rather than a continuous orchard wall`);
    const compositionEntries = [...site.rearDecor, ...site.props, ...site.npcs, ...site.frontOccluders];
    for (let y = 0; y < SITE_CANVAS.rows - 1; y += 1) for (let x = 0; x < SITE_CANVAS.columns - 1; x += 1) {
      const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
      if (!cells.every(([cellX, cellY]) => groundAssetAt(site, cellX, cellY) === 'field.grass')) continue;
      const anchored = compositionEntries.some((entry) => entry.x >= x && entry.x <= x + 1
        && entry.y >= y && entry.y <= y + 1);
      const routed = site.route.some((entry) => entry.x >= x && entry.x <= x + 1
        && entry.y >= y && entry.y <= y + 1);
      const left = x * SITE_CANVAS.cellSize;
      const top = y * SITE_CANVAS.cellSize;
      const structured = site.structures.some((entry) => entry.x < left + 128 && entry.x + entry.width > left
        && entry.y < top + 128 && entry.y + entry.height > top);
      assert.equal(anchored || routed || structured, true, `${id}: unintended 2x2 grass void ${x},${y}`);
    }
    const routeCells = new Set(site.route.map((entry) => `${entry.x},${entry.y}`));
    assert.equal(featureDecor.some((entry) => routeCells.has(`${entry.x},${entry.y}`)), false,
      `${id}: central path and entrance cells remain unobstructed`);
    const groundFeatureTransforms = [];
    for (let y = 0; y < SITE_CANVAS.rows; y += 1) for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
      if (!featureIds.has(groundAssetAt(site, x, y))) continue;
      groundFeatureTransforms.push(groundTransformAt(site, x, y));
    }
    assert.equal(groundFeatureTransforms.every((transform) => transform.quarterTurns === 0), true,
      `${id}: trees and rocks are never rotated`);
    assert.equal(groundFeatureTransforms.some((transform) => transform.flipX), true, `${id}: mirrored ground features`);
    assert.equal(groundFeatureTransforms.some((transform) => !transform.flipX), true, `${id}: original-facing ground features`);
  }

  const app = await readFile(`${root}/public/app.js`, 'utf8');
  const featureSet = app.indexOf("const featureOverlays = new Set(['field.tree', 'field.rock'])");
  const grassBase = app.indexOf("context.drawImage(images.get('field.grass'), x * 64, y * 64, 64, 64);", featureSet);
  const featureDraw = app.indexOf('context.drawImage(images.get(assetId), -32, -32, 64, 64);', grassBase);
  assert.ok(featureSet >= 0 && featureSet < grassBase && grassBase < featureDraw);
});

test('authored decor offsets are optional, 8px-quantized, bounded, and canvas-safe', () => {
  assert.deepEqual(authoredTilePlacement({ assetId: 'object.crate', x: 3, y: 4 }), {
    ok: true, validGridAndOffset: true, insideCanvas: true,
    offsetX: 0, offsetY: 0, flipX: false, x: 192, y: 256, depth: 320
  });
  assert.deepEqual(authoredTilePlacement({ assetId: 'object.crate', x: 3, y: 4, offsetX: 24, offsetY: -16 }), {
    ok: true, validGridAndOffset: true, insideCanvas: true,
    offsetX: 24, offsetY: -16, flipX: false, x: 216, y: 240, depth: 304
  });
  assert.equal(authoredTilePlacement({ assetId: 'field.tree', x: 3, y: 4, flipX: true }).flipX, true);
  assert.equal(authoredTilePlacement({ assetId: 'field.tree', x: 3, y: 4, flipX: 'yes' }).validGridAndOffset, false);
  assert.equal(authoredTilePlacement({ x: 3, y: 4, offsetX: 7, offsetY: 0 }).validGridAndOffset, false);
  assert.equal(authoredTilePlacement({ x: 3, y: 4, offsetX: 32, offsetY: 0 }).validGridAndOffset, false);
  assert.equal(authoredTilePlacement({ x: 0, y: 4, offsetX: -8, offsetY: 0 }).insideCanvas, false);
  assert.equal(authoredTilePlacement({ x: 11, y: 7, offsetX: 8, offsetY: 8 }).insideCanvas, false);
});

test('static render-path usage audit reaches exactly all 78 required assets without a gallery', async () => {
  const audit = auditRuntimeAssetUsage();
  assert.equal(audit.ok, true);
  assert.equal(audit.used.length, 78);
  assert.deepEqual(audit.used, REQUIRED_ASSET_IDS);
  assert.deepEqual(audit.missing, []);
  assert.deepEqual(audit.unexpected, []);
  const runtime = await readFile(`${root}/public/site-runtime.mjs`, 'utf8');
  assert.doesNotMatch(runtime, /asset[-_ ]gallery|galleryAssets|drawGallery/i);
});

test('site camera never enlarges and player/effect frame contracts are exact', () => {
  assert.deepEqual(SITE_CANVAS, { width: 768, height: 512, columns: 12, rows: 8, cellSize: 64 });
  assert.equal(computeSiteCamera(2000, 1200).scale, 1);
  assert.equal(computeSiteCamera(384, 256).scale, 0.5);
  assert.deepEqual(characterFrameRect('down', 'idle'), { x: 0, y: 0, width: 24, height: 40, column: 0, row: 0 });
  assert.deepEqual(characterFrameRect('up', 'walk1'), { x: 24, y: 40, width: 24, height: 40, column: 1, row: 1 });
  assert.deepEqual(characterFrameRect('left', 'walk2'), { x: 48, y: 80, width: 24, height: 40, column: 2, row: 2 });
  assert.deepEqual(effectFrameRect(5), { x: 32, y: 0, width: 32, height: 32, frame: 1 });
});

test('site keyboard steps stay on route and context effects are placed honestly', () => {
  for (const site of SITE_RECIPES) {
    for (const node of site.route) {
      for (const direction of ['up', 'down', 'left', 'right']) {
        const next = nextSiteNodeForDirection(site, node.id, direction);
        assert.ok(site.route.some((candidate) => candidate.id === next.id));
        assert.ok(next.id === node.id || Math.abs(next.x - node.x) + Math.abs(next.y - node.y) === 1);
      }
    }
    for (const entry of site.effects.filter((item) => item.assetId === 'effect.water_ripple')) {
      assert.equal(entry.context, 'water');
      assert.equal(groundAssetAt(site, entry.x, entry.y), 'field.water');
    }
    for (const entry of site.effects.filter((item) => item.assetId === 'effect.construction_dust')) {
      assert.ok(['repair', 'ruin'].includes(entry.context));
    }
  }
});

test('site renderer follows the declared depth order and y-sorts player with actors and props', async () => {
  assert.deepEqual(SITE_RENDER_LAYERS, [
    'ground', 'terrain-underlay', 'rear-decor', 'building', 'y-sorted', 'front-occluders-effects'
  ]);
  const app = await readFile(`${root}/public/app.js`, 'utf8');
  const ground = app.indexOf("SITE_RENDER_LAYERS[0] === 'ground'");
  const terrain = app.indexOf("SITE_RENDER_LAYERS[1] === 'terrain-underlay'");
  const rear = app.indexOf('recipe.rearDecor');
  const sorted = app.indexOf('const depthItems');
  const structures = app.indexOf('recipe.structures.map');
  const front = app.indexOf('recipe.frontOccluders');
  const effects = app.indexOf('recipe.effects');
  assert.ok(ground < terrain && terrain < rear && rear < sorted && sorted < structures && structures < front && front < effects);
  assert.match(app, /depth: state\.sitePosition\.y \* 64 \+ 52/);
  assert.match(app, /left\.depth - right\.depth/);
  assert.match(app, /context\.rotate\(transform\.quarterTurns \* Math\.PI \/ 2\)/);
  assert.match(app, /context\.scale\(-1, 1\)/);
  assert.match(app, /const placement = authoredTilePlacement\(entry\)/);
  assert.match(app, /depth: authoredTilePlacement\(entry\)\.depth/);
  assert.match(app, /context\.drawImage\(images\.get\(item\.entry\.assetId\), item\.entry\.x, item\.entry\.y, item\.entry\.width, item\.entry\.height\)/);
  assert.doesNotMatch(app, /recipe\.terrain|baseFieldAssetId/);
});

test('site renderer clips every site sprite to the authored 768x512 canvas before returning to identity', async () => {
  const app = await readFile(`${root}/public/app.js`, 'utf8');
  const drawSiteStart = app.indexOf('function drawSite(timestamp)');
  const drawSiteEnd = app.indexOf('\nfunction draw(timestamp = 0)', drawSiteStart);
  const drawSite = app.slice(drawSiteStart, drawSiteEnd);
  const siteTransform = drawSite.indexOf('context.setTransform(camera.scale, 0, 0, camera.scale, camera.destX, camera.destY);');
  const clipSave = drawSite.indexOf('context.save();', siteTransform);
  const clipRect = drawSite.indexOf('context.rect(0, 0, SITE_CANVAS.width, SITE_CANVAS.height);', clipSave);
  const clip = drawSite.indexOf('context.clip();', clipRect);
  const ground = drawSite.indexOf("SITE_RENDER_LAYERS[0] === 'ground'", clip);
  const structures = drawSite.indexOf('recipe.structures.map', ground);
  const player = drawSite.indexOf("{ type: 'player'", structures);
  const front = drawSite.indexOf('recipe.frontOccluders', player);
  const effects = drawSite.indexOf('recipe.effects', front);
  const clipRestore = drawSite.indexOf('context.restore();', effects);
  const identity = drawSite.indexOf('context.setTransform(1, 0, 0, 1, 0, 0);', clipRestore);

  assert.ok(drawSiteStart >= 0 && drawSiteEnd > drawSiteStart);
  assert.ok(siteTransform >= 0 && siteTransform < clipSave);
  assert.ok(clipSave < clipRect && clipRect < clip);
  assert.ok(clip < ground && ground < structures && structures < player && player < front && front < effects);
  assert.ok(effects < clipRestore && clipRestore < identity);
});

test('browser integration wires every control and keeps evidence sourced from /api/town', async () => {
  const app = await readFile(`${root}/public/app.js`, 'utf8');
  const html = await readFile(`${root}/public/index.html`, 'utf8');
  const ids = [...app.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]);
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), id);
  assert.match(app, /fetch\('\/api\/town'/);
  assert.match(app, /facility\.evidence\?\.observed/);
  assert.match(app, /facility\.evidence\?\.inferred/);
  assert.match(app, /facility\.evidence\?\.unknown/);
  assert.match(app, /\['Enter', ' '\]/);
  assert.match(app, /event\.key !== 'Escape'/);
  assert.match(app, /ArrowUp/);
  assert.match(app, /handleCanvasClick/);
  assert.doesNotMatch(`${app}\n${html}`, /asset[-_ ]gallery|旧素材|legacy/i);
});
