import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { validateWith } from '../schemas.mjs';

export async function readAssetDefinitions({ root = FORGE_ROOT } = {}) {
  const paths = pathsFor(root);
  const assets = [];
  for (const name of (await readdir(paths.definitions)).filter((item) => item.endsWith('.json')).sort()) {
    const catalog = JSON.parse(await readFile(path.join(paths.definitions, name), 'utf8'));
    const validation = validateWith('asset-catalog.schema.json', catalog);
    if (!validation.ok) throw new Error(`Invalid asset catalog ${name}: ${JSON.stringify(validation.errors)}`);
    assets.push(...catalog.assets);
  }
  return assets;
}
export async function findAsset(id, options) {
  const asset = (await readAssetDefinitions(options)).find((item) => item.id === id);
  if (!asset) throw new Error(`Unknown asset: ${id}`);
  return asset;
}
