#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { FORGE_ROOT } from './config.mjs';
import { assertCanonicalInteractiveTerminal } from './human-write-gate.mjs';
import { exportApproved } from './export/export-approved.mjs';
import { batchRun } from './jobs/batch-run.mjs';
import { readAssetDefinitions } from './jobs/define-assets.mjs';
import { importCandidate, readProductionRecipeDraft } from './jobs/manual-import.mjs';
import {
  materializeProductionSourceSnapshot, promoteCandidate, promotionPreview, rejectCandidate
} from './jobs/lifecycle.mjs';
import { processCandidate } from './jobs/process-candidate.mjs';
import {
  beginRequiredPromotion,
  executeRequiredPromotion,
  formatRequiredPromotionPlan
} from './jobs/required-promotion.mjs';
import { runJob } from './jobs/run-job.mjs';
import { writeJobPack } from './jobs/write-job-pack.mjs';
import { writeFable5PrefabCharacterJobPack } from './fable5-prefab-character-jobs.mjs';
import { importFable5PrefabCharacterCandidate } from './fable5-prefab-character-intake.mjs';
import { writeFable5PrefabInteriorJobPack } from './fable5-prefab-interior-jobs.mjs';
import { importFable5PrefabInteriorCandidate } from './fable5-prefab-interior-intake.mjs';
import {
  freezeFable5RuntimeAssetLedger,
  verifyFable5RuntimeAssetLedger
} from './fable5-runtime-asset-ledger.mjs';
import { compiledSchemaNames } from './schemas.mjs';
import { validateRepository } from './validate.mjs';
import { importWaveARequest, listWaveAAssets, makeWaveAJob } from './v2/operator.mjs';
import {
  parseV3WaveIds,
  runV3Export
} from './v3/operator.mjs';
import {
  executeWaveAApproval,
  formatWaveAApprovalPreview,
  previewWaveAApproval
} from './v3/wave-operator.mjs';

const BOOLEAN_FLAGS = new Set([
  'dry-run', 'yes-subscription', 'allow-pending-reference', 'write', 'trim', 'materialize-source'
]);

function optionName(flag) {
  return flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function requireOnlyOptions(command, options, allowed) {
  const unexpected = Object.keys(options).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${command} does not accept option: --${unexpected[0]}`);
}

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const parsedOptions = Object.create(null);
  for (let i = 0; i < rest.length; i += 1) {
    const argument = rest[i];
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    const flag = argument.slice(2);
    if (!flag || flag.includes('=')) throw new Error(`Unsupported flag syntax: ${argument}`);
    const key = optionName(flag);
    if (Object.hasOwn(parsedOptions, key)) throw new Error(`Duplicate option: ${argument}`);
    if (BOOLEAN_FLAGS.has(flag)) {
      parsedOptions[key] = true;
      continue;
    }
    if (rest[i + 1] == null || rest[i + 1].startsWith('--')) throw new Error(`${argument} requires a value`);
    parsedOptions[key] = rest[++i];
  }
  const options = Object.fromEntries(Object.entries(parsedOptions));
  return { command, options };
}

function generationOptions(options) {
  if (!options.asset) throw new Error('--asset is required');
  return {
    assetId: options.asset,
    provider: options.provider ?? 'mock',
    dryRun: Boolean(options.dryRun),
    seed: options.seed ?? '',
    allowPendingReferences: Boolean(options.allowPendingReference)
  };
}

async function operatorImport(options) {
  const generation = generationOptions({ ...options, provider: 'manual-import' });
  const productionRecipe = options.recipe
    ? await readProductionRecipeDraft(options.recipe)
    : null;
  if (options.materializeSource && !productionRecipe) {
    throw new Error('--materialize-source requires --recipe');
  }
  const imported = await importCandidate({
    ...generation,
    file: options.file,
    productionRecipe,
    jobPackPath: options.jobPack ?? null
  });
  if (!options.materializeSource) return imported;
  const persisted = await materializeProductionSourceSnapshot({ generationId: imported.result.id });
  return {
    ...imported,
    result: persisted.result,
    sourceSnapshot: persisted.sourceSnapshot,
    sourceSnapshotStatus: persisted.status
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === 'help') {
    requireOnlyOptions(command, options, []);
    return {
      purpose: 'Asset Forge prepares and audits local game assets without executing inspected repository code.',
      phase: 'Phase 0-C approval and provenance infrastructure; this does not generate or approve Wave A assets.',
      commands: [
        'make-job-v2 --asset <wave-a-asset-id> [--seed <seed>]',
        'make-job-v2 --asset <character-asset-id> --mode monolithic-atlas [--seed <seed>]',
        'make-job-v2 --asset <character-asset-id> --mode character-direction-strips [--seed <seed>]',
        'make-job-v2 --asset <character-asset-id> --mode monolithic-atlas --character-atlas-layout character-atlas-layout-v1 [--seed <seed>]',
        'make-job-v2 --asset <character-asset-id> --mode monolithic-atlas --provider-key-normalization provider-key-normalize-v1 [--seed <seed>]',
        'make-job-v2 --asset <terrain-asset-id> --mode terrain-composed-atlas [--seed <seed>]',
        'make-fable5-character-job --asset <char_player|char_innkeeper|char_town_clerk|char_resident> [--dry-run]',
        'import-fable5-character --asset <char_player|char_innkeeper|char_town_clerk|char_resident> --file <candidate.png> --job-pack generated/jobs/<job-id>/job-pack.json [--dry-run]',
        'make-fable5-interior-job --asset <bld_m_inn.interior|bld_l_town_hall.interior|bld_m_house.interior> [--dry-run]',
        'import-fable5-interior --asset <interior-id> --file <candidate.png> --job-pack generated/jobs/<job-id>/job-pack.json [--dry-run]',
        'freeze-fable5-runtime-ledger --inventory review/fable5-runtime-assets/<inventory>.json [--dry-run]',
        'verify-fable5-runtime-ledger --ledger generated/fable5-runtime-ledgers/<sha256>.json',
        'import-v2 --recipe review/import-requests/v2/<request>.json',
        'list-v2',
        'approve-wave-a --note <human-review-note>  (interactive TTY; one exact 109-asset bulk ceremony)',
        'export-v3 --waves A [--write]'
      ],
      authority: 'Wave A has no per-asset approval command; only a committed bulk wave approval authorizes export.'
    };
  }
  if (command === 'validate') return validateRepository();
  if (command === 'list') {
    return { assets: (await readAssetDefinitions()).map(({ id, category, displayName }) => ({ id, category, displayName })) };
  }
  if (command === 'doctor') {
    return {
      node: process.version,
      schemas: compiledSchemaNames.length,
      providers: {
        mock: { status: 'available', configured: true },
        'job-pack': { status: 'available', configured: true, executesExternalCommand: false },
        'manual-import': { status: 'available', configured: true, executesExternalCommand: false },
        'codex-subscription': {
          status: 'unavailable', configured: false, executesExternalCommand: false,
          reason: 'No independently verified subscription command is enabled.'
        }
      },
      apiUsage: false,
      authenticationAttempted: false
    };
  }
  if (command === 'generate') {
    const generation = generationOptions(options);
    if (generation.provider === 'job-pack') return writeJobPack(generation);
    if (generation.provider === 'manual-import') return operatorImport(options);
    if (generation.provider === 'codex-subscription' && !options.yesSubscription) {
      throw new Error('codex-subscription requires --yes-subscription and an independently enabled local adapter');
    }
    return runJob(generation);
  }
  if (command === 'batch') {
    return batchRun({
      assetIds: String(options.assets ?? '').split(',').filter(Boolean),
      provider: options.provider ?? 'mock',
      dryRun: Boolean(options.dryRun),
      seed: options.seed ?? '',
      allowPendingReferences: Boolean(options.allowPendingReference),
      maxJobs: Number(options.maxJobs ?? 10)
    });
  }
  if (command === 'make-job') return writeJobPack(generationOptions({ ...options, provider: 'job-pack' }));
  if (command === 'make-fable5-character-job') {
    requireOnlyOptions(command, options, ['asset', 'dryRun']);
    if (!options.asset) throw new Error('--asset is required');
    return writeFable5PrefabCharacterJobPack({
      assetId: options.asset,
      dryRun: Boolean(options.dryRun)
    });
  }
  if (command === 'import-fable5-character') {
    requireOnlyOptions(command, options, ['asset', 'file', 'jobPack', 'dryRun']);
    if (!options.asset || !options.file || !options.jobPack) {
      throw new Error('--asset, --file, and --job-pack are required');
    }
    return importFable5PrefabCharacterCandidate({
      assetId: options.asset,
      file: options.file,
      jobPackPath: options.jobPack,
      dryRun: Boolean(options.dryRun)
    });
  }
  if (command === 'make-fable5-interior-job') {
    requireOnlyOptions(command, options, ['asset', 'dryRun']);
    if (!options.asset) throw new Error('--asset is required');
    return writeFable5PrefabInteriorJobPack({
      assetId: options.asset,
      dryRun: Boolean(options.dryRun)
    });
  }
  if (command === 'import-fable5-interior') {
    requireOnlyOptions(command, options, ['asset', 'file', 'jobPack', 'dryRun']);
    if (!options.asset || !options.file || !options.jobPack) {
      throw new Error('--asset, --file, and --job-pack are required');
    }
    return importFable5PrefabInteriorCandidate({
      assetId: options.asset,
      file: options.file,
      jobPackPath: options.jobPack,
      dryRun: Boolean(options.dryRun)
    });
  }
  if (command === 'freeze-fable5-runtime-ledger') {
    requireOnlyOptions(command, options, ['inventory', 'dryRun']);
    if (!options.inventory) throw new Error('--inventory is required');
    return freezeFable5RuntimeAssetLedger({
      inventoryPath: options.inventory,
      dryRun: Boolean(options.dryRun)
    });
  }
  if (command === 'verify-fable5-runtime-ledger') {
    requireOnlyOptions(command, options, ['ledger']);
    if (!options.ledger) throw new Error('--ledger is required');
    return verifyFable5RuntimeAssetLedger({ ledgerPath: options.ledger });
  }
  if (command === 'make-job-v2') {
    requireOnlyOptions(command, options, [
      'asset', 'seed', 'mode', 'providerKeyNormalization', 'characterAtlasLayout'
    ]);
    if (!options.asset) throw new Error('--asset is required');
    return makeWaveAJob({
      assetId: options.asset,
      seed: options.seed ?? '',
      generationMode: options.mode ?? 'per-unit',
      providerKeyNormalization: options.providerKeyNormalization ?? null,
      characterAtlasLayout: options.characterAtlasLayout ?? null
    });
  }
  if (command === 'import') return operatorImport(options);
  if (command === 'import-v2') {
    requireOnlyOptions(command, options, ['recipe']);
    if (!options.recipe) throw new Error('--recipe is required');
    return importWaveARequest({ requestPath: options.recipe });
  }
  if (command === 'list-v2') {
    requireOnlyOptions(command, options, []);
    return { assets: await listWaveAAssets() };
  }
  if (command === 'persist-source') {
    if (!options.generation) throw new Error('--generation is required');
    return materializeProductionSourceSnapshot({ generationId: options.generation });
  }
  if (command === 'process') {
    if (!options.generation) throw new Error('--generation is required');
    return processCandidate({
      generationId: options.generation,
      alphaKey: options.alphaKey ?? 'none',
      tolerance: Number(options.tolerance ?? 0),
      trim: Boolean(options.trim)
    });
  }
  if (command === 'reject') {
    if (!options.generation) throw new Error('--generation is required');
    return rejectCandidate({ generationId: options.generation, reason: options.reason });
  }
  if (command === 'approve-wave-a') {
    requireOnlyOptions(command, options, ['note']);
    assertCanonicalInteractiveTerminal('Wave A bulk approval');
    if (!options.note) throw new Error('--note is required');
    const preview = await previewWaveAApproval({ note: options.note });
    process.stdout.write(formatWaveAApprovalPreview(preview));
    if (preview.status === 'already-approved') return preview;
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    try {
      answer = await terminal.question('Type the exact confirmation above: ');
    } finally {
      terminal.close();
    }
    return executeWaveAApproval(preview, answer);
  }
  if (command === 'promote-required') {
    if (Object.keys(options).length !== 0) throw new Error('promote-required does not accept flags or options');
    assertCanonicalInteractiveTerminal('Required promotion');
    const preflight = await beginRequiredPromotion();
    process.stdout.write(formatRequiredPromotionPlan(preflight));
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    try {
      answer = await terminal.question('Type the exact confirmation above: ');
    } finally {
      terminal.close();
    }
    return executeRequiredPromotion(preflight, answer);
  }
  if (command === 'promote') {
    if (!options.generation) throw new Error('--generation is required');
    const preview = await promotionPreview({
      generationId: options.generation,
      supersedesGenerationId: options.supersedes,
      note: options.note
    });
    assertCanonicalInteractiveTerminal('Promotion');
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await terminal.question('Type the exact confirmation phrase shown above: ');
    terminal.close();
    return promoteCandidate({
      preview,
      answer,
      write: Boolean(options.write)
    });
  }
  if (command === 'export') {
    if (options.publicRoot) throw new Error('Export destination is fixed to the project public root');
    return exportApproved({
      write: Boolean(options.write),
      publicRoot: path.resolve(FORGE_ROOT, '..', '..', 'public')
    });
  }
  if (command === 'export-v3') {
    requireOnlyOptions(command, options, ['waves', 'write']);
    const waveIds = parseV3WaveIds(options.waves);
    return runV3Export({
      waveIds,
      write: Boolean(options.write)
    });
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await main();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result?.ok === false || result?.status === 'failed' || result?.status === 'partial-failure') process.exitCode = 1;
  } catch (error) {
    const body = error?.result ? { error: error.message, result: error.result } : { error: error.message };
    process.stderr.write(`${JSON.stringify(body, null, 2)}\n`);
    process.exitCode = 1;
  }
}
