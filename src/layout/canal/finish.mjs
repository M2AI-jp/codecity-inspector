import { DIRT, GRASS, STREET, WATER } from '../constants.mjs';

export function finishCanal(S) {
  const { bridgeDeckCells, bridgeSideReserve, opt, canalCells, cols, allStates, routePast, routeTo, cells, g, inG, id, original, bridgeCells, foot, buildingWalkRow, front, plazaM, terraceMask, bridgeProps, propArt, inC, deckCells, crossings, mouthProps } = S;
  const bridgeReserveCells = [
    ...bridgeDeckCells,
    ...bridgeSideReserve,
  ];
  if (opt.reserveOnly) return {
    reserveCells: [
      ...canalCells,
      ...bridgeReserveCells.map((k) => [k % cols, (k / cols) | 0]),
    ],
    states: allStates,
    past: routePast,
    to: routeTo,
  };
  for (const k of cells) g[k] = WATER;
  // finalize() が出口へ延ばした単独の土道が、水路の曲がり角の横に1マスだけ
  // 残ることがある。これは水路と平行な通りではないため、足元や扉を壊さない
  // 範囲で草地へ戻し、ascii の「水路の脇を通り・路地が流れる」を避ける。
  for (const k of cells) {
    const x = k % cols, y = (k / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inG(nx, ny)) continue;
      const nk = id(nx, ny);
      if ((original[nk] === STREET || original[nk] === DIRT) &&
        !bridgeCells.has(nk) && foot[nk] < 0 && !buildingWalkRow[nk] && !front[nk] && !plazaM[nk] && !terraceMask[nk]) g[nk] = GRASS;
    }
  }
  // bridge-h / bridge-v の deck は絵の都合で道路を前後2行覆う。
  // 1行幅の土の路地を横切る場合も、deck の水でないマスを橋の取り付け道にして
  // 草地が橋の下へ見えないようにする（footprint・水路上の建物には重ならない）。
  for (const p of bridgeProps) {
    const d = propArt[p.type].deck;
    const x0 = Math.floor((p.x * 16 + d[0]) / 16), x1 = Math.floor((p.x * 16 + d[0] + d[2] - 0.001) / 16);
    const y0 = Math.floor((p.y * 16 + d[1]) / 16), y1 = Math.floor((p.y * 16 + d[1] + d[3] - 0.001) / 16);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (inC(x, y) && g[id(x, y)] !== WATER && foot[id(x, y)] < 0) {
        g[id(x, y)] = original[id(x, y)] === GRASS ? STREET : DIRT;
      }
    }
  }
  // 橋の絵は通り1行より背が高い版もある。水でない deck の下だけを
  // 舗装にして、絵の端が草地・街の外へ浮かないようにする。
  for (const k of deckCells) if (!cells.has(k) && original[k] === GRASS) g[k] = STREET;
  return {
    cells: canalCells,
    states: allStates,
    from: 'well',
    past: routePast,
    to: routeTo,
    crossings: crossings.sort((a, b) => a.y - b.y || a.x - b.x),
    bridgeProps,
    mouthProps,
    bridgeCells: [...bridgeCells].map((k) => [k % cols, (k / cols) | 0]),
    bridgeDeckCells: [...bridgeDeckCells].map((k) => [k % cols, (k / cols) | 0]),
    bridgeReserveCells: bridgeReserveCells.map((k) => [k % cols, (k / cols) | 0]),
  };
}
