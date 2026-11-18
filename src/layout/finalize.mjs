import { keepStreets } from './finalize/streets.mjs';
import { paintPlaza } from './finalize/plaza.mjs';
import { paintFrontages } from './finalize/frontages.mjs';
import { paintBlockPaths } from './finalize/paths.mjs';
import { cropTown } from './finalize/crop.mjs';
import { paintExits } from './finalize/exits.mjs';
import { trimTownEdges, classifyGrass } from './finalize/grass.mjs';

// ---------- 地面を塗る: 使った所だけ通りを残し、切り出し、外を「街の外」にする ----------
export function finalize(P, maxH, opt = {}) {
  const { N, id, inG, road, plazaM } = P;
  const g = new Uint8Array(N);
  const setG = (x, y, c) => { if (inG(x, y)) g[id(x, y)] = c; };
  const walk = (k) => road[k] >= 0 || plazaM[k];
  // 各段階が同じ地面と格子を更新する。処理と乱数の順序を保って結果を引き継ぐ。
  const S = { P, maxH, opt, g, setG, walk };
  keepStreets(S);
  paintPlaza(S);
  paintFrontages(S);
  paintBlockPaths(S);
  cropTown(S);
  paintExits(S);
  trimTownEdges(S);
  classifyGrass(S);
  const { gap, garden, inside, kept, crop, dist, exits } = S;
  return { g, gap, garden, inside, kept, crop, dist, exits };
}
