import { createFrameContext } from './frame/dimensions.mjs';
import { prepareFrameRoads } from './frame/roads.mjs';
import { drawMainStreet } from './frame/highway.mjs';
import { drawPlazaStreets } from './frame/plaza.mjs';
import { drawAvenues } from './frame/avenues.mjs';
import { drawWaterfront } from './frame/waterfront.mjs';

// 格子の大きさと、広場・役場・港を結ぶ通りの骨組み。
// 補助状態は F に閉じ、呼び出し側へ渡すキーと順番を保つ。
export function createFrame(C, scale) {
  const F = createFrameContext(C, scale);
  prepareFrameRoads(F);
  drawMainStreet(F);
  drawPlazaStreets(F);
  drawAvenues(F);
  drawWaterfront(F);
  const { groups, maxH, need, seed, fac, rng, ri, chance, harbour, cols, rows, N, id, inG, cx,
    road, pieces, addPiece, isRoad, pinned, hitsPin, roadGroups, meander, Htop, hMinTop, hMaxBot,
    px0, px1, py0, py1, plaza, plazaM, kx0, kx1, U, VW, VE, hall, aN, AN, aS, dirS, southEnd, AS, dockAt, quay } = F;
  return { C, scale, groups, maxH, need, seed, fac, rng, ri, chance, harbour, cols, rows, N, id, inG, cx,
    road, pieces, addPiece, isRoad, pinned, hitsPin, roadGroups, meander, Htop, hMinTop, hMaxBot,
    px0, px1, py0, py1, plaza, plazaM, kx0, kx1, U, VW, VE, hall, aN, AN, aS, dirS, southEnd, AS, dockAt, quay };
}
