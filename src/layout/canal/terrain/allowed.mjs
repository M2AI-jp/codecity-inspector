import { DIRT, GRASS, OUT, STREET, WATER } from '../../constants.mjs';

// 候補の可否: 予約・道路・岸を元の順に調べ、同じ短絡評価で水路の通り道を選ぶ。
export function prepareTerrainAllowed(T) {
  const { opt, id, plazaM, foot, roofZ, front, original, inG, inC, terraceMask, doorFront,
    buildingWalkRow, facilityWalkRow, fixedFoot, fixedRoof, fixedFront, fixedDoorFront, inPlaza,
    paved, roadDirAt, nearRoadTurn, laneCells, axis, dirs, sinkWater, parallelToWater, parallelToMapEdge } = T;
  const laneAllowed = (x, y, d, goal = false) => {
    const cells = laneCells(x, y, d);
    const flow = axis(d);
    const perpendicular = flow === 'v' ? 'h' : 'v';
    let hasCrossRoad = false;
    const adjacentRoads = [];
    const crossingRoadCells = [];
    for (const [cx, cy] of cells) {
      if (!inC(cx, cy)) return false;
      const k = id(cx, cy);
      if (opt.avoidCells?.has(k)) return false;
       const building = opt.ignoreBuildings ? fixedFoot[k] : foot[k] >= 0;
       const roof = opt.ignoreBuildings ? fixedRoof[k] : roofZ[k];
       const fore = opt.ignoreBuildings ? fixedFront[k] : front[k];
       const door = opt.ignoreBuildings ? fixedDoorFront[k] : doorFront[k];
       const buildingFront = buildingWalkRow[k] && !paved(k);
       if (inPlaza(cx, cy) || plazaM[k] || building || roof || fore || door ||
         facilityWalkRow[k] || buildingFront || terraceMask[k]) return false;
      if (original[k] === OUT && !goal) return false;
      if (original[k] === WATER && !(goal && sinkWater(cx, cy))) return false;
      if (![GRASS, STREET, DIRT, OUT, WATER].includes(original[k])) return false;
      const rd = roadDirAt(cx, cy);
      if (rd) {
        if (rd !== perpendicular) return false;
        hasCrossRoad = true;
        crossingRoadCells.push([cx, cy]);
        continue;
      }
      // 水セルのすぐ隣に舗装地があるときは、同じ状態の lane が
      // その通りを実際に横切っている場合だけ許す。通りの直前・直後を
      // ただの草地として通してしまうと、橋の無い並走ができてしまう。
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!inG(nx, ny) || !paved(id(nx, ny))) continue;
        adjacentRoads.push({ x: nx, y: ny, dir: roadDirAt(nx, ny), cx, cy });
      }
    }
    if (adjacentRoads.some(({ dir }) => dir !== perpendicular)) return false;
    if (adjacentRoads.length && !hasCrossRoad) {
      const hasRoadAhead = adjacentRoads.every(({ x: rx, y: ry, cx, cy }) => {
        const dx = rx - cx, dy = ry - cy;
        if (!(dx === dirs[d][0] && dy === dirs[d][1]) && !(dx === -dirs[d][0] && dy === -dirs[d][1])) return false;
        return laneCells(x + dirs[d][0], y + dirs[d][1], d).some(([lx, ly]) => paved(id(lx, ly))) ||
          laneCells(x - dirs[d][0], y - dirs[d][1], d).some(([lx, ly]) => paved(id(lx, ly)));
      });
      if (!hasRoadAhead) return false;
    }
    if (parallelToWater(cells, flow) || parallelToMapEdge(cells, flow)) return false;
    if (hasCrossRoad) {
      const alongRoad = perpendicular === 'h' ? [1, 0] : [0, 1];
      const alongValues = crossingRoadCells.map(([cx, cy]) => alongRoad[0] ? cx : cy);
      const minAlong = Math.min(...alongValues), maxAlong = Math.max(...alongValues);
      const first = crossingRoadCells[0];
      const reachesBothSides = alongRoad[0]
        ? inG(minAlong - 1, first[1]) && inG(maxAlong + 1, first[1]) &&
          paved(id(minAlong - 1, first[1])) && paved(id(maxAlong + 1, first[1]))
        : inG(first[0], minAlong - 1) && inG(first[0], maxAlong + 1) &&
          paved(id(first[0], minAlong - 1)) && paved(id(first[0], maxAlong + 1));
      if (!reachesBothSides) return false;
    }
    if (hasCrossRoad) {
      const centerX = Math.round(cells.reduce((n, [cx]) => n + cx, 0) / cells.length);
      const centerY = Math.round(cells.reduce((n, [, cy]) => n + cy, 0) / cells.length);
      if (nearRoadTurn(centerX, centerY)) return false; // 橋の中心が曲がり角から2マス以内なら渡さない
    }
    return true;
  };
  T.laneAllowed = laneAllowed;
}
