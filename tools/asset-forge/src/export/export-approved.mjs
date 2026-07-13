import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { atomicReplaceJson, atomicWriteFile, readJson, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, sha256 as hashBytes } from '../hashing.mjs';
import { readAssetDefinitions } from '../jobs/define-assets.mjs';
import { assertExistingStateFile, assetFileStem } from '../paths.mjs';
import { inspectPng } from '../png-core.mjs';
import { validateWith } from '../schemas.mjs';

function bindingGaps(definitions, coverage) {
  const bound = new Set();
  for (const definition of definitions) {
    for (const binding of definition.gameBinding.runtimeBindings) bound.add(`${binding.vocabulary}\0${binding.id}`);
  }
  if (definitions.some((definition) => definition.gameBinding.rendererCategory === 'building_exterior')) {
    for (const value of Object.values(coverage.stateMap ?? {})) bound.add(`BUILDING_STATES\0${value}`);
  }
  const gaps = [];
  for (const [vocabulary, ids] of Object.entries(coverage.vocabularies)) {
    for (const runtimeId of ids) if (!bound.has(`${vocabulary}\0${runtimeId}`)) gaps.push({ vocabulary, runtimeId });
  }
  return gaps;
}

function spriteAxes(assetId, sprites) {
  const directions = [...(sprites?.directions ?? [])];
  const frames = [...(sprites?.frames ?? [])];
  const grid = sprites?.grid ? { ...sprites.grid } : null;
  if (!grid || frames.length === 0) throw new Error(`Spritesheet definition is incomplete: ${assetId}`);
  let directionAxis = null;
  let frameAxis = null;
  if (directions.length) {
    if (directions.length === grid.columns && frames.length === grid.rows) {
      directionAxis = 'column'; frameAxis = 'row';
    } else if (directions.length === grid.rows && frames.length === grid.columns) {
      directionAxis = 'row'; frameAxis = 'column';
    }
  } else if (frames.length === grid.columns && grid.rows === 1) {
    frameAxis = 'column';
  } else if (frames.length === grid.rows && grid.columns === 1) {
    frameAxis = 'row';
  }
  if (!frameAxis) throw new Error(`Spritesheet axes do not match its grid: ${assetId}`);
  return { directions, frames, grid, directionAxis, frameAxis };
}

function renderSpecFor(definition) {
  const kind = definition.output.kind;
  return {
    kind,
    logicalSize: definition.pixelArt.logicalSpriteSize ? { ...definition.pixelArt.logicalSpriteSize } : null,
    tileSize: definition.pixelArt.tileSize ?? null,
    nearestNeighbor: definition.pixelArt.nearestNeighbor,
    allowAntiAlias: definition.pixelArt.allowAntiAlias,
    sprites: kind === 'spritesheet' ? spriteAxes(definition.id, definition.sprites) : null,
    states: [...(definition.states ?? [])],
    variantTags: [...definition.tags]
  };
}

function inspectApprovedPng(assetId, bytes, renderSpec) {
  const inspection = inspectPng(bytes);
  if (renderSpec.kind !== 'spritesheet') return inspection;
  const { columns, rows, frameWidth, frameHeight } = renderSpec.sprites.grid;
  const expectedWidth = columns * frameWidth;
  const expectedHeight = rows * frameHeight;
  if (inspection.width !== expectedWidth || inspection.height !== expectedHeight) {
    throw new Error(
      `Approved spritesheet dimensions do not match its grid: ${assetId} ` +
      `(got ${inspection.width}x${inspection.height}, expected ${expectedWidth}x${expectedHeight})`
    );
  }
  return inspection;
}

async function writeContentAddressed(root, destination, bytes, expectedHash) {
  try {
    await atomicWriteFile(root, destination, bytes);
    if (hashBytes(await readFile(destination)) !== expectedHash) throw new Error('Export destination hash mismatch');
    return true;
  } catch (error) {
    let existing;
    try { existing = await readFile(destination); } catch { throw error; }
    if (hashBytes(existing) !== expectedHash || !existing.equals(bytes)) throw error;
    return false;
  }
}

async function exportApprovedUnlocked({ write = false, publicRoot, now = () => new Date().toISOString() } = {}, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  const paths = pathsFor(root);
  const [assetManifest, approvalManifest, coverage, definitions] = await Promise.all([
    readJson(paths.assetManifest), readJson(paths.approvalManifest),
    readJson(path.join(paths.manifests, 'runtime-coverage.json')),
    readAssetDefinitions({ root: forgeRoot })
  ]);
  for (const [schema, value] of [
    ['asset-manifest.schema.json', assetManifest],
    ['approval-manifest.schema.json', approvalManifest],
    ['runtime-coverage.schema.json', coverage]
  ]) {
    const validation = validateWith(schema, value);
    if (!validation.ok) throw new Error(`Invalid export input ${schema}: ${JSON.stringify(validation.errors)}`);
  }
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const approvalByPath = new Map(approvalManifest.approvals.map((approval) => [approval.approvedPath, approval]));
  const assets = [];
  const copies = [];
  const exportedDefinitions = [];
  for (const entry of assetManifest.assets.filter((asset) => ['approved', 'exported'].includes(asset.status))) {
    const definition = definitionById.get(entry.assetId);
    if (!definition || !entry.approvedPath) throw new Error(`Approved asset is missing definition/path: ${entry.assetId}`);
    if (definition.category !== entry.category) throw new Error(`Approved asset category does not match definition: ${entry.assetId}`);
    const approval = approvalByPath.get(entry.approvedPath);
    if (!approval || approval.assetId !== entry.assetId) throw new Error(`Approval ledger mismatch: ${entry.assetId}`);
    const source = await assertExistingStateFile(root, entry.category, 'approved', entry.approvedPath);
    const bytes = await readFile(source);
    const sha256 = hashBytes(bytes);
    if (sha256 !== approval.approvedSha256) throw new Error(`Approved hash mismatch: ${entry.assetId}`);
    const renderSpec = renderSpecFor(definition);
    inspectApprovedPng(entry.assetId, bytes, renderSpec);
    const relative = path.join('assets', 'forge', 'v1', sha256.slice(0, 16), `${assetFileStem(entry.assetId)}.png`);
    assets.push({
      assetId: entry.assetId, category: entry.category, sha256,
      publicPath: `/${relative.split(path.sep).join('/')}`,
      gameBinding: definition.gameBinding,
      renderSpec
    });
    exportedDefinitions.push(definition);
    copies.push({ assetId: entry.assetId, bytes, relative, sha256 });
  }
  assets.sort((left, right) => left.assetId.localeCompare(right.assetId));
  copies.sort((left, right) => left.assetId.localeCompare(right.assetId));
  const missingBindings = bindingGaps(exportedDefinitions, coverage);
  const exportedAssetIds = new Set(assets.map(({ assetId }) => assetId));
  const missingAssets = [...new Set(definitions
    .filter((definition) => definition.required && !exportedAssetIds.has(definition.id))
    .map((definition) => definition.id))]
    .sort((left, right) => left.localeCompare(right));
  const manifest = {
    schemaVersion: 2,
    generatedAt: now(),
    complete: missingBindings.length === 0 && missingAssets.length === 0,
    assets,
    missingBindings,
    missingAssets
  };
  const validation = validateWith('game-export.schema.json', manifest);
  if (!validation.ok) throw new Error(`Invalid game export: ${JSON.stringify(validation.errors)}`);
  const manifestSha256 = hashBytes(canonicalJson(manifest));
  const versionedManifestRelative = path.join('assets', 'forge', 'manifests', `${manifestSha256}.json`);
  const manifestRelative = path.join('assets', 'forge', 'manifest.json');
  const plan = {
    status: write ? 'exported' : 'dry-run', manifest, manifestSha256,
    files: [...copies.map(({ relative }) => relative), versionedManifestRelative, manifestRelative], wrote: [], reused: []
  };
  if (!write) return plan;
  if (!publicRoot) throw new Error('Export write requires a public root');
  const actualPublicRoot = path.resolve(publicRoot);
  await mkdir(actualPublicRoot, { recursive: true, mode: 0o700 });
  for (const copy of copies) {
    const destination = path.join(actualPublicRoot, copy.relative);
    if (await writeContentAddressed(actualPublicRoot, destination, copy.bytes, copy.sha256)) plan.wrote.push(destination);
    else plan.reused.push(destination);
  }
  const versionedManifestPath = path.join(actualPublicRoot, versionedManifestRelative);
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  if (await writeContentAddressed(actualPublicRoot, versionedManifestPath, manifestBytes, manifestSha256)) plan.wrote.push(versionedManifestPath);
  else plan.reused.push(versionedManifestPath);
  // Assets and the immutable versioned manifest are committed before this atomic pointer update.
  const manifestPath = path.join(actualPublicRoot, manifestRelative);
  await atomicReplaceJson(actualPublicRoot, manifestPath, manifest);
  plan.wrote.push(manifestPath);
  const publicPathByAssetId = new Map(assets.map((asset) => [asset.assetId, asset.publicPath]));
  const updatedAssetManifest = {
    ...assetManifest,
    assets: assetManifest.assets.map((entry) => publicPathByAssetId.has(entry.assetId)
      ? {
          ...entry,
          status: 'exported',
          exportPath: publicPathByAssetId.get(entry.assetId),
          lastUpdated: manifest.generatedAt
        }
      : entry)
  };
  const updatedValidation = validateWith('asset-manifest.schema.json', updatedAssetManifest);
  if (!updatedValidation.ok) throw new Error(`Invalid exported asset manifest: ${JSON.stringify(updatedValidation.errors)}`);
  if (assets.length) await atomicReplaceJson(root, paths.assetManifest, updatedAssetManifest);
  return plan;
}

export async function exportApproved(options = {}, dependencies = {}) {
  const root = dependencies.root ?? FORGE_ROOT;
  if (!options.write) return exportApprovedUnlocked(options, dependencies);
  return withFileLock(root, pathsFor(root).lifecycleLock, () => exportApprovedUnlocked(options, dependencies));
}
