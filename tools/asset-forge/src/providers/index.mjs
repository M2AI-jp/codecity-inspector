import { createMockPng } from './mock-provider.mjs';

const mockProvider = {
  name: 'mock',
  generate: async (job) => createMockPng({
    assetId: job.assetId,
    seed: job.seed,
    promptHash: job.promptHash,
    referenceImageHashes: job.referenceImageHashes,
    outputContract: job.outputContract
  })
};

export function providerFor(name, { overrides = {} } = {}) {
  if (overrides[name]) return overrides[name];
  if (name === 'mock') return mockProvider;
  if (name === 'codex-subscription') throw new Error('provider unavailable: codex-subscription is not configured');
  if (name === 'job-pack' || name === 'manual-import') throw new Error(`${name} is a workflow command, not an image generator`);
  throw new Error(`Unknown provider: ${name}`);
}
