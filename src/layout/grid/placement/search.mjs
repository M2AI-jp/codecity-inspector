import { WINDOW } from '../../constants.mjs';

// 探索と前進: 隣家の間隔の状態を保ち、面ごとの候補を元の順に試す。
export function preparePlacementSearch(P) {
  const { C, rng, fit, tracks } = P;
  // 同じ通りの隣は、壁を接する0マスを中心に、1マス・2マスの路地を混ぜる。
  // 3マス以上は作らない。小さな街でも路地が一つは見えるよう、
  // 先頭から数回の隣接で、次の建物を置ける余地があるときだけ2を保証する。
  let gapDecisions = 0;
  let forcedGapDone = false;
  const forceGapAt = Math.max(3, Math.min(4, Math.floor(C.count / 4)));
  const nextGap = (t, pos) => {
    gapDecisions++;
    const remaining = t.dir < 0 ? pos.x - t.x0 : t.x1 - (pos.x + pos.w - 1);
    const roomForAnother = remaining >= 2 + 4;
    const smallStreetGap = C.count <= 10 && t.dense && t.items.length === 2;
    if (roomForAnother && !forcedGapDone && (smallStreetGap || gapDecisions >= forceGapAt)) {
      forcedGapDone = true;
      return 2;
    }
    const r = rng();
    return r < 0.5 ? 0 : r < 0.9 ? 1 : 2;
  };
  const advance = (t, pos) => {
    const gap = nextGap(t, pos);
    t.cursor = t.dir < 0 ? pos.x - gap - 1 : pos.x + pos.w + gap;
    if (t.dir < 0 ? t.cursor < t.x0 : t.cursor > t.x1) t.closed = true;
  };
  const seek = (t, s, span = WINDOW, allowRoad = false) => {
    for (let k = 0; k <= span; k++) {
      const x0 = t.dir < 0 ? t.cursor - k - s.w + 1 : t.cursor + k;
      if (t.dir < 0 ? x0 < t.x0 : x0 + s.w - 1 > t.x1) return null;
      const pos = fit(t, x0, s, 0, allowRoad || !!t.dense);
      if (pos) return pos;
    }
    return null;
  };
  const trackAt = (x, y) => tracks
    .filter((t) => x >= t.x0 && x <= t.x1 && y >= t.L.y0 && y <= t.L.y1)
    .sort((a, b) => Math.abs(a.L.y1 - y) - Math.abs(b.L.y1 - y) || Number(!!b.dense) - Number(!!a.dense))[0];
  Object.assign(P, { advance, seek, trackAt });
}
