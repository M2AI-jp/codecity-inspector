import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compiledSchemaNames, validateWith } from '../src/schemas.mjs';
import { validateRepository } from '../src/validate.mjs';
import { buildWaveAJob } from '../src/v2/build-job.mjs';

test('all tracked schemas compile under strict draft-07 Ajv', () => {
  assert.equal(compiledSchemaNames.includes('approval-manifest.schema.json'), true);
  assert.equal(compiledSchemaNames.includes('game-export.schema.json'), true);
  assert.equal(compiledSchemaNames.length >= 12, true);
});

test('the complete tracked catalog and manifests validate', async () => {
  assert.deepEqual(await validateRepository(), { ok: true, assetCount: 110, requiredAssetCount: 78, issues: [] });
});

test('the production field scope swaps optional sand for required snow without changing the 78 gate', async () => {
  const file = new URL('../data/asset-definitions/fields.json', import.meta.url);
  const catalog = JSON.parse(await readFile(file, 'utf8'));
  const snow = catalog.assets.find((asset) => asset.id === 'field.snow');
  const sand = catalog.assets.find((asset) => asset.id === 'field.sand');
  assert.equal(snow.required, true);
  assert.equal(snow.gameBinding.coverage, 'exact');
  assert.deepEqual(snow.defaultReferenceIds, [
    'world_visual_master', 'intake_20260713_field_stairs_bridges_cliffs'
  ]);
  assert.equal(sand.required, false);
  assert.equal(sand.gameBinding.coverage, 'future');
});

test('all eight UI assets remain catalogued as optional future enhancements', async () => {
  const file = new URL('../data/asset-definitions/ui.json', import.meta.url);
  const catalog = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(catalog.assets.length, 8);
  assert.equal(catalog.assets.every((asset) => asset.id.startsWith('ui.')), true);
  assert.equal(catalog.assets.every((asset) => asset.required === false), true);
  assert.equal(catalog.assets.every((asset) => asset.gameMeaning.includes('Optional future UI enhancement')), true);
});

test('the exact future catalog is split into three connected requirements and 24 optional enhancements', async () => {
  const files = ['characters', 'effects', 'fields', 'objects'];
  const catalogs = await Promise.all(files.map(async (name) => JSON.parse(await readFile(
    new URL(`../data/asset-definitions/${name}.json`, import.meta.url), 'utf8'
  ))));
  const futureAssets = catalogs.flatMap((catalog) => catalog.assets)
    .filter((asset) => asset.gameBinding.coverage === 'future');
  const requiredIds = futureAssets.filter((asset) => asset.required).map((asset) => asset.id).sort();
  const optionalAssets = futureAssets.filter((asset) => !asset.required);
  const optionalIds = optionalAssets.map((asset) => asset.id).sort();
  assert.deepEqual(requiredIds, [
    'character.player',
    'effect.construction_dust',
    'effect.water_ripple'
  ]);
  assert.deepEqual(optionalIds, [
    'character.external_contractor_agent',
    'character.llm_bard',
    'character.llm_counselor',
    'character.llm_librarian',
    'character.mail_carrier',
    'character.treasurer',
    'effect.lantern_light',
    'effect.resident_walk_marker',
    'effect.ship_departure',
    'effect.warning_flash',
    'effect.window_light',
    'field.sand',
    'object.cart',
    'object.firewood',
    'object.guild_roster_stand',
    'object.harbor_cargo',
    'object.inspection_table',
    'object.ledger',
    'object.menu_board',
    'object.rope',
    'object.smoke_black',
    'object.smoke_white',
    'object.snow_pile',
    'object.tool_table'
  ]);
  assert.equal(optionalAssets.every((asset) => /^Optional (?:contextual )?future enhancement/.test(asset.gameMeaning)), true);
});

test('context-only prop contracts stay bound but optional until their layout contexts exist', async () => {
  const file = new URL('../data/asset-definitions/objects.json', import.meta.url);
  const catalog = JSON.parse(await readFile(file, 'utf8'));
  const expected = new Map([
    ['object.harbor_cargo', { vocabulary: 'PROP_KINDS', id: 'crate' }],
    ['object.guild_roster_stand', { vocabulary: 'PROP_KINDS', id: 'signboard' }],
    ['object.menu_board', { vocabulary: 'PROP_KINDS', id: 'signboard' }]
  ]);
  for (const [assetId, binding] of expected) {
    const asset = catalog.assets.find(({ id }) => id === assetId);
    assert.equal(asset.required, false);
    assert.equal(asset.gameBinding.coverage, 'future');
    assert.deepEqual(asset.gameBinding.runtimeBindings, [binding]);
    assert.match(asset.gameMeaning, /^Optional contextual future enhancement/);
  }
});

test('runtime coverage records each deterministic traveler and prop variant family', async () => {
  const file = new URL('../data/manifests/runtime-coverage.json', import.meta.url);
  const coverage = JSON.parse(await readFile(file, 'utf8'));
  const families = new Map(coverage.lossyMappings.map((entry) => [
    `${entry.vocabulary}\0${entry.runtimeId}`,
    entry
  ]));
  const expected = new Map([
    ['NPC_ROLES\0traveler', ['character.mob.traveler', 'character.mob.delivery_person']],
    ['PROP_KINDS\0crate', ['object.crate', 'object.stacked_crates', 'object.harbor_cargo']],
    ['PROP_KINDS\0lamp', ['object.lamp', 'object.streetlight']],
    ['PROP_KINDS\0signboard', [
      'object.signboard', 'object.notice_board', 'object.guild_roster_stand', 'object.menu_board'
    ]]
  ]);
  for (const [key, assetIds] of expected) {
    assert.deepEqual(families.get(key)?.assetIds, assetIds);
    assert.match(families.get(key)?.note ?? '', /deterministic selection/i);
  }
  assert.match(families.get('PROP_KINDS\0crate').note, /object\.harbor_cargo.*optional contextual future/i);
  assert.match(
    families.get('PROP_KINDS\0signboard').note,
    /object\.guild_roster_stand.*object\.menu_board.*optional contextual future/i
  );
});

test('invalid definitions are rejected', () => {
  const result = validateWith('asset-definition.schema.json', { category: 'wrong' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('generation lifecycle states reject contradictory fields', () => {
  const pending = {
    id: 'gen_fixture', jobId: 'job_fixture', assetId: 'field.grass', category: 'field',
    status: 'pending', provider: 'mock', outputPath: 'generated/fields/pending/fixture.png',
    outputSha256: 'a'.repeat(64), metadataPath: 'generated/fields/pending/fixture.json',
    promptHash: 'b'.repeat(64), provenanceKey: 'c'.repeat(64), referenceImageIds: [],
    referenceImageHashes: [], dryRun: false, subscriptionRun: false, manualImport: false,
    outputInspection: { format: 'png', width: 1, height: 1, channels: 4, frames: 1, bytes: 68 },
    warnings: [], createdAt: '2026-07-13T00:00:00.000Z',
    inspection: { status: 'pending-inspection', observed: [], inferred: [], unknown: ['human approval'] }
  };
  assert.equal(validateWith('generation-result.schema.json', pending).ok, true);
  assert.equal(validateWith('generation-result.schema.json', {
    ...pending,
    approval: {
      reviewer: 'human', note: 'contradiction', approvedAt: '2026-07-13T00:00:00.000Z',
      approvedPath: 'generated/fields/approved/fixture.png', approvedSha256: 'a'.repeat(64)
    }
  }).ok, false);
  assert.equal(validateWith('generation-result.schema.json', { ...pending, status: 'failed', error: 'failed' }).ok, false);
});

test('provider-key-normalize-v1 schema is opt-in only for character monolithic jobs', async () => {
  const { job } = await buildWaveAJob({
    assetId: 'character.player',
    generationMode: 'monolithic-atlas',
    providerKeyNormalization: 'provider-key-normalize-v1'
  });
  assert.equal(validateWith('generation-job-v2.schema.json', job).ok, true);
  const wrongCategory = structuredClone(job);
  wrongCategory.category = 'terrain';
  assert.equal(validateWith('generation-job-v2.schema.json', wrongCategory).ok, false);
  const missingAuthority = structuredClone(job);
  delete missingAuthority.providerKeyNormalizationPlan;
  assert.equal(validateWith('generation-job-v2.schema.json', missingAuthority).ok, false);
  const missingIdentityBinding = structuredClone(job);
  delete missingIdentityBinding.identityMasterPlan.providerKeyNormalizationPlan;
  assert.equal(validateWith('generation-job-v2.schema.json', missingIdentityBinding).ok, false);
  const unknownConfigField = structuredClone(job);
  unknownConfigField.providerKeyNormalizationPlan.radius = 13;
  assert.equal(validateWith('generation-job-v2.schema.json', unknownConfigField).ok, false);
});

test('character-atlas-layout-v1 schema is exact and opt-in only for character monolithic jobs', async () => {
  const { job } = await buildWaveAJob({
    assetId: 'character.player',
    generationMode: 'monolithic-atlas',
    characterAtlasLayout: 'character-atlas-layout-v1'
  });
  assert.equal(validateWith('generation-job-v2.schema.json', job).ok, true);
  const wrongCategory = structuredClone(job);
  wrongCategory.category = 'terrain';
  assert.equal(validateWith('generation-job-v2.schema.json', wrongCategory).ok, false);
  const wrongMode = structuredClone(job);
  wrongMode.generationMode = 'per-unit';
  assert.equal(validateWith('generation-job-v2.schema.json', wrongMode).ok, false);
  const wrongConfigSha = structuredClone(job);
  wrongConfigSha.characterAtlasLayoutPlan.configSha256 = '0'.repeat(64);
  assert.equal(validateWith('generation-job-v2.schema.json', wrongConfigSha).ok, false);
  const unknownConfigField = structuredClone(job);
  unknownConfigField.characterAtlasLayoutPlan.directionStripMode = true;
  assert.equal(validateWith('generation-job-v2.schema.json', unknownConfigField).ok, false);
});
