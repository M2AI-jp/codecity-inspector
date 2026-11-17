import { createFrame } from './grid/frame.mjs';
import { divideDistricts } from './grid/districts.mjs';
import { addSpaces } from './grid/spaces.mjs';
import { createTracks } from './grid/tracks.mjs';
import { createPlacement } from './grid/placement.mjs';
import { placeNeighbors } from './grid/neighbors.mjs';
import { placeBuildings } from './grid/buildings.mjs';

// 通り・街区・面・建物の順で、同じ乱数生成器と格子を引き継ぐ。
export function generate(C, scale) {
  const S = createFrame(C, scale);
  divideDistricts(S);
  addSpaces(S);
  createTracks(S);
  createPlacement(S);
  if (!placeNeighbors(S)) return null;
  if (!placeBuildings(S)) return null;
  const { cols, rows, N, id, inG, cx, aN, aS, dirS, Htop, road, pieces, plazaM, plaza, hall, quay,
    leaves, tracks, placed, foot, roofZ, front, green, pcx, pcy, kx0, kx1, U, squares, courts, terraces, groupUnplaced } = S;
  return { cols, rows, N, id, inG, cx, aN, aS, aSdir: dirS, Htop, road, pieces, plazaM, plaza, hall, quay, leaves, tracks, placed, foot, roofZ, front, green, pcx, pcy, kx0, kx1, U, squares: [...squares, ...courts], terraces, groupUnplaced };
}
