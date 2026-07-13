import assert from 'node:assert/strict';
import test from 'node:test';
import {
  animatedEffectSourceRect, assetForBinding, buildAssetInspectionInventory,
  buildingOccupiesTile, buildingStateVisuals, canPlayerEnter, findPlayerSpawn,
  cardinalTerrainNeighbors, characterDestinationRect, indexGameAssets, loadGameAssets, movePlayer,
  selectBuildingAsset, selectLoadedAnimatedEffect, selectLoadedStaticEffect, selectNpcAsset,
  selectPropAsset, selectTerrainAsset,
  spriteDirectionForFacing, spriteSourceRect, staticEffectSourceRect, validateGameAssetManifest
} from '../public/game-runtime.mjs';

const manifest = {
  schemaVersion: 2,
  generatedAt: '2026-07-13T00:00:00.000Z',
  complete: false,
  missingBindings: [{ vocabulary: 'TILE_TYPES', runtimeId: 'water' }],
  missingAssets: ['effect.construction_dust', 'effect.water_ripple'],
  assets: [{
    assetId: 'field.grass', category: 'field', sha256: 'a'.repeat(64),
    publicPath: '/assets/forge/v1/aaaaaaaaaaaaaaaa/field_grass.png',
    gameBinding: {
      rendererCategory: 'tile', semanticKind: 'grass', drawLayer: 'ground', coverage: 'exact',
      runtimeBindings: [{ vocabulary: 'TILE_TYPES', id: 'grass' }]
    },
    renderSpec: {
      kind: 'tileset', logicalSize: null, tileSize: 16, nearestNeighbor: true, allowAntiAlias: false,
      sprites: null, states: [], variantTags: ['field', 'grass']
    }
  }, {
    assetId: 'character.player', category: 'character', sha256: 'c'.repeat(64),
    publicPath: '/assets/forge/v1/cccccccccccccccc/character_player.png',
    gameBinding: {
      rendererCategory: 'npc', semanticKind: 'player', drawLayer: 'character', coverage: 'future',
      runtimeBindings: []
    },
    renderSpec: {
      kind: 'spritesheet', logicalSize: { width: 20, height: 32 }, tileSize: null,
      nearestNeighbor: true, allowAntiAlias: false, states: [], variantTags: ['character', 'player'],
      sprites: {
        directions: ['front', 'back', 'left', 'right'], frames: ['idle', 'walk_1', 'walk_2'],
        grid: { columns: 4, rows: 3, frameWidth: 20, frameHeight: 32 },
        directionAxis: 'column', frameAxis: 'row'
      }
    }
  }]
};

const layout = {
  map: {
    widthTiles: 4, heightTiles: 3,
    terrain: [
      ['water', 'grass', 'grass', 'cliff'],
      ['road', 'road', 'grass', 'grass'],
      ['water', 'bridge', 'stairs', 'grass']
    ]
  },
  buildings: [{ x: 2, y: 0, footprint: { widthTiles: 1, heightTiles: 2 } }]
};

function variantAsset(assetId, semanticKind, vocabulary, id) {
  const category = assetId.split('.')[0];
  const rendererCategory = { field: 'tile', building: 'building_exterior', character: 'npc', object: 'prop' }[category];
  const drawLayer = { field: 'ground', building: 'building', character: 'character', object: 'object' }[category];
  const sha256 = 'd'.repeat(64);
  return {
    assetId,
    category,
    sha256,
    publicPath: `/assets/forge/v1/${sha256.slice(0, 16)}/${assetId.replaceAll('.', '_')}.png`,
    gameBinding: {
      rendererCategory, semanticKind, drawLayer, coverage: 'mapped',
      runtimeBindings: [{ vocabulary, id }]
    },
    renderSpec: {
      kind: 'single', logicalSize: null, tileSize: null,
      nearestNeighbor: true, allowAntiAlias: false, sprites: null,
      states: [], variantTags: [semanticKind]
    }
  };
}

const contextualAssets = [
  variantAsset('field.cobblestone', 'cobblestone', 'TILE_TYPES', 'road'),
  variantAsset('field.road_corner', 'road_corner', 'TILE_TYPES', 'road'),
  variantAsset('field.road_edge', 'road_edge', 'TILE_TYPES', 'road'),
  variantAsset('field.road_intersection', 'road_intersection', 'TILE_TYPES', 'road'),
  variantAsset('field.water', 'water', 'TILE_TYPES', 'water'),
  variantAsset('field.river_edge', 'river_edge', 'TILE_TYPES', 'water'),
  variantAsset('field.bridge_stone', 'bridge_stone', 'TILE_TYPES', 'bridge'),
  variantAsset('field.bridge_wood', 'bridge_wood', 'TILE_TYPES', 'bridge'),
  variantAsset('building.house.small', 'house_small', 'FACILITY_KINDS', 'house'),
  variantAsset('building.house.medium', 'house_medium', 'FACILITY_KINDS', 'house'),
  variantAsset('building.hut', 'hut', 'FACILITY_KINDS', 'house'),
  variantAsset('building.old_house', 'old_house', 'FACILITY_KINDS', 'house'),
  variantAsset('character.mob.artisan', 'artisan', 'NPC_ROLES', 'resident'),
  variantAsset('character.mob.townsfolk_male', 'townsfolk_male', 'NPC_ROLES', 'townsfolk'),
  variantAsset('character.mob.townsfolk_female', 'townsfolk_female', 'NPC_ROLES', 'townsfolk'),
  variantAsset('character.mob.elder', 'elder', 'NPC_ROLES', 'townsfolk'),
  variantAsset('character.mob.traveler', 'traveler', 'NPC_ROLES', 'traveler'),
  variantAsset('character.mob.delivery_person', 'delivery_person', 'NPC_ROLES', 'traveler'),
  variantAsset('object.crate', 'crate', 'PROP_KINDS', 'crate'),
  variantAsset('object.stacked_crates', 'stacked_crates', 'PROP_KINDS', 'crate'),
  variantAsset('object.harbor_cargo', 'harbor_cargo', 'PROP_KINDS', 'crate'),
  variantAsset('object.lamp', 'lamp', 'PROP_KINDS', 'lamp'),
  variantAsset('object.streetlight', 'streetlight', 'PROP_KINDS', 'lamp'),
  variantAsset('object.signboard', 'signboard', 'PROP_KINDS', 'signboard'),
  variantAsset('object.notice_board', 'notice_board', 'PROP_KINDS', 'signboard'),
  variantAsset('object.guild_roster_stand', 'guild_roster_stand', 'PROP_KINDS', 'signboard'),
  variantAsset('object.menu_board', 'menu_board', 'PROP_KINDS', 'signboard'),
  variantAsset('object.flowerbed', 'flowerbed', 'PROP_KINDS', 'plant'),
  variantAsset('object.grass_patch', 'grass_patch', 'PROP_KINDS', 'plant'),
  variantAsset('object.warning_stake', 'warning_stake', 'PROP_KINDS', 'flag'),
  variantAsset('object.red_flag', 'red_flag', 'PROP_KINDS', 'flag'),
  variantAsset('object.yellow_flag', 'yellow_flag', 'PROP_KINDS', 'flag'),
  variantAsset('object.blue_flag', 'blue_flag', 'PROP_KINDS', 'flag')
];
const contextualIndex = indexGameAssets({
  schemaVersion: 2,
  generatedAt: '2026-07-13T00:00:00.000Z',
  complete: true,
  missingBindings: [],
  missingAssets: [],
  assets: contextualAssets
});
const allContextualAssets = new Set(contextualAssets.map(({ assetId }) => assetId));
const semanticOf = (selection) => selection?.asset?.gameBinding.semanticKind ?? selection?.gameBinding.semanticKind ?? null;

const effectRenderSpec = {
  kind: 'spritesheet', logicalSize: { width: 16, height: 16 }, tileSize: null,
  nearestNeighbor: true, allowAntiAlias: false, states: [], variantTags: ['effect'],
  sprites: {
    directions: [], frames: ['frame_1', 'frame_2', 'frame_3', 'frame_4'],
    grid: { columns: 4, rows: 1, frameWidth: 16, frameHeight: 16 },
    directionAxis: null, frameAxis: 'column'
  }
};

function effectAsset(assetId, semanticKind, shaCharacter) {
  const sha256 = shaCharacter.repeat(64);
  return {
    assetId, category: 'effect', sha256,
    publicPath: `/assets/forge/v1/${sha256.slice(0, 16)}/${assetId.replaceAll('.', '_')}.png`,
    gameBinding: {
      rendererCategory: 'effect', semanticKind, drawLayer: 'effect', coverage: 'future', runtimeBindings: []
    },
    renderSpec: structuredClone(effectRenderSpec)
  };
}

const effectAssets = [
  effectAsset('effect.water_ripple', 'water_ripple', 'e'),
  effectAsset('effect.construction_dust', 'construction_dust', 'f')
];
const effectIndex = indexGameAssets({
  schemaVersion: 2,
  generatedAt: '2026-07-13T00:00:00.000Z',
  complete: true,
  missingBindings: [],
  missingAssets: [],
  assets: effectAssets
});

test('v2 asset manifest validates and indexes runtime bindings and render metadata', () => {
  assert.equal(validateGameAssetManifest(manifest), manifest);
  const index = indexGameAssets(manifest);
  assert.equal(assetForBinding(index, 'TILE_TYPES', 'grass').assetId, 'field.grass');
  assert.equal(assetForBinding(index, 'TILE_TYPES', 'water'), null);
  assert.deepEqual(index.byRenderKind.get('spritesheet').map(({ assetId }) => assetId), ['character.player']);
  assert.deepEqual(index.variantsByTag.get('grass').map(({ assetId }) => assetId), ['field.grass']);
  assert.equal(index.bySemantic.get('player').renderSpec.sprites.grid.columns, 4);
  assert.throws(() => validateGameAssetManifest({ ...manifest, assets: [{ ...manifest.assets[0], publicPath: '/../secret.png' }] }), /Invalid/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, generatedAt: 'sometime' }), /Unsupported/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, extra: true }), /Unsupported/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, complete: true }), /completeness/);
  const { missingAssets: _missingAssets, ...v2WithoutMissingAssets } = manifest;
  assert.throws(() => validateGameAssetManifest(v2WithoutMissingAssets), /Unsupported/);
  assert.throws(() => validateGameAssetManifest({
    ...manifest, missingAssets: ['effect.water_ripple', 'effect.construction_dust']
  }), /missing asset/);
  assert.throws(() => validateGameAssetManifest({
    ...manifest, missingAssets: ['effect.water_ripple', 'effect.water_ripple']
  }), /missing asset/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, missingAssets: ['invalid-id'] }), /missing asset/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, missingAssets: ['character.player'] }), /missing asset/);
  const completeV2 = { ...manifest, complete: true, missingBindings: [], missingAssets: [] };
  assert.equal(validateGameAssetManifest(completeV2), completeV2);
  const assetsIncompleteV2 = {
    ...manifest, complete: false, missingBindings: [], missingAssets: ['effect.water_ripple']
  };
  assert.equal(validateGameAssetManifest(assetsIncompleteV2), assetsIncompleteV2);
  assert.throws(() => validateGameAssetManifest({
    ...manifest,
    assets: [{ ...manifest.assets[0], publicPath: '/assets/forge/v1/bbbbbbbbbbbbbbbb/field_grass.png' }]
  }), /content-addressed/);
  assert.throws(() => validateGameAssetManifest({ ...manifest, missingBindings: [{ vocabulary: 'UNKNOWN', runtimeId: 'water' }] }), /Invalid/);
  const variant = {
    ...structuredClone(manifest.assets[0]), assetId: 'field.other', sha256: 'b'.repeat(64),
    publicPath: '/assets/forge/v1/bbbbbbbbbbbbbbbb/field_other.png'
  };
  const variants = { ...manifest, assets: [variant, manifest.assets[0]] };
  assert.equal(validateGameAssetManifest(variants), variants);
  const variantIndex = indexGameAssets(variants);
  assert.equal(assetForBinding(variantIndex, 'TILE_TYPES', 'grass').assetId, 'field.grass');
  assert.deepEqual(variantIndex.variantsByBinding.get('TILE_TYPES\0grass').map(({ assetId }) => assetId), ['field.grass', 'field.other']);
  assert.throws(() => validateGameAssetManifest({
    ...manifest,
    assets: manifest.assets.map((asset) => asset.assetId === 'character.player'
      ? { ...asset, renderSpec: { ...asset.renderSpec, sprites: { ...asset.renderSpec.sprites, frameAxis: 'column' } } }
      : asset)
  }), /spritesheet axes/);
  const { missingAssets: _legacyMissingAssets, ...legacyManifest } = manifest;
  const legacy = {
    ...legacyManifest,
    schemaVersion: 1,
    assets: manifest.assets.map(({ renderSpec: _renderSpec, ...asset }) => asset)
  };
  assert.equal(validateGameAssetManifest(legacy), legacy);
  assert.equal(indexGameAssets(legacy).byRenderKind.size, 0);
  assert.throws(() => validateGameAssetManifest({ ...legacy, missingAssets: [] }), /Unsupported/);
});

test('player spawn, walkability, bounds, facing, and building collision are deterministic', () => {
  assert.equal(buildingOccupiesTile(layout.buildings, 2, 1), true);
  assert.equal(canPlayerEnter(layout, 0, 0), false);
  assert.equal(canPlayerEnter(layout, 2, 1), false);
  assert.deepEqual(findPlayerSpawn(layout), { x: 0, y: 1, facing: 'down' });
  const start = { x: 0, y: 1, facing: 'down' };
  assert.deepEqual(movePlayer(layout, start, 'right'), { x: 1, y: 1, facing: 'right' });
  assert.deepEqual(movePlayer(layout, start, 'up'), { x: 0, y: 1, facing: 'up' });
  assert.deepEqual(movePlayer(layout, start, 'left'), { x: 0, y: 1, facing: 'left' });
});

test('sprite source rectangles map runtime facing and frame names onto one grid cell', () => {
  const spec = manifest.assets.find(({ assetId }) => assetId === 'character.player').renderSpec;
  assert.equal(spriteDirectionForFacing('down'), 'front');
  assert.equal(spriteDirectionForFacing('up'), 'back');
  assert.deepEqual(spriteSourceRect(spec, { facing: 'down', frameName: 'idle' }), {
    sx: 0, sy: 0, sw: 20, sh: 32
  });
  assert.deepEqual(spriteSourceRect(spec, { facing: 'up', frameName: 'walk_1' }), {
    sx: 20, sy: 32, sw: 20, sh: 32
  });
  assert.deepEqual(spriteSourceRect(spec, { facing: 'left', frameName: 'walk_2' }), {
    sx: 40, sy: 64, sw: 20, sh: 32
  });
  assert.deepEqual(spriteSourceRect(spec, { direction: 'right', frameName: 'missing' }), {
    sx: 60, sy: 0, sw: 20, sh: 32
  });
  assert.equal(spriteSourceRect(manifest.assets[0].renderSpec), null);
  assert.equal(spriteSourceRect(null), null);
});

test('static effects accept only a loaded v2 spritesheet frame_1 source rectangle', () => {
  assert.deepEqual(staticEffectSourceRect(effectRenderSpec), { sx: 0, sy: 0, sw: 16, sh: 16 });
  const loaded = new Map(effectAssets.map(({ assetId }) => [assetId, {}]));
  const ripple = selectLoadedStaticEffect(effectIndex, 'water_ripple', loaded);
  assert.equal(ripple.asset.assetId, 'effect.water_ripple');
  assert.deepEqual(ripple.source, { sx: 0, sy: 0, sw: 16, sh: 16 });
  assert.equal(selectLoadedStaticEffect(effectIndex, 'construction_dust', loaded).asset.assetId,
    'effect.construction_dust');
  assert.equal(selectLoadedStaticEffect(effectIndex, 'water_ripple', new Map()), null);
  assert.equal(selectLoadedStaticEffect(effectIndex, 'water_ripple'), null);
  assert.equal(selectLoadedStaticEffect(effectIndex, 'missing_effect', loaded), null);

  const legacyAssets = effectAssets.map(({ renderSpec: _renderSpec, ...asset }) => asset);
  const legacyIndex = indexGameAssets({
    schemaVersion: 1,
    generatedAt: '2026-07-13T00:00:00.000Z',
    complete: true,
    missingBindings: [],
    assets: legacyAssets
  });
  assert.equal(selectLoadedStaticEffect(legacyIndex, 'water_ripple', loaded), null);
  assert.equal(staticEffectSourceRect({ ...effectRenderSpec, kind: 'single', sprites: null }), null);
  assert.equal(staticEffectSourceRect({
    ...effectRenderSpec,
    sprites: { ...effectRenderSpec.sprites, frames: ['missing_1', 'frame_2', 'frame_3', 'frame_4'] }
  }), null);
  assert.equal(staticEffectSourceRect({
    ...effectRenderSpec,
    sprites: { ...effectRenderSpec.sprites, frameAxis: 'row' }
  }), null);
  const malformedAsset = {
    ...effectAssets[0],
    renderSpec: { ...effectRenderSpec, sprites: { ...effectRenderSpec.sprites, frameAxis: 'row' } }
  };
  assert.equal(selectLoadedStaticEffect({
    bySemantic: new Map([['water_ripple', malformedAsset]])
  }, 'water_ripple', loaded), null);
});

test('animated effects advance declared frames, wrap safely, and keep stable instance phases', () => {
  assert.deepEqual(animatedEffectSourceRect(effectRenderSpec, { elapsedMs: 0 }), {
    sx: 0, sy: 0, sw: 16, sh: 16
  });
  assert.deepEqual(animatedEffectSourceRect(effectRenderSpec, { elapsedMs: 179 }), {
    sx: 0, sy: 0, sw: 16, sh: 16
  });
  assert.deepEqual(animatedEffectSourceRect(effectRenderSpec, { elapsedMs: 180 }), {
    sx: 16, sy: 0, sw: 16, sh: 16
  });
  assert.deepEqual(animatedEffectSourceRect(effectRenderSpec, { elapsedMs: 720 }), {
    sx: 0, sy: 0, sw: 16, sh: 16
  });
  assert.deepEqual(animatedEffectSourceRect(effectRenderSpec, { phaseIndex: -1 }), {
    sx: 48, sy: 0, sw: 16, sh: 16
  });
  assert.deepEqual(
    animatedEffectSourceRect(effectRenderSpec, { elapsedMs: 360, phaseKey: 'water:3,7' }),
    animatedEffectSourceRect(effectRenderSpec, { elapsedMs: 360, phaseKey: 'water:3,7' })
  );
  assert.deepEqual(animatedEffectSourceRect(effectRenderSpec, {
    elapsedMs: 540, phaseIndex: 3, paused: true
  }), { sx: 0, sy: 0, sw: 16, sh: 16 });
  const reorderedEffectSpec = structuredClone(effectRenderSpec);
  reorderedEffectSpec.sprites.frames = ['frame_2', 'frame_1', 'frame_3', 'frame_4'];
  assert.deepEqual(animatedEffectSourceRect(reorderedEffectSpec, {
    elapsedMs: 540, phaseKey: 'water:3,7', paused: true
  }), { sx: 16, sy: 0, sw: 16, sh: 16 });
  assert.deepEqual(animatedEffectSourceRect(effectRenderSpec, {
    elapsedMs: Number.NaN, frameDurationMs: 0, phaseIndex: Number.NaN
  }), { sx: 0, sy: 0, sw: 16, sh: 16 });
  assert.equal(animatedEffectSourceRect(null), null);

  const loaded = new Map(effectAssets.map(({ assetId }) => [assetId, {}]));
  const ripple = selectLoadedAnimatedEffect(effectIndex, 'water_ripple', loaded, { elapsedMs: 180 });
  assert.equal(ripple.asset.assetId, 'effect.water_ripple');
  assert.deepEqual(ripple.source, { sx: 16, sy: 0, sw: 16, sh: 16 });
  assert.equal(selectLoadedAnimatedEffect(effectIndex, 'water_ripple', new Map(), { elapsedMs: 180 }), null);
});

test('asset inspection inventory covers every v2 asset in deterministic category and id order', () => {
  const inspectionManifest = {
    schemaVersion: 2,
    generatedAt: '2026-07-13T00:00:00.000Z',
    complete: true,
    missingBindings: [],
    missingAssets: [],
    assets: [...effectAssets, ...contextualAssets].reverse()
  };
  const available = new Map(inspectionManifest.assets
    .filter((_, index) => index % 2 === 0)
    .map(({ assetId }) => [assetId, {}]));
  const inventory = buildAssetInspectionInventory(inspectionManifest, available);
  assert.deepEqual(inventory.groups.map(({ category }) => category), [
    'field', 'building', 'character', 'object', 'effect'
  ]);
  assert.equal(inventory.totalCount, inspectionManifest.assets.length);
  assert.equal(inventory.loadedCount, available.size);
  assert.equal(inventory.failedCount, inventory.totalCount - available.size);
  assert.equal(inventory.manifestComplete, true);
  assert.deepEqual(
    inventory.groups.flatMap(({ assets }) => assets).map(({ assetId }) => assetId).sort(),
    inspectionManifest.assets.map(({ assetId }) => assetId).sort()
  );
  for (const { assets } of inventory.groups) {
    const ids = assets.map(({ assetId }) => assetId);
    assert.deepEqual(ids, [...ids].sort());
  }
  const effectEntry = inventory.groups
    .find(({ category }) => category === 'effect').assets
    .find(({ assetId }) => assetId === 'effect.water_ripple');
  assert.deepEqual(effectEntry.spriteGrid, {
    columns: 4,
    rows: 1,
    directions: [],
    frames: ['frame_1', 'frame_2', 'frame_3', 'frame_4']
  });
  assert.throws(() => buildAssetInspectionInventory({ schemaVersion: 1 }), /requires a v2 manifest/);
});

test('building state visuals retain distinct approved-image cues without treating vacancy as damage', () => {
  assert.deepEqual(buildingStateVisuals('vacant'), { opacity: 0.55, hatch: false, busy: false });
  assert.deepEqual(buildingStateVisuals('busy'), { opacity: 1, hatch: false, busy: true });
  assert.deepEqual(buildingStateVisuals('under_construction'), { opacity: 1, hatch: true, busy: false });
  assert.deepEqual(buildingStateVisuals('ruined'), { opacity: 1, hatch: true, busy: false });
  assert.deepEqual(buildingStateVisuals('occupied'), { opacity: 1, hatch: false, busy: false });
});

test('contextual terrain selection uses cardinal topology and only loaded candidates', () => {
  assert.deepEqual(cardinalTerrainNeighbors([
    ['grass', 'road', 'grass'],
    ['road', 'road', 'road'],
    ['grass', 'water', 'grass']
  ], 1, 1), { up: 'road', right: 'road', down: 'water', left: 'road' });

  const selectRoad = (neighbors, availableAssetIds = allContextualAssets) => selectTerrainAsset(contextualIndex, {
    tileType: 'road', neighbors, x: 4, y: 7, availableAssetIds
  });
  assert.equal(semanticOf(selectRoad({ up: 'road', right: 'road', down: 'road', left: 'grass' })), 'road_intersection');
  assert.equal(semanticOf(selectRoad({ up: 'road', right: 'road', down: 'grass', left: 'grass' })), 'road_corner');
  assert.equal(selectRoad({ up: 'road', right: 'road', down: 'grass', left: 'grass' }).quarterTurns, 0);
  assert.equal(semanticOf(selectRoad({ up: 'grass', right: 'grass', down: 'grass', left: 'road' })), 'road_edge');
  assert.equal(selectRoad({ up: 'grass', right: 'grass', down: 'grass', left: 'road' }).quarterTurns, 3);
  assert.equal(selectRoad({ up: 'road', right: 'grass', down: 'grass', left: 'grass' }).quarterTurns, 0);
  assert.equal(semanticOf(selectRoad({ up: 'road', right: 'grass', down: 'road', left: 'grass' })), 'cobblestone');
  assert.equal(selectRoad({ up: 'road' }, new Set()), null);

  assert.equal(semanticOf(selectTerrainAsset(contextualIndex, {
    tileType: 'water', neighbors: { up: 'water', right: 'water', down: 'water', left: 'water' },
    availableAssetIds: allContextualAssets
  })), 'water');
  const riverEdge = selectTerrainAsset(contextualIndex, {
    tileType: 'water', neighbors: { up: 'grass', right: 'water', down: 'water', left: 'water' },
    availableAssetIds: allContextualAssets
  });
  assert.equal(semanticOf(riverEdge), 'river_edge');
  assert.equal(riverEdge.quarterTurns, 0);

  const bridge = selectTerrainAsset(contextualIndex, {
    tileType: 'bridge', neighbors: { left: 'water', right: 'water' }, x: 8, y: 3,
    bridgeStyle: 'wood', availableAssetIds: allContextualAssets
  });
  assert.equal(semanticOf(bridge), 'bridge_wood');
  assert.equal(bridge.orientation, 'vertical');
  assert.equal(bridge.quarterTurns, 1);
  const canonicalBridge = selectTerrainAsset(contextualIndex, {
    tileType: 'bridge', neighbors: { up: 'water', down: 'water' }, x: 2, y: 5,
    availableAssetIds: allContextualAssets
  });
  assert.equal(canonicalBridge.quarterTurns, 0);
  assert.deepEqual(canonicalBridge, selectTerrainAsset(contextualIndex, {
    tileType: 'bridge', neighbors: { up: 'water', down: 'water' }, x: 2, y: 5,
    availableAssetIds: allContextualAssets
  }));
});

test('building, NPC, and prop variants follow explicit state/size and stable-context rules', () => {
  const house = (state, widthTiles, heightTiles) => selectBuildingAsset(contextualIndex, {
    building: { id: 'house-1', facilityKind: 'house', state, footprint: { widthTiles, heightTiles } },
    availableAssetIds: allContextualAssets
  });
  assert.equal(house('occupied', 2, 2).gameBinding.semanticKind, 'house_small');
  assert.equal(house('occupied', 3, 3).gameBinding.semanticKind, 'house_medium');
  assert.equal(house('busy', 2, 2).gameBinding.semanticKind, 'house_medium');
  assert.equal(house('vacant', 2, 2).gameBinding.semanticKind, 'old_house');
  assert.equal(house('under_construction', 2, 2).gameBinding.semanticKind, 'hut');

  for (const role of ['resident', 'townsfolk']) {
    const request = { npc: { id: `npc-${role}-7`, role, x: 2, y: 4 }, availableAssetIds: allContextualAssets };
    assert.equal(selectNpcAsset(contextualIndex, request).assetId, selectNpcAsset(contextualIndex, request).assetId);
  }
  const travelerExamples = [
    ['traveler-1', 'traveler'],
    ['traveler-0', 'delivery_person']
  ];
  for (const [id, expected] of travelerExamples) {
    const request = { npc: { id, role: 'traveler' }, availableAssetIds: allContextualAssets };
    assert.equal(selectNpcAsset(contextualIndex, request).gameBinding.semanticKind, expected);
    assert.equal(selectNpcAsset(contextualIndex, request).assetId, selectNpcAsset(contextualIndex, request).assetId);
  }
  const propExamples = {
    crate: [['crate-1', 'crate'], ['crate-0', 'stacked_crates']],
    lamp: [['lamp-0', 'lamp'], ['lamp-1', 'streetlight']],
    signboard: [['signboard-1', 'signboard'], ['signboard-0', 'notice_board']]
  };
  for (const [kind, examples] of Object.entries(propExamples)) {
    for (const [id, expected] of examples) {
      const request = { prop: { id, kind }, availableAssetIds: allContextualAssets };
      assert.equal(selectPropAsset(contextualIndex, request).gameBinding.semanticKind, expected);
      assert.equal(selectPropAsset(contextualIndex, request).assetId, selectPropAsset(contextualIndex, request).assetId);
    }
  }
  assert.equal(selectNpcAsset(contextualIndex, {
    npc: { id: 'traveler-1', role: 'traveler' },
    availableAssetIds: new Set(['character.mob.delivery_person'])
  }).assetId, 'character.mob.delivery_person');
  for (const [kind, assetId] of [
    ['crate', 'object.stacked_crates'],
    ['lamp', 'object.streetlight'],
    ['signboard', 'object.notice_board']
  ]) {
    assert.equal(selectPropAsset(contextualIndex, {
      prop: { id: `${kind}-loaded-only`, kind }, availableAssetIds: new Set([assetId])
    }).assetId, assetId);
  }
  for (const [kind, assetId] of [
    ['crate', 'object.harbor_cargo'],
    ['signboard', 'object.guild_roster_stand'],
    ['signboard', 'object.menu_board']
  ]) {
    assert.equal(selectPropAsset(contextualIndex, {
      prop: { id: `${kind}-context-missing`, kind }, availableAssetIds: new Set([assetId])
    }), null);
  }
  assert.equal(selectNpcAsset(contextualIndex, {
    npc: { id: 'traveler-none', role: 'traveler' }, availableAssetIds: new Set()
  }), null);
  assert.equal(selectPropAsset(contextualIndex, {
    prop: { id: 'crate-none', kind: 'crate' }, availableAssetIds: new Set()
  }), null);
  const plantRequest = {
    prop: { id: 'plant-9', kind: 'plant', x: 1, y: 2 }, availableAssetIds: allContextualAssets
  };
  assert.equal(selectPropAsset(contextualIndex, plantRequest).assetId, selectPropAsset(contextualIndex, plantRequest).assetId);
  assert.equal(selectPropAsset(contextualIndex, {
    prop: { id: 'flag-1', kind: 'flag', state: 'ruined' }, availableAssetIds: allContextualAssets
  }).gameBinding.semanticKind, 'red_flag');
});

test('character destination preserves frame aspect ratio and anchors feet to the tile bottom center', () => {
  const spec = manifest.assets.find(({ assetId }) => assetId === 'character.player').renderSpec;
  const destination = characterDestinationRect(spec, { tileX: 2, tileY: 3, tileSize: 16 });
  assert.deepEqual(destination, { dx: 30, dy: 32, dw: 20, dh: 32 });
  assert.equal(destination.dw / destination.dh, 20 / 32);
  assert.equal(destination.dx + destination.dw / 2, 2 * 16 + 8);
  assert.equal(destination.dy + destination.dh, (3 + 1) * 16);
  assert.equal(characterDestinationRect(null, { tileX: 0, tileY: 0, tileSize: 16 }), null);
});

test('incomplete approved manifests remain visibly partial instead of silently claiming loaded', async () => {
  const createImage = () => ({
    onload: null,
    onerror: null,
    set src(_value) { queueMicrotask(() => this.onload()); }
  });
  const runtime = await loadGameAssets({
    fetchImpl: async () => ({ ok: true, json: async () => manifest }),
    createImage
  });
  assert.equal(runtime.status, 'partial');
  assert.match(runtime.reason, /runtime binding/);
  assert.match(runtime.reason, /2 required asset\(s\)/);
  assert.equal(runtime.images.size, 2);
  const inventoryOnlyManifest = {
    ...manifest, complete: false, missingBindings: [], missingAssets: ['effect.water_ripple']
  };
  const inventoryOnly = await loadGameAssets({
    fetchImpl: async () => ({ ok: true, json: async () => inventoryOnlyManifest }),
    createImage
  });
  assert.equal(inventoryOnly.status, 'partial');
  assert.equal(inventoryOnly.reason, '1 required asset(s) lack approved art');
  const invalid = await loadGameAssets({
    fetchImpl: async () => ({ ok: true, json: async () => ({ ...manifest, missingAssets: ['invalid-id'] }) }),
    createImage
  });
  assert.equal(invalid.status, 'fallback');
  assert.equal(invalid.reason, 'asset manifest validation failed');
  assert.equal(invalid.images.size, 0);
  const legacyManifest = {
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    complete: true,
    missingBindings: [],
    assets: manifest.assets.map(({ renderSpec: _renderSpec, ...asset }) => asset)
  };
  const legacy = await loadGameAssets({
    fetchImpl: async () => ({ ok: true, json: async () => legacyManifest }),
    createImage
  });
  assert.equal(legacy.status, 'partial');
  assert.match(legacy.reason, /legacy manifest lacks v2 render metadata and required-asset inventory/);
  assert.equal(legacy.images.size, 2);
  const emptyLegacy = await loadGameAssets({
    fetchImpl: async () => ({ ok: true, json: async () => ({ ...legacyManifest, assets: [] }) }),
    createImage
  });
  assert.equal(emptyLegacy.status, 'fallback');
  assert.match(emptyLegacy.reason, /legacy manifest lacks v2 render metadata and required-asset inventory/);
});
