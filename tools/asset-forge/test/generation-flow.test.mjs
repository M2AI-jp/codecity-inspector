import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';
import { hashApprovedTree, hashFile, hashTree } from '../src/hashing.mjs';
import { batchRun } from '../src/jobs/batch-run.mjs';
import { GenerationRunError, runJob } from '../src/jobs/run-job.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';
import { decodeUnfilteredRgbaPng } from '../src/png-core.mjs';

const fixedNow = () => '2026-07-12T00:00:00.000Z';

test('dry-run leaves the complete output root unchanged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-dry-run-'));
  const before = await hashTree(root);
  const dry = await runJob({ assetId: 'character.player', provider: 'mock', dryRun: true, seed: 'x' }, { root });
  assert.equal(dry.status, 'dry-run');
  assert.equal(await hashTree(root), before);
});

test('mock runs are byte-identical across output roots and agree with metadata and ledger', async () => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-generation-a-'));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-generation-b-'));
  const options = { assetId: 'character.player', provider: 'mock', seed: 'same' };
  const first = await runJob(options, { root: firstRoot, now: fixedNow });
  const second = await runJob(options, { root: secondRoot, now: fixedNow });
  assert.equal(first.status, 'pending');
  assert.equal(first.approvedTreeSha256Before, first.approvedTreeSha256After);
  const firstPng = await readFile(path.join(firstRoot, first.result.outputPath));
  const secondPng = await readFile(path.join(secondRoot, second.result.outputPath));
  assert.deepEqual(firstPng, secondPng);
  assert.equal(first.result.outputSha256, await hashFile(path.join(firstRoot, first.result.outputPath)));
  assert.deepEqual(first.result.outputInspection, {
    format: 'png', width: 96, height: 120, channels: 4, frames: 1, bytes: firstPng.length
  });
  assert.ok(decodeUnfilteredRgbaPng(firstPng).pixels.some((value) => value !== 0));
  const metadata = JSON.parse(await readFile(path.join(firstRoot, first.result.metadataPath), 'utf8'));
  assert.deepEqual(metadata, first.result);
  const ledger = await readLocalGenerationManifest(firstRoot);
  assert.deepEqual(ledger.results, [first.result]);
  assert.match(first.result.outputPath, /^generated\/characters\/pending\//);
});

test('provider failures are recorded as failed without changing approved state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-provider-failure-'));
  const approvedBefore = await hashApprovedTree(root);
  let caught;
  try {
    await runJob({ assetId: 'character.player', provider: 'mock' }, {
      root,
      now: fixedNow,
      providerOverrides: { mock: { name: 'mock', generate: async () => { throw new Error('synthetic failure'); } } }
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof GenerationRunError);
  assert.equal(caught.result.status, 'failed');
  assert.match(caught.result.error, /synthetic failure/);
  const ledger = await readLocalGenerationManifest(root);
  assert.equal(ledger.results[0].status, 'failed');
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('subscription provider refusal is nonzero-capable and recorded only in a temporary root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-subscription-refusal-'));
  await assert.rejects(
    () => runJob({ assetId: 'character.player', provider: 'codex-subscription' }, { root, now: fixedNow }),
    /unavailable/
  );
  assert.equal((await readLocalGenerationManifest(root)).results[0].status, 'failed');
});

test('fault injection cannot return success or create a success ledger without the manifest write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-ledger-failure-'));
  const approvedBefore = await hashApprovedTree(root);
  await assert.rejects(
    () => runJob({ assetId: 'character.player', provider: 'mock', seed: 'fault' }, {
      root,
      now: fixedNow,
      manifestHooks: { beforeWrite: async () => { throw new Error('injected ledger fault'); } }
    }),
    /state is incomplete/
  );
  await assert.rejects(() => access(path.join(root, 'data', 'local', 'generations.json')), /ENOENT/);
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('batch reports individual provider failures and keeps later jobs visible', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-batch-'));
  const result = await batchRun({
    assetIds: ['field.grass', 'field.water'],
    provider: 'mock',
    maxJobs: 10
  }, {
    root,
    now: fixedNow,
    providerOverrides: {
      mock: {
        name: 'mock',
        generate: async (job) => {
          if (job.assetId === 'field.grass') throw new Error('first failed');
          const { createMockPng } = await import('../src/providers/mock-provider.mjs');
          return createMockPng({
            assetId: job.assetId,
            seed: job.seed,
            promptHash: job.promptHash,
            referenceImageHashes: job.referenceImageHashes,
            outputContract: job.outputContract
          });
        }
      }
    }
  });
  assert.equal(result.status, 'partial-failure');
  assert.deepEqual(result.results.map((entry) => entry.status), ['failed', 'pending']);
});
