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

export async function resolveReferences(referenceIds, {
  root = FORGE_ROOT,
  allowPending = false,
  allowMissing = true
} = {}) {
  const manifest = await readReferenceManifest({ root });
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
