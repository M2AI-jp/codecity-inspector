import { STREET } from '../constants.mjs';

export function placeStreetProps(S) {
  const { P, lampAt, rng, tryProp, placed, pieces, kept, id, g, isGrass, pick } = S;
  // 小さな広場: 街灯と、ベンチか木（広ければ荷車）
  for (const sq of P.squares) {
    if (!sq.keep) continue;
    const w = sq.x1 - sq.x0 + 1;
    lampAt([[sq.x0, sq.y0], [sq.x1, sq.y0]], 12);
    const r = rng();
    if (r < 0.3 && w >= 7) {
      // 上端に置くと荷車の低い solid が上の通路の足元と接して、
      // クリック移動の経路が絵の境目で止まることがある。広場内で
      // 一マス下へ置き、通路の上端を空ける。
      const cartY = sq.y0 + 1 <= sq.y1 ? sq.y0 + 1 : sq.y0;
      tryProp('cart', sq.x1 - 3, cartY);
    }
    else if (r < 0.7) tryProp('bench', sq.x1 - 1, sq.y0);
    else { tryProp('tree', sq.x1, sq.y0); tryProp('bush', sq.x1 - 1, sq.y0); }
  }

  // 施設の扉のわきの街灯
  for (const p of placed) {
    if (!p.spec.facility) continue;
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    const near = dc - p.x < p.w / 2 ? [[p.x - 1, p.yb + 1], [p.x - 1, p.yb], [p.x + p.w, p.yb + 1], [p.x + p.w, p.yb]]
      : [[p.x + p.w, p.yb + 1], [p.x + p.w, p.yb], [p.x - 1, p.yb + 1], [p.x - 1, p.yb]];
    lampAt(near, 5);
  }
  // 通りの角（南北の通りが東西の通りに突き当たる所）の街灯。角どうしは離す
  for (const pc2 of pieces) {
    if (pc2.dir !== 'v' || !pc2.keep) continue;
    for (const [ey, by] of [[pc2.keep[1], pc2.keep[1] + 1], [pc2.keep[0], pc2.keep[0] - 1]]) {
      if (!kept(pc2.x0, by)) continue;                 // 突き当たる通りが無い（行き止まり）
      if (P.road[id(pc2.x0, by)] >= 0 && pieces[P.road[id(pc2.x0, by)]].grp === pc2.grp) continue;   // 同じ通りの段差
      const mainCorner = pc2.code === STREET && g[id(pc2.x0, by)] === STREET;                       // 路地・裏道の角には街灯を立てない
      const ys = by > ey ? [ey, ey - 1] : [ey, ey + 1];
      const cands = [];
      for (const y of ys) for (const x of [pc2.x0 - 1, pc2.x1 + 1]) if (isGrass(x, y)) cands.push([x, y]);
      if (!(mainCorner && lampAt(cands, 16)) && cands.length && rng() < 0.6) {
        // 角の花壇（鉢と植え込みを2〜3つ）
        const [fx, fy] = cands[Math.floor(rng() * cands.length)];
        for (const [dx, dy] of [[0, 0], [fx < pc2.x0 ? -1 : 1, 0], [0, fy > ey ? 1 : -1]]) if (isGrass(fx + dx, fy + dy) && rng() < 0.8) tryProp(pick(['planter', 'flowerpot', 'planter', 'bush']), fx + dx, fy + dy);
      }
    }
  }
}
