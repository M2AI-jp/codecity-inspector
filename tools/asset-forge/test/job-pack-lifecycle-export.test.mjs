import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp as fsMkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { FORGE_ROOT, pathsFor } from '../src/config.mjs';
import { exportApproved } from '../src/export/export-approved.mjs';
import { withFileLock } from '../src/fs-safe.mjs';
import { sha256 } from '../src/hashing.mjs';
import { auditTransparentPng } from '../src/images/audit-alpha.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import {
  promotionPreviewInternal as promotionPreview,
  promoteCandidateInternal as promoteCandidate,
  rejectCandidate
} from '../src/jobs/lifecycle.mjs';
import { runJob } from '../src/jobs/run-job.mjs';
import { validateWith } from '../src/schemas.mjs';
import { writeJobPack } from '../src/jobs/write-job-pack.mjs';
import { createMockPng } from '../src/providers/mock-provider.mjs';

const TEMP_ROOTS = new Set();
async function mkdtemp(prefix) {
  const root = await fsMkdtemp(prefix);
  TEMP_ROOTS.add(root);
  return root;
}
after(async () => {
  await Promise.all([...TEMP_ROOTS].map((root) => rm(root, { recursive: true, force: true })));
});

async function forgeInputsWithReference() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-pack-inputs-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'prompts'), path.join(root, 'prompts'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'references'), path.join(root, 'references'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'review', 'prompts'), path.join(root, 'review', 'prompts'), { recursive: true });
  return root;
}

async function approvedFixture({ root, forgeRoot = FORGE_ROOT, assetId, generationId, width, height, withRecipe = false }) {
  const provider = withRecipe ? 'manual-import' : 'mock';
  const { asset, job } = await buildJob({ assetId, provider, seed: generationId }, { forgeRoot });
  const bytes = createMockPng({ assetId, outputContract: { width: width ?? job.outputContract.width, height: height ?? job.outputContract.height } });
  const hash = sha256(bytes);
  const directory = `${asset.category}${asset.category === 'character' ? 's' : asset.category === 'building' ? 's' : asset.category === 'field' ? 's' : asset.category === 'object' ? 's' : 's'}`;
  const approvedRelative = `generated/${directory}/approved/${assetId.replaceAll('.', '_')}-${generationId}.png`;
  const pendingRelative = `generated/${directory}/pending/source-${generationId}.png`;
  const approvedPath = path.join(root, approvedRelative);
  await mkdir(path.dirname(approvedPath), { recursive: true });
  await writeFile(approvedPath, bytes);
  await mkdir(path.dirname(path.join(root, pendingRelative)), { recursive: true });
  await writeFile(path.join(root, pendingRelative), bytes);
  const createdAt = '2026-07-13T00:00:00.000Z';
  const approval = {
    reviewer: 'human', note: 'test fixture', approvedAt: createdAt,
    approvedPath: approvedRelative, approvedSha256: hash
  };
  const generation = {
    id: generationId, jobId: job.id, assetId, category: asset.category, status: 'approved', provider,
    outputPath: approvedRelative, outputSha256: hash,
    metadataPath: approvedRelative.replace(/\.png$/, '.json'), promptHash: job.promptHash,
    provenanceKey: job.provenanceKey, referenceImageIds: job.referenceImageIds,
    referenceImageHashes: job.referenceImageHashes, dryRun: false, subscriptionRun: false,
    manualImport: withRecipe, outputInspection: {
      format: 'png', width: width ?? job.outputContract.width, height: height ?? job.outputContract.height,
      channels: 4, frames: 1, bytes: bytes.length
    }, warnings: [], createdAt, approval,
    inspection: { status: 'pending-inspection', observed: ['test fixture'], inferred: [], unknown: [] }
  };
  if (withRecipe) {
    const alpha = await auditTransparentPng(bytes);
    const sourceSnapshotRelative = approvedRelative.replace(/\.png$/, '.source-original.png');
    await writeFile(path.join(root, sourceSnapshotRelative), bytes);
    let productionRecipe;
    if (assetId === 'building.inn') {
      const promptRelative = 'review/prompts/wave1a-buildings/building_inn.txt';
      const prompt = await readFile(path.join(forgeRoot, promptRelative));
      productionRecipe = {
        waveId: 'wave1a-buildings',
        assetId,
        method: 'imagegen',
        generator: 'test-image-generator',
        scaleClass: 'large',
        generationPromptPath: promptRelative,
        generationPromptSha256: sha256(prompt),
        toolMode: 'built-in',
        inputReferences: job.referenceImageIds.map((id, index) => ({
          id,
          sha256: job.referenceImageHashes[index],
          role: index === 0 ? 'global-style' : 'primary-subject'
        })),
        referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
        source: { path: 'tmp/original.png', sha256: hash, width: alpha.width, height: alpha.height, cropRect: null },
        sourceSnapshot: { path: sourceSnapshotRelative, sha256: hash, width: alpha.width, height: alpha.height },
        backgroundRemoval: {
          method: 'official-chroma-key-helper', keyColor: null, autoKey: 'border', softMatte: true,
          transparentThreshold: 12, opaqueThreshold: 220, despill: true,
          cleanup: {
            alphaCutoff: 16, componentMinPixels: 128,
            targetMaxWidth: 256, targetMaxHeight: 256, resizeKernel: 'nearest'
          }
        },
        canvas: { width: alpha.width, height: alpha.height, baselineY: alpha.height - 1 },
        subjectBbox: alpha.subjectBbox,
        outputSha256: hash
      };
    } else {
      productionRecipe = {
        waveId: 'test-export-fixture',
        assetId,
        method: 'direct-extraction',
        generator: 'asset-forge-direct-extraction',
        scaleClass: 'medium',
        orientationContract: 'test fixture uses the full decoded production canvas',
        transformSteps: ['crop'],
        referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
        source: {
          path: sourceSnapshotRelative,
          sha256: hash,
          width: alpha.width,
          height: alpha.height,
          cropRect: { x: 0, y: 0, width: alpha.width, height: alpha.height }
        },
        sourceSnapshot: { path: sourceSnapshotRelative, sha256: hash, width: alpha.width, height: alpha.height },
        backgroundRemoval: {
          method: 'none', keyColor: null, autoKey: null, softMatte: false,
          transparentThreshold: 0, opaqueThreshold: 255, despill: false,
          cleanup: {
            alphaCutoff: 0, componentMinPixels: 1,
            targetMaxWidth: alpha.width, targetMaxHeight: alpha.height, resizeKernel: 'nearest'
          }
        },
        canvas: { width: alpha.width, height: alpha.height, baselineY: alpha.height - 1 },
        subjectBbox: alpha.subjectBbox,
        outputSha256: hash
      };
    }
    Object.assign(generation, {
      sourcePath: `generated/${directory}/pending/${assetId.replaceAll('.', '_')}.source.png`,
      sourceSha256: hash,
      sourceFormat: 'png',
      productionRecipe
    });
  }
  await writeFile(path.join(root, generation.metadataPath), JSON.stringify(generation));
  return {
    generation, hash, approvedRelative,
    approvalRecord: {
      generationId, assetId, reviewer: 'human', note: 'test fixture', approvedAt: createdAt,
      sourcePath: pendingRelative, sourceSha256: hash,
      approvedPath: approvedRelative, approvedSha256: hash
    }
  };
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
  assert.deepEqual(packed.pack.referenceIds, ['world_visual_master', 'character_visual_master']);
});

test('reject copies a pending candidate without changing approved state; promote refuses automation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-lifecycle-'));
  const generated = await runJob({ assetId: 'ui.dialogue_window', provider: 'mock' }, { root, now: () => '2026-07-13T00:00:00.000Z' });
  const preview = await promotionPreview({ generationId: generated.result.id }, { root });
  assert.equal(preview.sourceSha256, generated.result.outputSha256);
  await assert.rejects(() => promoteCandidate({
    generationId: generated.result.id, reviewer: 'automation', note: 'looks good', write: true,
    confirmed: true,
    expectedSourceSha256: preview.sourceSha256,
    expectedApprovedPath: preview.approvedPath
  }, { root }), /interactive human/);
  await assert.rejects(() => access(path.join(root, preview.approvedPath)), /ENOENT/);
  const rejected = await rejectCandidate({ generationId: generated.result.id, reason: 'fixture rejection' }, { root });
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.result.outputPath, /^generated\/ui\/rejected\//);
  const journal = JSON.parse(await readFile(path.join(
    root,
    'data',
    'local',
    'lifecycle',
    `${generated.result.id}.json`
  )));
  assert.equal(journal.schemaVersion, 2);
  assert.equal(journal.status, 'complete');
  const pendingSnapshot = await readFile(path.join(root, journal.pendingRecordPath));
  assert.equal(sha256(pendingSnapshot), journal.pendingRecordSha256);
  assert.deepEqual(JSON.parse(pendingSnapshot), generated.result);
  const resumed = await rejectCandidate({ generationId: generated.result.id, reason: 'fixture rejection' }, { root });
  assert.equal(resumed.resumed, true);
  await assert.rejects(
    () => rejectCandidate({ generationId: generated.result.id, reason: 'different reason' }, { root }),
    /original reason/
  );
  await assert.rejects(() => promotionPreview({ generationId: generated.result.id }, { root }), /Only a pending/);
});

test('required mock candidates without a recipe cannot preview or enter locked promotion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-required-recipe-'));
  const generated = await runJob({ assetId: 'field.grass', provider: 'mock' }, {
    root, now: () => '2026-07-13T00:00:00.000Z'
  });
  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const before = await readFile(ledgerPath);
  await assert.rejects(
    () => promotionPreview({ generationId: generated.result.id }, { root }),
    /required asset is missing its production recipe/
  );
  await assert.rejects(
    () => promoteCandidate({
      generationId: generated.result.id,
      reviewer: 'human', note: 'must not mutate', write: true, confirmed: true
    }, { root }),
    /required asset is missing its production recipe/
  );
  assert.deepEqual(await readFile(ledgerPath), before);
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

test('export rejects required approved metadata without a production recipe before public mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-export-required-recipe-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const fixture = await approvedFixture({
    root, assetId: 'character.player', generationId: 'gen_required_no_recipe'
  });
  const assetsPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assets = resetAssetManifestToMissing(JSON.parse(await readFile(assetsPath, 'utf8')));
  const player = assets.assets.find((entry) => entry.assetId === 'character.player');
  player.status = 'approved';
  player.approvedPath = fixture.approvedRelative;
  player.lastUpdated = '2026-07-13T00:00:00.000Z';
  await writeFile(assetsPath, JSON.stringify(assets));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: [fixture.approvalRecord]
  }));
  const publicRoot = path.join(root, 'public');
  await assert.rejects(
    () => exportApproved({ write: true, publicRoot }, { root, forgeRoot: FORGE_ROOT }),
    /required asset is missing its production recipe/
  );
  await assert.rejects(() => access(publicRoot), /ENOENT/);
});

test('approved-only export verifies ledger hashes and never includes pending assets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-export-state-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const fixture = await approvedFixture({
    root, assetId: 'character.player', generationId: 'gen_human', withRecipe: true
  });
  const { approvedRelative, hash } = fixture;
  const assetsPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assets = resetAssetManifestToMissing(JSON.parse(await readFile(assetsPath, 'utf8')));
  const player = assets.assets.find((entry) => entry.assetId === 'character.player');
  player.status = 'approved'; player.approvedPath = approvedRelative; player.lastUpdated = '2026-07-13T00:00:00.000Z';
  await writeFile(assetsPath, JSON.stringify(assets));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: [fixture.approvalRecord]
  }));
  const publicRoot = path.join(root, 'public');
  const dry = await exportApproved({ publicRoot }, { root, forgeRoot: FORGE_ROOT });
  assert.equal(dry.status, 'dry-run');
  assert.equal(dry.manifest.schemaVersion, 2);
  assert.deepEqual(dry.manifest.assets.map(({ assetId }) => assetId), ['character.player']);
  assert.deepEqual(dry.manifest.assets[0].renderSpec, {
    kind: 'spritesheet',
    logicalSize: { width: 24, height: 40 },
    tileSize: null,
    nearestNeighbor: true,
    allowAntiAlias: false,
    sprites: {
      directions: ['front', 'back', 'left', 'right'],
      frames: ['idle', 'walk_1', 'walk_2'],
      grid: { columns: 4, rows: 3, frameWidth: 24, frameHeight: 40 },
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
    'building.guild', 'effect.construction_dust', 'effect.water_ripple', 'field.grass', 'field.snow', 'object.rubble'
  ]) assert.equal(dry.manifest.missingAssets.includes(requiredId), true);
  for (const absentId of [
    'character.player', 'effect.window_light', 'field.sand', 'object.harbor_cargo',
    'object.guild_roster_stand', 'object.menu_board', 'ui.dialogue_window'
  ]) assert.equal(dry.manifest.missingAssets.includes(absentId), false);
  const approvedMetadataPath = path.join(root, fixture.generation.metadataPath);
  const tamperedMetadata = structuredClone(fixture.generation);
  tamperedMetadata.referenceImageHashes[0] = '0'.repeat(64);
  await writeFile(approvedMetadataPath, JSON.stringify(tamperedMetadata));
  await assert.rejects(
    () => exportApproved({ publicRoot }, { root, forgeRoot: FORGE_ROOT }),
    /recorded reference evidence is missing or changed/
  );
  await writeFile(approvedMetadataPath, JSON.stringify(fixture.generation));
  await assert.rejects(
    () => exportApproved({ write: true, publicRoot, now: () => '2026-07-13T00:00:00.000Z' }, { root, forgeRoot: FORGE_ROOT }),
    /complete required asset manifest/
  );
  await assert.rejects(() => access(publicRoot), /ENOENT/);
  const changedAssets = JSON.parse(await readFile(assetsPath, 'utf8'));
  changedAssets.assets.find((entry) => entry.assetId === 'character.player').category = 'object';
  await writeFile(assetsPath, JSON.stringify(changedAssets));
  await assert.rejects(
    () => exportApproved({ publicRoot }, { root, forgeRoot: FORGE_ROOT }),
    /Candidate path does not match its category|category does not match definition/
  );
});

test('export rejects tampered generation prompts and persistent original source snapshots', async () => {
  const root = await forgeInputsWithReference();
  const fixture = await approvedFixture({
    root,
    forgeRoot: root,
    assetId: 'building.inn',
    generationId: 'gen_recipe_export',
    withRecipe: true
  });
  const assetsPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assets = resetAssetManifestToMissing(JSON.parse(await readFile(assetsPath, 'utf8')));
  const inn = assets.assets.find((entry) => entry.assetId === 'building.inn');
  inn.status = 'approved';
  inn.approvedPath = fixture.approvedRelative;
  inn.lastUpdated = '2026-07-13T00:00:00.000Z';
  await writeFile(assetsPath, JSON.stringify(assets));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: [fixture.approvalRecord]
  }));
  const valid = await exportApproved({}, { root, forgeRoot: root });
  assert.deepEqual(valid.manifest.assets.map(({ assetId }) => assetId), ['building.inn']);

  const promptPath = path.join(root, fixture.generation.productionRecipe.generationPromptPath);
  const prompt = await readFile(promptPath);
  await writeFile(promptPath, Buffer.concat([prompt, Buffer.from('\ntampered')]));
  await assert.rejects(
    () => exportApproved({}, { root, forgeRoot: root }),
    /generation prompt file hash does not match/
  );

  await writeFile(promptPath, prompt);
  const snapshotPath = path.join(root, fixture.generation.productionRecipe.sourceSnapshot.path);
  const tamperedSnapshot = createMockPng({ assetId: 'changed-source', outputContract: { width: 256, height: 256 } });
  await writeFile(snapshotPath, tamperedSnapshot);
  await assert.rejects(
    () => exportApproved({}, { root, forgeRoot: root }),
    /source file hash\/dimensions do not match/
  );
});

test('export completes only when every scoped required asset and runtime binding is present', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-export-complete-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'prompts'), path.join(root, 'prompts'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'references'), path.join(root, 'references'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'review', 'prompts'), path.join(root, 'review', 'prompts'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'review', 'decisions'), path.join(root, 'review', 'decisions'), { recursive: true });
  const assetManifestPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assetManifest = resetAssetManifestToMissing(JSON.parse(await readFile(assetManifestPath, 'utf8')));
  await writeFile(assetManifestPath, JSON.stringify(assetManifest));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: []
  }));
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
    { assetId: 'character.player', width: 96, height: 120 },
    { assetId: 'effect.construction_dust', width: 128, height: 32 },
    { assetId: 'effect.water_ripple', width: 128, height: 32 }
  ];
  const approvals = [];
  for (const [index, fixture] of fixtures.entries()) {
    const installed = await approvedFixture({
      root, forgeRoot: root, assetId: fixture.assetId,
      generationId: `gen_complete_${index}`, width: fixture.width, height: fixture.height, withRecipe: true
    });
    const entry = assetManifest.assets.find(({ assetId }) => assetId === fixture.assetId);
    entry.status = 'approved';
    entry.approvedPath = installed.approvedRelative;
    entry.lastUpdated = '2026-07-13T00:00:00.000Z';
    approvals.push(installed.approvalRecord);
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
  const publicRoot = path.join(root, 'public');
  await withFileLock(root, pathsFor(root).requiredPromotionLock, async () => {
    await assert.rejects(
      () => exportApproved({ write: true, publicRoot }, { root, forgeRoot: root }),
      /Concurrent writer lock is held/
    );
    await assert.rejects(() => access(publicRoot), /ENOENT/);
  });
  const written = await exportApproved({
    write: true, publicRoot, now: () => '2026-07-13T00:00:00.000Z'
  }, { root, forgeRoot: root });
  assert.equal(written.status, 'exported');
  const manifest = JSON.parse(await readFile(path.join(publicRoot, 'assets', 'forge', 'manifest.json'), 'utf8'));
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.assets.map(({ assetId }) => assetId), [
    'character.player', 'effect.construction_dust', 'effect.water_ripple'
  ]);
  const repeated = await exportApproved({
    write: true, publicRoot, now: () => '2026-07-13T00:00:00.000Z'
  }, { root, forgeRoot: root });
  assert.equal(repeated.reused.some((file) => file.endsWith('character_player.png')), true);
  assert.equal(repeated.reused.some((file) => file.includes('/manifests/')), true);

  const linkedPublicRoot = path.join(
    await mkdtemp(path.join(os.tmpdir(), 'forge-export-root-link-')),
    'public-link'
  );
  await symlink(publicRoot, linkedPublicRoot);
  await assert.rejects(
    () => exportApproved({
      write: true, publicRoot: linkedPublicRoot, now: () => '2026-07-13T00:00:00.000Z'
    }, { root, forgeRoot: root }),
    /public root must be a real non-symlink directory/
  );

  const publishedAsset = path.join(publicRoot, manifest.assets[0].publicPath.slice(1));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-export-link-target-'));
  const outsideAsset = path.join(outsideRoot, 'same.png');
  await writeFile(outsideAsset, await readFile(publishedAsset));
  await rm(publishedAsset);
  await symlink(outsideAsset, publishedAsset);
  await assert.rejects(
    () => exportApproved({
      write: true, publicRoot, now: () => '2026-07-13T00:00:00.000Z'
    }, { root, forgeRoot: root }),
    /Refusing to overwrite|Symbolic links/
  );
});

test('export rejects an approved spritesheet whose PNG dimensions do not match its declared grid', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-export-bad-grid-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const fixture = await approvedFixture({
    root, assetId: 'character.player', generationId: 'gen_human_bad_grid', width: 95, height: 120, withRecipe: true
  });
  const { approvedRelative } = fixture;

  const assetsPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assets = resetAssetManifestToMissing(JSON.parse(await readFile(assetsPath, 'utf8')));
  const player = assets.assets.find((entry) => entry.assetId === 'character.player');
  player.status = 'approved';
  player.approvedPath = approvedRelative;
  player.lastUpdated = '2026-07-13T00:00:00.000Z';
  await writeFile(assetsPath, JSON.stringify(assets));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: [fixture.approvalRecord]
  }));

  await assert.rejects(
    () => exportApproved({ publicRoot: path.join(root, 'public') }, { root, forgeRoot: FORGE_ROOT }),
    /decoded PNG dimensions do not match production output contract.*got 95x120, expected 96x120/
  );
});
