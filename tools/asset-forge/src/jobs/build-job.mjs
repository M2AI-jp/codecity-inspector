import { readFile } from 'node:fs/promises';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { assertExistingFileWithin, categoryDirectory } from '../paths.mjs';
import { resolveAssetReferences } from '../references.mjs';
import { validateWith } from '../schemas.mjs';
import { findAsset } from './define-assets.mjs';

export function outputContractFor(asset) {
  const frameWidth = asset.pixelArt.logicalSpriteSize?.width ?? asset.pixelArt.tileSize ?? 16;
  const frameHeight = asset.pixelArt.logicalSpriteSize?.height ?? asset.pixelArt.tileSize ?? 16;
  const columns = asset.sprites?.grid?.columns ?? 1;
  const rows = asset.sprites?.grid?.rows ?? 1;
  const outputContract = {
    kind: asset.output.kind,
    format: asset.output.preferredFormat,
    background: asset.output.background,
    needsTransparency: asset.output.needsTransparency,
    needsTrim: asset.output.needsTrim,
    width: frameWidth * columns,
    height: frameHeight * rows,
    nearestNeighbor: asset.pixelArt.nearestNeighbor,
    allowAntiAlias: asset.pixelArt.allowAntiAlias
  };
  if (asset.sprites?.grid) outputContract.grid = { columns, rows, frameWidth, frameHeight };
  return outputContract;
}

export async function buildJob({
  assetId,
  provider = 'mock',
  dryRun = false,
  seed = '',
  allowPendingReferences = false,
  requireReferences = false
}, { forgeRoot = FORGE_ROOT } = {}) {
  const asset = await findAsset(assetId, { root: forgeRoot });
  const paths = pathsFor(forgeRoot);
  const promptParts = [];
  for (const file of asset.promptFiles) {
    if (!file.startsWith('prompts/')) throw new Error(`Prompt path is outside prompts root: ${file}`);
    const promptPath = await assertExistingFileWithin(paths.prompts, file.slice('prompts/'.length));
    promptParts.push(await readFile(promptPath, 'utf8'));
  }
  const promptText = promptParts.join('\n\n');
  const promptHash = sha256(promptText);
  const { references, warnings } = await resolveAssetReferences(asset, {
    root: forgeRoot,
    allowPendingReferences,
    requireReferences
  });
  const referenceImageIds = references.map((reference) => reference.id);
  const referenceImageHashes = references.map((reference) => reference.sha256);
  const outputContract = outputContractFor(asset);
  const provenanceKey = sha256(canonicalJson({
    assetId,
    provider,
    promptHash,
    referenceImageIds,
    referenceImageHashes,
    seed: String(seed),
    outputContract
  }));
  const job = {
    id: `job_${provenanceKey.slice(0, 20)}`,
    assetId,
    provider,
    dryRun: Boolean(dryRun),
    subscriptionRun: false,
    promptText,
    promptHash,
    promptFiles: asset.promptFiles,
    referenceImageIds,
    referenceImageHashes,
    seed: String(seed),
    provenanceKey,
    outputContract,
    outputDir: `generated/${categoryDirectory(asset.category)}/pending`,
    createdBy: 'codex',
    warnings
  };
  const validation = validateWith('generation-job.schema.json', job);
  if (!validation.ok) throw new Error(`Invalid generation job: ${JSON.stringify(validation.errors)}`);
  return { asset, job, references };
}
