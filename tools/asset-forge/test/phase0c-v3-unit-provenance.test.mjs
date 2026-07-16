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
import { makeWaveAJob } from '../src/v2/operator.mjs';
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
          width: width - 8,
          height: height - 8,
          channels: 4,
          background: color
        }
      }).png().toBuffer(),
      left: 4,
      top: 4
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
