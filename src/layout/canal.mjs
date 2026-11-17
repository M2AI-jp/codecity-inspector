import { prepareTerrain } from './canal/terrain.mjs';
import { createSearch, createViaSearch } from './canal/search.mjs';
import { chooseEndpoints } from './canal/endpoints.mjs';
import { traceCanal } from './canal/route.mjs';
import { prepareCrossings } from './canal/crossings.mjs';
import { placeBridges } from './canal/bridges.mjs';
import { adjustBridges } from './canal/adjust.mjs';
import { finishCanal } from './canal/finish.mjs';
import { canalProblem, canalReservationProblem } from './canal/validate.mjs';

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
  const avoidCells = new Set();
  let problem = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const working = { ...F, g: F.g.slice() };
    const S = { P, F: working, repo, propArt, opt: { ...opt, avoidCells }, well, cannotPlace };
    prepareTerrain(S);
    createSearch(S);
    chooseEndpoints(S);
    createViaSearch(S);
    const failure = traceCanal(S);
    if (failure) return failure;
    prepareCrossings(S);
    placeBridges(S);
    adjustBridges(S);
    const result = finishCanal(S);
    problem = opt.reserveOnly ? canalReservationProblem(S) : canalProblem(S);
    if (!problem) {
      if (!opt.reserveOnly) F.g.set(working.g);
      return result;
    }
    if (opt.forcedStates || !problem.cells.length) break;
    // 水幅だけは通っても、橋の板・欄干・両岸が入らない交差部がある。
    // その交差部を探索から外して、同じ建物配置で別の流路を試す。
    for (const [x, y] of problem.cells) avoidCells.add(P.id(x, y));
  }
  return cannotPlace(problem.reason);
}
