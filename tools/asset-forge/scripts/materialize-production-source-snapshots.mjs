import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { FORGE_ROOT } from '../src/config.mjs';
import { atomicReplaceJson } from '../src/fs-safe.mjs';
import { hashFile } from '../src/hashing.mjs';
import {
  materializeProductionSourceSnapshot,
  promotionPreview
} from '../src/jobs/lifecycle.mjs';
import { readLocalGenerationManifest } from '../src/manifests/local-generations.mjs';

const EXPECTED_COUNTS = Object.freeze({ building: 17, field: 19, character: 22, object: 18, effect: 2 });

async function filesBelow(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(candidate));
    else if (entry.isFile()) files.push(candidate);
    else throw new Error(`Unsupported entry in generated tree: ${candidate}`);
  }
  return files.sort();
}

function categoryCounts(results) {
  return Object.fromEntries(Object.keys(EXPECTED_COUNTS).map((category) => [
    category,
    results.filter((entry) => entry.category === category).length
  ]));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main() {
  const before = await readLocalGenerationManifest(FORGE_ROOT);
  if (before.results.length !== 78 || !same(categoryCounts(before.results), EXPECTED_COUNTS)
    || before.results.some((entry) => entry.status !== 'pending' || !entry.productionRecipe)) {
    throw new Error('Source-snapshot materialization requires the exact 78 accepted pending production recipes');
  }
  const outputHashesBefore = new Map();
  for (const result of before.results) {
    const actual = await hashFile(path.join(FORGE_ROOT, result.outputPath));
    if (actual !== result.outputSha256) throw new Error(`${result.assetId}: candidate output hash mismatch before persistence`);
    outputHashesBefore.set(result.id, actual);
  }

  const records = [];
  for (const result of before.results) {
    const persisted = await materializeProductionSourceSnapshot({ generationId: result.id });
    const preview = await promotionPreview({ generationId: result.id });
    records.push({
      generationId: result.id,
      assetId: result.assetId,
      category: result.category,
      originalSource: persisted.result.productionRecipe.source,
      sourceSnapshot: persisted.result.productionRecipe.sourceSnapshot,
      candidateOutputPath: persisted.result.outputPath,
      candidateOutputSha256: persisted.result.outputSha256,
      outputBytesUnchanged: (await hashFile(path.join(FORGE_ROOT, persisted.result.outputPath))) === outputHashesBefore.get(result.id),
      promotionPreview: preview
    });
  }

  const after = await readLocalGenerationManifest(FORGE_ROOT);
  if (after.results.length !== 78 || !same(categoryCounts(after.results), EXPECTED_COUNTS)
    || after.results.some((entry) => entry.status !== 'pending' || !entry.productionRecipe?.sourceSnapshot)) {
    throw new Error('Source-snapshot persistence changed the accepted pending ledger shape');
  }
  if (records.some((record) => !record.outputBytesUnchanged
    || record.originalSource.sha256 !== record.sourceSnapshot.sha256
    || record.originalSource.width !== record.sourceSnapshot.width
    || record.originalSource.height !== record.sourceSnapshot.height)) {
    throw new Error('Source-snapshot or candidate-output integrity gate failed');
  }

  const approvedFiles = (await filesBelow(path.join(FORGE_ROOT, 'generated')))
    .filter((file) => file.includes(`${path.sep}approved${path.sep}`));
  const snapshotFiles = new Set(records.map((record) => path.join(FORGE_ROOT, record.sourceSnapshot.path)));
  if (approvedFiles.some((file) => !/\.source-original\.(png|jpg|webp)$/.test(file))
    || approvedFiles.length !== snapshotFiles.size
    || approvedFiles.some((file) => !snapshotFiles.has(file))) {
    throw new Error('Generated approved directories contain something other than the referenced original-source snapshots');
  }

  const audit = {
    schemaVersion: 1,
    state: 'accepted-pending-source-snapshots-ready',
    observed: [
      'All seventy-eight accepted pending generations have a verified persistent original-source snapshot.',
      'Every snapshot byte hash and decoded dimensions match the original source recorded by its production recipe.',
      'Every accepted candidate output PNG retained its exact pre-persistence SHA-256.',
      'Promotion preview passed for all seventy-eight generations without approving or exporting any asset.'
    ],
    inferred: [
      'The accepted candidates are provenance-ready for the Lead-controlled human promotion ceremony.'
    ],
    unknown: [
      'formal human promotion results',
      'public export results',
      'runtime browser behavior after public export'
    ],
    counts: { total: after.results.length, categories: categoryCounts(after.results), uniqueOriginalSnapshots: snapshotFiles.size },
    gates: {
      exact78Pending: true,
      all78SourceSnapshotsVerified: true,
      all78CandidateOutputBytesUnchanged: true,
      all78PromotionPreviewsPassed: true,
      productionApprovalsCreated: false,
      publicExportPerformed: false
    },
    records
  };
  await atomicReplaceJson(FORGE_ROOT, path.join(FORGE_ROOT, 'review', 'production-source-snapshot-audit.json'), audit);
}

await main();
