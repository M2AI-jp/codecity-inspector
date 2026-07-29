import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { FORGE_ROOT } from '../src/config.mjs';
import {
  buildFable5PrefabInteriorJob,
  fable5InteriorContractProblems,
  writeFable5PrefabInteriorJobPack
} from '../src/fable5-prefab-interior-jobs.mjs';
import {
  importFable5PrefabInteriorCandidate,
  inspectFable5PrefabInteriorCandidate,
  verifyFable5PrefabInteriorJobPack
} from '../src/fable5-prefab-interior-intake.mjs';
import { main } from '../src/cli.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

async function forgeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-fable5-interior-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(FORGE_ROOT, 'contracts', 'fable5-prefab'), path.join(root, 'contracts', 'fable5-prefab'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'prompts', 'fable5-prefab'), path.join(root, 'prompts', 'fable5-prefab'), { recursive: true });
  return root;
}

async function interiorPng(width, height, { transparentAt = null, chromaAt = null } = {}) {
  const raw = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    raw[index * 4] = 82;
    raw[index * 4 + 1] = 58;
    raw[index * 4 + 2] = 42;
    raw[index * 4 + 3] = 255;
  }
  if (transparentAt) raw.set([0, 0, 0, 0], (transparentAt.y * width + transparentAt.x) * 4);
  if (chromaAt) raw.set([255, 0, 255, 255], (chromaAt.y * width + chromaAt.x) * 4);
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

test('Fable5 interior preflight locks the three building-runtime rectangles, pivots, and approved references', async () => {
  const expected = {
    'bld_m_inn.interior': { size: [192, 192], footprint: { w: 3, h: 3 }, pivot: { x: 0, y: 192 }, buildingId: 'inn', refs: ['user_target_town_current', 'user_building_inn'] },
    'bld_l_town_hall.interior': { size: [256, 256], footprint: { w: 4, h: 4 }, pivot: { x: 0, y: 256 }, buildingId: 'city-hall', refs: ['user_target_town_current', 'user_building_town_hall'] },
    'bld_m_house.interior': { size: [256, 256], footprint: { w: 4, h: 4 }, pivot: { x: 0, y: 256 }, buildingId: 'residence', refs: ['user_target_town_current', 'user_building_houses_shops_ruins'] }
  };
  for (const [assetId, details] of Object.entries(expected)) {
    const plan = await buildFable5PrefabInteriorJob({ assetId }, { projectRoot: REPO_ROOT });
    assert.equal(plan.status, 'dry-run');
    assert.deepEqual([plan.job.outputContract.width, plan.job.outputContract.height], details.size);
    assert.deepEqual(plan.job.outputContract.footprint, details.footprint);
    assert.deepEqual(plan.job.outputContract.pivot, details.pivot);
    assert.equal(plan.job.outputContract.composition.buildingId, details.buildingId);
    assert.deepEqual(plan.pack.referenceIds, details.refs);
    assert.equal(plan.job.references.every((reference) => reference.verifiedAtAssembly), true);
    assert.equal(plan.job.references.every((reference) => reference.copiedIntoForge === false), true);
    assert.equal(plan.job.guards.automaticApproval, false);
    assert.equal(plan.job.guards.runtimeInstall, false);
  }
});

test('Fable5 interior contracts reject a clipped footprint or a changed building-runtime anchor', async () => {
  const original = JSON.parse(await readFile(
    path.join(FORGE_ROOT, 'contracts', 'fable5-prefab', 'interior.residence.contract-draft.json'),
    'utf8'
  ));
  const clipped = structuredClone(original);
  clipped.footprint.h = 3;
  const moved = structuredClone(original);
  moved.composition.runtimeAnchors.entryFoot.y -= 1;
  const weakened = structuredClone(original);
  weakened.composition.visibleKit.forbidden.pop();
  assert.match(fable5InteriorContractProblems(clipped, 'bld_m_house.interior').join('\n'), /footprint/);
  assert.match(fable5InteriorContractProblems(moved, 'bld_m_house.interior').join('\n'), /entry\/exit\/camera\/interaction anchors/);
  assert.match(fable5InteriorContractProblems(weakened, 'bld_m_house.interior').join('\n'), /visible-kit/);
});

test('Fable5 interior job pack is deterministic and writes no pixels or approved state', async (t) => {
  const forgeRoot = await forgeFixture(t);
  const dryRun = await writeFable5PrefabInteriorJobPack(
    { assetId: 'bld_m_inn.interior', dryRun: true },
    { forgeRoot, projectRoot: REPO_ROOT }
  );
  assert.equal(dryRun.status, 'dry-run');
  await assert.rejects(() => readdir(path.join(forgeRoot, 'generated')), { code: 'ENOENT' });

  const written = await writeFable5PrefabInteriorJobPack(
    { assetId: 'bld_m_inn.interior' },
    { forgeRoot, projectRoot: REPO_ROOT }
  );
  assert.equal(written.status, 'job-pack');
  assert.equal(written.approvedTreeSha256Before, written.approvedTreeSha256After);
  assert.deepEqual((await readdir(written.output.directory)).sort(), [
    'intake-guide.md', 'job-pack.json', 'job.json', 'output-contract.json', 'prompt.md', 'references.json'
  ]);
  assert.match(await readFile(written.output.importGuide, 'utf8'), /product owner/);
});

test('Fable5 interior intake copies an exact RGBA candidate only to pending and binds the job receipt', async (t) => {
  const forgeRoot = await forgeFixture(t);
  const jobPack = await writeFable5PrefabInteriorJobPack(
    { assetId: 'bld_l_town_hall.interior' },
    { forgeRoot, projectRoot: REPO_ROOT }
  );
  const candidatePath = path.join(forgeRoot, 'external-city-hall.png');
  await writeFile(candidatePath, await interiorPng(256, 256));
  const result = await importFable5PrefabInteriorCandidate({
    assetId: 'bld_l_town_hall.interior',
    file: candidatePath,
    jobPackPath: jobPack.pack.promptPath.replace(/prompt\.md$/, 'job-pack.json')
  }, { forgeRoot, projectRoot: REPO_ROOT });
  assert.equal(result.status, 'pending-inspection');
  assert.equal(result.approvedTreeSha256Before, result.approvedTreeSha256After);
  assert.equal(result.metadata.pendingPath.startsWith('generated/interiors/pending/'), true);
  assert.equal(result.metadata.approval.status, 'not-yet-submitted');
  assert.equal(result.metadata.runtime.allowed, false);
  assert.equal(result.metadata.mechanicalChecks.semanticSourceBoundsOpaque, true);
  assert.equal(result.metadata.mechanicalChecks.noOpaqueChromaKeyPixels, true);
});

test('Fable5 interior intake rejects semantic holes, chroma residue, and wrong asset job packs', async (t) => {
  const cityHall = await buildFable5PrefabInteriorJob(
    { assetId: 'bld_l_town_hall.interior' }, { projectRoot: REPO_ROOT }
  );
  const firstBound = cityHall.job.outputContract.composition.semanticSource.requiredOpaqueRects[0];
  const hole = await inspectFable5PrefabInteriorCandidate(
    await interiorPng(256, 256, { transparentAt: { x: firstBound.x, y: firstBound.y } }),
    cityHall.job.outputContract
  );
  assert.equal(hole.ok, false);
  assert.match(hole.problems.join('\n'), /semantic source bound/);
  const chroma = await inspectFable5PrefabInteriorCandidate(
    await interiorPng(256, 256, { chromaAt: { x: 0, y: 0 } }),
    cityHall.job.outputContract
  );
  assert.equal(chroma.ok, false);
  assert.match(chroma.problems.join('\n'), /chroma-key/);

  const forgeRoot = await forgeFixture(t);
  const innPack = await writeFable5PrefabInteriorJobPack(
    { assetId: 'bld_m_inn.interior' }, { forgeRoot, projectRoot: REPO_ROOT }
  );
  const candidatePath = path.join(forgeRoot, 'external-residence.png');
  await writeFile(candidatePath, await interiorPng(256, 256));
  await assert.rejects(
    () => importFable5PrefabInteriorCandidate({
      assetId: 'bld_m_house.interior',
      file: candidatePath,
      jobPackPath: innPack.pack.promptPath.replace(/prompt\.md$/, 'job-pack.json')
    }, { forgeRoot, projectRoot: REPO_ROOT }),
    /does not match requested asset/
  );
  await assert.rejects(
    () => verifyFable5PrefabInteriorJobPack({
      assetId: 'interior.house',
      jobPackPath: innPack.pack.promptPath.replace(/prompt\.md$/, 'job-pack.json')
    }, { forgeRoot, projectRoot: REPO_ROOT }),
    /does not match requested asset/
  );
});

test('Fable5 interior CLI exposes only job-pack and pending-intake routes', async () => {
  const help = await main(['help']);
  assert.ok(help.commands.includes(
    'make-fable5-interior-job --asset <bld_m_inn.interior|bld_l_town_hall.interior|bld_m_house.interior> [--dry-run]'
  ));
  assert.ok(help.commands.includes(
    'import-fable5-interior --asset <interior-id> --file <candidate.png> --job-pack generated/jobs/<job-id>/job-pack.json [--dry-run]'
  ));
  await assert.rejects(
    () => main(['make-fable5-interior-job', '--asset', 'bld_m_inn.interior', '--approved', 'true']),
    /does not accept option/
  );
});
