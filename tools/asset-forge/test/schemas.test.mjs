import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compiledSchemaNames, validateWith } from '../src/schemas.mjs';
import { validateRepository } from '../src/validate.mjs';

test('all tracked schemas compile under strict draft-07 Ajv', () => {
  assert.equal(compiledSchemaNames.includes('approval-manifest.schema.json'), true);
  assert.equal(compiledSchemaNames.includes('game-export.schema.json'), true);
  assert.equal(compiledSchemaNames.length >= 12, true);
});

test('the complete tracked catalog and manifests validate', async () => {
  assert.deepEqual(await validateRepository(), { ok: true, assetCount: 110, requiredAssetCount: 78, issues: [] });
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
    'field.snow',
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
