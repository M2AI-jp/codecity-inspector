#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { FORGE_ROOT } from './config.mjs';
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
import { compiledSchemaNames } from './schemas.mjs';
import { validateRepository } from './validate.mjs';

const BOOLEAN_FLAGS = new Set([
  'dry-run', 'yes-subscription', 'allow-pending-reference', 'write', 'trim', 'materialize-source'
]);

function optionName(flag) {
  return flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
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
  if (command === 'import') return operatorImport(options);
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
  if (command === 'promote-required') {
    if (Object.keys(options).length !== 0) throw new Error('promote-required does not accept flags or options');
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      throw new Error('Required promotion requires stdin and stdout to both be interactive TTYs');
    }
    const preflight = await beginRequiredPromotion({ input: process.stdin, output: process.stdout });
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
      supersedesGenerationId: options.supersedes
    });
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Promotion requires an interactive TTY');
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await terminal.question('Type APPROVE to confirm this exact hash: ');
    terminal.close();
    return promoteCandidate({
      generationId: options.generation,
      reviewer: options.reviewer,
      note: options.note,
      write: Boolean(options.write),
      confirmed: answer === 'APPROVE',
      expectedSourceSha256: preview.sourceSha256,
      expectedApprovedPath: preview.approvedPath,
      supersedesGenerationId: options.supersedes
    });
  }
  if (command === 'export') {
    if (options.publicRoot) throw new Error('Export destination is fixed to the project public root');
    return exportApproved({
      write: Boolean(options.write),
      publicRoot: path.resolve(FORGE_ROOT, '..', '..', 'public')
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
