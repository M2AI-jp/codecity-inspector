import { createPlacementContext } from './placement/context.mjs';
import { preparePlacementFit } from './placement/fit.mjs';
import { preparePlacementCommit } from './placement/commit.mjs';
import { preparePlacementRanking } from './placement/ranking.mjs';
import { preparePlacementSearch } from './placement/search.mjs';

export { placementKey } from './placement/key.mjs';

// 補助状態は P で共有し、格子へ公開する関数と配列の順番を保つ。
export function createPlacement(S) {
  const P = createPlacementContext(S);
  preparePlacementFit(P);
  preparePlacementCommit(P);
  preparePlacementRanking(P);
  preparePlacementSearch(P);
  const { fit, placed, commit, nominal, trackAffinity, advance, seek, trackAt } = P;
  Object.assign(S, { fit, placed, commit, nominal, trackAffinity, advance, seek, trackAt });
}
