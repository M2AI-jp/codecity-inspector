import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { assertCanonicalInteractiveTerminal } from '../human-write-gate.mjs';
import { atomicReplaceJson, atomicWriteFile, atomicWriteJson, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { readLocalGenerationManifest } from '../manifests/local-generations.mjs';
import { assetFileStem, assertExistingFileWithin, assertNoSymlinkPath, containedBy } from '../paths.mjs';
import { inspectPng } from '../png-core.mjs';
import { validateWith } from '../schemas.mjs';
import { readWaveADefinitions } from '../v2/definition-builder.mjs';
import { readWaveAReferenceAuthorization } from '../v2/reference-authorization.mjs';
import {
  appendWaveApproval,
  artifactSetDigestFor,
  assertBundleLedger,
  cellAuditSetDigestFor,
  evidenceCoverageDigestFor,
  prepareWaveBundleApproval,
  waveApprovalDigestFor
} from './bundle-ledger.mjs';
import {
  assertWaveACellCounts,
  auditWaveAAssetCells,
  deriveWaveACellContract
} from './cell-audit.mjs';
import { loadRequiredWaveDeclaration } from './export-v3.mjs';
import { readLegacyDisposition } from './migration.mjs';
import {
  bundleLedgerDigest,
  bundleLedgerPaths,
  transactBundleLedger,
  withBundleLedgerSnapshot
} from './persistence.mjs';
import { verifyPendingGenerationForWaveApproval } from './provenance.mjs';

const SELECTION_RELATIVE = 'data/v3/wave-a-selection.json';
const JOURNAL_RELATIVE = 'data/v3/wave-a-approval-journal.json';
const WAVE_LOCK_RELATIVE = 'data/v3/.wave-a-approval.lock';
const BLUEPRINT_IDS = Object.freeze(['old-town', 'snow', 'harbor', 'woodland', 'night', 'cutaway']);
const ISSUED_PREVIEWS = new WeakMap();
const REQUIRED_COUNTS = Object.freeze({
  assets: 109,
  artifacts: 128,
  declared: 771,
  semantic: 708,
  semanticNonempty: 696,
  semanticTransparent: 12,
  reservedTransparent: 63
});

function withoutField(value, field) {
  const copy = structuredClone(value);
  delete copy[field];
  return copy;
}

function digest(value) {
  return sha256(canonicalJson(value));
}

function requireCanonicalRoot(root, forgeRoot) {
  const actualRoot = path.resolve(root);
  const actualForgeRoot = path.resolve(forgeRoot);
  if (actualRoot !== actualForgeRoot) {
    throw new Error('Wave A bulk approval requires one canonical Asset Forge root');
  }
  return actualRoot;
}

async function readStableBytes(root, relativePath, maximumBytes = 25 * 1024 * 1024) {
  const source = await assertExistingFileWithin(root, relativePath);
  const before = await lstat(source, { bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(maximumBytes)) {
    throw new Error(`Wave A approval input is empty or too large: ${relativePath}`);
  }
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) {
      throw new Error(`Wave A approval input changed while opening: ${relativePath}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
      || BigInt(bytes.length) !== opened.size) {
      throw new Error(`Wave A approval input changed while reading: ${relativePath}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readCanonicalJson(root, relativePath, schemaName, { allowMissing = false } = {}) {
  let bytes;
  try {
    bytes = await readStableBytes(root, relativePath, 16 * 1024 * 1024);
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Malformed Wave A JSON: ${relativePath}`, { cause: error });
  }
  const validation = validateWith(schemaName, value);
  if (!validation.ok) throw new Error(`Invalid ${relativePath}: ${JSON.stringify(validation.errors)}`);
  if (!bytes.equals(Buffer.from(canonicalJson(value)))) {
    throw new Error(`${relativePath} must use exact canonical JSON encoding`);
  }
  return value;
}

export function isRepeatableDefinition(definition) {
  const clauses = definition.acceptance?.repeat;
  if (!Array.isArray(clauses) || clauses.length !== 1) {
    throw new Error(`${definition.id} must declare one schema-bound repeat acceptance rule`);
  }
  if (clauses[0].startsWith('3x3 placement ')) return true;
  if (clauses[0].startsWith('Not a repeating surface;')) return false;
  throw new Error(`${definition.id} repeat applicability is not explicit in its definition`);
}

export function requiredBlueprintIdsForDefinition(definition) {
  const required = new Set();
  for (const biome of definition.usage.biomes) {
    if (BLUEPRINT_IDS.slice(0, 4).includes(biome)) required.add(biome);
    if (biome === 'all') for (const world of BLUEPRINT_IDS.slice(0, 4)) required.add(world);
  }
  if (definition.usage.scenes.includes('cutaway') || definition.usage.biomes.includes('interface')) {
    required.add('cutaway');
  }
  if ((definition.usage.scenes.includes('world') || definition.usage.scenes.includes('landmark'))
    && definition.palette.accents.includes('warm-window')) {
    required.add('night');
  }
  return required;
}

export function allowedBlueprintIdsForDefinition(definition) {
  const allowed = requiredBlueprintIdsForDefinition(definition);
  if (definition.usage.scenes.includes('world') || definition.usage.scenes.includes('landmark')) {
    allowed.add('night');
  }
  return allowed;
}

export function assertWaveAReviewChronology(selection, pendingByAsset, approvedAt) {
  const approvalTime = Date.parse(approvedAt);
  if (Number.isNaN(approvalTime)) throw new Error('Wave A review chronology requires a valid approval time');
  for (const blueprint of selection.sceneBlueprints) {
    const reviewedAt = Date.parse(blueprint.reviewedAt);
    if (reviewedAt > approvalTime) throw new Error('Scene blueprint review is future-dated');
    for (const included of blueprint.includedAssets) {
      const pending = pendingByAsset.get(included.assetId);
      if (!pending || reviewedAt < Date.parse(pending.createdAt)) {
        throw new Error(`Scene blueprint ${blueprint.id} was reviewed before included candidate bytes existed`);
      }
    }
  }
  for (const entry of selection.assets) {
    const pending = pendingByAsset.get(entry.assetId);
    const reviewedAt = Date.parse(entry.visualReview.reviewedAt);
    if (reviewedAt > approvalTime) throw new Error(`${entry.assetId} visual review is future-dated`);
    if (!pending || reviewedAt < Date.parse(pending.createdAt)) {
      throw new Error(`${entry.assetId} visual review predates the selected candidate bytes`);
    }
  }
}

export async function inspectStaticPngEvidenceBytes(bytes, label = 'Visual evidence') {
  let inspection;
  try {
    inspection = inspectPng(bytes);
  } catch (error) {
    throw new Error(`${label} evidence is not a valid static PNG`, { cause: error });
  }
  let decoded;
  try {
    decoded = await sharp(bytes, { animated: false, failOn: 'error' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new Error(`${label} evidence could not be fully decoded to RGBA`, { cause: error });
  }
  if (decoded.info.width !== inspection.width || decoded.info.height !== inspection.height
    || decoded.info.channels !== 4
    || decoded.data.length !== inspection.width * inspection.height * 4) {
    throw new Error(`${label} evidence decoded RGBA dimensions are inconsistent`);
  }
  return {
    ...inspection,
    decodedRgbaSha256: sha256(Buffer.concat([
      Buffer.from(`${inspection.width}x${inspection.height}:rgba8\0`),
      decoded.data
    ]))
  };
}

export function assertDistinctDecodedEvidenceRoles(records) {
  const decodedOwner = new Map();
  for (const { label, inspection } of records) {
    const prior = decodedOwner.get(inspection.decodedRgbaSha256);
    if (prior) {
      throw new Error(`${label} reuses decoded RGBA pixels across physical review roles (${prior})`);
    }
    decodedOwner.set(inspection.decodedRgbaSha256, label);
  }
  return decodedOwner.size;
}

async function inspectEvidence(root, record, label, { minimumWidth = 1, minimumHeight = 1 } = {}) {
  const bytes = await readStableBytes(root, record.path);
  if (sha256(bytes) !== record.sha256) throw new Error(`${label} evidence hash mismatch`);
  const inspection = await inspectStaticPngEvidenceBytes(bytes, label);
  if (inspection.width < minimumWidth || inspection.height < minimumHeight) {
    throw new Error(`${label} evidence is smaller than its required review scale`);
  }
  return inspection;
}

export function assertWaveAVisualEvidenceBindings(selection, definitions) {
  const blueprintIds = selection.sceneBlueprints.map(({ id }) => id);
  if (blueprintIds.some((id, index) => id !== BLUEPRINT_IDS[index])) {
    throw new Error('Wave A selection requires the exact ordered six scene blueprints');
  }
  const blueprintPaths = selection.sceneBlueprints.map(({ path: evidencePath }) => evidencePath);
  const blueprintHashes = selection.sceneBlueprints.map(({ sha256: hash }) => hash);
  if (new Set(blueprintPaths).size !== 6 || new Set(blueprintHashes).size !== 6) {
    throw new Error('Wave A requires six distinct scene blueprint files and image hashes');
  }
  const blueprintById = new Map();
  const selectionByAsset = new Map(selection.assets.map((entry) => [entry.assetId, entry]));
  const coveredAssets = new Set();
  const blueprintIdsByAsset = new Map();
  const physicalPathOwner = new Map();
  const physicalHashOwner = new Map();
  const claimPhysicalEvidence = (record, label) => {
    const priorPath = physicalPathOwner.get(record.path);
    const priorHash = physicalHashOwner.get(record.sha256);
    if (priorPath || priorHash) {
      throw new Error(`${label} reuses physical evidence across review roles (${priorPath ?? priorHash})`);
    }
    physicalPathOwner.set(record.path, label);
    physicalHashOwner.set(record.sha256, label);
  };
  for (const blueprint of selection.sceneBlueprints) {
    if (new Set(blueprint.includedAssets.map(({ assetId }) => assetId)).size !== blueprint.includedAssets.length) {
      throw new Error(`Scene blueprint ${blueprint.id} repeats an asset coverage record`);
    }
    for (const included of blueprint.includedAssets) {
      const selected = selectionByAsset.get(included.assetId);
      if (!selected) throw new Error(`Scene blueprint ${blueprint.id} includes an asset outside Wave A`);
      const selectedHashes = selected.artifacts.map(({ sha256: hash }) => hash);
      if (!isDeepStrictEqual(included.artifactSha256s, selectedHashes)) {
        throw new Error(`Scene blueprint ${blueprint.id} does not bind exact selected artifact hashes for ${included.assetId}`);
      }
      if (!selected.visualReview.ensemble.some(({ blueprintId }) => blueprintId === blueprint.id)) {
        throw new Error(`${included.assetId} blueprint coverage contradicts its ensemble review`);
      }
      coveredAssets.add(included.assetId);
      const ids = blueprintIdsByAsset.get(included.assetId) ?? new Set();
      ids.add(blueprint.id);
      blueprintIdsByAsset.set(included.assetId, ids);
    }
    claimPhysicalEvidence(blueprint, `scene blueprint ${blueprint.id}`);
    blueprintById.set(blueprint.id, blueprint);
  }
  if (coveredAssets.size !== REQUIRED_COUNTS.assets
    || selection.assets.some(({ assetId }) => !coveredAssets.has(assetId))) {
    throw new Error('Six scene blueprints must provide complete coverage of all 109 selected assets');
  }

  for (let index = 0; index < selection.assets.length; index += 1) {
    const entry = selection.assets[index];
    const definition = definitions[index];
    if (!definition || definition.id !== entry.assetId) {
      throw new Error('Wave A visual evidence must follow the exact canonical definition order');
    }
    const review = entry.visualReview;
    const artifactHashes = entry.artifacts.map(({ sha256: hash }) => hash);
    for (const evidence of [review.native, review.repeat, ...review.ensemble]) {
      if (!isDeepStrictEqual(evidence.artifactSha256s, artifactHashes)) {
        throw new Error(`${entry.assetId} visual evidence does not bind the exact selected artifact hash list`);
      }
    }
    claimPhysicalEvidence(review.native, `${entry.assetId} native`);
    const repeatable = isRepeatableDefinition(definition);
    if (repeatable && review.repeat.status !== 'pass') {
      throw new Error(`${entry.assetId} requires passing 3x3 repeat evidence`);
    }
    if (!repeatable && review.repeat.status !== 'not-applicable') {
      throw new Error(`${entry.assetId} repeat evidence must be definition-based not-applicable`);
    }
    if (review.repeat.status === 'pass') {
      claimPhysicalEvidence(review.repeat, `${entry.assetId} repeat`);
    }
    const ensembleIds = review.ensemble.map(({ blueprintId }) => blueprintId);
    if (new Set(ensembleIds).size !== ensembleIds.length) {
      throw new Error(`${entry.assetId} repeats an ensemble blueprint record`);
    }
    const includedIds = [...(blueprintIdsByAsset.get(entry.assetId) ?? new Set())];
    if (ensembleIds.length !== includedIds.length
      || ensembleIds.some((id) => !includedIds.includes(id))) {
      throw new Error(`${entry.assetId} ensemble records do not exactly match scene blueprint coverage`);
    }
    const requiredIds = requiredBlueprintIdsForDefinition(definition);
    if ([...requiredIds].some((id) => !ensembleIds.includes(id))) {
      throw new Error(`${entry.assetId} lacks a mandatory applicable-biome/cutaway/night scene blueprint`);
    }
    const allowedIds = allowedBlueprintIdsForDefinition(definition);
    for (const ensemble of review.ensemble) {
      const blueprint = blueprintById.get(ensemble.blueprintId);
      if (!blueprint || ensemble.path !== blueprint.path || ensemble.sha256 !== blueprint.sha256) {
        throw new Error(`${entry.assetId} ensemble evidence is not its reviewed scene blueprint`);
      }
      if (!allowedIds.has(ensemble.blueprintId)) {
        throw new Error(`${entry.assetId} is reviewed in a biome/scene forbidden by its current definition usage`);
      }
    }
  }
  return { blueprintById };
}

export async function verifyWaveASelectionEvidenceFiles(root, selection, definitions) {
  const { blueprintById } = assertWaveAVisualEvidenceBindings(selection, definitions);
  const physicalRoles = [];
  for (const blueprint of selection.sceneBlueprints) {
    const label = `Scene blueprint ${blueprint.id}`;
    const inspected = await inspectEvidence(root, blueprint, label, {
      minimumWidth: 1280,
      minimumHeight: 720
    });
    physicalRoles.push({ label, inspection: inspected });
  }
  for (let index = 0; index < selection.assets.length; index += 1) {
    const entry = selection.assets[index];
    const definition = definitions[index];
    const review = entry.visualReview;
    const nativeLabel = `${entry.assetId} native`;
    const native = await inspectEvidence(root, review.native, nativeLabel, {
      minimumWidth: definition.outputSize.width,
      minimumHeight: definition.outputSize.height
    });
    physicalRoles.push({ label: nativeLabel, inspection: native });
    if (review.repeat.status === 'pass') {
      const logical = definition.pixelArt.logicalSpriteSize ?? definition.outputSize;
      const repeatLabel = `${entry.assetId} repeat`;
      const repeat = await inspectEvidence(root, review.repeat, repeatLabel, {
        minimumWidth: logical.width * 3,
        minimumHeight: logical.height * 3
      });
      physicalRoles.push({ label: repeatLabel, inspection: repeat });
    }
  }
  return {
    blueprintById,
    physicalReviewRoleCount: assertDistinctDecodedEvidenceRoles(physicalRoles)
  };
}

async function verifyVisualEvidence(root, selection, definitions, pendingByAsset, approvedAt) {
  assertWaveAReviewChronology(selection, pendingByAsset, approvedAt);
  const { blueprintById } = await verifyWaveASelectionEvidenceFiles(root, selection, definitions);
  return new Map(selection.assets.map((entry) => {
    const blueprints = entry.visualReview.ensemble
      .map(({ blueprintId }) => blueprintById.get(blueprintId));
    return [entry.assetId, digest({ visualReview: entry.visualReview, sceneBlueprints: blueprints })];
  }));
}

export function assertUnambiguousGenerationLedger(ledger) {
  const generationIds = new Set();
  const metadataPaths = new Set();
  const outputOwner = new Map();
  for (const generation of ledger.results) {
    if (generationIds.has(generation.id)) throw new Error(`Generation ledger repeats id: ${generation.id}`);
    generationIds.add(generation.id);
    if (metadataPaths.has(generation.metadataPath)) {
      throw new Error(`Generation ledger reuses metadata path: ${generation.metadataPath}`);
    }
    metadataPaths.add(generation.metadataPath);
    const outputs = [
      ...(generation.outputPath ? [generation.outputPath] : []),
      ...(generation.outputArtifacts ?? []).map(({ path: outputPath }) => outputPath)
    ];
    for (const outputPath of new Set(outputs)) {
      const owner = outputOwner.get(outputPath);
      if (owner && owner !== generation.id) {
        throw new Error(`Generation ledger reuses output path across ${owner} and ${generation.id}: ${outputPath}`);
      }
      outputOwner.set(outputPath, generation.id);
    }
  }
}

function artifactFileName(assetId, role, artifactSha256) {
  return `${assetFileStem(assetId)}-${role}-${artifactSha256.slice(0, 16)}.png`;
}

function sumCellAudits(assets) {
  return assets.reduce((total, { cellAudit }) => ({
    declaredLogicalSlotCount: total.declaredLogicalSlotCount + cellAudit.declaredLogicalSlotCount,
    semanticCellCount: total.semanticCellCount + cellAudit.semanticCellCount,
    expectedNonemptySemanticCellCount: total.expectedNonemptySemanticCellCount + cellAudit.expectedNonemptySemanticCellCount,
    expectedTransparentSemanticCellCount: total.expectedTransparentSemanticCellCount + cellAudit.expectedTransparentSemanticCellCount,
    reservedTransparentCellCount: total.reservedTransparentCellCount + cellAudit.reservedTransparentCellCount
  }), {
    declaredLogicalSlotCount: 0,
    semanticCellCount: 0,
    expectedNonemptySemanticCellCount: 0,
    expectedTransparentSemanticCellCount: 0,
    reservedTransparentCellCount: 0
  });
}

async function buildWaveAPlan(note, {
  root,
  forgeRoot,
  approvedAt,
  bundleLedger
}) {
  const actualRoot = requireCanonicalRoot(root, forgeRoot);
  const trimmedNote = String(note ?? '').trim();
  if (!trimmedNote) throw new Error('Wave A bulk approval requires a non-empty human note');
  if (Number.isNaN(Date.parse(approvedAt))) throw new Error('Wave A approval clock returned an invalid timestamp');

  const [declaration, definitions, selection, migration, authorization, generationLedger] = await Promise.all([
    loadRequiredWaveDeclaration({ forgeRoot: actualRoot }),
    readWaveADefinitions({ root: actualRoot }),
    readCanonicalJson(actualRoot, SELECTION_RELATIVE, 'wave-a-selection-v3.schema.json'),
    readLegacyDisposition({ root: actualRoot }),
    readWaveAReferenceAuthorization({ root: actualRoot }),
    readLocalGenerationManifest(actualRoot)
  ]);
  const wave = declaration.waves[0];
  const definitionCells = deriveWaveACellContract(definitions);
  assertWaveACellCounts(definitionCells);
  if (definitions.length !== REQUIRED_COUNTS.assets || wave.requiredAssetCount !== REQUIRED_COUNTS.assets
    || wave.minimumOutputPngCount !== REQUIRED_COUNTS.artifacts) {
    throw new Error('Wave A canonical 109 ID / 128 PNG contract drifted');
  }
  const selectionCountFields = {
    declaredLogicalSlotCount: selection.declaredLogicalSlotCount,
    semanticCellCount: selection.semanticCellCount,
    expectedNonemptySemanticCellCount: selection.expectedNonemptySemanticCellCount,
    expectedTransparentSemanticCellCount: selection.expectedTransparentSemanticCellCount,
    reservedTransparentCellCount: selection.reservedTransparentCellCount
  };
  assertWaveACellCounts(selectionCountFields);
  if (selection.outputPngCount !== REQUIRED_COUNTS.artifacts) {
    throw new Error('Wave A selection PNG count drifted');
  }
  if (selection.selectionDigest !== digest(withoutField(selection, 'selectionDigest'))) {
    throw new Error('Wave A selection digest mismatch');
  }
  if (selection.legacyDispositionDigest !== migration.dispositionDigest) {
    throw new Error('Wave A selection is stale relative to the legacy disposition');
  }
  if (selection.assets.some((entry, index) => entry.assetId !== wave.assetIds[index]
    || definitions[index].id !== wave.assetIds[index])) {
    throw new Error('Wave A selection must use the exact canonical 109 asset order');
  }
  if (new Set(selection.assets.map(({ generationId }) => generationId)).size !== REQUIRED_COUNTS.assets) {
    throw new Error('Wave A selection reuses a generation id');
  }
  assertUnambiguousGenerationLedger(generationLedger);
  const ledgerInspection = assertBundleLedger(bundleLedger);
  if (ledgerInspection.waveApprovalById.has('A')) {
    throw new Error('Wave A is already bulk-approved');
  }
  if (wave.assetIds.some((assetId) => ledgerInspection.activeByAsset.has(assetId))) {
    throw new Error('Wave A bulk approval requires no pre-existing individual active bundle approvals');
  }

  const generationById = new Map(generationLedger.results.map((generation) => [generation.id, generation]));
  const pendingByAsset = new Map();
  const verifiedAssets = [];
  const artifactHashes = new Set();
  const pendingPaths = new Set();
  let artifactCount = 0;
  for (let index = 0; index < selection.assets.length; index += 1) {
    const entry = selection.assets[index];
    const definition = definitions[index];
    const pending = generationById.get(entry.generationId);
    if (!pending || pending.status !== 'pending' || pending.assetId !== entry.assetId) {
      throw new Error(`${entry.assetId} does not select one current pending generation`);
    }
    if (Date.parse(pending.createdAt) > Date.parse(approvedAt)) {
      throw new Error(`${entry.assetId} candidate is future-dated relative to approval`);
    }
    const pendingDigest = digest(pending);
    if (entry.pendingGenerationRecordDigest !== pendingDigest
      || entry.definitionSha256 !== digest(definition)) {
      throw new Error(`${entry.assetId} selection is stale relative to its generation or definition`);
    }
    const verified = await verifyPendingGenerationForWaveApproval({
      assetId: entry.assetId,
      generationId: entry.generationId
    }, { root: actualRoot, forgeRoot: actualRoot });
    if (entry.artifacts.length !== verified.artifacts.length
      || entry.artifacts.some((artifact, artifactIndex) => {
        const current = verified.artifacts[artifactIndex];
        return artifact.role !== current.role || artifact.pendingPath !== current.pendingPath
          || artifact.sha256 !== current.sha256;
      })) {
      throw new Error(`${entry.assetId} selected artifact bundle is stale or incomplete`);
    }
    for (const artifact of verified.artifacts) {
      artifactCount += 1;
      if (artifactHashes.has(artifact.sha256)) throw new Error('Wave A requires 128 distinct PNG bytes');
      if (pendingPaths.has(artifact.pendingPath)) throw new Error('Wave A selected artifacts reuse a pending path');
      artifactHashes.add(artifact.sha256);
      pendingPaths.add(artifact.pendingPath);
    }
    const cellAudit = await auditWaveAAssetCells(actualRoot, definition, verified.artifacts);
    verifiedAssets.push({ entry, definition, pending, pendingDigest, verified, cellAudit });
    pendingByAsset.set(entry.assetId, pending);
  }
  if (artifactCount !== REQUIRED_COUNTS.artifacts || artifactHashes.size !== REQUIRED_COUNTS.artifacts) {
    throw new Error('Wave A approval requires exactly 128 distinct PNG artifacts');
  }
  const auditedCounts = sumCellAudits(verifiedAssets);
  assertWaveACellCounts(auditedCounts);
  const visualEvidenceByAsset = await verifyVisualEvidence(
    actualRoot, selection, definitions, pendingByAsset, approvedAt
  );

  const planAssets = verifiedAssets.map(({ entry, definition, pending, pendingDigest, cellAudit }) => ({
    assetId: entry.assetId,
    pendingGenerationId: pending.id,
    pendingGenerationRecordDigest: pendingDigest,
    definitionSha256: digest(definition),
    visualEvidenceDigest: visualEvidenceByAsset.get(entry.assetId),
    sourceArtifacts: entry.artifacts.map(({ role, pendingPath, sha256: artifactSha256 }) => ({
      role, pendingPath, sha256: artifactSha256
    })),
    cellAudit
  }));
  const bundleLedgerBefore = bundleLedgerDigest(bundleLedger);
  const referenceAuthorizationSha256 = digest(authorization);
  const planCore = {
    schemaVersion: 3,
    contract: 'fable5-wave-a-approval-plan-v3',
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    approvedAt,
    note: trimmedNote,
    selectionDigest: selection.selectionDigest,
    legacyDispositionDigest: migration.dispositionDigest,
    referenceAuthorizationSha256,
    generationLedgerDigest: digest(generationLedger),
    bundleLedgerBefore,
    requiredAssetCount: REQUIRED_COUNTS.assets,
    outputPngCount: REQUIRED_COUNTS.artifacts,
    ...auditedCounts,
    assets: planAssets
  };
  const planDigest = digest(planCore);
  const stagingDirectory = `generated/v3/wave-staging/${planDigest}`;
  const bundleDirectory = `generated/v3/wave-bundles/${planDigest}`;
  const bundleApprovals = [];
  const approvalAssets = [];
  const materializations = [];
  const artifactNames = new Set();
  for (const asset of planAssets) {
    const definition = definitions.find(({ id }) => id === asset.assetId);
    const finalArtifacts = asset.sourceArtifacts.map((source) => {
      const relativeName = artifactFileName(asset.assetId, source.role, source.sha256);
      if (artifactNames.has(relativeName)) throw new Error(`Wave A artifact name collision: ${relativeName}`);
      artifactNames.add(relativeName);
      return {
        role: source.role,
        generationId: asset.pendingGenerationId,
        approvedPath: `${bundleDirectory}/${relativeName}`,
        sha256: source.sha256,
        pendingPath: source.pendingPath,
        relativeName
      };
    });
    const bundleApproval = prepareWaveBundleApproval({
      assetId: asset.assetId,
      category: definition.category,
      definitionSha256: asset.definitionSha256,
      generationRecordDigest: asset.pendingGenerationRecordDigest,
      artifacts: finalArtifacts.map(({ role, generationId, approvedPath, sha256: artifactSha256 }) => ({
        role, generationId, approvedPath, sha256: artifactSha256
      })),
      reviewer: 'human',
      note: trimmedNote,
      approvedAt
    }, { bundleDirectory });
    bundleApprovals.push(bundleApproval);
    approvalAssets.push({
      assetId: asset.assetId,
      pendingGenerationId: asset.pendingGenerationId,
      pendingGenerationRecordDigest: asset.pendingGenerationRecordDigest,
      definitionSha256: asset.definitionSha256,
      bundleDigest: bundleApproval.bundleDigest,
      visualEvidenceDigest: asset.visualEvidenceDigest,
      artifacts: finalArtifacts.map(({ role, approvedPath, sha256: artifactSha256 }) => ({
        role, approvedPath, sha256: artifactSha256
      })),
      cellAudit: asset.cellAudit
    });
    materializations.push(...finalArtifacts.map(({ pendingPath, approvedPath, relativeName, sha256: artifactSha256 }) => ({
      pendingPath, approvedPath, relativeName, sha256: artifactSha256
    })));
  }
  const artifactSetDigest = artifactSetDigestFor(approvalAssets);
  const evidenceCoverageDigest = evidenceCoverageDigestFor(approvalAssets);
  const cellAuditDigest = cellAuditSetDigestFor(approvalAssets);
  const approvalWithoutDigest = {
    schemaVersion: 3,
    contract: 'fable5-wave-approval-v3',
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    status: 'approved',
    reviewer: 'human',
    approvedAt,
    note: trimmedNote,
    planDigest,
    selectionDigest: selection.selectionDigest,
    legacyDispositionDigest: migration.dispositionDigest,
    referenceAuthorizationSha256,
    evidenceCoverageDigest,
    cellAuditDigest,
    artifactSetDigest,
    requiredAssetCount: REQUIRED_COUNTS.assets,
    outputPngCount: REQUIRED_COUNTS.artifacts,
    ...auditedCounts,
    bundleLedgerDigestBefore: bundleLedgerBefore,
    bundleDirectory,
    assets: approvalAssets
  };
  const waveApproval = {
    ...approvalWithoutDigest,
    approvalDigest: waveApprovalDigestFor(approvalWithoutDigest)
  };
  const approvalValidation = validateWith('wave-a-approval-v3.schema.json', waveApproval);
  if (!approvalValidation.ok) {
    throw new Error(`Invalid Wave A approval record: ${JSON.stringify(approvalValidation.errors)}`);
  }
  const nextBundleLedger = appendWaveApproval(bundleLedger, bundleApprovals, waveApproval);
  const bundleLedgerAfter = bundleLedgerDigest(nextBundleLedger);
  const sortedMaterializations = materializations
    .sort((left, right) => left.relativeName.localeCompare(right.relativeName));
  const journal = {
    schemaVersion: 3,
    contract: 'fable5-wave-approval-journal-v3',
    status: 'prepared',
    approvedAt,
    note: trimmedNote,
    planDigest,
    selectionDigest: selection.selectionDigest,
    bundleLedgerBefore,
    bundleLedgerAfter,
    waveApprovalDigest: waveApproval.approvalDigest,
    artifactSetDigest,
    stagingDirectory,
    bundleDirectory,
    artifacts: sortedMaterializations.map(({ relativeName, sha256: artifactSha256 }) => ({
      relativeName, sha256: artifactSha256
    }))
  };
  const journalValidation = validateWith('wave-a-approval-journal-v3.schema.json', journal);
  if (!journalValidation.ok) {
    throw new Error(`Invalid Wave A approval journal: ${JSON.stringify(journalValidation.errors)}`);
  }
  return {
    preview: {
      ...planCore,
      status: 'ready-for-human-confirmation',
      planDigest,
      evidenceCoverageDigest,
      cellAuditDigest,
      artifactSetDigest,
      confirmationPhrase: `APPROVE FABLE5 WAVE A ${planDigest}`
    },
    state: {
      nextBundleLedger,
      waveApproval,
      journal,
      materializations: sortedMaterializations
    }
  };
}

async function journalForLedger(root, ledger) {
  const journal = await readCanonicalJson(
    root, JOURNAL_RELATIVE, 'wave-a-approval-journal-v3.schema.json', { allowMissing: true }
  );
  if (!journal) return null;
  const currentDigest = bundleLedgerDigest(ledger);
  const inspection = assertBundleLedger(ledger);
  const committed = inspection.waveApprovalById.get('A');
  if (journal.status === 'prepared' && currentDigest === journal.bundleLedgerAfter
    && committed?.approvalDigest === journal.waveApprovalDigest) {
    const updated = { ...journal, status: 'committed' };
    const live = await readCanonicalJson(root, JOURNAL_RELATIVE, 'wave-a-approval-journal-v3.schema.json');
    if (!isDeepStrictEqual(live, journal)) {
      throw new Error('Prepared Wave A journal changed immediately before commit recovery');
    }
    await atomicReplaceJson(root, path.join(root, JOURNAL_RELATIVE), updated);
    await syncDirectory(path.dirname(path.join(root, JOURNAL_RELATIVE)));
    const persisted = await readCanonicalJson(root, JOURNAL_RELATIVE, 'wave-a-approval-journal-v3.schema.json');
    if (!isDeepStrictEqual(persisted, updated)) throw new Error('Committed Wave A journal persistence mismatch');
    return updated;
  }
  if (journal.status === 'committed') {
    if (currentDigest !== journal.bundleLedgerAfter
      || committed?.approvalDigest !== journal.waveApprovalDigest) {
      throw new Error('Committed Wave A journal contradicts the authoritative bundle ledger');
    }
    return journal;
  }
  if (currentDigest !== journal.bundleLedgerBefore || committed) {
    throw new Error('Prepared Wave A journal cannot be safely resumed from the current bundle ledger');
  }
  return journal;
}

function alreadyApprovedPreview(record) {
  return {
    status: 'already-approved',
    planDigest: record.planDigest,
    approvalDigest: record.approvalDigest,
    confirmationPhrase: null
  };
}

async function withWaveReadLocks(root, operation) {
  const forgePaths = pathsFor(root);
  return withFileLock(root, forgePaths.requiredPromotionLock, () =>
    withFileLock(root, forgePaths.lifecycleLock, () =>
      withFileLock(root, path.join(root, WAVE_LOCK_RELATIVE), () =>
        withFileLock(root, forgePaths.localGenerationLock, () =>
          withBundleLedgerSnapshot(operation, { root })))))
}

async function previewWaveAApprovalAtRoot({ note }, {
  root,
  forgeRoot
}) {
  const actualRoot = requireCanonicalRoot(root, forgeRoot);
  return withWaveReadLocks(actualRoot, async (ledger) => {
    const inspection = assertBundleLedger(ledger);
    const committed = inspection.waveApprovalById.get('A');
    const journal = await journalForLedger(actualRoot, ledger);
    if (committed) return alreadyApprovedPreview(committed);
    const approvedAt = journal?.approvedAt ?? new Date().toISOString();
    const effectiveNote = journal?.note ?? note;
    const built = await buildWaveAPlan(effectiveNote, {
      root: actualRoot,
      forgeRoot: actualRoot,
      approvedAt,
      bundleLedger: ledger
    });
    if (journal && (journal.planDigest !== built.preview.planDigest
      || journal.selectionDigest !== built.preview.selectionDigest
      || journal.bundleLedgerAfter !== bundleLedgerDigest(built.state.nextBundleLedger)
      || journal.waveApprovalDigest !== built.state.waveApproval.approvalDigest)) {
      throw new Error('Prepared Wave A journal is stale relative to current candidates or evidence');
    }
    ISSUED_PREVIEWS.set(built.preview, {
      root: actualRoot,
      previewDigest: digest(built.preview)
    });
    return built.preview;
  });
}

export async function previewWaveAApproval(input) {
  if (arguments.length !== 1 || !input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => key !== 'note')) {
    throw new Error('Wave A public preview accepts only a note; roots, clocks, and dependencies are fixed');
  }
  return previewWaveAApprovalAtRoot(input, { root: FORGE_ROOT, forgeRoot: FORGE_ROOT });
}

export function formatWaveAApprovalPreview(preview) {
  if (preview.status === 'already-approved') {
    return `Fable5 Wave A is already bulk-approved: ${preview.approvalDigest}\n`;
  }
  return [
    'Fable5 Wave A single bulk approval (human-only)',
    `Assets: ${preview.requiredAssetCount}`,
    `Distinct PNG artifacts: ${preview.outputPngCount}`,
    `Declared logical slots: ${preview.declaredLogicalSlotCount}`,
    `Semantic cells: ${preview.semanticCellCount}`,
    `  visible required: ${preview.expectedNonemptySemanticCellCount}`,
    `  transparent no-edge transitions: ${preview.expectedTransparentSemanticCellCount}`,
    `Reserved transparent cells: ${preview.reservedTransparentCellCount}`,
    `Selection: ${preview.selectionDigest}`,
    `Legacy migration: ${preview.legacyDispositionDigest}`,
    `Evidence coverage: ${preview.evidenceCoverageDigest}`,
    `Cell audit: ${preview.cellAuditDigest}`,
    `Artifact set: ${preview.artifactSetDigest}`,
    `Plan: ${preview.planDigest}`,
    `Note: ${preview.note}`,
    `Type exactly: ${preview.confirmationPhrase}`,
    ''
  ].join('\n');
}

async function ensureRealDirectory(root, directory) {
  const actualRoot = path.resolve(root);
  const target = path.resolve(directory);
  if (!containedBy(actualRoot, target)) throw new Error('Wave A directory escapes Asset Forge root');
  let current = actualRoot;
  for (const segment of path.relative(actualRoot, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Wave A directory path is unsafe');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 }).catch((mkdirError) => {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      });
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) throw new Error('Unsafe Wave A directory appeared');
    }
  }
}

async function pathType(root, relativePath) {
  const absolute = path.join(root, ...relativePath.split('/'));
  await assertNoSymlinkPath(root, absolute, { allowMissingLeaf: true });
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('Wave A transaction path must not be a symlink');
    return info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other';
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function verifyMaterializedDirectory(root, relativeDirectory, materializations) {
  if (await pathType(root, relativeDirectory) !== 'directory') {
    throw new Error(`Wave A materialized directory is missing or unsafe: ${relativeDirectory}`);
  }
  const absolute = path.join(root, ...relativeDirectory.split('/'));
  const entries = await readdir(absolute, { withFileTypes: true });
  const expected = materializations.map(({ relativeName }) => relativeName).sort();
  const actual = entries.map(({ name }) => name).sort();
  if (entries.some((entry) => !entry.isFile()) || !isDeepStrictEqual(actual, expected)) {
    throw new Error(`Wave A materialized directory does not contain the exact 128 planned files: ${relativeDirectory}`);
  }
  for (const materialization of materializations) {
    const bytes = await readStableBytes(root, `${relativeDirectory}/${materialization.relativeName}`);
    if (sha256(bytes) !== materialization.sha256) {
      throw new Error(`Wave A materialized artifact hash mismatch: ${materialization.relativeName}`);
    }
  }
}

export async function verifyWaveBundleMaterialization({ planDigest, artifacts }, {
  root = FORGE_ROOT
} = {}) {
  if (!/^[a-f0-9]{64}$/.test(planDigest ?? '')
    || !Array.isArray(artifacts) || artifacts.length !== REQUIRED_COUNTS.artifacts
    || new Set(artifacts.map(({ relativeName }) => relativeName)).size !== REQUIRED_COUNTS.artifacts
    || new Set(artifacts.map(({ sha256: artifactSha256 }) => artifactSha256)).size !== REQUIRED_COUNTS.artifacts
    || artifacts.some(({ relativeName, sha256: artifactSha256 }) => (
      !/^[a-z0-9][a-z0-9_.-]*\.png$/.test(relativeName ?? '')
      || !/^[a-f0-9]{64}$/.test(artifactSha256 ?? '')
    ))) {
    throw new Error('Wave A bundle verification requires an exact distinct 128-artifact plan');
  }
  const relativeDirectory = `generated/v3/wave-bundles/${planDigest}`;
  await verifyMaterializedDirectory(path.resolve(root), relativeDirectory, artifacts);
  return { ok: true, planDigest, artifactCount: REQUIRED_COUNTS.artifacts };
}

async function prepareStaging(root, built, existingJournal) {
  const { journal, materializations } = built.state;
  const stageType = await pathType(root, journal.stagingDirectory);
  if (stageType !== 'missing') {
    if (stageType !== 'directory') throw new Error('Wave A staging path is unsafe');
    try {
      await verifyMaterializedDirectory(root, journal.stagingDirectory, materializations);
      return;
    } catch (error) {
      if (existingJournal) throw error;
      await rm(path.join(root, ...journal.stagingDirectory.split('/')), { recursive: true, force: false });
    }
  }
  await ensureRealDirectory(root, path.join(root, ...journal.stagingDirectory.split('/')));
  for (const materialization of materializations) {
    const source = await readStableBytes(root, materialization.pendingPath);
    if (sha256(source) !== materialization.sha256) {
      throw new Error(`Pending artifact changed after Wave A preview: ${materialization.pendingPath}`);
    }
    await atomicWriteFile(
      root,
      path.join(root, ...journal.stagingDirectory.split('/'), materialization.relativeName),
      source
    );
  }
  await syncDirectory(path.join(root, ...journal.stagingDirectory.split('/')));
  await verifyMaterializedDirectory(root, journal.stagingDirectory, materializations);
}

async function materializeBundleAfterJournal(root, built) {
  const { journal, materializations } = built.state;
  const finalType = await pathType(root, journal.bundleDirectory);
  if (finalType === 'directory') {
    await verifyMaterializedDirectory(root, journal.bundleDirectory, materializations);
    return;
  }
  if (finalType !== 'missing') throw new Error('Wave A bundle destination is unsafe');
  await ensureRealDirectory(root, path.dirname(path.join(root, ...journal.bundleDirectory.split('/'))));
  const stageAbsolute = path.join(root, ...journal.stagingDirectory.split('/'));
  const finalAbsolute = path.join(root, ...journal.bundleDirectory.split('/'));
  const stageInfo = await lstat(stageAbsolute);
  if (stageInfo.isSymbolicLink() || !stageInfo.isDirectory()) throw new Error('Wave A staging directory is unsafe');
  await rename(stageAbsolute, finalAbsolute);
  await syncDirectory(path.dirname(stageAbsolute));
  if (path.dirname(stageAbsolute) !== path.dirname(finalAbsolute)) {
    await syncDirectory(path.dirname(finalAbsolute));
  }
  await verifyMaterializedDirectory(root, journal.bundleDirectory, materializations);
}

async function prepareJournalAndBundle(root, built, existingJournal) {
  const planned = built.state.journal;
  if (existingJournal) {
    if (!isDeepStrictEqual(existingJournal, planned)) {
      throw new Error('Prepared Wave A journal changed after human preview');
    }
    const finalType = await pathType(root, planned.bundleDirectory);
    if (finalType === 'directory') {
      await verifyMaterializedDirectory(root, planned.bundleDirectory, built.state.materializations);
      return;
    }
    if (finalType !== 'missing') throw new Error('Prepared Wave A bundle destination is unsafe');
    await verifyMaterializedDirectory(root, planned.stagingDirectory, built.state.materializations);
  } else {
    await prepareStaging(root, built, null);
    await atomicWriteJson(root, path.join(root, JOURNAL_RELATIVE), planned);
    await syncDirectory(path.dirname(path.join(root, JOURNAL_RELATIVE)));
  }
  await materializeBundleAfterJournal(root, built);
}

export async function executeWaveAApproval(preview, answer) {
  if (arguments.length !== 2) {
    throw new Error('Wave A public execution does not accept roots, clocks, TTY predicates, or dependencies');
  }
  assertCanonicalInteractiveTerminal('Wave A bulk approval');
  if (preview?.status !== 'ready-for-human-confirmation'
    || answer !== preview.confirmationPhrase) {
    throw new Error('Wave A bulk approval exact confirmation did not match');
  }
  const actualRoot = requireCanonicalRoot(FORGE_ROOT, FORGE_ROOT);
  const issued = ISSUED_PREVIEWS.get(preview);
  if (!issued || issued.root !== actualRoot || issued.previewDigest !== digest(preview)) {
    throw new Error('Wave A execution requires the exact in-process preview issued by the canonical operator');
  }
  ISSUED_PREVIEWS.delete(preview);
  const forgePaths = pathsFor(actualRoot);
  const committed = await withFileLock(actualRoot, forgePaths.requiredPromotionLock, () =>
    withFileLock(actualRoot, forgePaths.lifecycleLock, () =>
      withFileLock(actualRoot, path.join(actualRoot, WAVE_LOCK_RELATIVE), () =>
        withFileLock(actualRoot, forgePaths.localGenerationLock, () =>
          transactBundleLedger(async (currentLedger) => {
            const inspection = assertBundleLedger(currentLedger);
            if (inspection.waveApprovalById.has('A')) throw new Error('Wave A is already bulk-approved');
            const existingJournal = await journalForLedger(actualRoot, currentLedger);
            const built = await buildWaveAPlan(preview.note, {
              root: actualRoot,
              forgeRoot: actualRoot,
              approvedAt: preview.approvedAt,
              bundleLedger: currentLedger
            });
            if (built.preview.planDigest !== preview.planDigest
              || built.preview.confirmationPhrase !== preview.confirmationPhrase) {
              throw new Error('Wave A selection or provenance changed after human preview');
            }
            await prepareJournalAndBundle(actualRoot, built, existingJournal);
            return {
              ledger: built.state.nextBundleLedger,
              value: {
                approval: built.state.waveApproval,
                journal: built.state.journal
              }
            };
          }, {
            root: actualRoot,
            expectedLedgerDigest: preview.bundleLedgerBefore
          })))))
  const committedJournal = { ...committed.value.journal, status: 'committed' };
  const preparedJournal = await readCanonicalJson(
    actualRoot, JOURNAL_RELATIVE, 'wave-a-approval-journal-v3.schema.json'
  );
  if (!isDeepStrictEqual(preparedJournal, committed.value.journal)) {
    throw new Error('Prepared Wave A journal changed immediately before final commit');
  }
  await atomicReplaceJson(actualRoot, path.join(actualRoot, JOURNAL_RELATIVE), committedJournal);
  await syncDirectory(path.dirname(path.join(actualRoot, JOURNAL_RELATIVE)));
  const persistedJournal = await readCanonicalJson(
    actualRoot, JOURNAL_RELATIVE, 'wave-a-approval-journal-v3.schema.json'
  );
  if (!isDeepStrictEqual(persistedJournal, committedJournal)) {
    throw new Error('Committed Wave A journal did not persist exactly');
  }
  await verifyMaterializedDirectory(
    actualRoot,
    committedJournal.bundleDirectory,
    committedJournal.artifacts
  );
  return {
    status: 'wave-approved',
    planDigest: preview.planDigest,
    approvalDigest: committed.value.approval.approvalDigest,
    ledgerDigest: committed.ledgerDigest,
    assets: REQUIRED_COUNTS.assets,
    artifacts: REQUIRED_COUNTS.artifacts,
    declaredLogicalSlots: REQUIRED_COUNTS.declared,
    semanticCells: REQUIRED_COUNTS.semantic,
    visibleSemanticCells: REQUIRED_COUNTS.semanticNonempty,
    transparentSemanticCells: REQUIRED_COUNTS.semanticTransparent,
    reservedTransparentCells: REQUIRED_COUNTS.reservedTransparent
  };
}

export async function readCommittedWaveAApproval({ root = FORGE_ROOT } = {}) {
  const actualRoot = path.resolve(root);
  const bundlePaths = bundleLedgerPaths(actualRoot);
  return withFileLock(actualRoot, bundlePaths.lock, async () => {
    const { readBundleLedger } = await import('./persistence.mjs');
    const ledger = await readBundleLedger({ root: actualRoot });
    const inspection = assertBundleLedger(ledger);
    const approval = inspection.waveApprovalById.get('A');
    if (!approval) throw new Error('V3 export requires the committed single Wave A bulk approval');
    const [declaration, selection, migration, authorization, definitions] = await Promise.all([
      loadRequiredWaveDeclaration({ forgeRoot: actualRoot }),
      readCanonicalJson(actualRoot, SELECTION_RELATIVE, 'wave-a-selection-v3.schema.json'),
      readLegacyDisposition({ root: actualRoot }),
      readWaveAReferenceAuthorization({ root: actualRoot }),
      readWaveADefinitions({ root: actualRoot })
    ]);
    const wave = declaration.waves[0];
    if (approval.assets.some((asset, index) => asset.assetId !== wave.assetIds[index]
      || asset.definitionSha256 !== digest(definitions[index]))) {
      throw new Error('Committed Wave A approval is stale relative to required IDs or definitions');
    }
    if (approval.selectionDigest !== selection.selectionDigest
      || approval.legacyDispositionDigest !== migration.dispositionDigest
      || approval.referenceAuthorizationSha256 !== digest(authorization)) {
      throw new Error('Committed Wave A approval is stale relative to selection, migration, or reference authorization');
    }
    return { approval, ledger, ledgerDigest: bundleLedgerDigest(ledger), migration };
  });
}
