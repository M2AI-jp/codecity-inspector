import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { FORGE_ROOT } from '../src/config.mjs';
import {
  importFable5PrefabCharacterCandidate,
  inspectFable5PrefabCharacterCandidate,
  verifyFable5PrefabCharacterJobPack
} from '../src/fable5-prefab-character-intake.mjs';
import { writeFable5PrefabCharacterJobPack } from '../src/fable5-prefab-character-jobs.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

async function forgeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-fable5-character-intake-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(FORGE_ROOT, 'contracts', 'fable5-prefab'), path.join(root, 'contracts', 'fable5-prefab'), {
    recursive: true
  });
  await cp(path.join(FORGE_ROOT, 'prompts', 'fable5-prefab'), path.join(root, 'prompts', 'fable5-prefab'), {
    recursive: true
  });
  return root;
}

function pixelOffset(width, x, y) {
  return (y * width + x) * 4;
}

function setPixel(raw, width, x, y, color) {
  raw.set(color, pixelOffset(width, x, y));
}

async function candidatePng({ mirroredEast = false } = {}) {
  const width = 640;
  const height = 512;
  const raw = Buffer.alloc(width * height * 4);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const originX = col * 64;
      const originY = row * 128;
      const color = [30 + row * 30, 40 + col * 8, 70 + row + col, 255];
      // Two opaque sole pixels at y=120 keep the lower-band centroid at 31.5.
      setPixel(raw, width, originX + 31, originY + 120, color);
      setPixel(raw, width, originX + 32, originY + 120, color);
      // A direction/phase marker creates a non-empty, independently extractable frame.
      const markerX = row === 1 ? 10 : row === 2 ? 15 : 12;
      setPixel(raw, width, originX + markerX, originY + 60, color);
    }
  }
  if (mirroredEast) {
    for (let col = 0; col < 10; col += 1) {
      for (let y = 0; y < 128; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          const source = pixelOffset(width, col * 64 + x, 128 + y);
          const destination = pixelOffset(width, col * 64 + (63 - x), 256 + y);
          raw.copy(raw, destination, source, source + 4);
        }
      }
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

test('Fable5 intake copies only a matching mechanically valid PNG to pending', async (t) => {
  const forgeRoot = await forgeFixture(t);
  const jobPack = await writeFable5PrefabCharacterJobPack(
    { assetId: 'char_player' },
    { forgeRoot, projectRoot: REPO_ROOT }
  );
  const candidatePath = path.join(forgeRoot, 'external-player-candidate.png');
  await writeFile(candidatePath, await candidatePng());
  const result = await importFable5PrefabCharacterCandidate({
    assetId: 'char_player',
    file: candidatePath,
    jobPackPath: jobPack.pack.promptPath.replace(/prompt\.md$/, 'job-pack.json')
  }, { forgeRoot, projectRoot: REPO_ROOT });

  assert.equal(result.status, 'pending-inspection');
  assert.equal(result.approvedTreeSha256Before, result.approvedTreeSha256After);
  assert.equal(result.metadata.status, 'pending-inspection');
  assert.equal(result.metadata.approval.status, 'not-yet-submitted');
  assert.equal(result.metadata.export.allowed, false);
  assert.equal(result.metadata.runtime.allowed, false);
  assert.equal(result.metadata.mechanicalChecks.pivotAt32_120AllFrames, true);
  assert.equal(result.metadata.mechanicalChecks.eastNotExactMirrorOfWest, true);
  assert.deepEqual(
    JSON.parse(await readFile(result.output.metadata, 'utf8')).jobPack.path,
    jobPack.pack.promptPath.replace(/prompt\.md$/, 'job-pack.json')
  );
});

test('Fable5 intake rejects a pack for the wrong asset before candidate bytes can enter pending', async (t) => {
  const forgeRoot = await forgeFixture(t);
  const playerPack = await writeFable5PrefabCharacterJobPack(
    { assetId: 'char_player' },
    { forgeRoot, projectRoot: REPO_ROOT }
  );
  const candidatePath = path.join(forgeRoot, 'external-candidate.png');
  await writeFile(candidatePath, await candidatePng());
  await assert.rejects(
    () => importFable5PrefabCharacterCandidate({
      assetId: 'char_innkeeper',
      file: candidatePath,
      jobPackPath: playerPack.pack.promptPath.replace(/prompt\.md$/, 'job-pack.json')
    }, { forgeRoot, projectRoot: REPO_ROOT }),
    /does not match requested asset/
  );
});

test('Fable5 mechanical intake rejects exact west-to-east mirrors and does not need a human approval path', async () => {
  const png = await candidatePng({ mirroredEast: true });
  const inspection = await inspectFable5PrefabCharacterCandidate(png, {
    width: 640,
    height: 512
  });
  assert.equal(inspection.ok, false);
  assert.equal(inspection.checks.eastNotExactMirrorOfWest, false);
  assert.match(inspection.problems.join('\n'), /exact west mirrors/);
});

test('job-pack verification fails closed when the caller requests a legacy-shaped asset id', async (t) => {
  const forgeRoot = await forgeFixture(t);
  const jobPack = await writeFable5PrefabCharacterJobPack(
    { assetId: 'char_player' },
    { forgeRoot, projectRoot: REPO_ROOT }
  );
  await assert.rejects(
    () => verifyFable5PrefabCharacterJobPack({
      assetId: 'character.player',
      jobPackPath: jobPack.pack.promptPath.replace(/prompt\.md$/, 'job-pack.json')
    }, { forgeRoot, projectRoot: REPO_ROOT }),
    /does not match requested asset/
  );
});
