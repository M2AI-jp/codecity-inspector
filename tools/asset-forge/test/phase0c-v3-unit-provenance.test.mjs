import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { FORGE_ROOT } from '../src/config.mjs';
import { canonicalJson, hashTree, sha256 } from '../src/hashing.mjs';
import {
  promoteCandidateInternal,
  promotionPreviewInternal
} from '../src/jobs/lifecycle.mjs';
import { importWaveACandidate } from '../src/v2/import-candidate.mjs';
import { makeWaveAJob, prepareWaveAIdentity } from '../src/v2/operator.mjs';
import { prepareWaveBundleApproval } from '../src/v3/bundle-ledger.mjs';
import {
  verifyBundleApprovalForExport,
  verifyPendingGenerationForWaveApproval
} from '../src/v3/provenance.mjs';

const NOW = '2026-07-16T08:00:00.000Z';

async function pendingWaveAFixture(t, assetId = 'prop.lamp') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-v3-unit-provenance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const relative of [
    'data/asset-definitions', 'data/v2', 'data/manifests', 'references', 'prompts/v2'
  ]) {
    await cp(path.join(FORGE_ROOT, relative), path.join(root, relative), { recursive: true });
  }
  await mkdir(path.join(root, 'review'), { recursive: true });
  await cp(
    path.join(FORGE_ROOT, 'review', 'phase0-wave-a-reference-rights-audit.json'),
    path.join(root, 'review', 'phase0-wave-a-reference-rights-audit.json')
  );
  await mkdir(path.join(root, 'data', 'local'), { recursive: true });
  await writeFile(path.join(root, 'data', 'local', 'generations.json'), canonicalJson({
    schemaVersion: 1,
    tracked: false,
    results: []
  }));

  const packed = await makeWaveAJob({ assetId }, { root, forgeRoot: root });
  const requiredUnits = packed.job.generationUnits.filter(({ sourceRequired }) => sourceRequired);
  assert.ok(requiredUnits.length > 0);
  const unitSources = [];
  for (const [index, unit] of requiredUnits.entries()) {
    const width = unit.targetRect.width * 2;
    const height = unit.targetRect.height * 2;
    const color = ['#5478aaff', '#75547fff', '#527a56ff'][index % 3];
    const source = await sharp({
      create: { width, height, channels: 4, background: '#ff00ffff' }
    }).composite([{
      input: await sharp({
        create: {
          width: width - 16,
          height: height - 16,
          channels: 4,
          background: color
        }
      }).png().toBuffer(),
      left: 8,
      top: 8
    }]).png({ adaptiveFiltering: false, palette: false }).toBuffer();
    const sourcePath = path.join(root, 'operator-input', `${assetId.replace(/\W/g, '_')}-${index}.png`);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, source);
    unitSources.push({ unitId: unit.unitId, sourceOriginal: sourcePath });
  }
  const imported = await importWaveACandidate({
    assetId,
    jobPackPath: packed.result.jobPackPath,
    unitSources,
    identityBindingPath: null
  }, { root, forgeRoot: root, now: () => NOW });
  return { root, imported };
}

async function pendingNormalizedCharacterFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-v3-normalized-character-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const relative of [
    'data/asset-definitions', 'data/v2', 'data/manifests', 'references', 'prompts/v2'
  ]) {
    await cp(path.join(FORGE_ROOT, relative), path.join(root, relative), { recursive: true });
  }
  await mkdir(path.join(root, 'review'), { recursive: true });
  await cp(
    path.join(FORGE_ROOT, 'review', 'phase0-wave-a-reference-rights-audit.json'),
    path.join(root, 'review', 'phase0-wave-a-reference-rights-audit.json')
  );
  await mkdir(path.join(root, 'data', 'local'), { recursive: true });
  await writeFile(path.join(root, 'data', 'local', 'generations.json'), canonicalJson({
    schemaVersion: 1,
    tracked: false,
    results: []
  }));
  const packed = await makeWaveAJob({
    assetId: 'character.player',
    generationMode: 'monolithic-atlas',
    providerKeyNormalization: 'provider-key-normalize-v1',
    seed: 'v3-normalized-character'
  }, { root, forgeRoot: root });
  const shiftedKey = '#f506e2ff';
  const identityCells = [];
  for (let index = 0; index < 4; index += 1) {
    identityCells.push({
      input: await sharp({
        create: {
          width: 72,
          height: 160,
          channels: 4,
          background: ['#b04040ff', '#4070b0ff', '#40a060ff', '#a08030ff'][index]
        }
      }).png().toBuffer(),
      left: index * 96 + 12,
      top: 16
    });
  }
  const identityBytes = await sharp({
    create: { width: 384, height: 192, channels: 4, background: shiftedKey }
  }).composite(identityCells).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const identityPath = path.join(root, 'operator-input', 'normalized-identity.png');
  await mkdir(path.dirname(identityPath), { recursive: true });
  await writeFile(identityPath, identityBytes);
  const bound = await prepareWaveAIdentity({
    assetId: 'character.player',
    jobPackPath: packed.result.jobPackPath,
    identityMasterSource: {
      sourceOriginal: identityPath,
      cropRect: { x: 0, y: 0, width: 384, height: 192 }
    }
  }, { root, forgeRoot: root });

  const scale = 2;
  const padding = 8;
  const output = packed.job.artifactContracts[0].outputSize;
  const atlasWidth = output.width * scale + padding * 2;
  const atlasHeight = output.height * scale + padding * 2;
  const composites = [];
  for (const [index, unit] of packed.job.generationUnits.entries()) {
    const bodyWidth = (30 + index % 9) * scale;
    const bodyHeight = (68 + index % 13) * scale;
    composites.push({
      input: await sharp({
        create: {
          width: bodyWidth,
          height: bodyHeight,
          channels: 4,
          background: {
            r: 40 + (index * 47) % 190,
            g: 70 + (index * 61) % 170,
            b: 20 + (index * 29) % 80,
            alpha: 1
          }
        }
      }).png().toBuffer(),
      left: padding + unit.targetRect.x * scale
        + Math.floor((unit.targetRect.width * scale - bodyWidth) / 2),
      top: padding + unit.targetRect.y * scale + unit.targetRect.height * scale - bodyHeight
    });
  }
  const atlasBytes = await sharp({
    create: { width: atlasWidth, height: atlasHeight, channels: 4, background: shiftedKey }
  }).composite(composites).png({ adaptiveFiltering: false, palette: false }).toBuffer();
  const atlasPath = path.join(root, 'operator-input', 'normalized-atlas.png');
  await writeFile(atlasPath, atlasBytes);
  const unitSources = packed.job.generationUnits.map((unit) => ({
    unitId: unit.unitId,
    sourceOriginal: atlasPath,
    cropRect: {
      x: padding + unit.targetRect.x * scale,
      y: padding + unit.targetRect.y * scale,
      width: unit.targetRect.width * scale,
      height: unit.targetRect.height * scale
    }
  }));
  const imported = await importWaveACandidate({
    assetId: 'character.player',
    jobPackPath: packed.result.jobPackPath,
    unitSources,
    identityBindingPath: bound.bindingPath
  }, { root, forgeRoot: root, now: () => NOW });
  return { root, packed, bound, imported };
}

test('v3 pending approval and re-export both require byte-replayed persisted unit assembly evidence', async (t) => {
  const { root, imported } = await pendingWaveAFixture(t);
  const verified = await verifyPendingGenerationForWaveApproval({
    assetId: imported.result.assetId,
    generationId: imported.result.id
  }, { root, forgeRoot: root });
  assert.equal(verified.artifacts.length, 1);

  const bundleDirectory = `generated/v3/wave-bundles/${sha256('unit-provenance-fixture')}`;
  const approvedPath = `${bundleDirectory}/prop_lamp-primary-${verified.artifacts[0].sha256.slice(0, 16)}.png`;
  await mkdir(path.dirname(path.join(root, approvedPath)), { recursive: true });
  await cp(path.join(root, verified.artifacts[0].pendingPath), path.join(root, approvedPath));
  const approval = prepareWaveBundleApproval({
    assetId: imported.result.assetId,
    category: verified.definition.category,
    definitionSha256: verified.definitionSha256,
    generationRecordDigest: verified.generationRecordDigest,
    artifacts: [{
      role: 'primary',
      generationId: imported.result.id,
      approvedPath,
      sha256: verified.artifacts[0].sha256
    }],
    reviewer: 'human',
    note: 'fixture visual review only',
    approvedAt: NOW
  }, { bundleDirectory });
  await assert.doesNotReject(() => verifyBundleApprovalForExport(approval, {
    root,
    forgeRoot: root
  }));

  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const originalLedger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const index = originalLedger.results.findIndex(({ id }) => id === imported.result.id);
  const mutations = [
    ['unitAssemblyV2', (result) => { result.unitAssemblyV2.units[0].pixelAudit.visiblePixels += 1; }],
    ['transformEvidence', (result) => {
      result.unitAssemblyV2.units[0].transformEvidence.detectedKeyColor = '#FE00FE';
    }],
    ['inspection', (result) => { result.inspection.observed.push('fabricated observation'); }],
    ['warnings', (result) => { result.warnings.push('fabricated warning'); }],
    ['dryRun', (result) => { result.dryRun = true; }],
    ['subscriptionRun', (result) => { result.subscriptionRun = true; }]
  ];
  for (const [label, mutate] of mutations) {
    const ledger = structuredClone(originalLedger);
    const tampered = structuredClone(ledger.results[index]);
    mutate(tampered);
    ledger.results[index] = tampered;
    await writeFile(ledgerPath, canonicalJson(ledger));
    await writeFile(path.join(root, tampered.metadataPath), canonicalJson(tampered));

    await assert.rejects(
      () => verifyPendingGenerationForWaveApproval({
        assetId: tampered.assetId,
        generationId: tampered.id
      }, { root, forgeRoot: root }),
      undefined,
      `${label} tamper must fail pending Wave A verification`
    );
    await assert.rejects(
      () => verifyBundleApprovalForExport(approval, { root, forgeRoot: root }),
      undefined,
      `${label} tamper must fail Wave A re-export verification`
    );
  }
});

test('legacy preview and write reject a real persisted Wave A candidate without mutating its tree', async (t) => {
  const { root, imported } = await pendingWaveAFixture(t, 'building.inn');
  assert.equal(imported.result.requiredSetId, 'fable5-v2');
  assert.equal(imported.result.waveId, 'A');
  assert.equal(imported.result.visualContractVersion, 2);
  assert.ok(imported.result.unitAssemblyV2);

  const rejection = /rejects Fable5 VisualAssetContract v2 \/ Wave A candidates/;
  await assert.rejects(
    () => promotionPreviewInternal({ generationId: imported.result.id }, {
      root,
      forgeRoot: root
    }),
    rejection
  );

  const before = await hashTree(root);
  const sourceSha256 = imported.result.outputArtifacts[0].sha256;
  const approvedPath = `generated/buildings/approved/building_inn-${sourceSha256.slice(0, 16)}.png`;
  await assert.rejects(
    () => promoteCandidateInternal({
      generationId: imported.result.id,
      reviewer: 'human',
      note: 'must never enter the legacy approval tree',
      write: true,
      confirmed: true,
      expectedSourceSha256: sourceSha256,
      expectedApprovedPath: approvedPath
    }, {
      root,
      forgeRoot: root,
      now: () => NOW
    }),
    rejection
  );
  assert.equal(await hashTree(root), before);
});

test('v3 approval and re-export replay raw and normalized character evidence without mutation', async (t) => {
  const { root, bound, imported } = await pendingNormalizedCharacterFixture(t);
  const verified = await verifyPendingGenerationForWaveApproval({
    assetId: 'character.player',
    generationId: imported.result.id
  }, { root, forgeRoot: root });
  const bundleDirectory = `generated/v3/wave-bundles/${sha256('normalized-character-fixture')}`;
  const approvedPath = `${bundleDirectory}/character_player-primary-${verified.artifacts[0].sha256.slice(0, 16)}.png`;
  await mkdir(path.dirname(path.join(root, approvedPath)), { recursive: true });
  await cp(path.join(root, verified.artifacts[0].pendingPath), path.join(root, approvedPath));
  const approval = prepareWaveBundleApproval({
    assetId: 'character.player',
    category: verified.definition.category,
    definitionSha256: verified.definitionSha256,
    generationRecordDigest: verified.generationRecordDigest,
    artifacts: [{
      role: 'primary',
      generationId: imported.result.id,
      approvedPath,
      sha256: verified.artifacts[0].sha256
    }],
    reviewer: 'human',
    note: 'normalized character visual fixture',
    approvedAt: NOW
  }, { bundleDirectory });
  await assert.doesNotReject(() => verifyBundleApprovalForExport(approval, {
    root, forgeRoot: root
  }));

  const evidencePaths = [
    imported.result.unitAssemblyV2.units[0].sourceSnapshot.path,
    imported.result.unitAssemblyV2.providerKeyNormalization.normalizedSnapshot.path,
    bound.binding.identityMaster.sourceSnapshot.path,
    bound.binding.identityMaster.providerKeyNormalization.normalizedSnapshot.path
  ];
  for (const relativePath of evidencePaths) {
    const absolutePath = path.join(root, relativePath);
    const original = await readFile(absolutePath);
    await writeFile(absolutePath, Buffer.from('tampered provider evidence'));
    const tamperedTree = await hashTree(root);
    await assert.rejects(() => verifyPendingGenerationForWaveApproval({
      assetId: 'character.player',
      generationId: imported.result.id
    }, { root, forgeRoot: root }));
    await assert.rejects(() => verifyBundleApprovalForExport(approval, {
      root, forgeRoot: root
    }));
    assert.equal(await hashTree(root), tamperedTree);
    await writeFile(absolutePath, original);
  }

  const ledgerPath = path.join(root, 'data', 'local', 'generations.json');
  const originalLedgerBytes = await readFile(ledgerPath);
  const originalMetadataBytes = await readFile(path.join(root, imported.result.metadataPath));
  for (const mutate of [
    (result) => {
      result.unitAssemblyV2.providerKeyNormalization.eligibility.maskSha256 = '0'.repeat(64);
    },
    (result) => {
      result.unitAssemblyV2.providerKeyNormalization.plan.configSha256 = '0'.repeat(64);
    },
    (result) => {
      result.unitAssemblyV2.identityMaster.providerKeyNormalization.derivationSha256 = '0'.repeat(64);
    }
  ]) {
    const ledger = JSON.parse(originalLedgerBytes);
    const index = ledger.results.findIndex(({ id }) => id === imported.result.id);
    const tampered = structuredClone(ledger.results[index]);
    mutate(tampered);
    ledger.results[index] = tampered;
    await writeFile(ledgerPath, canonicalJson(ledger));
    await writeFile(path.join(root, tampered.metadataPath), canonicalJson(tampered));
    const tamperedTree = await hashTree(root);
    await assert.rejects(() => verifyPendingGenerationForWaveApproval({
      assetId: 'character.player',
      generationId: imported.result.id
    }, { root, forgeRoot: root }));
    await assert.rejects(() => verifyBundleApprovalForExport(approval, {
      root, forgeRoot: root
    }));
    assert.equal(await hashTree(root), tamperedTree);
  }
  await writeFile(ledgerPath, originalLedgerBytes);
  await writeFile(path.join(root, imported.result.metadataPath), originalMetadataBytes);
});
