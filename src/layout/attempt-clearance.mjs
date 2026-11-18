import { keepReachableTerraces } from './terraces.mjs';
import { placementKey } from './grid/placement.mjs';
import { stairClearance, stairClearanceConflicts } from '../stair-clearance.mjs';
import { doorClearanceConflicts } from '../door-clearance.mjs';

// 階段・戸口の衝突を次の試行の予約へ戻し、外側の再試行で同じ状態を共有する。
export function acceptAttemptClearance(S) {
  const { P, F, spawn, canal, rejectedPlacements, variantOf, clearanceArt, propArt,
    hasGroups, stairReservations, art, doorVariants, opts } = S;
  const isolated = keepReachableTerraces(P, F, spawn, canal?.bridgeDeckCells);
  if (isolated.length) {
    for (const p of isolated) rejectedPlacements.add(placementKey(P.cols, P.rows, p.spec, p.x, p.y));
    return false;
  }
  // 最終の階段位置と、選んだ版の列ごとの cover で確かめる（格子内座標）。
  const placedBuildings = P.placed.map((p) => ({
    ...p, id: p.spec.id, archetype: p.spec.archetype, variant: variantOf.get(p)?.id,
    door: { x: p.doorCol, y: p.yb },
  }));
  const stairConflicts = stairClearanceConflicts({
    stairs: P.terraces.map((t) => ({ x: t.stair.x, y: t.y + t.h, w: t.stair.w })),
    buildings: placedBuildings,
  }, clearanceArt, propArt);
  const doorConflicts = doorClearanceConflicts({ buildings: placedBuildings }, clearanceArt);
  if (stairConflicts.length || doorConflicts.length) {
    for (const { stair, object: p } of stairConflicts) {
      if (!hasGroups) {
        rejectedPlacements.add(placementKey(P.cols, P.rows, p.spec, p.x, p.y));
        continue;
      }
      // 担当の別棟が同じ階段を隠す再試行を繰り返さない。位置が確定した
      // 階段は、その格子で次に試す全候補へ確保範囲を渡す。
      const key = `${P.cols},${P.rows}`;
      if (!stairReservations.has(key)) stairReservations.set(key, new Map());
      stairReservations.get(key).set(`${stair.x},${stair.y},${stair.w}`, stairClearance(stair));
      // 最終選択で屋根の版が変わった場合も、その実寸を次の fit に渡す。
      const variant = art[p.archetype]?.variants?.find((v) => v.id === p.variant);
      if (variant) doorVariants.set(p.spec.id, variant);
      else rejectedPlacements.add(placementKey(P.cols, P.rows, p.spec, p.x, p.y));
    }
    // 近隣の見た目を比べて変えた版だけは fit 時点で未確定だった。
    // その版をすぐ固定し、衝突した組を一つずつ除いて全体を繰り返すのを避ける。
    if (doorConflicts.length) {
      if (opts.debug) opts.debug.doorRetries++;
      for (const p of P.placed) doorVariants.set(p.spec.id, variantOf.get(p) || { doorX: p.spec.doorDx, doorW: 1 });
    }
    return false;
  }
  return true;
}
