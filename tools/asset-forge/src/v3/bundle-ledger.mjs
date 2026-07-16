import { isDeepStrictEqual } from 'node:util';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { validateWith } from '../schemas.mjs';
import { CATEGORY_DIRS } from '../config.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ASSET_ID_PATTERN = /^(character|building|terrain|overlay|structure|interior|prop|ui|effect)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;
const ORDINARY_CATEGORIES = new Set([
  'character', 'terrain', 'overlay', 'structure', 'interior', 'prop', 'ui', 'effect'
]);
const ROLE_ORDER = Object.freeze({ primary: 0, base: 1, roof: 2 });
const WAVE_BUNDLE_PATTERN = /^generated\/v3\/wave-bundles\/([a-f0-9]{64})\/([a-z0-9][a-z0-9_.-]*\.png)$/;

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
}

function requireSha256(value, label) {
  if (!SHA256_PATTERN.test(value ?? '')) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function requireAssetIdentity(assetId, category) {
  if (!ASSET_ID_PATTERN.test(assetId ?? '')) throw new Error('Invalid Fable5 asset id');
  if (assetId.split('.')[0] !== category) throw new Error(`Asset category does not match asset id: ${assetId}`);
  if (category !== 'building' && !ORDINARY_CATEGORIES.has(category)) {
    throw new Error(`Unsupported Fable5 v3 category: ${category}`);
  }
}

function legacyApprovedPrefix(category) {
  return `generated/${CATEGORY_DIRS[category]}/approved/`;
}

function waveBundleDirectory(approvedPath) {
  const match = WAVE_BUNDLE_PATTERN.exec(approvedPath ?? '');
  return match ? `generated/v3/wave-bundles/${match[1]}` : null;
}

function canonicalArtifacts(category, artifacts, {
  pathMode = 'either',
  bundleDirectory = null
} = {}) {
  if (!Array.isArray(artifacts)) throw new Error('Bundle artifacts must be an array');
  const expectedRoles = category === 'building' ? ['base', 'roof'] : ['primary'];
  if (artifacts.length !== expectedRoles.length) {
    throw new Error(category === 'building'
      ? 'A building bundle requires an atomic base and roof pair'
      : 'An ordinary asset bundle requires exactly one primary artifact');
  }
  const normalized = artifacts.map((artifact, index) => {
    requireExactKeys(artifact, ['role', 'generationId', 'approvedPath', 'sha256'], `Artifact ${index}`);
    if (!Object.hasOwn(ROLE_ORDER, artifact.role)) throw new Error(`Unknown artifact role: ${artifact.role}`);
    if (typeof artifact.generationId !== 'string' || !/^gen_[a-z0-9][a-z0-9_-]{0,127}$/.test(artifact.generationId)) {
      throw new Error(`Invalid generation id for artifact ${artifact.role}`);
    }
    if (typeof artifact.approvedPath !== 'string') throw new Error(`Invalid approved path for artifact ${artifact.role}`);
    const isLegacy = artifact.approvedPath.startsWith(legacyApprovedPrefix(category));
    const currentWaveDirectory = waveBundleDirectory(artifact.approvedPath);
    if (pathMode === 'legacy' && !isLegacy) {
      throw new Error(`Approved artifact path does not match category ${category}`);
    }
    if (pathMode === 'wave' && (!currentWaveDirectory || currentWaveDirectory !== bundleDirectory)) {
      throw new Error(`Wave artifact path does not belong to ${bundleDirectory}`);
    }
    if (pathMode === 'either' && !isLegacy && !currentWaveDirectory) {
      throw new Error(`Approved artifact path is outside an approved v3 location: ${artifact.approvedPath}`);
    }
    requireSha256(artifact.sha256, `Artifact ${artifact.role} hash`);
    return { ...artifact };
  }).sort((left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role]);
  if (normalized.some((artifact, index) => artifact.role !== expectedRoles[index])) {
    throw new Error(category === 'building'
      ? 'A building bundle requires one base artifact and one roof artifact'
      : 'An ordinary asset bundle requires a primary artifact');
  }
  if (new Set(normalized.map(({ approvedPath }) => approvedPath)).size !== normalized.length) {
    throw new Error('Bundle artifacts must use distinct approved paths');
  }
  return normalized;
}

export function bundleDigestFor({
  assetId, category, definitionSha256, generationRecordDigest, artifacts
}) {
  requireAssetIdentity(assetId, category);
  requireSha256(definitionSha256, 'Definition hash');
  requireSha256(generationRecordDigest, 'Generation record digest');
  const normalizedArtifacts = canonicalArtifacts(category, artifacts);
  return sha256(canonicalJson({
    contract: 'fable5-asset-bundle-v3',
    assetId,
    category,
    definitionSha256,
    generationRecordDigest,
    artifacts: normalizedArtifacts
  }));
}

function supersessionDigestFor(record) {
  const { supersessionDigest: _supersessionDigest, ...content } = record;
  return sha256(canonicalJson({ contract: 'fable5-bundle-supersession-v3', ...content }));
}

export function waveApprovalDigestFor(record) {
  const { approvalDigest: _approvalDigest, ...content } = record;
  return sha256(canonicalJson(content));
}

export function cellAuditDigestFor(record) {
  const { cellAuditDigest: _cellAuditDigest, ...content } = record;
  return sha256(canonicalJson({ contract: 'fable5-cell-audit-v3', ...content }));
}

export function artifactSetDigestFor(assets) {
  return sha256(canonicalJson({
    contract: 'fable5-wave-a-artifact-set-v3',
    assets: assets.map(({ assetId, artifacts }) => ({ assetId, artifacts }))
  }));
}

export function cellAuditSetDigestFor(assets) {
  return sha256(canonicalJson({
    contract: 'fable5-wave-a-cell-audit-set-v3',
    assets: assets.map(({ assetId, cellAudit }) => ({ assetId, cellAudit }))
  }));
}

export function evidenceCoverageDigestFor(assets) {
  return sha256(canonicalJson({
    contract: 'fable5-wave-a-evidence-coverage-v3',
    assets: assets.map(({ assetId, visualEvidenceDigest }) => ({ assetId, visualEvidenceDigest }))
  }));
}

function approvalProblem(approval) {
  try {
    requireExactKeys(approval, [
      'assetId', 'category', 'definitionSha256', 'generationRecordDigest', 'bundleDigest', 'artifacts',
      'reviewer', 'note', 'approvedAt'
    ], 'Bundle approval');
    const expected = bundleDigestFor(approval);
    if (approval.bundleDigest !== expected) return 'bundleDigest does not match canonical bundle content';
    const validation = validateWith('asset-bundle-approval.schema.json', {
      schemaVersion: 3,
      requiredSetId: 'fable5-v2',
      approvals: [approval],
      supersessions: [],
      waveApprovals: []
    });
    if (!validation.ok) return `schema validation failed: ${JSON.stringify(validation.errors)}`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function waveApprovalProblem(record, approvalByDigest) {
  const validation = validateWith('wave-a-approval-v3.schema.json', record);
  if (!validation.ok) return `schema validation failed: ${JSON.stringify(validation.errors)}`;
  if (record.approvalDigest !== waveApprovalDigestFor(record)) return 'approvalDigest mismatch';
  if (record.bundleDirectory !== `generated/v3/wave-bundles/${record.planDigest}`) {
    return 'bundleDirectory does not match planDigest';
  }
  if (record.artifactSetDigest !== artifactSetDigestFor(record.assets)) return 'artifactSetDigest mismatch';
  if (record.cellAuditDigest !== cellAuditSetDigestFor(record.assets)) return 'cellAuditDigest mismatch';
  if (record.evidenceCoverageDigest !== evidenceCoverageDigestFor(record.assets)) {
    return 'evidenceCoverageDigest mismatch';
  }
  const assetIds = new Set();
  const bundleDigests = new Set();
  const artifactPaths = new Set();
  const artifactHashes = new Set();
  let declared = 0;
  let semantic = 0;
  let nonempty = 0;
  let semanticTransparent = 0;
  let reserved = 0;
  for (const asset of record.assets) {
    if (assetIds.has(asset.assetId)) return `duplicate Wave A asset: ${asset.assetId}`;
    assetIds.add(asset.assetId);
    if (bundleDigests.has(asset.bundleDigest)) return `duplicate Wave A bundle: ${asset.bundleDigest}`;
    bundleDigests.add(asset.bundleDigest);
    if (asset.cellAudit.cellAuditDigest !== cellAuditDigestFor(asset.cellAudit)) {
      return `${asset.assetId} cellAuditDigest mismatch`;
    }
    const audit = asset.cellAudit;
    if (audit.cells.length !== audit.declaredLogicalSlotCount
      || audit.semanticCellCount !== audit.expectedNonemptySemanticCellCount + audit.expectedTransparentSemanticCellCount
      || audit.declaredLogicalSlotCount !== audit.semanticCellCount + audit.reservedTransparentCellCount) {
      return `${asset.assetId} cell audit count mismatch`;
    }
    const actualNonempty = audit.cells.filter(({ expectation }) => expectation === 'semantic-nonempty').length;
    const actualSemanticTransparent = audit.cells.filter(({ expectation }) => expectation === 'semantic-transparent-autotile-mask0').length;
    const actualReserved = audit.cells.filter(({ expectation }) => expectation === 'reserved-transparent').length;
    if (actualNonempty !== audit.expectedNonemptySemanticCellCount
      || actualSemanticTransparent !== audit.expectedTransparentSemanticCellCount
      || actualReserved !== audit.reservedTransparentCellCount) {
      return `${asset.assetId} cell expectation count mismatch`;
    }
    const cellIdentities = new Set();
    const nonemptyHashesByRole = new Map();
    for (const cell of audit.cells) {
      const identity = `${cell.artifactRole}:${cell.cellIndex}:${cell.frameRole}`;
      if (cellIdentities.has(identity)) return `${asset.assetId} repeats a cell role`;
      cellIdentities.add(identity);
      if (cell.hiddenRgbPixelCount !== 0) return `${asset.assetId} cell contains hidden RGB pixels`;
      if (cell.expectation === 'semantic-nonempty') {
        if (cell.alphaPixelCount < 1 || cell.alphaBbox === null) {
          return `${asset.assetId} semantic cell has no visible pixels`;
        }
        const hashes = nonemptyHashesByRole.get(cell.artifactRole) ?? new Set();
        if (hashes.has(cell.rgbaSha256)) return `${asset.assetId} repeats nonempty semantic cell pixels`;
        hashes.add(cell.rgbaSha256);
        nonemptyHashesByRole.set(cell.artifactRole, hashes);
      } else if (cell.alphaPixelCount !== 0 || cell.alphaBbox !== null) {
        return `${asset.assetId} transparent cell is not fully transparent`;
      }
    }
    declared += audit.declaredLogicalSlotCount;
    semantic += audit.semanticCellCount;
    nonempty += audit.expectedNonemptySemanticCellCount;
    semanticTransparent += audit.expectedTransparentSemanticCellCount;
    reserved += audit.reservedTransparentCellCount;

    const approval = approvalByDigest.get(asset.bundleDigest);
    if (!approval || approval.assetId !== asset.assetId
      || approval.definitionSha256 !== asset.definitionSha256
      || approval.generationRecordDigest !== asset.pendingGenerationRecordDigest
      || approval.reviewer !== record.reviewer || approval.note !== record.note
      || approval.approvedAt !== record.approvedAt) {
      return `${asset.assetId} does not match its Wave A bundle approval`;
    }
    if (!isDeepStrictEqual(
      approval.artifacts.map(({ role, approvedPath, sha256: artifactSha256 }) => ({ role, approvedPath, sha256: artifactSha256 })),
      asset.artifacts
    )) return `${asset.assetId} artifact membership mismatch`;
    if (new Set(approval.artifacts.map(({ generationId }) => generationId)).size !== 1
      || approval.artifacts[0].generationId !== asset.pendingGenerationId) {
      return `${asset.assetId} must bind one pending generation`;
    }
    for (const artifact of asset.artifacts) {
      if (!artifact.approvedPath.startsWith(`${record.bundleDirectory}/`)) {
        return `${asset.assetId} artifact escapes the Wave A bundle directory`;
      }
      if (artifactPaths.has(artifact.approvedPath)) return `duplicate Wave A artifact path: ${artifact.approvedPath}`;
      if (artifactHashes.has(artifact.sha256)) return `duplicate Wave A artifact bytes: ${artifact.sha256}`;
      artifactPaths.add(artifact.approvedPath);
      artifactHashes.add(artifact.sha256);
    }
  }
  if (artifactPaths.size !== record.outputPngCount || artifactHashes.size !== record.outputPngCount) {
    return 'Wave A artifact count does not match distinct paths and bytes';
  }
  if (declared !== record.declaredLogicalSlotCount || semantic !== record.semanticCellCount
    || nonempty !== record.expectedNonemptySemanticCellCount
    || semanticTransparent !== record.expectedTransparentSemanticCellCount
    || reserved !== record.reservedTransparentCellCount) {
    return 'Wave A aggregate cell counts do not match asset audits';
  }
  return null;
}

function prepareApproval(input, pathOptions) {
  requireExactKeys(input, [
    'assetId', 'category', 'definitionSha256', 'generationRecordDigest',
    'artifacts', 'reviewer', 'note', 'approvedAt'
  ], 'Bundle approval input');
  const canonical = canonicalArtifacts(input.category, input.artifacts, pathOptions);
  const approval = {
    assetId: input.assetId,
    category: input.category,
    definitionSha256: input.definitionSha256,
    generationRecordDigest: input.generationRecordDigest,
    bundleDigest: bundleDigestFor({ ...input, artifacts: canonical }),
    artifacts: canonical,
    reviewer: input.reviewer,
    note: input.note,
    approvedAt: input.approvedAt
  };
  const problem = approvalProblem(approval);
  if (problem) throw new Error(`Invalid bundle approval: ${problem}`);
  return approval;
}

export function prepareBundleApproval(input) {
  return prepareApproval(input, { pathMode: 'legacy' });
}

export function prepareWaveBundleApproval(input, { bundleDirectory }) {
  if (!/^generated\/v3\/wave-bundles\/[a-f0-9]{64}$/.test(bundleDirectory ?? '')) {
    throw new Error('Invalid Wave A bundle directory');
  }
  return prepareApproval(input, { pathMode: 'wave', bundleDirectory });
}

export function emptyBundleLedger(requiredSetId = 'fable5-v2') {
  return { schemaVersion: 3, requiredSetId, approvals: [], supersessions: [], waveApprovals: [] };
}

export function inspectBundleLedger(ledger) {
  const errors = [];
  const schemaValidation = validateWith('asset-bundle-approval.schema.json', ledger);
  if (!schemaValidation.ok) {
    errors.push(`schema validation failed: ${JSON.stringify(schemaValidation.errors)}`);
    return { ok: false, errors, activeByAsset: new Map(), waveApprovalById: new Map() };
  }

  const approvalByDigest = new Map();
  const approvalsByAsset = new Map();
  const artifactPaths = new Set();
  for (const approval of ledger.approvals) {
    const problem = approvalProblem(approval);
    if (problem) errors.push(`${approval.assetId}: ${problem}`);
    if (approvalByDigest.has(approval.bundleDigest)) errors.push(`Duplicate bundle digest: ${approval.bundleDigest}`);
    approvalByDigest.set(approval.bundleDigest, approval);
    const assetApprovals = approvalsByAsset.get(approval.assetId) ?? [];
    assetApprovals.push(approval);
    approvalsByAsset.set(approval.assetId, assetApprovals);
    for (const artifact of approval.artifacts) {
      if (artifactPaths.has(artifact.approvedPath)) errors.push(`Approved artifact path is reused: ${artifact.approvedPath}`);
      artifactPaths.add(artifact.approvedPath);
    }
  }

  const waveApprovalById = new Map();
  const waveBundleDigests = new Set();
  for (const record of ledger.waveApprovals) {
    if (waveApprovalById.has(record.waveId)) errors.push(`Wave is bulk-approved more than once: ${record.waveId}`);
    const problem = waveApprovalProblem(record, approvalByDigest);
    if (problem) errors.push(`Wave ${record.waveId}: ${problem}`);
    waveApprovalById.set(record.waveId, record);
    for (const asset of record.assets) waveBundleDigests.add(asset.bundleDigest);
  }
  for (const approval of ledger.approvals) {
    const usesWavePath = approval.artifacts.some(({ approvedPath }) => waveBundleDirectory(approvedPath));
    if (usesWavePath && !waveBundleDigests.has(approval.bundleDigest)) {
      errors.push(`Wave-bundle artifact is not authorized by a bulk approval: ${approval.assetId}`);
    }
  }

  const replacementBySuperseded = new Map();
  const predecessorByReplacement = new Map();
  for (const relation of ledger.supersessions) {
    const expectedRelationDigest = supersessionDigestFor(relation);
    if (relation.supersessionDigest !== expectedRelationDigest) {
      errors.push(`Supersession digest mismatch: ${relation.supersededBundleDigest}`);
    }
    const superseded = approvalByDigest.get(relation.supersededBundleDigest);
    const replacement = approvalByDigest.get(relation.replacementBundleDigest);
    if (!superseded || !replacement) {
      errors.push(`Supersession references an unknown bundle: ${relation.supersededBundleDigest}`);
      continue;
    }
    if (waveBundleDigests.has(relation.supersededBundleDigest)
      || waveBundleDigests.has(relation.replacementBundleDigest)) {
      errors.push(`Bulk Wave A bundles cannot be individually superseded: ${relation.assetId}`);
    }
    if (relation.supersededBundleDigest === relation.replacementBundleDigest) {
      errors.push(`A bundle cannot supersede itself: ${relation.supersededBundleDigest}`);
    }
    if (superseded.assetId !== relation.assetId || replacement.assetId !== relation.assetId
      || superseded.category !== relation.category || replacement.category !== relation.category) {
      errors.push(`Supersession crosses an asset or category boundary: ${relation.assetId}`);
    }
    if (replacementBySuperseded.has(relation.supersededBundleDigest)) {
      errors.push(`A bundle is superseded more than once: ${relation.supersededBundleDigest}`);
    }
    if (predecessorByReplacement.has(relation.replacementBundleDigest)) {
      errors.push(`A replacement bundle has more than one predecessor: ${relation.replacementBundleDigest}`);
    }
    replacementBySuperseded.set(relation.supersededBundleDigest, relation.replacementBundleDigest);
    predecessorByReplacement.set(relation.replacementBundleDigest, relation.supersededBundleDigest);
    const supersededAt = Date.parse(relation.supersededAt);
    if (supersededAt < Date.parse(superseded.approvedAt) || supersededAt < Date.parse(replacement.approvedAt)) {
      errors.push(`Supersession predates one of its approvals: ${relation.assetId}`);
    }
  }

  for (const digest of approvalByDigest.keys()) {
    const seen = new Set();
    let cursor = digest;
    while (replacementBySuperseded.has(cursor)) {
      if (seen.has(cursor)) {
        errors.push(`Bundle supersession cycle detected at: ${cursor}`);
        break;
      }
      seen.add(cursor);
      cursor = replacementBySuperseded.get(cursor);
    }
  }

  const activeByAsset = new Map();
  for (const [assetId, approvals] of approvalsByAsset) {
    const active = approvals.filter(({ bundleDigest }) => !replacementBySuperseded.has(bundleDigest));
    if (active.length !== 1) {
      errors.push(`Asset must have exactly one active bundle: ${assetId} (found ${active.length})`);
    } else {
      activeByAsset.set(assetId, active[0]);
    }
  }
  return { ok: errors.length === 0, errors, activeByAsset, waveApprovalById };
}

export function assertBundleLedger(ledger) {
  const inspection = inspectBundleLedger(ledger);
  if (!inspection.ok) throw new Error(`Invalid v3 bundle ledger: ${inspection.errors.join('; ')}`);
  return inspection;
}

export function appendBundleApproval(ledger, approval, { supersession } = {}) {
  const before = assertBundleLedger(ledger);
  const problem = approvalProblem(approval);
  if (problem) throw new Error(`Invalid bundle approval: ${problem}`);
  if (approval.artifacts.some(({ approvedPath }) => waveBundleDirectory(approvedPath))) {
    throw new Error('Wave-bundle paths require one appendWaveApproval transaction');
  }
  if (ledger.approvals.some(({ bundleDigest }) => bundleDigest === approval.bundleDigest)) {
    throw new Error(`Bundle approval is already recorded: ${approval.bundleDigest}`);
  }
  const previous = before.activeByAsset.get(approval.assetId);
  const next = structuredClone(ledger);
  next.approvals.push(structuredClone(approval));
  if (!previous) {
    if (supersession !== undefined) throw new Error('Cannot record a supersession without an active predecessor');
  } else {
    requireExactKeys(supersession, [
      'expectedBundleDigest', 'reviewer', 'note', 'supersededAt'
    ], 'Supersession request');
    if (previous.category !== approval.category) throw new Error('Replacement category does not match active bundle');
    if (supersession.expectedBundleDigest !== previous.bundleDigest) {
      throw new Error('Active bundle changed before supersession could be recorded');
    }
    const relation = {
      assetId: approval.assetId,
      category: approval.category,
      supersededBundleDigest: previous.bundleDigest,
      replacementBundleDigest: approval.bundleDigest,
      reviewer: supersession.reviewer,
      note: supersession.note,
      supersededAt: supersession.supersededAt
    };
    relation.supersessionDigest = supersessionDigestFor(relation);
    next.supersessions.push(relation);
  }
  assertBundleLedger(next);
  return next;
}

export function appendWaveApproval(ledger, approvals, waveApproval) {
  const before = assertBundleLedger(ledger);
  if (waveApproval?.waveId !== 'A' || before.waveApprovalById.has('A')) {
    throw new Error('Wave A can be bulk-approved exactly once');
  }
  if (!Array.isArray(approvals) || approvals.length !== 109) {
    throw new Error('Wave A bulk approval requires exactly 109 bundle approvals');
  }
  const ids = approvals.map(({ assetId }) => assetId);
  if (new Set(ids).size !== 109 || ids.some((id, index) => id !== waveApproval.assets[index]?.assetId)) {
    throw new Error('Wave A bundle approvals must exactly match the wave approval order');
  }
  if (approvals.some((approval) => before.activeByAsset.has(approval.assetId))) {
    throw new Error('Wave A bulk approval cannot coexist with pre-existing individual active bundles');
  }
  for (const approval of approvals) {
    const problem = approvalProblem(approval);
    if (problem) throw new Error(`Invalid Wave A bundle approval: ${approval.assetId}: ${problem}`);
  }
  const next = structuredClone(ledger);
  next.approvals.push(...structuredClone(approvals));
  next.waveApprovals.push(structuredClone(waveApproval));
  assertBundleLedger(next);
  return next;
}
