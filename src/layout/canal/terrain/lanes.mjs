import { WATER } from '../../constants.mjs';

// 水路の幅と外縁: 幅2マスの候補を揃え、港の水や地図端との並走を防ぐ。
export function prepareTerrainLanes(T) {
  const { id, quay, crop, original, inG, paved } = T;
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
  Object.assign(T, { laneCells, laneTouchesRoadSide, axis, dirs, sinkWater, parallelToWater, parallelToMapEdge });
}
