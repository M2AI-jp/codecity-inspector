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
  const assets = JSON.parse(await readFile(assetsPath, 'utf8'));
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
  assert.deepEqual(dry.manifest.assets.map(({ assetId }) => assetId), ['character.player']);
  assert.equal(dry.manifest.complete, false);
  assert.equal(dry.manifest.missingBindings.some(({ vocabulary, runtimeId }) => vocabulary === 'TILE_TYPES' && runtimeId === 'grass'), true);
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
