import { DIRT, STREET } from '../../constants.mjs';

// 通りの向きと曲がり角: 水路を直角に渡し、橋を曲がり角から離すための判定を共有する。
export function prepareTerrainRoads(T) {
  const { N, id, road, pieces, crop, original, inG } = T;
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
  Object.assign(T, { paved, roadDirAt, nearRoadTurn });
}
