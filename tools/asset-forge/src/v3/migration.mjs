import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { FORGE_ROOT } from '../config.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { inspectPng } from '../png-core.mjs';
import { assertExistingFileWithin } from '../paths.mjs';
import { validateWith } from '../schemas.mjs';
import { readRequiredWavesV2, readWaveADefinitions } from '../v2/definition-builder.mjs';
import { readAssetDefinitions } from '../jobs/define-assets.mjs';

const DISPOSITION_RELATIVE = path.join('data', 'v2', 'legacy-disposition.json');
const LEGACY_FREEZE_RELATIVE = 'data/v3/legacy-v2-freeze.json';
const EXPECTED_WAVE_B_REMAKES = Object.freeze([
  ['character.dock_ferryman', 'character.dock_ferryman'],
  ['character.guildmaster', 'character.guildmaster'],
  ['character.innkeeper', 'character.innkeeper'],
  ['character.mob.artisan', 'character.mob.artisan'],
  ['character.mob.child', 'character.mob.child'],
  ['character.mob.delivery_person', 'character.mob.delivery_person'],
  ['character.mob.dock_worker', 'character.mob.dock_worker'],
  ['character.mob.elder', 'character.mob.elder'],
  ['character.mob.inn_guest', 'character.mob.inn_guest'],
  ['character.mob.merchant', 'character.mob.merchant'],
  ['character.mob.tavern_guest', 'character.mob.tavern_guest'],
  ['character.mob.traveler', 'character.mob.traveler'],
  ['character.tavern_master', 'character.tavern_master'],
  ['character.warehouse_keeper', 'character.warehouse_keeper'],
  ['character.watchtower_guard', 'character.watchtower_guard'],
  ['character.workshop_artisan', 'character.workshop_artisan'],
  ['object.construction_sign', 'prop.construction_sign'],
  ['object.flowerbed', 'prop.flowerbed'],
  ['object.rubble', 'prop.rubble'],
  ['object.stacked_crates', 'prop.stacked_crates']
].map(([legacyAssetId, successorAssetId]) => ({ legacyAssetId, successorAssetId })));

function withoutDigest(value) {
  const copy = structuredClone(value);
  delete copy.dispositionDigest;
  return copy;
}

function withoutFreezeDigest(value) {
  const copy = structuredClone(value);
  delete copy.freezeDigest;
  return copy;
}

async function readStableLegacyBytes(root, relativePath, maximumBytes = 25 * 1024 * 1024) {
  const source = await assertExistingFileWithin(root, relativePath);
  const before = await lstat(source, { bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(maximumBytes)) {
    throw new Error(`Legacy v2 freeze input is empty or too large: ${relativePath}`);
  }
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) {
      throw new Error(`Legacy v2 freeze input changed while opening: ${relativePath}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
      || BigInt(bytes.length) !== opened.size) {
      throw new Error(`Legacy v2 freeze input changed while reading: ${relativePath}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseCanonicalManifest(bytes, schemaName, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Malformed ${label}`, { cause: error });
  }
  const validation = validateWith(schemaName, value);
  if (!validation.ok) throw new Error(`Invalid ${label}: ${JSON.stringify(validation.errors)}`);
  if (!bytes.equals(Buffer.from(canonicalJson(value)))) throw new Error(`${label} must use canonical JSON encoding`);
  return value;
}

export async function computeLegacyV2Freeze({ root = FORGE_ROOT } = {}) {
  const definitions = (await readAssetDefinitions({ root }))
    .filter(({ required }) => required === true)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (definitions.length !== 78 || new Set(definitions.map(({ id }) => id)).size !== 78) {
    throw new Error('Legacy v2 freeze requires exactly 78 distinct required definitions');
  }
  const [assetManifestBytes, approvalManifestBytes] = await Promise.all([
    readStableLegacyBytes(root, 'data/manifests/assets.json', 16 * 1024 * 1024),
    readStableLegacyBytes(root, 'data/manifests/approvals.json', 16 * 1024 * 1024)
  ]);
  const assetManifest = parseCanonicalManifest(
    assetManifestBytes, 'asset-manifest.schema.json', 'legacy asset manifest'
  );
  const approvalManifest = parseCanonicalManifest(
    approvalManifestBytes, 'approval-manifest.schema.json', 'legacy approval manifest'
  );
  const superseded = new Set((approvalManifest.supersessions ?? [])
    .map(({ supersededGenerationId }) => supersededGenerationId));
  const activeApprovals = approvalManifest.approvals.filter(({ generationId }) => !superseded.has(generationId));
  const assets = [];
  for (const definition of definitions) {
    const manifestEntries = assetManifest.assets.filter(({ assetId }) => assetId === definition.id);
    const approvals = activeApprovals.filter(({ assetId }) => assetId === definition.id);
    if (manifestEntries.length !== 1 || approvals.length !== 1) {
      throw new Error(`Legacy v2 freeze requires one manifest entry and one active approval: ${definition.id}`);
    }
    const entry = manifestEntries[0];
    const approval = approvals[0];
    if (!['approved', 'exported'].includes(entry.status) || entry.category !== definition.category
      || entry.approvedPath !== approval.approvedPath || approval.reviewer !== 'human'
      || approval.sourceSha256 !== approval.approvedSha256) {
      throw new Error(`Legacy v2 freeze approval topology is inconsistent: ${definition.id}`);
    }
    const metadataPath = approval.approvedPath.replace(/\.png$/, '.json');
    const [artifactBytes, metadataBytes] = await Promise.all([
      readStableLegacyBytes(root, approval.approvedPath),
      readStableLegacyBytes(root, metadataPath, 16 * 1024 * 1024)
    ]);
    const metadata = parseCanonicalManifest(
      metadataBytes, 'generation-result.schema.json', `legacy approved metadata for ${definition.id}`
    );
    const artifactSha256 = sha256(artifactBytes);
    if (artifactSha256 !== approval.approvedSha256 || metadata.assetId !== definition.id
      || metadata.id !== approval.generationId || metadata.status !== 'approved'
      || metadata.outputPath !== approval.approvedPath || metadata.outputSha256 !== artifactSha256
      || metadata.approval?.approvedSha256 !== artifactSha256
      || metadata.approval?.approvedPath !== approval.approvedPath) {
      throw new Error(`Legacy v2 frozen artifact or metadata contradicts approval: ${definition.id}`);
    }
    const inspection = inspectPng(artifactBytes);
    assets.push({
      assetId: definition.id,
      category: definition.category,
      definitionSha256: sha256(canonicalJson(definition)),
      assetManifestEntrySha256: sha256(canonicalJson(entry)),
      approvalRecordSha256: sha256(canonicalJson(approval)),
      approvedPath: approval.approvedPath,
      approvedArtifactSha256: artifactSha256,
      approvedArtifactBytes: artifactBytes.length,
      width: inspection.width,
      height: inspection.height,
      approvedMetadataPath: metadataPath,
      approvedMetadataSha256: sha256(canonicalJson(metadata))
    });
  }
  const unsigned = {
    schemaVersion: 3,
    contract: 'fable5-legacy-v2-freeze-v1',
    requiredAssetCount: 78,
    requiredAssetIdsSha256: sha256(canonicalJson(definitions.map(({ id }) => id))),
    assetManifestSha256: sha256(assetManifestBytes),
    approvalManifestSha256: sha256(approvalManifestBytes),
    assets
  };
  return { ...unsigned, freezeDigest: sha256(canonicalJson(unsigned)) };
}

export async function readLegacyV2Freeze({ root = FORGE_ROOT } = {}) {
  const bytes = await readStableLegacyBytes(root, LEGACY_FREEZE_RELATIVE, 16 * 1024 * 1024);
  const freeze = parseCanonicalManifest(bytes, 'legacy-v2-freeze-v3.schema.json', 'legacy v2 freeze');
  if (freeze.freezeDigest !== sha256(canonicalJson(withoutFreezeDigest(freeze)))) {
    throw new Error('Legacy v2 freeze digest mismatch');
  }
  const first = await computeLegacyV2Freeze({ root });
  const second = await computeLegacyV2Freeze({ root });
  if (!isDeepStrictEqual(first, second)) throw new Error('Legacy v2 freeze inputs changed during verification');
  if (!isDeepStrictEqual(freeze, second)) {
    throw new Error('Legacy v2 manifest, definition, approval metadata, or artifact bytes changed after freeze');
  }
  return freeze;
}

export async function readLegacyDisposition({ root = FORGE_ROOT } = {}) {
  const bytes = await readStableLegacyBytes(root, DISPOSITION_RELATIVE, 16 * 1024 * 1024);
  const disposition = parseCanonicalManifest(
    bytes, 'legacy-disposition-v3.schema.json', 'legacy disposition'
  );
  if (sha256(canonicalJson(withoutDigest(disposition))) !== disposition.dispositionDigest) {
    throw new Error('Legacy disposition digest mismatch');
  }

  const freeze = await readLegacyV2Freeze({ root });
  if (disposition.legacyFreezeDigest !== freeze.freezeDigest) {
    throw new Error('Legacy disposition is stale relative to the frozen v2 manifest and artifact bytes');
  }
  const legacyIds = freeze.assets.map(({ assetId }) => assetId);
  if (legacyIds.length !== 78
    || sha256(canonicalJson(legacyIds)) !== disposition.legacyRequiredSet.assetIdsSha256) {
    throw new Error('Legacy disposition is stale relative to the exact required 78 catalog');
  }
  const classified = [
    ...disposition.waveARemakes.map(({ legacyAssetId }) => legacyAssetId),
    ...disposition.waveBRemakes.map(({ legacyAssetId }) => legacyAssetId),
    ...disposition.retired
  ];
  if (classified.length !== 78 || new Set(classified).size !== 78
    || classified.sort().some((id, index) => id !== legacyIds[index])) {
    throw new Error('Legacy disposition must classify every required legacy asset exactly once');
  }

  const [definitions, requiredWaves] = await Promise.all([
    readWaveADefinitions({ root }),
    readRequiredWavesV2({ root })
  ]);
  const currentWaveAMap = definitions
    .filter(({ productionDecision }) => productionDecision.kind === 'remake')
    .map(({ id, productionDecision }) => ({
      legacyAssetId: productionDecision.legacyAssetId,
      successorAssetId: id
    }))
    .sort((left, right) => left.legacyAssetId.localeCompare(right.legacyAssetId));
  const declaredWaveA = [...disposition.waveARemakes]
    .sort((left, right) => left.legacyAssetId.localeCompare(right.legacyAssetId));
  if (canonicalJson(currentWaveAMap) !== canonicalJson(declaredWaveA)) {
    throw new Error('Legacy Wave A remake mapping is stale relative to current productionDecision fields');
  }
  const waveAIds = new Set(requiredWaves.waves.find(({ id }) => id === 'A')?.assetIds ?? []);
  const waveBIds = new Set(requiredWaves.waves.find(({ id }) => id === 'B')?.assetIds ?? []);
  const declaredWaveB = [...disposition.waveBRemakes]
    .sort((left, right) => left.legacyAssetId.localeCompare(right.legacyAssetId));
  const expectedWaveB = [...EXPECTED_WAVE_B_REMAKES]
    .sort((left, right) => left.legacyAssetId.localeCompare(right.legacyAssetId));
  if (canonicalJson(declaredWaveB) !== canonicalJson(expectedWaveB)) {
    throw new Error('Legacy Wave B remake mapping differs from the declared Fable5 migration');
  }
  if (disposition.waveARemakes.some(({ successorAssetId }) => !waveAIds.has(successorAssetId))
    || disposition.waveBRemakes.some(({ successorAssetId }) => !waveBIds.has(successorAssetId))) {
    throw new Error('Legacy remake successor is assigned to the wrong required wave');
  }
  const successorIds = [
    ...disposition.waveARemakes.map(({ successorAssetId }) => successorAssetId),
    ...disposition.waveBRemakes.map(({ successorAssetId }) => successorAssetId)
  ];
  if (successorIds.length !== 65 || new Set(successorIds).size !== 65) {
    throw new Error('Legacy remake successors must be unique across Wave A and Wave B');
  }
  return disposition;
}
