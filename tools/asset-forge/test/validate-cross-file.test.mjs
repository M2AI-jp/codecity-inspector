import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FORGE_ROOT } from '../src/config.mjs';
import { validateRepository } from '../src/validate.mjs';

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-validate-'));
  await cp(path.join(FORGE_ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  await cp(path.join(FORGE_ROOT, 'prompts'), path.join(root, 'prompts'), { recursive: true });
  return root;
}

test('cross-file validation reports malformed JSON instead of crashing', async () => {
  const root = await fixtureRoot();
  await writeFile(path.join(root, 'data', 'asset-definitions', 'characters.json'), '{broken');
  const result = await validateRepository({ root });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'MALFORMED_JSON'));
});

test('cross-file validation reports duplicate asset IDs', async () => {
  const root = await fixtureRoot();
  const file = path.join(root, 'data', 'asset-definitions', 'characters.json');
  const catalog = JSON.parse(await readFile(file, 'utf8'));
  catalog.assets.push(structuredClone(catalog.assets[0]));
  await writeFile(file, JSON.stringify(catalog));
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_ID' && issue.id === catalog.assets[0].id));
});

test('cross-file validation reports undeclared references and unreported runtime gaps', async () => {
  const root = await fixtureRoot();
  const characterFile = path.join(root, 'data', 'asset-definitions', 'characters.json');
  const characters = JSON.parse(await readFile(characterFile, 'utf8'));
  characters.assets[0].defaultReferenceIds = ['missing_reference'];
  await writeFile(characterFile, JSON.stringify(characters));
  const coverageFile = path.join(root, 'data', 'manifests', 'runtime-coverage.json');
  const coverage = JSON.parse(await readFile(coverageFile, 'utf8'));
  coverage.uncovered = coverage.uncovered.filter((entry) => !(entry.vocabulary === 'TILE_TYPES' && entry.runtimeId === 'sand'));
  await writeFile(coverageFile, JSON.stringify(coverage));
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_REFERENCE_DECLARATION'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNREPORTED_RUNTIME_GAP' && issue.runtimeId === 'sand'));
});
