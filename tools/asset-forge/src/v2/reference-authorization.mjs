import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT } from '../config.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { assertExistingFileWithin } from '../paths.mjs';
import { readReferenceManifest, resolveReferences } from '../references.mjs';
import { validateWith } from '../schemas.mjs';
import { findWaveAAsset, readWaveADefinitions } from './definition-builder.mjs';

async function assertIndependentReviewEvidence(root, authorization) {
  if (authorization.independentReview.status !== 'pending') {
    let reviewPath;
    try {
      reviewPath = await assertExistingFileWithin(root, authorization.independentReview.reviewPath);
    } catch (error) {
      throw new Error('Wave A independent reference review evidence could not be verified', { cause: error });
    }
    const reviewBytes = await readFile(reviewPath);
    if (sha256(reviewBytes) !== authorization.independentReview.reviewSha256) {
      throw new Error('Wave A independent reference review hash mismatch');
    }
    let review;
    try {
      review = JSON.parse(reviewBytes.toString('utf8'));
    } catch (error) {
      throw new Error('Wave A independent reference review is not valid JSON', { cause: error });
    }
    const reviewValidation = validateWith('reference-rights-review-v2.schema.json', review);
    if (!reviewValidation.ok) {
      throw new Error(`Invalid Wave A independent reference review: ${JSON.stringify(reviewValidation.errors)}`);
    }
    const sameValues = (left, right) => left.length === right.length
      && [...left].sort().every((value, index) => value === [...right].sort()[index]);
    if (review.status !== authorization.independentReview.status
      || review.reviewedAt !== authorization.independentReview.reviewedAt
      || review.ownerAuthorizationSha256 !== authorization.ownerAuthorizationSha256
      || review.assetReferenceMapSha256 !== authorization.assetReferenceMapSha256
      || !sameValues(review.authorizedReferenceIds, authorization.allowedReferenceIds)
      || !sameValues(review.forbiddenReferenceIds, authorization.forbiddenReferenceIds)) {
      throw new Error('Wave A independent reference review does not match its authorization record');
    }
  }
}

export async function readWaveAReferenceAuthorization({ root = FORGE_ROOT } = {}) {
  const file = path.join(root, 'data', 'v2', 'reference-authorization-wave-a.json');
  const authorization = JSON.parse(await readFile(file, 'utf8'));
  const validation = validateWith('reference-authorization-v2.schema.json', authorization);
  if (!validation.ok) {
    throw new Error(`Invalid Wave A reference authorization: ${JSON.stringify(validation.errors)}`);
  }
  await assertIndependentReviewEvidence(root, authorization);
  return authorization;
}

export function waveAReferenceAuthorizationProblems(definitions, authorization, referenceManifest) {
  const problems = [];
  const ownerAuthorizationSha256 = sha256(canonicalJson(authorization.ownerAuthorization));
  if (authorization.ownerAuthorizationSha256 !== ownerAuthorizationSha256) {
    problems.push('owner authorization digest is stale or does not cover the exact source, scope, and rights limitation');
  }
  const usedIds = [...new Set(definitions.flatMap(({ defaultReferenceIds }) => defaultReferenceIds))].sort();
  const allowedIds = [...authorization.allowedReferenceIds].sort();
  if (usedIds.length !== allowedIds.length || usedIds.some((id, index) => id !== allowedIds[index])) {
    problems.push('authorized reference ids must exactly equal the Wave A definition reference set');
  }
  for (const forbiddenId of authorization.forbiddenReferenceIds) {
    if (usedIds.includes(forbiddenId)) problems.push(`forbidden reference is used by Wave A: ${forbiddenId}`);
  }
  const records = new Map(referenceManifest.references.map((reference) => [reference.id, reference]));
  for (const referenceId of allowedIds) {
    const reference = records.get(referenceId);
    if (!reference) problems.push(`authorized reference is absent from the reference manifest: ${referenceId}`);
    else if (reference.status !== 'approved') problems.push(`authorized reference is not approved: ${referenceId}`);
    else if (!reference.sha256) problems.push(`authorized reference has no content hash: ${referenceId}`);
    else if (!reference.licenseNote) problems.push(`authorized reference has no license note: ${referenceId}`);
  }
  const currentMapDigest = waveAReferenceMapDigest(definitions, referenceManifest);
  if (authorization.assetReferenceMapSha256 !== currentMapDigest) {
    problems.push('authorized asset/reference map digest is stale or does not cover the exact 109 definition mappings');
  }
  if (authorization.status === 'approved' && authorization.independentReview.status !== 'pass') {
    problems.push('approved Wave A authorization requires an independent PASS review');
  }
  return problems;
}

export function waveAReferenceMapDigest(definitions, referenceManifest) {
  const records = new Map(referenceManifest.references.map((reference) => [reference.id, reference]));
  const mappings = [...definitions]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((definition) => ({
      assetId: definition.id,
      definitionSha256: sha256(canonicalJson(definition)),
      references: definition.defaultReferenceIds.map((referenceId) => {
        const record = records.get(referenceId) ?? null;
        return {
          id: referenceId,
          bytesSha256: record?.sha256 ?? null,
          recordSha256: record ? sha256(canonicalJson(record)) : null
        };
      })
    }));
  return sha256(canonicalJson({
    contract: 'fable5-wave-a-asset-reference-map-v1',
    requiredSetId: 'fable5-v2',
    waveId: 'A',
    mappings
  }));
}

export async function inspectWaveAReferenceAuthorization({
  root = FORGE_ROOT
} = {}) {
  const [definitions, effectiveAuthorization, referenceManifest] = await Promise.all([
    readWaveADefinitions({ root }),
    readWaveAReferenceAuthorization({ root }),
    readReferenceManifest({ root })
  ]);
  await assertIndependentReviewEvidence(root, effectiveAuthorization);
  const problems = waveAReferenceAuthorizationProblems(
    definitions, effectiveAuthorization, referenceManifest
  );
  return {
    ok: problems.length === 0 && effectiveAuthorization.status === 'approved',
    status: effectiveAuthorization.status,
    problems,
    assetCount: definitions.length,
    referenceCount: effectiveAuthorization.allowedReferenceIds.length
  };
}

export async function resolveWaveAAssetReferences(assetId, {
  root = FORGE_ROOT
} = {}) {
  const [asset, inspection, effectiveAuthorization] = await Promise.all([
    findWaveAAsset(assetId, { root }),
    inspectWaveAReferenceAuthorization({ root }),
    readWaveAReferenceAuthorization({ root })
  ]);
  if (!inspection.ok) {
    throw new Error(`Wave A reference authorization is not production-ready: ${[
      inspection.status, ...inspection.problems
    ].join('; ')}`);
  }
  const { references, warnings } = await resolveReferences(asset.defaultReferenceIds, {
    root,
    allowPending: false,
    allowMissing: false
  });
  return { asset, references, warnings, authorization: effectiveAuthorization };
}
