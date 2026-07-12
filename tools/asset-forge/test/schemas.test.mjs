import assert from 'node:assert/strict';
import test from 'node:test';
import { compiledSchemaNames, validateWith } from '../src/schemas.mjs';
import { validateRepository } from '../src/validate.mjs';

test('all tracked schemas compile under strict draft-07 Ajv', () => {
  assert.equal(compiledSchemaNames.includes('approval-manifest.schema.json'), true);
  assert.equal(compiledSchemaNames.includes('game-export.schema.json'), true);
  assert.equal(compiledSchemaNames.length >= 12, true);
});

test('the complete tracked catalog and manifests validate', async () => {
  assert.deepEqual(await validateRepository(), { ok: true, assetCount: 104, requiredAssetCount: 104, issues: [] });
});

test('invalid definitions are rejected', () => {
  const result = validateWith('asset-definition.schema.json', { category: 'wrong' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('generation lifecycle states reject contradictory fields', () => {
  const pending = {
    id: 'gen_fixture', jobId: 'job_fixture', assetId: 'field.grass', category: 'field',
    status: 'pending', provider: 'mock', outputPath: 'generated/fields/pending/fixture.png',
    outputSha256: 'a'.repeat(64), metadataPath: 'generated/fields/pending/fixture.json',
    promptHash: 'b'.repeat(64), provenanceKey: 'c'.repeat(64), referenceImageIds: [],
    referenceImageHashes: [], dryRun: false, subscriptionRun: false, manualImport: false,
    outputInspection: { format: 'png', width: 1, height: 1, channels: 4, frames: 1, bytes: 68 },
    warnings: [], createdAt: '2026-07-13T00:00:00.000Z',
    inspection: { status: 'pending-inspection', observed: [], inferred: [], unknown: ['human approval'] }
  };
  assert.equal(validateWith('generation-result.schema.json', pending).ok, true);
  assert.equal(validateWith('generation-result.schema.json', {
    ...pending,
    approval: {
      reviewer: 'human', note: 'contradiction', approvedAt: '2026-07-13T00:00:00.000Z',
      approvedPath: 'generated/fields/approved/fixture.png', approvedSha256: 'a'.repeat(64)
    }
  }).ok, false);
  assert.equal(validateWith('generation-result.schema.json', { ...pending, status: 'failed', error: 'failed' }).ok, false);
});
