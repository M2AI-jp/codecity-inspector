import { clamp } from './constants.mjs';
import { hash32 } from './util.mjs';
import { stairClearanceConflicts } from '../stair-clearance.mjs';
import { separateNearbyVariants } from './variants.mjs';

// 外観の版から扉と階段を確定し、後段の空き判定へ同じ寸法を渡す。
export function selectAttemptVariants(S) {
  const { landmarks, propArt, opts, P, art, doorVariants, canal, goalSpec } = S;
  const gateArt = landmarks.some((l) => l.data.archetype === 'gate') && propArt.gate;
  if (opts.debug) opts.debug.P = P;                  // 調べる道具のため（通り・街区の中身）
  // 出発点は段の下の広場の最初の行（段の前の壁の上には立たせない）
  const hallT = P.terraces.find((t) => t.hall);
  const spawn = { x: P.cx, y: hallT ? hallT.y + hallT.h + 1 : P.plaza.y0 + 2 };

  // 見た目の版: 近くに同じ archetype の同じ版が並ばないように選ぶ（同じ入力からは同じ選び方）
  const variantOf = new Map();
  for (const p of [...P.placed].sort((a, b) => a.yb - b.yb || a.x - b.x)) {
    const vs = art[p.spec.archetype]?.variants || [];
    if (doorVariants.has(p.spec.id)) { variantOf.set(p, doorVariants.get(p.spec.id)); continue; }
    if (vs.length < 2) { if (vs.length) variantOf.set(p, vs[0]); continue; }
    const near = new Map();
    for (const [q, v] of variantOf) {
      if (q.spec.archetype !== p.spec.archetype) continue;
      const dx = Math.max(0, Math.max(q.x, p.x) - Math.min(q.x + q.w, p.x + p.w));
      const dy = Math.abs(q.yb - p.yb);
      if (dx > 14 || dy > 12) continue;
      near.set(v.id, (near.get(v.id) || 0) + (dy <= 1 ? 3 : 1) * (dx <= 3 ? 2 : 1));
    }
    const start = hash32(p.spec.id) % vs.length;
    let best = null, bn = Infinity;
    for (let k = 0; k < vs.length; k++) {
      const v = vs[(start + k) % vs.length], n = near.get(v.id) || 0;
      if (n < bn) { bn = n; best = v; }
    }
    variantOf.set(p, best);
  }
  const applyVariants = () => { for (const p of P.placed) {
    p.doorCol = p.x + clamp(variantOf.get(p)?.doorX ?? p.spec.doorDx, 0, p.w - 1);
    p.wall = variantOf.get(p)?.wall || [0, 0];                // 絵の壁が footprint の端から内側にある幅（px、左・右）
    p.cover = variantOf.get(p)?.cover || null;                // 屋根が footprint の上にかぶさる行の数（列ごと）
  } };
  applyVariants();
  // 役場の段の階段: 版の扉の前に、扉の幅（2〜3マス、1マスの扉なら3マスで真ん中）
  for (const t of P.terraces) {
    if (!t.hall) continue;
    const hp = P.placed.find((p) => p.spec.archetype === 'town_hall');
    if (!hp) { t.drop = true; continue; }
    const dw = variantOf.get(hp)?.doorW ?? 1;
    // 基準の役場の階段は人物の背丈の約1.6倍（約2.6マス）なので3マス: 1マスの扉なら扉が真ん中、2マスの扉なら広場の中心の側へ1マス広げる
    const towardRight = hp.doorCol + 1 <= P.cx + 0.5;
    t.stair = dw >= 3 ? { x: hp.doorCol, w: dw } : dw === 2 ? { x: towardRight ? hp.doorCol : hp.doorCol - 1, w: 3 } : { x: hp.doorCol - 1, w: 3 };
    if (t.stair.x < t.x) t.stair.x = t.x;
    if (t.stair.x + t.stair.w > t.x + t.w) t.stair.x = t.x + t.w - t.stair.w;
  }
  // 広場の南階段: 広場幅に応じた4〜6マス。中央の井戸小屋を置けるよう、中央より1マス西へ寄せる。
  const plazaT = P.terraces.find((t) => t.plaza);
  if (plazaT) {
    const w = clamp(Math.round(plazaT.w / 2), 4, 6);
    const centered = plazaT.x + Math.floor((plazaT.w - w) / 2);
    plazaT.stair = { x: clamp(centered - 1, plazaT.x, plazaT.x + plazaT.w - w), w };
  }
  P.terraces = P.terraces.filter((t) => !t.drop);
  const dock = P.placed.find((p) => p.spec.archetype === 'dock');
  // 南階段の足元と前2行は、水路・橋・水口を置かない。運河を優先して
  // 置いたあと、広場内で空いている別の階段位置へ寄せる。
  const plazaTerrace = P.terraces.find((t) => t.plaza);
  if (plazaTerrace?.stair && canal?.cells?.length) {
    const stairY = plazaTerrace.y + plazaTerrace.h;
    const blocked = new Set(canal.cells.map(([x, y]) => P.id(x, y)));
    for (const [x, y] of canal.bridgeCells || []) blocked.add(P.id(x, y));
    for (const p of [...(canal.mouthProps || []), ...(canal.bridgeProps || [])]) {
      for (let y = p.y; y <= p.y + 1; y++) for (let x = p.x - 1; x <= p.x + 1; x++) {
        if (P.inG(x, y)) blocked.add(P.id(x, y));
      }
    }
    const sx0 = plazaTerrace.x, sx1 = plazaTerrace.x + plazaTerrace.w - plazaTerrace.stair.w;
    const preferred = plazaTerrace.x + Math.floor((plazaTerrace.w - plazaTerrace.stair.w) / 2);
    const choices = [];
    for (let x = sx0; x <= sx1; x++) choices.push(x);
    choices.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
    const clear = (x) => {
      for (let y = stairY - 2; y <= stairY + 2; y++) {
        for (let dx = 0; dx < plazaTerrace.stair.w; dx++) if (blocked.has(P.id(x + dx, y))) return false;
      }
      return stairClearanceConflicts({
        stairs: [{ x, y: stairY, w: plazaTerrace.stair.w }],
        props: [...(canal.mouthProps || []), ...(canal.bridgeProps || [])],
      }, art, propArt).length === 0;
    };
    const safe = choices.find(clear);
    if (safe !== undefined) plazaTerrace.stair.x = safe;
  }
  const clearanceArt = goalSpec ? { ...art, 'goal-site': {
    variants: [{ cover: Array(goalSpec.w).fill(goalSpec.roofRows) }],
  } } : art;
  separateNearbyVariants(P.placed, variantOf, clearanceArt,
    P.terraces.map((t) => ({ x: t.stair.x, y: t.y + t.h, w: t.stair.w })));
  applyVariants();
  Object.assign(S, { spawn, variantOf, dock, clearanceArt });
}
