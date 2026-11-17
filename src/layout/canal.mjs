import { prepareTerrain } from './canal/terrain.mjs';
import { createSearch, createViaSearch } from './canal/search.mjs';
import { chooseEndpoints } from './canal/endpoints.mjs';
import { traceCanal } from './canal/route.mjs';
import { prepareCrossings } from './canal/crossings.mjs';
import { placeBridges } from './canal/bridges.mjs';
import { adjustBridges } from './canal/adjust.mjs';
import { finishCanal } from './canal/finish.mjs';

export { chooseCanalRoute } from './canal/route.mjs';

// ---------- 井戸から流れる水路（橋の絵が両向きそろったときだけ） ----------
export function buildCanal(P, F, repo, propArt, opt = {}) {
  const well = (repo.facilities || []).find((f) => f.archetype === 'well' && f.facts);
  const cannotPlace = (reason) => ({
    unplaced: { archetype: 'canal', name: '水路', reason },
  });
  if (!well) return null;
  if (!propArt['bridge-h']?.deck || !propArt['bridge-v']?.deck) {
    return cannotPlace('橋を両方向に歩ける絵・deck がそろっていない');
  }
  // 探索・交差部の調整・地面への反映の順に、同じ格子と元の地面を渡す。
  const S = { P, F, repo, propArt, opt, well, cannotPlace };
  prepareTerrain(S);
  createSearch(S);
  chooseEndpoints(S);
  createViaSearch(S);
  const failure = traceCanal(S);
  if (failure) return failure;
  prepareCrossings(S);
  placeBridges(S);
  adjustBridges(S);
  return finishCanal(S);
}
