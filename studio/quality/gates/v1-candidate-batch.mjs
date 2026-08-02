#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectPngBytes, runPixelArtGate } from './index.mjs';

const root = path.resolve(process.argv[2] ?? '.');
const write = process.argv.includes('--write');
const demandPath = path.join(root, 'studio/art-department/v1/selector-demand.json');
const candidateRoot = path.join(root, 'studio/art-department/v1/candidates');
const worldRoot = path.join(candidateRoot, 'world');
const originalsRoot = path.join(root, 'art/references/user-provided');

function json(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function pngDimensions(file) {
  const inspected = inspectPngBytes(readFileSync(file), path.relative(root, file));
  return { width: inspected.width, height: inspected.height };
}

function requireFile(file, label) {
  const entry = lstatSync(file, { throwIfNoEntry: false });
  if (!entry?.isFile() || entry.isSymbolicLink()) {
    throw new Error(`${label} does not exist: ${path.relative(root, file)}`);
  }
}

function rootRelative(file) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path escapes repository: ${file}`);
  }
  return relative;
}

function candidatePath(scope, value) {
  const resolved = scope === 'world'
    ? path.resolve(worldRoot, value)
    : path.resolve(root, value);
  const relative = path.relative(candidateRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`candidate path escapes studio candidate tree: ${value}`);
  }
  return resolved;
}

const demand = json(demandPath);
const world = json(path.join(worldRoot, 'index.json'));
const actors = json(path.join(candidateRoot, 'actors-ui/index.json'));
if (demand.status !== 'ready' || demand.selectorCount !== 60 || demand.selectors.length !== 60) {
  throw new Error('frozen selector demand must remain ready with exactly 60 selectors');
}
if (demand.custody.expected !== 22 || demand.custody.checked !== 22 || demand.custody.originals.length !== 22 || demand.custody.unexpected?.length) {
  throw new Error('immutable-original custody must remain exact at 22/22');
}
const expected = demand.selectors.map(({ selector }) => selector).sort();
const submitted = [...world.selectors, ...actors.selectors]
  .map(({ selector }) => selector)
  .sort();

if (new Set(submitted).size !== submitted.length) throw new Error('duplicate selector submitted');
if (JSON.stringify(expected) !== JSON.stringify(submitted)) {
  throw new Error('submitted selectors do not exactly equal the frozen 60-selector demand');
}

for (const original of demand.custody.originals) {
  const file = path.join(originalsRoot, original.file);
  requireFile(file, 'immutable original');
  if (digest(file) !== original.sha256) throw new Error(`immutable original changed: ${original.file}`);
}
if (world.mechanicalGate?.state === 'pending-local-gate' || world.status !== 'reviewable') {
  throw new Error('world aggregate evidence is pending or not reviewable');
}

const legacy = runPixelArtGate({
  repositoryRoot: root,
  candidatesRoot: worldRoot,
  palettePath: path.join(root, 'studio/art-department/v1/palette.json')
});
const legacyByPath = new Map(legacy.candidates.map((entry) => [entry.path, entry]));
const entries = [];

for (const sourceEntry of world.selectors) {
  const file = candidatePath('world', sourceEntry.candidatePath);
  const metadataFile = candidatePath('world', sourceEntry.metadataPath);
  const provenanceFile = candidatePath('world', sourceEntry.provenancePath);
  const reviewFile = candidatePath('world', sourceEntry.reviewPath);
  for (const [candidateFile, label] of [[file, 'candidate'], [metadataFile, 'metadata'], [provenanceFile, 'provenance'], [reviewFile, 'review']]) {
    requireFile(candidateFile, label);
  }
  const sha256 = digest(file);
  const dimensions = pngDimensions(file);
  const byteLength = statSync(file).size;
  if (sha256 !== sourceEntry.candidateSha256 || byteLength !== sourceEntry.candidateByteLength) {
    throw new Error(`world index identity mismatch: ${sourceEntry.selector}`);
  }
  const metadata = json(metadataFile);
  const provenance = json(provenanceFile);
  const review = json(reviewFile);
  if (metadata.selector !== sourceEntry.selector || provenance.selector !== sourceEntry.selector || review.selector !== sourceEntry.selector) {
    throw new Error(`world record selector mismatch: ${sourceEntry.selector}`);
  }
  if (provenance.candidatePath !== sourceEntry.candidatePath || provenance.candidateSha256 !== sha256 || provenance.candidateByteLength !== byteLength || JSON.stringify(provenance.dimensions && { width: provenance.dimensions.width, height: provenance.dimensions.height }) !== JSON.stringify(dimensions)) {
    throw new Error(`world provenance identity mismatch: ${sourceEntry.selector}`);
  }
  if (provenance.source?.sourceOriginal) {
    const originalFile = path.join(originalsRoot, provenance.source.sourceOriginal);
    requireFile(originalFile, 'provenance source original');
    if (digest(originalFile) !== provenance.source.sourceSha256) throw new Error(`world source hash mismatch: ${sourceEntry.selector}`);
  } else if (!provenance.source?.generationMethod || !provenance.source?.prompt || !provenance.source?.sourceGeneratedSha256) {
    throw new Error(`world generation provenance incomplete: ${sourceEntry.selector}`);
  }
  const observed = legacyByPath.get(sourceEntry.candidatePath);
  if (!observed) throw new Error(`legacy pixel observation missing: ${sourceEntry.selector}`);
  const mechanicalChecks = Object.fromEntries(observed.checks.map((check) => [
    check.id,
    check.state === 'pass' ? 'passed' : check.state === 'fail' ? 'failed' : 'unknown'
  ]));
  const mechanicalState = observed.ok ? (observed.unknown.length ? 'unknown' : 'passed') : 'failed';
  if (provenance.mechanical?.state !== mechanicalState || review.mechanicalState !== mechanicalState) {
    throw new Error(`world mechanical summary is stale: ${sourceEntry.selector}`);
  }
  entries.push({
    selector: sourceEntry.selector,
    candidatePath: rootRelative(file),
    candidateSha256: sha256,
    candidateByteLength: byteLength,
    dimensions,
    metadataPath: rootRelative(metadataFile),
    provenancePath: rootRelative(provenanceFile),
    reviewPath: rootRelative(reviewFile),
    source: provenance.source,
    reuseOf: provenance.reuse?.ofSelector ?? provenance.reuse?.selector ?? null,
    reuseReason: provenance.reuse?.explicitReason ?? provenance.reuse?.reason ?? null,
    mechanicalChecks,
    approval: 'unknown'
  });
}

for (const sourceEntry of actors.selectors) {
  const file = candidatePath('actors-ui', sourceEntry.candidatePath);
  const sidecarFile = candidatePath('actors-ui', sourceEntry.sidecarPath);
  const reviewFile = candidatePath('actors-ui', sourceEntry.reviewPath);
  for (const [candidateFile, label] of [[file, 'candidate'], [sidecarFile, 'sidecar'], [reviewFile, 'review material']]) {
    requireFile(candidateFile, label);
  }
  const sha256 = digest(file);
  const dimensions = pngDimensions(file);
  if (sha256 !== sourceEntry.candidateSha256 || JSON.stringify(dimensions) !== JSON.stringify(sourceEntry.dimensions)) {
    throw new Error(`actors/UI index identity mismatch: ${sourceEntry.selector}`);
  }
  const sidecar = json(sidecarFile);
  if (sidecar.selector !== sourceEntry.selector || sidecar.candidate?.path !== sourceEntry.candidatePath || sidecar.candidate?.sha256 !== sha256 || JSON.stringify(sidecar.candidate?.dimensions) !== JSON.stringify(dimensions)) {
    throw new Error(`actors/UI sidecar identity mismatch: ${sourceEntry.selector}`);
  }
  for (const original of sidecar.sourceOriginals ?? []) {
    const originalFile = path.join(root, original.path);
    requireFile(originalFile, 'actors/UI source original');
    if (digest(originalFile) !== original.sha256) throw new Error(`actors/UI source hash mismatch: ${sourceEntry.selector}`);
  }
  const checks = sidecar.mechanicalChecks;
  if (!checks || Object.values(checks).some((state) => !['passed', 'failed', 'unknown'].includes(state))) {
    throw new Error(`invalid actors/UI mechanical state: ${sourceEntry.selector}`);
  }
  entries.push({
    selector: sourceEntry.selector,
    candidatePath: rootRelative(file),
    candidateSha256: sha256,
    candidateByteLength: statSync(file).size,
    dimensions,
    sidecarPath: rootRelative(sidecarFile),
    reviewPath: rootRelative(reviewFile),
    source: { sourceOriginals: sidecar.sourceOriginals, method: sidecar.method },
    reuseOf: sidecar.reuse?.ofSelector ?? null,
    reuseReason: sidecar.reuse?.explicitReason ?? null,
    mechanicalChecks: checks,
    approval: 'unknown'
  });
}

entries.sort((left, right) => left.selector.localeCompare(right.selector));
const bySelector = new Map(entries.map((entry) => [entry.selector, entry]));
const byHash = Map.groupBy(entries, (entry) => entry.candidateSha256);
for (const entry of entries) {
  if (entry.reuseOf === null) continue;
  const target = bySelector.get(entry.reuseOf);
  if (!target || target.candidateSha256 !== entry.candidateSha256 || !entry.reuseReason) {
    throw new Error(`invalid declared reuse: ${entry.selector}`);
  }
}
for (const group of byHash.values()) {
  if (group.length < 2) continue;
  const canonical = group.find((entry) => entry.reuseOf === null);
  if (!canonical) throw new Error(`duplicate-byte group has no canonical selector: ${group.map(({ selector }) => selector).join(', ')}`);
  for (const entry of group) {
    if (entry === canonical) continue;
    const target = bySelector.get(entry.reuseOf);
    if (!target || target.candidateSha256 !== entry.candidateSha256 || !entry.reuseReason) {
      throw new Error(`undeclared or invalid duplicate-byte reuse: ${entry.selector}`);
    }
  }
}

for (const entry of entries.filter(({ selector }) => selector.startsWith('room:'))) {
  const building = bySelector.get(`building:${entry.selector.slice('room:'.length)}`);
  if (!building || building.candidateSha256 === entry.candidateSha256) {
    throw new Error(`room candidate is not distinct from its exterior: ${entry.selector}`);
  }
  const metadata = json(path.join(root, entry.metadataPath));
  if (metadata.kind !== 'room' && metadata.spec?.kind !== 'room') {
    throw new Error(`room candidate is not typed as room: ${entry.selector}`);
  }
}

const contactSheets = [
  'studio/art-department/v1/candidates/world/review/contact-sheet.webp',
  'studio/art-department/v1/candidates/actors-ui/review/actors-ui-contact-sheet.png'
].map((relative) => {
  const file = path.join(root, relative);
  requireFile(file, 'contact sheet');
  return { path: relative, sha256: digest(file) };
});

const worldReviewPath = path.join(worldRoot, 'review/index.json');
const worldReview = json(worldReviewPath);
const worldReviewExpected = world.selectors.map((entry, gridIndex) => ({
  selector: entry.selector,
  candidatePath: entry.candidatePath,
  sha256: entry.candidateSha256,
  gridIndex
}));
if (JSON.stringify(worldReview.entries) !== JSON.stringify(worldReviewExpected)) {
  throw new Error('world review manifest is stale');
}
if (worldReview.contactSheetSha256 !== contactSheets[0].sha256) throw new Error('world contact sheet hash is stale');
const actorsReviewPath = path.join(candidateRoot, 'actors-ui/review/review-report.json');
const actorsReview = json(actorsReviewPath);
const actorSelectors = actors.selectors.map(({ selector }) => selector);
const actorsReviewExpected = actors.selectors.map((entry, gridIndex) => ({
  selector: entry.selector,
  candidatePath: entry.candidatePath,
  sha256: entry.candidateSha256,
  gridIndex
}));
if (actorsReview.candidateCount !== 21 || JSON.stringify(actorsReview.selectors) !== JSON.stringify(actorSelectors) || JSON.stringify(actorsReview.entries) !== JSON.stringify(actorsReviewExpected)) {
  throw new Error('actors/UI review manifest is stale');
}
if (actorsReview.contactSheetSha256 !== contactSheets[1].sha256) throw new Error('actors/UI contact sheet hash is stale');

const report = {
  format: 'codecity.v1-candidate-review-batch',
  schemaVersion: 1,
  status: 'ready-for-human-H1-review',
  selectorDemand: { path: rootRelative(demandPath), sha256: digest(demandPath), selectorCount: expected.length },
  entries,
  contactSheets,
  reviewManifests: [
    { path: rootRelative(worldReviewPath), sha256: digest(worldReviewPath) },
    { path: rootRelative(actorsReviewPath), sha256: digest(actorsReviewPath) }
  ],
  custody: { expected: 22, checked: demand.custody.originals.length, originalsUnchanged: true },
  legacyPixelGate: {
    status: legacy.status,
    candidatePassed: legacy.candidates.filter(({ ok }) => ok).length,
    candidateFailed: legacy.candidates.filter(({ ok }) => !ok).length,
    failedSelectors: legacy.candidates.filter(({ ok }) => !ok).map(({ path: candidate, failures }) => ({
      candidate,
      failureCodes: failures.map(({ code }) => code)
    })),
    allChecksObserved: true,
    limitations: 'Failed heuristics remain failed observations; this batch gate does not convert them into passes.'
  },
  approval: 'unknown',
  limitations: [
    'This proves exact batch identity, custody, paths, declared reuse, and recorded mechanical observations only.',
    'It does not prove human approval, visual fit in the runtime, P2-P6, playability, or the product KGI.'
  ]
};

if (write) {
  writeFileSync(path.join(candidateRoot, 'index.json'), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({ ok: true, selectorCount: entries.length, legacyPixelGate: legacy.status }, null, 2)}\n`);
