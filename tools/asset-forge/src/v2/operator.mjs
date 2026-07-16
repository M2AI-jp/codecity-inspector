import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT } from '../config.mjs';
import { canonicalJson } from '../hashing.mjs';
import { assertExistingFileWithin } from '../paths.mjs';
import { validateWith } from '../schemas.mjs';
import { readWaveADefinitions } from './definition-builder.mjs';
import {
  importWaveACandidate,
  prepareWaveAIdentityBinding,
  verifyWaveAJobPack
} from './import-candidate.mjs';
import { writeWaveAJobPack } from './write-job-pack.mjs';

const MAX_REQUEST_BYTES = 256 * 1024;
const REQUEST_PATH = /^review\/import-requests\/v2\/[a-z0-9][a-z0-9_-]*\.json$/;

function requireCanonicalRoot(root, forgeRoot) {
  const actualRoot = path.resolve(root);
  const actualForgeRoot = path.resolve(forgeRoot);
  if (actualRoot !== actualForgeRoot) {
    throw new Error('Fable5 Wave A operator requires one canonical Asset Forge root');
  }
  return actualRoot;
}

export async function readWaveAImportRequest(requestPath, {
  root = FORGE_ROOT
} = {}) {
  if (typeof requestPath !== 'string' || !REQUEST_PATH.test(requestPath)) {
    throw new Error('Wave A import request must be review/import-requests/v2/<name>.json');
  }
  const absolute = await assertExistingFileWithin(root, requestPath);
  const bytes = await readFile(absolute);
  if (bytes.length < 2 || bytes.length > MAX_REQUEST_BYTES) {
    throw new Error('Wave A import request is empty or exceeds 256 KiB');
  }
  let request;
  try {
    request = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Wave A import request is not valid JSON', { cause: error });
  }
  const validation = validateWith('wave-a-import-request-v2.schema.json', request);
  if (!validation.ok) {
    throw new Error(`Invalid Wave A import request: ${JSON.stringify(validation.errors)}`);
  }
  if (!bytes.equals(Buffer.from(canonicalJson(request)))) {
    throw new Error('Wave A import request must use exact canonical JSON encoding');
  }
  return request;
}

export async function makeWaveAJob({ assetId, seed = '', generationMode = 'per-unit' }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  const canonicalRoot = requireCanonicalRoot(root, forgeRoot);
  return writeWaveAJobPack({ assetId, seed, generationMode }, {
    root: canonicalRoot,
    forgeRoot: canonicalRoot
  });
}

export async function prepareWaveAIdentity({ assetId, jobPackPath, identityMasterSource }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  const canonicalRoot = requireCanonicalRoot(root, forgeRoot);
  return prepareWaveAIdentityBinding({ assetId, jobPackPath, identityMasterSource }, {
    root: canonicalRoot,
    forgeRoot: canonicalRoot
  });
}

export async function importWaveARequest({ requestPath }, {
  root = FORGE_ROOT,
  forgeRoot = FORGE_ROOT
} = {}) {
  const canonicalRoot = requireCanonicalRoot(root, forgeRoot);
  const request = await readWaveAImportRequest(requestPath, { root: canonicalRoot });
  const verified = await verifyWaveAJobPack(request.jobPackPath, {
    root: canonicalRoot,
    forgeRoot: canonicalRoot
  });
  if (request.assetId !== verified.asset.id) {
    throw new Error('Wave A import request asset does not match its canonical job pack');
  }
  return importWaveACandidate({
    assetId: request.assetId,
    jobPackPath: request.jobPackPath,
    ...(request.unitSources ? { unitSources: request.unitSources } : {}),
    terrainComposition: request.terrainComposition ?? null,
    identityBindingPath: request.identityBindingPath
  }, {
    root: canonicalRoot,
    forgeRoot: canonicalRoot
  });
}

export async function listWaveAAssets({ root = FORGE_ROOT } = {}) {
  const definitions = await readWaveADefinitions({ root });
  return definitions.map((definition) => ({
    id: definition.id,
    category: definition.category,
    displayName: definition.displayName,
    artifactRoles: definition.category === 'building' ? ['base', 'roof'] : ['primary'],
    declaredCells: definition.sprites?.grid
      ? definition.sprites.grid.columns * definition.sprites.grid.rows
      : 1
  }));
}
