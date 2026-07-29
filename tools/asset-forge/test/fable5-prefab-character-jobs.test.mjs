import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FORGE_ROOT } from '../src/config.mjs';
import {
  buildFable5PrefabCharacterJob,
  fable5CharacterContractProblems,
  writeFable5PrefabCharacterJobPack
} from '../src/fable5-prefab-character-jobs.mjs';
import { main } from '../src/cli.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CHARACTER_STYLE_REFERENCE_SOURCE_ID = 'user_character_style_authority_20260722_v1';
const CHARACTER_STYLE_REFERENCE_PATH = 'art/references/user-provided/character_style_authority_20260722_v1.png';
const CHARACTER_STYLE_REFERENCE_SHA256 = '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932';

async function forgeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-fable5-character-job-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(FORGE_ROOT, 'contracts', 'fable5-prefab'), path.join(root, 'contracts', 'fable5-prefab'), {
    recursive: true
  });
  await cp(path.join(FORGE_ROOT, 'prompts', 'fable5-prefab'), path.join(root, 'prompts', 'fable5-prefab'), {
    recursive: true
  });
  return root;
}

async function userLedger() {
  return JSON.parse(await readFile(path.join(REPO_ROOT, 'art', 'contracts', 'user-provided-images.json'), 'utf8'));
}

test('Fable5 draft job preflight uses only the 640x512 contracts and ledger-bound references', async () => {
  for (const [assetId, expected] of [
    ['char_player', {
      contractPath: 'contracts/fable5-prefab/character.player.contract-draft.json',
      promptPath: 'prompts/fable5-prefab/character.player.prompt-draft.md',
      identityRole: 'player-direct-derivation-from-sole-character-style-authority'
    }],
    ['char_innkeeper', {
      contractPath: 'contracts/fable5-prefab/character.innkeeper.contract-draft.json',
      promptPath: 'prompts/fable5-prefab/character.innkeeper.prompt-draft.md',
      identityRole: 'sole-character-style-authority-distinct-npc'
    }],
    ['char_town_clerk', {
      contractPath: 'contracts/fable5-prefab/character.town-clerk.contract-draft.json',
      promptPath: 'prompts/fable5-prefab/character.town-clerk.prompt-draft.md',
      identityRole: 'sole-character-style-authority-distinct-npc'
    }],
    ['char_resident', {
      contractPath: 'contracts/fable5-prefab/character.resident.contract-draft.json',
      promptPath: 'prompts/fable5-prefab/character.resident.prompt-draft.md',
      identityRole: 'sole-character-style-authority-distinct-npc'
    }]
  ]) {
    const plan = await buildFable5PrefabCharacterJob({ assetId }, { projectRoot: REPO_ROOT });
    assert.equal(plan.status, 'dry-run');
    assert.equal(plan.job.assetId, assetId);
    assert.equal(plan.job.contractPath, expected.contractPath);
    assert.deepEqual(plan.job.promptPaths, [
      'prompts/fable5-prefab/00_common_fable5_character_sheet_style.md',
      expected.promptPath
    ]);
    assert.deepEqual(plan.job.outputContract, {
      kind: 'spritesheet',
      format: 'png',
      background: 'transparent',
      needsTransparency: true,
      width: 640,
      height: 512,
      nativeScale: 1,
      pivot: { x: 32, y: 120 },
      grid: { columns: 10, rows: 4, frameWidth: 64, frameHeight: 128 },
      animations: {
        rowOrder: ['south', 'west', 'east', 'north'],
        idle: { cols: [0, 1], fps: 4 },
        walk: { cols: [2, 3, 4, 5, 6, 7], fps: 10 },
        interact: { cols: [8, 9], fps: 6 }
      }
    });
    assert.deepEqual(plan.pack.referenceIds, [
      CHARACTER_STYLE_REFERENCE_SOURCE_ID,
      'user_target_town_current'
    ]);
    assert.equal(plan.job.references[0].role, expected.identityRole);
    assert.equal(plan.job.references.every((reference) => reference.verifiedAtAssembly), true);
    assert.equal(plan.job.references.every((reference) => reference.copiedIntoForge === false), true);
    assert.equal(plan.job.references.every((reference) => Object.hasOwn(reference, 'sourceSha256') === false), true);
    assert.deepEqual(plan.job.guards, {
      usesLegacyCharacterDefinitions: false,
      usesLegacyCharacterPrompts: false,
      usesRejectedPlayerIdentity: false,
      usesHistoricalCharacterCandidates: false,
      historicalCharacterRuntimePromotion: false,
      automaticImport: false,
      automaticApproval: false,
      apiKeyRequired: false,
      paidApiFallback: false
    });
    assert.equal(plan.job.approval.status, 'not-yet-submitted');
  }
});

test('Fable5 contract validator rejects legacy-sized grids and non-authoritative character sources', async () => {
  const original = JSON.parse(await readFile(
    path.join(FORGE_ROOT, 'contracts', 'fable5-prefab', 'character.player.contract-draft.json'),
    'utf8'
  ));
  const wrongGrid = structuredClone(original);
  wrongGrid.sheet.frameW = 48;
  const wrongPivot = structuredClone(original);
  wrongPivot.pivot.y = 96;
  const wrongAuthority = structuredClone(original);
  wrongAuthority.draftMeta.identitySource.sourceId = 'unlocked-character-source';
  assert.match(fable5CharacterContractProblems(wrongGrid, 'char_player').join('\n'), /4x10 grid of 64x128/);
  assert.match(fable5CharacterContractProblems(wrongPivot, 'char_player').join('\n'), /pivot must be \(32,120\)/);
  assert.match(fable5CharacterContractProblems(wrongAuthority, 'char_player').join('\n'), /exact sole character-style authority/);
});

test('dry-run has no output, while a Fable5 job pack stores commitments rather than source copies', async (t) => {
  const forgeRoot = await forgeFixture(t);
  const dryRun = await writeFable5PrefabCharacterJobPack(
    { assetId: 'char_player', dryRun: true },
    { forgeRoot, projectRoot: REPO_ROOT }
  );
  assert.equal(dryRun.status, 'dry-run');
  await assert.rejects(() => readdir(path.join(forgeRoot, 'generated')), { code: 'ENOENT' });

  const written = await writeFable5PrefabCharacterJobPack(
    { assetId: 'char_player' },
    { forgeRoot, projectRoot: REPO_ROOT }
  );
  assert.equal(written.status, 'job-pack');
  assert.equal(written.approvedTreeSha256Before, written.approvedTreeSha256After);
  const names = (await readdir(written.output.directory)).sort();
  assert.deepEqual(names, [
    'intake-guide.md',
    'job-pack.json',
    'job.json',
    'output-contract.json',
    'prompt.md',
    'references.json'
  ]);
  const referencesText = await readFile(written.output.references, 'utf8');
  const ledger = await userLedger();
  const playerReference = ledger.sources.find((source) => source.sourceId === CHARACTER_STYLE_REFERENCE_SOURCE_ID);
  assert.equal(playerReference.canonicalPath, CHARACTER_STYLE_REFERENCE_PATH);
  assert.equal(playerReference.sha256, CHARACTER_STYLE_REFERENCE_SHA256);
  assert.equal(referencesText.includes(playerReference.sha256), false);
  assert.match(await readFile(written.output.importGuide, 'utf8'), /Do not use the legacy/);
  assert.match(await readFile(written.output.prompt, 'utf8'), /Explicitly excluded:/);
});

test('CLI exposes the separate Fable5 preflight route and rejects legacy asset IDs on it', async () => {
  const help = await main(['help']);
  assert.ok(help.commands.includes(
    'make-fable5-character-job --asset <char_player|char_innkeeper|char_town_clerk|char_resident> [--dry-run]'
  ));
  for (const assetId of ['char_innkeeper', 'char_town_clerk', 'char_resident']) {
    const dryRun = await main(['make-fable5-character-job', '--asset', assetId, '--dry-run']);
    assert.equal(dryRun.status, 'dry-run');
  }
  for (const assetId of ['character.player', 'char_gatekeeper']) {
    await assert.rejects(
      () => main(['make-fable5-character-job', '--asset', assetId, '--dry-run']),
      /accept only char_player, char_innkeeper, char_town_clerk, or char_resident/
    );
  }
});
