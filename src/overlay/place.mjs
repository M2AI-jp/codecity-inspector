import { defaultManifest } from './place/identity.mjs';
import { initializeOverlay } from './place/initialize.mjs';
import { prepareSpace } from './place/space.mjs';
import { prepareCandidates } from './place/candidates.mjs';
import { placeLandmark } from './place/landmark.mjs';
import { placeMarkers } from './place/markers.mjs';
import { placePeople } from './place/people.mjs';
import { placeGoalLabel } from './place/label.mjs';
import { finishOverlay } from './place/finish.mjs';

export { defaultManifest, layoutKey } from './place/identity.mjs';

export function placeOverlay(base, overlay, manifest = defaultManifest()) {
  // 各段階が同じ配置と予約を更新する。候補・診断・ハッシュの順序を保つ。
  const S = { base, overlay, manifest };
  initializeOverlay(S);
  prepareSpace(S);
  prepareCandidates(S);
  placeLandmark(S);
  placeMarkers(S);
  placePeople(S);
  placeGoalLabel(S);
  return finishOverlay(S);
}
