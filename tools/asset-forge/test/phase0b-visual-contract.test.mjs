import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test, { after } from 'node:test';
import { sha256 } from '../src/hashing.mjs';
import {
  auditBuildingBundleV2,
  auditVisualAssetV2,
  spriteSheetV2Problems,
  visualContractV2Problems
} from '../src/images/visual-contract-v2.mjs';
import { processCandidate } from '../src/jobs/process-candidate.mjs';
import { inspectPng } from '../src/png-core.mjs';
import { validateWith } from '../src/schemas.mjs';

const FRAME_COLUMNS = Object.freeze([
  'idle_1', 'idle_2', 'walk_1', 'walk_2', 'walk_3', 'walk_4',
  'talk_1', 'talk_2', 'work_1', 'work_2'
]);
const DIRECTIONS = Object.freeze(['front', 'back', 'left', 'right']);
const TEMP_ROOTS = [];

after(async () => {
  await Promise.all(TEMP_ROOTS.map((root) => rm(root, { recursive: true, force: true })));
});

function fixtureFrameContent(ids) {
  return ids.map((frameId) => ({
    frameId,
    visualContent: `${frameId} has fixture-specific visual content and a distinct readable pose.`
  }));
}

function fixtureArtDirection(id, category) {
  const comparisonId = id === 'prop.lamp' ? 'prop.crate' : 'prop.lamp';
  const frameIds = category === 'character'
    ? FRAME_COLUMNS
    : category === 'building'
      ? ['base', 'roof']
      : category === 'terrain' || category === 'interior'
        ? Array.from({ length: 25 }, (_, index) => `tile_${index}`)
        : ['primary'];
  const artDirection = {
    version: 2,
    subjectForm: `${id} uses a fixture-specific three-quarter silhouette with a readable primary mass.`,
    materials: ['weathered old-town stone', 'dark forged iron trim'],
    dominantColors: ['twilight slate blue', 'warm weathered umber'],
    accentColors: ['small amber inspection light'],
    shapeLanguage: 'Broad grounded forms with an asymmetrical landmark-facing accent.',
    distinguishingFeatures: [
      `${id} carries one unmistakable left-facing fixture marker.`,
      `${id} has a unique stepped lower contour at its ground contact.`
    ],
    distinguishFrom: [{
      assetId: comparisonId,
      reason: `${id} differs through its fixture marker, lower contour, and material balance.`
    }],
    composition: 'Centered within the declared canvas with clear breathing room and no cropped silhouette.',
    groundContact: 'The lowest opaque pixels sit exactly on the declared baseline without a floating shadow.',
    negativeConstraints: ['no generic placeholder geometry', 'no text or labels', 'no soft alpha edges'],
    frameContent: fixtureFrameContent(frameIds)
  };
  if (category === 'terrain' || category === 'interior') {
    artDirection.terrainContent = {
      baseVariants: Array.from({ length: 3 }, (_, index) => ({
        frameId: `tile_${index}`,
        role: `base-variant-${index}`,
        visualContent: `Opaque base variant ${index} uses a distinct local texture break while preserving exact seams.`
      })),
      blob16: Array.from({ length: 16 }, (_, mask) => ({
        frameId: `tile_${mask + 3}`,
        mask,
        role: `blob-mask-${mask}`,
        visualContent: mask === 0
          ? 'Mask zero is intentionally fully transparent while remaining a semantic transition cell.'
          : `Mask ${mask} contains only its exact connected-edge transition silhouette.`
      })),
      auxiliary: Array.from({ length: 6 }, (_, index) => ({
        frameId: `tile_${index + 19}`,
        role: `auxiliary-${index}`,
        visualContent: `Auxiliary cell ${index} follows the fixture contract for its declared semantic role.`
      }))
    };
  }
  if (category === 'character') {
    artDirection.characterContent = {
      outfit: 'A dark inspection coat with a pale collar and one asymmetric amber shoulder clasp.',
      roleTool: 'A compact field notebook held at the left hip.',
      directionConsistency: 'Coat, clasp, notebook, height, and handedness remain identical in all four direction rows.',
      actionContent: {
        idle: 'Two distinct breathing poses keep both feet on the common baseline.',
        walk: 'Four distinct walk poses alternate planted feet without changing body scale.',
        talk: 'Two distinct speaking poses lift the notebook hand below shoulder height.',
        work: 'Two distinct work poses open and mark the field notebook.'
      }
    };
  }
  if (category === 'building') {
    artDirection.layerContent = {
      layers: [
        {
          role: 'base',
          includes: ['complete wall mass and visible interior floor', 'south-facing doorway and all windows'],
          excludes: ['roof planes and roof shadows'],
          materials: ['weathered old-town stone', 'dark timber door frame'],
          doorWindowCue: 'The south door is brighter than the wall and all windows align with room anchors.',
          facilityCue: 'An amber inspection lantern beside the door identifies the fixture facility.'
        },
        {
          role: 'roof',
          includes: ['complete removable roof planes', 'upper-left cast eave shadow'],
          excludes: ['walls, doorway, floor, and interior furniture'],
          materials: ['slate roof shingles', 'aged copper ridge cap'],
          doorWindowCue: 'The roof never paints over the south doorway cue in the base layer.',
          facilityCue: 'The ridge silhouette echoes the inspection lantern bracket below.'
        }
      ],
      compositeMatch: 'Base and roof share exact canvas dimensions, pivot, outline registration, and upper-left light direction.',
      cutawayMatch: 'Removing only the roof reveals a complete readable base without holes in walls, floor, or doorway.'
    };
  }
  return artDirection;
}

function baseDefinition({ id, category, kind, scaleClass, outputSize, logicalSpriteSize, tileSize }) {
  return {
    visualContractVersion: 2,
    id,
    category,
    displayName: id,
    gameMeaning: `Fable5 contract fixture for ${id}`,
    required: false,
    promptFiles: ['prompts/v2/fixture.md'],
    defaultReferenceIds: [],
    output: {
      kind,
      preferredFormat: 'png',
      background: 'transparent',
      needsTransparency: true,
      needsTrim: false
    },
    pixelArt: {
      ...(logicalSpriteSize ? { logicalSpriteSize } : {}),
      ...(tileSize ? { tileSize } : {}),
      scalePreview: 2,
      nearestNeighbor: true,
      allowAntiAlias: false
    },
    outputSize,
    productionDecision: {
      kind: 'addition', legacyAssetId: null,
      reason: 'Phase 0-B fixture for a new VisualAssetContract v2 asset.'
    },
    usage: { biomes: category === 'ui' ? ['interface'] : ['old-town'], scenes: ['world'] },
    palette: { family: 'fable5-twilight', accents: ['old-stone'] },
    silhouette: `${id} fixture remains recognizable at native size.`,
    variants: ['canonical'],
    acceptance: {
      native: ['Exact native-size contract.'],
      repeat: ['Fixture repeat behavior is explicitly inspected where applicable.'],
      ensemble: ['Fixture is composited at native scale in an ensemble scene.']
    },
    artDirection: fixtureArtDirection(id, category),
    priority: { requiredSetId: 'fable5-v2', wave: 'A' },
    placementSpace: { pixels: 'pixel-edges-top-left', tiles: 'tile-edges-north-west' },
    perspective: 'three-quarter-overhead',
    lighting: 'upper-left-twilight',
    scaleClass,
    states: [],
    tags: ['fable5-v2'],
    constraints: { must: ['VisualAssetContract v2'], mustNot: ['non-integer enlargement'] },
    reviewChecklist: ['native', 'repeat', 'ensemble'],
    gameBinding: {
      rendererCategory: category === 'terrain' ? 'tile' : category === 'building' ? 'building_exterior' : 'npc',
      semanticKind: id,
      drawLayer: category === 'terrain' ? 'ground' : category === 'building' ? 'building' : 'character',
      runtimeBindings: [],
      coverage: 'future'
    }
  };
}

function commonGates({ seams = [] } = {}) {
  return {
    alphaBbox: { policy: 'non-empty', expected: null, allowBorderContact: true },
    hardAlpha: true,
    exactSeams: { required: seams.length > 0, tileIndices: seams },
    resize: { kernel: 'nearest', allowEnlargement: false }
  };
}

export function buildingV2Definition() {
  const outputSize = { width: 256, height: 352 };
  const pivot = { x: 128, y: 352 };
  return {
    ...baseDefinition({
      id: 'building.inn', category: 'building', kind: 'layered-building',
      scaleClass: 'L', outputSize, logicalSpriteSize: outputSize, tileSize: 64
    }),
    pivot,
    baseline: { edgeY: 352 },
    footprint: { widthTiles: 4, heightTiles: 4 },
    entrance: { edge: 'south', offsetTiles: 1, widthTiles: 1 },
    collision: {
      unit: 'tile',
      polygons: [{ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }]
    },
    occlusion: { unit: 'pixel', regions: [{ x: 0, y: 224, width: 256, height: 128 }] },
    roofMask: { artifact: 'roof', source: 'alpha', threshold: 1 },
    windowAnchors: [
      { id: 'room-1', roomIndex: 0, x: 48, y: 142 },
      { id: 'room-2', roomIndex: 1, x: 88, y: 142 },
      { id: 'room-3', roomIndex: 2, x: 128, y: 142 },
      { id: 'room-4', roomIndex: 3, x: 168, y: 142 },
      { id: 'room-5', roomIndex: 4, x: 208, y: 142 }
    ],
    inspectionGates: commonGates(),
    buildingLayerContract: {
      artifacts: [
        { role: 'base', suffix: '.base', outputSize, anchor: pivot },
        { role: 'roof', suffix: '.roof', outputSize, anchor: pivot }
      ],
      atomicPair: true
    }
  };
}

export function characterV2Definition() {
  return {
    ...baseDefinition({
      id: 'character.player', category: 'character', kind: 'spritesheet',
      scaleClass: 'character', outputSize: { width: 480, height: 384 },
      logicalSpriteSize: { width: 48, height: 96 }
    }),
    sprites: {
      directions: DIRECTIONS,
      frames: FRAME_COLUMNS,
      grid: { columns: 10, rows: 4, frameWidth: 48, frameHeight: 96 }
    },
    characterSpriteContract: {
      version: 2,
      frame: { width: 48, height: 96 },
      body: { width: 40, height: 80 },
      sheet: { width: 480, height: 384, columns: 10, rows: 4 },
      directionRows: DIRECTIONS,
      frameColumns: FRAME_COLUMNS,
      animations: { idle: [0, 1], walk: [2, 3, 4, 5], talk: [6, 7], work: [8, 9] },
      footBaseline: 'common',
      resampling: { kernel: 'nearest', downscaleOnly: true, allowEnlargement: false },
      visibleBboxHeight: { class: 'adult', min: 64, max: 80 },
      partialAlphaPixels: 0
    },
    pivot: { x: 24, y: 96 },
    baseline: { edgeY: 96 },
    footprint: { widthTiles: 1, heightTiles: 1 },
    entrance: null,
    collision: { unit: 'tile', polygons: [] },
    occlusion: { unit: 'pixel', regions: [] },
    roofMask: null,
    windowAnchors: [],
    inspectionGates: commonGates()
  };
}

export function terrainV2Definition(id = 'terrain.grass', category = 'terrain') {
  const blob16 = Array.from({ length: 16 }, (_, mask) => ({ mask, tileIndex: mask + 3 }));
  const water = id === 'terrain.water';
  const cliff = id === 'terrain.cliff';
  return {
    ...baseDefinition({
      id, category, kind: 'tileset', scaleClass: category === 'terrain' ? 'terrain' : 'interior',
      outputSize: { width: 320, height: 320 }, tileSize: 64
    }),
    sprites: {
      directions: [],
      frames: Array.from({ length: 25 }, (_, index) => `tile_${index}`),
      grid: { columns: 5, rows: 5, frameWidth: 64, frameHeight: 64 }
    },
    pivot: { x: 32, y: 64 },
    baseline: { edgeY: 64 },
    footprint: { widthTiles: 1, heightTiles: 1 },
    entrance: null,
    collision: { unit: 'tile', polygons: [] },
    occlusion: { unit: 'pixel', regions: [] },
    roofMask: null,
    windowAnchors: [],
    inspectionGates: commonGates({ seams: water ? [0, 1, 2, 19, 20, 21] : [0, 1, 2] }),
    autotileContract: {
      tileSize: 64,
      sheet: { columns: 5, rows: 5 },
      baseVariantIndices: [0, 1, 2],
      blob16,
      auxiliaryTileIndices: [19, 20, 21, 22, 23, 24],
      auxiliaryRoles: water
        ? [
            'animation-base-0', 'animation-base-1', 'animation-base-2',
            'transparent-reserved-0', 'transparent-reserved-1', 'transparent-reserved-2'
          ]
        : cliff ? [
            'cliff-face-north', 'cliff-face-east', 'cliff-face-south',
            'cliff-face-west', 'cliff-inner-corner', 'cliff-outer-corner'
          ]
          : Array.from({ length: 6 }, (_, index) => `transparent-reserved-${index}`),
      animationFrameIndices: water ? [19, 20, 21] : [],
      maskBits: { north: 1, east: 2, south: 4, west: 8 },
      edgeMode: 'transparent-overlay'
    }
  };
}

test('VisualAssetContract v2 building, character, and terrain definition shapes validate', () => {
  for (const definition of [buildingV2Definition(), characterV2Definition(), terrainV2Definition()]) {
    const validation = validateWith('asset-definition.schema.json', definition);
    assert.deepEqual(validation.errors, [], `${definition.id}: ${JSON.stringify(validation.errors)}`);
    assert.equal(validation.ok, true);
  }
});

test('v2 sprite sheet contracts cover every canonical character and terrain cell exactly once', () => {
  const characterFrames = DIRECTIONS.flatMap((direction, row) => FRAME_COLUMNS.map((animation, column) => ({
    id: `${direction}.${animation}`,
    x: column * 48,
    y: row * 96,
    width: 48,
    height: 96,
    direction,
    animation,
    index: column
  })));
  const character = {
    visualContractVersion: 2,
    layout: 'character-4x10',
    assetId: 'character.player',
    sourcePath: 'processed/characters/pending/player.png',
    frameWidth: 48,
    frameHeight: 96,
    columns: 10,
    rows: 4,
    frames: characterFrames
  };
  assert.equal(validateWith('sprite-sheet.schema.json', character).ok, true);
  assert.deepEqual(spriteSheetV2Problems(character), []);
  const wrong = structuredClone(character);
  wrong.frames[1].x = 0;
  assert.match(spriteSheetV2Problems(wrong).join('; '), /unique|canonical/);

  const terrain = {
    visualContractVersion: 2,
    layout: 'terrain-blob16',
    assetId: 'terrain.grass',
    sourcePath: 'processed/terrains/pending/grass.png',
    frameWidth: 64,
    frameHeight: 64,
    columns: 5,
    rows: 5,
    frames: Array.from({ length: 25 }, (_, index) => ({
      id: `tile_${index}`,
      x: (index % 5) * 64,
      y: Math.floor(index / 5) * 64,
      width: 64,
      height: 64,
      index
    }))
  };
  assert.equal(validateWith('sprite-sheet.schema.json', terrain).ok, true);
  assert.deepEqual(spriteSheetV2Problems(terrain), []);
});

function characterSheetBytes({ partialAlpha = false, hiddenRgb = false } = {}) {
  const width = 480;
  const height = 384;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      const bodyWidth = 20 + column;
      const bodyHeight = 64 + column;
      const left = column * 48 + Math.floor((48 - bodyWidth) / 2);
      const top = row * 96 + 96 - bodyHeight;
      for (let y = top; y < row * 96 + 96; y += 1) {
        for (let x = left; x < left + bodyWidth; x += 1) {
          const offset = (y * width + x) * channels;
          raw[offset] = 30 + row * 40;
          raw[offset + 1] = 20 + column * 17;
          raw[offset + 2] = 200 - column * 11;
          raw[offset + 3] = 255;
        }
      }
    }
  }
  if (partialAlpha) raw[(95 * width + 24) * channels + 3] = 128;
  if (hiddenRgb) {
    raw[0] = 255;
    raw[1] = 0;
    raw[2] = 255;
  }
  return sharp(raw, { raw: { width, height, channels } }).png({ palette: false }).toBuffer();
}

async function terrainSheetBytes({ seamAlphaMismatch = false, cliffFaces = false } = {}) {
  const width = 320;
  const height = 320;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels);
  for (let index = 0; index < 3; index += 1) {
    const column = index % 5;
    const row = Math.floor(index / 5);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const offset = ((row * 64 + y) * width + column * 64 + x) * channels;
        const edge = x === 0 || y === 0 || x === 63 || y === 63;
        raw[offset] = edge ? 70 : 80 + index * 20;
        raw[offset + 1] = edge ? 90 : 120 + index * 10;
        raw[offset + 2] = edge ? 50 : 60;
        raw[offset + 3] = 255;
      }
    }
  }
  for (let mask = 1; mask < 16; mask += 1) {
    const index = mask + 3;
    const column = index % 5;
    const row = Math.floor(index / 5);
    const offset = ((row * 64 + 32) * width + column * 64 + 32) * channels;
    raw[offset] = 100 + mask;
    raw[offset + 1] = 120 + mask;
    raw[offset + 2] = 80 + mask;
    raw[offset + 3] = 255;
  }
  if (cliffFaces) {
    for (let index = 19; index <= 24; index += 1) {
      const column = index % 5;
      const row = Math.floor(index / 5);
      for (let y = 12; y < 64; y += 1) {
        for (let x = 4; x < 60; x += 1) {
          const offset = ((row * 64 + y) * width + column * 64 + x) * channels;
          raw[offset] = 72 + index;
          raw[offset + 1] = 78;
          raw[offset + 2] = 82;
          raw[offset + 3] = 255;
        }
      }
    }
  }
  if (seamAlphaMismatch) raw[(64 + 63) * channels + 3] = 0;
  return sharp(raw, { raw: { width, height, channels } }).png({ palette: false }).toBuffer();
}

async function buildingArtifactBytes(color, { inset = 16 } = {}) {
  return sharp({
    create: {
      width: 256,
      height: 352,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).composite([{
    input: await sharp({
      create: {
        width: 256 - inset * 2,
        height: 352 - inset,
        channels: 4,
        background: color
      }
    }).png().toBuffer(),
    left: inset,
    top: inset
  }]).png({ palette: false }).toBuffer();
}

test('cross-field validation rejects contradictory v2 scale, axes, layers, and autotile partitions', () => {
  const building = buildingV2Definition();
  assert.match(
    visualContractV2Problems({ ...building, outputSize: { width: 192, height: 288 } }).join('; '),
    /outputSize|scaleClass/
  );
  const wrongLayer = structuredClone(building);
  wrongLayer.buildingLayerContract.artifacts[1].anchor = {
    ...wrongLayer.buildingLayerContract.artifacts[1].anchor,
    x: wrongLayer.buildingLayerContract.artifacts[1].anchor.x + 1
  };
  assert.match(visualContractV2Problems(wrongLayer).join('; '), /share outputSize and pivot/);

  const character = characterV2Definition();
  const wrongAxis = structuredClone(character);
  wrongAxis.sprites.grid = { columns: 4, rows: 10, frameWidth: 48, frameHeight: 96 };
  assert.match(visualContractV2Problems(wrongAxis).join('; '), /10 frame columns by 4 direction rows/);
  const wrongRange = structuredClone(character);
  wrongRange.characterSpriteContract.visibleBboxHeight = { class: 'adult', min: 80, max: 64 };
  assert.match(visualContractV2Problems(wrongRange).join('; '), /bbox height range/);

  const terrain = terrainV2Definition();
  const duplicateCell = structuredClone(terrain);
  duplicateCell.autotileContract.auxiliaryTileIndices[0] = 18;
  assert.match(visualContractV2Problems(duplicateCell).join('; '), /partition all 25/);
  const duplicateMask = structuredClone(terrain);
  duplicateMask.autotileContract.blob16[15].mask = 14;
  assert.match(visualContractV2Problems(duplicateMask).join('; '), /masks must cover/);
  const wrongWater = terrainV2Definition('terrain.water');
  wrongWater.autotileContract.animationFrameIndices = [];
  assert.match(visualContractV2Problems(wrongWater).join('; '), /terrain\.water/);
});

test('character gate checks every 48x96 cell, hard alpha, body bbox, and distinct action frames', async () => {
  const definition = characterV2Definition();
  const valid = await characterSheetBytes();
  const accepted = await auditVisualAssetV2(valid, definition);
  assert.deepEqual(accepted, {
    ok: true,
    problems: [],
    technicalInspection: accepted.technicalInspection
  });
  assert.deepEqual(
    {
      declaredSlots: accepted.technicalInspection.cells.declaredSlots,
      semanticCells: accepted.technicalInspection.cells.semanticCells,
      expectedNonempty: accepted.technicalInspection.cells.expectedNonempty,
      expectedTransparentSemantic: accepted.technicalInspection.cells.expectedTransparentSemantic,
      reservedTransparent: accepted.technicalInspection.cells.reservedTransparent,
      recordCount: accepted.technicalInspection.cells.records.length
    },
    {
      declaredSlots: 40,
      semanticCells: 40,
      expectedNonempty: 40,
      expectedTransparentSemantic: 0,
      reservedTransparent: 0,
      recordCount: 40
    }
  );
  assert.equal(new Set(accepted.technicalInspection.cells.records.map(({ sha256: digest }) => digest)).size, 40);
  const partial = await auditVisualAssetV2(await characterSheetBytes({ partialAlpha: true }), definition);
  assert.equal(partial.ok, false);
  assert.match(partial.problems.join('; '), /hard-alpha/);
  const hiddenRgb = await auditVisualAssetV2(await characterSheetBytes({ hiddenRgb: true }), definition);
  assert.equal(hiddenRgb.ok, false);
  assert.match(hiddenRgb.problems.join('; '), /non-zero RGB hidden/);

  const duplicateRaw = await sharp(valid).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let row = 0; row < 4; row += 1) {
    for (let y = 0; y < 96; y += 1) {
      const source = ((row * 96 + y) * 480) * 4;
      const destination = ((row * 96 + y) * 480 + 48) * 4;
      duplicateRaw.data.copy(duplicateRaw.data, destination, source, source + 48 * 4);
    }
  }
  const duplicate = await sharp(duplicateRaw.data, {
    raw: { width: 480, height: 384, channels: 4 }
  }).png().toBuffer();
  const duplicateAudit = await auditVisualAssetV2(duplicate, definition);
  assert.match(duplicateAudit.problems.join('; '), /byte-identical frame slots/);
});

test('terrain gate enforces hard alpha, reserved transparency, and cross-variant exact RGBA seams', async () => {
  const definition = terrainV2Definition();
  const valid = await terrainSheetBytes();
  const accepted = await auditVisualAssetV2(valid, definition);
  assert.equal(accepted.ok, true, accepted.problems.join('; '));
  assert.deepEqual(
    {
      declaredSlots: accepted.technicalInspection.cells.declaredSlots,
      semanticCells: accepted.technicalInspection.cells.semanticCells,
      expectedNonempty: accepted.technicalInspection.cells.expectedNonempty,
      expectedTransparentSemantic: accepted.technicalInspection.cells.expectedTransparentSemantic,
      reservedTransparent: accepted.technicalInspection.cells.reservedTransparent,
      recordCount: accepted.technicalInspection.cells.records.length
    },
    {
      declaredSlots: 25,
      semanticCells: 19,
      expectedNonempty: 18,
      expectedTransparentSemantic: 1,
      reservedTransparent: 6,
      recordCount: 25
    }
  );
  assert.equal(accepted.technicalInspection.cells.records[3].expectation, 'semantic-transparent');
  assert.equal(accepted.technicalInspection.cells.records[3].visiblePixels, 0);
  const rejected = await auditVisualAssetV2(await terrainSheetBytes({ seamAlphaMismatch: true }), definition);
  assert.equal(rejected.ok, false);
  assert.match(rejected.problems.join('; '), /exact-seam|fully opaque/);
});

test('terrain.cliff requires all six declared cliff-face auxiliary cells instead of rejecting them as reserved', async () => {
  const definition = terrainV2Definition('terrain.cliff');
  const empty = await auditVisualAssetV2(await terrainSheetBytes(), definition);
  assert.equal(empty.ok, false);
  assert.match(empty.problems.join('; '), /cliff-face tile 19 is empty/);
  const accepted = await auditVisualAssetV2(await terrainSheetBytes({ cliffFaces: true }), definition);
  assert.equal(accepted.ok, true, accepted.problems.join('; '));
  assert.deepEqual(
    {
      declaredSlots: accepted.technicalInspection.cells.declaredSlots,
      semanticCells: accepted.technicalInspection.cells.semanticCells,
      expectedNonempty: accepted.technicalInspection.cells.expectedNonempty,
      expectedTransparentSemantic: accepted.technicalInspection.cells.expectedTransparentSemantic,
      reservedTransparent: accepted.technicalInspection.cells.reservedTransparent
    },
    {
      declaredSlots: 25,
      semanticCells: 25,
      expectedNonempty: 24,
      expectedTransparentSemantic: 1,
      reservedTransparent: 0
    }
  );
});

test('interior autotiles receive the same 25-cell partition, seam, reserved-cell, and hard-alpha gates', async () => {
  const definition = terrainV2Definition('interior.floor_wood', 'interior');
  const validation = validateWith('asset-definition.schema.json', definition);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const accepted = await auditVisualAssetV2(await terrainSheetBytes(), definition);
  assert.equal(accepted.ok, true, accepted.problems.join('; '));
  const occupiedReserved = await terrainSheetBytes({ cliffFaces: true });
  const rejected = await auditVisualAssetV2(occupiedReserved, definition);
  assert.equal(rejected.ok, false);
  assert.match(rejected.problems.join('; '), /reserved tile 19 is not fully transparent/);
});

test('nearest reconstruction rejects a lanczos derivative and accepts a nearest downscale', async () => {
  const definition = terrainV2Definition();
  const target = await terrainSheetBytes();
  const source = await sharp(target).resize(640, 640, { kernel: sharp.kernel.nearest }).png().toBuffer();
  const nearest = await sharp(source).resize(320, 320, { kernel: sharp.kernel.nearest }).png().toBuffer();
  assert.equal((await auditVisualAssetV2(nearest, definition, { sourceBuffer: source })).ok, true);
  const lanczos = await sharp(source).resize(320, 320, { kernel: sharp.kernel.lanczos3 }).png().toBuffer();
  const rejected = await auditVisualAssetV2(lanczos, definition, { sourceBuffer: source });
  assert.equal(rejected.ok, false);
  assert.match(rejected.problems.join('; '), /nearest-resize/);
});

test('layered building audit requires distinct same-size base and roof bytes', async () => {
  const definition = buildingV2Definition();
  const base = await buildingArtifactBytes('#765432ff');
  const roof = await buildingArtifactBytes('#345678ff', { inset: 8 });
  const accepted = await auditBuildingBundleV2([
    { role: 'base', bytes: base },
    { role: 'roof', bytes: roof }
  ], definition);
  assert.equal(accepted.ok, true, accepted.problems.join('; '));
  const opaqueCanvas = await sharp({
    create: {
      width: 256,
      height: 352,
      channels: 4,
      background: '#ff00ffff'
    }
  }).png({ palette: false }).toBuffer();
  const opaqueAudit = await auditVisualAssetV2(opaqueCanvas, definition);
  assert.equal(opaqueAudit.ok, false);
  assert.match(opaqueAudit.problems.join('; '), /fully opaque canvas/);
  const missing = await auditBuildingBundleV2([{ role: 'base', bytes: base }], definition);
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join('; '), /exactly one base and one roof/);
  const identical = await auditBuildingBundleV2([
    { role: 'base', bytes: base },
    { role: 'roof', bytes: base }
  ], definition);
  assert.match(identical.problems.join('; '), /must not be identical/);
});

async function v2ProcessFixture(bytes) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-v2-process-'));
  TEMP_ROOTS.push(root);
  await mkdir(path.join(root, 'data', 'asset-definitions'), { recursive: true });
  await mkdir(path.join(root, 'data', 'local'), { recursive: true });
  await mkdir(path.join(root, 'data', 'manifests'), { recursive: true });
  await mkdir(path.join(root, 'generated', 'characters', 'pending'), { recursive: true });
  const definition = characterV2Definition();
  await writeFile(path.join(root, 'data', 'asset-definitions', 'characters.json'), JSON.stringify({
    schemaVersion: 1, category: 'character', assets: [definition]
  }));
  await writeFile(path.join(root, 'data', 'manifests', 'references.json'), JSON.stringify({
    schemaVersion: 1, references: []
  }));
  const sourcePath = 'generated/characters/pending/character_player-source.png';
  await writeFile(path.join(root, sourcePath), bytes);
  const result = {
    id: 'gen_v2_source',
    jobId: 'job_v2_source',
    assetId: 'character.player',
    category: 'character',
    status: 'pending',
    provider: 'mock',
    outputPath: sourcePath,
    outputSha256: sha256(bytes),
    metadataPath: 'generated/characters/pending/character_player-source.json',
    promptHash: 'a'.repeat(64),
    provenanceKey: 'b'.repeat(64),
    referenceImageIds: [],
    referenceImageHashes: [],
    dryRun: false,
    subscriptionRun: false,
    manualImport: false,
    outputInspection: inspectPng(bytes),
    warnings: [],
    createdAt: '2026-07-16T00:00:00.000Z',
    inspection: { status: 'pending-inspection', observed: [], inferred: [], unknown: ['human approval'] }
  };
  await writeFile(path.join(root, result.metadataPath), JSON.stringify(result));
  await writeFile(path.join(root, 'data', 'local', 'generations.json'), JSON.stringify({
    schemaVersion: 1, tracked: false, results: [result]
  }));
  return { root, result };
}

test('processCandidate records v2 gates and a gate failure writes no derivative or ledger entry', async () => {
  const validFixture = await v2ProcessFixture(await characterSheetBytes());
  const processed = await processCandidate({ generationId: validFixture.result.id }, {
    root: validFixture.root,
    forgeRoot: validFixture.root,
    now: () => '2026-07-16T00:01:00.000Z'
  });
  assert.equal(processed.result.visualContractVersion, 2);
  assert.equal(processed.result.technicalInspection.alpha.passed, true);
  assert.equal(processed.result.technicalInspection.exactSeams.passed, true);
  assert.equal(processed.result.technicalInspection.resize.passed, true);

  const invalidFixture = await v2ProcessFixture(await characterSheetBytes({ partialAlpha: true }));
  const ledgerBefore = await readFile(path.join(invalidFixture.root, 'data', 'local', 'generations.json'));
  await assert.rejects(
    () => processCandidate({ generationId: invalidFixture.result.id }, {
      root: invalidFixture.root,
      forgeRoot: invalidFixture.root
    }),
    /technical gates rejected.*hard-alpha/i
  );
  assert.deepEqual(await readFile(path.join(invalidFixture.root, 'data', 'local', 'generations.json')), ledgerBefore);
  await assert.rejects(() => readdir(path.join(invalidFixture.root, 'processed')), { code: 'ENOENT' });
});
