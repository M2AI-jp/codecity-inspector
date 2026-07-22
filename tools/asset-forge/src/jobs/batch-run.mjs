import { BATCH_LIMITS } from '../config.mjs';
import { GenerationRunError, runJob } from './run-job.mjs';

export async function batchRun({ assetIds, maxJobs = BATCH_LIMITS.defaultJobs, ...options }, runtime) {
  if (!Array.isArray(assetIds) || assetIds.length === 0) throw new Error('batch requires asset ids');
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > BATCH_LIMITS.hardMaximumJobs) {
    throw new Error(`max-jobs must be from 1 to ${BATCH_LIMITS.hardMaximumJobs}`);
  }
  if (assetIds.length > maxJobs) throw new Error('batch exceeds max-jobs');
  const results = [];
  for (const assetId of assetIds) {
    try {
      results.push(await runJob({ ...options, assetId }, runtime));
    } catch (error) {
      if (!(error instanceof GenerationRunError)) throw error;
      results.push({ status: 'failed', result: error.result, error: error.message });
    }
  }
  return {
    status: results.some((result) => result.status === 'failed') ? 'partial-failure' : 'complete',
    results
  };
}
