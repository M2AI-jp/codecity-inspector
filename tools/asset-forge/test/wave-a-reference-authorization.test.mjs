import assert from 'node:assert/strict';
import test from 'node:test';
import { readReferenceManifest } from '../src/references.mjs';
import { readWaveADefinitions } from '../src/v2/definition-builder.mjs';
import {
  inspectWaveAReferenceAuthorization,
  readWaveAReferenceAuthorization,
  resolveWaveAAssetReferences,
  waveAReferenceAuthorizationProblems,
  waveAReferenceMapDigest
} from '../src/v2/reference-authorization.mjs';
import { canonicalJson, sha256 } from '../src/hashing.mjs';

test('Wave A reference authorization covers all 109 definitions and resolves only after hash-bound independent review', async () => {
  const inspection = await inspectWaveAReferenceAuthorization();
  assert.equal(inspection.status, 'approved');
  assert.equal(inspection.assetCount, 109);
  assert.equal(inspection.referenceCount, 17);
  assert.deepEqual(inspection.problems, []);
  assert.equal(inspection.ok, true);
  const resolved = await resolveWaveAAssetReferences('building.inn');
  assert.equal(resolved.asset.id, 'building.inn');
  assert.equal(resolved.references.length, 2);
  assert.equal(resolved.authorization.independentReview.status, 'pass');
});

test('the authorization digest binds every asset to its exact two references, definition, and reference record hashes', async () => {
  const [authorization, definitions, manifest] = await Promise.all([
    readWaveAReferenceAuthorization(), readWaveADefinitions(), readReferenceManifest()
  ]);
  assert.equal(waveAReferenceMapDigest(definitions, manifest), authorization.assetReferenceMapSha256);
  assert.equal(
    sha256(canonicalJson(authorization.ownerAuthorization)),
    authorization.ownerAuthorizationSha256
  );
  const changed = structuredClone(definitions);
  const inn = changed.find(({ id }) => id === 'building.inn');
  inn.defaultReferenceIds[1] = 'intake_20260713_building_town_hall';
  assert.match(
    waveAReferenceAuthorizationProblems(changed, authorization, manifest).join('; '),
    /asset\/reference map digest is stale/
  );
});

test('production resolution ignores an in-memory authorization override and re-reads the persisted reviewed record', async () => {
  const authorization = await readWaveAReferenceAuthorization();
  const approved = {
    ...authorization,
    status: 'approved',
    ownerAuthorization: { ...authorization.ownerAuthorization, scope: 'rewritten after review' },
    independentReview: {
      status: 'pass',
      reviewPath: 'review/phase0-wave-a-reference-rights-audit.json',
      reviewSha256: 'a'.repeat(64),
      reviewedAt: '2026-07-16T00:00:00.000Z'
    }
  };
  // Extra options cannot inject authorization. The persisted reviewed record wins.
  const resolved = await resolveWaveAAssetReferences('building.inn', { authorization: approved });
  assert.equal(resolved.authorization.ownerAuthorization.scope, authorization.ownerAuthorization.scope);
  assert.notEqual(resolved.authorization.ownerAuthorization.scope, approved.ownerAuthorization.scope);
});
