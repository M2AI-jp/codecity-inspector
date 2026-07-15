import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const AUTHORING_CATEGORIES = Object.freeze(['character', 'building', 'field', 'object', 'ui', 'effect']);
export const CATEGORY_DIRS = Object.freeze({
  character: 'characters', building: 'buildings', field: 'fields',
  object: 'objects', ui: 'ui', effect: 'effects'
});
export const PROVIDERS = Object.freeze(['mock', 'job-pack', 'manual-import', 'codex-subscription']);

export function pathsFor(root = FORGE_ROOT) {
  const absoluteRoot = path.resolve(root);
  return Object.freeze({
    root: absoluteRoot,
    schemas: path.join(absoluteRoot, 'schemas'),
    prompts: path.join(absoluteRoot, 'prompts'),
    definitions: path.join(absoluteRoot, 'data', 'asset-definitions'),
    manifests: path.join(absoluteRoot, 'data', 'manifests'),
    local: path.join(absoluteRoot, 'data', 'local'),
    localGenerationManifest: path.join(absoluteRoot, 'data', 'local', 'generations.json'),
    localGenerationLock: path.join(absoluteRoot, 'data', 'local', '.generations.lock'),
    requiredPromotionLock: path.join(absoluteRoot, 'data', 'local', '.required-promotion.lock'),
    lifecycleLock: path.join(absoluteRoot, 'data', 'local', '.lifecycle.lock'),
    approvalManifest: path.join(absoluteRoot, 'data', 'manifests', 'approvals.json'),
    assetManifest: path.join(absoluteRoot, 'data', 'manifests', 'assets.json'),
    generated: path.join(absoluteRoot, 'generated'),
    jobs: path.join(absoluteRoot, 'generated', 'jobs'),
    processed: path.join(absoluteRoot, 'processed'),
    references: path.join(absoluteRoot, 'references')
  });
}

export const PATHS = pathsFor();
export const IMAGE_LIMITS = Object.freeze({
  maxInputBytes: 25 * 1024 * 1024,
  maxInputPixels: 32_000_000,
  maxWidth: 8192,
  maxHeight: 8192,
  maxFrames: 1,
  maxChannels: 4
});
export const BATCH_LIMITS = Object.freeze({ defaultJobs: 10, hardMaximumJobs: 50 });
export const PROCESS_LIMITS = Object.freeze({ maxExtractedFrames: 256, maxFrameOutputBytes: 128 * 1024 * 1024 });
