import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { buildJob } from '../src/jobs/build-job.mjs';

test('catalog prompt paths cannot escape the prompt root', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-prompt-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'prompts'), path.join(root, 'prompts'), { recursive: true });
  const catalogPath = path.join(root, 'data', 'asset-definitions', 'characters.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  catalog.assets[0].promptFiles = ['prompts/common/../../data/manifests/assets.json'];
  await writeFile(catalogPath, JSON.stringify(catalog));
  await assert.rejects(() => buildJob({ assetId: catalog.assets[0].id }, { forgeRoot: root }), /Invalid asset catalog/);
});
