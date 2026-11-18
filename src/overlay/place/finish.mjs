import { hash } from './identity.mjs';
// 全配置後の診断を取り込み、同じデータとキー順から revision を確定する。
export function finishOverlay(S) {
  const { town, data } = S;
  data.unplaced = town.unplaced.filter((u) => u.overlay);
  data.revision = hash(data);
  town.overlay = data;
  return town;
}
