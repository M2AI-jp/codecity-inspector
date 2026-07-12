import { pathsFor } from '../config.mjs';
import { atomicReplaceJson, readJson, withFileLock } from '../fs-safe.mjs';
import { validateWith } from '../schemas.mjs';

export const EMPTY_GENERATION_MANIFEST = Object.freeze({
  schemaVersion: 1,
  tracked: false,
  results: []
});

export async function readLocalGenerationManifest(root) {
  const paths = pathsFor(root);
  const manifest = await readJson(paths.localGenerationManifest, {
    allowMissing: true,
    fallback: EMPTY_GENERATION_MANIFEST
  });
  const validation = validateWith('generation-manifest.schema.json', manifest);
  if (!validation.ok) throw new Error(`Invalid local generation manifest: ${JSON.stringify(validation.errors)}`);
  return manifest;
}

export async function appendGenerationResult(root, result, { beforeWrite } = {}) {
  const resultValidation = validateWith('generation-result.schema.json', result);
  if (!resultValidation.ok) throw new Error(`Invalid generation result: ${JSON.stringify(resultValidation.errors)}`);
  const paths = pathsFor(root);
  return withFileLock(root, paths.localGenerationLock, async () => {
    const manifest = await readLocalGenerationManifest(root);
    if (manifest.results.some((entry) => entry.id === result.id)) {
      throw new Error(`Generation result already exists: ${result.id}`);
    }
    const updated = { ...manifest, results: [...manifest.results, result] };
    const validation = validateWith('generation-manifest.schema.json', updated);
    if (!validation.ok) throw new Error(`Invalid local generation manifest: ${JSON.stringify(validation.errors)}`);
    if (beforeWrite) await beforeWrite(updated);
    await atomicReplaceJson(root, paths.localGenerationManifest, updated);
    return updated;
  });
}

export async function replaceGenerationResult(root, generationId, transition) {
  const paths = pathsFor(root);
  return withFileLock(root, paths.localGenerationLock, async () => {
    const manifest = await readLocalGenerationManifest(root);
    const index = manifest.results.findIndex((entry) => entry.id === generationId);
    if (index < 0) throw new Error(`Unknown generation result: ${generationId}`);
    const replacement = await transition(structuredClone(manifest.results[index]));
    const resultValidation = validateWith('generation-result.schema.json', replacement);
    if (!resultValidation.ok) throw new Error(`Invalid transitioned generation result: ${JSON.stringify(resultValidation.errors)}`);
    const results = [...manifest.results];
    results[index] = replacement;
    const updated = { ...manifest, results };
    await atomicReplaceJson(root, paths.localGenerationManifest, updated);
    return replacement;
  });
}
