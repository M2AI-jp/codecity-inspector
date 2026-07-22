import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { verifyFable5PendingRuntimeEvidence } from '../../tools/qa/fable5-pending-runtime-evidence.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('committed pending evidence is mechanically reproducible without granting promotion or runtime use', async () => {
  const result = await verifyFable5PendingRuntimeEvidence({ repoRoot: REPO_ROOT });
  assert.equal(result.ok, true);
  assert.equal(result.assetCount, 5);
  assert.deepEqual(result.assets.map(({ assetId }) => assetId).sort(), [
    'bld_l_town_hall.interior',
    'bld_m_house.interior',
    'bld_m_inn.interior',
    'char_innkeeper',
    'char_player'
  ]);
  assert.deepEqual(result.approval, {
    humanDecision: null,
    runtimeInstallAllowed: false,
    promotionAllowed: false
  });
});
