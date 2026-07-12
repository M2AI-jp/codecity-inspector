import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT, pathsFor } from './config.mjs';
import { hashFile, sha256 } from './hashing.mjs';
import { readExternalImage } from './images/inspect-image.mjs';
import { assertExistingFileWithin, assertExistingStateFile } from './paths.mjs';
import { validateWith } from './schemas.mjs';

async function loadJson(filePath, issues, label = path.basename(filePath)) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    issues.push({
      code: error instanceof SyntaxError ? 'MALFORMED_JSON' : 'READ_FAILED',
      path: label,
      message: error.message
    });
    return null;
  }
}

function schemaCheck(schema, value, label, issues) {
  if (value == null) return false;
  const result = validateWith(schema, value);
  if (!result.ok) issues.push({ code: 'SCHEMA', path: label, errors: result.errors });
  return result.ok;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

export async function validateRepository({ root = FORGE_ROOT } = {}) {
  const paths = pathsFor(root);
  const issues = [];
  const catalogs = [];
  let definitionNames = [];
  try {
    definitionNames = (await readdir(paths.definitions)).filter((item) => item.endsWith('.json')).sort();
  } catch (error) {
    issues.push({ code: 'READ_FAILED', path: 'data/asset-definitions', message: error.message });
  }
  for (const name of definitionNames) {
    const value = await loadJson(path.join(paths.definitions, name), issues, `data/asset-definitions/${name}`);
    schemaCheck('asset-catalog.schema.json', value, `data/asset-definitions/${name}`, issues);
    if (value) catalogs.push(value);
  }

  const assets = catalogs.flatMap((catalog) => catalog.assets ?? []);
  const ids = assets.map((asset) => asset.id);
  for (const id of duplicateValues(ids)) issues.push({ code: 'DUPLICATE_ID', id });
  for (const catalog of catalogs) {
    for (const asset of catalog.assets ?? []) {
      if (asset.category !== catalog.category || !asset.id?.startsWith(`${catalog.category}.`)) {
        issues.push({ code: 'CATEGORY_MISMATCH', id: asset.id, catalogCategory: catalog.category, assetCategory: asset.category });
      }
      for (const prompt of asset.promptFiles ?? []) {
        try {
          if (!prompt.startsWith('prompts/')) throw new Error('prompt is outside prompts root');
          await assertExistingFileWithin(paths.prompts, prompt.slice('prompts/'.length));
        } catch (error) {
          issues.push({ code: 'MISSING_OR_UNSAFE_PROMPT', id: asset.id, path: prompt, message: error.message });
        }
      }
    }
  }

  const manifestSpecifications = [
    ['assets.json', 'asset-manifest.schema.json'],
    ['approvals.json', 'approval-manifest.schema.json'],
    ['references.json', 'reference-image.schema.json'],
    ['runtime-coverage.json', 'runtime-coverage.schema.json'],
    ['generations.template.json', 'generation-manifest.schema.json']
  ];
  const manifests = new Map();
  for (const [file, schema] of manifestSpecifications) {
    const value = await loadJson(path.join(paths.manifests, file), issues, `data/manifests/${file}`);
    schemaCheck(schema, value, `data/manifests/${file}`, issues);
    if (value) manifests.set(file, value);
  }

  const referenceManifest = manifests.get('references.json');
  const references = referenceManifest?.references ?? [];
  for (const id of duplicateValues(references.map((reference) => reference.id))) {
    issues.push({ code: 'DUPLICATE_REFERENCE_ID', id });
  }
  const referenceIds = new Set(references.map((reference) => reference.id));
  for (const asset of assets) {
    for (const referenceId of asset.defaultReferenceIds ?? []) {
      if (!referenceIds.has(referenceId)) issues.push({ code: 'MISSING_REFERENCE_DECLARATION', id: asset.id, referenceId });
    }
  }
  for (const reference of references) {
    if (!['approved', 'pending'].includes(reference.status)) continue;
    try {
      if (!reference.sha256) throw new Error('hash is required for a present reference');
      const expectedPrefix = `references/${reference.status}/`;
      if (!reference.path.startsWith(expectedPrefix)) throw new Error('reference path does not match status');
      const actual = await assertExistingFileWithin(paths.references, reference.path.slice('references/'.length));
      const snapshot = await readExternalImage(actual);
      const actualHash = sha256(snapshot.buffer);
      if (actualHash !== reference.sha256) throw new Error(`hash mismatch: expected ${reference.sha256}, observed ${actualHash}`);
    } catch (error) {
      issues.push({ code: 'INVALID_REFERENCE_FILE', id: reference.id, path: reference.path, message: error.message });
    }
  }

  const assetManifest = manifests.get('assets.json');
  const approvalManifest = manifests.get('approvals.json');
  const approvalByPath = new Map((approvalManifest?.approvals ?? []).map((approval) => [approval.approvedPath, approval]));
  const manifestAssets = assetManifest?.assets ?? [];
  for (const id of duplicateValues(manifestAssets.map((entry) => entry.assetId))) {
    issues.push({ code: 'DUPLICATE_ASSET_MANIFEST_ID', id });
  }
  const definitionById = new Map(assets.map((asset) => [asset.id, asset]));
  const manifestById = new Map(manifestAssets.map((entry) => [entry.assetId, entry]));
  for (const asset of assets) {
    const entry = manifestById.get(asset.id);
    if (!entry) issues.push({ code: 'MISSING_ASSET_MANIFEST_ENTRY', id: asset.id });
    else if (entry.category !== asset.category) issues.push({ code: 'ASSET_MANIFEST_CATEGORY_MISMATCH', id: asset.id });
  }
  for (const entry of manifestAssets) {
    if (!definitionById.has(entry.assetId)) issues.push({ code: 'UNKNOWN_ASSET_MANIFEST_ENTRY', id: entry.assetId });
    if (['approved', 'exported'].includes(entry.status)) {
      try {
        if (!entry.approvedPath) throw new Error('approvedPath is required');
        const actual = await assertExistingStateFile(root, entry.category, 'approved', entry.approvedPath);
        const approval = approvalByPath.get(entry.approvedPath);
        if (!approval || approval.assetId !== entry.assetId) throw new Error('approval ledger record is missing');
        if (await hashFile(actual) !== approval.approvedSha256) throw new Error('approved hash does not match ledger');
      } catch (error) {
        issues.push({ code: 'INVALID_APPROVED_ASSET', id: entry.assetId, message: error.message });
      }
    }
  }
  for (const approval of approvalManifest?.approvals ?? []) {
    const assetEntry = manifestById.get(approval.assetId);
    if (!assetEntry || assetEntry.approvedPath !== approval.approvedPath || !['approved', 'exported'].includes(assetEntry.status)) {
      issues.push({ code: 'ORPHAN_APPROVAL_RECORD', generationId: approval.generationId, assetId: approval.assetId });
    }
  }

  const coverage = manifests.get('runtime-coverage.json');
  if (coverage) {
    const bound = new Set();
    for (const asset of assets) {
      for (const binding of asset.gameBinding?.runtimeBindings ?? []) {
        const vocabularyValues = coverage.vocabularies?.[binding.vocabulary];
        if (!Array.isArray(vocabularyValues) || !vocabularyValues.includes(binding.id)) {
          issues.push({ code: 'UNKNOWN_RUNTIME_BINDING', id: asset.id, binding });
        } else {
          bound.add(`${binding.vocabulary}\0${binding.id}`);
        }
      }
    }
    for (const runtimeState of Object.values(coverage.stateMap ?? {})) {
      bound.add(`BUILDING_STATES\0${runtimeState}`);
    }
    const declaredUncovered = new Set((coverage.uncovered ?? []).map((entry) => `${entry.vocabulary}\0${entry.runtimeId}`));
    for (const [vocabulary, values] of Object.entries(coverage.vocabularies ?? {})) {
      for (const runtimeId of values) {
        const key = `${vocabulary}\0${runtimeId}`;
        if (!bound.has(key) && !declaredUncovered.has(key)) {
          issues.push({ code: 'UNREPORTED_RUNTIME_GAP', vocabulary, runtimeId });
        }
      }
    }
    for (const key of declaredUncovered) {
      if (bound.has(key)) {
        const [vocabulary, runtimeId] = key.split('\0');
        issues.push({ code: 'STALE_RUNTIME_GAP', vocabulary, runtimeId });
      }
    }
  }

  return {
    ok: issues.length === 0,
    assetCount: assets.length,
    requiredAssetCount: assets.filter((asset) => asset.required).length,
    issues
  };
}
