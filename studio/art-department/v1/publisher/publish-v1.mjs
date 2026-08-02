#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPngMetadata, resolveAsset, validateAssetManifest } from '../../../../ship/50-art/index.mjs';

const EXPECTED_SELECTOR_COUNT = 60;
const EXPECTED_BATCH_SHA256 = '5d07182d274f9b6542c22255ad00676abe7dad423c306287b5db76b6ab2632ec';
const EXPECTED_BATCH_COMMIT = 'd75b6d9a997a7e45593be81f4c5b9ca1f2bea53d';
const EXPECTED_APPROVAL_SHA256 = '472ae2533b2e5e16632f083a45e34476ee689fa8d2fb1ef5d8a4bbd0ac473401';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const approvalPath = path.join(root, 'studio/art-department/v1/approvals/h1-v1.json');
const approvedRoot = path.join(root, 'studio/art-department/v1/approved');
const shippingRoot = path.join(root, 'ship/50-art');
const mode = process.argv[2] ?? '--check';

if (!['--write', '--check'].includes(mode)) throw new Error('Usage: publish-v1.mjs [--write|--check]');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function output(file, bytes) {
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file).equals(bytes)) return;
    if (mode === '--check') throw new Error(`Generated output mismatch: ${path.relative(root, file)}`);
    fs.writeFileSync(file, bytes);
    return;
  }
  if (mode === '--check') throw new Error(`Missing output: ${path.relative(root, file)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx' });
}

if (!fs.existsSync(approvalPath)) throw new Error('Pre-existing human approval is required; publisher never creates approval');
const approvalBytes = fs.readFileSync(approvalPath);
const approval = JSON.parse(approvalBytes);
const approvedManifestPath = path.join(approvedRoot, 'manifest.json');
if (!fs.existsSync(approvedManifestPath)) throw new Error('Approved master manifest is required');
const approved = readJson(approvedManifestPath);
const validApprovalDate = typeof approval.approvedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(approval.approvedAt) && !Number.isNaN(Date.parse(approval.approvedAt));
if (sha256(approvalBytes) !== EXPECTED_APPROVAL_SHA256 || approval.format !== 'codecity.h1-owner-approval' || approval.schemaVersion !== 1 ||
    approval.decision !== 'accepted-for-functional-v1' || approval.actorType !== 'human' || approval.authority !== 'owner' ||
    typeof approval.approvedBy !== 'string' || approval.approvedBy.trim() === '' || !validApprovalDate ||
    approval.candidateBatch?.commit !== EXPECTED_BATCH_COMMIT || approval.candidateBatch?.sha256 !== EXPECTED_BATCH_SHA256 ||
    approval.candidateBatch?.selectorCount !== EXPECTED_SELECTOR_COUNT || approval.records?.length !== EXPECTED_SELECTOR_COUNT ||
    approval.records.some((record) => record.decision !== 'accepted') ||
    approved.format !== 'codecity.approved-asset-masters' || approved.schemaVersion !== 1 ||
    approved.approvalRecordSha256 !== sha256(approvalBytes) || approved.candidateBatchSha256 !== approval.candidateBatch?.sha256 ||
    approved.assets?.length !== EXPECTED_SELECTOR_COUNT) {
  throw new Error('Approved master authority boundary is invalid');
}

const records = new Map(approval.records.map((record) => [record.selector, record]));
const selectors = approved.assets.map((asset) => asset.selector);
const approvalSelectors = approval.records.map((record) => record.selector);
if (new Set(selectors).size !== EXPECTED_SELECTOR_COUNT || new Set(approvalSelectors).size !== EXPECTED_SELECTOR_COUNT ||
    JSON.stringify(selectors) !== JSON.stringify([...selectors].sort()) ||
    JSON.stringify([...approvalSelectors].sort()) !== JSON.stringify([...selectors].sort())) {
  throw new Error('Approved master selectors must be sorted, unique, and complete');
}

const assets = approved.assets.map((master) => {
  const record = records.get(master.selector);
  if (!record || record.decision !== 'accepted' || record.recordId !== master.approvalRecordId ||
      record.candidateSha256 !== master.sha256 || record.sourceSha256 !== master.provenance?.sourceSha256) {
    throw new Error(`Approved master is not bound to human approval: ${master.selector}`);
  }
  const bytes = fs.readFileSync(path.join(approvedRoot, master.path));
  if (sha256(bytes) !== master.sha256) throw new Error(`Approved master hash mismatch: ${master.selector}`);
  const png = readPngMetadata(approvedRoot, master.path);
  if (png.width !== master.dimensions.width || png.height !== master.dimensions.height) throw new Error(`Approved master dimensions mismatch: ${master.selector}`);
  const filename = path.basename(master.path);
  output(path.join(shippingRoot, 'assets', filename), bytes);
  const id = `${master.selector.replace(':', '--')}-v1`;
  return {
    id, version: '1.0.0', status: 'accepted', accepted: true,
    path: filename, url: `/assets/${filename}`, sha256: master.sha256,
    dimensions: master.dimensions, pivot: master.pivot, usage: master.usage,
    license: master.license, provenance: master.provenance,
    approval: {
      recordId: record.recordId, actorType: approval.actorType, authority: approval.authority,
      approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, decision: 'accepted',
      assetId: id, assetSha256: master.sha256, sourceSha256: master.provenance.sourceSha256
    }
  };
});

const manifest = { format: 'codecity.asset-manifest', schemaVersion: 1, manifestVersion: '1.0.0', fallbackPolicy: 'none', assets };
const bindings = {
  format: 'codecity.scene-bindings', schemaVersion: 1,
  selectors: Object.fromEntries(approved.assets.map((asset, index) => [asset.selector, assets[index].id]))
};
const license = {
  format: 'codecity.asset-license-record', schemaVersion: 1,
  name: 'Owner-authorized CodeCity v1 product use', holder: 'CodeCity owner', appliesToManifestVersion: '1.0.0', assetCount: assets.length
};
const provenance = {
  format: 'codecity.asset-provenance', schemaVersion: 1,
  candidateBatchSha256: approved.candidateBatchSha256, approvalRecordSha256: approved.approvalRecordSha256,
  assets: assets.map(({ id, sha256: assetSha256, provenance: record }) => ({ id, assetSha256, ...record }))
};

output(path.join(shippingRoot, 'manifest.json'), Buffer.from(stableJson(manifest)));
output(path.join(shippingRoot, 'scene-bindings.json'), Buffer.from(stableJson(bindings)));
output(path.join(shippingRoot, 'license.json'), Buffer.from(stableJson(license)));
output(path.join(shippingRoot, 'provenance.json'), Buffer.from(stableJson(provenance)));

const assetRoot = path.join(shippingRoot, 'assets');
const diskManifest = validateAssetManifest(readJson(path.join(shippingRoot, 'manifest.json')), { assetRoot, verifyFiles: true });
const diskBindings = readJson(path.join(shippingRoot, 'scene-bindings.json'));
for (const selector of selectors) resolveAsset(diskManifest, diskBindings.selectors[selector], { assetRoot });

const representativeSelectors = ['player:default', 'building:town_hall', 'terrain:meadow', 'road:main', 'water:default', 'prop:lamp', 'light:lit', 'quest:inspect'];
const representatives = Object.fromEntries(representativeSelectors.map((selector) => {
  const asset = resolveAsset(diskManifest, diskBindings.selectors[selector], { assetRoot });
  return [selector, { assetId: asset.id, sha256: asset.sha256, kind: asset.usage.kind, layer: asset.usage.layer }];
}));

process.stdout.write(`${JSON.stringify({
  ok: true, mode, approvedManifestSha256: sha256(fs.readFileSync(approvedManifestPath)),
  approvalSha256: sha256(approvalBytes), manifestSha256: sha256(Buffer.from(stableJson(manifest))),
  selectorCount: selectors.length, assetCount: assets.length, fallbackPolicy: manifest.fallbackPolicy, representatives
})}\n`);
