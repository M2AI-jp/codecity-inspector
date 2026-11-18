import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { propCellsOf } from './occupancy.mjs';
import { footprintOf } from './footprint.mjs';
import { gapsOf } from './gaps.mjs';
import { backOf } from './back.mjs';
import { lawnOf } from './lawn.mjs';
import { plazaEdgeOf } from './plaza.mjs';

export function measure(file, manifest, propArt, root) {
  const town = JSON.parse(readFileSync(file, 'utf8'));
  const { cols, rows, buildings } = town;
  const props = propCellsOf(town, propArt);
  const { foot, footprint, inside } = footprintOf(town);
  const gaps = gapsOf(town);
  const back = backOf(town, manifest, props, foot);
  const lawnMax = lawnOf(town, manifest, props, foot, file, root);
  return {
    name: town.repo?.name || basename(file, '.json'),
    size: `${cols}×${rows}`,
    buildings: buildings.length,
    ratio: `${footprint}/${inside} (${(100 * footprint / Math.max(1, inside)).toFixed(1)}%)`,
    gaps: gaps.join('/'),
    back: back.join('/'),
    plazaEdge: plazaEdgeOf(town),
    lawnMax,
  };
}
