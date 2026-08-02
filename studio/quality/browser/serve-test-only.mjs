import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCodeCity, runCodeCity } from '../../../ship/90-cli/index.mjs';
import { createTestOnlyArt } from './test-only-art.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryPath = path.resolve(process.argv[2] ?? path.resolve(here, '../../..'));
const built = await buildCodeCity({ repositoryPath });
const art = createTestOnlyArt(built.worldPlan);
const running = await runCodeCity({ repositoryPath, ...art, noOpen: true, port: 0, write: () => {} });

process.stdout.write(`${JSON.stringify({
  kind: 'mechanical-browser-qa-only',
  browserUrl: running.browserUrl,
  delivery: 'immutable-memory-snapshot',
  investigations: running.townModel.investigations.candidates.length,
})}\n`);

const close = async () => { await running.close(); process.exit(0); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
await new Promise(() => {});
