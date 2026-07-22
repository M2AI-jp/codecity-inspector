import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { FORGE_ROOT, IMAGE_LIMITS, pathsFor } from '../config.mjs';
import { atomicReplaceJson, atomicWriteFile, readJson, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { assertExistingFileWithin } from '../paths.mjs';
import { inspectPng } from '../png-core.mjs';
import { validateWith } from '../schemas.mjs';
import { readWaveADefinitions } from '../v2/definition-builder.mjs';
import { readWaveAReferenceAuthorization } from '../v2/reference-authorization.mjs';
import { assertBundleLedger } from './bundle-ledger.mjs';
import { auditWaveAAssetCells } from './cell-audit.mjs';
import { readLegacyDisposition } from './migration.mjs';
import {
  assertActiveCanonicalBundleLedgerSnapshot,
  bundleLedgerDigest,
  readBundleLedger,
  withBundleLedgerSnapshot
} from './persistence.mjs';
import { verifyBundleApprovalForExport } from './provenance.mjs';
import { verifyWaveASelectionEvidenceFiles } from './wave-operator.mjs';

const WAVE_DECLARATION_PATH = 'data/v2/waves.json';
const PUBLIC_PREFIX = '/assets/forge/v3';
const WAVE_A_SELECTION_PATH = 'data/v3/wave-a-selection.json';

async function readCanonicalWaveASelection(forgeRoot) {
  const source = await assertExistingFileWithin(forgeRoot, WAVE_A_SELECTION_PATH);
  const bytes = await readFile(source);
  let selection;
  try {
    selection = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Malformed Wave A selection JSON', { cause: error });
  }
  const validation = validateWith('wave-a-selection-v3.schema.json', selection);
  if (!validation.ok) throw new Error(`Invalid Wave A selection: ${JSON.stringify(validation.errors)}`);
  if (!bytes.equals(Buffer.from(canonicalJson(selection)))) {
    throw new Error('Wave A selection must use exact canonical JSON encoding');
  }
  const unsigned = structuredClone(selection);
  delete unsigned.selectionDigest;
  if (selection.selectionDigest !== sha256(canonicalJson(unsigned))) {
    throw new Error('Wave A selection digest mismatch');
  }
  return selection;
}

async function verifyCommittedWaveAApproval({ forgeRoot, ledger, declaration, definitions }) {
  const inspection = assertBundleLedger(ledger);
  const approval = inspection.waveApprovalById.get('A');
  if (!approval) {
    throw new Error('V3 export requires the committed single Wave A bulk approval');
  }
  const wave = declaration.waves[0];
  if (approval.assets.some((asset, index) => asset.assetId !== wave.assetIds[index]
    || asset.definitionSha256 !== sha256(canonicalJson(definitions[index]))
    || inspection.activeByAsset.get(asset.assetId)?.bundleDigest !== asset.bundleDigest)) {
    throw new Error('Committed Wave A bulk approval is stale relative to definitions or active bundles');
  }
  const [selection, migration, authorization] = await Promise.all([
    readCanonicalWaveASelection(forgeRoot),
    readLegacyDisposition({ root: forgeRoot }),
    readWaveAReferenceAuthorization({ root: forgeRoot })
  ]);
  if (approval.selectionDigest !== selection.selectionDigest
    || approval.legacyDispositionDigest !== migration.dispositionDigest
    || approval.referenceAuthorizationSha256 !== sha256(canonicalJson(authorization))) {
    throw new Error('Committed Wave A bulk approval is stale relative to selection, migration, or reference authorization');
  }
  await verifyWaveASelectionEvidenceFiles(forgeRoot, selection, definitions);
  return { approval, migration, selection };
}

export async function loadRequiredWaveDeclaration({ forgeRoot = FORGE_ROOT } = {}) {
  const wavePath = await assertExistingFileWithin(forgeRoot, WAVE_DECLARATION_PATH);
  const declaration = await readJson(wavePath);
  const validation = validateWith('required-waves.schema.json', declaration);
  if (!validation.ok) {
    throw new Error(`Invalid Fable5 required wave declaration: ${JSON.stringify(validation.errors)}`);
  }
  if (declaration.waves.length !== 2
    || declaration.waves[0]?.id !== 'A'
    || declaration.waves[1]?.id !== 'B') {
    throw new Error('Fable5 required wave declaration must contain exactly ordered waves A and B');
  }
  for (const wave of declaration.waves) {
    const actualAssetIdsSha256 = sha256(canonicalJson(wave.assetIds));
    if (actualAssetIdsSha256 !== wave.assetIdsSha256) {
      throw new Error(`Fable5 required wave ${wave.id} assetIds digest mismatch`);
    }
    if (wave.assetIds.length !== wave.requiredAssetCount) {
      throw new Error(`Fable5 required wave ${wave.id} asset count mismatch`);
    }
  }
  const allAssetIds = declaration.waves.flatMap(({ assetIds }) => assetIds);
  if (new Set(allAssetIds).size !== allAssetIds.length) {
    throw new Error('Fable5 required wave declaration reuses an asset id across waves');
  }
  return declaration;
}

function selectedWaves(declaration, waveIds) {
  if (!Array.isArray(waveIds) || waveIds.length !== 1 || waveIds[0] !== 'A') {
    throw new Error('V3 export currently supports only the implemented and approved Wave A contract');
  }
  return [declaration.waves[0]];
}

function publicArtifactPath(hash) {
  return `${PUBLIC_PREFIX}/blobs/${hash}.png`;
}

function relativePublicPath(publicPath) {
  return publicPath.slice(1).split('/').join(path.sep);
}

async function readStableApprovedPng(forgeRoot, relativePath) {
  const source = await assertExistingFileWithin(forgeRoot, relativePath);
  const before = await lstat(source, { bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(IMAGE_LIMITS.maxInputBytes)) {
    throw new Error(`Approved v3 artifact exceeds file limits: ${relativePath}`);
  }
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) {
      throw new Error(`Approved v3 artifact changed while opening: ${relativePath}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
      || BigInt(bytes.length) !== opened.size) {
      throw new Error(`Approved v3 artifact changed while reading: ${relativePath}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function inspectArtifact(forgeRoot, artifact) {
  const bytes = await readStableApprovedPng(forgeRoot, artifact.approvedPath);
  const actual = sha256(bytes);
  if (actual !== artifact.sha256) {
    throw new Error(`Approved v3 artifact hash mismatch: ${artifact.approvedPath}`);
  }
  let inspection;
  try {
    inspection = inspectPng(bytes);
  } catch (error) {
    throw new Error(`Approved v3 artifact is not a valid static PNG: ${artifact.approvedPath}`, { cause: error });
  }
  return {
    role: artifact.role,
    sha256: artifact.sha256,
    publicPath: publicArtifactPath(artifact.sha256),
    sourcePath: artifact.approvedPath,
    inspection
  };
}

export async function inspectV3Completeness({
  forgeRoot = FORGE_ROOT,
  ledger,
  waveIds
}) {
  const declaration = await loadRequiredWaveDeclaration({ forgeRoot });
  const waves = selectedWaves(declaration, waveIds);
  const ledgerInspection = assertBundleLedger(ledger);
  if (ledger.requiredSetId !== declaration.requiredSetId) {
    throw new Error('Bundle ledger required set does not match the wave declaration');
  }
  const requiredAssetIds = waves.flatMap(({ assetIds }) => assetIds);
  const missingAssetIds = requiredAssetIds.filter((assetId) => !ledgerInspection.activeByAsset.has(assetId));
  const expectedPngCount = waves.reduce((total, wave) => total + wave.minimumOutputPngCount, 0);
  const activeArtifactCount = requiredAssetIds.reduce((total, assetId) => (
    total + (ledgerInspection.activeByAsset.get(assetId)?.artifacts.length ?? 0)
  ), 0);
  return {
    complete: missingAssetIds.length === 0 && activeArtifactCount >= expectedPngCount,
    declaration,
    waves,
    requiredAssetIds,
    missingAssetIds,
    expectedPngCount,
    activeArtifactCount,
    activeByAsset: ledgerInspection.activeByAsset
  };
}

export async function buildV3ExportPlan({
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  ledger,
  waveIds
}) {
  const actualRoot = path.resolve(root);
  const actualForgeRoot = path.resolve(forgeRoot);
  if (actualRoot !== actualForgeRoot) {
    throw new Error('V3 export requires one canonical Asset Forge root');
  }
  const completeness = await inspectV3Completeness({ forgeRoot: actualForgeRoot, ledger, waveIds });
  if (!completeness.complete) {
    const missing = completeness.missingAssetIds.length
      ? completeness.missingAssetIds.join(', ')
      : `expected at least ${completeness.expectedPngCount} PNG artifacts, found ${completeness.activeArtifactCount}`;
    throw new Error(`V3 export requires a complete declared required set: ${missing}`);
  }

  const currentDefinitions = await readWaveADefinitions({ root: actualForgeRoot });
  const currentDefinitionById = new Map(currentDefinitions.map((definition) => [definition.id, definition]));
  const waveA = await verifyCommittedWaveAApproval({
    forgeRoot: actualForgeRoot,
    ledger,
    declaration: completeness.declaration,
    definitions: currentDefinitions
  });
  const waveAApprovalAssetById = new Map(
    waveA.approval.assets.map((asset) => [asset.assetId, asset])
  );
  const evidenceByAsset = new Map();
  for (const assetId of completeness.requiredAssetIds) {
    const approval = completeness.activeByAsset.get(assetId);
    const definition = currentDefinitionById.get(assetId);
    if (!definition) throw new Error(`No current Fable5 definition exists for v3 export: ${assetId}`);
    const currentDefinitionSha256 = sha256(canonicalJson(definition));
    if (approval.category !== definition.category || approval.definitionSha256 !== currentDefinitionSha256) {
      throw new Error(`Stale v3 bundle definition: ${assetId}`);
    }
    const evidence = await verifyBundleApprovalForExport(approval, {
      root: actualRoot,
      forgeRoot: actualForgeRoot
    });
    if (evidence?.assetId !== approval.assetId
      || evidence.definitionSha256 !== currentDefinitionSha256
      || !/^[a-f0-9]{64}$/.test(evidence.generationRecordDigest ?? '')
      || evidence.generationRecordDigest !== approval.generationRecordDigest
      || !isDeepStrictEqual(evidence.artifacts, approval.artifacts)) {
      throw new Error(`V3 provenance verifier returned mismatched evidence: ${assetId}`);
    }
    const committedAsset = waveAApprovalAssetById.get(assetId);
    const currentCellAudit = await auditWaveAAssetCells(actualRoot, definition,
      approval.artifacts.map(({ role, approvedPath, sha256: artifactSha256 }) => ({
        role,
        pendingPath: approvedPath,
        sha256: artifactSha256
      })));
    if (!committedAsset || !isDeepStrictEqual(currentCellAudit, committedAsset.cellAudit)) {
      throw new Error(`V3 cell audit no longer matches committed Wave A evidence: ${assetId}`);
    }
    evidenceByAsset.set(assetId, evidence);
  }

  const assets = [];
  const copiesByPublicPath = new Map();
  for (const assetId of [...completeness.requiredAssetIds].sort((left, right) => left.localeCompare(right))) {
    const approval = completeness.activeByAsset.get(assetId);
    const definition = currentDefinitionById.get(assetId);
    const inspectedArtifacts = [];
    for (const artifact of approval.artifacts) {
      const inspected = await inspectArtifact(actualRoot, artifact);
      if (inspected.inspection.width !== definition.outputSize.width
        || inspected.inspection.height !== definition.outputSize.height) {
        throw new Error(`V3 artifact dimensions do not match current definition: ${assetId}.${artifact.role}`);
      }
      inspectedArtifacts.push({
        role: inspected.role,
        sha256: inspected.sha256,
        publicPath: inspected.publicPath
      });
      const prior = copiesByPublicPath.get(inspected.publicPath);
      if (prior && prior.sha256 !== inspected.sha256) {
        throw new Error(`V3 public content-address collision: ${inspected.publicPath}`);
      }
      if (!prior || inspected.sourcePath.localeCompare(prior.sourcePath) < 0) {
        copiesByPublicPath.set(inspected.publicPath, {
          sourcePath: inspected.sourcePath,
          sha256: inspected.sha256,
          relative: relativePublicPath(inspected.publicPath)
        });
      }
    }
    assets.push({
      assetId: approval.assetId,
      category: approval.category,
      definitionSha256: approval.definitionSha256,
      bundleDigest: approval.bundleDigest,
      generationRecordDigest: evidenceByAsset.get(assetId).generationRecordDigest,
      definition: structuredClone(definition),
      cellAudit: (() => {
        const audit = waveAApprovalAssetById.get(assetId)?.cellAudit;
        if (!audit) throw new Error(`No committed Wave A cell audit exists for v3 export: ${assetId}`);
        return {
          declaredLogicalSlotCount: audit.declaredLogicalSlotCount,
          semanticCellCount: audit.semanticCellCount,
          expectedNonemptySemanticCellCount: audit.expectedNonemptySemanticCellCount,
          expectedTransparentSemanticCellCount: audit.expectedTransparentSemanticCellCount,
          reservedTransparentCellCount: audit.reservedTransparentCellCount,
          cellAuditDigest: audit.cellAuditDigest
        };
      })(),
      artifacts: inspectedArtifacts
    });
  }

  const bundleSetDigest = sha256(canonicalJson({
    contract: 'fable5-required-bundle-set-v3',
    requiredSetId: completeness.declaration.requiredSetId,
    waveIds: completeness.waves.map(({ id }) => id),
    waveAApprovalDigest: waveA.approval.approvalDigest,
    legacyDispositionDigest: waveA.migration.dispositionDigest,
    bundles: assets.map(({ assetId, bundleDigest, generationRecordDigest }) => ({
      assetId, bundleDigest, generationRecordDigest
    }))
  }));
  const manifest = {
    schemaVersion: 3,
    scope: 'wave-a-only-not-full-fable5-set',
    requiredSet: {
      id: completeness.declaration.requiredSetId,
      waveIds: completeness.waves.map(({ id }) => id),
      assetCount: completeness.requiredAssetIds.length,
      minimumOutputPngCount: completeness.expectedPngCount
    },
    completeForDeclaredWaves: true,
    fullFable5SetComplete: false,
    bundleSetDigest,
    waveAApprovalEvidence: {
      approvalDigest: waveA.approval.approvalDigest,
      planDigest: waveA.approval.planDigest,
      selectionDigest: waveA.approval.selectionDigest,
      legacyDispositionDigest: waveA.approval.legacyDispositionDigest,
      referenceAuthorizationSha256: waveA.approval.referenceAuthorizationSha256,
      evidenceCoverageDigest: waveA.approval.evidenceCoverageDigest,
      cellAuditDigest: waveA.approval.cellAuditDigest,
      artifactSetDigest: waveA.approval.artifactSetDigest,
      requiredAssetCount: waveA.approval.requiredAssetCount,
      outputPngCount: waveA.approval.outputPngCount,
      declaredLogicalSlotCount: waveA.approval.declaredLogicalSlotCount,
      semanticCellCount: waveA.approval.semanticCellCount,
      expectedNonemptySemanticCellCount: waveA.approval.expectedNonemptySemanticCellCount,
      expectedTransparentSemanticCellCount: waveA.approval.expectedTransparentSemanticCellCount,
      reservedTransparentCellCount: waveA.approval.reservedTransparentCellCount
    },
    legacyMigration: {
      recordSha256: sha256(canonicalJson(waveA.migration)),
      record: structuredClone(waveA.migration)
    },
    assets
  };
  const validation = validateWith('game-export-v3.schema.json', manifest);
  if (!validation.ok) throw new Error(`Invalid v3 game export: ${JSON.stringify(validation.errors)}`);
  if (assets.reduce((total, asset) => total + asset.artifacts.length, 0) < completeness.expectedPngCount) {
    throw new Error('V3 manifest does not satisfy the declared minimum PNG count');
  }

  const manifestSha256 = sha256(canonicalJson(manifest));
  const copies = [...copiesByPublicPath.values()]
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const versionedManifest = path.join('assets', 'forge', 'v3', 'manifests', `${manifestSha256}.json`);
  const currentManifest = path.join('assets', 'forge', 'v3', 'manifest.json');
  return {
    status: 'dry-run',
    manifest,
    manifestSha256,
    bundleSetDigest,
    copies,
    files: [...copies.map(({ relative }) => relative), versionedManifest, currentManifest]
  };
}

async function writeContentAddressed(root, relative, bytes, expectedHash) {
  const destination = path.join(root, relative);
  try {
    await atomicWriteFile(root, destination, bytes);
    return 'wrote';
  } catch (error) {
    let existing;
    try {
      existing = await readFile(await assertExistingFileWithin(root, relative.split(path.sep).join('/')));
    } catch {
      throw error;
    }
    if (sha256(existing) !== expectedHash || !existing.equals(bytes)) throw error;
    return 'reused';
  }
}

async function executePlan(plan, { forgeRoot, publicRoot, revalidate }) {
  const wrote = [];
  const reused = [];
  for (const copy of plan.copies) {
    const bytes = await readStableApprovedPng(forgeRoot, copy.sourcePath);
    if (sha256(bytes) !== copy.sha256) throw new Error(`V3 source changed after planning: ${copy.sourcePath}`);
    const outcome = await writeContentAddressed(publicRoot, copy.relative, bytes, copy.sha256);
    (outcome === 'wrote' ? wrote : reused).push(copy.relative);
  }

  const manifestBytes = Buffer.from(canonicalJson(plan.manifest));
  if (sha256(manifestBytes) !== plan.manifestSha256) throw new Error('V3 manifest changed after planning');
  const versionedManifest = path.join('assets', 'forge', 'v3', 'manifests', `${plan.manifestSha256}.json`);
  const manifestOutcome = await writeContentAddressed(
    publicRoot, versionedManifest, manifestBytes, plan.manifestSha256
  );
  (manifestOutcome === 'wrote' ? wrote : reused).push(versionedManifest);

  // The current v3 pointer is the only commit point. A crash before this leaves
  // content-addressed orphans, never a manifest that exposes half a building pair.
  await revalidate();
  const currentManifest = path.join(publicRoot, 'assets', 'forge', 'v3', 'manifest.json');
  await atomicReplaceJson(publicRoot, currentManifest, plan.manifest);
  wrote.push(path.join('assets', 'forge', 'v3', 'manifest.json'));
  return { ...plan, status: 'exported', wrote, reused };
}

async function exportCanonicalSnapshot({
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  ledger,
  ledgerDigest,
  waveIds,
  publicRoot
}) {
  const actualRoot = path.resolve(root);
  const actualForgeRoot = path.resolve(forgeRoot);
  const plan = await buildV3ExportPlan({
    root: actualRoot,
    forgeRoot: actualForgeRoot,
    ledger,
    waveIds
  });
  const actualPublicRoot = path.resolve(publicRoot);
  await mkdir(actualPublicRoot, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(actualPublicRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('V3 export public root must be a real non-symlink directory');
  }
  return withFileLock(
    actualPublicRoot,
    path.join(actualPublicRoot, '.asset-forge-v3-export.lock'),
    () => executePlan(plan, {
      forgeRoot: actualRoot,
      publicRoot: actualPublicRoot,
      revalidate: async () => {
        assertActiveCanonicalBundleLedgerSnapshot(ledger, ledgerDigest);
        const persistedLedger = await readBundleLedger({ root: actualRoot });
        if (bundleLedgerDigest(persistedLedger) !== ledgerDigest
          || !isDeepStrictEqual(persistedLedger, ledger)) {
          throw new Error('V3 bundle ledger changed immediately before public manifest commit');
        }
        const rebuilt = await buildV3ExportPlan({
          root: actualRoot,
          forgeRoot: actualRoot,
          ledger,
          waveIds
        });
        if (rebuilt.manifestSha256 !== plan.manifestSha256
          || rebuilt.bundleSetDigest !== plan.bundleSetDigest
          || !isDeepStrictEqual(rebuilt.copies, plan.copies)
          || !isDeepStrictEqual(rebuilt.manifest, plan.manifest)) {
          throw new Error('V3 canonical provenance changed immediately before public manifest commit');
        }
      }
    })
  );
}

/**
 * The only public v3 export operator. It reads the canonical persisted ledger,
 * uses the fixed current provenance verifier, and derives the destination from
 * the Asset Forge project root. No caller-supplied ledger, verifier, TTY bypass,
 * or export destination can reach the write path.
 */
export async function runCanonicalV3Export(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['waveIds', 'write'].includes(key))) {
    throw new Error('Public v3 export accepts only waveIds and write; its source and destination roots are fixed');
  }
  const { waveIds, write = false } = options;
  const actualRoot = path.resolve(FORGE_ROOT);
  const actualForgeRoot = actualRoot;
  if (!write) {
    const ledger = await readBundleLedger({ root: actualRoot });
    return buildV3ExportPlan({
      root: actualRoot,
      forgeRoot: actualForgeRoot,
      ledger,
      waveIds
    });
  }
  const publicRoot = path.resolve(actualRoot, '..', '..', 'public');
  const forgePaths = pathsFor(actualRoot);
  return withFileLock(actualRoot, forgePaths.requiredPromotionLock, () =>
    withFileLock(actualRoot, forgePaths.lifecycleLock, () =>
      withBundleLedgerSnapshot((ledger, ledgerDigest) => exportCanonicalSnapshot({
        root: actualRoot,
        forgeRoot: actualForgeRoot,
        ledger,
        ledgerDigest,
        waveIds,
        publicRoot
      }), { root: actualRoot })));
}
