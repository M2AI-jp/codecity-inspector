import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendGenerationResult, readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';
import { withFileLock } from '../src/fs-safe.mjs';

function fixtureResult(id) {
  return {
    id,
    jobId: `job_${id}`,
    assetId: 'field.grass',
    category: 'field',
    status: 'failed',
    provider: 'mock',
    metadataPath: `data/local/failures/${id}.json`,
    promptHash: 'a'.repeat(64),
    provenanceKey: 'b'.repeat(64),
    referenceImageIds: [],
    referenceImageHashes: [],
    dryRun: false,
    subscriptionRun: false,
    manualImport: false,
    error: 'fixture',
    warnings: [],
    createdAt: '2026-07-12T00:00:00.000Z',
    inspection: { status: 'pending-inspection', observed: [], inferred: [], unknown: [] }
  };
}

test('manifest writer lock rejects an overlapping writer without losing the first update', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-manifest-lock-'));
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const first = appendGenerationResult(root, fixtureResult('gen_first'), {
    beforeWrite: async () => { entered(); await gate; }
  });
  await enteredPromise;
  await assert.rejects(() => appendGenerationResult(root, fixtureResult('gen_second')), /Concurrent writer lock/);
  release();
  await first;
  assert.deepEqual((await readLocalGenerationManifest(root)).results.map((entry) => entry.id), ['gen_first']);
});

test('faulted manifest update releases its lock and leaves no partial success manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-manifest-fault-'));
  await assert.rejects(
    () => appendGenerationResult(root, fixtureResult('gen_fault'), {
      beforeWrite: async () => { throw new Error('fault'); }
    }),
    /fault/
  );
  await assert.rejects(() => access(path.join(root, 'data', 'local', 'generations.json')), /ENOENT/);
  await appendGenerationResult(root, fixtureResult('gen_after'));
  assert.deepEqual((await readLocalGenerationManifest(root)).results.map((entry) => entry.id), ['gen_after']);
});

test('a lock owned by a dead process is quarantined and recovered', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-stale-lock-'));
  const lock = path.join(root, 'state', '.writer.lock');
  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({
    pid: 999999, acquiredAt: new Date().toISOString()
  }));
  let entered = false;
  await withFileLock(root, lock, async () => { entered = true; });
  assert.equal(entered, true);
  await assert.rejects(() => access(lock), /ENOENT/);
});
