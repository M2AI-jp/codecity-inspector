import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { exportApproved } from '../src/export/export-approved.mjs';
import { sha256 } from '../src/hashing.mjs';
import { promotionPreview, promoteCandidate, rejectCandidate } from '../src/jobs/lifecycle.mjs';
import { runJob } from '../src/jobs/run-job.mjs';
import { validateWith } from '../src/schemas.mjs';
import { writeJobPack } from '../src/jobs/write-job-pack.mjs';
import { createMockPng } from '../src/providers/mock-provider.mjs';

async function forgeInputsWithReference() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-pack-inputs-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'prompts'), path.join(root, 'prompts'), { recursive: true });
  const bytes = createMockPng({ assetId: 'reference', outputContract: { width: 8, height: 8 } });
  const referencePath = path.join(root, 'references', 'approved', 'character_style_master.png');
  await mkdir(path.dirname(referencePath), { recursive: true });
  await writeFile(referencePath, bytes);
  const manifestPath = path.join(root, 'data', 'manifests', 'references.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const reference = manifest.references.find((entry) => entry.id === 'character_style_master');
  reference.status = 'approved';
  reference.sha256 = sha256(bytes);
  reference.licenseNote = 'original local test fixture';
  await writeFile(manifestPath, JSON.stringify(manifest));
  return root;
}

function resetAssetManifestToMissing(manifest) {
  for (const asset of manifest.assets) {
    asset.status = 'missing';
    asset.pendingGenerationIds = [];
    asset.rejectedGenerationIds = [];
    asset.lastUpdated = null;
    delete asset.approvedPath;
    delete asset.exportPath;
  }
  return manifest;
}

test('job pack is self-contained and does not generate or approve an image', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-pack-state-'));
  const forgeRoot = await forgeInputsWithReference();
  const packed = await writeJobPack({ assetId: 'character.player' }, { root, forgeRoot, now: () => '2026-07-13T00:00:00.000Z' });
  assert.equal(packed.status, 'job-pack');
  assert.equal(packed.result.status, 'job-pack');
  assert.equal(packed.approvedTreeSha256Before, packed.approvedTreeSha256After);
  assert.match(await readFile(path.join(root, packed.pack.importCommandPath), 'utf8'), /manual|npm run import/);
  assert.equal(packed.pack.referenceIds.includes('character_style_master'), true);
});

test('reject copies a pending candidate without changing approved state; promote refuses automation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-lifecycle-'));
  const generated = await runJob({ assetId: 'field.grass', provider: 'mock' }, { root, now: () => '2026-07-13T00:00:00.000Z' });
  const preview = await promotionPreview({ generationId: generated.result.id }, { root });
  assert.equal(preview.sourceSha256, generated.result.outputSha256);
  await assert.rejects(() => promoteCandidate({
    generationId: generated.result.id, reviewer: 'human', note: 'looks good', write: true,
    confirmed: true,
    expectedSourceSha256: preview.sourceSha256,
    expectedApprovedPath: preview.approvedPath
  }, { root }), /interactive human/);
  await assert.rejects(() => access(path.join(root, preview.approvedPath)), /ENOENT/);
  const rejected = await rejectCandidate({ generationId: generated.result.id, reason: 'fixture rejection' }, { root });
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.result.outputPath, /^generated\/fields\/rejected\//);
  const resumed = await rejectCandidate({ generationId: generated.result.id, reason: 'fixture rejection' }, { root });
  assert.equal(resumed.resumed, true);
  await assert.rejects(
    () => rejectCandidate({ generationId: generated.result.id, reason: 'different reason' }, { root }),
    /original reason/
  );
  await assert.rejects(() => promotionPreview({ generationId: generated.result.id }, { root }), /Only a pending/);
});

test('game export schema keeps the exact v1 shape and requires a strict v2 missing-asset inventory', () => {
  const base = {
    generatedAt: '2026-07-13T00:00:00.000Z', complete: true, assets: [], missingBindings: []
  };
  const v1 = { schemaVersion: 1, ...base };
  const v2 = { schemaVersion: 2, ...base, missingAssets: [] };
  assert.equal(validateWith('game-export.schema.json', v1).ok, true);
  assert.equal(validateWith('game-export.schema.json', v2).ok, true);
  assert.equal(validateWith('game-export.schema.json', { ...v1, missingAssets: [] }).ok, false);
  const { missingAssets: _missingAssets, ...v2WithoutMissingAssets } = v2;
  assert.equal(validateWith('game-export.schema.json', v2WithoutMissingAssets).ok, false);
  assert.equal(validateWith('game-export.schema.json', { ...v2, missingAssets: ['invalid-id'] }).ok, false);
  assert.equal(validateWith('game-export.schema.json', {
    ...v2, missingAssets: ['effect.water_ripple', 'effect.water_ripple']
  }).ok, false);
});

test('approved-only export verifies ledger hashes and never includes pending assets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-export-state-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const bytes = createMockPng({ assetId: 'approved-player', outputContract: { width: 80, height: 96 } });
  const approvedRelative = 'generated/characters/approved/character_player-test.png';
  const approvedPath = path.join(root, approvedRelative);
  await mkdir(path.dirname(approvedPath), { recursive: true });
  await writeFile(approvedPath, bytes);
  const hash = sha256(bytes);
  const assetsPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assets = resetAssetManifestToMissing(JSON.parse(await readFile(assetsPath, 'utf8')));
  const player = assets.assets.find((entry) => entry.assetId === 'character.player');
  player.status = 'approved'; player.approvedPath = approvedRelative; player.lastUpdated = '2026-07-13T00:00:00.000Z';
  await writeFile(assetsPath, JSON.stringify(assets));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: [{
      generationId: 'gen_human', assetId: 'character.player', reviewer: 'human', note: 'test fixture',
      approvedAt: '2026-07-13T00:00:00.000Z', sourcePath: 'generated/characters/pending/source.png',
      sourceSha256: hash, approvedPath: approvedRelative, approvedSha256: hash
    }]
  }));
  const publicRoot = path.join(root, 'public');
  const dry = await exportApproved({ publicRoot }, { root, forgeRoot: FORGE_ROOT });
  assert.equal(dry.status, 'dry-run');
  assert.equal(dry.manifest.schemaVersion, 2);
  assert.deepEqual(dry.manifest.assets.map(({ assetId }) => assetId), ['character.player']);
  assert.deepEqual(dry.manifest.assets[0].renderSpec, {
    kind: 'spritesheet',
    logicalSize: { width: 20, height: 32 },
    tileSize: null,
    nearestNeighbor: true,
    allowAntiAlias: false,
    sprites: {
      directions: ['front', 'back', 'left', 'right'],
      frames: ['idle', 'walk_1', 'walk_2'],
      grid: { columns: 4, rows: 3, frameWidth: 20, frameHeight: 32 },
      directionAxis: 'column',
      frameAxis: 'row'
    },
    states: [],
    variantTags: ['character', 'player']
  });
  assert.equal(dry.manifest.complete, false);
  assert.equal(dry.manifest.missingBindings.some(({ vocabulary, runtimeId }) => vocabulary === 'TILE_TYPES' && runtimeId === 'grass'), true);
  assert.equal(dry.manifest.missingAssets.length, 77);
  assert.deepEqual(dry.manifest.missingAssets,
    [...dry.manifest.missingAssets].sort((left, right) => left.localeCompare(right)));
  assert.equal(new Set(dry.manifest.missingAssets).size, dry.manifest.missingAssets.length);
  for (const requiredId of [
    'building.guild', 'effect.construction_dust', 'effect.water_ripple', 'field.grass', 'object.rubble'
  ]) assert.equal(dry.manifest.missingAssets.includes(requiredId), true);
  for (const absentId of [
    'character.player', 'effect.window_light', 'field.snow', 'object.harbor_cargo',
    'object.guild_roster_stand', 'object.menu_board', 'ui.dialogue_window'
  ]) assert.equal(dry.manifest.missingAssets.includes(absentId), false);
  const written = await exportApproved({ write: true, publicRoot, now: () => '2026-07-13T00:00:00.000Z' }, { root, forgeRoot: FORGE_ROOT });
  assert.equal(written.status, 'exported');
  const manifest = JSON.parse(await readFile(path.join(publicRoot, 'assets', 'forge', 'manifest.json'), 'utf8'));
  assert.equal(manifest.assets[0].sha256, hash);
  assert.equal(manifest.assets.some(({ publicPath }) => publicPath.includes('/pending/')), false);
  const exportedAssets = JSON.parse(await readFile(assetsPath, 'utf8'));
  const exportedPlayer = exportedAssets.assets.find((entry) => entry.assetId === 'character.player');
  assert.equal(exportedPlayer.status, 'exported');
  assert.equal(exportedPlayer.exportPath, manifest.assets[0].publicPath);
  const repeated = await exportApproved({ write: true, publicRoot, now: () => '2026-07-13T00:00:00.000Z' }, { root, forgeRoot: FORGE_ROOT });
  assert.equal(repeated.status, 'exported');
  assert.equal(repeated.reused.some((file) => file.endsWith('field_grass.png')), false);
  assert.equal(repeated.reused.some((file) => file.endsWith('character_player.png')), true);
  assert.equal(repeated.reused.some((file) => file.includes('/manifests/')), true);
  exportedPlayer.category = 'object';
  await writeFile(assetsPath, JSON.stringify(exportedAssets));
  await assert.rejects(
    () => exportApproved({ publicRoot }, { root, forgeRoot: FORGE_ROOT }),
    /category does not match definition/
  );
});

test('export completes only when every scoped required asset and runtime binding is present', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-export-complete-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const assetManifestPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assetManifest = resetAssetManifestToMissing(JSON.parse(await readFile(assetManifestPath, 'utf8')));
  await writeFile(assetManifestPath, JSON.stringify(assetManifest));
  const empty = await exportApproved({}, { root, forgeRoot: FORGE_ROOT });
  assert.equal(empty.manifest.complete, false);
  for (const assetId of ['character.player', 'effect.construction_dust', 'effect.water_ripple']) {
    assert.equal(empty.manifest.missingAssets.includes(assetId), true);
  }

  const requiredIds = new Set(['character.player', 'effect.construction_dust', 'effect.water_ripple']);
  for (const name of ['buildings', 'characters', 'effects', 'fields', 'objects', 'ui']) {
    const file = path.join(root, 'data', 'asset-definitions', `${name}.json`);
    const catalog = JSON.parse(await readFile(file, 'utf8'));
    for (const definition of catalog.assets) definition.required = requiredIds.has(definition.id);
    await writeFile(file, JSON.stringify(catalog));
  }
  const coveragePath = path.join(root, 'data', 'manifests', 'runtime-coverage.json');
  const coverage = JSON.parse(await readFile(coveragePath, 'utf8'));
  coverage.vocabularies = {};
  coverage.stateMap = {};
  await writeFile(coveragePath, JSON.stringify(coverage));

  const fixtures = [
    { assetId: 'character.player', directory: 'characters', width: 80, height: 96 },
    { assetId: 'effect.construction_dust', directory: 'effects', width: 64, height: 16 },
    { assetId: 'effect.water_ripple', directory: 'effects', width: 64, height: 16 }
  ];
  const approvals = [];
  for (const [index, fixture] of fixtures.entries()) {
    const bytes = createMockPng({
      assetId: fixture.assetId,
      outputContract: { width: fixture.width, height: fixture.height }
    });
    const stem = fixture.assetId.replaceAll('.', '_');
    const approvedRelative = `generated/${fixture.directory}/approved/${stem}-complete.png`;
    const approvedPath = path.join(root, approvedRelative);
    await mkdir(path.dirname(approvedPath), { recursive: true });
    await writeFile(approvedPath, bytes);
    const hash = sha256(bytes);
    const entry = assetManifest.assets.find(({ assetId }) => assetId === fixture.assetId);
    entry.status = 'approved';
    entry.approvedPath = approvedRelative;
    entry.lastUpdated = '2026-07-13T00:00:00.000Z';
    approvals.push({
      generationId: `gen_complete_${index}`,
      assetId: fixture.assetId,
      reviewer: 'human',
      note: 'complete export fixture',
      approvedAt: '2026-07-13T00:00:00.000Z',
      sourcePath: `generated/${fixture.directory}/pending/source-${index}.png`,
      sourceSha256: hash,
      approvedPath: approvedRelative,
      approvedSha256: hash
    });
  }
  await writeFile(assetManifestPath, JSON.stringify(assetManifest));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals
  }));

  const complete = await exportApproved({}, { root, forgeRoot: root });
  assert.deepEqual(complete.manifest.missingBindings, []);
  assert.deepEqual(complete.manifest.missingAssets, []);
  assert.equal(complete.manifest.complete, true);
  assert.deepEqual(complete.manifest.assets.map(({ assetId }) => assetId), [
    'character.player', 'effect.construction_dust', 'effect.water_ripple'
  ]);
});

test('export rejects an approved spritesheet whose PNG dimensions do not match its declared grid', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-export-bad-grid-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const bytes = createMockPng({ assetId: 'bad-player-grid', outputContract: { width: 79, height: 96 } });
  const approvedRelative = 'generated/characters/approved/character_player-bad-grid.png';
  const approvedPath = path.join(root, approvedRelative);
  await mkdir(path.dirname(approvedPath), { recursive: true });
  await writeFile(approvedPath, bytes);
  const hash = sha256(bytes);

  const assetsPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assets = JSON.parse(await readFile(assetsPath, 'utf8'));
  const player = assets.assets.find((entry) => entry.assetId === 'character.player');
  player.status = 'approved';
  player.approvedPath = approvedRelative;
  player.lastUpdated = '2026-07-13T00:00:00.000Z';
  await writeFile(assetsPath, JSON.stringify(assets));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: [{
      generationId: 'gen_human_bad_grid', assetId: 'character.player', reviewer: 'human', note: 'test fixture',
      approvedAt: '2026-07-13T00:00:00.000Z', sourcePath: 'generated/characters/pending/source.png',
      sourceSha256: hash, approvedPath: approvedRelative, approvedSha256: hash
    }]
  }));

  await assert.rejects(
    () => exportApproved({ publicRoot: path.join(root, 'public') }, { root, forgeRoot: FORGE_ROOT }),
    /Approved spritesheet dimensions do not match its grid.*got 79x96, expected 80x96/
  );
});
