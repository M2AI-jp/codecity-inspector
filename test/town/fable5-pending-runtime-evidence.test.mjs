import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { verifyFable5PendingRuntimeEvidence } from '../../tools/qa/fable5-pending-runtime-evidence.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('superseded evidence remains audit-verifiable without becoming a current review or runtime authority', async () => {
  const result = await verifyFable5PendingRuntimeEvidence({ repoRoot: REPO_ROOT });
  assert.equal(result.ok, true);
  assert.equal(result.evidenceStatus, 'historical-superseded');
  assert.equal(result.mode, 'historical-superseded');
  assert.equal(result.auditOnly, true);
  assert.deepEqual(result.supersededBy, {
    sourceId: 'user_character_style_authority_20260722_v1',
    sha256: '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932',
    reviewPacketPath: 'review/fable5-runtime-assets/style-authority-20260722-v1/index.json'
  });
  assert.equal(result.assetCount, 6);
  assert.deepEqual(result.assets.map(({ assetId }) => assetId).sort(), [
    'bld_l_town_hall.interior',
    'bld_m_house.interior',
    'bld_m_inn.interior',
    'char_player',
    'char_resident',
    'char_town_clerk'
  ]);
  assert.deepEqual(result.stateCounts, {
    'formal-intake': 4,
    'pre-intake-review': 2
  });
  assert.deepEqual(result.assets
    .filter(({ state }) => state === 'pre-intake-review')
    .map(({ assetId }) => assetId)
    .sort(), ['char_resident', 'char_town_clerk']);
  assert.deepEqual(result.approval, {
    humanDecision: null,
    runtimeInstallAllowed: false,
    promotionAllowed: false
  });
});
