import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { canonicalJson, hashApprovedTree, hashTree, sha256 } from '../src/hashing.mjs';
import { processCandidate } from '../src/jobs/process-candidate.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';
import { buildWaveAJob } from '../src/v2/build-job.mjs';
import {
  importWaveACandidate,
  prepareWaveAIdentityBinding,
  verifyPersistedWaveAUnitAssembly,
  verifyWaveAIdentityBinding,
  verifyWaveAJobPack
} from '../src/v2/import-candidate.mjs';
import {
  importWaveARequest,
  makeWaveAJob,
  prepareWaveAIdentity,
  readWaveAImportRequest
} from '../src/v2/operator.mjs';
import { writeWaveAJobPack } from '../src/v2/write-job-pack.mjs';

const NOW = '2026-07-16T02:00:00.000Z';

async function fixtureRoot(t, { approvedAuthorization = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-wave-a-v2-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const relative of ['data/v2', 'data/manifests', 'references', 'prompts/v2']) {
    await cp(path.join(FORGE_ROOT, relative), path.join(root, relative), { recursive: true });
  }
  await mkdir(path.join(root, 'data', 'local'), { recursive: true });
  await writeFile(path.join(root, 'data', 'local', 'generations.json'), canonicalJson({
    schemaVersion: 1,
    tracked: false,
    results: []
  }));
  const authorizationPath = path.join(root, 'data', 'v2', 'reference-authorization-wave-a.json');
  const authorization = JSON.parse(await readFile(authorizationPath, 'utf8'));
  if (approvedAuthorization) {
    const review = {
      schemaVersion: 1,
      reviewType: 'fable5-wave-reference-rights',
      requiredSetId: 'fable5-v2',
      waveId: 'A',
      status: 'pass',
      reviewer: 'independent-read-only',
      reviewedAt: NOW,
      ownerAuthorizationSha256: authorization.ownerAuthorizationSha256,
      assetReferenceMapSha256: authorization.assetReferenceMapSha256,
      authorizedReferenceIds: authorization.allowedReferenceIds,
      forbiddenReferenceIds: authorization.forbiddenReferenceIds,
      observed: ['Fixture checked the exact hash-bound reference set.'],
      limitations: ['Fixture approval is local to this isolated root.']
    };
    const reviewBytes = Buffer.from(canonicalJson(review));
    const reviewPath = 'review/wave-a-rights.json';
    await mkdir(path.join(root, 'review'), { recursive: true });
    await writeFile(path.join(root, reviewPath), reviewBytes);
    await writeFile(authorizationPath, canonicalJson({
      ...authorization,
      status: 'approved',
      independentReview: {
        status: 'pass',
        reviewPath,
        reviewSha256: sha256(reviewBytes),
        reviewedAt: NOW
      }
    }));
  } else {
    await writeFile(authorizationPath, canonicalJson({
      ...authorization,
      status: 'pending-independent-review',
      independentReview: { status: 'pending' }
    }));
  }
  return root;
}

async function providerSource(width, height, color, { inset = 8, alpha = 1 } = {}) {
  return sharp({
    create: { width, height, channels: 4, background: '#ff00ffff' }
  }).composite([{
    input: await sharp({
      create: {
        width: width - inset * 2,
        height: height - inset * 2,
        channels: 4,
        background: { ...color, alpha }
      }
    }).png().toBuffer(),
    left: inset,
    top: inset
  }]).png({ adaptiveFiltering: false, palette: false }).toBuffer();
}

async function writeInput(root, name, bytes) {
  const target = path.join(root, 'operator-input', name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return target;
}

async function sourcesForJob(root, job, { scale = 2, prefix = 'source', shared = false } = {}) {
  const required = job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  if (shared) {
    const maxX = Math.max(...required.map(({ targetRect }) => targetRect.x + targetRect.width));
    const maxY = Math.max(...required.map(({ targetRect }) => targetRect.y + targetRect.height));
    const source = await writeInput(root, `${prefix}-atlas.png`, await providerSource(
      maxX * scale,
      maxY * scale,
      { r: 80, g: 120, b: 180 },
      { inset: 2 }
    ));
    return required.map((unit) => ({
      unitId: unit.unitId,
      sourceOriginal: source,
      cropRect: {
        x: unit.targetRect.x * scale,
        y: unit.targetRect.y * scale,
        width: unit.targetRect.width * scale,
        height: unit.targetRect.height * scale
      }
    }));
  }
  const records = [];
  for (const [index, unit] of required.entries()) {
    const color = {
      r: 40 + (index * 47) % 190,
      g: 50 + (index * 71) % 180,
      b: 60 + (index * 97) % 170
    };
    const sourceWidth = unit.targetRect.width * scale;
    const sourceHeight = unit.targetRect.height * scale;
    const bytes = job.category === 'character'
      ? await sharp({
          create: { width: sourceWidth, height: sourceHeight, channels: 4, background: '#ff00ffff' }
        }).composite([{
          input: await sharp({
            create: {
              width: (32 + (index % 8)) * scale,
              height: (68 + (index % 11)) * scale,
              channels: 4,
              background: { ...color, alpha: 1 }
            }
          }).png().toBuffer(),
          left: Math.floor((sourceWidth - (32 + (index % 8)) * scale) / 2),
          top: sourceHeight - (68 + (index % 11)) * scale
        }]).png({ adaptiveFiltering: false, palette: false }).toBuffer()
      : await providerSource(
          sourceWidth,
          sourceHeight,
          color,
          { inset: Math.max(2, scale * 2) }
        );
    records.push({
      unitId: unit.unitId,
      sourceOriginal: await writeInput(root, `${prefix}-${String(index).padStart(3, '0')}.png`, bytes)
    });
  }
  return records;
}

async function identitySource(root, name = 'identity.png', colors = [
  '#b04040ff', '#4070b0ff', '#40a060ff', '#a08030ff'
]) {
  const width = 384;
  const height = 192;
  const cells = [];
  for (let index = 0; index < 4; index += 1) {
    cells.push({
      input: await sharp({
        create: { width: 72, height: 160, channels: 4, background: colors[index] }
      }).png().toBuffer(),
      left: index * 96 + 12,
      top: 16
    });
  }
  const bytes = await sharp({
    create: { width, height, channels: 4, background: '#ff00ffff' }
  }).composite(cells).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  return writeInput(root, name, bytes);
}

async function monolithicSourcesForJob(root, job, { scale = 2, prefix = 'atlas' } = {}) {
  const required = job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  const width = job.artifactContracts[0].outputSize.width * scale;
  const height = job.artifactContracts[0].outputSize.height * scale;
  const composites = [];
  for (const [index, unit] of required.entries()) {
    const cellWidth = unit.targetRect.width * scale;
    const cellHeight = unit.targetRect.height * scale;
    composites.push({
      input: await sharp({
        create: {
          width: cellWidth,
          height: cellHeight,
          channels: 4,
          background: { r: 62, g: 110, b: 58, alpha: 1 }
        }
      }).png().toBuffer(),
      left: unit.targetRect.x * scale,
      top: unit.targetRect.y * scale
    });
    composites.push({
      input: await sharp({
        create: {
          width: 8 * scale,
          height: 8 * scale,
          channels: 4,
          background: {
            r: 20 + (index * 37) % 220,
            g: 30 + (index * 61) % 210,
            b: 40 + (index * 89) % 200,
            alpha: 1
          }
        }
      }).png().toBuffer(),
      left: unit.targetRect.x * scale + Math.floor((cellWidth - 8 * scale) / 2),
      top: unit.targetRect.y * scale + Math.floor((cellHeight - 8 * scale) / 2)
    });
  }
  const bytes = await sharp({
    create: { width, height, channels: 4, background: '#ff00ffff' }
  }).composite(composites).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const sourceOriginal = await writeInput(root, `${prefix}.png`, bytes);
  return required.map((unit) => ({
    unitId: unit.unitId,
    sourceOriginal,
    cropRect: {
      x: unit.targetRect.x * scale,
      y: unit.targetRect.y * scale,
      width: unit.targetRect.width * scale,
      height: unit.targetRect.height * scale
    }
  }));
}

async function persistResultMutation(root, originalId, nextResult) {
  const manifestPath = path.join(root, 'data', 'local', 'generations.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.results = manifest.results.map((result) => result.id === originalId ? nextResult : result);
  await writeFile(manifestPath, canonicalJson(manifest));
  await writeFile(path.join(root, nextResult.metadataPath), canonicalJson(nextResult));
}

test('Wave A job packs bind 109 definitions to 771 generation units and honest provider-native prompts', async (t) => {
  const root = await fixtureRoot(t);
  const first = await writeWaveAJobPack({ assetId: 'prop.lamp', seed: 'stable' }, {
    root, forgeRoot: root
  });
  assert.deepEqual(Object.keys(first.pack.members).sort(), [
    'authorization', 'definition', 'independentReview', 'job', 'prompt', 'unitPlan'
  ]);
  assert.match(first.job.generationUnits[0].unitPromptText, /provider-native raster/);
  assert.match(first.job.generationUnits[0].unitPromptText, /one semantic unit/);
  assert.doesNotMatch(first.job.generationUnits[0].unitPromptText, /Generate an exact 32x64 image/);
  assert.equal((await verifyWaveAJobPack(first.result.jobPackPath, { root, forgeRoot: root })).job.id, first.job.id);
  const repeat = await writeWaveAJobPack({ assetId: 'prop.lamp', seed: 'stable' }, {
    root, forgeRoot: root
  });
  assert.equal(repeat.resumed, true);
  assert.deepEqual(repeat.result, first.result);
  await assert.rejects(
    () => buildWaveAJob({ assetId: 'character.player', generationMode: 'monolithic-atlas' }, { forgeRoot: root }),
    /characters require per-unit generation/
  );
});

test('non-character per-unit import transforms a provider-native source, persists evidence, and stays pending', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'lamp' });
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  }, { root, forgeRoot: root });
  assert.equal(imported.status, 'pending');
  assert.equal(imported.result.unitAssemblyV2.sourceRequiredCount, 1);
  assert.equal(imported.result.unitAssemblyV2.units[0].sourceSnapshot.width, 64);
  assert.equal(imported.result.unitAssemblyV2.units[0].transformedSnapshot.width, 32);
  assert.equal(imported.result.unitAssemblyV2.identityMaster, null);
  assert.equal(imported.approvedTreeSha256Before, imported.approvedTreeSha256After);
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  const repeat = await importWaveACandidate({
    assetId: 'prop.lamp', jobPackPath: pack.result.jobPackPath,
    unitSources, identityBindingPath: null
  }, { root, forgeRoot: root });
  assert.equal(repeat.resumed, true);
  assert.deepEqual(repeat.result, imported.result);
  const requestPath = 'review/import-requests/v2/prop-lamp.json';
  const request = {
    schemaVersion: 2,
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    assetId: 'prop.lamp',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  };
  await mkdir(path.join(root, 'review', 'import-requests', 'v2'), { recursive: true });
  await writeFile(path.join(root, requestPath), canonicalJson(request));
  assert.deepEqual(await readWaveAImportRequest(requestPath, { root }), request);
  assert.equal((await importWaveARequest({ requestPath }, {
    root, forgeRoot: root
  })).resumed, true);
  await writeFile(path.join(root, requestPath), canonicalJson({
    ...request,
    identityMasterSource: { sourceOriginal: unitSources[0].sourceOriginal }
  }));
  await assert.rejects(
    () => readWaveAImportRequest(requestPath, { root }),
    /Invalid Wave A import request/
  );
});

test('character identity is prepared first, bound into 40 issued prompts, then imported as auxiliary evidence', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'character.player' }, { root, forgeRoot: root });
  const identity = await identitySource(root);
  await assert.rejects(
    () => importWaveACandidate({
      assetId: 'character.player',
      jobPackPath: pack.result.jobPackPath,
      unitSources: [],
      identityMasterSource: { sourceOriginal: identity }
    }, { root, forgeRoot: root }),
    /unitSources|identity binding/
  );
  const bound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  assert.equal(bound.binding.units.length, 40);
  assert.equal(new Set(bound.binding.units.map(({ consistencyInputSha256 }) => consistencyInputSha256)).size, 1);
  assert.equal(bound.binding.providerInvocationEvidence, 'unverified-no-provider-receipt');
  const verifiedBinding = await verifyWaveAIdentityBinding(bound.bindingPath, { root, forgeRoot: root });
  assert.equal(verifiedBinding.identity.cellHashes.length, 4);
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'player' });
  const imported = await importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root });
  assert.equal(imported.result.unitAssemblyV2.units.length, 40);
  assert.equal(imported.result.unitAssemblyV2.identityMaster.unitExecutionPlanSha256, bound.bindingSha256);
  assert.equal(imported.result.unitAssemblyV2.identityMaster.approvedAsset, false);
  assert.ok(imported.result.inspection.unknown.includes('actual identity image delivery to the provider invocation'));
  assert.ok(imported.result.inspection.unknown.includes('actual source generation after identity-binding issuance'));
  assert.deepEqual(imported.result.inspection.inferred, [
    'The candidate is technically eligible for independent visual inspection.'
  ]);
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
});

test('monolithic atlas mode requires one source with exact unique crops and preserves semantic zero cells', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({
    assetId: 'terrain.grass', generationMode: 'monolithic-atlas'
  }, { root, forgeRoot: root });
  const unitSources = await monolithicSourcesForJob(root, pack.job, { prefix: 'grass-atlas' });
  const imported = await importWaveACandidate({
    assetId: 'terrain.grass',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  }, { root, forgeRoot: root });
  assert.equal(imported.result.unitAssemblyV2.sourceRequiredCount, 18);
  assert.equal(imported.result.unitAssemblyV2.expectations['semantic-transparent'], 1);
  assert.equal(imported.result.unitAssemblyV2.expectations['reserved-transparent'], 6);
  assert.equal(new Set(imported.result.unitAssemblyV2.units
    .filter(({ sourceRequired }) => sourceRequired)
    .map(({ sourceSnapshot }) => sourceSnapshot.path)).size, 1);
  assert.ok(imported.result.unitAssemblyV2.units
    .filter(({ sourceRequired }) => !sourceRequired)
    .every(({ sourceSnapshot, transformedSnapshot, pixelAudit }) =>
      sourceSnapshot === null && transformedSnapshot === null && pixelAudit.visiblePixels === 0));
  assert.equal((await processCandidate({ generationId: imported.result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  const original = structuredClone(imported.result);
  const zeroIndex = original.unitAssemblyV2.units.findIndex(
    ({ expectation }) => expectation === 'semantic-transparent'
  );
  const mutations = [
    (value) => {
      value.unitAssemblyV2.units[zeroIndex].outputCellSha256 = 'f'.repeat(64);
    },
    (value) => {
      value.unitAssemblyV2.units[zeroIndex].pixelAudit.visiblePixels = 1;
    },
    (value) => {
      [value.unitAssemblyV2.units[0], value.unitAssemblyV2.units[1]] =
        [value.unitAssemblyV2.units[1], value.unitAssemblyV2.units[0]];
    }
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(original);
    mutate(forged);
    await persistResultMutation(root, original.id, forged);
    await assert.rejects(
      () => processCandidate({ generationId: original.id }, { root, forgeRoot: root })
    );
    await persistResultMutation(root, original.id, original);
  }
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
});

test('coverage, order, source alias, aspect, and caller leaf symlink failures write no pending result', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'building.inn' }, { root, forgeRoot: root });
  const lamp = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const sources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'inn' });
  const approvedBefore = await hashApprovedTree(root);
  const ledgerBefore = await readFile(path.join(root, 'data', 'local', 'generations.json'));
  const pendingRoot = path.join(root, 'generated', 'buildings', 'pending');
  const treeBefore = await hashTree(pendingRoot);
  const failures = [
    [sources.slice(0, 1), /coverage mismatch/],
    [[sources[0], sources[0]], /coverage mismatch/],
    [[...sources, { unitId: 'unit_999_base_extra', sourceOriginal: sources[0].sourceOriginal }], /coverage mismatch/],
    [[sources[1], sources[0]], /source order\/frame binding/],
    [[sources[0], { ...sources[1], sourceOriginal: sources[0].sourceOriginal }], /unique primary source path and bytes/]
  ];
  for (const [unitSources, pattern] of failures) {
    await assert.rejects(() => importWaveACandidate({
      assetId: 'building.inn',
      jobPackPath: pack.result.jobPackPath,
      unitSources,
      identityBindingPath: null
    }, { root, forgeRoot: root }), pattern);
  }
  const wrongAspect = await writeInput(root, 'wrong-aspect.png', await providerSource(
    64, 100, { r: 100, g: 80, b: 40 }, { inset: 4 }
  ));
  await assert.rejects(() => importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: lamp.result.jobPackPath,
    unitSources: [{ unitId: lamp.job.generationUnits[0].unitId, sourceOriginal: wrongAspect }],
    identityBindingPath: null
  }, { root, forgeRoot: root }), /aspect ratio/);
  await assert.rejects(() => importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: lamp.result.jobPackPath,
    unitSources: [{
      unitId: lamp.job.generationUnits[0].unitId,
      sourceOriginal: wrongAspect,
      cropRect: { x: 0, y: 0, width: 60, height: 100 }
    }],
    identityBindingPath: null
  }, { root, forgeRoot: root }), /aspect ratio/);
  const valid = await writeInput(root, 'valid-symlink-target.png', await providerSource(
    64, 128, { r: 100, g: 80, b: 40 }, { inset: 4 }
  ));
  const leafLink = path.join(root, 'operator-input', 'leaf-link.png');
  await symlink(valid, leafLink);
  await assert.rejects(() => importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: lamp.result.jobPackPath,
    unitSources: [{ unitId: lamp.job.generationUnits[0].unitId, sourceOriginal: leafLink }],
    identityBindingPath: null
  }, { root, forgeRoot: root }), /non-symlink file/);
  assert.equal(await hashApprovedTree(root), approvedBefore);
  assert.deepEqual(await readFile(path.join(root, 'data', 'local', 'generations.json')), ledgerBefore);
  assert.equal(await hashTree(pendingRoot), treeBefore);
});

test('deep process audit rejects coordinated ledger+metadata truth and unit provenance tampering', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'tamper-lamp' });
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  }, { root, forgeRoot: root });
  const original = structuredClone(imported.result);
  const approvedBefore = await hashApprovedTree(root);
  const mutations = [
    ['warnings human-approval claim', (value) => {
      value.warnings = ['human approved and complete'];
    }],
    ['unknown evidence removed', (value) => {
      value.inspection.unknown = [];
    }],
    ['observed human approval claim', (value) => {
      value.inspection.observed = ['human approved'];
    }],
    ['dry run truth changed', (value) => {
      value.dryRun = true;
    }],
    ['subscription truth changed', (value) => {
      value.subscriptionRun = true;
    }],
    ['legacy optional field injected', (value) => {
      value.processedFromGenerationId = 'gen_forged';
    }],
    ['unit target rect changed', (value) => {
      value.unitAssemblyV2.units[0].targetRect.x += 1;
    }],
    ['unit frame changed', (value) => {
      value.unitAssemblyV2.units[0].frameId = 'forged_frame';
    }],
    ['unit prompt hash changed', (value) => {
      value.unitAssemblyV2.units[0].unitPromptSha256 = '0'.repeat(64);
    }],
    ['artifact role changed', (value) => {
      value.unitAssemblyV2.units[0].artifactRole = 'base';
    }],
    ['provenance changed', (value) => {
      value.provenanceKey = '1'.repeat(64);
    }],
    ['production recipe changed', (value) => {
      value.productionRecipesV2[0].promptSnapshot.sha256 = '2'.repeat(64);
    }]
  ];
  for (const [label, mutate] of mutations) {
    const forged = structuredClone(original);
    mutate(forged);
    await persistResultMutation(root, original.id, forged);
    await assert.rejects(
      () => processCandidate({ generationId: original.id }, { root, forgeRoot: root }),
      undefined,
      label
    );
    await persistResultMutation(root, original.id, original);
    assert.equal(await hashApprovedTree(root), approvedBefore, label);
  }
  const metadataForged = structuredClone(original);
  metadataForged.inspection.observed = ['metadata-only forged approval'];
  await writeFile(path.join(root, original.metadataPath), canonicalJson(metadataForged));
  await assert.rejects(
    () => processCandidate({ generationId: original.id }, { root, forgeRoot: root }),
    /metadata bytes differ/
  );
  await writeFile(path.join(root, original.metadataPath), canonicalJson(original));
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('deep process audit rejects source, transformed, assembly-source, artifact, and persisted symlink tampering', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'file-tamper-lamp' });
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp', jobPackPath: pack.result.jobPackPath,
    unitSources, identityBindingPath: null
  }, { root, forgeRoot: root });
  const result = imported.result;
  const unit = result.unitAssemblyV2.units[0];
  const paths = [
    unit.sourceSnapshot.path,
    unit.transformedSnapshot.path,
    result.productionRecipesV2[0].sourceOriginal.path,
    result.outputPath
  ];
  const approvedBefore = await hashApprovedTree(root);
  for (const relative of paths) {
    const absolute = path.join(root, relative);
    const originalBytes = await readFile(absolute);
    await writeFile(absolute, Buffer.from('not a valid persisted image'));
    await assert.rejects(
      () => processCandidate({ generationId: result.id }, { root, forgeRoot: root })
    );
    await writeFile(absolute, originalBytes);
    assert.equal(await hashApprovedTree(root), approvedBefore);
  }
  const sourceAbsolute = path.join(root, unit.sourceSnapshot.path);
  const backup = `${sourceAbsolute}.regular-backup`;
  await rename(sourceAbsolute, backup);
  await symlink(backup, sourceAbsolute);
  await assert.rejects(
    () => processCandidate({ generationId: result.id }, { root, forgeRoot: root }),
    /Symbolic links|non-symlink/
  );
  await rm(sourceAbsolute);
  await rename(backup, sourceAbsolute);
  assert.equal((await processCandidate({ generationId: result.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('deep replay rejects empty, partial-alpha, hidden-RGB, and magenta transformed snapshots even with coordinated hashes', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'prop.lamp' }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'pixel-contract-lamp' });
  const imported = await importWaveACandidate({
    assetId: 'prop.lamp', jobPackPath: pack.result.jobPackPath,
    unitSources, identityBindingPath: null
  }, { root, forgeRoot: root });
  const original = structuredClone(imported.result);
  const snapshotPath = original.unitAssemblyV2.units[0].transformedSnapshot.path;
  const snapshotAbsolute = path.join(root, snapshotPath);
  const originalBytes = await readFile(snapshotAbsolute);
  const rawVariant = (kind) => {
    const raw = Buffer.alloc(32 * 64 * 4);
    if (kind === 'hidden-rgb') {
      raw[0] = 12;
      raw[1] = 34;
      raw[2] = 56;
    }
    if (kind !== 'empty') {
      for (let y = 8; y < 56; y += 1) {
        for (let x = 6; x < 26; x += 1) {
          const offset = (y * 32 + x) * 4;
          raw[offset] = kind === 'magenta' ? 255 : 120;
          raw[offset + 1] = kind === 'magenta' ? 0 : 80;
          raw[offset + 2] = kind === 'magenta' ? 255 : 40;
          raw[offset + 3] = kind === 'partial-alpha' ? 128 : 255;
        }
      }
    }
    return raw;
  };
  for (const kind of ['empty', 'partial-alpha', 'hidden-rgb', 'magenta']) {
    const bytes = await sharp(rawVariant(kind), {
      raw: { width: 32, height: 64, channels: 4 }
    }).png({ adaptiveFiltering: false, palette: false }).toBuffer();
    const forged = structuredClone(original);
    forged.unitAssemblyV2.units[0].transformedSnapshot.sha256 = sha256(bytes);
    await writeFile(snapshotAbsolute, bytes);
    await persistResultMutation(root, original.id, forged);
    await assert.rejects(
      () => processCandidate({ generationId: original.id }, { root, forgeRoot: root }),
      undefined,
      kind
    );
    await writeFile(snapshotAbsolute, originalBytes);
    await persistResultMutation(root, original.id, original);
  }
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
});

test('identity preparation rejects afterthought/raw shortcuts, bad crops, duplicate views, and caller symlinks', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'character.player' }, { root, forgeRoot: root });
  const identity = await identitySource(root, 'identity-negative.png');
  await assert.rejects(() => prepareWaveAIdentityBinding({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: { sourceOriginal: identity }
  }, { root, forgeRoot: root }), /requires an explicit 2:1 cropRect/);
  await assert.rejects(() => prepareWaveAIdentityBinding({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 300, height: 192 }
    }
  }, { root, forgeRoot: root }), /exact 2:1 target aspect ratio/);
  const duplicateCell = await sharp({
    create: { width: 72, height: 160, channels: 4, background: '#506478ff' }
  }).png().toBuffer();
  const duplicateBytes = await sharp({
    create: { width: 384, height: 192, channels: 4, background: '#ff00ffff' }
  }).composite([0, 1, 2, 3].map((index) => ({
    input: duplicateCell,
    left: index * 96 + 12,
    top: 16
  }))).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const duplicate = await writeInput(root, 'identity-duplicate.png', duplicateBytes);
  await assert.rejects(() => prepareWaveAIdentityBinding({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: duplicate,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root }), /direction cells must be byte-distinct/);
  const link = path.join(root, 'operator-input', 'identity-leaf-link.png');
  await symlink(identity, link);
  await assert.rejects(() => prepareWaveAIdentityBinding({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: link,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root }), /non-symlink file/);
  const sources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'afterthought-player' });
  await assert.rejects(() => importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources: sources,
    identityMasterSource: {
      sourceOriginal: identity,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root }), /issue an identity binding first/);
});

test('deep identity audit rejects valid alternate-binding substitution and post-issuance identity evidence tampering', async (t) => {
  const root = await fixtureRoot(t);
  const pack = await makeWaveAJob({ assetId: 'character.player' }, { root, forgeRoot: root });
  const firstRaw = await identitySource(root, 'identity-first.png');
  const first = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: firstRaw,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  const unitSources = await sourcesForJob(root, pack.job, { scale: 2, prefix: 'identity-tamper-player' });
  const imported = await importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    unitSources,
    identityBindingPath: first.bindingPath
  }, { root, forgeRoot: root });
  const original = structuredClone(imported.result);
  const secondRaw = await identitySource(root, 'identity-second.png', [
    '#d05050ff', '#5080c0ff', '#50b070ff', '#b09040ff'
  ]);
  const second = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: pack.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: secondRaw,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });
  assert.notEqual(second.bindingSha256, first.bindingSha256);
  const substituted = structuredClone(original);
  substituted.unitAssemblyV2.identityMaster.unitExecutionPlanPath = second.bindingPath;
  substituted.unitAssemblyV2.identityMaster.unitExecutionPlanSha256 = second.bindingSha256;
  await persistResultMutation(root, original.id, substituted);
  await assert.rejects(
    () => processCandidate({ generationId: original.id }, { root, forgeRoot: root })
  );
  await persistResultMutation(root, original.id, original);
  const ledgerBeforeEvidenceTamper = await readFile(path.join(root, 'data', 'local', 'generations.json'));

  const evidencePaths = [
    first.binding.identityMaster.sourceSnapshot.path,
    first.binding.identityMaster.transformedSnapshot.path,
    first.binding.units[0].executionPromptPath,
    first.bindingPath
  ];
  const approvedBefore = await hashApprovedTree(root);
  for (const relative of evidencePaths) {
    const absolute = path.join(root, relative);
    const bytes = await readFile(absolute);
    await writeFile(absolute, Buffer.from('tampered identity authority evidence'));
    await assert.rejects(() => verifyWaveAIdentityBinding(first.bindingPath, {
      root, forgeRoot: root
    }));
    await writeFile(absolute, bytes);
    assert.equal(await hashApprovedTree(root), approvedBefore);
  }
  const identitySourceAbsolute = path.join(root, first.binding.identityMaster.sourceSnapshot.path);
  const backup = `${identitySourceAbsolute}.regular-backup`;
  await rename(identitySourceAbsolute, backup);
  await symlink(backup, identitySourceAbsolute);
  await assert.rejects(() => verifyWaveAIdentityBinding(first.bindingPath, {
    root, forgeRoot: root
  }), /Symbolic links|non-symlink/);
  await rm(identitySourceAbsolute);
  await rename(backup, identitySourceAbsolute);
  assert.equal((await processCandidate({ generationId: original.id }, {
    root, forgeRoot: root
  })).status, 'audited-pending');
  assert.deepEqual(
    await readFile(path.join(root, 'data', 'local', 'generations.json')),
    ledgerBeforeEvidenceTamper
  );
  assert.equal(await hashApprovedTree(root), approvedBefore);
});

test('reference review still fails closed before any production write', async (t) => {
  const root = await fixtureRoot(t, { approvedAuthorization: false });
  const approvedBefore = await hashApprovedTree(root);
  await assert.rejects(
    () => writeWaveAJobPack({ assetId: 'prop.lamp' }, { root, forgeRoot: root }),
    /reference authorization is not production-ready/
  );
  await assert.rejects(() => access(path.join(root, 'generated')), /ENOENT/);
  assert.equal((await readLocalGenerationManifest(root)).results.length, 0);
  assert.equal(await hashApprovedTree(root), approvedBefore);
});
