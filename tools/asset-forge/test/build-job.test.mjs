import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { sha256 } from '../src/hashing.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { createMockPng } from '../src/providers/mock-provider.mjs';

async function forgeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-job-inputs-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'prompts'), path.join(root, 'prompts'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'references'), path.join(root, 'references'), { recursive: true });
  return root;
}

async function replaceWorldReference(root, marker) {
  const relativePath = 'references/approved/world_visual_master.png';
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const bytes = createMockPng({ assetId: `reference.${marker}`, outputContract: { width: 8, height: 8 } });
  await writeFile(absolutePath, bytes);
  const manifestPath = path.join(root, 'data', 'manifests', 'references.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const reference = manifest.references.find((entry) => entry.id === 'world_visual_master');
  reference.sha256 = sha256(bytes);
  reference.licenseNote = 'original fixture generated locally for tests';
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { bytes, hash: sha256(bytes), manifestPath, absolutePath };
}

test('job provenance includes seed, prompt, world reference hash, and output contract', async () => {
  const forgeRoot = await forgeFixture();
  const reference = await replaceWorldReference(forgeRoot, 'one');
  const first = await buildJob({ assetId: 'character.player', provider: 'mock', seed: 'one' }, { forgeRoot });
  assert.deepEqual(first.job.referenceImageIds, ['world_visual_master', 'character_visual_master']);
  assert.equal(first.job.referenceImageHashes[0], reference.hash);
  assert.deepEqual(first.job.outputContract.grid, { columns: 4, rows: 3, frameWidth: 24, frameHeight: 40 });
  assert.equal(first.job.outputContract.width, 96);
  assert.equal(first.job.outputContract.height, 120);

  const seedChange = await buildJob({ assetId: 'character.player', provider: 'mock', seed: 'two' }, { forgeRoot });
  assert.notEqual(seedChange.job.provenanceKey, first.job.provenanceKey);

  const promptPath = path.join(forgeRoot, 'prompts', 'common', 'pixel-art-style.md');
  await writeFile(promptPath, `${await readFile(promptPath, 'utf8')}\nfixture change\n`);
  const promptChange = await buildJob({ assetId: 'character.player', provider: 'mock', seed: 'one' }, { forgeRoot });
  assert.notEqual(promptChange.job.provenanceKey, first.job.provenanceKey);

  await writeFile(promptPath, await readFile(path.join(FORGE_ROOT, 'prompts', 'common', 'pixel-art-style.md')));
  const secondReference = await replaceWorldReference(forgeRoot, 'two');
  const referenceChange = await buildJob({ assetId: 'character.player', provider: 'mock', seed: 'one' }, { forgeRoot });
  assert.notEqual(secondReference.hash, reference.hash);
  assert.notEqual(referenceChange.job.provenanceKey, first.job.provenanceKey);
});

test('required jobs reject pending references even when the pending escape hatch is requested', async () => {
  const forgeRoot = await forgeFixture();
  const manifestPath = path.join(forgeRoot, 'data', 'manifests', 'references.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const reference = manifest.references.find((entry) => entry.id === 'character_visual_master');
  const approvedPath = reference.path;
  reference.path = 'references/pending/temporary_character_candidate.png';
  reference.status = 'pending';
  const pendingPath = path.join(forgeRoot, reference.path);
  await mkdir(path.dirname(pendingPath), { recursive: true });
  await writeFile(pendingPath, await readFile(path.join(forgeRoot, approvedPath)));
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(
    () => buildJob({
      assetId: 'character.player', provider: 'job-pack', requireReferences: false, allowPendingReferences: true
    }, { forgeRoot }),
    /not approved/
  );
});
