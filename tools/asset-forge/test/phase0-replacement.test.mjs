import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp as fsMkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test, { after } from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { exportApproved } from '../src/export/export-approved.mjs';
import { hashApprovedTree, sha256 } from '../src/hashing.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import {
  appendApprovalTransition, materializeProductionSourceSnapshot,
  promoteCandidate as promoteCandidatePublic,
  promoteCandidateInternal as promoteCandidate,
  promotionPreview as promotionPreviewPublic,
  promotionPreviewInternal as promotionPreview
} from '../src/jobs/lifecycle.mjs';
import {
  importCandidate, readProductionRecipeDraft
} from '../src/jobs/manual-import.mjs';
import { runJob } from '../src/jobs/run-job.mjs';
import { writeJobPack } from '../src/jobs/write-job-pack.mjs';
import { createMockPng } from '../src/providers/mock-provider.mjs';
import { validateWith } from '../src/schemas.mjs';
import { inspectHistoricalApprovedArtifact } from '../src/validate.mjs';

const TEMP_ROOTS = new Set();
async function mkdtemp(prefix) {
  const root = await fsMkdtemp(prefix);
  TEMP_ROOTS.add(root);
  return root;
}
after(async () => {
  await Promise.all([...TEMP_ROOTS].map((root) => rm(root, { recursive: true, force: true })));
});

function approval({ generationId, assetId, approvedPath, hash }) {
  return {
    generationId,
    assetId,
    reviewer: 'human',
    note: 'fixture human decision',
    approvedAt: '2026-07-15T00:00:00.000Z',
    sourcePath: approvedPath.replace('/approved/', '/pending/'),
    sourceSha256: hash,
    approvedPath,
    approvedSha256: hash
  };
}

function approvedMetadata(pending, record) {
  return {
    ...pending,
    status: 'approved',
    outputPath: record.approvedPath,
    outputSha256: record.approvedSha256,
    metadataPath: record.approvedPath.replace(/\.png$/, '.json'),
    approval: {
      reviewer: record.reviewer,
      note: record.note,
      approvedAt: record.approvedAt,
      approvedPath: record.approvedPath,
      approvedSha256: record.approvedSha256
    }
  };
}

async function filesOrEmpty(directory) {
  try { return await readdir(directory); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function withSyntheticTty(callback) {
  const streams = [process.stdin, process.stdout];
  const descriptors = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, 'isTTY'));
  try {
    for (const stream of streams) {
      Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    }
    return await callback();
  } finally {
    streams.forEach((stream, index) => {
      if (descriptors[index]) Object.defineProperty(stream, 'isTTY', descriptors[index]);
      else delete stream.isTTY;
    });
  }
}

test('legacy public promotion cannot use mutable isTTY flags or dependency overrides', async () => {
  const fakePreview = {
    generationId: 'gen_fake',
    sourceSha256: 'a'.repeat(64),
    approvedPath: 'generated/fields/approved/fake.png',
    note: 'spoof attempt',
    confirmationPhrase: `APPROVE LEGACY PROMOTION ${'b'.repeat(64)}`
  };
  const descriptors = [process.stdin, process.stdout]
    .map((stream) => Object.getOwnPropertyDescriptor(stream, 'isTTY'));
  try {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await assert.rejects(
      () => promoteCandidatePublic({
        preview: fakePreview,
        answer: fakePreview.confirmationPhrase,
        write: true
      }),
      /real interactive TTYs/
    );
  } finally {
    for (const [index, stream] of [process.stdin, process.stdout].entries()) {
      if (descriptors[index]) Object.defineProperty(stream, 'isTTY', descriptors[index]);
      else delete stream.isTTY;
    }
  }
  await assert.rejects(
    () => promotionPreviewPublic({ generationId: 'gen_fake' }, { root: '/tmp/fake' }),
    /accepts only generationId/
  );
  await assert.rejects(
    () => promoteCandidatePublic({ preview: fakePreview }, { root: '/tmp/fake' }),
    /accepts only preview, answer, and write/
  );
});

test('supersession transition preserves the former approval and appends immutable history', () => {
  const oldHash = 'a'.repeat(64);
  const newHash = 'b'.repeat(64);
  const oldRecord = approval({
    generationId: 'gen_old', assetId: 'building.inn',
    approvedPath: 'generated/buildings/approved/building_inn-old.png', hash: oldHash
  });
  const newRecord = approval({
    generationId: 'gen_new', assetId: 'building.inn',
    approvedPath: 'generated/buildings/approved/building_inn-new.png', hash: newHash
  });
  newRecord.note = 'fixture replacement decision';
  newRecord.approvedAt = '2026-07-15T01:00:00.000Z';
  const manifest = { schemaVersion: 1, approvals: [oldRecord] };
  const snapshot = structuredClone(manifest);
  const supersession = {
    assetId: 'building.inn',
    supersededGenerationId: 'gen_old',
    supersededApprovedPath: oldRecord.approvedPath,
    supersededApprovedSha256: oldHash,
    replacementGenerationId: 'gen_new',
    replacementApprovedPath: newRecord.approvedPath,
    replacementApprovedSha256: newHash,
    reviewer: 'human',
    note: 'fixture replacement decision',
    supersededAt: '2026-07-15T01:00:00.000Z'
  };
  const updated = appendApprovalTransition(manifest, newRecord, supersession);
  assert.deepEqual(manifest, snapshot);
  assert.deepEqual(updated.approvals, [oldRecord, newRecord]);
  assert.deepEqual(updated.supersessions, [supersession]);
  assert.equal(validateWith('approval-manifest.schema.json', updated).ok, true);
  assert.throws(
    () => appendApprovalTransition(updated, newRecord, { ...supersession, note: 'changed' }),
    /Replacement approval does not match its supersession decision/
  );
});

test('recipe reader is bounded, Forge-relative, and rejects symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-recipe-reader-'));
  await mkdir(path.join(root, 'recipes'));
  await writeFile(path.join(root, 'recipes', 'valid.json'), JSON.stringify({ assetId: 'field.grass' }));
  assert.deepEqual(
    await readProductionRecipeDraft('recipes/valid.json', { forgeRoot: root }),
    { assetId: 'field.grass' }
  );
  await symlink(path.join(root, 'recipes', 'valid.json'), path.join(root, 'recipes', 'link.json'));
  await assert.rejects(
    () => readProductionRecipeDraft('recipes/link.json', { forgeRoot: root }),
    /Symbolic links/
  );
  await writeFile(path.join(root, 'recipes', 'huge.json'), Buffer.alloc(1024 * 1024 + 1, 0x20));
  await assert.rejects(
    () => readProductionRecipeDraft('recipes/huge.json', { forgeRoot: root }),
    /1 MiB/
  );
  await assert.rejects(
    () => readProductionRecipeDraft('../outside.json', { forgeRoot: root }),
    /Unsafe relative path/
  );
});

test('manual import verifies its job pack before preserving a pending candidate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-job-pack-import-'));
  const packed = await writeJobPack({ assetId: 'character.player' }, { root, forgeRoot: FORGE_ROOT });
  const input = path.join(root, 'candidate.png');
  await writeFile(input, createMockPng({
    assetId: 'job-pack-input', outputContract: { width: 96, height: 120 }
  }));
  const imported = await importCandidate({
    assetId: 'character.player',
    file: input,
    jobPackPath: packed.result.jobPackPath
  }, { root, forgeRoot: FORGE_ROOT });
  assert.equal(imported.result.status, 'pending');
  assert.equal(imported.result.jobId, packed.pack.jobId);
  assert.equal(imported.result.warnings.some((warning) => warning.includes('verified job pack')), true);

  const tamperedRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-job-pack-tamper-'));
  const tampered = await writeJobPack({ assetId: 'character.player' }, {
    root: tamperedRoot, forgeRoot: FORGE_ROOT
  });
  const contractPath = path.join(tamperedRoot, tampered.pack.outputContractPath);
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  await writeFile(contractPath, JSON.stringify({ ...contract, width: contract.width + 1 }));
  const tamperedInput = path.join(tamperedRoot, 'candidate.png');
  await writeFile(tamperedInput, await readFile(input));
  await assert.rejects(
    () => importCandidate({
      assetId: 'character.player', file: tamperedInput,
      jobPackPath: tampered.result.jobPackPath
    }, { root: tamperedRoot, forgeRoot: FORGE_ROOT }),
    /does not match the current asset job contract/
  );
});

test('manual import retries converge after every durable write boundary', async () => {
  const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-import-crash-input-'));
  const input = path.join(inputRoot, 'candidate.png');
  await writeFile(input, createMockPng({
    assetId: 'crash-retry', outputContract: { width: 96, height: 120 }
  }));
  for (const boundary of ['afterSource', 'afterOutput', 'afterMetadata', 'afterLedger']) {
    const root = await mkdtemp(path.join(os.tmpdir(), `forge-import-${boundary}-`));
    await assert.rejects(
      () => importCandidate({ assetId: 'character.player', file: input }, {
        root,
        now: () => '2026-07-15T03:00:00.000Z',
        hooks: { [boundary]: () => { throw new Error(`crash at ${boundary}`); } }
      }),
      new RegExp(`crash at ${boundary}`)
    );
    const retried = await importCandidate({ assetId: 'character.player', file: input }, {
      root,
      now: () => '2026-07-15T03:00:00.000Z'
    });
    assert.equal(retried.resumed, true, boundary);
    const ledger = JSON.parse(await readFile(path.join(root, 'data', 'local', 'generations.json'), 'utf8'));
    assert.equal(ledger.results.filter((entry) => entry.id === retried.result.id).length, 1, boundary);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, retried.result.metadataPath), 'utf8')),
      retried.result,
      boundary
    );
  }
});

test('manual import validates recipe alpha bounds before writing candidate state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-import-zero-write-'));
  const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-import-zero-input-'));
  const input = path.join(inputRoot, 'opaque.png');
  const prepared = await sharp({
    create: { width: 64, height: 64, channels: 4, background: '#345678ff' }
  }).png().toBuffer();
  await writeFile(input, prepared);
  const { job } = await buildJob({ assetId: 'field.grass', provider: 'manual-import' });
  const originalPath = path.join(FORGE_ROOT, 'references', 'approved', 'world_visual_master.png');
  const original = await readFile(originalPath);
  const originalMetadata = await sharp(original).metadata();
  await assert.rejects(
    () => importCandidate({
      assetId: 'field.grass',
      file: input,
      productionRecipe: {
        waveId: 'phase0-zero-write',
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
        canvas: { width: 64, height: 64, baselineY: 0 },
        subjectBbox: { x: 0, y: 0, width: 1, height: 1 }
      }
    }, { root, forgeRoot: FORGE_ROOT }),
    /subject bbox does not match normalized output/
  );
  assert.deepEqual(await filesOrEmpty(path.join(root, 'generated')), []);
  assert.deepEqual(await filesOrEmpty(path.join(root, 'data', 'local')), []);
});

test('manual import rejects intermediate-directory symlinks in recipe source and composites', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-import-recipe-links-'));
  for (const directory of ['data', 'prompts', 'references']) {
    await cp(path.join(FORGE_ROOT, directory), path.join(root, directory), { recursive: true });
  }
  const outside = await mkdtemp(path.join(os.tmpdir(), 'forge-import-recipe-outside-'));
  const image = await sharp({
    create: { width: 64, height: 64, channels: 4, background: '#56789aff' }
  }).png().toBuffer();
  for (const name of ['source.png', 'mask.png', 'background.png']) {
    await writeFile(path.join(outside, name), image);
  }
  const real = path.join(root, 'tmp', 'imagegen', 'real');
  await mkdir(real, { recursive: true });
  for (const name of ['source.png', 'mask.png', 'background.png']) {
    await writeFile(path.join(real, name), image);
  }
  await symlink(outside, path.join(root, 'tmp', 'imagegen', 'link'));
  const input = path.join(outside, 'candidate.png');
  await writeFile(input, image);
  const { job } = await buildJob({ assetId: 'field.grass', provider: 'manual-import' }, { forgeRoot: root });
  const baseRecipe = {
    waveId: 'phase0-link-gate',
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
      path: 'tmp/imagegen/real/source.png', sha256: sha256(image), width: 64, height: 64,
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
  };
  const composite = {
    path: 'tmp/imagegen/real/mask.png', sha256: sha256(image), width: 64, height: 64,
    backgroundAssetId: 'field.grass',
    backgroundPath: 'tmp/imagegen/real/background.png', backgroundSha256: sha256(image)
  };
  for (const recipe of [
    { ...baseRecipe, source: { ...baseRecipe.source, path: 'tmp/imagegen/link/source.png' } },
    { ...baseRecipe, compositeMask: { ...composite, path: 'tmp/imagegen/link/mask.png' } },
    { ...baseRecipe, compositeMask: { ...composite, backgroundPath: 'tmp/imagegen/link/background.png' } }
  ]) {
    await assert.rejects(
      () => importCandidate({ assetId: 'field.grass', file: input, productionRecipe: recipe }, {
        root, forgeRoot: root
      }),
      /Symbolic links/
    );
  }
  assert.deepEqual(await filesOrEmpty(path.join(root, 'generated')), []);
});

test('preparing promotion retries converge across every persisted boundary', async () => {
  await withSyntheticTty(async () => {
    for (const boundary of ['afterApprovedFiles', 'afterAssetManifest', 'afterApprovalManifest', 'afterLedger']) {
      const root = await mkdtemp(path.join(os.tmpdir(), `forge-promote-${boundary}-`));
      await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
      const generated = await runJob({
        assetId: 'ui.dialogue_window', provider: 'mock', seed: boundary
      }, {
        root, forgeRoot: FORGE_ROOT, now: () => '2026-07-15T04:00:00.000Z'
      });
      const preview = await promotionPreview({ generationId: generated.result.id }, {
        root, forgeRoot: FORGE_ROOT
      });
      const options = {
        generationId: generated.result.id,
        reviewer: 'human',
        note: `synthetic crash recovery ${boundary}`,
        write: true,
        confirmed: true,
        expectedSourceSha256: preview.sourceSha256,
        expectedApprovedPath: preview.approvedPath
      };
      await assert.rejects(
        () => promoteCandidate(options, {
          root,
          forgeRoot: FORGE_ROOT,
          now: () => '2026-07-15T04:30:00.000Z',
          hooks: { [boundary]: () => { throw new Error(`crash at ${boundary}`); } }
        }),
        new RegExp(`crash at ${boundary}`)
      );
      const resumedPreview = await promotionPreview({ generationId: generated.result.id }, {
        root, forgeRoot: FORGE_ROOT
      });
      assert.equal(resumedPreview.resumed, true, boundary);
      assert.equal(resumedPreview.sourceSha256, preview.sourceSha256, boundary);
      assert.equal(resumedPreview.approvedPath, preview.approvedPath, boundary);
      const completed = await promoteCandidate(options, {
        root,
        forgeRoot: FORGE_ROOT,
        now: () => '2026-07-15T05:00:00.000Z'
      });
      assert.equal(completed.status, 'approved', boundary);
      assert.equal(completed.resumed, true, boundary);
      const journal = JSON.parse(await readFile(
        path.join(root, 'data', 'local', 'lifecycle', `${generated.result.id}.json`),
        'utf8'
      ));
      assert.equal(journal.status, 'complete', boundary);
      const ledger = JSON.parse(await readFile(path.join(root, 'data', 'local', 'generations.json'), 'utf8'));
      assert.equal(ledger.results.find((entry) => entry.id === generated.result.id).status, 'approved', boundary);
      const approvals = JSON.parse(await readFile(path.join(root, 'data', 'manifests', 'approvals.json'), 'utf8'));
      assert.equal(approvals.approvals.filter((entry) => entry.generationId === generated.result.id).length, 1, boundary);
    }
  });
});

test('promotion refuses a byte-identical approved destination symlink', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-promote-link-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const generated = await runJob({
    assetId: 'ui.dialogue_window', provider: 'mock', seed: 'approved-link'
  }, { root, forgeRoot: FORGE_ROOT, now: () => '2026-07-15T06:00:00.000Z' });
  const preview = await promotionPreview({ generationId: generated.result.id }, {
    root, forgeRoot: FORGE_ROOT
  });
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'forge-promote-link-target-')), 'same.png');
  await writeFile(outside, await readFile(path.join(root, generated.result.outputPath)));
  const destination = path.join(root, preview.approvedPath);
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(outside, destination);
  const beforeAssets = await readFile(path.join(root, 'data', 'manifests', 'assets.json'));
  const beforeApprovals = await readFile(path.join(root, 'data', 'manifests', 'approvals.json'));
  await withSyntheticTty(() => assert.rejects(
    () => promoteCandidate({
      generationId: generated.result.id,
      reviewer: 'human',
      note: 'synthetic symlink refusal',
      write: true,
      confirmed: true,
      expectedSourceSha256: preview.sourceSha256,
      expectedApprovedPath: preview.approvedPath
    }, {
      root, forgeRoot: FORGE_ROOT, now: () => '2026-07-15T06:30:00.000Z'
    }),
    /Refusing to overwrite|Symbolic links/
  ));
  assert.deepEqual(await readFile(path.join(root, 'data', 'manifests', 'assets.json')), beforeAssets);
  assert.deepEqual(await readFile(path.join(root, 'data', 'manifests', 'approvals.json')), beforeApprovals);
});

test('human promotion alone moves a verified source snapshot from pending provenance to approved history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-source-snapshot-promotion-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const assetId = 'field.grass';
  const assetsPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assets = JSON.parse(await readFile(assetsPath, 'utf8'));
  const grass = assets.assets.find((entry) => entry.assetId === assetId);
  Object.assign(grass, {
    status: 'missing', pendingGenerationIds: [], rejectedGenerationIds: [], lastUpdated: null
  });
  delete grass.approvedPath;
  delete grass.exportPath;
  await writeFile(assetsPath, JSON.stringify(assets));
  const approvalsPath = path.join(root, 'data', 'manifests', 'approvals.json');
  const approvals = JSON.parse(await readFile(approvalsPath, 'utf8'));
  approvals.approvals = approvals.approvals.filter((entry) => entry.assetId !== assetId);
  await writeFile(approvalsPath, JSON.stringify(approvals));

  const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-source-snapshot-input-'));
  const input = path.join(inputRoot, 'grass.png');
  const prepared = await sharp({
    create: { width: 64, height: 64, channels: 4, background: '#4f8055ff' }
  }).png().toBuffer();
  await writeFile(input, prepared);
  const { job } = await buildJob({ assetId, provider: 'manual-import' });
  const sourcePath = path.join(FORGE_ROOT, 'references', 'approved', 'world_visual_master.png');
  const source = await readFile(sourcePath);
  const sourceMetadata = await sharp(source).metadata();
  const imported = await importCandidate({
    assetId,
    file: input,
    productionRecipe: {
      waveId: 'phase0-source-boundary',
      assetId,
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
        sha256: sha256(source),
        width: sourceMetadata.width,
        height: sourceMetadata.height,
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
  }, { root, forgeRoot: FORGE_ROOT, now: () => '2026-07-15T07:00:00.000Z' });
  const materialized = await materializeProductionSourceSnapshot({ generationId: imported.result.id }, {
    root, forgeRoot: FORGE_ROOT
  });
  const pendingSnapshot = materialized.result.productionRecipe.sourceSnapshot;
  assert.match(pendingSnapshot.path, /^generated\/fields\/pending\/sources\//);
  const pendingBytes = await readFile(path.join(root, pendingSnapshot.path));
  const preview = await promotionPreview({ generationId: imported.result.id }, {
    root, forgeRoot: FORGE_ROOT
  });
  const promoted = await withSyntheticTty(() => promoteCandidate({
    generationId: imported.result.id,
    reviewer: 'human',
    note: 'synthetic source-boundary fixture',
    write: true,
    confirmed: true,
    expectedSourceSha256: preview.sourceSha256,
    expectedApprovedPath: preview.approvedPath
  }, {
    root, forgeRoot: FORGE_ROOT, now: () => '2026-07-15T07:30:00.000Z'
  }));
  const approvedSnapshot = promoted.result.productionRecipe.sourceSnapshot;
  assert.match(approvedSnapshot.path, /^generated\/fields\/approved\//);
  assert.notEqual(approvedSnapshot.path, pendingSnapshot.path);
  assert.deepEqual(await readFile(path.join(root, approvedSnapshot.path)), pendingBytes);
  assert.deepEqual(await readFile(path.join(root, pendingSnapshot.path)), pendingBytes);
});

test('replacement preview requires the current approved generation and verifies its bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-supersede-preview-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const assetId = 'ui.dialogue_window';
  const oldGenerated = await runJob({ assetId, provider: 'mock', seed: 'old-approved' }, {
    root, forgeRoot: FORGE_ROOT, now: () => '2026-07-15T00:00:00.000Z'
  });
  const oldBytes = await readFile(path.join(root, oldGenerated.result.outputPath));
  const oldHash = oldGenerated.result.outputSha256;
  const oldPath = `generated/ui/approved/ui_dialogue_window-${oldHash.slice(0, 16)}.png`;
  await mkdir(path.dirname(path.join(root, oldPath)), { recursive: true });
  await writeFile(path.join(root, oldPath), oldBytes);
  const assetsPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assets = JSON.parse(await readFile(assetsPath, 'utf8'));
  const asset = assets.assets.find((entry) => entry.assetId === assetId);
  Object.assign(asset, {
    status: 'approved', approvedPath: oldPath, lastUpdated: '2026-07-15T00:00:00.000Z'
  });
  await writeFile(assetsPath, JSON.stringify(assets));
  const approvalsPath = path.join(root, 'data', 'manifests', 'approvals.json');
  const approvals = JSON.parse(await readFile(approvalsPath, 'utf8'));
  const oldApproval = approval({
    generationId: oldGenerated.result.id, assetId, approvedPath: oldPath, hash: oldHash
  });
  oldApproval.sourcePath = oldGenerated.result.outputPath;
  approvals.approvals.push(oldApproval);
  await writeFile(approvalsPath, JSON.stringify(approvals));
  await writeFile(path.join(root, oldPath.replace(/\.png$/, '.json')), JSON.stringify(
    approvedMetadata(oldGenerated.result, oldApproval)
  ));
  const generated = await runJob({ assetId, provider: 'mock', seed: 'replacement' }, {
    root, forgeRoot: FORGE_ROOT
  });
  await assert.rejects(
    () => promotionPreview({ generationId: generated.result.id }, { root, forgeRoot: FORGE_ROOT }),
    /pass --supersedes/
  );
  const preview = await promotionPreview({
    generationId: generated.result.id,
    supersedesGenerationId: oldGenerated.result.id
  }, { root, forgeRoot: FORGE_ROOT });
  assert.deepEqual(preview.supersedes, {
    generationId: oldGenerated.result.id, approvedPath: oldPath, approvedSha256: oldHash
  });
  const ambiguousApprovals = structuredClone(approvals);
  ambiguousApprovals.approvals.push(structuredClone(oldApproval));
  await writeFile(approvalsPath, JSON.stringify(ambiguousApprovals));
  await assert.rejects(
    () => promotionPreview({
      generationId: generated.result.id,
      supersedesGenerationId: oldGenerated.result.id
    }, { root, forgeRoot: FORGE_ROOT }),
    /duplicate approval generation id/i
  );
  await writeFile(approvalsPath, JSON.stringify(approvals));
  await writeFile(path.join(root, oldPath), Buffer.from(oldBytes).fill(0, 8, 16));
  await assert.rejects(
    () => promotionPreview({
      generationId: generated.result.id,
      supersedesGenerationId: oldGenerated.result.id
    }, { root, forgeRoot: FORGE_ROOT }),
    /hash changed/
  );
});

test('approved export follows only the replacement current pointer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-supersede-export-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const assetId = 'object.inspection_table';
  const generated = await runJob({ assetId, provider: 'mock', seed: 'export-replacement' }, {
    root, forgeRoot: FORGE_ROOT, now: () => '2026-07-15T02:00:00.000Z'
  });
  const newBytes = await readFile(path.join(root, generated.result.outputPath));
  const newHash = generated.result.outputSha256;
  const newPath = `generated/objects/approved/object_inspection_table-${newHash.slice(0, 16)}.png`;
  await mkdir(path.dirname(path.join(root, newPath)), { recursive: true });
  await writeFile(path.join(root, newPath), newBytes);
  const newApproval = {
    generationId: generated.result.id,
    assetId,
    reviewer: 'human',
    note: 'fixture replacement approval',
    approvedAt: '2026-07-15T02:30:00.000Z',
    sourcePath: generated.result.outputPath,
    sourceSha256: newHash,
    approvedPath: newPath,
    approvedSha256: newHash
  };
  const newApprovedMetadata = {
    ...generated.result,
    status: 'approved',
    outputPath: newPath,
    metadataPath: newPath.replace(/\.png$/, '.json'),
    approval: {
      reviewer: 'human',
      note: newApproval.note,
      approvedAt: newApproval.approvedAt,
      approvedPath: newPath,
      approvedSha256: newHash
    }
  };
  await writeFile(path.join(root, newApprovedMetadata.metadataPath), JSON.stringify(newApprovedMetadata));

  const oldGenerated = await runJob({ assetId, provider: 'mock', seed: 'export-old' }, {
    root, forgeRoot: FORGE_ROOT, now: () => '2026-07-15T01:00:00.000Z'
  });
  const oldBytes = await readFile(path.join(root, oldGenerated.result.outputPath));
  const oldHash = oldGenerated.result.outputSha256;
  const oldPath = `generated/objects/approved/object_inspection_table-${oldHash.slice(0, 16)}.png`;
  await writeFile(path.join(root, oldPath), oldBytes);
  const oldApproval = approval({
    generationId: oldGenerated.result.id, assetId, approvedPath: oldPath, hash: oldHash
  });
  oldApproval.sourcePath = oldGenerated.result.outputPath;
  await writeFile(path.join(root, oldPath.replace(/\.png$/, '.json')), JSON.stringify(
    approvedMetadata(oldGenerated.result, oldApproval)
  ));
  const supersession = {
    assetId,
    supersededGenerationId: oldApproval.generationId,
    supersededApprovedPath: oldPath,
    supersededApprovedSha256: oldHash,
    replacementGenerationId: newApproval.generationId,
    replacementApprovedPath: newPath,
    replacementApprovedSha256: newHash,
    reviewer: 'human',
    note: newApproval.note,
    supersededAt: newApproval.approvedAt
  };
  const assetsPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assets = JSON.parse(await readFile(assetsPath, 'utf8'));
  for (const entry of assets.assets) {
    Object.assign(entry, { status: 'missing', pendingGenerationIds: [], rejectedGenerationIds: [], lastUpdated: null });
    delete entry.approvedPath;
    delete entry.exportPath;
  }
  Object.assign(assets.assets.find((entry) => entry.assetId === assetId), {
    status: 'approved', approvedPath: newPath, lastUpdated: newApproval.approvedAt
  });
  await writeFile(assetsPath, JSON.stringify(assets));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: [oldApproval, newApproval],
    supersessions: [supersession]
  }));

  const exported = await exportApproved({}, { root, forgeRoot: FORGE_ROOT });
  assert.deepEqual(exported.manifest.assets.map((entry) => entry.assetId), [assetId]);
  assert.equal(exported.manifest.assets[0].sha256, newHash);
  assert.equal(exported.manifest.assets[0].publicPath.includes(newHash.slice(0, 16)), true);
  assert.equal(exported.manifest.assets.some((entry) => entry.sha256 === oldHash), false);

  const historicalForge = await mkdtemp(path.join(os.tmpdir(), 'forge-history-contract-change-'));
  for (const directory of ['data', 'prompts', 'references']) {
    await cp(path.join(FORGE_ROOT, directory), path.join(historicalForge, directory), { recursive: true });
  }
  for (const directory of ['prompts', 'decisions']) {
    await cp(path.join(FORGE_ROOT, 'review', directory), path.join(historicalForge, 'review', directory), { recursive: true });
  }
  const objectDefinitionsPath = path.join(historicalForge, 'data', 'asset-definitions', 'objects.json');
  const objectDefinitions = JSON.parse(await readFile(objectDefinitionsPath, 'utf8'));
  const changedDefinition = objectDefinitions.assets.find((entry) => entry.id === assetId);
  changedDefinition.pixelArt.logicalSpriteSize = { width: 128, height: 128 };
  changedDefinition.defaultReferenceIds = [
    'world_visual_master', 'intake_20260713_object_status_markers'
  ];
  await writeFile(objectDefinitionsPath, JSON.stringify(objectDefinitions));
  assert.equal((await inspectHistoricalApprovedArtifact(root, oldApproval, {
    forgeRoot: historicalForge,
    category: 'object'
  })).problem, null, 'historical approval does not inherit the replacement definition contract');

  const oldMetadataPath = path.join(root, oldPath.replace(/\.png$/, '.json'));
  const originalOldMetadata = await readFile(oldMetadataPath);
  const tamperedOldMetadata = JSON.parse(originalOldMetadata.toString('utf8'));
  tamperedOldMetadata.approval.note = 'tampered historical decision';
  await writeFile(oldMetadataPath, JSON.stringify(tamperedOldMetadata));
  await assert.rejects(
    () => exportApproved({}, { root, forgeRoot: FORGE_ROOT }),
    /Invalid superseded approval history.*metadata does not match/
  );
  await writeFile(oldMetadataPath, originalOldMetadata);
  await rm(oldMetadataPath);
  await assert.rejects(
    () => exportApproved({}, { root, forgeRoot: FORGE_ROOT }),
    /Invalid superseded approval history.*ENOENT/
  );
  await writeFile(oldMetadataPath, originalOldMetadata);

  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: [{ ...oldApproval, sourceSha256: '0'.repeat(64) }, newApproval],
    supersessions: [supersession]
  }));
  await assert.rejects(
    () => exportApproved({}, { root, forgeRoot: FORGE_ROOT }),
    /approval source hash does not match/
  );
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify({
    schemaVersion: 1,
    approvals: [oldApproval, newApproval],
    supersessions: [supersession]
  }));

  const staleAssets = JSON.parse(await readFile(assetsPath, 'utf8'));
  staleAssets.assets.find((entry) => entry.assetId === assetId).approvedPath = oldPath;
  await writeFile(assetsPath, JSON.stringify(staleAssets));
  await assert.rejects(
    () => exportApproved({}, { root, forgeRoot: FORGE_ROOT }),
    /current asset pointer is not the terminal active approval|active approval is not the current asset pointer/i
  );
  await writeFile(assetsPath, JSON.stringify(assets));

  const duplicateApprovals = {
    schemaVersion: 1,
    approvals: [
      oldApproval,
      newApproval,
      {
        ...newApproval,
        generationId: 'gen_duplicate_active',
        approvedPath: 'generated/objects/approved/object_inspection_table-duplicate.png'
      }
    ],
    supersessions: [supersession]
  };
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify(duplicateApprovals));
  await assert.rejects(
    () => exportApproved({}, { root, forgeRoot: FORGE_ROOT }),
    /multiple active approvals/i
  );
});
