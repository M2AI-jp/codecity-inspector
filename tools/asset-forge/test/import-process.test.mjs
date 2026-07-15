import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { hashApprovedTree, sha256 } from '../src/hashing.mjs';
import { processImageBuffer, extractGridFrames } from '../src/images/process-image.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { processCandidate } from '../src/jobs/process-candidate.mjs';
import { materializeProductionSourceSnapshot, promotionPreview, promoteCandidate } from '../src/jobs/lifecycle.mjs';
import { runJob } from '../src/jobs/run-job.mjs';
import { inspectPng } from '../src/png-core.mjs';
import { createMockPng } from '../src/providers/mock-provider.mjs';

test('manual import decodes by signature, preserves source, normalizes PNG, and stays pending', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-import-state-'));
  const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-import-input-'));
  const input = path.join(inputRoot, 'misleading-name.bin');
  const bytes = createMockPng({ assetId: 'input', outputContract: { width: 96, height: 120 } });
  await writeFile(input, bytes);
  const imported = await importCandidate({ assetId: 'character.player', file: input }, { root, now: () => '2026-07-13T00:00:00.000Z' });
  assert.equal(imported.status, 'pending');
  assert.equal(imported.result.provider, 'manual-import');
  assert.match(imported.result.outputPath, /^generated\/characters\/pending\//);
  assert.deepEqual(await readFile(path.join(root, imported.result.sourcePath)), bytes);
  assert.equal(imported.result.outputInspection.width, 96);
  assert.equal(imported.result.outputInspection.height, 120);
  assert.deepEqual(imported.result.referenceImageIds, ['world_visual_master', 'character_visual_master']);
  assert.equal(imported.result.referenceImageHashes.length, 2);
  assert.equal(imported.result.referenceImageHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)), true);
  assert.equal(imported.approvedTreeSha256Before, imported.approvedTreeSha256After);
});

test('manual import rejects unsupported signatures and symlink sources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-import-reject-'));
  const input = path.join(root, 'image.svg');
  await writeFile(input, '<svg/>');
  await assert.rejects(() => importCandidate({ assetId: 'field.grass', file: input }, { root }), /Unsupported image signature/);
  const real = path.join(root, 'real.png');
  const link = path.join(root, 'link.png');
  await writeFile(real, createMockPng({ assetId: 'source', outputContract: { width: 4, height: 4 } }));
  await symlink(real, link);
  await assert.rejects(() => importCandidate({ assetId: 'field.grass', file: link }, { root }), /non-symlink/);
});

test('manual import refuses to enlarge a smaller required production source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-import-small-'));
  const input = path.join(root, 'small.png');
  await writeFile(input, createMockPng({ assetId: 'small', outputContract: { width: 32, height: 32 } }));
  await assert.rejects(
    () => importCandidate({ assetId: 'field.grass', file: input }, { root }),
    /smaller than its output contract/
  );
});

test('manual import accepts a recorded direct extraction and rejects a missing crop transform', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-import-direct-extraction-'));
  const input = path.join(root, 'prepared-field.png');
  const { job } = await buildJob({ assetId: 'field.cobblestone', provider: 'manual-import' });
  const referenceManifest = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'references.json')));
  const primary = referenceManifest.references.find((entry) => entry.id === job.referenceImageIds[1]);
  const source = await readFile(path.join(FORGE_ROOT, primary.path));
  const metadata = await sharp(source).metadata();
  const cropRect = { x: 538, y: 539, width: 145, height: 145 };
  await sharp(source).extract({ left: cropRect.x, top: cropRect.y, width: cropRect.width, height: cropRect.height })
    .resize(64, 64, { kernel: sharp.kernel.nearest }).png().toFile(input);
  const recipe = {
    waveId: 'wave1b-fields',
    assetId: 'field.cobblestone',
    method: 'direct-extraction',
    generator: 'asset-forge-direct-extraction',
    scaleClass: 'medium',
    orientationContract: 'non-directional walkable small-stone cobblestone',
    transformSteps: ['crop', 'nearest-downscale', 'palette-quantize'],
    referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
    source: {
      path: primary.path,
      sha256: sha256(source),
      width: metadata.width,
      height: metadata.height,
      cropRect
    },
    backgroundRemoval: {
      method: 'none', keyColor: null, autoKey: null, softMatte: false,
      transparentThreshold: 0, opaqueThreshold: 255, despill: false,
      cleanup: { alphaCutoff: 0, componentMinPixels: 1, targetMaxWidth: 64, targetMaxHeight: 64, resizeKernel: 'nearest' }
    },
    canvas: { width: 64, height: 64, baselineY: 63 },
    subjectBbox: { x: 0, y: 0, width: 64, height: 64 }
  };
  const imported = await importCandidate({ assetId: 'field.cobblestone', file: input, productionRecipe: recipe }, { root });
  assert.equal(imported.result.productionRecipe.method, 'direct-extraction');
  assert.deepEqual(imported.result.productionRecipe.source.cropRect, cropRect);
  const invalidRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-import-direct-no-crop-'));
  await assert.rejects(
    () => importCandidate({
      assetId: 'field.cobblestone', file: input,
      productionRecipe: { ...recipe, source: { ...recipe.source, cropRect: null } }
    }, { root: invalidRoot }),
    /crop transform/
  );
});

test('manual import persists a verified production recipe and rejects provenance tampering', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-import-recipe-'));
  const input = path.join(root, 'prepared.png');
  const prepared = await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{
    input: await sharp({ create: { width: 100, height: 100, channels: 4, background: '#123456ff' } }).png().toBuffer(),
    left: 50,
    top: 50
  }]).png().toBuffer();
  await writeFile(input, prepared);
  const { job } = await buildJob({ assetId: 'building.inn', provider: 'manual-import' });
  const originalPath = path.join(FORGE_ROOT, 'references', 'approved', 'world_visual_master.png');
  const original = await readFile(originalPath);
  const originalMetadata = await sharp(original).metadata();
  const generationPromptPath = path.join('review', 'prompts', 'wave1a-buildings', 'building_inn.txt');
  const generationPrompt = await readFile(path.join(FORGE_ROOT, generationPromptPath));
  const recipe = {
    waveId: 'wave1a-buildings',
    assetId: 'building.inn',
    method: 'imagegen',
    generator: 'test-image-generator',
    scaleClass: 'large',
    generationPromptPath: generationPromptPath.split(path.sep).join('/'),
    generationPromptSha256: sha256(generationPrompt),
    toolMode: 'built-in',
    inputReferences: job.referenceImageIds.map((id, index) => ({
      id,
      sha256: job.referenceImageHashes[index],
      role: index === 0 ? 'global-style' : 'primary-subject'
    })),
    referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
    source: {
      path: 'references/approved/world_visual_master.png',
      sha256: sha256(original),
      width: originalMetadata.width,
      height: originalMetadata.height,
      cropRect: null
    },
    backgroundRemoval: {
      method: 'official-chroma-key-helper',
      keyColor: null,
      autoKey: 'border',
      softMatte: true,
      transparentThreshold: 12,
      opaqueThreshold: 220,
      despill: true,
      cleanup: {
        alphaCutoff: 16,
        componentMinPixels: 128,
        targetMaxWidth: 210,
        targetMaxHeight: 210,
        resizeKernel: 'nearest'
      }
    },
    canvas: { width: 256, height: 256, baselineY: 149 },
    subjectBbox: { x: 50, y: 50, width: 100, height: 100 }
  };
  const imported = await importCandidate({ assetId: 'building.inn', file: input, productionRecipe: recipe }, {
    root,
    now: () => '2026-07-14T00:00:00.000Z'
  });
  assert.equal(imported.result.productionRecipe.outputSha256, imported.result.outputSha256);
  assert.deepEqual(imported.result.productionRecipe.subjectBbox, recipe.subjectBbox);
  const outputBeforeSnapshot = await readFile(path.join(root, imported.result.outputPath));
  const approvedBeforeSnapshot = await hashApprovedTree(root);
  const persisted = await materializeProductionSourceSnapshot({ generationId: imported.result.id }, {
    root,
    forgeRoot: FORGE_ROOT
  });
  assert.equal(persisted.status, 'source-snapshot-ready');
  assert.equal(persisted.outputBytesUnchanged, true);
  assert.equal(persisted.result.productionRecipe.sourceSnapshot.sha256, recipe.source.sha256);
  assert.match(persisted.result.productionRecipe.sourceSnapshot.path, /^generated\/buildings\/pending\/sources\//);
  assert.equal(await hashApprovedTree(root), approvedBeforeSnapshot);
  assert.deepEqual(
    await readFile(path.join(root, persisted.result.productionRecipe.sourceSnapshot.path)),
    original
  );
  assert.deepEqual(await readFile(path.join(root, imported.result.outputPath)), outputBeforeSnapshot);
  const resumedSnapshot = await materializeProductionSourceSnapshot({ generationId: imported.result.id }, {
    root,
    forgeRoot: FORGE_ROOT
  });
  assert.equal(resumedSnapshot.resumed, true);
  assert.equal((await promotionPreview({ generationId: imported.result.id }, {
    root,
    forgeRoot: FORGE_ROOT
  })).sourceSha256, imported.result.outputSha256);

  const wrongSize = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{
    input: await sharp({ create: { width: 64, height: 64, channels: 4, background: '#123456ff' } }).png().toBuffer(),
    left: 32,
    top: 32
  }]).png().toBuffer();
  const wrongHash = sha256(wrongSize);
  const wrongInspection = inspectPng(wrongSize);
  const localPath = path.join(root, 'data', 'local', 'generations.json');
  const local = JSON.parse(await readFile(localPath, 'utf8'));
  const ledgerIndex = local.results.findIndex((entry) => entry.id === imported.result.id);
  const spoofed = {
    ...persisted.result,
    outputSha256: wrongHash,
    outputInspection: wrongInspection,
    productionRecipe: {
      ...persisted.result.productionRecipe,
      canvas: { width: 128, height: 128, baselineY: 95 },
      subjectBbox: { x: 32, y: 32, width: 64, height: 64 },
      outputSha256: wrongHash
    }
  };
  local.results[ledgerIndex] = spoofed;
  await writeFile(localPath, JSON.stringify(local));
  await writeFile(path.join(root, spoofed.metadataPath), JSON.stringify(spoofed));
  await writeFile(path.join(root, spoofed.outputPath), wrongSize);
  const manifestPaths = [localPath, path.join(root, spoofed.metadataPath)];
  const manifestBytes = await Promise.all(manifestPaths.map((file) => readFile(file)));
  await assert.rejects(
    () => promotionPreview({ generationId: spoofed.id }, { root, forgeRoot: FORGE_ROOT }),
    /decoded PNG dimensions do not match production output contract.*got 128x128, expected 256x256/
  );
  await assert.rejects(
    () => promoteCandidate({
      generationId: spoofed.id,
      reviewer: 'human',
      note: 'must not mutate',
      write: true,
      confirmed: true
    }, { root, forgeRoot: FORGE_ROOT }),
    /decoded PNG dimensions do not match production output contract.*got 128x128, expected 256x256/
  );
  assert.deepEqual(await Promise.all(manifestPaths.map((file) => readFile(file))), manifestBytes);

  const tamperedReferenceRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-import-recipe-ref-'));
  await assert.rejects(
    () => importCandidate({
      assetId: 'building.inn',
      file: input,
      productionRecipe: {
        ...recipe,
        referenceImages: recipe.referenceImages.map((entry, index) => index === 0 ? { ...entry, sha256: '0'.repeat(64) } : entry)
      }
    }, { root: tamperedReferenceRoot }),
    /reference ids\/hashes mismatch/
  );
  const tamperedSourceRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-import-recipe-source-'));
  await assert.rejects(
    () => importCandidate({
      assetId: 'building.inn',
      file: input,
      productionRecipe: { ...recipe, source: { ...recipe.source, sha256: '0'.repeat(64) } }
    }, { root: tamperedSourceRoot }),
    /source snapshot mismatch/
  );
  const tamperedPromptRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-import-recipe-prompt-'));
  await assert.rejects(
    () => importCandidate({
      assetId: 'building.inn',
      file: input,
      productionRecipe: { ...recipe, generationPromptSha256: '0'.repeat(64) }
    }, { root: tamperedPromptRoot }),
    /generation prompt snapshot mismatch/
  );
  const tamperedRoleRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-import-recipe-role-'));
  await assert.rejects(
    () => importCandidate({
      assetId: 'building.inn',
      file: input,
      productionRecipe: {
        ...recipe,
        inputReferences: recipe.inputReferences.map((entry, index) => index === 0
          ? { ...entry, role: 'primary-subject' }
          : entry)
      }
    }, { root: tamperedRoleRoot }),
    /input reference ids\/hashes\/roles mismatch/
  );
});

test('promotion preflight rejects tampered generation prompt and raw source provenance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-promotion-recipe-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'prompts'), path.join(root, 'prompts'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'references'), path.join(root, 'references'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'review', 'prompts'), path.join(root, 'review', 'prompts'), { recursive: true });
  await writeFile(path.join(root, 'data', 'local', 'generations.json'), JSON.stringify({
    schemaVersion: 1,
    tracked: false,
    results: []
  }));
  const prepared = await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{
    input: await sharp({ create: { width: 96, height: 96, channels: 4, background: '#456789ff' } }).png().toBuffer(),
    left: 48,
    top: 64
  }]).png().toBuffer();
  const input = path.join(root, 'prepared.png');
  const rawPath = path.join(root, 'raw.png');
  await writeFile(input, prepared);
  await writeFile(rawPath, prepared);
  const { job } = await buildJob({ assetId: 'building.inn', provider: 'manual-import' }, { forgeRoot: root });
  const generationPromptPath = 'review/prompts/wave1a-buildings/building_inn.txt';
  const generationPrompt = await readFile(path.join(root, generationPromptPath));
  const imported = await importCandidate({
    assetId: 'building.inn',
    file: input,
    productionRecipe: {
      waveId: 'wave1a-buildings', assetId: 'building.inn', method: 'imagegen',
      generator: 'test-image-generator', scaleClass: 'large',
      generationPromptPath, generationPromptSha256: sha256(generationPrompt), toolMode: 'built-in',
      inputReferences: job.referenceImageIds.map((id, index) => ({
        id, sha256: job.referenceImageHashes[index], role: index === 0 ? 'global-style' : 'primary-subject'
      })),
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      source: { path: 'raw.png', sha256: sha256(prepared), width: 256, height: 256, cropRect: null },
      backgroundRemoval: {
        method: 'official-chroma-key-helper', keyColor: null, autoKey: 'border', softMatte: true,
        transparentThreshold: 12, opaqueThreshold: 220, despill: true,
        cleanup: {
          alphaCutoff: 16, componentMinPixels: 128,
          targetMaxWidth: 210, targetMaxHeight: 210, resizeKernel: 'nearest'
        }
      },
      canvas: { width: 256, height: 256, baselineY: 159 },
      subjectBbox: { x: 48, y: 64, width: 96, height: 96 }
    }
  }, { root, forgeRoot: root, now: () => '2026-07-14T00:00:00.000Z' });

  const mutationPaths = [
    path.join(root, 'data', 'local', 'generations.json'),
    path.join(root, 'data', 'manifests', 'assets.json'),
    path.join(root, 'data', 'manifests', 'approvals.json')
  ];
  const beforeMissingSnapshot = await Promise.all(mutationPaths.map((file) => readFile(file)));
  await assert.rejects(
    () => promotionPreview({ generationId: imported.result.id }, { root, forgeRoot: root }),
    /verified persistent original source snapshot/
  );
  await assert.rejects(
    () => promoteCandidate({
      generationId: imported.result.id,
      reviewer: 'human',
      note: 'must not mutate',
      write: true,
      confirmed: true
    }, { root, forgeRoot: root }),
    /verified persistent original source snapshot/
  );
  assert.deepEqual(await Promise.all(mutationPaths.map((file) => readFile(file))), beforeMissingSnapshot);
  await materializeProductionSourceSnapshot({ generationId: imported.result.id }, { root, forgeRoot: root });

  await writeFile(path.join(root, generationPromptPath), Buffer.concat([generationPrompt, Buffer.from('\ntampered')]));
  await assert.rejects(
    () => promotionPreview({ generationId: imported.result.id }, { root, forgeRoot: root }),
    /generation prompt file hash does not match/
  );
  await writeFile(path.join(root, generationPromptPath), generationPrompt);
  await writeFile(rawPath, await sharp({
    create: { width: 256, height: 256, channels: 4, background: '#00000000' }
  }).png().toBuffer());
  await assert.rejects(
    () => promotionPreview({ generationId: imported.result.id }, { root, forgeRoot: root }),
    /source file hash\/dimensions do not match/
  );
});

test('alpha key, transparent trim, nearest resize, and grid extraction are pixel-exact', async () => {
  const raw = Buffer.from([
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255
  ]);
  const input = await sharp(raw, { raw: { width: 3, height: 3, channels: 4 } }).png().toBuffer();
  const processed = await processImageBuffer(input, { alphaKey: 'black', tolerance: 0, trim: true, width: 2, height: 2 });
  assert.equal(processed.width, 2);
  assert.equal(processed.height, 2);
  const decoded = await sharp(processed.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...decoded.data], [255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
  assert.equal((await extractGridFrames(processed.png, { columns: 2, rows: 1, frameWidth: 1, frameHeight: 2 })).length, 2);
  await assert.rejects(
    () => extractGridFrames(processed.png, { columns: 257, rows: 1, frameWidth: 1, frameHeight: 1 }),
    /exceeds 256 frames/
  );
  await assert.rejects(() => processImageBuffer(input, { tolerance: 256 }), /Tolerance/);
});

test('processing creates a separate promotable pending derivative and preserves its source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-process-state-'));
  const generated = await runJob({ assetId: 'ui.dialogue_window', provider: 'mock' }, {
    root, now: () => '2026-07-13T00:00:00.000Z'
  });
  const before = await readFile(path.join(root, generated.result.outputPath));
  const processed = await processCandidate({ generationId: generated.result.id }, {
    root, now: () => '2026-07-13T00:01:00.000Z'
  });
  assert.equal(processed.status, 'processed-pending');
  assert.match(processed.result.outputPath, /^processed\/ui\/pending\/[a-z0-9_-]+\.png$/);
  assert.equal(processed.result.processedFromGenerationId, generated.result.id);
  assert.deepEqual(await readFile(path.join(root, generated.result.outputPath)), before);
  const preview = await promotionPreview({ generationId: processed.result.id }, { root });
  assert.equal(preview.sourcePath, processed.result.outputPath);
  assert.match(preview.approvedPath, /^generated\/ui\/approved\//);
});
