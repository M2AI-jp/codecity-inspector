import { WINDOW, Y_WEIGHT, clamp } from '../constants.mjs';

// 切り出し前の格子・建物・候補位置。同じ種を再試行するときも、他の候補は変えない。
export const placementKey = (cols, rows, spec, x, y) => `${cols},${rows}:${spec.id}:${x},${y}`;

export function createPlacement(S) {
  const { C, harbour, quay, id, road, plazaM, foot, front, roofZ, green, inG, pinned, rng, pcy, pcx, tracks } = S;
  const canalReserve = new Set((C.canalReserve || []).map(([x, y]) => `${x},${y}`));
  const reservedForCanal = (x, y) => canalReserve.has(`${x},${y}`);

  // footprint のすぐ下の行（と、通りまでの前庭）が通りにつながる位置か。
  // roofRows は外観の版の cover の最大値で、屋根が上の通り・建物を隠す余白だけを予約する。
  const fit = (t, x0, spec, setback, allowRoad = false) => {
    const { w, h, roofRows = 2 } = spec;
    if (x0 < t.x0 || x0 + w - 1 > t.x1) return null;
    let smin = 1e9;
    for (let x = x0; x < x0 + w; x++) { const s = t.sd[x - t.x0]; if (s < 0) return null; smin = Math.min(smin, s); }
    const yb = smin - 1 - setback, y = yb - h + 1;
    if (C.stairRejected?.has(placementKey(S.cols, S.rows, spec, x0, y))) return null;
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
    if (hitsPinOther(x0, y, x0 + w - 1, yb)) return null;
    return { x: x0, y, w, h, yb };
  };
  // 予約した所（役場・船着場）には、その建物しか置かない
  S.pinOwner = null;
  const hitsPinOther = (x0, y0, x1, y1) => pinned.some((p, i) => i !== S.pinOwner && x0 <= p[2] && x1 >= p[0] && y0 <= p[3] && y1 >= p[1]);
  const placed = [];
  const commit = (spec, t, pos, group) => {
    const i = placed.length;
    for (let x = pos.x; x < pos.x + pos.w; x++) {
      for (let yy = pos.y; yy <= pos.yb; yy++) foot[id(x, yy)] = i;
      for (let yy = pos.y - (spec.roofRows ?? 2); yy < pos.y; yy++) roofZ[id(x, yy)] = 1;
      for (let yy = pos.yb + 1; yy < t.sd[x - t.x0]; yy++) front[id(x, yy)] = 1;
    }
    const p = { spec, ...pos, track: t, group, sd: Array.from({ length: pos.w }, (_, k) => t.sd[pos.x + k - t.x0]) };
    t.items.push(p);
    placed.push(p);
    return p;
  };

  // 広場からの「距離」。角度ごとに伸び縮みさせて、外周に出入りをつくる
  const harm = [2, 3, 5].map((k) => [k, rng() * 2 * Math.PI, 0.4 + rng() * 0.6]);
  const hsum = harm.reduce((t, h) => t + h[2], 0);
  const noise = (th) => harm.reduce((t, [k, p, a]) => t + a * Math.sin(k * th + p), 0) / hsum;
  const nominal = (t) => {
    const x = clamp(t.dir < 0 ? t.cursor - 3 : t.cursor + 3, t.x0, t.x1);
    const y = t.L.y1 - 3;
    const theta = Math.atan2(y - pcy, x - pcx);
    return { r: Math.hypot(x - pcx, (y - pcy) * Y_WEIGHT) / (1 + 0.16 * noise(theta)), theta };
  };
  // 面を切り替えるときも、既存の建物の近くにある面を優先する。
  // これで同じ地区の通りを順に埋め、広場の周囲に家を薄く散らさない。
  const trackAffinity = (t) => {
    let best = 1e9;
    for (const p of placed) {
      const px0 = p.x, px1 = p.x + p.w - 1, py0 = p.y, py1 = p.yb;
      const dx = px1 < t.L.x0 ? t.L.x0 - px1 : t.L.x1 < px0 ? px0 - t.L.x1 : 0;
      const dy = py1 < t.L.y0 ? t.L.y0 - py1 : t.L.y1 < py0 ? py0 - t.L.y1 : 0;
      best = Math.min(best, dx + dy);
    }
    return best === 1e9 ? 0 : best;
  };
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
  Object.assign(S, { fit, placed, commit, nominal, trackAffinity, advance, seek, trackAt });
}
