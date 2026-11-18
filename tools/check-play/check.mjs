// Assemble the browser world and run checks without I/O or process exit.
// Geometry stays shared with overlay placement in src/overlay/geometry.mjs.
import { artFrom, buildWorld } from '../../src/overlay/geometry.mjs';
import { flood } from './reach.mjs';
import { checkBuildings } from './buildings.mjs';
import { checkTerrain } from './terrain.mjs';
import { checkKeepers, checkOutdoor } from './outdoor.mjs';
import { checkOverlay } from './overlay.mjs';
import { reportMissingKeepers, reportPlay } from './report.mjs';

export function checkPlay(town, manifest, { repo = null, verbose = false, target = 'town', t0 = performance.now() } = {}) {
  const art = artFrom(manifest);
  const lines = [], log = (...args) => lines.push(args.join(' '));
  const { world, npcs, start, warns } = buildWorld(town, art);
  const { seen, count } = flood(world, start);
  const overlayResult = checkOverlay(town, manifest, world, seen, log);
  const { overlay } = overlayResult;
  const buildings = checkBuildings(world, seen, start);
  const keepers = checkKeepers(town, world, npcs, seen);
  reportMissingKeepers(log, keepers);
  const terrain = checkTerrain(town, world, seen);
  const outdoor = checkOutdoor(town, repo, terrain.gates);
  const failed = overlayResult.failed + buildings.failed + keepers.failed + terrain.failed + outdoor.failed;
  const ms = Math.round(performance.now() - t0);
  reportPlay(log, { town, world, target, verbose, warns, count, ms, buildings, keepers, terrain, outdoor });
  return { failed, lines, problems: lines.filter((line) => /^  x /.test(line)), ...(overlay ? { overlay } : {}) };
}
