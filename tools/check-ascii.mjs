import { loadProps } from '../src/layout/manifest.mjs';
import { deckTiles as deckCells, propCells, coverOf as roofCover, stairsOf, facesOf } from '../src/town-grid.mjs';
import { stairClearanceConflicts, describeStairConflict } from '../src/stair-clearance.mjs';
import { doorClearanceConflicts, describeDoorConflict } from '../src/door-clearance.mjs';

import { checkGroups } from './check-ascii/groups.mjs';
import { checkOccupancy } from './check-ascii/occupancy.mjs';
import { checkCanal } from './check-ascii/canal.mjs';
import { checkReachability } from './check-ascii/reachability.mjs';

// The complete --check used by ascii-town, also callable without spawning a process.
export function checkAscii(town, manifest, { regenerate, repo } = {}) {
  const propArt = loadProps(manifest);
  const deckTiles = (p) => deckCells(p, propArt);
  const propTilesOf = (p) => propCells(p, propArt);
  const coverOf = (b) => roofCover(b, manifest.archetypes);
  const faceCells = facesOf(town);
  const stairAt = stairsOf(town);
  const lines = [];
  const problems = [
    ...stairClearanceConflicts(town, manifest.archetypes, propArt).map(describeStairConflict),
    ...doorClearanceConflicts(town, manifest.archetypes).map(describeDoorConflict),
  ];
  const groups = checkGroups(town, repo, problems, lines);
  const { foot, blocked, deckT } = checkOccupancy(town, { deckTiles, propTilesOf, coverOf }, problems);
  const waterLandStripCount = checkCanal(town, { foot, faceCells, stairAt, deckTiles, propTilesOf }, problems);
  const { walkable, streets, reached } = checkReachability(town, { foot, blocked, deckT, faceCells }, problems);
  if (regenerate) {
    const again = JSON.stringify(regenerate());
    if (again !== JSON.stringify(town)) problems.push('同じ入力から違う街ができた');
  }
  let builtArea = 0;
  for (const b of town.buildings) builtArea += b.w * b.h;
  let inside = 0;
  for (const r of town.ground) for (const ch of r) if (ch !== ' ') inside++;
  lines.push(`check: 歩行面 ${walkable}（石畳 ${streets}）, 建物の占有率 ${(100 * builtArea / Math.max(1, inside)).toFixed(1)}%（街の内側に対して）, 到達 ${reached}, 水と水の間の陸帯 ${waterLandStripCount}`);
  if (problems.length) { lines.push(`問題 ${problems.length} 件:\n  ` + [...new Set(problems)].slice(0, 40).join('\n  ')); }
  else lines.push('check: OK（階段と前後2行・戸口前2行・重なり・隙間・屋根の余白・下の行・到達・決定性）');
  return { problems, lines, groups };
}
