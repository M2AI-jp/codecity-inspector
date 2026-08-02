#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_BATCH_SHA256 = '5d07182d274f9b6542c22255ad00676abe7dad423c306287b5db76b6ab2632ec';
const EXPECTED_BATCH_COMMIT = 'd75b6d9a997a7e45593be81f4c5b9ca1f2bea53d';
const EXPECTED_APPROVAL_SHA256 = '472ae2533b2e5e16632f083a45e34476ee689fa8d2fb1ef5d8a4bbd0ac473401';
const EXPECTED_SELECTOR_COUNT = 60;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const candidateIndexPath = path.join(root, 'studio/art-department/v1/candidates/index.json');
const approvalPath = path.join(root, 'studio/art-department/v1/approvals/h1-v1.json');
const approvedRoot = path.join(root, 'studio/art-department/v1/approved');
const mode = process.argv[2] ?? '--check';

if (!['--write', '--check'].includes(mode)) throw new Error('Usage: promote-v1.mjs [--write|--check]');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const slug = (selector) => selector.replace(':', '--');

function exactFile(file, bytes, immutable = false) {
  if (fs.existsSync(file)) {
    if (!fs.readFileSync(file).equals(bytes)) throw new Error(`${immutable ? 'Immutable' : 'Generated'} output mismatch: ${path.relative(root, file)}`);
    return;
  }
  if (mode === '--check') throw new Error(`Missing output: ${path.relative(root, file)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx' });
}

function sourceBinding(entry) {
  if (typeof entry.source?.sourceSha256 === 'string') return {
    source: `art/references/user-provided/${entry.source.sourceOriginal}`,
    sourceSha256: entry.source.sourceSha256,
    kind: 'derived', custody: 'owner-supplied-original'
  };
  if (typeof entry.source?.sourceGeneratedSha256 === 'string') return {
    source: 'generated:codex-subscription-image-generation',
    sourceSha256: entry.source.sourceGeneratedSha256,
    kind: 'generated', custody: 'owner-authorized-codex-subscription'
  };
  const originals = entry.source?.sourceOriginals;
  const hashes = [...new Set((originals ?? []).map((item) => item.sha256))];
  const paths = [...new Set((originals ?? []).map((item) => item.path))];
  if (hashes.length !== 1 || paths.length !== 1) throw new Error(`No single source identity for ${entry.selector}`);
  return {
    source: paths[0], sourceSha256: hashes[0],
    kind: entry.source.method?.kind === 'exact-byte-reuse' ? 'reused-derivative' : 'derived',
    custody: 'owner-supplied-original'
  };
}

function usageFor(entry) {
  const [family] = entry.selector.split(':');
  const { width, height } = entry.dimensions;
  const frame = { width, height, columns: 1, rows: 1 };
  if (family === 'player') {
    const sidecar = readJson(path.join(root, entry.sidecarPath));
    const animations = Object.fromEntries(Object.entries(sidecar.frameMetadata.animations).map(([state, directions]) => [
      state,
      Object.fromEntries(Object.entries(directions).map(([direction, frames]) => [direction, {
        frames, fps: state === 'idle' ? 2 : state === 'walk' ? 8 : 12
      }]))
    ]));
    return {
      kind: 'character', layer: 'actor', frame: sidecar.frameMetadata.frame,
      collision: { kind: 'rect', x: 10, y: 20, width: 12, height: 12 }, animations
    };
  }
  if (family === 'npc') {
    const directions = (frames) => Object.fromEntries(['north', 'south', 'east', 'west'].map((direction) => [direction, { frames: [...frames], fps: 1 }]));
    return {
      kind: 'character', layer: 'actor', frame, collision: { kind: 'none' },
      animations: { idle: directions([0, 0]), walk: directions([0, 0, 0, 0]) }
    };
  }
  if (family === 'building') {
    const entranceWidth = Math.min(16, width);
    const entranceHeight = Math.min(16, height);
    return {
      kind: 'building', layer: 'object', frame,
      collision: { kind: 'rect', x: 0, y: Math.max(0, height - Math.min(32, height)), width, height: Math.min(32, height) },
      entrance: { x: Math.floor((width - entranceWidth) / 2), y: height - entranceHeight, width: entranceWidth, height: entranceHeight }
    };
  }
  const compatibility = {
    terrain: ['terrain', 'ground'], water: ['water', 'ground'], road: ['road', 'ground'],
    plot: ['terrain', 'ground'], room: ['room', 'object'], prop: ['prop', 'object'],
    light: ['light', 'foreground'], quest: ['quest', 'foreground'], ui: ['ui', 'ui'], effect: ['effect', 'effect']
  }[family];
  if (!compatibility) throw new Error(`No usage contract for ${entry.selector}`);
  return { kind: compatibility[0], layer: compatibility[1], frame, collision: { kind: 'none' } };
}

const batchBytes = fs.readFileSync(candidateIndexPath);
if (sha256(batchBytes) !== EXPECTED_BATCH_SHA256) throw new Error('Frozen candidate batch hash mismatch');
const batch = JSON.parse(batchBytes);
if (batch.entries?.length !== EXPECTED_SELECTOR_COUNT) throw new Error('Frozen candidate batch must contain 60 entries');
if (!fs.existsSync(approvalPath)) throw new Error('Pre-existing human approval is required; promotion never creates approval');
const approvalBytes = fs.readFileSync(approvalPath);
const approval = JSON.parse(approvalBytes);
const batchSelectors = batch.entries.map((entry) => entry.selector);
const approvalSelectors = (approval.records ?? []).map((record) => record.selector);
const validApprovalDate = typeof approval.approvedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(approval.approvedAt) && !Number.isNaN(Date.parse(approval.approvedAt));
if (sha256(approvalBytes) !== EXPECTED_APPROVAL_SHA256 || approval.format !== 'codecity.h1-owner-approval' || approval.schemaVersion !== 1 ||
    approval.decision !== 'accepted-for-functional-v1' || approval.actorType !== 'human' || approval.authority !== 'owner' ||
    typeof approval.approvedBy !== 'string' || approval.approvedBy.trim() === '' || !validApprovalDate ||
    approval.candidateBatch?.commit !== EXPECTED_BATCH_COMMIT || approval.candidateBatch?.sha256 !== EXPECTED_BATCH_SHA256 ||
    approval.candidateBatch?.selectorCount !== EXPECTED_SELECTOR_COUNT || approval.records?.length !== EXPECTED_SELECTOR_COUNT ||
    new Set(approvalSelectors).size !== EXPECTED_SELECTOR_COUNT || approval.records.some((record) => record.decision !== 'accepted') ||
    JSON.stringify([...approvalSelectors].sort()) !== JSON.stringify([...batchSelectors].sort())) {
  throw new Error('Human approval does not bind the frozen 60-entry batch');
}
const records = new Map(approval.records.map((record) => [record.selector, record]));

const assets = batch.entries.map((entry) => {
  const candidateBytes = fs.readFileSync(path.join(root, entry.candidatePath));
  if (sha256(candidateBytes) !== entry.candidateSha256 || candidateBytes.length !== entry.candidateByteLength) throw new Error(`Candidate mismatch: ${entry.selector}`);
  const source = sourceBinding(entry);
  const record = records.get(entry.selector);
  if (!record || record.decision !== 'accepted' || record.candidateSha256 !== entry.candidateSha256 || record.sourceSha256 !== source.sourceSha256) {
    throw new Error(`Approval mismatch: ${entry.selector}`);
  }
  exactFile(path.join(approvedRoot, 'assets', `${slug(entry.selector)}.png`), candidateBytes, true);
  return {
    selector: entry.selector,
    path: `assets/${slug(entry.selector)}.png`,
    sha256: entry.candidateSha256,
    dimensions: entry.dimensions,
    pivot: { x: Math.floor(entry.dimensions.width / 2), y: entry.dimensions.height - 1 },
    usage: usageFor(entry),
    license: { name: 'Owner-authorized CodeCity v1 product use', holder: 'CodeCity owner' },
    provenance: { ...source, evidence: 'observed' },
    approvalRecordId: record.recordId
  };
});

const manifest = {
  format: 'codecity.approved-asset-masters', schemaVersion: 1,
  approvalRecordSha256: sha256(approvalBytes), candidateBatchSha256: EXPECTED_BATCH_SHA256, assets
};
const manifestBytes = Buffer.from(stableJson(manifest));
const manifestPath = path.join(approvedRoot, 'manifest.json');
exactFile(manifestPath, manifestBytes, true);

process.stdout.write(`${JSON.stringify({ ok: true, mode, approvalSha256: sha256(approvalBytes), approvedManifestSha256: sha256(manifestBytes), assetCount: assets.length })}\n`);
