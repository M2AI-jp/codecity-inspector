import { createPropsContext } from './props/context.mjs';
import { placeHarbourProps } from './props/harbour.mjs';
import { placeBoundaryProps } from './props/boundaries.mjs';
import { placePlazaProps } from './props/plaza.mjs';
import { placeBuildingProps } from './props/buildings.mjs';
import { placeStreetProps } from './props/streets.mjs';
import { placeGardenProps } from './props/gardens.mjs';
import { finishProps } from './props/lawn.mjs';

// 小物を置く順序と乱数生成器を保ち、到達性の状態を最後の芝生処理まで共有する。
export function placeProps(P, F, rng, spawn, extra) {
  const S = createPropsContext(P, F, rng, spawn, extra);
  placeHarbourProps(S);
  placeBoundaryProps(S);
  placePlazaProps(S);
  placeBuildingProps(S);
  placeStreetProps(S);
  placeGardenProps(S);
  return finishProps(S);
}
