// 地形の基準: 水路で書き換える前の地面と、格子・切り出しの境界を共有する。
export function createTerrainContext(S) {
  const { P, F, opt } = S;
  const { cols, rows, N, id, plaza, plazaM, foot, roofZ, front, road, pieces, placed, quay, terraces } = P;
  const { g, crop } = F;
  const original = g.slice();
  const inG = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const inC = (x, y) => x >= crop.x0 && y >= crop.y0 && x <= crop.x1 && y <= crop.y1;
  return { opt, cols, rows, N, id, plaza, plazaM, foot, roofZ, front, road, pieces, placed, quay, terraces, g, crop, original, inG, inC };
}
