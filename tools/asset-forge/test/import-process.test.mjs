import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { processImageBuffer, extractGridFrames } from '../src/images/process-image.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { processCandidate } from '../src/jobs/process-candidate.mjs';
import { promotionPreview } from '../src/jobs/lifecycle.mjs';
import { runJob } from '../src/jobs/run-job.mjs';
import { createMockPng } from '../src/providers/mock-provider.mjs';

test('manual import decodes by signature, preserves source, normalizes PNG, and stays pending', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-import-state-'));
  const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-import-input-'));
  const input = path.join(inputRoot, 'misleading-name.bin');
  const bytes = createMockPng({ assetId: 'input', outputContract: { width: 9, height: 7 } });
  await writeFile(input, bytes);
  const imported = await importCandidate({ assetId: 'character.player', file: input }, { root, now: () => '2026-07-13T00:00:00.000Z' });
  assert.equal(imported.status, 'pending');
  assert.equal(imported.result.provider, 'manual-import');
  assert.match(imported.result.outputPath, /^generated\/characters\/pending\//);
  assert.deepEqual(await readFile(path.join(root, imported.result.sourcePath)), bytes);
  assert.equal(imported.result.outputInspection.width, 80);
  assert.equal(imported.result.outputInspection.height, 96);
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
  const generated = await runJob({ assetId: 'field.grass', provider: 'mock' }, {
    root, now: () => '2026-07-13T00:00:00.000Z'
  });
  const before = await readFile(path.join(root, generated.result.outputPath));
  const processed = await processCandidate({ generationId: generated.result.id }, {
    root, now: () => '2026-07-13T00:01:00.000Z'
  });
  assert.equal(processed.status, 'processed-pending');
  assert.match(processed.result.outputPath, /^processed\/fields\/pending\/[a-z0-9_-]+\.png$/);
  assert.equal(processed.result.processedFromGenerationId, generated.result.id);
  assert.deepEqual(await readFile(path.join(root, generated.result.outputPath)), before);
  const preview = await promotionPreview({ generationId: processed.result.id }, { root });
  assert.equal(preview.sourcePath, processed.result.outputPath);
  assert.match(preview.approvedPath, /^generated\/fields\/approved\//);
});
