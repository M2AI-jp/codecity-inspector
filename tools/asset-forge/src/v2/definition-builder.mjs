import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT } from '../config.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import {
  CHARACTER_DIRECTIONS_V2,
  CHARACTER_FRAMES_V2,
  BUILDING_SCALE_CONTRACTS_V2,
  visualContractV2Problems
} from '../images/visual-contract-v2.mjs';
import { validateWith } from '../schemas.mjs';

const WORLD_REFERENCE = 'world_visual_master';
const CHARACTER_REFERENCE = 'character_visual_master';
const PLACEMENT_SPACE = Object.freeze({
  pixels: 'pixel-edges-top-left',
  tiles: 'tile-edges-north-west'
});
const FULL_TILE = Object.freeze({
  points: Object.freeze([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])
});
const PROMPTS = Object.freeze({
  terrain: 'prompts/v2/terrain/autotile.md',
  overlay: 'prompts/v2/overlays/overlay.md',
  structure: 'prompts/v2/structures/structure.md',
  building: 'prompts/v2/buildings/layered-building.md',
  interior: 'prompts/v2/terrain/autotile.md',
  prop: 'prompts/v2/props/prop.md',
  character: 'prompts/v2/characters/animated-character.md',
  effect: 'prompts/v2/effects/effect.md',
  ui: 'prompts/v2/ui/ui.md'
});
const REMAKE_MAP = Object.freeze({
  'terrain.grass': 'field.grass',
  'terrain.snow': 'field.snow',
  'terrain.dirt': 'field.dirt_path',
  'terrain.cobble': 'field.cobblestone',
  'terrain.plaza': 'field.plaza',
  'terrain.deck': 'field.dock_floor',
  'terrain.water': 'field.water',
  'terrain.cliff': 'field.cliff',
  'structure.stairs_stone': 'field.stairs_stone',
  'structure.bridge_stone': 'field.bridge_stone',
  'structure.bridge_wood': 'field.bridge_wood',
  'structure.fence': 'field.fence_wood',
  'structure.wall_stone': 'field.wall_stone',
  'building.gate': 'building.gate',
  'building.town_hall': 'building.town_hall',
  'building.dojo': 'building.dojo',
  'building.inn': 'building.inn',
  'building.warehouse': 'building.warehouse',
  'building.dock': 'building.dock',
  'building.guild': 'building.guild',
  'building.pub': 'building.pub',
  'building.shop': 'building.shop',
  'building.workshop': 'building.workshop',
  'building.watchtower': 'building.watchtower',
  'building.ruin': 'building.ruin',
  'building.house_s': 'building.house.small',
  'building.house_m': 'building.house.medium',
  'building.house_old': 'building.old_house',
  'building.hut': 'building.hut',
  'prop.lamp': 'object.lamp',
  'prop.streetlight': 'object.streetlight',
  'prop.signboard': 'object.signboard',
  'prop.notice_board': 'object.notice_board',
  'prop.warning_stake': 'object.warning_stake',
  'prop.barrel': 'object.barrel',
  'prop.crate': 'object.crate',
  'prop.bench': 'object.bench',
  'character.player': 'character.player',
  'character.town_clerk': 'character.town_clerk',
  'character.gatekeeper': 'character.gatekeeper',
  'character.dojo_inspector': 'character.dojo_inspector',
  'character.mob.townsfolk_male': 'character.mob.townsfolk_male',
  'character.mob.townsfolk_female': 'character.mob.townsfolk_female',
  'effect.water_ripple': 'effect.water_ripple',
  'effect.construction_dust': 'effect.construction_dust'
});
const ALL_WORLD_BIOMES = Object.freeze(['old-town', 'snow', 'harbor', 'woodland']);
const USAGE_BIOMES = Object.freeze({
  'terrain.grass': ['old-town', 'woodland'],
  'terrain.snow': ['snow'],
  'terrain.dirt': ['woodland'],
  'terrain.cobble': ['old-town'],
  'terrain.plaza': ['old-town'],
  'terrain.deck': ['harbor'],
  'terrain.water': ['harbor'],
  'terrain.cliff': ['snow', 'woodland'],
  'structure.tree.a': ['woodland'],
  'structure.tree.b': ['woodland'],
  'structure.tree.c': ['woodland'],
  'structure.pier': ['harbor'],
  'structure.ferry_shelter': ['harbor'],
  'structure.searoute_marker': ['harbor'],
  'structure.stone_lantern': ['snow'],
  'building.gate': ['old-town'],
  'building.town_hall': ['old-town'],
  'building.dojo': ['snow'],
  'building.inn': ['old-town', 'harbor'],
  'building.warehouse': ['harbor'],
  'building.dock': ['harbor'],
  'building.guild': ['old-town', 'harbor'],
  'building.pub': ['old-town', 'harbor'],
  'building.shop': ['old-town'],
  'building.workshop': ['old-town'],
  'building.watchtower': ['snow'],
  'building.ruin': ['woodland'],
  'building.hut': ['woodland'],
  'building.survey_tower': ['snow', 'woodland'],
  'overlay.snowcap.s': ['snow'],
  'overlay.snowcap.m': ['snow'],
  'overlay.snowcap.l': ['snow'],
  'overlay.snowcap.xl': ['snow'],
  'character.town_clerk': ['old-town'],
  'character.gatekeeper': ['old-town'],
  'character.dojo_inspector': ['snow'],
  'character.dojo_student': ['snow'],
  'effect.water_ripple': ['harbor']
});
const FRAME_25 = Object.freeze(Array.from({ length: 25 }, (_, index) => `tile_${index}`));
const BLOB16 = Object.freeze(Array.from({ length: 16 }, (_, mask) => Object.freeze({
  mask,
  tileIndex: mask + 3
})));

function titleFromId(id) {
  return id.split('.').slice(1).join(' ').replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function size(width, height) {
  return { width, height };
}

function point(x, y) {
  return { x, y };
}

function polygon(x1, y1, x2, y2) {
  return {
    points: [
      { x: x1, y: y1 }, { x: x2, y: y1 },
      { x: x2, y: y2 }, { x: x1, y: y2 }
    ]
  };
}

function collision(walkable, widthTiles = 1, heightTiles = 1) {
  return {
    unit: 'tile',
    polygons: walkable ? [] : [polygon(0, 0, widthTiles, heightTiles)]
  };
}

function buildingCollision(scaleClass, entranceOffset) {
  const contract = BUILDING_SCALE_CONTRACTS_V2[scaleClass];
  const w = contract.widthTiles;
  const h = contract.heightTiles;
  const thickness = 0.25;
  const polygons = [
    polygon(0, 0, w, thickness),
    polygon(0, thickness, thickness, h),
    polygon(w - thickness, thickness, w, h)
  ];
  if (entranceOffset > 0) polygons.push(polygon(0, h - thickness, entranceOffset, h));
  if (entranceOffset + 1 < w) polygons.push(polygon(entranceOffset + 1, h - thickness, w, h));
  return { unit: 'tile', polygons };
}

function commonGates({ seams = [], border = true } = {}) {
  return {
    alphaBbox: { policy: 'non-empty', expected: null, allowBorderContact: border },
    hardAlpha: true,
    exactSeams: { required: seams.length > 0, tileIndices: seams },
    resize: { kernel: 'nearest', allowEnlargement: false }
  };
}

function gameBinding(category, id, { facility = null, walkable = null } = {}) {
  const rendererCategory = {
    terrain: 'tile', overlay: 'prop', structure: 'prop', building: 'building_exterior',
    interior: 'tile', prop: 'prop', character: id === 'character.player' ? 'player' : id.includes('.mob.') ? 'mob' : 'npc',
    effect: 'effect', ui: 'ui'
  }[category];
  const drawLayer = {
    terrain: 'ground', overlay: 'object', structure: 'object', building: 'building',
    interior: 'ground', prop: 'object', character: 'character', effect: 'effect', ui: 'ui'
  }[category];
  const runtimeBindings = [{ vocabulary: 'WORLDPLAN_ASSET_IDS', id }];
  if (facility && facility !== 'landmark') runtimeBindings.push({ vocabulary: 'FACILITY_KINDS', id: facility });
  return {
    rendererCategory,
    semanticKind: id,
    drawLayer,
    runtimeBindings,
    coverage: 'exact',
    ...(walkable == null ? {} : {})
  };
}

function productionDecision(id) {
  const legacyAssetId = REMAKE_MAP[id] ?? null;
  return legacyAssetId ? {
    kind: 'remake',
    legacyAssetId,
    reason: `Replaces ${legacyAssetId} with the unified Fable5 projection, scale, lighting, and placement contract.`
  } : {
    kind: 'addition',
    legacyAssetId: null,
    reason: 'Adds a gameplay or world-grammar semantic that has no valid legacy asset.'
  };
}

function usageFor(category, id, spec) {
  if (category === 'ui') {
    const scenes = id.includes('dialogue') || id.includes('choice') || id.includes('speech')
      ? ['dialogue']
      : id.includes('journal') ? ['journal']
        : id.includes('evidence') || id.includes('facility_icons') ? ['evidence'] : ['controls'];
    return { biomes: ['interface'], scenes };
  }
  const biomes = spec.biomes ?? USAGE_BIOMES[id] ?? ALL_WORLD_BIOMES;
  const scenes = category === 'interior' ? ['cutaway']
    : category === 'building' ? ['world', 'cutaway']
      : category === 'character' || category === 'prop' ? ['world', 'cutaway']
        : category === 'structure' ? ['world', 'landmark'] : ['world'];
  return { biomes: [...biomes], scenes };
}

function paletteFor(usage, id) {
  const accents = new Set(['old-stone']);
  if (usage.biomes.includes('harbor')) accents.add('harbor-blue');
  if (usage.biomes.includes('snow')) accents.add('snow-blue');
  if (usage.biomes.includes('woodland')) accents.add('moss-green');
  if (id.includes('warning')) accents.add('warning-red');
  if (id.startsWith('character.')) accents.add('character-contrast');
  if (id.startsWith('ui.')) accents.add('parchment');
  if (id.includes('lamp') || id.includes('glow') || id.startsWith('building.')) accents.add('warm-window');
  return { family: 'fable5-twilight', accents: [...accents] };
}

function silhouetteFor(category, id, spec) {
  if (category === 'character') return `${titleFromId(id)} must be identifiable by role posture, head/hand shape, and the ${spec.workAction} work action at one native frame.`;
  if (category === 'building') return `${titleFromId(id)} keeps its specific roof contour, south entrance rhythm, and facility cue distinct with roof and base viewed separately.`;
  if (category === 'terrain' || category === 'interior') return `${titleFromId(id)} must read from edge language and material clusters without labels or scene context.`;
  if (category === 'structure') return `${titleFromId(id)} must keep a unique traversable-or-obstacle outline at native scale and show its contact with the ground or water.`;
  if (category === 'ui') return `${titleFromId(id)} must remain legible as a diegetic control shape before any DOM text is applied.`;
  return `${titleFromId(id)} must read at native size from its concrete outline, contact shadow, and semantic focal detail.`;
}

function acceptanceFor(category, usage, outputSize, id) {
  const repeated = category === 'terrain' || category === 'interior'
    || (category === 'overlay' && (id.includes('flowers') || id.includes('pebbles')))
    || ['structure.fence', 'structure.wall_stone', 'structure.pier'].includes(id);
  return {
    native: [
      `Exact ${outputSize.width}x${outputSize.height} PNG contract with hard alpha and no enlargement.`,
      'Three-quarter projection, upper-left twilight light, grounded silhouette, and semantic focal detail are readable at 100%.'
    ],
    repeat: repeated ? [
      '3x3 placement has exact compatible seams and does not expose a mechanical repeated motif within two seconds.'
    ] : [
      'Not a repeating surface; verify spacing against two neighboring instances without scale or contact-shadow drift.'
    ],
    ensemble: [
      `Composite at native scale in the ${usage.biomes.join('/')} scene blueprint with matching palette, depth order, occlusion, and contact.`
    ]
  };
}

function commonDefinition(spec, {
  category,
  kind,
  outputSize,
  logicalSpriteSize = outputSize,
  tileSize,
  scaleClass,
  footprint = { widthTiles: 1, heightTiles: 1 },
  pivot = point(Math.floor(outputSize.width / 2), outputSize.height),
  baseline = pivot.y,
  collisionContract = collision(true),
  occlusionRegions = [],
  subjectReferenceId = spec.subjectReferenceId,
  states = [],
  sprites,
  facility,
  walkable,
  tags = []
}) {
  const usage = usageFor(category, spec.id, spec);
  const palette = paletteFor(usage, spec.id);
  const silhouette = silhouetteFor(category, spec.id, spec);
  const acceptance = acceptanceFor(category, usage, outputSize, spec.id);
  return {
    visualContractVersion: 2,
    id: spec.id,
    category,
    displayName: titleFromId(spec.id),
    gameMeaning: spec.meaning,
    required: true,
    promptFiles: [
      'prompts/v2/common/world-style.md',
      'prompts/v2/common/production-boundary.md',
      PROMPTS[category]
    ],
    defaultReferenceIds: category === 'character'
      ? [WORLD_REFERENCE, CHARACTER_REFERENCE]
      : [WORLD_REFERENCE, subjectReferenceId],
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
    ...(sprites ? { sprites } : {}),
    states,
    outputSize,
    placementSpace: PLACEMENT_SPACE,
    perspective: 'three-quarter-overhead',
    lighting: 'upper-left-twilight',
    scaleClass,
    pivot,
    baseline: { edgeY: baseline },
    footprint,
    entrance: null,
    collision: collisionContract,
    occlusion: { unit: 'pixel', regions: occlusionRegions },
    roofMask: null,
    windowAnchors: [],
    inspectionGates: commonGates(),
    productionDecision: productionDecision(spec.id),
    usage,
    palette,
    silhouette,
    variants: usage.biomes.includes('interface') ? ['canonical-interface']
      : usage.biomes.map((biome) => `${biome}-palette`),
    acceptance,
    artDirection: null,
    priority: { requiredSetId: 'fable5-v2', wave: 'A' },
    tags: ['fable5-v2', 'wave-a', category, ...tags],
    constraints: {
      must: ['single 3/4 overhead projection', 'upper-left twilight lighting', 'native-size readability'],
      mustNot: ['baked scene background', 'labels or watermark', 'non-integer enlargement']
    },
    reviewChecklist: ['native contract', 'repeat where applicable', 'ensemble scene blueprint'],
    gameBinding: gameBinding(category, spec.id, { facility, walkable })
  };
}

function autotileContract({ water = false, cliff = false } = {}) {
  return {
    tileSize: 64,
    sheet: { columns: 5, rows: 5 },
    baseVariantIndices: [0, 1, 2],
    blob16: BLOB16,
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
  };
}

function buildTerrain(spec, category = 'terrain') {
  const water = spec.id === 'terrain.water';
  const cliff = spec.id === 'terrain.cliff';
  const definition = commonDefinition(spec, {
    category,
    kind: 'tileset',
    outputSize: size(320, 320),
    logicalSpriteSize: null,
    tileSize: 64,
    scaleClass: category === 'terrain' ? 'terrain' : 'interior',
    pivot: point(32, 64),
    baseline: 64,
    collisionContract: collision(spec.walkable ?? true),
    walkable: spec.walkable,
    sprites: {
      directions: [], frames: FRAME_25,
      grid: { columns: 5, rows: 5, frameWidth: 64, frameHeight: 64 }
    },
    tags: ['autotile', spec.auxiliaryUse ?? spec.profile]
  });
  definition.inspectionGates = commonGates({ seams: water ? [0, 1, 2, 19, 20, 21] : [0, 1, 2] });
  definition.autotileContract = autotileContract({ water, cliff });
  return definition;
}

function buildDecorOverlay(spec) {
  return commonDefinition({
    ...spec,
    meaning: `${titleFromId(spec.id)} is a decorative ground cluster that breaks repetition in ${spec.biomes.join('/')} and carries no evidence state.`
  }, {
    category: 'overlay', kind: 'single', outputSize: size(64, 64), scaleClass: 'overlay_s',
    footprint: { widthTiles: 1, heightTiles: 1 }, collisionContract: collision(true),
    tags: ['decorative-ground', ...(spec.biomes ?? [])]
  });
}

const STRUCTURE_PROFILES = Object.freeze({
  bridge10: { output: [320, 128], frame: [64, 64], grid: [5, 2], frames: ['horizontal', 'horizontal_start', 'horizontal_end', 'horizontal_broken_left', 'horizontal_broken_right', 'vertical', 'vertical_start', 'vertical_end', 'vertical_broken_top', 'vertical_broken_bottom'], footprint: [1, 1] },
  direction4: { output: [256, 64], frame: [64, 64], grid: [4, 1], frames: ['north', 'east', 'south', 'west'], footprint: [1, 1] },
  connect8: { output: [256, 128], frame: [64, 64], grid: [4, 2], frames: ['isolated', 'horizontal', 'vertical', 'corner_ne', 'corner_nw', 'corner_se', 'corner_sw', 'cross'], footprint: [1, 1] },
  'tree-small-layered': { output: [256, 192], frame: [128, 192], grid: [2, 1], frames: ['trunk', 'canopy'], footprint: [1, 1], pivot: [64, 192] },
  'tree-landmark-layered': { output: [512, 256], frame: [256, 256], grid: [2, 1], frames: ['trunk', 'canopy'], footprint: [2, 2], pivot: [128, 256] },
  single64: { output: [64, 64], footprint: [1, 1] },
  single128: { output: [128, 128], footprint: [2, 2] },
  tall64x96: { output: [64, 96], footprint: [1, 1] },
  wide128x64: { output: [128, 64], footprint: [2, 1] },
  single192: { output: [192, 192], footprint: [2, 2] },
  tall64x128: { output: [64, 128], footprint: [1, 1] }
});

function buildStructure(spec) {
  const profile = STRUCTURE_PROFILES[spec.profile];
  if (!profile) throw new Error(`Unknown structure profile: ${spec.profile}`);
  const [width, height] = profile.output;
  const [footWidth, footHeight] = profile.footprint;
  const sprites = profile.grid ? {
    directions: [],
    frames: profile.frames,
    grid: {
      columns: profile.grid[0], rows: profile.grid[1],
      frameWidth: profile.frame[0], frameHeight: profile.frame[1]
    }
  } : undefined;
  return commonDefinition(spec, {
    category: 'structure',
    kind: sprites ? 'spritesheet' : 'single',
    outputSize: size(width, height),
    logicalSpriteSize: sprites ? size(...profile.frame) : size(width, height),
    scaleClass: 'structure',
    footprint: { widthTiles: footWidth, heightTiles: footHeight },
    pivot: point(...(profile.pivot ?? [Math.floor((sprites ? profile.frame[0] : width) / 2), sprites ? profile.frame[1] : height])),
    baseline: profile.pivot?.[1] ?? (sprites ? profile.frame[1] : height),
    collisionContract: collision(spec.walkable, footWidth, footHeight),
    sprites,
    walkable: spec.walkable,
    tags: [spec.profile]
  });
}

function entranceOffset(scaleClass) {
  return { S: 0, M: 1, L: 1, XL: 2, tower: 0, rowhouse_s: 2, rowhouse_l: 3 }[scaleClass];
}

function windowAnchors(count, outputSize) {
  return Array.from({ length: count }, (_, roomIndex) => ({
    id: `room-${roomIndex + 1}`,
    roomIndex,
    x: Math.round(((roomIndex + 1) * outputSize.width) / (count + 1)),
    y: Math.round(outputSize.height * 0.4)
  }));
}

function buildBuilding(spec) {
  const contract = BUILDING_SCALE_CONTRACTS_V2[spec.scaleClass];
  if (!contract) throw new Error(`Unknown building scale class: ${spec.scaleClass}`);
  const outputSize = size(contract.width, contract.height);
  const pivot = point(Math.floor(contract.width / 2), contract.height);
  const offset = entranceOffset(spec.scaleClass);
  const definition = commonDefinition(spec, {
    category: 'building', kind: 'layered-building', outputSize,
    logicalSpriteSize: outputSize, tileSize: 64, scaleClass: spec.scaleClass,
    footprint: { widthTiles: contract.widthTiles, heightTiles: contract.heightTiles },
    pivot, baseline: contract.height,
    collisionContract: buildingCollision(spec.scaleClass, offset),
    occlusionRegions: [{ x: 0, y: Math.max(0, contract.height - 128), width: contract.width, height: Math.min(128, contract.height) }],
    facility: spec.facility,
    states: ['normal', 'cutaway'],
    tags: ['layered-building', `facility-${spec.facility}`]
  });
  definition.entrance = { edge: 'south', offsetTiles: offset, widthTiles: 1 };
  definition.roofMask = { artifact: 'roof', source: 'alpha', threshold: 1 };
  definition.windowAnchors = windowAnchors(spec.windows, outputSize);
  definition.buildingLayerContract = {
    artifacts: [
      { role: 'base', suffix: '.base', outputSize, anchor: pivot },
      { role: 'roof', suffix: '.roof', outputSize, anchor: pivot }
    ],
    atomicPair: true
  };
  return definition;
}

function buildStateOverlay(spec) {
  const contract = BUILDING_SCALE_CONTRACTS_V2[spec.scaleClass];
  const scaleClass = `overlay_${spec.scaleClass.toLowerCase()}`;
  return commonDefinition({
    ...spec,
    meaning: `${titleFromId(spec.id)} visual state overlay for the ${spec.scaleClass} building class; it does not change evidence class.`
  }, {
    category: 'overlay', kind: 'single', outputSize: size(contract.width, contract.height),
    scaleClass, footprint: { widthTiles: contract.widthTiles, heightTiles: contract.heightTiles },
    collisionContract: collision(true), tags: ['building-state', `target-${spec.targetLayer}`]
  });
}

function buildProp(spec) {
  const [width, height] = spec.size;
  const scaleClass = height > 64 ? 'prop_tall' : Math.max(width, height) <= 32 ? 'prop32' : 'prop64';
  return commonDefinition(spec, {
    category: 'prop', kind: 'single', outputSize: size(width, height), scaleClass,
    footprint: { widthTiles: 1, heightTiles: 1 }, collisionContract: collision(false),
    tags: ['functional-prop']
  });
}

function buildCharacter(spec) {
  const definition = commonDefinition(spec, {
    category: 'character', kind: 'spritesheet', outputSize: size(480, 384),
    logicalSpriteSize: size(48, 96), scaleClass: 'character',
    pivot: point(24, 96), baseline: 96,
    collisionContract: collision(true),
    sprites: {
      directions: CHARACTER_DIRECTIONS_V2,
      frames: CHARACTER_FRAMES_V2,
      grid: { columns: 10, rows: 4, frameWidth: 48, frameHeight: 96 }
    },
    tags: [spec.heightClass, `work-${spec.workAction.replaceAll(' ', '-')}`]
  });
  definition.characterSpriteContract = {
    version: 2,
    frame: size(48, 96),
    body: size(40, 80),
    sheet: { width: 480, height: 384, columns: 10, rows: 4 },
    directionRows: CHARACTER_DIRECTIONS_V2,
    frameColumns: CHARACTER_FRAMES_V2,
    animations: { idle: [0, 1], walk: [2, 3, 4, 5], talk: [6, 7], work: [8, 9] },
    footBaseline: 'common',
    resampling: { kernel: 'nearest', downscaleOnly: true, allowEnlargement: false },
    visibleBboxHeight: { class: spec.heightClass, min: spec.heightClass === 'child' ? 48 : 64, max: spec.heightClass === 'child' ? 64 : 80 },
    partialAlphaPixels: 0
  };
  return definition;
}

function buildEffect(spec) {
  const [frameWidth, frameHeight] = spec.frameSize;
  return commonDefinition(spec, {
    category: 'effect', kind: 'spritesheet', outputSize: size(frameWidth * 4, frameHeight),
    logicalSpriteSize: size(frameWidth, frameHeight),
    scaleClass: frameWidth === 64 ? 'effect64' : 'effect32',
    pivot: point(Math.floor(frameWidth / 2), frameHeight), baseline: frameHeight,
    collisionContract: collision(true),
    sprites: {
      directions: [], frames: ['frame_1', 'frame_2', 'frame_3', 'frame_4'],
      grid: { columns: 4, rows: 1, frameWidth, frameHeight }
    },
    states: [`blend-${spec.blend}`, `duration-${spec.durationMs}ms`],
    tags: ['four-frame-loop', spec.blend]
  });
}

function buildUi(spec) {
  const [width, height] = spec.size;
  const sprites = spec.grid ? {
    directions: [], frames: spec.cells,
    grid: { columns: spec.grid[0], rows: spec.grid[1], frameWidth: spec.grid[2], frameHeight: spec.grid[3] }
  } : undefined;
  return commonDefinition({
    ...spec,
    meaning: `Diegetic ${titleFromId(spec.id)} UI art with all readable text supplied by DOM layers.`
  }, {
    category: 'ui', kind: 'ui-sheet', outputSize: size(width, height),
    logicalSpriteSize: sprites ? size(spec.grid[2], spec.grid[3]) : size(width, height),
    scaleClass: 'ui', pivot: point(Math.floor((sprites ? spec.grid[2] : width) / 2), sprites ? spec.grid[3] : height),
    baseline: sprites ? spec.grid[3] : height, collisionContract: collision(true), sprites,
    tags: [spec.profile, ...(spec.insets ? [`insets-${spec.insets.join('-')}`] : []), ...(spec.hotspot ? [`hotspot-${spec.hotspot.join('-')}`] : [])]
  });
}

function flattenFamilies(decisions) {
  return Object.values(decisions.families).flat();
}

export async function readWaveAProductionDecisions({ root = FORGE_ROOT } = {}) {
  const file = path.join(root, 'data', 'v2', 'wave-a-production-decisions.json');
  return JSON.parse(await readFile(file, 'utf8'));
}

const ART_DIRECTION_FILES = Object.freeze([
  'terrain.json',
  'overlays.json',
  'structures.json',
  'buildings.json',
  'interiors.json',
  'props.json',
  'characters.json',
  'effects.json',
  'ui.json'
]);

export async function readWaveAArtDirections({ root = FORGE_ROOT } = {}) {
  const directory = path.join(root, 'data', 'v2', 'art-direction');
  const catalogs = await Promise.all(ART_DIRECTION_FILES.map(async (name) => {
    const catalog = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    const validation = validateWith('art-direction-v2.schema.json', catalog);
    if (!validation.ok) {
      throw new Error(`Invalid Wave A art direction ${name}: ${JSON.stringify(validation.errors)}`);
    }
    if (catalog.assetCount !== catalog.assets.length
      || catalog.assets.some((entry) => entry.category !== catalog.category)) {
      throw new Error(`Wave A art direction count/category mismatch: ${name}`);
    }
    return catalog;
  }));
  const entries = catalogs.flatMap(({ assets }) => assets);
  if (entries.length !== 109 || new Set(entries.map(({ id }) => id)).size !== 109) {
    throw new Error('Wave A art direction must contain exactly 109 unique IDs');
  }
  return entries;
}

export async function readRequiredWavesV2({ root = FORGE_ROOT } = {}) {
  const file = path.join(root, 'data', 'v2', 'waves.json');
  const waves = JSON.parse(await readFile(file, 'utf8'));
  const validation = validateWith('required-waves.schema.json', waves);
  if (!validation.ok) {
    throw new Error(`Invalid Fable5 required waves: ${JSON.stringify(validation.errors)}`);
  }
  for (const wave of waves.waves) {
    if (sha256(canonicalJson(wave.assetIds)) !== wave.assetIdsSha256) {
      throw new Error(`Fable5 Wave ${wave.id} asset id digest mismatch`);
    }
  }
  return waves;
}

export function buildWaveADefinitions(decisions, artDirections) {
  if (!Array.isArray(artDirections)) {
    throw new Error('Wave A canonical art directions are required');
  }
  const directionById = new Map(artDirections.map((entry) => [entry.id, entry]));
  if (directionById.size !== artDirections.length) {
    throw new Error('Wave A canonical art directions contain duplicate IDs');
  }
  const builders = {
    terrain: (spec) => buildTerrain(spec),
    decorOverlays: buildDecorOverlay,
    structures: buildStructure,
    buildings: buildBuilding,
    stateOverlays: buildStateOverlay,
    interiors: (spec) => buildTerrain({ ...spec, walkable: true }, 'interior'),
    props: buildProp,
    characters: buildCharacter,
    effects: buildEffect,
    ui: buildUi
  };
  const definitions = [];
  for (const [family, specs] of Object.entries(decisions.families)) {
    const builder = builders[family];
    if (!builder) throw new Error(`Unknown Wave A family: ${family}`);
    for (const spec of specs) {
      const definition = builder(spec);
      const direction = directionById.get(spec.id);
      if (!direction || direction.category !== definition.category) {
        throw new Error(`Missing or category-mismatched canonical art direction: ${spec.id}`);
      }
      definition.artDirection = structuredClone(direction.artDirection);
      definitions.push(definition);
    }
  }
  if (definitions.length !== directionById.size
    || definitions.some(({ id }) => !directionById.has(id))) {
    throw new Error('Wave A art directions do not exactly match production decisions');
  }
  return definitions;
}

export async function readWaveADefinitions({ root = FORGE_ROOT } = {}) {
  const [decisions, requiredWaves, artDirections] = await Promise.all([
    readWaveAProductionDecisions({ root }),
    readRequiredWavesV2({ root }),
    readWaveAArtDirections({ root })
  ]);
  const wave = requiredWaves.waves.find((entry) => entry.id === 'A');
  if (!wave) throw new Error('Fable5 required waves do not declare Wave A');
  const definitions = buildWaveADefinitions(decisions, artDirections);
  const problems = waveADefinitionProblems(decisions, definitions, wave.assetIds, artDirections);
  if (problems.length > 0) {
    throw new Error(`Invalid Fable5 Wave A definitions: ${problems.join('; ')}`);
  }
  return definitions;
}

export async function findWaveAAsset(assetId, options) {
  const definition = (await readWaveADefinitions(options)).find((entry) => entry.id === assetId);
  if (!definition) throw new Error(`Unknown Fable5 Wave A asset: ${assetId}`);
  return definition;
}

export function waveADefinitionProblems(decisions, definitions, expectedAssetIds, artDirections = []) {
  const problems = [];
  const normalizedDirections = new Map();
  const forbiddenArtDirectionPhrases = [
    /Fable5 Wave A visual asset/i,
    /\brecognizable\b/i,
    /unique roofline/i,
    /placeholder/i,
    /\bTODO\b/i,
    /\bTBD\b/i,
    /asset-specific/i,
    /weathered object material/i,
    /dominant structural material/i,
    /dark joint or binding material/i,
    /effect-specific/i,
    /finished architectural surface/i,
    /recessed joint material/i,
    /warm interior midtone/i,
    /opaque material/i,
    /transparent negative space/i,
    /weathered structural material/i,
    /twilight structural midtone/i,
    /muted biome midtone/i,
    /biome-matched muted midtone/i,
    /muted old-town material tone/i,
    /small functional color cue/i,
    /small upper-left highlight/i,
    /upper-left edge highlight/i,
    /cool attachment shadow/i,
    /restrained upper-left edge light/i,
    /natural ground material/i,
    /fine mineral aggregate/i,
    /a third deliberately different cluster preserving the same material direction/i
  ];
  const decisionIds = flattenFamilies(decisions).map((spec) => spec.id);
  const definitionIds = definitions.map((definition) => definition.id);
  const artDirectionIds = artDirections.map(({ id }) => id);
  if (decisions.assetCount !== 109 || decisionIds.length !== 109 || new Set(decisionIds).size !== 109) {
    problems.push('Wave A production decisions must contain exactly 109 unique IDs');
  }
  if (definitions.length !== 109 || new Set(definitionIds).size !== 109) {
    problems.push('Wave A expansion must produce exactly 109 unique definitions');
  }
  if (artDirectionIds.length !== 109 || new Set(artDirectionIds).size !== 109
    || artDirectionIds.some((id) => !definitionIds.includes(id))) {
    problems.push('Wave A art directions must exactly cover the 109 expanded definitions');
  }
  if (expectedAssetIds && (expectedAssetIds.length !== definitionIds.length
    || expectedAssetIds.some((id) => !definitionIds.includes(id)))) {
    problems.push('Wave A expanded definitions do not match the required wave declaration');
  }
  for (const definition of definitions) {
    const schema = validateWith('asset-definition.schema.json', definition);
    if (!schema.ok) problems.push(`${definition.id}: schema: ${JSON.stringify(schema.errors)}`);
    for (const problem of visualContractV2Problems(definition)) {
      problems.push(`${definition.id}: ${problem}`);
    }
    const direction = definition.artDirection;
    if (!direction) continue;
    const directionText = canonicalJson(direction);
    for (const pattern of forbiddenArtDirectionPhrases) {
      if (pattern.test(directionText)) {
        problems.push(`${definition.id}: art direction contains forbidden placeholder prose ${pattern}`);
      }
    }
    const normalizedDirection = directionText.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ').trim();
    if (normalizedDirections.has(normalizedDirection)) {
      problems.push(`${definition.id}: duplicates art direction for ${normalizedDirections.get(normalizedDirection)}`);
    } else {
      normalizedDirections.set(normalizedDirection, definition.id);
    }
    const expectedFrames = definition.sprites?.frames
      ?? (definition.category === 'building'
        ? definition.buildingLayerContract.artifacts.map(({ role }) => role)
        : ['primary']);
    const actualFrames = direction.frameContent.map(({ frameId }) => frameId);
    if (canonicalJson(actualFrames) !== canonicalJson(expectedFrames)) {
      problems.push(`${definition.id}: art direction frameContent must exactly match its runtime frames`);
    }
    for (const difference of direction.distinguishFrom) {
      if (difference.assetId === definition.id || !definitionIds.includes(difference.assetId)) {
        problems.push(`${definition.id}: distinguishFrom must name another Wave A asset`);
      }
    }
    if (definition.category === 'terrain' || definition.category === 'interior') {
      const content = direction.terrainContent;
      const expectedBase = definition.autotileContract.baseVariantIndices.map((index) => `tile_${index}`);
      const expectedBlob = definition.autotileContract.blob16.map(({ mask, tileIndex }) => ({
        frameId: `tile_${tileIndex}`, mask
      }));
      const expectedAux = definition.autotileContract.auxiliaryTileIndices.map((index, position) => ({
        frameId: `tile_${index}`,
        role: definition.autotileContract.auxiliaryRoles[position]
      }));
      if (!content
        || canonicalJson(content.baseVariants.map(({ frameId }) => frameId)) !== canonicalJson(expectedBase)
        || canonicalJson(content.blob16.map(({ frameId, mask }) => ({ frameId, mask }))) !== canonicalJson(expectedBlob)
        || canonicalJson(content.auxiliary.map(({ frameId, role }) => ({ frameId, role }))) !== canonicalJson(expectedAux)) {
        problems.push(`${definition.id}: terrain art direction must exactly cover base3, blob16, and aux6 roles`);
      }
    }
    if (definition.category === 'building'
      && canonicalJson(direction.layerContent?.layers.map(({ role }) => role)) !== canonicalJson(['base', 'roof'])) {
      problems.push(`${definition.id}: building art direction must declare ordered base/roof content`);
    }
    if (definition.category === 'character') {
      const actions = Object.keys(direction.characterContent?.actionContent ?? {});
      if (canonicalJson(actions) !== canonicalJson(['idle', 'walk', 'talk', 'work'])) {
        problems.push(`${definition.id}: character art direction must declare idle/walk/talk/work content`);
      }
      const directionConsistency = direction.characterContent?.directionConsistency ?? '';
      if (!(/front.*back.*left.*right/i.test(directionConsistency)
        || /(?:all )?four (?:direction rows|directions|rows)/i.test(directionConsistency)
        || /across four rows/i.test(directionConsistency))) {
        problems.push(`${definition.id}: character art direction must bind all four direction rows`);
      }
    }
    if (definition.category === 'ui'
      && canonicalJson(direction.uiContent?.cells ?? []) !== canonicalJson(direction.frameContent)) {
      problems.push(`${definition.id}: UI art direction cells must exactly match frameContent`);
    }
  }
  return problems;
}
