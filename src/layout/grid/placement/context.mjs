import { clamp } from '../../constants.mjs';
import { hash32 } from '../../util.mjs';
import { doorClearance } from '../../../door-clearance.mjs';
import { coverOf } from '../../../town-grid.mjs';

// 予約と形状: 初回と再試行で同じ版を参照し、候補ごとの実寸を共有する。
export function createPlacementContext(S) {
  const { C, harbour, quay, id, road, plazaM, foot, front, roofZ, green, inG, pinned, rng, pcy, pcx, tracks } = S;
  const hasGoal = C.fac?.early?.some((s) => s.goalSite);
  const canalReserve = new Set((C.canalReserve || []).map(([x, y]) => `${x},${y}`));
  const reservedForCanal = (x, y) => canalReserve.has(`${x},${y}`);
  const shapes = new Map();
  const reservedStairs = [...(C.stairReservations?.get(`${S.cols},${S.rows}`)?.values() || [])];
  const clearanceBuilding = (spec, pos) => {
    // 初回も版の選択開始位置で測る。最終の近隣比較で版が変わって衝突した
    // 場合だけ layoutTown が版を固定し、次の試行ではその実寸を使う。
    if (!shapes.has(spec.id)) {
      const vs = C.art?.[spec.archetype]?.variants || [];
      const v = C.doorVariants?.get(spec.id) || vs[hash32(spec.id) % vs.length];
      const b = { archetype: spec.archetype, variant: v?.id,
        door: { x: clamp(v?.doorX ?? spec.doorDx, 0, spec.w - 1), y: spec.h - 1 } };
      shapes.set(spec.id, { approach: spec.goalSite
        ? { x0: 0, x1: spec.w - 1, y0: spec.h, y1: spec.h + 1 } : doorClearance(b, C.art),
        cover: spec.goalSite ? Array(spec.w).fill(spec.roofRows) : coverOf(b, C.art) });
    }
    const { approach: r, cover } = shapes.get(spec.id);
    return {
      x: pos.x, y: pos.y, w: spec.w, h: spec.h,
      approach: { x0: pos.x + r.x0, x1: pos.x + r.x1, y0: pos.y + r.y0, y1: pos.y + r.y1 }, cover };
  };
  const coversApproach = (b, r) => {
    if (b.y + b.h - 1 < r.y0) return false;
    for (let x = Math.max(r.x0, b.x); x <= Math.min(r.x1, b.x + b.w - 1); x++) {
      if (b.y - (b.cover?.[x - b.x] ?? 2) <= r.y1) return true;
    }
    return false;
  };
  return { S, C, harbour, quay, id, road, plazaM, foot, front, roofZ, green, inG, pinned, rng, pcy, pcx, tracks,
    hasGoal, reservedForCanal, reservedStairs, clearanceBuilding, coversApproach };
}
