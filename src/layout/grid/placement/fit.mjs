import { placementKey } from './key.mjs';
import { stairClearance } from '../../../stair-clearance.mjs';

// 候補の適合: 安い格子検査から戸口・階段へ進み、棄却順と短絡評価を保つ。
export function preparePlacementFit(P) {
  const { S, C, harbour, quay, id, road, plazaM, foot, front, roofZ, green, inG,
    hasGoal, reservedForCanal, reservedStairs, clearanceBuilding, coversApproach } = P;
  // footprint のすぐ下の行（と、通りまでの前庭）が通りにつながる位置か。
  // roofRows は外観の版の cover の最大値で、屋根が上の通り・建物を隠す余白だけを予約する。
  const fit = (t, x0, spec, setback, allowRoad = false) => {
    const { w, h, roofRows = 2 } = spec;
    if (x0 < t.x0 || x0 + w - 1 > t.x1) return null;
    let smin = 1e9;
    for (let x = x0; x < x0 + w; x++) { const s = t.sd[x - t.x0]; if (s < 0) return null; smin = Math.min(smin, s); }
    const yb = smin - 1 - setback, y = yb - h + 1;
    if (C.rejectedPlacements?.has(placementKey(S.cols, S.rows, spec, x0, y))) return null;
    if (y < t.L.y0 + (t.L.closedTop ? 2 : 0) || y - roofRows < 1) return null;
    if (harbour && yb >= quay.top) return null;
    for (let x = x0; x < x0 + w; x++) {
      // 橋の欄干・取り付け道を、扉の直下へ重ねない。
      if (reservedForCanal(x, yb + 1) || reservedForCanal(x, yb + 2)) return null;
      for (let yy = y; yy <= yb; yy++) {
        const k = id(x, yy);
        if (reservedForCanal(x, yy) || (!allowRoad && road[k] >= 0) || plazaM[k] || foot[k] >= 0 || front[k] || roofZ[k] || (harbour && green[k]) || (green[k] && !allowRoad)) return null;
      }
      // 裏は cover 行だけあける。cover が0の版は建物のすぐ上まで別の建物を置ける。
      for (let yy = y - roofRows; yy < y; yy++) {
        const k = id(x, yy);
        if (inG(x, yy) && (reservedForCanal(x, yy) || (!allowRoad && road[k] >= 0) || plazaM[k] || foot[k] >= 0 || front[k] || roofZ[k])) return null;
      }
      for (let yy = yb + 1; yy < t.sd[x - t.x0]; yy++) {
        const k = id(x, yy);
        if (reservedForCanal(x, yy) || foot[k] >= 0 || road[k] >= 0) return null;
      }
    }
    // 横の壁は接してよい。新しい footprint 内の foot 衝突は上の検査で防ぐ。
    if (P.hitsPinOther(x0, y, x0 + w - 1, yb)) return null;
    // 安い格子検査を通った候補だけ、既存の戸口と候補の戸口を双方向に検査する。
    // 現在の placed だけを見るので、group の仮置きを巻き戻しても予約が残らない。
    const candidate = clearanceBuilding(spec, { x: x0, y });
    if (reservedStairs.some((r) => coversApproach(candidate, r))) return null;
    if (P.placed.some((p) => coversApproach(candidate, p.clearance.approach) ||
      coversApproach(p.clearance, candidate.approach))) return null;
    // Overlay landmarks also leave the entire first front row of every building
    // clear. Ordinary door clearance alone covers only the doorway columns.
    const firstRow = (b) => ({ x0: b.x, x1: b.x + b.w - 1, y0: b.y + b.h, y1: b.y + b.h });
    if (hasGoal && P.placed.some((p) => (spec.goalSite && coversApproach(candidate, firstRow(p))) ||
      (p.spec.goalSite && coversApproach(p.clearance, firstRow(candidate))))) return null;
    if (spec.goalSite) {
      if (S.terraces.some((t) => coversApproach({ ...candidate, h: h + 2 }, stairClearance({ ...t.stair, y: t.y + t.h })))) return null;
      const level = (x, yy) => S.terraces.filter((t) => x >= t.x && x < t.x + t.w && yy >= t.y && yy < t.y + t.h).length;
      const baseLevel = level(x0 + 1, y);
      for (let yy = y; yy < y + h; yy++) for (let x = x0 + 1; x < x0 + w - 1; x++) {
        if (level(x, yy) !== baseLevel) return null;
      }
      // The front and sides must not straddle a retaining wall, even when its
      // stair happens to be elsewhere on the same terrace.
      for (const t of S.terraces) {
        const fy = t.y + t.h;
        if (fy >= y && fy <= yb + 2 && t.x < x0 + w && t.x + t.w > x0) return null;
      }
    }
    return { x: x0, y, w, h, yb };
  };
  P.fit = fit;
}
