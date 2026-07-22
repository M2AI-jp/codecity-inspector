import path from 'node:path';
import { FORGE_ROOT, pathsFor } from './config.mjs';
import { readJson } from './fs-safe.mjs';
import { sha256 } from './hashing.mjs';
import { readExternalImage } from './images/inspect-image.mjs';
import { assertExistingFileWithin } from './paths.mjs';
import { validateWith } from './schemas.mjs';

export async function readReferenceManifest({ root = FORGE_ROOT } = {}) {
  const paths = pathsFor(root);
  const manifest = await readJson(path.join(paths.manifests, 'references.json'));
  const validation = validateWith('reference-image.schema.json', manifest);
  if (!validation.ok) throw new Error(`Invalid reference manifest: ${JSON.stringify(validation.errors)}`);
  return manifest;
}

function sameValues(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertUniqueReferenceIds(manifest) {
  const seen = new Set();
  for (const reference of manifest.references) {
    if (seen.has(reference.id)) throw new Error(`Duplicate reference id: ${reference.id}`);
    seen.add(reference.id);
  }
}

function assertAssetReferenceMapping(asset, manifest) {
  if (!asset || typeof asset.id !== 'string' || !Array.isArray(asset.defaultReferenceIds)) {
    throw new Error('Asset definition has no valid reference mapping');
  }
  assertUniqueReferenceIds(manifest);
  for (const referenceId of asset.defaultReferenceIds) {
    const reference = manifest.references.find((entry) => entry.id === referenceId);
    if (!reference?.targetAssetIds?.includes(asset.id)) {
      throw new Error(`Asset/reference target mapping mismatch: ${asset.id} -> ${referenceId}`);
    }
  }
  if (asset.required && asset.defaultReferenceIds.length === 0) {
    throw new Error(`Required asset has no approved reference mapping: ${asset.id}`);
  }
  if (asset.required && !asset.defaultReferenceIds.includes('world_visual_master')) {
    throw new Error(`Required asset needs the world reference mapping: ${asset.id}`);
  }
  if (asset.required && asset.category === 'character'
    && (asset.defaultReferenceIds.length !== 2
      || asset.defaultReferenceIds[0] !== 'world_visual_master'
      || asset.defaultReferenceIds[1] !== 'character_visual_master')) {
    throw new Error(`Required character needs the world and character visual master mappings: ${asset.id}`);
  }
  if (asset.required && asset.category !== 'character'
    && asset.defaultReferenceIds.every((id) => id === 'world_visual_master')) {
    throw new Error(`Required asset needs world and subject reference mappings: ${asset.id}`);
  }
}

async function resolveFromManifest(referenceIds, manifest, {
  root,
  allowPending,
  allowMissing
}) {
  assertUniqueReferenceIds(manifest);
  const resolved = [];
  const warnings = [];
  for (const id of referenceIds) {
    const entry = manifest.references.find((reference) => reference.id === id);
    if (!entry) throw new Error(`Unknown reference: ${id}`);
    const allowed = entry.status === 'approved' || (allowPending && entry.status === 'pending');
    if (!allowed) {
      if (allowMissing) {
        warnings.push(`Reference ${id} is ${entry.status}; it was not included.`);
        continue;
      }
      throw new Error(`Reference ${id} is not approved${allowPending ? ' or pending' : ''}: ${entry.status}`);
    }
    if (!entry.sha256) throw new Error(`Reference ${id} has no SHA-256`);
    const expectedPrefix = `references/${entry.status}/`;
    if (!entry.path.startsWith(expectedPrefix)) throw new Error(`Reference path does not match status: ${id}`);
    const actual = await assertExistingFileWithin(pathsFor(root).references, entry.path.slice('references/'.length));
    const snapshot = await readExternalImage(actual);
    const actualHash = sha256(snapshot.buffer);
    if (actualHash !== entry.sha256) throw new Error(`Reference hash mismatch: ${id}`);
    resolved.push({ ...entry, absolutePath: actual, bytes: snapshot.buffer, sha256: actualHash });
  }
  return { references: resolved, warnings };
}

export async function resolveReferences(referenceIds, {
  root = FORGE_ROOT,
  allowPending = false,
  allowMissing = true
} = {}) {
  const manifest = await readReferenceManifest({ root });
  return resolveFromManifest(referenceIds, manifest, { root, allowPending, allowMissing });
}

export async function resolveAssetReferences(asset, {
  root = FORGE_ROOT,
  allowPendingReferences = false,
  requireReferences = false
} = {}) {
  const manifest = await readReferenceManifest({ root });
  assertAssetReferenceMapping(asset, manifest);
  const required = asset.required === true;
  const resolved = await resolveFromManifest(asset.defaultReferenceIds, manifest, {
    root,
    // Required production assets can never use the pending-reference escape hatch.
    allowPending: required ? false : allowPendingReferences,
    allowMissing: required ? false : !requireReferences
  });
  for (const reference of resolved.references) {
    if (!reference.targetAssetIds?.includes(asset.id)) {
      throw new Error(`Reference target does not include asset: ${reference.id} -> ${asset.id}`);
    }
  }
  if (required && resolved.references.length !== asset.defaultReferenceIds.length) {
    throw new Error(`Required asset reference set is incomplete: ${asset.id}`);
  }
  return resolved;
}

export async function assertGenerationReferenceMetadata(asset, generation, {
  root = FORGE_ROOT
} = {}) {
  const { references } = await resolveAssetReferences(asset, { root });
  const expectedIds = references.map((reference) => reference.id);
  const expectedHashes = references.map((reference) => reference.sha256);
  if (!sameValues(generation?.referenceImageIds, expectedIds)
    || !sameValues(generation?.referenceImageHashes, expectedHashes)) {
    throw new Error(`Generation reference provenance mismatch: ${asset.id}`);
  }
  return references;
}
