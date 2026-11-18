import { placeOrdinaryBuildings } from './buildings/ordinary.mjs';
import { placeGroups } from './groups.mjs';

// 通常の配置を先に確定し、その結果を使って明示された担当地区をまとめる。
export function placeBuildings(S) {
  if (!placeOrdinaryBuildings(S)) return null;
  placeGroups(S);
  return true;
}
