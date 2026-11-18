import { initializePropCells } from './context/cells.mjs';
import { reservePropSpace, reserveQuayTrees } from './context/reservations.mjs';
import { preparePropReachability } from './context/reachability.mjs';
import { prepareRemovableTiles } from './context/removable.mjs';
import { prepareSolidEdges } from './context/solid-edges.mjs';
import { preparePropPlacement } from './context/placement.mjs';
import { preparePropVisibility } from './context/visibility.mjs';
import { prepareLampPlacement } from './context/lamps.mjs';

// 予約・当たり・到達数を共有する。tryProp と finishLawn も同じ状態を使う。
export function createPropsContext(P, F, rng, spawn, extra) {
  const S = { P, F, rng, spawn, extra };
  // 内部の補助状態を返却値へ混ぜず、公開キーとその順序を保つ。
  const C = { S, P, F, rng, spawn, extra };
  initializePropCells(C);
  reservePropSpace(C);
  preparePropReachability(C);
  prepareRemovableTiles(C);
  C.lamps = [];
  prepareSolidEdges(C);
  preparePropPlacement(C);
  preparePropVisibility(C);
  prepareLampPlacement(C);
  reserveQuayTrees(C);
  const { cols, N, id, foot, front, roofZ, plaza, plazaM, placed, pieces, quay,
    g, gap, garden, inside, crop, dist, propArt, landmarks, bridgeCells, canalCells,
    has, inC, blocked, reserved, walk, props, out, doorRow, noTree, mark, flood,
    lamps, isPavedAt, tryProp, hidden, pick, lampAt, isGrass, kept } = C;
  return Object.assign(S, { cols, N, id, foot, front, roofZ, plaza, plazaM, placed, pieces, quay,
    g, gap, garden, inside, crop, dist, propArt, landmarks, bridgeCells, canalCells,
    has, inC, blocked, reserved, walk, props, out, doorRow, noTree, mark, flood,
    lamps, isPavedAt, tryProp, hidden, pick, lampAt, isGrass, kept });
}
