// Load a saved town or build one from the repository and optional overlay.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { placeOverlay } from '../../src/overlay/place.mjs';
import { overlayLayoutOptions } from '../../src/overlay/layout-options.mjs';
import { analyzeOverlayModel, groupOverlayModel } from '../../src/overlay/model.mjs';

export async function townFor(target, manifest, overlay) {
  const abs = resolve(target);
  if (statSync(abs).isDirectory()) {
    const { analyzeRepository } = await import('../../src/analyze.mjs');
    const { layoutTown, loadArt, loadProps, loadGround } = await import('../../src/layout.mjs');
    const repo = overlay ? groupOverlayModel(analyzeOverlayModel(abs), overlay) : analyzeRepository(abs);
    const town = layoutTown(repo, { art: loadArt(manifest), props: loadProps(manifest), ground: loadGround(manifest), ...overlayLayoutOptions(overlay) });
    return { town: overlay ? placeOverlay(town, overlay, manifest) : town, repo };
  }
  const town = JSON.parse(readFileSync(abs, 'utf8'));
  if (overlay) throw new Error('--overlay requires a repository (town.json already contains its resolved overlay)');
  return { town, repo: null };
}
