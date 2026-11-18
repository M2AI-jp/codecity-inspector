// Load a saved town or build one from the repository and optional overlay.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { placeOverlay } from '../../src/overlay/place.mjs';
import { overlayLayoutOptions } from '../../src/overlay/layout-options.mjs';
import { analyzeOverlayModel, groupOverlayModel } from '../../src/overlay/model.mjs';
import { populateTown } from '../../src/overlay/town.mjs';

export async function townFor(target, manifest, overlay) {
  const abs = resolve(target);
  if (statSync(abs).isDirectory()) {
    const { analyzeRepository } = await import('../../src/analyze.mjs');
    const { layoutTown, loadArt, loadProps, loadGround } = await import('../../src/layout.mjs');
    const analyzed = overlay ? analyzeOverlayModel(abs) : analyzeRepository(abs);
    const repo = overlay ? groupOverlayModel(analyzed, overlay) : analyzed;
    const town = layoutTown(repo, { art: loadArt(manifest), props: loadProps(manifest), ground: loadGround(manifest), ...overlayLayoutOptions(overlay) });
    // codecity.mjs と同じく、生き物と代理人は group 前の解析結果から足す。
    populateTown(town, analyzed, abs);
    return { town: overlay ? placeOverlay(town, overlay, manifest) : town, repo };
  }
  const town = JSON.parse(readFileSync(abs, 'utf8'));
  if (overlay) throw new Error('--overlay requires a repository (town.json already contains its resolved overlay)');
  const missing = ['creatures', 'contractors'].filter((key) => !Array.isArray(town[key]));
  return { town, repo: null, warnings: missing.length
    ? [`${abs}: ${missing.join(', ')} が無いため populate 済みと確認できません。保存された Town を補完せず検査します。`] : [] };
}
