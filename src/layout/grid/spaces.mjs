import { STREET, Y_WEIGHT } from '../constants.mjs';

export function addSpaces(S) {
  const { C, isRoad, inG, plazaM, id, road, pieces, hitsPin, addPiece, chance, ri, cx, py0, py1, leaves, rng, hall, plaza } = S;
  // ---- ずれた通りのせいで1〜3マス届かなくなった通りの端は、届くまでのばす（行き止まりにしない）
  {
    const walk0 = (x, y) => isRoad(x, y) || (inG(x, y) && plazaM[id(x, y)]);
    const n0 = pieces.length;
    for (let i = 0; i < n0; i++) {
      const pc = pieces[i];
      if (pc.kind === 'square' || pc.kind === 'court' || pc.kind === 'quay' || pc.kind === 'high' || pc.kind === 'plaza') continue;
      for (const [dx, dy] of pc.dir === 'v' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]) {
        const cells = [];
        if (pc.dir === 'v') { const y = dy > 0 ? pc.y1 : pc.y0; for (let x = pc.x0; x <= pc.x1; x++) cells.push([x, y]); }
        else { const x = dx > 0 ? pc.x1 : pc.x0; for (let y = pc.y0; y <= pc.y1; y++) cells.push([x, y]); }
        if (cells.some(([x, y]) => walk0(x + dx, y + dy))) continue;
        let reach = 0;
        for (let k = 2; k <= 4 && !reach; k++) if (cells.some(([x, y]) => walk0(x + dx * k, y + dy * k))) reach = k;
        if (!reach) continue;
        const xs = cells.map(([x]) => x + dx), ys = cells.map(([, y]) => y + dy);
        const ex0 = Math.min(...xs, ...xs.map((x) => x + dx * (reach - 2))), ex1 = Math.max(...xs, ...xs.map((x) => x + dx * (reach - 2)));
        const ey0 = Math.min(...ys, ...ys.map((y) => y + dy * (reach - 2))), ey1 = Math.max(...ys, ...ys.map((y) => y + dy * (reach - 2)));
        if (hitsPin(ex0, ey0, ex1, ey1)) continue;
        addPiece(pc.dir, ex0, ey0, ex1, ey1, pc.code, pc.kind, pc.grp);
      }
    }
  }

  // ---- 小さな広場: 南北の通りが東西の通りに上から突き当たる所の、いくつかの角を舗装する（同じ通りの段差は除く）
  const squares = [];
  const bottoms = new Map();
  for (const p of pieces) if (p.dir === 'v' && (p.kind === 'street' || p.kind === 'alley' || p.kind === 'avenue') && (!bottoms.has(p.grp) || p.y1 > bottoms.get(p.grp).y1)) bottoms.set(p.grp, p);
  for (const pc of bottoms.values()) {
    const hy = pc.y1 + 1;
    const below = isRoad(pc.x0, hy) ? pieces[road[id(pc.x0, hy)]] : null;
    if (!below || below.dir !== 'h' || below.kind === 'quay' || below.grp === pc.grp || below.kind === 'court') continue;
    if (!chance(squares.length ? (pc.kind === 'alley' ? 0.2 : 0.35) : 0.8)) continue;
    const k = ri(2, 3), d = ri(2, 3);
    const x0 = pc.x0 - k, x1 = pc.x1 + k, y0 = hy - d, y1 = hy - 1;
    if (hitsPin(x0 - 1, y0 - 1, x1 + 1, y1)) continue;
    let ok = true;
    // 角の中に入ってよいのは、突き当たる2本の通りだけ（段差の分）
    for (let y = y0; y <= y1 && ok; y++) for (let x = x0; x <= x1; x++) {
      const r = isRoad(x, y) ? pieces[road[id(x, y)]].grp : -1;
      if ((r >= 0 && r !== pc.grp && r !== below.grp) || plazaM[id(x, y)]) { ok = false; break; }
    }
    if (!ok) continue;
    const k2 = addPiece('h', x0, y0, x1, y1, STREET, 'square');
    if (k2 >= 0) squares.push(pieces[k2]);
  }

  // ---- 小さな緑地: 狭い街区のいくつかと、広場の近くにひとつ
  const pcx = cx, pcy = (py0 + py1) / 2;
  const distOf = (L) => Math.hypot((L.x0 + L.x1) / 2 - pcx, ((L.y0 + L.y1) / 2 - pcy) * Y_WEIGHT);
  // 緑地は建物 15 棟に1つほど（狭い街区のうち、広場に近いものから）。増やしすぎると街が森に食われる
  {
    const cap = Math.max(1, Math.round(C.count / 15));
    const small = leaves.filter((L) => !L.flank && L.x1 - L.x0 + 1 >= 6 && L.x1 - L.x0 + 1 <= 11 && L.y1 - L.y0 + 1 <= 11 && !hitsPin(L.x0, L.y0, L.x1, L.y1))
      .map((L) => [distOf(L) + 25 * rng(), L]).sort((a, b) => a[0] - b[0]);
    for (const [, L] of small.slice(0, cap)) L.green = true;
  }
  if (!leaves.some((L) => L.green && distOf(L) < 36)) {
    const c = leaves.filter((L) => !L.flank && L.x1 - L.x0 + 1 >= 8 && L.x1 - L.x0 + 1 <= 16 && distOf(L) < 36 && !hitsPin(L.x0, L.y0, L.x1, L.y1))
      .sort((a, b) => distOf(a) - distOf(b));
    if (c.length) c[Math.min(c.length - 1, ri(0, 2))].green = true;
  }

  // ---- 段（terrace）: 広場全体を大通りより一段高くし、役場はその上の段に重ねる。
  // 広場の南の壁は大通りに向き、階段はあとで版・井戸小屋の位置を見て決める。
  // ほかに、下に通りのある小さな緑地をひとつ段にする（壁は緑地の下の端、階段は真ん中）
  const terraces = [];
  // 役場の扉の前は段の上の前庭が2行（基準の絵の踊り場。建物が段の上に立っているのが分かる）。前の壁はその下の行
  if (hall) terraces.push({ x: hall.x - 1, y: hall.y - 2, w: hall.w + 2, h: plaza.y0 - (hall.y - 2) + 2, hall: true });
  {
    const cand = leaves.filter((L) => L.green && L.x1 - L.x0 + 1 >= 6 && L.y1 - L.y0 + 1 >= 5 && L.y1 - L.y0 + 1 <= 11)
      .filter((L) => { for (let x = L.x0; x <= L.x1; x++) if (!isRoad(x, L.y1 + 1)) return false; return true; })
      .sort((a, b) => distOf(a) - distOf(b));
    const L = cand[0];
    if (L) terraces.push({ x: L.x0, y: L.y0, w: L.x1 - L.x0 + 1, h: L.y1 - L.y0, green: L, stair: { x: L.x0 + Math.floor((L.x1 - L.x0 - 1) / 2), w: 2 } });
  }
  // 広場の面全体。南の壁（y + h）は大通りの先頭行に重なり、階段だけが上下をつなぐ。
  terraces.push({ x: plaza.x0, y: plaza.y0, w: plaza.x1 - plaza.x0 + 1, h: plaza.y1 - plaza.y0 + 1, plaza: true });
  Object.assign(S, { squares, pcx, pcy, terraces });
}
