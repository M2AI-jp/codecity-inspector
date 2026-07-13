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
  const referencesFile = path.join(root, 'data', 'manifests', 'references.json');
  const references = JSON.parse(await readFile(referencesFile, 'utf8'));
  for (const reference of references.references) {
    if (reference.status === 'pending') {
      reference.status = 'missing';
      reference.sha256 = null;
    }
  }
  await writeFile(referencesFile, JSON.stringify(references));
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
  const fieldFile = path.join(root, 'data', 'asset-definitions', 'fields.json');
  const fields = JSON.parse(await readFile(fieldFile, 'utf8'));
  fields.assets.find((asset) => asset.id === 'field.sand').gameBinding.runtimeBindings = [];
  await writeFile(fieldFile, JSON.stringify(fields));
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_REFERENCE_DECLARATION'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNREPORTED_RUNTIME_GAP' && issue.runtimeId === 'sand'));
});

test('cross-file validation reports unknown reference targets', async () => {
  const root = await fixtureRoot();
  const referencesFile = path.join(root, 'data', 'manifests', 'references.json');
  const references = JSON.parse(await readFile(referencesFile, 'utf8'));
  references.references[0].targetAssetIds = ['building.not_declared'];
  await writeFile(referencesFile, JSON.stringify(references));
  const result = await validateRepository({ root });
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_REFERENCE_TARGET'
    && issue.targetAssetId === 'building.not_declared'));
});
