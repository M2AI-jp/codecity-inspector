import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { FORGE_ROOT, pathsFor } from '../src/config.mjs';
import { withFileLock } from '../src/fs-safe.mjs';
import { hashTree, sha256 } from '../src/hashing.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { materializeProductionSourceSnapshot } from '../src/jobs/lifecycle.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { processCandidate } from '../src/jobs/process-candidate.mjs';
import { runJob } from '../src/jobs/run-job.mjs';
import { writeJobPack } from '../src/jobs/write-job-pack.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';
import { createMockPng } from '../src/providers/mock-provider.mjs';

const fixedNow = () => '2026-07-15T00:00:00.000Z';

async function assertBlockedBeforeMutation(root, operation) {
  await withFileLock(root, pathsFor(root).requiredPromotionLock, async () => {
    const treeBefore = await hashTree(root);
    const ledgerBefore = await readLocalGenerationManifest(root);
    await assert.rejects(operation, /Concurrent writer lock is held/);
    assert.equal(await hashTree(root), treeBefore);
    assert.deepEqual(await readLocalGenerationManifest(root), ledgerBefore);
  });
}

test('required batch lock blocks an actual run before output or ledger writes, then identical retry succeeds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-required-run-lock-'));
  const operation = () => runJob({ assetId: 'ui.dialogue_window', provider: 'mock', seed: 'locked-run' }, {
    root,
    now: fixedNow
  });
  await assertBlockedBeforeMutation(root, operation);
  const completed = await operation();
  assert.equal(completed.status, 'pending');
  await access(path.join(root, completed.result.outputPath));
  await access(path.join(root, completed.result.metadataPath));
  assert.deepEqual((await readLocalGenerationManifest(root)).results.map((entry) => entry.id), [completed.result.id]);
});

test('required batch lock blocks an actual manual import before source/output/metadata writes, then identical retry succeeds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-required-import-lock-'));
  const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-required-import-input-'));
  const input = path.join(inputRoot, 'candidate.png');
  await writeFile(input, createMockPng({
    assetId: 'ui.dialogue_window',
    outputContract: { width: 16, height: 16 }
  }));
  const operation = () => importCandidate({
    assetId: 'ui.dialogue_window',
    file: input,
    seed: 'locked-import'
  }, { root, now: fixedNow });
  await assertBlockedBeforeMutation(root, operation);
  const completed = await operation();
  assert.equal(completed.status, 'pending');
  await access(path.join(root, completed.result.sourcePath));
  await access(path.join(root, completed.result.outputPath));
  await access(path.join(root, completed.result.metadataPath));
  assert.deepEqual((await readLocalGenerationManifest(root)).results.map((entry) => entry.id), [completed.result.id]);
});

test('required batch lock blocks source-snapshot materialization before pending metadata or ledger mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-required-snapshot-lock-'));
  const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-required-snapshot-input-'));
  const input = path.join(inputRoot, 'grass.png');
  const prepared = await sharp({
    create: { width: 64, height: 64, channels: 4, background: '#4f8055ff' }
  }).png().toBuffer();
  await writeFile(input, prepared);
  const { job } = await buildJob({ assetId: 'field.grass', provider: 'manual-import' });
  const original = await readFile(path.join(FORGE_ROOT, 'references', 'approved', 'world_visual_master.png'));
  const originalMetadata = await sharp(original).metadata();
  const imported = await importCandidate({
    assetId: 'field.grass',
    file: input,
    productionRecipe: {
      waveId: 'phase0-required-lock',
      assetId: 'field.grass',
      method: 'direct-extraction',
      generator: 'fixture-extractor',
      scaleClass: 'medium',
      orientationContract: 'walkable grass tile',
      transformSteps: ['crop'],
      referenceImages: job.referenceImageIds.map((id, index) => ({
        id, sha256: job.referenceImageHashes[index]
      })),
      source: {
        path: 'references/approved/world_visual_master.png',
        sha256: sha256(original),
        width: originalMetadata.width,
        height: originalMetadata.height,
        cropRect: { x: 0, y: 0, width: 64, height: 64 }
      },
      backgroundRemoval: {
        method: 'none', keyColor: null, autoKey: null, softMatte: false,
        transparentThreshold: 0, opaqueThreshold: 255, despill: false,
        cleanup: {
          alphaCutoff: 0, componentMinPixels: 1,
          targetMaxWidth: 64, targetMaxHeight: 64, resizeKernel: 'nearest'
        }
      },
      canvas: { width: 64, height: 64, baselineY: 63 },
      subjectBbox: { x: 0, y: 0, width: 64, height: 64 }
    }
  }, { root, forgeRoot: FORGE_ROOT, now: fixedNow });
  const operation = () => materializeProductionSourceSnapshot({
    generationId: imported.result.id
  }, { root, forgeRoot: FORGE_ROOT });
  await assertBlockedBeforeMutation(root, operation);
  const completed = await operation();
  assert.equal(completed.status, 'source-snapshot-ready');
  assert.match(completed.result.productionRecipe.sourceSnapshot.path, /^generated\/fields\/pending\/sources\//);
  await access(path.join(root, completed.result.productionRecipe.sourceSnapshot.path));
});

test('required batch lock blocks actual processing before derivative/frame/metadata writes, then identical retry succeeds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-required-process-lock-'));
  const source = await runJob({ assetId: 'ui.dialogue_window', provider: 'mock', seed: 'process-source' }, {
    root,
    now: fixedNow
  });
  const operation = () => processCandidate({ generationId: source.result.id }, { root, now: fixedNow });
  await assertBlockedBeforeMutation(root, operation);
  const completed = await operation();
  assert.equal(completed.status, 'processed-pending');
  await access(path.join(root, completed.result.outputPath));
  await access(path.join(root, completed.result.metadataPath));
  assert.deepEqual(
    (await readLocalGenerationManifest(root)).results.map((entry) => entry.id),
    [source.result.id, completed.result.id]
  );
});

test('required batch lock blocks an actual job pack before every pack/metadata write, then identical retry succeeds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-required-pack-lock-'));
  const operation = () => writeJobPack({ assetId: 'character.player', seed: 'locked-pack' }, {
    root,
    now: fixedNow
  });
  await assertBlockedBeforeMutation(root, operation);
  const completed = await operation();
  assert.equal(completed.status, 'job-pack');
  await access(path.join(root, completed.result.jobPackPath));
  await access(path.join(root, completed.result.metadataPath));
  assert.deepEqual((await readLocalGenerationManifest(root)).results.map((entry) => entry.id), [completed.result.id]);
});
