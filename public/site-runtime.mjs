export const FORGE_MANIFEST_URL = '/assets/forge/v3/manifest.json';
export const REQUIRED_SET_ID = 'fable5-v2';
export const WAVE_A_ASSET_COUNT = 109;
export const WAVE_A_ASSET_IDS = Object.freeze(`terrain.grass
terrain.snow
terrain.dirt
terrain.cobble
terrain.plaza
terrain.deck
terrain.water
terrain.cliff
terrain.road
overlay.flowers.a
overlay.flowers.b
overlay.flowers.c
overlay.pebbles.a
overlay.pebbles.b
overlay.pebbles.c
structure.bridge_stone
structure.bridge_wood
structure.stairs_stone
structure.fence
structure.wall_stone
structure.tree.a
structure.tree.b
structure.tree.c
structure.rock.a
structure.rock.b
structure.rock.c
structure.stone_lantern
structure.pier
structure.well
structure.barricade
structure.signpost_broken
structure.cycle_wellcurb
structure.ferry_shelter
structure.searoute_marker
structure.survey_plot
building.gate
building.town_hall
building.dojo
building.inn
building.warehouse
building.dock
building.guild
building.pub
building.shop
building.workshop
building.watchtower
building.ruin
building.house_s
building.house_m
building.house_old
building.hut
building.rowhouse_s
building.rowhouse_l
building.survey_tower
overlay.ivy.s
overlay.ivy.m
overlay.ivy.l
overlay.scaffold.s
overlay.scaffold.m
overlay.scaffold.l
overlay.snowcap.s
overlay.snowcap.m
overlay.snowcap.l
overlay.snowcap.xl
overlay.tarp
interior.floor_wood
interior.floor_stone
interior.wall_trim
prop.lamp
prop.streetlight
prop.signboard
prop.notice_board
prop.warning_stake
prop.barrel
prop.crate
prop.bench
prop.table
prop.chair
prop.counter
prop.shelf
prop.desk_ledger
prop.bed
prop.hearth
prop.training_dummy
prop.practice_target
prop.lantern_warning
character.player
character.town_clerk
character.gatekeeper
character.dojo_inspector
character.mob.townsfolk_male
character.mob.townsfolk_female
character.dojo_student
effect.water_ripple
effect.construction_dust
effect.window_glow
effect.discovery_glint
ui.dialogue_window
ui.choice_button
ui.speech_bubble
ui.journal_book
ui.evidence_panel
ui.facility_icons
ui.evidence_icons
ui.key_prompts
ui.touch_action
ui.cursor
ui.footstep
ui.town_crest`.split('\n').sort());

const PINNED_LEGACY = Object.freeze({
  recordSha256: 'caf19944245818a481659e757675e78907db543fd1aab82ca4947b068499e8c4',
  dispositionDigest: '5e03f0885b97ec9421ada3cbe52846aec91f2f85e2d928465798df902df4b92d',
  freezeDigest: '733142d2868070fb8c4d95382426f725090dea7aa29314672cfd847dbc18fa5f',
  assetIdsSha256: '1035cfc0c269a6c6f40f99655c030aaf5f91cb1de217aad0fed6bbf67cfb0065'
});
const PINNED_REFERENCE_AUTHORIZATION_SHA256 = '6f02d72f10711ecf50c9d525a7762431f2548252f8071d9035c425f1c8e32f14';

export const FORGE_RELEASE_TRUST = Object.freeze({
  ...PINNED_LEGACY,
  referenceAuthorizationSha256: PINNED_REFERENCE_AUTHORIZATION_SHA256,
  approvalDigest: null,
  planDigest: null,
  selectionDigest: null,
  evidenceCoverageDigest: null,
  cellAuditDigest: null,
  artifactSetDigest: null,
  assetBindingDigest: null
});

const SHA256 = /^[a-f0-9]{64}$/;
const BLOB_PATH = /^\/assets\/forge\/v3\/blobs\/[a-f0-9]{64}\.png$/;
const ASSET_ID = /^(character|building|terrain|overlay|structure|interior|prop|ui|effect)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;
const LEGACY_ASSET_ID = /^(building|character|field|object|effect)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;
const SUCCESSOR_ASSET_ID = /^(building|character|terrain|structure|prop|effect)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, expected, label, issues) {
  if (!isRecord(value)) {
    issues.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort(compareCodeUnits);
  const wanted = [...expected].sort(compareCodeUnits);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    issues.push(`${label} must contain exactly: ${wanted.join(', ')}`);
    return false;
  }
  return true;
}

function allowedKeys(value, allowed, label, issues) {
  if (!isRecord(value)) {
    issues.push(`${label} must be an object`);
    return false;
  }
  const allowedSet = new Set(allowed);
  const extras = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extras.length > 0) issues.push(`${label} contains unsupported fields: ${extras.join(', ')}`);
  return extras.length === 0;
}

const DEFINITION_KEYS = Object.freeze([
  'visualContractVersion', 'id', 'category', 'displayName', 'gameMeaning', 'required',
  'promptFiles', 'defaultReferenceIds', 'output', 'pixelArt', 'sprites', 'states',
  'characterSpriteContract', 'outputSize', 'placementSpace', 'perspective', 'lighting',
  'scaleClass', 'pivot', 'baseline', 'footprint', 'entrance', 'collision', 'occlusion',
  'roofMask', 'windowAnchors', 'inspectionGates', 'autotileContract', 'buildingLayerContract',
  'productionDecision', 'usage', 'palette', 'silhouette', 'variants', 'acceptance',
  'artDirection', 'priority', 'tags', 'constraints', 'reviewChecklist', 'gameBinding'
]);
const DEFINITION_CORE = Object.freeze([
  'id', 'category', 'displayName', 'gameMeaning', 'required', 'promptFiles',
  'defaultReferenceIds', 'output', 'pixelArt', 'tags', 'constraints', 'reviewChecklist', 'gameBinding'
]);
const DEFINITION_V2 = Object.freeze([
  'outputSize', 'placementSpace', 'perspective', 'lighting', 'scaleClass', 'pivot', 'baseline',
  'footprint', 'entrance', 'collision', 'occlusion', 'roofMask', 'windowAnchors',
  'inspectionGates', 'productionDecision', 'usage', 'palette', 'silhouette', 'variants',
  'acceptance', 'artDirection', 'priority'
]);

function nonemptyStrings(value, { minimum = 0, unique = false } = {}) {
  return Array.isArray(value) && value.length >= minimum
    && value.every((entry) => typeof entry === 'string' && entry.length > 0)
    && (!unique || new Set(value).size === value.length);
}

function validateAssetDefinition(definition, asset, issues) {
  const label = `${asset.assetId}.definition`;
  if (!allowedKeys(definition, DEFINITION_KEYS, label, issues)) return;
  for (const key of [...DEFINITION_CORE, ...DEFINITION_V2]) {
    if (!Object.hasOwn(definition, key)) issues.push(`${label}.${key} is required by visual contract v2`);
  }
  if (definition.visualContractVersion !== 2) issues.push(`${label}.visualContractVersion must be 2`);
  if (definition.id !== asset.assetId || definition.category !== asset.category) issues.push(`${label} identity mismatch`);
  if (typeof definition.displayName !== 'string' || !definition.displayName) issues.push(`${label}.displayName is required`);
  if (typeof definition.gameMeaning !== 'string' || !definition.gameMeaning) issues.push(`${label}.gameMeaning is required`);
  if (definition.required !== true) issues.push(`${label}.required must be true for Wave A`);
  if (!nonemptyStrings(definition.promptFiles, { minimum: 1, unique: true })
    || definition.promptFiles.some((entry) => !/^prompts\/[a-z0-9_/-]+\.md$/.test(entry))) {
    issues.push(`${label}.promptFiles is invalid`);
  }
  if (!nonemptyStrings(definition.defaultReferenceIds, { unique: true })) issues.push(`${label}.defaultReferenceIds is invalid`);
  exactKeys(definition.output, ['kind', 'preferredFormat', 'background', 'needsTransparency', 'needsTrim'], `${label}.output`, issues);
  if (definition.output?.preferredFormat !== 'png' || definition.output?.background !== 'transparent'
    || definition.output?.needsTransparency !== true || definition.output?.needsTrim !== false) {
    issues.push(`${label}.output must use the transparent PNG Wave A contract`);
  }
  allowedKeys(definition.pixelArt, ['logicalSpriteSize', 'tileSize', 'scalePreview', 'nearestNeighbor', 'allowAntiAlias'], `${label}.pixelArt`, issues);
  if (definition.pixelArt?.nearestNeighbor !== true || definition.pixelArt?.allowAntiAlias !== false) {
    issues.push(`${label}.pixelArt must use hard nearest-neighbor pixels`);
  }
  if (!positiveInteger(definition.outputSize?.width) || !positiveInteger(definition.outputSize?.height)) issues.push(`${label}.outputSize is invalid`);
  if (definition.perspective !== 'three-quarter-overhead' || definition.lighting !== 'upper-left-twilight') {
    issues.push(`${label} projection or lighting contract is invalid`);
  }
  if (!isRecord(definition.placementSpace) || !isRecord(definition.pivot)
    || !isRecord(definition.baseline) || !isRecord(definition.footprint)
    || !isRecord(definition.collision) || !isRecord(definition.occlusion)
    || !isRecord(definition.inspectionGates) || !isRecord(definition.productionDecision)
    || !isRecord(definition.usage) || !isRecord(definition.palette)
    || !isRecord(definition.acceptance) || !isRecord(definition.artDirection)
    || !isRecord(definition.gameBinding)) issues.push(`${label} is missing a required structured v2 contract`);
  if (!Array.isArray(definition.windowAnchors) || !nonemptyStrings(definition.variants, { minimum: 1, unique: true })
    || !nonemptyStrings(definition.tags, { unique: true })
    || !nonemptyStrings(definition.reviewChecklist, { minimum: 1 })) issues.push(`${label} list contracts are invalid`);
  exactKeys(definition.constraints, ['must', 'mustNot'], `${label}.constraints`, issues);
  if (!Array.isArray(definition.constraints?.must) || !Array.isArray(definition.constraints?.mustNot)) issues.push(`${label}.constraints is invalid`);
  exactKeys(definition.priority, ['requiredSetId', 'wave'], `${label}.priority`, issues);
  if (definition.priority?.requiredSetId !== REQUIRED_SET_ID || definition.priority?.wave !== 'A') issues.push(`${label}.priority is not Wave A`);
  if (asset.category === 'building') {
    const roles = definition.buildingLayerContract?.artifacts?.map(({ role }) => role);
    if (definition.output?.kind !== 'layered-building' || roles?.length !== 2 || roles[0] !== 'base' || roles[1] !== 'roof') {
      issues.push(`${label} must contain the atomic base + roof definition contract`);
    }
  }
  if (asset.category === 'character' && definition.characterSpriteContract?.version !== 2) {
    issues.push(`${label} must contain characterSpriteContract v2`);
  }
}

function hasExactValues(value, expected) {
  return Object.entries(expected).every(([key, candidate]) => value?.[key] === candidate);
}

function canonicalJson(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort(compareCodeUnits).map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new TypeError('SHA-256 input must be bytes or text');
}

export async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new ForgeAssetError('SHA-256 verification is unavailable; play has been stopped.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', asBytes(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function dimensionsFor(asset, role) {
  if (asset.category === 'building') {
    const layer = asset.definition?.buildingLayerContract?.artifacts?.find((entry) => entry.role === role);
    if (positiveInteger(layer?.outputSize?.width) && positiveInteger(layer?.outputSize?.height)) return layer.outputSize;
  }
  return asset.definition?.outputSize ?? null;
}

export class ForgeAssetError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'ForgeAssetError';
    this.issues = Object.freeze([...issues]);
  }
}

export function validateForgeManifest(manifest, { requiredAssetIds = [] } = {}) {
  const issues = [];
  if (!isRecord(manifest)) return { ok: false, issues: ['manifest must be an object'] };
  exactKeys(manifest, [
    'schemaVersion', 'scope', 'requiredSet', 'completeForDeclaredWaves', 'fullFable5SetComplete',
    'bundleSetDigest', 'waveAApprovalEvidence', 'legacyMigration', 'assets'
  ], 'manifest', issues);
  if (manifest.schemaVersion !== 3) issues.push('asset manifest schemaVersion must be 3');
  if (manifest.scope !== 'wave-a-only-not-full-fable5-set') issues.push('asset manifest must be the Wave A-only scope');
  if (manifest.completeForDeclaredWaves !== true) issues.push('asset manifest is not complete for its declared waves');
  if (manifest.fullFable5SetComplete !== false) issues.push('Wave A export must not claim the full Fable5 set');
  if (!SHA256.test(manifest.bundleSetDigest ?? '')) issues.push('asset manifest has no valid bundle set digest');
  exactKeys(manifest.requiredSet, ['id', 'waveIds', 'assetCount', 'minimumOutputPngCount'], 'requiredSet', issues);
  if (!isRecord(manifest.requiredSet) || manifest.requiredSet.id !== REQUIRED_SET_ID) {
    issues.push(`requiredSet.id must be ${REQUIRED_SET_ID}`);
  }
  if (!Array.isArray(manifest.requiredSet?.waveIds)
    || manifest.requiredSet.waveIds.length !== 1
    || manifest.requiredSet.waveIds[0] !== 'A') {
    issues.push('requiredSet.waveIds must be exactly ["A"]');
  }
  if (manifest.requiredSet?.assetCount !== WAVE_A_ASSET_COUNT) {
    issues.push(`requiredSet.assetCount must be exactly ${WAVE_A_ASSET_COUNT}`);
  }
  if (manifest.requiredSet?.minimumOutputPngCount !== 128) issues.push('requiredSet.minimumOutputPngCount must be exactly 128');
  if (!Array.isArray(manifest.assets)) {
    issues.push('manifest.assets must be an array');
    return { ok: false, issues };
  }
  if (manifest.assets.length !== WAVE_A_ASSET_COUNT) issues.push(`manifest.assets must contain exactly ${WAVE_A_ASSET_COUNT} assets`);

  const evidenceKeys = [
    'approvalDigest', 'planDigest', 'selectionDigest', 'legacyDispositionDigest',
    'referenceAuthorizationSha256', 'evidenceCoverageDigest', 'cellAuditDigest', 'artifactSetDigest',
    'requiredAssetCount', 'outputPngCount', 'declaredLogicalSlotCount', 'semanticCellCount',
    'expectedNonemptySemanticCellCount', 'expectedTransparentSemanticCellCount', 'reservedTransparentCellCount'
  ];
  exactKeys(manifest.waveAApprovalEvidence, evidenceKeys, 'waveAApprovalEvidence', issues);
  const evidence = manifest.waveAApprovalEvidence;
  for (const key of evidenceKeys.slice(0, 8)) {
    if (!SHA256.test(evidence?.[key] ?? '')) issues.push(`waveAApprovalEvidence.${key} must be a SHA-256 digest`);
  }
  if (evidence?.referenceAuthorizationSha256 !== PINNED_REFERENCE_AUTHORIZATION_SHA256) {
    issues.push('Wave A reference authorization does not match the reviewed release authorization');
  }
  if (!hasExactValues(evidence, {
    requiredAssetCount: 109,
    outputPngCount: 128,
    declaredLogicalSlotCount: 771,
    semanticCellCount: 708,
    expectedNonemptySemanticCellCount: 696,
    expectedTransparentSemanticCellCount: 12,
    reservedTransparentCellCount: 63
  })) {
    issues.push('Wave A approval counts do not match the approved 109-asset/128-PNG/771-slot contract');
  }

  exactKeys(manifest.legacyMigration, ['recordSha256', 'record'], 'legacyMigration', issues);
  if (!SHA256.test(manifest.legacyMigration?.recordSha256 ?? '')) issues.push('legacyMigration.recordSha256 must be a SHA-256 digest');
  if (manifest.legacyMigration?.recordSha256 !== PINNED_LEGACY.recordSha256) {
    issues.push('legacyMigration.recordSha256 does not match the frozen legacy release contract');
  }
  const migration = manifest.legacyMigration?.record;
  exactKeys(migration, [
    'schemaVersion', 'contract', 'legacyRequiredSet', 'legacyFreezeDigest', 'counts',
    'waveARemakes', 'waveBRemakes', 'retired', 'dispositionDigest'
  ], 'legacyMigration.record', issues);
  if (migration?.schemaVersion !== 1 || migration?.contract !== 'fable5-legacy-disposition-v1') {
    issues.push('legacy migration contract must be fable5-legacy-disposition-v1 schema 1');
  }
  exactKeys(migration?.legacyRequiredSet, ['id', 'assetCount', 'assetIdsSha256'], 'legacyRequiredSet', issues);
  if (!hasExactValues(migration?.legacyRequiredSet, { id: 'legacy-approved-78', assetCount: 78 })
    || !SHA256.test(migration?.legacyRequiredSet?.assetIdsSha256 ?? '')) {
    issues.push('legacyRequiredSet must bind the frozen approved 78 assets');
  }
  if (migration?.legacyRequiredSet?.assetIdsSha256 !== PINNED_LEGACY.assetIdsSha256) {
    issues.push('legacyRequiredSet asset IDs differ from the frozen legacy catalog');
  }
  exactKeys(migration?.counts, ['keep', 'remake', 'retire', 'waveARemake', 'waveBRemake'], 'legacy counts', issues);
  if (!hasExactValues(migration?.counts, { keep: 0, remake: 65, retire: 13, waveARemake: 45, waveBRemake: 20 })) {
    issues.push('legacy disposition counts do not match the frozen 0/65/13 migration');
  }
  if (!SHA256.test(migration?.legacyFreezeDigest ?? '') || !SHA256.test(migration?.dispositionDigest ?? '')) {
    issues.push('legacy migration digests are missing');
  }
  if (migration?.legacyFreezeDigest !== PINNED_LEGACY.freezeDigest
    || migration?.dispositionDigest !== PINNED_LEGACY.dispositionDigest
    || evidence?.legacyDispositionDigest !== PINNED_LEGACY.dispositionDigest) {
    issues.push('legacy migration does not match the pinned freeze and disposition');
  }
  const waveARemakes = Array.isArray(migration?.waveARemakes) ? migration.waveARemakes : [];
  const waveBRemakes = Array.isArray(migration?.waveBRemakes) ? migration.waveBRemakes : [];
  const retired = Array.isArray(migration?.retired) ? migration.retired : [];
  for (const [key, count, entries] of [['waveARemakes', 45, waveARemakes], ['waveBRemakes', 20, waveBRemakes]]) {
    if (entries.length !== count) issues.push(`${key} must contain exactly ${count} entries`);
    for (const [index, entry] of entries.entries()) {
      exactKeys(entry, ['legacyAssetId', 'successorAssetId'], `${key}[${index}]`, issues);
      if (!LEGACY_ASSET_ID.test(entry?.legacyAssetId ?? '') || !SUCCESSOR_ASSET_ID.test(entry?.successorAssetId ?? '')) {
        issues.push(`${key}[${index}] is invalid`);
      }
    }
  }
  const legacyDispositionIds = [
    ...waveARemakes.map((entry) => entry?.legacyAssetId),
    ...waveBRemakes.map((entry) => entry?.legacyAssetId),
    ...retired
  ];
  if (retired.length !== 13
    || retired.some((assetId) => !LEGACY_ASSET_ID.test(assetId ?? ''))
    || new Set(legacyDispositionIds).size !== 78) {
    issues.push('legacy retired assets must contain exactly 13 unique IDs');
  }
  for (const entry of waveARemakes) {
    if (!WAVE_A_ASSET_IDS.includes(entry.successorAssetId)) issues.push(`Wave A legacy successor is not in Wave A: ${entry.successorAssetId}`);
  }

  const assetIds = new Set();
  const auditTotals = {
    declaredLogicalSlotCount: 0,
    semanticCellCount: 0,
    expectedNonemptySemanticCellCount: 0,
    expectedTransparentSemanticCellCount: 0,
    reservedTransparentCellCount: 0
  };
  let outputPngCount = 0;
  const artifactPaths = new Set();
  const artifactHashes = new Set();
  for (const [assetIndex, asset] of manifest.assets.entries()) {
    exactKeys(asset, [
      'assetId', 'category', 'definitionSha256', 'bundleDigest', 'generationRecordDigest',
      'definition', 'cellAudit', 'artifacts'
    ], `assets[${assetIndex}]`, issues);
    if (!isRecord(asset) || typeof asset.assetId !== 'string' || !ASSET_ID.test(asset.assetId)) {
      issues.push('every manifest asset needs a valid Fable5 assetId');
      continue;
    }
    if (asset.assetId !== WAVE_A_ASSET_IDS[assetIndex]) {
      issues.push(`assets[${assetIndex}] must be ${WAVE_A_ASSET_IDS[assetIndex]}`);
    }
    if (assetIds.has(asset.assetId)) issues.push(`duplicate assetId: ${asset.assetId}`);
    assetIds.add(asset.assetId);
    const category = asset.assetId.split('.')[0];
    if (asset.category !== category || asset.definition?.category !== category) issues.push(`${asset.assetId} has a mismatched category`);
    if (!SHA256.test(asset.definitionSha256 ?? '')) issues.push(`${asset.assetId} has an invalid definition digest`);
    if (!SHA256.test(asset.bundleDigest ?? '')) issues.push(`${asset.assetId} has an invalid approval bundle digest`);
    if (!SHA256.test(asset.generationRecordDigest ?? '')) issues.push(`${asset.assetId} has an invalid generation record digest`);
    if (!isRecord(asset.definition) || asset.definition.id !== asset.assetId) issues.push(`${asset.assetId} has a mismatched definition`);
    if (isRecord(asset.definition)) validateAssetDefinition(asset.definition, asset, issues);
    exactKeys(asset.cellAudit, [
      'declaredLogicalSlotCount', 'semanticCellCount', 'expectedNonemptySemanticCellCount',
      'expectedTransparentSemanticCellCount', 'reservedTransparentCellCount', 'cellAuditDigest'
    ], `${asset.assetId}.cellAudit`, issues);
    const audit = asset.cellAudit;
    if (!SHA256.test(audit?.cellAuditDigest ?? '')) issues.push(`${asset.assetId} has an invalid cell audit digest`);
    for (const key of Object.keys(auditTotals)) {
      const maximum = key === 'expectedTransparentSemanticCellCount' || key === 'reservedTransparentCellCount' ? 16 : 80;
      if (!Number.isInteger(audit?.[key]) || audit[key] < 0 || audit[key] > maximum) {
        issues.push(`${asset.assetId}.cellAudit.${key} must be an integer from 0 to ${maximum}`);
      }
      else auditTotals[key] += audit[key];
    }
    if (audit?.declaredLogicalSlotCount !== audit?.semanticCellCount + audit?.reservedTransparentCellCount
      || audit?.semanticCellCount !== audit?.expectedNonemptySemanticCellCount + audit?.expectedTransparentSemanticCellCount
      || !(audit?.semanticCellCount > 0)) {
      issues.push(`${asset.assetId} has inconsistent cell audit counts`);
    }
    const expectedRoles = asset.category === 'building' ? ['base', 'roof'] : ['primary'];
    const roles = Array.isArray(asset.artifacts) ? asset.artifacts.map((artifact) => artifact?.role) : [];
    if (roles.length !== expectedRoles.length || roles.some((role, index) => role !== expectedRoles[index])) {
      issues.push(`${asset.assetId} must declare ${expectedRoles.join(' + ')} artifacts in order`);
      continue;
    }
    for (const artifact of asset.artifacts) {
      exactKeys(artifact, ['role', 'sha256', 'publicPath'], `${asset.assetId}:${artifact?.role ?? 'unknown'}`, issues);
      if (!SHA256.test(artifact.sha256 ?? '')) issues.push(`${asset.assetId}:${artifact.role} has an invalid digest`);
      if (!BLOB_PATH.test(artifact.publicPath ?? '')) issues.push(`${asset.assetId}:${artifact.role} has an unsafe public path`);
      if (artifact.publicPath !== `/assets/forge/v3/blobs/${artifact.sha256}.png`) {
        issues.push(`${asset.assetId}:${artifact.role} path does not match its content digest`);
      }
      if (artifactPaths.has(artifact.publicPath)) issues.push(`duplicate artifact path: ${artifact.publicPath}`);
      if (artifactHashes.has(artifact.sha256)) issues.push(`duplicate artifact SHA-256: ${artifact.sha256}`);
      artifactPaths.add(artifact.publicPath);
      artifactHashes.add(artifact.sha256);
      const expectedSize = dimensionsFor(asset, artifact.role);
      if (!positiveInteger(expectedSize?.width) || !positiveInteger(expectedSize?.height)) {
        issues.push(`${asset.assetId}:${artifact.role} has no approved output dimensions`);
      }
    }
    if (asset.category === 'building' && asset.artifacts?.[0]?.sha256 === asset.artifacts?.[1]?.sha256) {
      issues.push(`${asset.assetId} base and roof must be distinct approved PNGs`);
    }
    outputPngCount += asset.artifacts?.length ?? 0;
  }
  if (outputPngCount !== 128 || artifactPaths.size !== 128 || artifactHashes.size !== 128) {
    issues.push('manifest must declare exactly 128 globally unique approved PNG paths and hashes');
  }
  for (const key of Object.keys(auditTotals)) {
    if (auditTotals[key] !== evidence?.[key]) issues.push(`cell audit total ${key} does not match Wave A evidence`);
  }
  for (const assetId of new Set(requiredAssetIds)) {
    if (!assetIds.has(assetId)) issues.push(`WorldPlan requires missing approved asset: ${assetId}`);
  }
  return { ok: issues.length === 0, issues, assetIds };
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
}

export async function createForgeTrustPolicy({
  approval,
  planCore,
  selection,
  referenceAuthorization,
  legacyMigration,
  bundleApprovals
}) {
  const issues = [];
  if (![approval, planCore, selection, referenceAuthorization, legacyMigration].every(isRecord)
    || !Array.isArray(bundleApprovals)) {
    throw new ForgeAssetError('Release trust records are incomplete.');
  }
  const selectionDigest = await sha256Hex(canonicalJson(withoutKey(selection, 'selectionDigest')));
  const planDigest = await sha256Hex(canonicalJson(planCore));
  const referenceAuthorizationSha256 = await sha256Hex(canonicalJson(referenceAuthorization));
  const evidenceCoverageDigest = await sha256Hex(canonicalJson({
    contract: 'fable5-wave-a-evidence-coverage-v3',
    assets: (approval.assets ?? []).map(({ assetId, visualEvidenceDigest }) => ({ assetId, visualEvidenceDigest }))
  }));
  const cellAuditDigest = await sha256Hex(canonicalJson({
    contract: 'fable5-wave-a-cell-audit-set-v3',
    assets: (approval.assets ?? []).map(({ assetId, cellAudit }) => ({ assetId, cellAudit }))
  }));
  const artifactSetDigest = await sha256Hex(canonicalJson({
    contract: 'fable5-wave-a-artifact-set-v3',
    assets: (approval.assets ?? []).map(({ assetId, artifacts }) => ({ assetId, artifacts }))
  }));
  const approvalDigest = await sha256Hex(canonicalJson(withoutKey(approval, 'approvalDigest')));
  const recordSha256 = await sha256Hex(canonicalJson(legacyMigration));
  const dispositionDigest = await sha256Hex(canonicalJson(withoutKey(legacyMigration, 'dispositionDigest')));

  const selectedIds = (selection.assets ?? []).map(({ assetId }) => assetId);
  const planIds = (planCore.assets ?? []).map(({ assetId }) => assetId);
  const approvalIds = (approval.assets ?? []).map(({ assetId }) => assetId);
  const hasCanonicalWaveAOrder = (assetIds) => assetIds.length === WAVE_A_ASSET_COUNT
    && assetIds.every((assetId, index) => assetId === WAVE_A_ASSET_IDS[index]);
  if (![selectedIds, planIds, approvalIds].every(hasCanonicalWaveAOrder)) {
    issues.push('selection, plan, and approval must share the exact canonical 109 asset set and release order');
  }
  const exactCounts = {
    requiredAssetCount: 109,
    outputPngCount: 128,
    declaredLogicalSlotCount: 771,
    semanticCellCount: 708,
    expectedNonemptySemanticCellCount: 696,
    expectedTransparentSemanticCellCount: 12,
    reservedTransparentCellCount: 63
  };
  for (const [label, record] of [['selection', selection], ['plan', planCore], ['approval', approval]]) {
    if (!hasExactValues(record, exactCounts)) issues.push(`${label} does not match the exact Wave A counts`);
  }
  const bundleByAsset = new Map(bundleApprovals.map((bundle) => [bundle?.assetId, bundle]));
  if (bundleApprovals.length !== WAVE_A_ASSET_COUNT || bundleByAsset.size !== WAVE_A_ASSET_COUNT) {
    issues.push('bundle approvals must contain exactly one record for each Wave A asset');
  }
  const blueprintById = new Map((selection.sceneBlueprints ?? []).map((blueprint) => [blueprint.id, blueprint]));
  const bindingAssets = [];
  const approvedPaths = new Set();
  const artifactHashes = new Set();
  const generationIds = new Set();
  for (let index = 0; index < WAVE_A_ASSET_COUNT; index += 1) {
    const selected = selection.assets?.[index];
    const planned = planCore.assets?.[index];
    const approved = approval.assets?.[index];
    if (![selected, planned, approved].every(isRecord)) continue;
    const bundle = bundleByAsset.get(approved.assetId);
    const selectedArtifacts = selected.artifacts ?? [];
    const plannedArtifacts = planned.sourceArtifacts ?? [];
    const approvedArtifacts = approved.artifacts ?? [];
    const expectedRoles = approved.assetId.startsWith('building.') ? ['base', 'roof'] : ['primary'];
    if (selected.generationId !== planned.pendingGenerationId
      || selected.generationId !== approved.pendingGenerationId
      || selected.pendingGenerationRecordDigest !== planned.pendingGenerationRecordDigest
      || selected.pendingGenerationRecordDigest !== approved.pendingGenerationRecordDigest
      || selected.definitionSha256 !== planned.definitionSha256
      || selected.definitionSha256 !== approved.definitionSha256) {
      issues.push(`${approved.assetId} selection, plan, and approval identities do not match`);
    }
    if (generationIds.has(selected.generationId)) issues.push(`${approved.assetId} reuses a generation id`);
    generationIds.add(selected.generationId);
    if (selectedArtifacts.length !== expectedRoles.length
      || selectedArtifacts.some((artifact, artifactIndex) => artifact.role !== expectedRoles[artifactIndex])
      || plannedArtifacts.length !== selectedArtifacts.length
      || plannedArtifacts.some((artifact, artifactIndex) => canonicalJson(artifact) !== canonicalJson(selectedArtifacts[artifactIndex]))
      || approvedArtifacts.length !== selectedArtifacts.length
      || approvedArtifacts.some((artifact, artifactIndex) => artifact.role !== selectedArtifacts[artifactIndex].role
        || artifact.sha256 !== selectedArtifacts[artifactIndex].sha256)) {
      issues.push(`${approved.assetId} artifact membership differs across selection, plan, and approval`);
    }
    const visualBlueprints = (selected.visualReview?.ensemble ?? []).map(({ blueprintId }) => blueprintById.get(blueprintId));
    if (visualBlueprints.some((blueprint) => !blueprint)) {
      issues.push(`${approved.assetId} visual review points to a missing scene blueprint`);
    } else {
      const visualEvidenceDigest = await sha256Hex(canonicalJson({
        visualReview: selected.visualReview,
        sceneBlueprints: visualBlueprints
      }));
      if (planned.visualEvidenceDigest !== visualEvidenceDigest || approved.visualEvidenceDigest !== visualEvidenceDigest) {
        issues.push(`${approved.assetId} visual evidence digest is not bound to selection blueprints`);
      }
    }
    const calculatedCellAuditDigest = await sha256Hex(canonicalJson({
      contract: 'fable5-cell-audit-v3',
      ...withoutKey(approved.cellAudit ?? {}, 'cellAuditDigest')
    }));
    if (approved.cellAudit?.cellAuditDigest !== calculatedCellAuditDigest
      || canonicalJson(planned.cellAudit) !== canonicalJson(approved.cellAudit)) {
      issues.push(`${approved.assetId} cell audit is not canonical across plan and approval`);
    }
    if (!isRecord(bundle)) {
      issues.push(`${approved.assetId} has no matching bundle approval`);
    } else {
      const canonicalBundle = {
        contract: 'fable5-asset-bundle-v3',
        assetId: bundle.assetId,
        category: bundle.category,
        definitionSha256: bundle.definitionSha256,
        generationRecordDigest: bundle.generationRecordDigest,
        artifacts: bundle.artifacts
      };
      const calculatedBundleDigest = await sha256Hex(canonicalJson(canonicalBundle));
      const strippedBundleArtifacts = (bundle.artifacts ?? []).map(({ role, approvedPath, sha256 }) => ({ role, approvedPath, sha256 }));
      if (bundle.bundleDigest !== calculatedBundleDigest || approved.bundleDigest !== calculatedBundleDigest
        || bundle.definitionSha256 !== approved.definitionSha256
        || bundle.generationRecordDigest !== approved.pendingGenerationRecordDigest
        || bundle.reviewer !== approval.reviewer || bundle.note !== approval.note || bundle.approvedAt !== approval.approvedAt
        || canonicalJson(strippedBundleArtifacts) !== canonicalJson(approvedArtifacts)
        || (bundle.artifacts ?? []).some((artifact) => artifact.generationId !== approved.pendingGenerationId)) {
        issues.push(`${approved.assetId} does not match its canonical bundle approval`);
      }
    }
    for (const artifact of approvedArtifacts) {
      if (approvedPaths.has(artifact.approvedPath) || artifactHashes.has(artifact.sha256)) {
        issues.push(`${approved.assetId} reuses an approved artifact path or hash`);
      }
      approvedPaths.add(artifact.approvedPath);
      artifactHashes.add(artifact.sha256);
      if (!artifact.approvedPath?.startsWith(`${approval.bundleDirectory}/`)) {
        issues.push(`${approved.assetId} artifact escapes the approved bundle directory`);
      }
    }
    bindingAssets.push({
      assetId: approved.assetId,
      definitionSha256: approved.definitionSha256,
      bundleDigest: approved.bundleDigest,
      generationRecordDigest: approved.pendingGenerationRecordDigest,
      cellAuditDigest: approved.cellAudit?.cellAuditDigest,
      artifacts: approvedArtifacts.map(({ role, sha256 }) => ({ role, sha256 }))
    });
  }
  if (approvedPaths.size !== 128 || artifactHashes.size !== 128) {
    issues.push('approval must bind exactly 128 globally unique artifact paths and hashes');
  }
  const assetBindingDigest = await sha256Hex(canonicalJson({
    contract: 'fable5-game-export-asset-bindings-v3',
    assets: bindingAssets.sort((left, right) => compareCodeUnits(left.assetId, right.assetId))
  }));

  const expectedApproval = {
    approvalDigest,
    planDigest,
    selectionDigest,
    referenceAuthorizationSha256,
    evidenceCoverageDigest,
    cellAuditDigest,
    artifactSetDigest,
    legacyDispositionDigest: legacyMigration.dispositionDigest
  };
  for (const [key, expectedValue] of Object.entries(expectedApproval)) {
    if (approval[key] !== expectedValue) issues.push(`approval.${key} does not match its canonical release record`);
  }
  if (selection.selectionDigest !== selectionDigest) issues.push('selection.selectionDigest mismatch');
  if (selection.legacyDispositionDigest !== legacyMigration.dispositionDigest) issues.push('selection is not bound to the legacy disposition');
  if (planCore.selectionDigest !== selectionDigest
    || planCore.legacyDispositionDigest !== legacyMigration.dispositionDigest
    || planCore.referenceAuthorizationSha256 !== referenceAuthorizationSha256) {
    issues.push('approval plan is not bound to selection, legacy, and reference authorization');
  }
  if (approval.bundleDirectory !== `generated/v3/wave-bundles/${planDigest}`) issues.push('approval bundleDirectory does not match planDigest');
  if (recordSha256 !== PINNED_LEGACY.recordSha256
    || dispositionDigest !== PINNED_LEGACY.dispositionDigest
    || legacyMigration.legacyFreezeDigest !== PINNED_LEGACY.freezeDigest
    || legacyMigration.legacyRequiredSet?.assetIdsSha256 !== PINNED_LEGACY.assetIdsSha256) {
    issues.push('legacy trust record differs from the pinned release contract');
  }
  if (referenceAuthorizationSha256 !== PINNED_REFERENCE_AUTHORIZATION_SHA256) {
    issues.push('reference authorization differs from the reviewed release record');
  }
  if (issues.length > 0) throw new ForgeAssetError('Release trust records could not be verified.', issues);
  return Object.freeze({
    ...PINNED_LEGACY,
    approvalDigest,
    planDigest,
    selectionDigest,
    referenceAuthorizationSha256,
    evidenceCoverageDigest,
    cellAuditDigest,
    artifactSetDigest,
    assetBindingDigest
  });
}

export async function verifyForgeManifestDigests(manifest, { trustPolicy = FORGE_RELEASE_TRUST } = {}) {
  const validation = validateForgeManifest(manifest);
  if (!validation.ok) throw new ForgeAssetError('Approved Fable5 assets are incomplete; play has been stopped.', validation.issues);

  const issues = [];
  const expected = async (actual, content, label) => {
    const calculated = await sha256Hex(canonicalJson(content));
    if (actual !== calculated) issues.push(`${label} does not match its canonical content`);
  };
  const migration = manifest.legacyMigration.record;
  await expected(manifest.legacyMigration.recordSha256, migration, 'legacyMigration.recordSha256');
  await expected(migration.dispositionDigest, withoutKey(migration, 'dispositionDigest'), 'legacy dispositionDigest');
  if (manifest.waveAApprovalEvidence.legacyDispositionDigest !== migration.dispositionDigest) {
    issues.push('Wave A approval is not bound to the frozen legacy disposition');
  }
  for (const asset of manifest.assets) {
    await expected(asset.definitionSha256, asset.definition, `${asset.assetId}.definitionSha256`);
  }
  for (const [policyKey, evidenceKey = policyKey] of [
    ['approvalDigest'], ['planDigest'], ['selectionDigest'], ['referenceAuthorizationSha256'],
    ['evidenceCoverageDigest'], ['cellAuditDigest'], ['artifactSetDigest']
  ]) {
    if (!SHA256.test(trustPolicy?.[policyKey] ?? '')) issues.push(`release trust is not pinned for ${policyKey}`);
    else if (manifest.waveAApprovalEvidence[evidenceKey] !== trustPolicy[policyKey]) {
      issues.push(`waveAApprovalEvidence.${evidenceKey} differs from the pinned release trust`);
    }
  }
  const assetBindingDigest = await sha256Hex(canonicalJson({
    contract: 'fable5-game-export-asset-bindings-v3',
    assets: manifest.assets.map((asset) => ({
      assetId: asset.assetId,
      definitionSha256: asset.definitionSha256,
      bundleDigest: asset.bundleDigest,
      generationRecordDigest: asset.generationRecordDigest,
      cellAuditDigest: asset.cellAudit.cellAuditDigest,
      artifacts: asset.artifacts.map(({ role, sha256 }) => ({ role, sha256 }))
    }))
  }));
  if (!SHA256.test(trustPolicy?.assetBindingDigest ?? '')) issues.push('release trust is not pinned for assetBindingDigest');
  else if (assetBindingDigest !== trustPolicy.assetBindingDigest) issues.push('game export asset bindings differ from the pinned release trust');
  if (trustPolicy?.recordSha256 !== PINNED_LEGACY.recordSha256
    || trustPolicy?.dispositionDigest !== PINNED_LEGACY.dispositionDigest
    || trustPolicy?.freezeDigest !== PINNED_LEGACY.freezeDigest
    || trustPolicy?.assetIdsSha256 !== PINNED_LEGACY.assetIdsSha256) {
    issues.push('release trust does not pin the exact legacy migration');
  }
  await expected(manifest.bundleSetDigest, {
    contract: 'fable5-required-bundle-set-v3',
    requiredSetId: REQUIRED_SET_ID,
    waveIds: ['A'],
    waveAApprovalDigest: manifest.waveAApprovalEvidence.approvalDigest,
    legacyDispositionDigest: migration.dispositionDigest,
    bundles: manifest.assets.map(({ assetId, bundleDigest, generationRecordDigest }) => ({
      assetId, bundleDigest, generationRecordDigest
    }))
  }, 'bundleSetDigest');
  if (issues.length > 0) throw new ForgeAssetError('Approved Fable5 release trust could not be verified; play has been stopped.', issues);
  return manifest;
}

function addAssetId(set, candidate, location) {
  const assetId = typeof candidate === 'string' ? candidate : (isRecord(candidate) ? candidate.assetId : null);
  if (assetId === null || assetId === undefined) return;
  if (typeof assetId !== 'string' || !ASSET_ID.test(assetId)) {
    throw new ForgeAssetError(`WorldPlan contains an invalid asset binding at ${location}.`);
  }
  set.add(assetId);
}

export function collectWorldPlanAssetIds(plan) {
  const assetIds = new Set(['character.player']);
  for (const [index, cell] of (plan?.terrain ?? []).entries()) addAssetId(assetIds, cell?.assetId, `terrain[${index}]`);
  for (const [index, building] of (plan?.buildings ?? []).entries()) {
    addAssetId(assetIds, building?.assetId, `buildings[${index}]`);
    for (const [overlayIndex, overlay] of (building?.overlays ?? []).entries()) {
      addAssetId(assetIds, overlay, `buildings[${index}].overlays[${overlayIndex}]`);
    }
  }
  for (const [index, npc] of (plan?.npcs ?? []).entries()) addAssetId(assetIds, npc?.assetId, `npcs[${index}]`);
  for (const [index, prop] of (plan?.props ?? []).entries()) addAssetId(assetIds, prop?.assetId, `props[${index}]`);
  for (const [index, light] of (plan?.lights ?? []).entries()) addAssetId(assetIds, light?.assetId, `lights[${index}]`);
  return [...assetIds].sort();
}

export function createAssetResolver(manifest, imageByKey = new Map()) {
  const validation = validateForgeManifest(manifest);
  if (!validation.ok) throw new ForgeAssetError('Approved Fable5 assets cannot be used.', validation.issues);
  const assetById = new Map(manifest.assets.map((asset) => [asset.assetId, asset]));
  return Object.freeze({
    manifest,
    assetById,
    imageByKey,
    asset(assetId) {
      return assetById.get(assetId) ?? null;
    },
    definition(assetId) {
      return assetById.get(assetId)?.definition ?? null;
    },
    artifact(assetId, role) {
      const asset = assetById.get(assetId);
      const effectiveRole = role ?? (asset?.category === 'building' ? 'base' : 'primary');
      return asset?.artifacts.find((artifact) => artifact.role === effectiveRole) ?? null;
    },
    image(assetId, role) {
      const asset = assetById.get(assetId);
      const effectiveRole = role ?? (asset?.category === 'building' ? 'base' : 'primary');
      return imageByKey.get(`${assetId}:${effectiveRole}`) ?? null;
    }
  });
}

async function defaultArtifactFetcher(url, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new ForgeAssetError('The approved PNG loader is unavailable.');
  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-store', credentials: 'same-origin' });
  } catch (error) {
    throw new ForgeAssetError(`Approved PNG is unreachable: ${url} (${error.message})`);
  }
  if (!response?.ok) throw new ForgeAssetError(`Approved PNG is missing: ${url} (${response?.status ?? 'network error'})`);
  return new Uint8Array(await response.arrayBuffer());
}

function defaultImageDecoder(bytes, url) {
  if (typeof Image !== 'function') throw new ForgeAssetError('The browser image loader is unavailable.');
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new ForgeAssetError(`Approved image could not be decoded: ${url}`));
    };
    image.src = objectUrl;
  });
}

function hasPngSignature(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

export async function fetchForgeManifest({
  manifestUrl = FORGE_MANIFEST_URL,
  requiredAssetIds = [],
  trustPolicy = FORGE_RELEASE_TRUST,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') throw new ForgeAssetError('The asset manifest loader is unavailable.');
  let response;
  try {
    response = await fetchImpl(manifestUrl, { cache: 'no-store', credentials: 'same-origin' });
  } catch (error) {
    throw new ForgeAssetError(`Approved Fable5 asset manifest is unreachable: ${error.message}`);
  }
  if (!response?.ok) throw new ForgeAssetError(`Approved Fable5 asset manifest is missing (${response?.status ?? 'network error'}).`);
  let manifest;
  try {
    manifest = await response.json();
  } catch (error) {
    throw new ForgeAssetError(`Approved Fable5 asset manifest is not valid JSON: ${error.message}`);
  }
  const validation = validateForgeManifest(manifest, { requiredAssetIds });
  if (!validation.ok) throw new ForgeAssetError('Approved Fable5 assets are incomplete; play has been stopped.', validation.issues);
  return verifyForgeManifestDigests(manifest, { trustPolicy });
}

export async function loadForgeAssetImages({
  manifest: suppliedManifest = null,
  manifestUrl = FORGE_MANIFEST_URL,
  requiredAssetIds = [],
  trustPolicy = FORGE_RELEASE_TRUST,
  fetchImpl = globalThis.fetch,
  artifactFetcher = defaultArtifactFetcher,
  imageDecoder = defaultImageDecoder,
  imageByKey: suppliedImageByKey = new Map(),
  onImageLoaded = null
} = {}) {
  const manifest = suppliedManifest ?? await fetchForgeManifest({ manifestUrl, requiredAssetIds, trustPolicy, fetchImpl });
  if (suppliedManifest) {
    const validation = validateForgeManifest(manifest, { requiredAssetIds });
    if (!validation.ok) throw new ForgeAssetError('Approved Fable5 assets are incomplete; play has been stopped.', validation.issues);
  }
  await verifyForgeManifestDigests(manifest, { trustPolicy });

  const required = new Set(requiredAssetIds);
  const assets = required.size > 0 ? manifest.assets.filter((asset) => required.has(asset.assetId)) : manifest.assets;
  const imageByKey = suppliedImageByKey;
  await Promise.all(assets.flatMap((asset) => asset.artifacts.map(async (artifact) => {
    const key = `${asset.assetId}:${artifact.role}`;
    if (imageByKey.has(key)) return;
    let bytes;
    try {
      bytes = asBytes(await artifactFetcher(artifact.publicPath, {
        asset,
        artifact,
        fetchImpl
      }));
    } catch (error) {
      if (error instanceof ForgeAssetError) throw error;
      throw new ForgeAssetError(`${asset.assetId}:${artifact.role} could not be loaded: ${error.message}`);
    }
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== artifact.sha256) {
      throw new ForgeAssetError(`${asset.assetId}:${artifact.role} bytes do not match the approved SHA-256 digest.`);
    }
    if (!hasPngSignature(bytes)) throw new ForgeAssetError(`${asset.assetId}:${artifact.role} is not a PNG.`);
    let image;
    try {
      image = await imageDecoder(bytes, artifact.publicPath, asset, artifact);
    } catch (error) {
      if (error instanceof ForgeAssetError) throw error;
      throw new ForgeAssetError(`${asset.assetId}:${artifact.role} could not be decoded: ${error.message}`);
    }
    const expected = dimensionsFor(asset, artifact.role);
    const width = image?.naturalWidth ?? image?.width;
    const height = image?.naturalHeight ?? image?.height;
    if (width !== expected.width || height !== expected.height) {
      throw new ForgeAssetError(`${asset.assetId}:${artifact.role} is ${width}x${height}; approved size is ${expected.width}x${expected.height}.`);
    }
    imageByKey.set(key, image);
    if (typeof onImageLoaded === 'function') onImageLoaded(asset.assetId, artifact.role);
  })));
  return createAssetResolver(manifest, imageByKey);
}

function numericVariant(variant) {
  if (Number.isInteger(variant)) return variant;
  if (typeof variant === 'string' && /^\d+$/.test(variant)) return Number(variant);
  return null;
}

export function terrainFrame(definition, variant = 0, timestamp = 0) {
  const contract = definition?.autotileContract;
  if (!contract) return null;
  let tileIndex = null;
  if (isRecord(variant) && Number.isInteger(variant.tileIndex)) tileIndex = variant.tileIndex;
  const direct = numericVariant(variant);
  if (tileIndex === null && direct !== null && direct >= 0 && direct <= 24) tileIndex = direct;
  const maskMatch = typeof variant === 'string' ? variant.match(/(?:mask|blob)[_:-]?(\d{1,2})/i) : null;
  const mask = isRecord(variant) && Number.isInteger(variant.mask) ? variant.mask : (maskMatch ? Number(maskMatch[1]) : null);
  if (tileIndex === null && mask !== null) tileIndex = contract.blob16.find((entry) => entry.mask === mask)?.tileIndex ?? null;
  if (tileIndex === null && typeof variant === 'string' && /anim/i.test(variant) && contract.animationFrameIndices.length > 0) {
    tileIndex = contract.animationFrameIndices[Math.floor(timestamp / 360) % contract.animationFrameIndices.length];
  }
  if (tileIndex === null) {
    const baseIndex = typeof variant === 'string' ? Number(variant.match(/(?:base|variant)[_:-]?(\d+)/i)?.[1] ?? 0) : 0;
    tileIndex = contract.baseVariantIndices[Math.abs(baseIndex) % contract.baseVariantIndices.length];
  }
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= contract.sheet.columns * contract.sheet.rows) return null;
  return Object.freeze({
    tileIndex,
    sx: (tileIndex % contract.sheet.columns) * contract.tileSize,
    sy: Math.floor(tileIndex / contract.sheet.columns) * contract.tileSize,
    sw: contract.tileSize,
    sh: contract.tileSize
  });
}

export function characterFrame(definition, direction = 'south', action = 'idle', timestamp = 0) {
  const contract = definition?.characterSpriteContract;
  if (!contract || contract.version !== 2) return null;
  const rowName = ({ north: 'back', east: 'right', south: 'front', west: 'left' })[direction] ?? 'front';
  const row = contract.directionRows.indexOf(rowName);
  const animation = contract.animations[action] ?? contract.animations.idle;
  const column = animation[Math.floor(timestamp / 180) % animation.length];
  return Object.freeze({
    column,
    row,
    sx: column * contract.frame.width,
    sy: row * contract.frame.height,
    sw: contract.frame.width,
    sh: contract.frame.height
  });
}

export function spriteFrame(definition, frame = 0) {
  const grid = definition?.sprites?.grid;
  if (!positiveInteger(grid?.columns) || !positiveInteger(grid?.rows)) return null;
  const outputWidth = definition.outputSize?.width;
  const outputHeight = definition.outputSize?.height;
  const frameWidth = grid.frameWidth ?? outputWidth / grid.columns;
  const frameHeight = grid.frameHeight ?? outputHeight / grid.rows;
  if (!positiveInteger(frameWidth) || !positiveInteger(frameHeight)) return null;
  const index = Math.max(0, Math.min(grid.columns * grid.rows - 1, Number.isInteger(frame) ? frame : 0));
  return Object.freeze({
    index,
    sx: (index % grid.columns) * frameWidth,
    sy: Math.floor(index / grid.columns) * frameHeight,
    sw: frameWidth,
    sh: frameHeight
  });
}
