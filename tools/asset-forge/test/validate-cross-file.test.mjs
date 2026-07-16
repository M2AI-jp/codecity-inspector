import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { canonicalJson, sha256 } from '../src/hashing.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';
import {
  materializeProductionSourceSnapshot,
  migrateRejectedCandidateJournal,
  rejectCandidate
} from '../src/jobs/lifecycle.mjs';
import { importCandidate } from '../src/jobs/manual-import.mjs';
import { processCandidate } from '../src/jobs/process-candidate.mjs';
import { runJob } from '../src/jobs/run-job.mjs';
import { inspectPng } from '../src/png-core.mjs';
import { importWaveACandidate } from '../src/v2/import-candidate.mjs';
import { makeWaveAJob } from '../src/v2/operator.mjs';
import {
  productionRecipeProblem,
  rejectionResultFromPending,
  validateRepository
} from '../src/validate.mjs';

async function fixtureRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-validate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'prompts'), path.join(root, 'prompts'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'references'), path.join(root, 'references'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'review', 'prompts'), path.join(root, 'review', 'prompts'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'review', 'decisions'), path.join(root, 'review', 'decisions'), { recursive: true });
  return root;
}

async function explicitWaveARoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-validate-wave-a-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const relative of ['data', 'references', 'prompts', 'review']) {
    await cp(path.join(FORGE_ROOT, relative), path.join(root, relative), { recursive: true });
  }
  const assetManifestPath = path.join(root, 'data', 'manifests', 'assets.json');
  const assetManifest = JSON.parse(await readFile(assetManifestPath, 'utf8'));
  assetManifest.assets = assetManifest.assets.map((entry) => ({
    assetId: entry.assetId,
    category: entry.category,
    status: 'missing',
    pendingGenerationIds: [],
    rejectedGenerationIds: [],
    lastUpdated: null
  }));
  await writeFile(assetManifestPath, canonicalJson(assetManifest));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), canonicalJson({
    schemaVersion: 1,
    approvals: [],
    supersessions: []
  }));
  await mkdir(path.join(root, 'data', 'local'), { recursive: true });
  await writeFile(path.join(root, 'data', 'local', 'generations.json'), canonicalJson({
    schemaVersion: 1,
    tracked: false,
    results: []
  }));
  return root;
}

test('cross-file validation reports malformed JSON instead of crashing', async (t) => {
  const root = await fixtureRoot(t);
  await writeFile(path.join(root, 'data', 'asset-definitions', 'characters.json'), '{broken');
  const result = await validateRepository({ root });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'MALFORMED_JSON'));
});

test('cross-file validation reports duplicate asset IDs', async (t) => {
  const root = await fixtureRoot(t);
  const file = path.join(root, 'data', 'asset-definitions', 'characters.json');
  const catalog = JSON.parse(await readFile(file, 'utf8'));
  catalog.assets.push(structuredClone(catalog.assets[0]));
  await writeFile(file, JSON.stringify(catalog));
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_ID' && issue.id === catalog.assets[0].id));
});

test('cross-file validation reports undeclared references and unreported runtime gaps', async (t) => {
  const root = await fixtureRoot(t);
  const characterFile = path.join(root, 'data', 'asset-definitions', 'characters.json');
  const characters = JSON.parse(await readFile(characterFile, 'utf8'));
  characters.assets[0].defaultReferenceIds = ['missing_reference'];
  await writeFile(characterFile, JSON.stringify(characters));
  const fieldFile = path.join(root, 'data', 'asset-definitions', 'fields.json');
  const fields = JSON.parse(await readFile(fieldFile, 'utf8'));
  fields.assets.find((asset) => asset.id === 'field.snow').gameBinding.runtimeBindings = [];
  await writeFile(fieldFile, JSON.stringify(fields));
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_REFERENCE_DECLARATION'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNREPORTED_RUNTIME_GAP' && issue.runtimeId === 'snow'));
});

test('cross-file validation reports unknown reference targets', async (t) => {
  const root = await fixtureRoot(t);
  const referencesFile = path.join(root, 'data', 'manifests', 'references.json');
  const references = JSON.parse(await readFile(referencesFile, 'utf8'));
  references.references[0].targetAssetIds = ['building.not_declared'];
  await writeFile(referencesFile, JSON.stringify(references));
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_REFERENCE_TARGET'
    && issue.targetAssetId === 'building.not_declared'));
});

test('cross-file validation rejects tampered approved reference-generation provenance', async (t) => {
  const root = await fixtureRoot(t);
  const prompt = path.join(root, 'review', 'prompts', 'wave1c-character-basis', 'character_inspector_basis.txt');
  await writeFile(prompt, `${await readFile(prompt, 'utf8')}\ntampered`);
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_REFERENCE_FILE'
    && issue.id === 'character_visual_master'
    && /prompt snapshot hash/i.test(issue.message)));
});

test('cross-file validation rejects tampered pending reference-candidate provenance', async (t) => {
  const root = await fixtureRoot(t);
  const references = JSON.parse(await readFile(path.join(root, 'data', 'manifests', 'references.json'), 'utf8'));
  const candidate = references.references.find((entry) => entry.id === 'cutaway_interior_visual_reference');
  assert.equal(candidate.status, 'pending');
  const prompt = path.join(root, candidate.candidateProvenance.promptSnapshot.path);
  await writeFile(prompt, `${await readFile(prompt, 'utf8')}\ntampered`);
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_REFERENCE_FILE'
    && issue.id === candidate.id
    && /candidate prompt snapshot hash/i.test(issue.message)));
});

test('cross-file validation reports a required pending candidate without a production recipe', async (t) => {
  const root = await fixtureRoot(t);
  const generated = await runJob({ assetId: 'field.grass', provider: 'mock' }, {
    root,
    forgeRoot: root,
    now: () => '2026-07-15T00:00:00.000Z'
  });
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_PRODUCTION_RECIPE'
    && issue.generationId === generated.result.id
    && issue.message === 'required asset is missing its production recipe'));
});

test('production recipe validation excludes only job-pack records from the image-candidate gate', async () => {
  const definition = { required: true };
  assert.equal(await productionRecipeProblem(FORGE_ROOT, {
    status: 'job-pack'
  }, { definition }), null);
  for (const status of ['pending', 'approved', 'rejected']) {
    assert.match(
      await productionRecipeProblem(FORGE_ROOT, { status }, { definition }),
      /^generation output integrity failed:/,
      status
    );
  }
});

test('explicit Wave A keeps pending deep replay, rejected validation, and the non-explicit process gate', async (t) => {
  const root = await explicitWaveARoot(t);
  const packed = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const source = await sharp({
    create: { width: 64, height: 128, channels: 4, background: '#fb03f9ff' }
  }).composite([{
    input: await sharp({
      create: { width: 32, height: 96, channels: 4, background: '#405060ff' }
    }).png().toBuffer(),
    left: 16,
    top: 16
  }]).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const sourceOriginal = path.join(root, 'operator-input', 'prop-lamp.png');
  await mkdir(path.dirname(sourceOriginal), { recursive: true });
  await writeFile(sourceOriginal, source);
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: packed.result.jobPackPath,
    unitSources: [{ unitId: packed.job.generationUnits[0].unitId, sourceOriginal }],
    identityBindingPath: null
  }, { root, forgeRoot: root });
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  assert.equal(await productionRecipeProblem(root, imported.result, {
    forgeRoot: root,
    definition: packed.job.assetDefinition
  }), null);

  const tampered = structuredClone(imported.result);
  tampered.unitAssemblyV2.units[0].transformEvidence.detectedKeyColor = '#FA03F9';
  assert.match(await productionRecipeProblem(root, tampered, {
    forgeRoot: root,
    definition: packed.job.assetDefinition
  }), /^Wave A unit assembly integrity failed:/);

  const nonExplicitV2 = structuredClone(imported.result);
  delete nonExplicitV2.requiredSetId;
  delete nonExplicitV2.waveId;
  assert.equal(await productionRecipeProblem(root, nonExplicitV2, {
    forgeRoot: root,
    definition: packed.job.assetDefinition
  }), 'generation output integrity failed: v2 generation has not passed the required process technical-gate step');

  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const legacyLedger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const legacyResult = legacyLedger.results.find(({ id }) => id === imported.result.id);
  legacyResult.unitAssemblyV2.assemblyAlgorithm =
    'auto-border-crop-soft-matte-nearest-hard-alpha/raw-copy-v3';
  legacyResult.unitAssemblyV2.units[0].transformEvidence.policy.method =
    'auto-border-soft-matte-v1';
  assert.match(await productionRecipeProblem(root, legacyResult, {
    forgeRoot: root,
    definition: packed.job.assetDefinition
  }), /^Wave A unit assembly integrity failed:/);

  const rejected = await rejectCandidate({
    generationId: imported.result.id,
    reason: 'fixture rejection after visual review'
  }, {
    root,
    now: () => '2026-07-16T03:00:00.000Z'
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(await productionRecipeProblem(root, rejected.result, {
    forgeRoot: root,
    definition: packed.job.assetDefinition
  }), null);

  const journalPath = path.join(root, 'data', 'local', 'lifecycle', `${rejected.result.id}.json`);
  let journal = JSON.parse(await readFile(journalPath));
  const snapshotPath = path.join(root, journal.pendingRecordPath);
  const legacyJournal = structuredClone(journal);
  legacyJournal.schemaVersion = 1;
  delete legacyJournal.pendingRecordPath;
  delete legacyJournal.pendingRecordSha256;
  await writeFile(journalPath, canonicalJson(legacyJournal));
  await rm(snapshotPath, { force: true });
  assert.match(await productionRecipeProblem(root, rejected.result, {
    forgeRoot: root,
    definition: packed.job.assetDefinition
  }), /^Wave A rejected transition integrity failed:/);
  const migrated = await migrateRejectedCandidateJournal({
    generationId: rejected.result.id
  }, { root, forgeRoot: root });
  assert.equal(migrated.status, 'rejection-journal-v2');
  journal = JSON.parse(await readFile(journalPath));
  assert.equal(journal.schemaVersion, 2);
  assert.equal(await productionRecipeProblem(root, rejected.result, {
    forgeRoot: root,
    definition: packed.job.assetDefinition
  }), null);

  const baselineLedger = await readFile(ledgerPath);
  const baselineMetadata = await readFile(path.join(root, rejected.result.metadataPath));
  const baselineJournal = await readFile(journalPath);
  const baselineSnapshot = await readFile(path.join(root, journal.pendingRecordPath));
  const writeRejected = async (value) => {
    const ledger = JSON.parse(baselineLedger);
    ledger.results = ledger.results.map((entry) => entry.id === value.id ? value : entry);
    await writeFile(ledgerPath, canonicalJson(ledger));
    await writeFile(path.join(root, value.metadataPath), canonicalJson(value));
  };
  const restore = async () => {
    await writeFile(ledgerPath, baselineLedger);
    await writeFile(path.join(root, rejected.result.metadataPath), baselineMetadata);
    await writeFile(journalPath, baselineJournal);
    await writeFile(path.join(root, journal.pendingRecordPath), baselineSnapshot);
  };
  for (const mutate of [
    (value) => { value.unitAssemblyV2.units[0].outputCellSha256 = 'f'.repeat(64); },
    (value) => { value.unitAssemblyV2.units[0].transformEvidence.detectedKeyColor = '#FA03F9'; }
  ]) {
    const forged = structuredClone(rejected.result);
    mutate(forged);
    await writeRejected(forged);
    assert.match(await productionRecipeProblem(root, forged, {
      forgeRoot: root,
      definition: packed.job.assetDefinition
    }), /^Wave A rejected transition integrity failed:/);
    await restore();
  }

  const forgedJournal = JSON.parse(baselineJournal);
  forgedJournal.pendingRecordSha256 = '0'.repeat(64);
  await writeFile(journalPath, canonicalJson(forgedJournal));
  assert.match(await productionRecipeProblem(root, rejected.result, {
    forgeRoot: root,
    definition: packed.job.assetDefinition
  }), /pending-record snapshot digest mismatch/);
  await restore();

  const coordinatedPending = JSON.parse(baselineSnapshot);
  coordinatedPending.unitAssemblyV2.units[0].outputCellSha256 = 'e'.repeat(64);
  const coordinatedSnapshotBytes = Buffer.from(canonicalJson(coordinatedPending));
  const coordinatedJournal = JSON.parse(baselineJournal);
  coordinatedJournal.pendingRecordSha256 = sha256(coordinatedSnapshotBytes);
  const coordinatedRejected = rejectionResultFromPending(coordinatedPending, coordinatedJournal);
  await writeFile(path.join(root, coordinatedJournal.pendingRecordPath), coordinatedSnapshotBytes);
  await writeFile(journalPath, canonicalJson(coordinatedJournal));
  await writeRejected(coordinatedRejected);
  assert.match(await productionRecipeProblem(root, coordinatedRejected, {
    forgeRoot: root,
    definition: packed.job.assetDefinition
  }), /^Wave A rejected transition integrity failed: Wave A .*output cell hash mismatch/);
  await restore();

  const repository = await validateRepository({ root });
  assert.equal(repository.ok, true, JSON.stringify(repository.issues, null, 2));
});

test('cross-file validation reports a production recipe output-hash mismatch', async (t) => {
  const root = await fixtureRoot(t);
  const input = path.join(root, 'prepared.png');
  const prepared = await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{
    input: await sharp({ create: { width: 80, height: 80, channels: 4, background: '#345678ff' } }).png().toBuffer(),
    left: 60,
    top: 70
  }]).png().toBuffer();
  await writeFile(input, prepared);
  const { job } = await buildJob({ assetId: 'building.inn', provider: 'manual-import' }, { forgeRoot: root });
  const generationPromptPath = path.join('review', 'prompts', 'wave1a-buildings', 'building_inn.txt');
  const generationPrompt = await readFile(path.join(root, generationPromptPath));
  const imported = await importCandidate({
    assetId: 'building.inn',
    file: input,
    productionRecipe: {
      waveId: 'wave1a-buildings',
      assetId: 'building.inn',
      method: 'imagegen',
      generator: 'test-image-generator',
      scaleClass: 'large',
      generationPromptPath: generationPromptPath.split(path.sep).join('/'),
      generationPromptSha256: sha256(generationPrompt),
      toolMode: 'built-in',
      inputReferences: job.referenceImageIds.map((id, index) => ({
        id,
        sha256: job.referenceImageHashes[index],
        role: index === 0 ? 'global-style' : 'primary-subject'
      })),
      referenceImages: job.referenceImageIds.map((id, index) => ({ id, sha256: job.referenceImageHashes[index] })),
      source: {
        path: 'prepared.png',
        sha256: sha256(prepared),
        width: 256,
        height: 256,
        cropRect: null
      },
      backgroundRemoval: {
        method: 'official-chroma-key-helper',
        keyColor: null,
        autoKey: 'border',
        softMatte: true,
        transparentThreshold: 12,
        opaqueThreshold: 220,
        despill: true,
        cleanup: {
          alphaCutoff: 16,
          componentMinPixels: 128,
          targetMaxWidth: 210,
          targetMaxHeight: 210,
          resizeKernel: 'nearest'
        }
      },
      canvas: { width: 256, height: 256, baselineY: 149 },
      subjectBbox: { x: 60, y: 70, width: 80, height: 80 }
    }
  }, { root, forgeRoot: root, now: () => '2026-07-14T00:00:00.000Z' });
  await materializeProductionSourceSnapshot({ generationId: imported.result.id }, { root, forgeRoot: root });
  const localPath = path.join(root, 'data', 'local', 'generations.json');
  const local = JSON.parse(await readFile(localPath, 'utf8'));
  const generation = local.results.find((entry) => entry.id === imported.result.id);
  generation.productionRecipe.outputSha256 = '0'.repeat(64);
  await writeFile(localPath, JSON.stringify(local));
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_PRODUCTION_RECIPE'
    && issue.message === 'recipe output hash does not match generation'));

  generation.productionRecipe.outputSha256 = generation.outputSha256;
  await writeFile(localPath, JSON.stringify(local));
  await writeFile(path.join(root, generationPromptPath), Buffer.concat([generationPrompt, Buffer.from('\ntampered')]));
  const promptTamper = await validateRepository({ root });
  assert.ok(promptTamper.issues.some((issue) => issue.code === 'INVALID_PRODUCTION_RECIPE'
    && issue.message === 'recipe generation prompt file hash does not match'));

  await writeFile(path.join(root, generationPromptPath), generationPrompt);
  const changedSource = await sharp({
    create: { width: 256, height: 256, channels: 4, background: '#abcdef00' }
  }).png().toBuffer();
  await writeFile(input, changedSource);
  const sourceTamper = await validateRepository({ root });
  assert.ok(sourceTamper.issues.some((issue) => issue.code === 'INVALID_PRODUCTION_RECIPE'
    && issue.message === 'recipe source file hash/dimensions do not match'));
});

test('centered effect recipe persists an in-subject centerline baseline', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-centered-effect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRelative = 'generated/effects/pending/effect_water_ripple.png';
  const outputPath = path.join(root, outputRelative);
  const sourcePath = path.join(root, 'water-ripple-source.png');
  const promptPath = path.join(root, 'water-ripple-prompt.txt');
  await mkdir(path.dirname(outputPath), { recursive: true });
  const output = await sharp({
    create: { width: 128, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{
    input: await sharp({ create: { width: 112, height: 11, channels: 4, background: '#4a91cfff' } }).png().toBuffer(),
    left: 10,
    top: 10
  }]).png().toBuffer();
  await writeFile(outputPath, output);
  await writeFile(sourcePath, output);
  await writeFile(promptPath, 'centered four-frame water ripple');
  const outputHash = sha256(output);
  const generation = {
    assetId: 'effect.water_ripple',
    category: 'effect',
    status: 'pending',
    outputPath: outputRelative,
    outputSha256: outputHash,
    outputInspection: inspectPng(output),
    referenceImageIds: ['world_visual_master', 'harbor_reference'],
    referenceImageHashes: ['1'.repeat(64), '2'.repeat(64)],
    productionRecipe: {
      assetId: 'effect.water_ripple',
      method: 'imagegen',
      generationPromptPath: path.basename(promptPath),
      generationPromptSha256: sha256(await readFile(promptPath)),
      toolMode: 'built-in',
      inputReferences: [
        { id: 'world_visual_master', sha256: '1'.repeat(64), role: 'global-style' },
        { id: 'harbor_reference', sha256: '2'.repeat(64), role: 'primary-subject' }
      ],
      referenceImages: [
        { id: 'world_visual_master', sha256: '1'.repeat(64) },
        { id: 'harbor_reference', sha256: '2'.repeat(64) }
      ],
      source: { path: path.basename(sourcePath), sha256: outputHash, width: 128, height: 32 },
      canvas: { width: 128, height: 32, baselineY: 15 },
      subjectBbox: { x: 10, y: 10, width: 112, height: 11 },
      effectContract: { alignment: 'center' },
      outputSha256: outputHash
    }
  };
  assert.equal(await productionRecipeProblem(root, generation, { forgeRoot: root }), null);
  generation.outputInspection.frames = 2;
  assert.equal(
    await productionRecipeProblem(root, generation, { forgeRoot: root }),
    'generation output integrity failed: decoded PNG frames does not match generation outputInspection'
  );
  generation.outputInspection.frames = 1;
  generation.productionRecipe.canvas.baselineY = 31;
  assert.equal(
    await productionRecipeProblem(root, generation, { forgeRoot: root }),
    'recipe subject bbox/baseline is outside its canvas'
  );
});
