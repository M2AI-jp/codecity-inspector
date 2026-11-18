import { createTerrainContext } from './terrain/context.mjs';
import { prepareTerrainReservations } from './terrain/reservations.mjs';
import { prepareTerrainRoads } from './terrain/roads.mjs';
import { prepareTerrainLanes } from './terrain/lanes.mjs';
import { prepareTerrainAllowed } from './terrain/allowed.mjs';

// 補助状態は T で共有し、水路の探索へ公開するキーと順番を保つ。
export function prepareTerrain(S) {
  const T = createTerrainContext(S);
  prepareTerrainReservations(T);
  prepareTerrainRoads(T);
  prepareTerrainLanes(T);
  prepareTerrainAllowed(T);
  const { cols, rows, N, id, plaza, plazaM, foot, roofZ, front, road, pieces, placed, quay, g, crop, original, inG, inC, terraceMask, buildingWalkRow, facilityWalkRow, paved, roadDirAt, laneCells, laneTouchesRoadSide, dirs, sinkWater, laneAllowed } = T;
  Object.assign(S, { cols, rows, N, id, plaza, plazaM, foot, roofZ, front, road, pieces, placed, quay, g, crop, original, inG, inC, terraceMask, buildingWalkRow, facilityWalkRow, paved, roadDirAt, laneCells, laneTouchesRoadSide, dirs, sinkWater, laneAllowed });
}
