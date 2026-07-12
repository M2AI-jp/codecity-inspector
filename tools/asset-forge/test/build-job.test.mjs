import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  return root;
}

async function installApprovedCharacterReference(root, marker) {
  const relativePath = 'references/approved/character_style_master.png';
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const bytes = createMockPng({ assetId: `reference.${marker}`, outputContract: { width: 8, height: 8 } });
  await writeFile(absolutePath, bytes);
  const manifestPath = path.join(root, 'data', 'manifests', 'references.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const reference = manifest.references.find((entry) => entry.id === 'character_style_master');
  reference.status = 'approved';
  reference.sha256 = sha256(bytes);
  reference.licenseNote = 'original fixture generated locally for tests';
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { bytes, hash: sha256(bytes), manifestPath, absolutePath };
}

test('job provenance includes seed, prompt, approved reference hash, and output contract', async () => {
  const forgeRoot = await forgeFixture();
  const reference = await installApprovedCharacterReference(forgeRoot, 'one');
  const first = await buildJob({ assetId: 'character.player', provider: 'mock', seed: 'one' }, { forgeRoot });
  assert.deepEqual(first.job.referenceImageIds, ['character_style_master']);
  assert.deepEqual(first.job.referenceImageHashes, [reference.hash]);
  assert.deepEqual(first.job.outputContract.grid, { columns: 4, rows: 3, frameWidth: 20, frameHeight: 32 });
  assert.equal(first.job.outputContract.width, 80);
  assert.equal(first.job.outputContract.height, 96);

  const seedChange = await buildJob({ assetId: 'character.player', provider: 'mock', seed: 'two' }, { forgeRoot });
  assert.notEqual(seedChange.job.provenanceKey, first.job.provenanceKey);

  const promptPath = path.join(forgeRoot, 'prompts', 'common', 'pixel-art-style.md');
  await writeFile(promptPath, `${await readFile(promptPath, 'utf8')}\nfixture change\n`);
  const promptChange = await buildJob({ assetId: 'character.player', provider: 'mock', seed: 'one' }, { forgeRoot });
  assert.notEqual(promptChange.job.provenanceKey, first.job.provenanceKey);

  await writeFile(promptPath, await readFile(path.join(FORGE_ROOT, 'prompts', 'common', 'pixel-art-style.md')));
  const secondReference = await installApprovedCharacterReference(forgeRoot, 'two');
  const referenceChange = await buildJob({ assetId: 'character.player', provider: 'mock', seed: 'one' }, { forgeRoot });
  assert.notEqual(secondReference.hash, reference.hash);
  assert.notEqual(referenceChange.job.provenanceKey, first.job.provenanceKey);
});

test('jobs can require approved references and reject missing placeholders', async () => {
  await assert.rejects(
    () => buildJob({ assetId: 'character.player', provider: 'job-pack', requireReferences: true }),
    /not approved/
  );
});
