import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FORGE_ROOT } from '../src/config.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import { promoteCandidateInternal as promoteCandidate } from '../src/jobs/lifecycle.mjs';
import { processCandidate } from '../src/jobs/process-candidate.mjs';
import { runJob } from '../src/jobs/run-job.mjs';
import { validateRepository } from '../src/validate.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const EXPECTED_REFERENCE_HASHES = new Map([
  ['world_visual_master', 'cc2e822092b0a1cff798b540c8898057841def7b4a0d7b6c954da6feb7ae7e5d'],
  ['character_visual_master', '78436f089e03ae6fb15605ccaeae12513cd9393dd0e3355d4ef6df04bfb430ea'],
  ['intake_20260713_ui_guild_roster', '5104c1dc835712a3d3bd6c50dc89b19f4a9489e27c655f15dd63f3ffdbe9bc99'],
  ['intake_20260713_ui_inspection_report', 'c4c14e83e5f4e5fec8f7eaea537e6befa5f2762aaed11d07a5a86c05b6294892'],
  ['intake_20260713_ui_dialogue_frames', '60a2255fe72e2e96c91f00caa93fa7f4906f57fc1f8f0332bdbe91648b9ba29d'],
  ['intake_20260713_field_harbor_docks_tiles', '44f07d8922eb87d131645b5f68c8a9f6ee06f0dd78f9e2d59b854a74a0740580'],
  ['intake_20260713_object_status_markers', 'e3d2f177bf10bc07d1362251d8aa80d490fc6f58999d24b06a66c34a177e1d1b'],
  ['intake_20260713_building_warehouse', '36b9a4f7dc5c9d7693fd1346a559735a36062aadeac8483beb2992e0ca3be4bc'],
  ['intake_20260713_object_street_props', 'b8f5879728932dce2b56428b65e4531cc66029f39848d1ef831d402ca17d4d85'],
  ['intake_20260713_building_houses_shops_ruins', 'ec8afeadfe709cc6ae489d3e895a2a290eff79cb598db8c1925f548fd9e14225'],
  ['intake_20260713_building_watchtower', '414a38a8621c25a0b812426abbc40b46a97444923148b967be8493bc4e2a277a'],
  ['intake_20260713_building_guild_variant_01', 'e6d0904d6b2ac1af8ebf8d01df1662ccab49489ead967e0e244f4db6135701c9'],
  ['intake_20260713_building_guild_variant_02', '764747f9059825cde6836c8951946afb459f8eacb3441d6ac58026d76f6d1597'],
  ['intake_20260713_building_guild_variant_03', 'ea65fa6023f2fa96c44a22885b1957f94b5fe923b52c3ee0edc6e66fe2b6b71d'],
  ['intake_20260713_building_guild_variant_04', '4e5844615e24eba837e181cce1f23001cc2b7f7ab13fd9cd189b5e6d86f4a6b3'],
  ['intake_20260713_building_workshop', 'a28070edeec7d93df772ffe856bcaa49a11ba8ec55e60ddd5af15eab56f23ac7'],
  ['intake_20260713_building_town_hall', 'af560250efd3d45fb00c7ba4a486e6245db5318c564bc72a8a11ba84bbbfb1c9'],
  ['intake_20260713_building_inn', '78b18d8ee84c8bd57444babe6923cdb3b16fcfcf592ebbf3411df74bd16c069a'],
  ['intake_20260713_field_stairs_bridges_cliffs', '24e899bfb25552aa96e453a74e574337fc65481791fa572accdd8758615387bd'],
  ['intake_20260713_field_cobblestone_roads', 'f732a849dd88138e3acccc24970bef9e923302fec1aa01ffac195b8195cfff3d']
]);

const RETIRED_CHARACTER_REFERENCE = {
  id: ['intake', '20260712', 'character', 'style', 'sheet'].join('_'),
  path: ['character', 'style', 'reference', 'sheet.png'].join('_'),
  sha256: [
    '910e1fdc2773018882e74918d492b778',
    '91869720b3affa170fb96ec2ed7db08b'
  ].join('')
};

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function definitions(root = FORGE_ROOT) {
  const directory = path.join(root, 'data', 'asset-definitions');
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  return (await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(directory, name))))))
    .flatMap((catalog) => catalog.assets);
}

async function filesBelow(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(candidate));
    else found.push(candidate);
  }
  return found;
}

async function forgeFixture(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['data', 'prompts', 'references']) {
    await cp(path.join(FORGE_ROOT, directory), path.join(root, directory), { recursive: true });
  }
  for (const directory of ['prompts', 'decisions']) {
    await cp(path.join(FORGE_ROOT, 'review', directory), path.join(root, 'review', directory), { recursive: true });
  }
  return root;
}

test('approved references, the pending cutaway reference, and the released 78 candidates retain verified provenance', async () => {
  const manifest = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'references.json')));
  const approvedReferences = manifest.references.filter((reference) => reference.status === 'approved');
  const pendingReferences = manifest.references.filter((reference) => reference.status === 'pending');
  assert.equal(approvedReferences.length, 20);
  assert.equal(pendingReferences.length, 1);
  assert.deepEqual(new Set(approvedReferences.map((reference) => reference.id)), new Set(EXPECTED_REFERENCE_HASHES.keys()));
  for (const reference of approvedReferences) {
    const bytes = await readFile(path.join(FORGE_ROOT, reference.path));
    assert.equal(reference.sha256, EXPECTED_REFERENCE_HASHES.get(reference.id));
    assert.equal(sha256(bytes), reference.sha256);
    if (reference.providedBy === 'human') {
      assert.match(reference.licenseNote, /project owner explicitly approved/);
      assert.equal(reference.generationProvenance, undefined);
    } else {
      assert.equal(reference.id, 'character_visual_master');
      assert.equal(reference.providedBy, 'codex-imagegen-built-in');
      assert.match(reference.licenseNote, /ChatGPT built-in generated.*project owner authorized.*Lead visually approved/);
      assert.equal(reference.generationProvenance?.decision.reviewer, 'lead');
    }
  }
  const cutaway = pendingReferences[0];
  assert.equal(cutaway.id, 'cutaway_interior_visual_reference');
  assert.equal(cutaway.providedBy, 'codex-imagegen-built-in');
  assert.equal(cutaway.sha256, 'e88b18da60d9c314ecc83c30573d6423129525fb684ce57496c240c1dbf19535');
  assert.equal(sha256(await readFile(path.join(FORGE_ROOT, cutaway.path))), cutaway.sha256);
  assert.equal(cutaway.candidateProvenance?.sourceOriginal.sha256, cutaway.sha256);
  assert.equal(cutaway.candidateProvenance?.transformation, 'none');
  assert.equal(cutaway.generationProvenance, undefined);
  assert.deepEqual((await readdir(path.join(FORGE_ROOT, 'references', 'pending'))).sort(), [
    'cutaway_interior_visual_reference.png'
  ]);
  const worldHash = EXPECTED_REFERENCE_HASHES.get('world_visual_master');
  assert.equal(sha256(await readFile(path.join(REPO_ROOT, '9e28e43d-56a5-44aa-aa1d-b59461e625dd.png'))), worldHash);

  const approvals = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'approvals.json')));
  const assets = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'assets.json')));
  const required = (await definitions()).filter((asset) => asset.required);
  assert.equal(approvals.approvals.length, 78);
  assert.deepEqual(new Set(approvals.approvals.map((approval) => approval.assetId)), new Set(required.map((asset) => asset.id)));
  assert.equal(approvals.approvals.every((approval) => approval.reviewer === 'human'
    && approval.note === 'Required 78 batch approval cb4aa5f67c91a329c140f4a09bdc39b960ccce8a76334957066d7c0e83540042'), true);
  assert.equal(assets.assets.filter((asset) => required.some((definition) => definition.id === asset.assetId))
    .every((asset) => ['approved', 'exported'].includes(asset.status) && typeof asset.approvedPath === 'string'), true);
  const generations = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'local', 'generations.json'))).results;
  const releasedGenerationIds = new Set(approvals.approvals.map((approval) => approval.generationId));
  const releasedGenerations = generations.filter((generation) => releasedGenerationIds.has(generation.id));
  assert.equal(releasedGenerationIds.size, 78);
  assert.equal(releasedGenerations.length, 78);
  assert.equal(new Set(releasedGenerations.map((generation) => generation.assetId)).size, 78);
  assert.deepEqual(
    new Set(generations.filter((generation) => generation.status === 'approved').map((generation) => generation.id)),
    releasedGenerationIds
  );
  assert.equal(releasedGenerations.every((generation) => generation.status === 'approved'
    && generation.productionRecipe?.sourceSnapshot
    && generation.productionRecipe.sourceSnapshot.sha256 === generation.productionRecipe.source.sha256
    && generation.productionRecipe.sourceSnapshot.width === generation.productionRecipe.source.width
    && generation.productionRecipe.sourceSnapshot.height === generation.productionRecipe.source.height), true);
  const snow = releasedGenerations.find((generation) => generation.assetId === 'field.snow');
  const sand = releasedGenerations.find((generation) => generation.assetId === 'field.sand');
  assert.equal(snow?.productionRecipe.method, 'imagegen');
  assert.deepEqual(snow?.referenceImageIds, [
    'world_visual_master', 'intake_20260713_field_stairs_bridges_cliffs'
  ]);
  assert.equal(sand, undefined, 'the optional sand candidate is retired from the completion ledger');
  const approvedFiles = (await filesBelow(path.join(FORGE_ROOT, 'generated')))
    .filter((file) => file.includes(`${path.sep}approved${path.sep}`));
  const expectedApprovedFiles = new Set(releasedGenerations.flatMap((generation) => [
    path.join(FORGE_ROOT, generation.outputPath),
    path.join(FORGE_ROOT, generation.metadataPath),
    path.join(FORGE_ROOT, generation.productionRecipe.sourceSnapshot.path)
  ]));
  assert.deepEqual(new Set(approvedFiles), expectedApprovedFiles);
  for (const generation of releasedGenerations) {
    assert.equal(
      sha256(await readFile(path.join(FORGE_ROOT, generation.productionRecipe.sourceSnapshot.path))),
      generation.productionRecipe.source.sha256
    );
    assert.equal(sha256(await readFile(path.join(FORGE_ROOT, generation.outputPath))), generation.outputSha256);
  }
});

test('the retired character reference id, path, and hash are absent from the forge tree', async () => {
  const files = await filesBelow(FORGE_ROOT);
  for (const file of files) {
    const bytes = await readFile(file);
    for (const retiredValue of Object.values(RETIRED_CHARACTER_REFERENCE)) {
      assert.equal(bytes.includes(Buffer.from(retiredValue)), false, `${path.relative(FORGE_ROOT, file)} contains retired provenance`);
    }
  }
});

test('all 78 required definitions use the world master; non-characters also use a targeted primary sheet', async () => {
  const assets = await definitions();
  const required = assets.filter((asset) => asset.required);
  const references = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'manifests', 'references.json'))).references;
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  assert.equal(required.length, 78);
  const counts = required.reduce((result, asset) => ({
    ...result,
    [asset.category]: (result[asset.category] ?? 0) + 1
  }), {});
  assert.deepEqual(counts, {
    building: 17, character: 22, effect: 2, field: 19, object: 18
  });
  const world = byId.get('world_visual_master');
  assert.equal(required.every((asset) => world.targetAssetIds.includes(asset.id)), true);
  assert.equal(world.targetAssetIds.includes('field.sand'), true, 'optional pending sand keeps its original reference provenance');
  for (const asset of required) {
    assert.equal(asset.defaultReferenceIds.length, 2, asset.id);
    assert.equal(asset.defaultReferenceIds[0], 'world_visual_master', asset.id);
    if (asset.category === 'character') {
      assert.equal(asset.defaultReferenceIds[1], 'character_visual_master', asset.id);
      assert.equal(byId.get('character_visual_master')?.targetAssetIds.includes(asset.id), true, asset.id);
    } else {
      const primary = byId.get(asset.defaultReferenceIds[1]);
      assert.equal(primary?.status, 'approved', asset.id);
      assert.equal(primary?.targetAssetIds.includes(asset.id), true, asset.id);
    }
    assert.equal(asset.defaultReferenceIds.some((id) => id.endsWith('_style_master')), false, asset.id);
    if (asset.category === 'building') assert.deepEqual(asset.pixelArt.logicalSpriteSize, { width: 256, height: 256 });
    if (asset.category === 'character') {
      assert.deepEqual(asset.pixelArt.logicalSpriteSize, { width: 24, height: 40 });
      assert.deepEqual(asset.sprites.grid, { columns: 4, rows: 3, frameWidth: 24, frameHeight: 40 });
      const expectedClass = asset.id === 'character.mob.elder' ? 'elder'
        : asset.id === 'character.mob.child' ? 'child' : 'adult';
      const expectedBounds = expectedClass === 'elder' ? { class: 'elder', min: 26, max: 30 }
        : expectedClass === 'child' ? { class: 'child', min: 21, max: 25 }
          : { class: 'adult', min: 28, max: 32 };
      assert.deepEqual(asset.characterSpriteContract, {
        frame: { width: 24, height: 40 },
        columns: ['front', 'back', 'left', 'right'],
        rows: ['idle', 'walk1', 'walk2'],
        footBaseline: 'common',
        resampling: { kernel: 'nearest', downscaleOnly: true, allowEnlargement: false },
        visibleBboxHeight: expectedBounds,
        partialAlphaPixels: 0
      });
    }
    if (asset.category === 'field') assert.equal(asset.pixelArt.tileSize, 64);
    if (asset.category === 'object') assert.deepEqual(asset.pixelArt.logicalSpriteSize, { width: 64, height: 64 });
    if (asset.category === 'effect') {
      assert.deepEqual(asset.pixelArt.logicalSpriteSize, { width: 32, height: 32 });
      assert.deepEqual(asset.sprites.grid, { columns: 4, rows: 1, frameWidth: 32, frameHeight: 32 });
    }
  }
});

test('build requires world and character masters and rejects subject gaps, target mismatches, and hash mismatches', async (t) => {
  const root = await forgeFixture(t, 'forge-reference-gates-');
  await assert.doesNotReject(() => buildJob({ assetId: 'character.player' }, { forgeRoot: root }));

  const characterFile = path.join(root, 'data', 'asset-definitions', 'characters.json');
  const originalCharacters = JSON.parse(await readFile(characterFile));
  const characterWithoutMaster = structuredClone(originalCharacters);
  characterWithoutMaster.assets.find((asset) => asset.id === 'character.player').defaultReferenceIds = ['world_visual_master'];
  await writeFile(characterFile, JSON.stringify(characterWithoutMaster));
  await assert.rejects(() => buildJob({ assetId: 'character.player' }, { forgeRoot: root }));
  await writeFile(characterFile, JSON.stringify(originalCharacters));

  const fieldFile = path.join(root, 'data', 'asset-definitions', 'fields.json');
  const originalFields = JSON.parse(await readFile(fieldFile));
  const withoutSubject = structuredClone(originalFields);
  withoutSubject.assets.find((asset) => asset.id === 'field.grass').defaultReferenceIds = ['world_visual_master'];
  await writeFile(fieldFile, JSON.stringify(withoutSubject));
  await assert.rejects(() => buildJob({ assetId: 'field.grass' }, { forgeRoot: root }));
  await writeFile(fieldFile, JSON.stringify(originalFields));

  const referenceFile = path.join(root, 'data', 'manifests', 'references.json');
  const originalReferences = JSON.parse(await readFile(referenceFile));
  const targetMismatch = structuredClone(originalReferences);
  const grass = originalFields.assets.find((asset) => asset.id === 'field.grass');
  const subject = targetMismatch.references.find((reference) => reference.id === grass.defaultReferenceIds[1]);
  subject.targetAssetIds = subject.targetAssetIds.filter((id) => id !== 'field.grass');
  await writeFile(referenceFile, JSON.stringify(targetMismatch));
  await assert.rejects(
    () => buildJob({ assetId: 'field.grass', allowPendingReferences: true }, { forgeRoot: root }),
    /target mapping mismatch/
  );

  const hashMismatch = structuredClone(originalReferences);
  hashMismatch.references.find((reference) => reference.id === 'world_visual_master').sha256 = '0'.repeat(64);
  await writeFile(referenceFile, JSON.stringify(hashMismatch));
  await assert.rejects(() => buildJob({ assetId: 'character.player' }, { forgeRoot: root }), /hash mismatch/i);
});

test('processing, promotion, and repository validation reject tampered saved generation provenance', async (t) => {
  const root = await forgeFixture(t, 'forge-generation-reference-gates-');
  const generated = await runJob({ assetId: 'field.grass', provider: 'mock' }, {
    root, forgeRoot: root, now: () => '2026-07-14T00:00:00.000Z'
  });
  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const ledger = JSON.parse(await readFile(ledgerPath));
  const savedResult = ledger.results.find((entry) => entry.id === generated.result.id);
  savedResult.referenceImageHashes[0] = '0'.repeat(64);
  await writeFile(ledgerPath, JSON.stringify(ledger));
  await assert.rejects(
    () => processCandidate({ generationId: generated.result.id }, { root, forgeRoot: root }),
    /reference provenance mismatch/
  );
  await assert.rejects(
    () => promoteCandidate({ generationId: generated.result.id }, { root, forgeRoot: root }),
    /reference provenance mismatch/
  );
  const validation = await validateRepository({ root });
  assert.equal(validation.ok, false);
  assert.equal(validation.issues.some((issue) => issue.code === 'INVALID_GENERATION_REFERENCES'), true);
});
