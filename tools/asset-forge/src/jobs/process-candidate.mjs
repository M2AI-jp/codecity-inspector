import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { atomicWriteFile, atomicWriteJson, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, hashApprovedTree, hashFile, sha256 } from '../hashing.mjs';
import { extractGridFrames, processImageBuffer } from '../images/process-image.mjs';
import { auditVisualAssetV2 } from '../images/visual-contract-v2.mjs';
import { appendGenerationResultUnlocked, readLocalGenerationManifest } from '../manifests/local-generations.mjs';
import {
  assertExistingStateFile,
  assetFileStem,
  categoryDirectory,
  toPosixRelative
} from '../paths.mjs';
import { inspectPng } from '../png-core.mjs';
import { assertGenerationReferenceMetadata } from '../references.mjs';
import { validateWith } from '../schemas.mjs';
import { findAsset } from './define-assets.mjs';
import { verifyPersistedWaveAUnitAssembly } from '../v2/import-candidate.mjs';

function isExplicitWaveAResult(result) {
  const markers = [
    result.requiredSetId === 'fable5-v2',
    result.waveId === 'A',
    result.visualContractVersion === 2
  ];
  if (markers.some(Boolean) && !markers.every(Boolean)) {
    throw new Error('Generation has incomplete Fable5 v2 result markers');
  }
  return markers.every(Boolean);
}

async function auditExplicitWaveAResult(result, {
  root, forgeRoot, alphaKey, tolerance, trim
}) {
  if (alphaKey !== 'none' || Number(tolerance) !== 0 || trim) {
    throw new Error('V2 processing is audit-only; regenerate instead of mutating alpha, trim, or scale');
  }
  const deep = await verifyPersistedWaveAUnitAssembly(result, { root, forgeRoot });
  return {
    asset: deep.asset,
    audited: deep.artifactRoles.map((role) => ({ role }))
  };
}

export async function processCandidate({ generationId, alphaKey = 'none', tolerance = 0, trim = false }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT,
  now = () => new Date().toISOString()
} = {}) {
  return withFileLock(root, pathsFor(root).requiredPromotionLock, () => processCandidateLocked({
    generationId, alphaKey, tolerance, trim
  }, { root, forgeRoot, now }));
}

async function processCandidateLocked({ generationId, alphaKey, tolerance, trim }, {
  root, forgeRoot, now
}) {
  const approvedBefore = await hashApprovedTree(root);
  const manifest = await readLocalGenerationManifest(root);
  const result = manifest.results.find((entry) => entry.id === generationId);
  if (!result || result.status !== 'pending') throw new Error('Processing requires a pending generation with output');
  if (isExplicitWaveAResult(result)) {
    const audited = await auditExplicitWaveAResult(result, {
      root, forgeRoot, alphaKey, tolerance, trim
    });
    const approvedAfter = await hashApprovedTree(root);
    if (approvedAfter !== approvedBefore) throw new Error('Approved tree changed during V2 audit');
    return {
      status: 'audited-pending',
      result,
      artifactRoles: audited.audited.map(({ role }) => role),
      approvedTreeSha256Before: approvedBefore,
      approvedTreeSha256After: approvedAfter
    };
  }
  if (!result.outputPath) throw new Error('Processing requires a pending generation with output');
  const inputPath = await assertExistingStateFile(root, result.category, 'pending', result.outputPath);
  const source = await readFile(inputPath);
  const sourceHashBefore = sha256(source);
  if (sourceHashBefore !== result.outputSha256) throw new Error('Pending source hash mismatch');
  const asset = await findAsset(result.assetId, { root: forgeRoot });
  await assertGenerationReferenceMetadata(asset, result, { root: forgeRoot });
  if (asset.visualContractVersion === 2 && asset.category === 'building') {
    throw new Error('V2 layered buildings require the atomic base/roof bundle pipeline');
  }
  if (asset.visualContractVersion === 2 && (alphaKey !== 'none' || Number(tolerance) !== 0 || trim)) {
    throw new Error('V2 technical-gate processing is audit-only; regenerate instead of mutating alpha, trim, or scale');
  }
  if (result.productionRecipe && (alphaKey !== 'none' || trim)) {
    throw new Error('Recipe-backed candidates cannot be destructively alpha-keyed or trimmed during processing');
  }
  const processed = await processImageBuffer(source, {
    alphaKey,
    tolerance: Number(tolerance),
    trim: Boolean(trim)
  });
  const technicalAudit = asset.visualContractVersion === 2
    ? await auditVisualAssetV2(processed.png, asset, { sourceBuffer: source })
    : null;
  if (technicalAudit && !technicalAudit.ok) {
    throw new Error(`V2 technical gates rejected the candidate: ${technicalAudit.problems.join('; ')}`);
  }
  if (asset.category !== result.category) throw new Error('Generation category does not match asset definition');
  const processingKey = sha256(canonicalJson({
    sourceGenerationId: generationId,
    sourceSha256: sourceHashBefore,
    alphaKey,
    tolerance: Number(tolerance),
    trim: Boolean(trim),
    visualContractVersion: asset.visualContractVersion ?? 1
  }));
  const processedId = `gen_processed_${processingKey.slice(0, 20)}`;
  const outputRoot = path.join(pathsFor(root).processed, categoryDirectory(asset.category), 'pending');
  const stem = `${assetFileStem(asset.id)}-${processingKey.slice(0, 16)}`;
  const normalizedPath = path.join(outputRoot, `${stem}.png`);
  await atomicWriteFile(root, normalizedPath, processed.png);
  const outputSha256 = sha256(processed.png);
  if (await hashFile(normalizedPath) !== outputSha256) throw new Error('Persisted processed output hash mismatch');
  const frames = [];
  if (asset.sprites?.grid) {
    const frameBuffers = await extractGridFrames(processed.png, {
      ...asset.sprites.grid,
      frameWidth: asset.sprites.grid.frameWidth ?? asset.pixelArt.logicalSpriteSize?.width,
      frameHeight: asset.sprites.grid.frameHeight ?? asset.pixelArt.logicalSpriteSize?.height
    });
    for (const [index, frame] of frameBuffers.entries()) {
      const framePath = path.join(outputRoot, 'frames', processedId, `frame-${String(index).padStart(3, '0')}.png`);
      await atomicWriteFile(root, framePath, frame);
      const frameSha256 = sha256(frame);
      if (await hashFile(framePath) !== frameSha256) throw new Error('Persisted sprite frame hash mismatch');
      frames.push({ path: toPosixRelative(root, framePath), sha256: frameSha256 });
    }
  }
  const processingMetadataPath = path.join(outputRoot, `${stem}.processing.json`);
  const metadata = {
    schemaVersion: 1,
    generationId,
    assetId: result.assetId,
    sourcePath: result.outputPath,
    sourceSha256: sourceHashBefore,
    outputPath: toPosixRelative(root, normalizedPath),
    outputSha256,
    alphaKey,
    tolerance: Number(tolerance),
    trim: Boolean(trim),
    width: processed.width,
    height: processed.height,
    frames,
    ...(technicalAudit ? { technicalInspection: technicalAudit.technicalInspection } : {})
  };
  await atomicWriteJson(root, processingMetadataPath, metadata);
  const outputInspection = inspectPng(processed.png);
  const resultMetadataPath = path.join(outputRoot, `${stem}.json`);
  const processedResult = {
    ...result,
    id: processedId,
    status: 'pending',
    outputPath: toPosixRelative(root, normalizedPath),
    outputSha256: metadata.outputSha256,
    outputInspection,
    ...(asset.visualContractVersion === 2 ? {
      visualContractVersion: 2,
      technicalInspection: technicalAudit.technicalInspection
    } : {}),
    ...(result.productionRecipe ? {
      productionRecipe: { ...result.productionRecipe, outputSha256 }
    } : {}),
    metadataPath: toPosixRelative(root, resultMetadataPath),
    provenanceKey: processingKey,
    processedFromGenerationId: generationId,
    warnings: [...result.warnings, 'Processed derivative remains pending until explicit human approval.'],
    createdAt: now(),
    inspection: {
      ...result.inspection,
      observed: [...result.inspection.observed, 'Alpha/trim/grid processing produced a separate hash-checked pending derivative.'],
      unknown: [...new Set([...result.inspection.unknown, 'visual edge quality after processing'])]
    }
  };
  const validation = validateWith('generation-result.schema.json', processedResult);
  if (!validation.ok) throw new Error(`Invalid processed result: ${JSON.stringify(validation.errors)}`);
  await atomicWriteJson(root, resultMetadataPath, processedResult);
  await appendGenerationResultUnlocked(root, processedResult);
  const approvedAfter = await hashApprovedTree(root);
  if (approvedAfter !== approvedBefore) throw new Error('Approved tree changed during processing');
  return {
    status: 'processed-pending', metadata, result: processedResult,
    approvedTreeSha256Before: approvedBefore, approvedTreeSha256After: approvedAfter
  };
}
