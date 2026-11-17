import { DIRT, GRASS, OUT, STREET, WATER } from '../constants.mjs';

export function prepareTerrain(S) {
  const { P, F, opt } = S;
  const { cols, rows, N, id, plaza, plazaM, foot, roofZ, front, road, pieces, placed, quay, terraces } = P;
  const { g, crop } = F;
  const original = g.slice();
  const inG = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const inC = (x, y) => x >= crop.x0 && y >= crop.y0 && x <= crop.x1 && y <= crop.y1;
  const terraceMask = new Uint8Array(N);
  for (const t of terraces || []) {
    for (let y = t.y; y <= t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) if (inG(x, y)) terraceMask[id(x, y)] = 1;
  }
  const doorFront = new Uint8Array(N);
  const buildingWalkRow = new Uint8Array(N);
  const facilityWalkRow = new Uint8Array(N);
  const fixedFoot = new Uint8Array(N), fixedRoof = new Uint8Array(N), fixedFront = new Uint8Array(N), fixedDoorFront = new Uint8Array(N);
  for (const p of placed) {
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    for (let x = p.x; x < p.x + p.w; x++) if (inG(x, p.yb + 1)) {
      buildingWalkRow[id(x, p.yb + 1)] = 1;
      if (p.spec.facility) facilityWalkRow[id(x, p.yb + 1)] = 1;
    }
    for (let x = p.x; x < p.x + p.w; x++) {
      for (let y = p.y; y <= p.yb; y++) if (inG(x, y) && p.spec.facility) fixedFoot[id(x, y)] = 1;
      for (let y = p.y - (p.spec.roofRows ?? 2); y < p.y; y++) if (inG(x, y) && p.spec.facility) fixedRoof[id(x, y)] = 1;
      for (let y = p.yb + 1; y < (p.track?.sd?.[x - p.track.x0] ?? p.yb + 1); y++) if (inG(x, y) && p.spec.facility) fixedFront[id(x, y)] = 1;
    }
    for (let y = p.yb + 1; y <= p.yb + 2; y++) if (inG(dc, y)) {
      doorFront[id(dc, y)] = 1;
      if (p.spec.facility) fixedDoorFront[id(dc, y)] = 1;
    }
  }
  const inPlaza = (x, y) => x >= plaza.x0 && x <= plaza.x1 && y >= plaza.y0 && y <= plaza.y1;
  const paved = (k) => original[k] === STREET || original[k] === DIRT;
  const roadDirAt = (x, y) => {
    if (!inG(x, y)) return null;
    const k = id(x, y), r = road[k];
    if (!paved(k)) return null;
    if (r >= 0 && pieces[r]) return pieces[r].dir;
    let h = 0, v = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0]]) {
      const q = id(x + dx, y);
      if (inG(x + dx, y) && paved(q)) {
        const rr = road[q];
        if (rr >= 0 && pieces[rr]?.dir === 'h') h++;
        else h += 0.5;
      }
    }
    for (const [dx, dy] of [[0, -1], [0, 1]]) {
      const q = id(x, y + dy);
      if (inG(x, y + dy) && paved(q)) {
        const rr = road[q];
        if (rr >= 0 && pieces[rr]?.dir === 'v') v++;
        else v += 0.5;
      }
    }
    return h > v && h > 0 ? 'h' : v > h && v > 0 ? 'v' : null;
  };
  // 水路は通りを横切るときだけ舗装地に入り、通りに沿って流れたり、
  // 通りのすぐ脇を長く流れたりしない。roadTurn は交差点・曲がり角の核。
  const roadTurn = new Uint8Array(N);
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    if (!paved(id(x, y))) continue;
    const rd = roadDirAt(x, y);
    if (!rd) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inG(nx, ny) || !paved(id(nx, ny))) continue;
      const nd = roadDirAt(nx, ny);
      if (nd && nd !== rd) {
        roadTurn[id(x, y)] = 1;
        roadTurn[id(nx, ny)] = 1;
      }
    }
  }
  const nearRoadTurn = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 2 || !inG(x + dx, y + dy)) continue;
      if (roadTurn[id(x + dx, y + dy)]) return true;
    }
    return false;
  };
  const laneCells = (x, y, d) => d % 2 ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]];
  const laneTouchesRoadSide = (x, y, d) => {
    const cells = laneCells(x, y, d);
    const own = new Set(cells.map(([cx, cy]) => `${cx},${cy}`));
    return cells.some(([cx, cy]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      return inG(nx, ny) && !own.has(`${nx},${ny}`) && paved(id(nx, ny));
    }));
  };
  const axis = (d) => d % 2 ? 'v' : 'h';
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const sinkWater = (x, y) => !!(quay && original[id(x, y)] === WATER && y >= quay.water0);
  // 港の水は終点の幅2マスだけに入れる。途中の経路が港の水を
  // 横切って別の終点へ抜けると、岸に沿う水路や細い陸の帯を作れる。
  const parallelToWater = (cells, flow) => {
    // 終点そのもの（幅2マスの港の水）は、港へ注ぐために許す。
    if (cells.length && cells.every(([x, y]) => sinkWater(x, y))) return false;
    const normal = flow === 'h' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    for (const [x, y] of cells) {
      for (const [dx, dy] of normal) {
        for (let n = 1; n <= 3; n++) {
          const nx = x + dx * n, ny = y + dy * n;
          if (inG(nx, ny) && sinkWater(nx, ny)) return true;
        }
      }
    }
    return false;
  };
  const parallelToMapEdge = (cells, flow) => cells.some(([x, y]) =>
    flow === 'h'
      ? y - crop.y0 <= 3 || crop.y1 - y <= 3
      : x - crop.x0 <= 3 || crop.x1 - x <= 3);
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
  Object.assign(S, { cols, rows, N, id, plaza, plazaM, foot, roofZ, front, road, pieces, placed, quay, g, crop, original, inG, inC, terraceMask, buildingWalkRow, facilityWalkRow, paved, roadDirAt, laneCells, laneTouchesRoadSide, dirs, sinkWater, laneAllowed });
}
