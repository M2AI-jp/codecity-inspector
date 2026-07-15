import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathsFor } from '../src/config.mjs';
import { withFileLock } from '../src/fs-safe.mjs';
import { hashTree } from '../src/hashing.mjs';
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
