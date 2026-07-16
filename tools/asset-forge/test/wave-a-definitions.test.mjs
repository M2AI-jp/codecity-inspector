import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { canonicalJson, sha256 } from '../src/hashing.mjs';
import { validateWith } from '../src/schemas.mjs';
import { assetSpecificPrompt, definitionBindingSha256 } from '../src/v2/build-job.mjs';
import {
  buildWaveADefinitions,
  findWaveAAsset,
  readRequiredWavesV2,
  readWaveAArtDirections,
  readWaveADefinitions,
  readWaveAProductionDecisions,
  waveADefinitionProblems
} from '../src/v2/definition-builder.mjs';

const decisions = await readWaveAProductionDecisions();
const artDirections = await readWaveAArtDirections();
const waves = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'v2', 'waves.json'), 'utf8'));
const waveA = waves.waves.find((wave) => wave.id === 'A');
const definitions = buildWaveADefinitions(decisions, artDirections);

const FORBIDDEN_ART_DIRECTION_PROSE = [
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

function allStrings(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => allStrings(entry, result));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => allStrings(entry, result));
  }
  return result;
}

test('Wave A expands to 109 schema-valid and cross-field-valid v2 definitions', () => {
  assert.deepEqual(waveADefinitionProblems(
    decisions, definitions, waveA.assetIds, artDirections
  ), []);
  assert.equal(definitions.length, 109);
  assert.equal(new Set(definitions.map((definition) => definition.id)).size, 109);
  assert.equal(definitions.filter((definition) => definition.required).length, 109);
  assert.equal(definitions.filter((definition) => definition.visualContractVersion === 2).length, 109);
});

test('all 109 human-facing asset prompts serialize placement space without object-coercion garbage', () => {
  for (const definition of definitions) {
    const prompt = assetSpecificPrompt(definition);
    assert.match(
      prompt,
      /Placement space: pixels=pixel-edges-top-left; tiles=tile-edges-north-west/,
      definition.id
    );
    assert.doesNotMatch(prompt, /\[object (?:Object|Array)\]|\bundefined\b|\bNaN\b/, definition.id);
  }
});

test('Wave A keeps 128 PNGs, 771 declared slots, 63 transparent reservations, and 708 semantic cells canonical', () => {
  const counts = Object.fromEntries([...new Set(definitions.map((definition) => definition.category))]
    .map((category) => [category, definitions.filter((definition) => definition.category === category).length]));
  assert.deepEqual(counts, {
    terrain: 9,
    overlay: 17,
    structure: 20,
    building: 19,
    interior: 3,
    prop: 18,
    character: 7,
    effect: 4,
    ui: 12
  });
  const artifactCount = definitions.reduce((sum, definition) => sum
    + (definition.buildingLayerContract?.artifacts.length ?? 1), 0);
  assert.equal(artifactCount, 128);
  assert.equal(decisions.minimumOutputPngCount, 128);
  const logicalCellCount = definitions.reduce((sum, definition) => {
    const cellsPerArtifact = definition.sprites?.grid
      ? definition.sprites.grid.columns * definition.sprites.grid.rows
      : 1;
    return sum + cellsPerArtifact * (definition.buildingLayerContract?.artifacts.length ?? 1);
  }, 0);
  assert.equal(logicalCellCount, 771);
  const transparentReservedCellCount = definitions.reduce((sum, definition) => sum
    + (definition.autotileContract?.auxiliaryRoles ?? [])
      .filter((role) => role.startsWith('transparent-reserved-')).length
      * (definition.buildingLayerContract?.artifacts.length ?? 1), 0);
  assert.equal(transparentReservedCellCount, 63);
  assert.equal(logicalCellCount - transparentReservedCellCount, 708);
  const blobMaskZeroCellCount = definitions.filter((definition) => (
    definition.autotileContract?.blob16.some(({ mask }) => mask === 0)
  )).length;
  assert.equal(blobMaskZeroCellCount, 12);
  const expectedTransparentCellCount = transparentReservedCellCount + blobMaskZeroCellCount;
  assert.equal(expectedTransparentCellCount, 75);
  assert.equal(logicalCellCount - expectedTransparentCellCount, 696);
  assert.deepEqual({
    remake: definitions.filter(({ productionDecision }) => productionDecision.kind === 'remake').length,
    addition: definitions.filter(({ productionDecision }) => productionDecision.kind === 'addition').length
  }, { remake: 45, addition: 64 });
});

test('109 canonical art briefs are concrete, unique, related, and definition-hash-bound', () => {
  assert.equal(artDirections.length, 109);
  const ids = new Set(definitions.map(({ id }) => id));
  const normalizedBriefs = new Set();
  for (const definition of definitions) {
    const direction = definition.artDirection;
    assert.equal(direction.version, 2, definition.id);
    assert.equal(direction.subjectForm.length >= 12, true, definition.id);
    assert.equal(direction.materials.length > 0, true, definition.id);
    assert.equal(direction.dominantColors.length > 0, true, definition.id);
    assert.equal(direction.accentColors.length > 0, true, definition.id);
    assert.equal(direction.distinguishingFeatures.length >= 2, true, definition.id);
    assert.equal(direction.negativeConstraints.length >= 2, true, definition.id);
    const text = canonicalJson(direction);
    for (const value of allStrings(direction)) {
      for (const pattern of FORBIDDEN_ART_DIRECTION_PROSE) {
        assert.equal(pattern.test(value), false, `${definition.id}: ${pattern}: ${value}`);
      }
    }
    const normalized = text.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ').trim();
    assert.equal(normalizedBriefs.has(normalized), false, definition.id);
    normalizedBriefs.add(normalized);
    for (const relation of direction.distinguishFrom) {
      assert.notEqual(relation.assetId, definition.id, definition.id);
      assert.equal(ids.has(relation.assetId), true, definition.id);
      assert.equal(relation.reason.length >= 12, true, definition.id);
    }
    const before = definitionBindingSha256(definition, 'a'.repeat(64));
    const mutated = structuredClone(definition);
    mutated.artDirection.subjectForm += ' changed';
    assert.notEqual(definitionBindingSha256(mutated, 'a'.repeat(64)), before, definition.id);
  }
  assert.equal(normalizedBriefs.size, 109);
});

test('art brief frame and specialized content exactly covers runtime cells and artifact roles', () => {
  for (const definition of definitions) {
    const expectedFrames = definition.sprites?.frames
      ?? (definition.category === 'building'
        ? definition.buildingLayerContract.artifacts.map(({ role }) => role)
        : ['primary']);
    assert.deepEqual(
      definition.artDirection.frameContent.map(({ frameId }) => frameId),
      expectedFrames,
      definition.id
    );
    assert.equal(
      new Set(definition.artDirection.frameContent.map(({ frameId }) => frameId)).size,
      definition.artDirection.frameContent.length,
      `${definition.id}: duplicate frameId`
    );
    if (definition.category === 'terrain' || definition.category === 'interior') {
      const content = definition.artDirection.terrainContent;
      assert.deepEqual(content.baseVariants.map(({ frameId }) => frameId), ['tile_0', 'tile_1', 'tile_2'], definition.id);
      assert.deepEqual(content.blob16.map(({ mask }) => mask), Array.from({ length: 16 }, (_, mask) => mask), definition.id);
      assert.deepEqual(
        content.auxiliary.map(({ role }) => role),
        definition.autotileContract.auxiliaryRoles,
        definition.id
      );
      const third = content.baseVariants[2];
      assert.equal(third.frameId, 'tile_2', definition.id);
      assert.equal(
        /a third deliberately different cluster preserving the same material direction/i
          .test(third.visualContent),
        false,
        definition.id
      );
    }
    if (definition.category === 'building') {
      assert.deepEqual(
        definition.artDirection.layerContent.layers.map(({ role }) => role),
        ['base', 'roof'],
        definition.id
      );
    }
    if (definition.category === 'character') {
      assert.deepEqual(
        Object.keys(definition.artDirection.characterContent.actionContent),
        ['idle', 'walk', 'talk', 'work'],
        definition.id
      );
      assert.match(
        definition.artDirection.characterContent.directionConsistency,
        /front.*back.*left.*right|(?:all )?four (?:direction rows|directions|rows)|across four rows/i,
        definition.id
      );
    }
    if (definition.category === 'ui') {
      assert.equal(definition.artDirection.uiContent.textFree, true, definition.id);
      assert.deepEqual(definition.artDirection.uiContent.cells, definition.artDirection.frameContent, definition.id);
    }
  }
});

test('effect middle frames declare distinct measurable motion instead of generic phase filler', () => {
  const requiredDetails = {
    'effect.water_ripple': [/(12-pixel-wide|12 pixel wide).*two continuous side arcs/i, /(22-pixel-wide|22 pixel wide).*four dim cyan arc fragments.*two violet fragments/i],
    'effect.construction_dust': [/two touching ochre lobes.*six and eight pixels.*three umber grains/i, /four-pixel transparent gap.*five cool-gray settling specks/i],
    'effect.window_glow': [/14-by-20-pixel.*one-pixel deep-orange.*eight-by-twelve/i, /14-by-20.*eight-by-twelve.*two-pixel bright-amber ring/i],
    'effect.discovery_glint': [/three-by-three ivory diamond.*six pixels up.*four right.*three down.*five left/i, /single white center pixel.*contracts every ray by two pixels.*upper and left rays only/i]
  };
  for (const definition of definitions.filter(({ category }) => category === 'effect')) {
    const middle = definition.artDirection.frameContent.slice(1, 3)
      .map(({ visualContent }) => visualContent);
    assert.equal(middle.length, 2, definition.id);
    assert.notEqual(middle[0], middle[1], `${definition.id}: frame_2/frame_3 must differ`);
    for (const content of middle) {
      assert.doesNotMatch(content, /phase [23] of four advances with hard pixel clusters/i, definition.id);
    }
    for (const [index, pattern] of requiredDetails[definition.id].entries()) {
      assert.match(middle[index], pattern, `${definition.id}: frame_${index + 2}`);
    }
  }
});

test('v2 definitions require game-ready transparent untrimmed PNG output', () => {
  for (const definition of definitions) {
    assert.deepEqual({
      preferredFormat: definition.output.preferredFormat,
      background: definition.output.background,
      needsTransparency: definition.output.needsTransparency,
      needsTrim: definition.output.needsTrim
    }, {
      preferredFormat: 'png',
      background: 'transparent',
      needsTransparency: true,
      needsTrim: false
    }, definition.id);
  }
  const canonical = definitions.find(({ id }) => id === 'terrain.grass');
  for (const [field, invalid] of [
    ['preferredFormat', 'jpg'],
    ['background', 'scene'],
    ['needsTransparency', false],
    ['needsTrim', true]
  ]) {
    const changed = structuredClone(canonical);
    changed.output[field] = invalid;
    assert.equal(
      validateWith('asset-definition.schema.json', changed).ok,
      false,
      `v2 output mutation must fail: ${field}`
    );
  }
});

test('prop.lamp production authority contains the detailed wrought-iron amber pedestal brief', () => {
  const lamp = definitions.find(({ id }) => id === 'prop.lamp');
  const text = canonicalJson(lamp.artDirection);
  for (const required of ['wrought-iron', 'stone-and-iron pedestal', 'amber', 'tight dark', 'ellipse']) {
    assert.match(text, new RegExp(required, 'i'));
  }
  const promptText = assetSpecificPrompt(lamp);
  assert.equal(definitionBindingSha256(lamp, sha256(promptText)), sha256(canonicalJson(lamp)));
  assert.match(promptText, /"artDirection"/);
  assert.match(promptText, /wrought-iron/);
  assert.match(promptText, /#FF00FF/);
});

test('every Wave A definition carries the complete production, usage, visual identity, and acceptance decision', () => {
  for (const definition of definitions) {
    assert.equal(definition.priority.requiredSetId, 'fable5-v2', definition.id);
    assert.equal(definition.priority.wave, 'A', definition.id);
    assert.equal(definition.usage.biomes.length > 0, true, definition.id);
    assert.equal(definition.usage.scenes.length > 0, true, definition.id);
    assert.equal(definition.palette.family, 'fable5-twilight', definition.id);
    assert.equal(definition.silhouette.length > 20, true, definition.id);
    assert.equal(definition.variants.length > 0, true, definition.id);
    assert.equal(definition.acceptance.native.length > 0, true, definition.id);
    assert.equal(definition.acceptance.repeat.length > 0, true, definition.id);
    assert.equal(definition.acceptance.ensemble.length > 0, true, definition.id);
    assert.equal(definition.gameBinding.coverage, 'exact', definition.id);
    assert.equal(definition.gameBinding.runtimeBindings.some(({ vocabulary, id }) => (
      vocabulary === 'WORLDPLAN_ASSET_IDS' && id === definition.id
    )), true, definition.id);
  }
  assert.equal(definitions.find(({ id }) => id === 'character.player').gameBinding.rendererCategory, 'player');
});

test('every Wave A definition names existing v2 prompt files and a two-layer reference set', async () => {
  for (const definition of definitions) {
    assert.equal(definition.promptFiles.length, 3, definition.id);
    for (const prompt of definition.promptFiles) await access(path.join(FORGE_ROOT, prompt));
    assert.equal(definition.defaultReferenceIds[0], 'world_visual_master', definition.id);
    assert.equal(definition.defaultReferenceIds.length, 2, definition.id);
  }
});

test('building and character production decisions preserve the non-negotiable Fable5 contracts', () => {
  const buildings = definitions.filter((definition) => definition.category === 'building');
  assert.equal(buildings.length, 19);
  for (const building of buildings) {
    assert.deepEqual(building.buildingLayerContract.artifacts.map((artifact) => artifact.role), ['base', 'roof']);
    assert.equal(building.buildingLayerContract.atomicPair, true);
    assert.equal(building.entrance.edge, 'south');
    const entranceCenter = building.entrance.offsetTiles + building.entrance.widthTiles / 2;
    const doorwayY = building.footprint.heightTiles - 0.01;
    const doorwayBlocked = building.collision.polygons.some(({ points }) => {
      const xs = points.map(({ x }) => x);
      const ys = points.map(({ y }) => y);
      return entranceCenter >= Math.min(...xs) && entranceCenter <= Math.max(...xs)
        && doorwayY >= Math.min(...ys) && doorwayY <= Math.max(...ys);
    });
    assert.equal(doorwayBlocked, false, `${building.id} collision blocks its visible entrance`);
  }
  const characters = definitions.filter((definition) => definition.category === 'character');
  for (const character of characters) {
    assert.deepEqual(character.outputSize, { width: 480, height: 384 });
    assert.deepEqual(character.sprites.grid, { columns: 10, rows: 4, frameWidth: 48, frameHeight: 96 });
    assert.equal(character.sprites.frames.length, 10);
    assert.equal(character.sprites.directions.length, 4);
  }
});

test('the production loader fails closed through the wave declaration and resolves v2 assets explicitly', async () => {
  const [requiredWaves, loadedDefinitions, inn] = await Promise.all([
    readRequiredWavesV2(),
    readWaveADefinitions(),
    findWaveAAsset('building.inn')
  ]);
  assert.equal(requiredWaves.requiredSetId, 'fable5-v2');
  assert.equal(requiredWaves.waves.find((wave) => wave.id === 'A').requiredAssetCount, 109);
  assert.equal(loadedDefinitions.length, 109);
  assert.equal(inn.visualContractVersion, 2);
  assert.equal(inn.output.kind, 'layered-building');
  await assert.rejects(() => findWaveAAsset('building.not_real'), /Unknown Fable5 Wave A asset/);
});
