import { DIRT, GRASS, OUT, PLAZA, STREET, WATER } from '../../constants.mjs';
// マスの判定と小物の出力を用意し、後の段階が同じ配列を参照できるようにする。
export function initializePropCells(C) {
  const { P, F, extra } = C;
  const { cols, N, id, foot, front, roofZ, plaza, plazaM, placed, pieces, quay } = P;
  const { g, gap, garden, inside, crop, dist, yard } = F;
  const { propArt, landmarks, works, bridgeProps = [], mouthProps = [], bridgeCells = [], bridgeDeckCells = [], canalCells = [] } = extra;
  const has = (type) => !!propArt[type];
  const inC = (x, y) => x >= crop.x0 && y >= crop.y0 && x <= crop.x1 && y <= crop.y1;
  const blocked = new Uint8Array(N), reserved = new Uint8Array(N);
  const bridgeWalk = new Set(bridgeDeckCells.map(([x, y]) => id(x, y)));
  const walk = (x, y) => inC(x, y) && g[id(x, y)] !== OUT &&
    (g[id(x, y)] !== WATER || bridgeWalk.has(id(x, y))) && foot[id(x, y)] < 0 && !blocked[id(x, y)];
  const props = [...bridgeProps, ...mouthProps].map((p) => ({ ...p }));
  const out = { props, landmarks: [] };

  const isPavedAt = (x, y) => inC(x, y) && (g[id(x, y)] === STREET || g[id(x, y)] === DIRT || g[id(x, y)] === PLAZA || g[id(x, y)] === WATER);
  const isGrass = (x, y) => inC(x, y) && g[id(x, y)] === GRASS && foot[id(x, y)] < 0;
  const kept = (x, y) => inC(x, y) && (g[id(x, y)] === STREET || g[id(x, y)] === DIRT || g[id(x, y)] === PLAZA);
  Object.assign(C, { cols, N, id, foot, front, roofZ, plaza, plazaM, placed, pieces, quay,
    g, gap, garden, inside, crop, dist, propArt, landmarks, bridgeCells, canalCells, mouthProps,
    has, inC, blocked, reserved, walk, props, out, isPavedAt, isGrass, kept });
}
