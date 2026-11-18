import { prepareOpening } from './gate/opening.mjs';
import { exitCandidates } from './gate/candidates.mjs';
import { prepareGateSite } from './gate/site.mjs';
import { prepareGatePath } from './gate/path.mjs';
import { tryGatePassage } from './gate/passage.mjs';
import { findGateKeeper } from './gate/keeper.mjs';
import { writeGate } from './gate/write.mjs';
import { placeEdgeGate } from './gate/edge.mjs';

export function placeGate(lm, ctx) {
  // S は門の定義と共有の地面、C は順に試す候補。処理とハッシュの順序を保つ。
  const S = { lm, ctx };
  if (!prepareOpening(S)) return null;
  for (const C of exitCandidates(S)) {
    if (!prepareGateSite(S, C)) continue;
    if (!prepareGatePath(S, C)) continue;
    const restore = tryGatePassage(S, C);
    const keeper = findGateKeeper(S, C);
    if (!keeper) { restore(); continue; }          // 置けない → 元に戻して次へ
    return writeGate(S, C, keeper);
  }
  return placeEdgeGate(S);
}
