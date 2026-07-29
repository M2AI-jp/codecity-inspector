import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildFable5RuntimeAssetLedger,
  freezeFable5RuntimeAssetLedger,
  verifyFable5RuntimeAssetLedger
} from '../src/fable5-runtime-asset-ledger.mjs';
import { sha256 } from '../src/hashing.mjs';
import { main } from '../src/cli.mjs';

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(t, {
  state = 'approved', runtimeMatches = true, approvalState = state, styleLockScope = true
} = {}) {
  const forgeRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-fable5-runtime-ledger-'));
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-fable5-runtime-ledger-'));
  t.after(async () => Promise.all([
    rm(forgeRoot, { recursive: true, force: true }),
    rm(projectRoot, { recursive: true, force: true })
  ]));

  const stateDirectory = state === 'pending-inspection' ? 'pending' : state;
  const stem = 'fable5_char_player_0123456789ab';
  const artifactPath = `generated/characters/${stateDirectory}/${stem}.png`;
  const metadataPath = `generated/characters/${stateDirectory}/${stem}.json`;
  const contractPath = 'contracts/fable5-prefab/character.player.contract.json';
  const jobPackPath = 'generated/jobs/fable5_prefab_char_player_test/job-pack.json';
  const approvalRecordPath = 'review/provenance/char-player-runtime-review.json';
  const runtimePath = 'public/fable5-v2/assets/characters/char-player.png';
  const bytes = Buffer.from('fable5 asset bytes for ledger test');
  const artifactHash = sha256(bytes);
  await mkdir(path.dirname(path.join(forgeRoot, artifactPath)), { recursive: true });
  await writeFile(path.join(forgeRoot, artifactPath), bytes);
  await writeJson(path.join(forgeRoot, metadataPath), {
    assetId: 'char_player',
    status: state,
    outputPath: artifactPath,
    outputSha256: artifactHash,
    approval: state === 'approved'
      ? { status: 'human-approved', humanOnly: true }
      : { status: state === 'rejected' ? 'human-rejected' : 'not-yet-submitted', humanOnly: true }
  });
  await writeJson(path.join(forgeRoot, contractPath), { contract: 'fable5-character-test' });
  await writeJson(path.join(forgeRoot, jobPackPath), {
    schemaVersion: 1,
    jobId: 'fable5_prefab_char_player_test',
    assetId: 'char_player',
    promptPath: 'generated/jobs/fable5_prefab_char_player_test/prompt.md',
    referenceIds: ['user_character_style_reference', 'user_target_town_current'],
    outputContractPath: 'generated/jobs/fable5_prefab_char_player_test/output-contract.json',
    importCommandPath: 'generated/jobs/fable5_prefab_char_player_test/intake-guide.md',
    status: 'job-pack'
  });
  await writeJson(path.join(forgeRoot, 'generated/jobs/fable5_prefab_char_player_test/job.json'), {
    id: 'fable5_prefab_char_player_test',
    assetId: 'char_player',
    contractPath,
    provenanceKey: 'a'.repeat(64)
  });
  if (state !== 'pending-inspection') {
    await writeJson(path.join(forgeRoot, approvalRecordPath), {
      assetId: 'char_player',
      derivation: { outputPath: artifactPath, outputSha256: artifactHash },
      review: {
        approval: {
          status: approvalState,
          scope: ['visual-review', 'runtime-use', ...(styleLockScope ? ['character-style-lock'] : [])],
          approvedBy: 'project-owner',
          decisionRef: 'owner-review-20260722'
        }
      },
      origin: { kind: 'external-candidate-unverified' }
    });
  }
  if (state === 'approved') {
    await mkdir(path.dirname(path.join(projectRoot, runtimePath)), { recursive: true });
    await writeFile(path.join(projectRoot, runtimePath), runtimeMatches ? bytes : Buffer.from('tampered runtime bytes'));
  }
  const inventoryPath = 'review/fable5-runtime-assets/character-inventory.json';
  await writeJson(path.join(forgeRoot, inventoryPath), {
    format: 'fable5-runtime-asset-inventory-v1',
    assets: [{
      assetId: 'char_player',
      category: 'character',
      state,
      artifactPath,
      metadataPath,
      contractPath,
      jobPackPath,
      approvalRecordPath: state === 'pending-inspection' ? null : approvalRecordPath,
      runtimePath: state === 'approved' ? runtimePath : null
    }]
  });
  return { forgeRoot, projectRoot, inventoryPath, artifactPath, runtimePath };
}

test('Fable5 runtime asset ledger freezes a human-approved byte-identical runtime allowlist and re-verifies it', async (t) => {
  const setup = await fixture(t);
  const frozen = await freezeFable5RuntimeAssetLedger({ inventoryPath: setup.inventoryPath }, setup);
  assert.equal(frozen.status, 'frozen');
  assert.equal(frozen.ledger.runtimeReady, true);
  assert.equal(frozen.ledger.runtimeAllowlist.length, 1);
  assert.equal(frozen.ledger.runtimeAllowlist[0].runtime.path, setup.runtimePath);
  assert.equal(frozen.approvedTreeSha256Before, frozen.approvedTreeSha256After);
  const persisted = JSON.parse(await readFile(path.join(setup.forgeRoot, frozen.output), 'utf8'));
  assert.equal(persisted.ledgerSha256, frozen.ledger.ledgerSha256);
  const verified = await verifyFable5RuntimeAssetLedger({ ledgerPath: frozen.output }, setup);
  assert.equal(verified.status, 'verified');
  assert.equal(verified.runtimeAssetCount, 1);
});

test('Fable5 runtime asset ledger tracks pending candidates without allowing them in runtime', async (t) => {
  const setup = await fixture(t, { state: 'pending-inspection' });
  const plan = await buildFable5RuntimeAssetLedger({ inventoryPath: setup.inventoryPath }, setup);
  assert.equal(plan.status, 'dry-run');
  assert.equal(plan.ledger.runtimeReady, false);
  assert.equal(plan.ledger.runtimeAllowlist.length, 0);
  assert.equal(plan.ledger.stateCounts['pending-inspection'], 1);
  await assert.rejects(() => verifyFable5RuntimeAssetLedger({
    ledgerPath: 'generated/fable5-runtime-ledgers/0'.repeat(64) + '.json'
  }, setup));
});

test('Fable5 runtime asset ledger fails closed when approved runtime bytes or a terminal human decision disagree', async (t) => {
  const byteMismatch = await fixture(t, { runtimeMatches: false });
  await assert.rejects(
    () => buildFable5RuntimeAssetLedger({ inventoryPath: byteMismatch.inventoryPath }, byteMismatch),
    /Runtime bytes do not equal approved asset bytes/
  );

  const decisionMismatch = await fixture(t, { state: 'rejected', approvalState: 'approved' });
  await assert.rejects(
    () => buildFable5RuntimeAssetLedger({ inventoryPath: decisionMismatch.inventoryPath }, decisionMismatch),
    /Human approval record is incomplete/
  );

  const missingStyleLock = await fixture(t, { styleLockScope: false });
  await assert.rejects(
    () => buildFable5RuntimeAssetLedger({ inventoryPath: missingStyleLock.inventoryPath }, missingStyleLock),
    /lacks the required character-style-lock human review scope/
  );
});

test('Fable5 runtime ledger CLI exposes only freeze and verification, never an approval operation', async () => {
  const help = await main(['help']);
  assert.ok(help.commands.includes(
    'freeze-fable5-runtime-ledger --inventory review/fable5-runtime-assets/<inventory>.json [--dry-run]'
  ));
  assert.ok(help.commands.includes(
    'verify-fable5-runtime-ledger --ledger generated/fable5-runtime-ledgers/<sha256>.json'
  ));
  await assert.rejects(
    () => main(['freeze-fable5-runtime-ledger', '--approved', 'true']),
    /does not accept option/
  );
});
