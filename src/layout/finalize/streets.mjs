// 建物と広場をつなぐ通りを残し、短い輪で行き止まりを減らす。
export function keepStreets(S) {
  const { P, g, walk } = S;
  const { cols, N, id, inG, road, pieces, plazaM, plaza, placed } = P;
  // ---- 使う通り: 建物の前・広場のまわり、そこから広場までの道、短い輪
  const kept = new Uint8Array(N);
  const seeds = [];
  const seedAt = (x, y) => { if (inG(x, y) && road[id(x, y)] >= 0) seeds.push(id(x, y)); };
  for (const p of placed) {
    const r = p.sd.find((v) => v >= 0);
    for (let x = p.x - 3; x <= p.x + p.w + 2; x++) {
      const s = p.sd[x - p.x] ?? r;
      seedAt(x, s);
    }
  }
  for (let x = P.kx0 - 2; x <= P.kx1 + 2; x++) { seedAt(x, P.Htop[x] + 1); seedAt(x, plaza.y0); }
  // 広場から BFS して、それぞれの種を広場までつなぐ
  const par = new Int32Array(N).fill(-2);
  const q = [];
  for (let k = 0; k < N; k++) if (plazaM[k]) { par[k] = -1; q.push(k); }
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = k % cols, y = (k / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inG(nx, ny)) continue;
      const n = id(nx, ny);
      if (par[n] !== -2 || !walk(n)) continue;
      par[n] = k; q.push(n);
    }
  }
  for (const s of seeds) for (let k = s; k >= 0 && !kept[k] && par[k] !== -2; k = par[k]) kept[k] = 1;
  // piece ごとに、残す区間を通りの幅いっぱいに
  const widen = () => {
    for (const pc of pieces) {
      let a = Infinity, b = -Infinity;
      for (let y = pc.y0; y <= pc.y1; y++) for (let x = pc.x0; x <= pc.x1; x++) {
        if (!kept[id(x, y)]) continue;
        const v = pc.dir === 'h' ? x : y;
        a = Math.min(a, v); b = Math.max(b, v);
      }
      if (a > b) continue;
      pc.keep = [a, b];
      for (let y = pc.y0; y <= pc.y1; y++) for (let x = pc.x0; x <= pc.x1; x++) {
        const v = pc.dir === 'h' ? x : y;
        if (v >= a && v <= b) kept[id(x, y)] = 1;
      }
    }
  };
  widen();
  // 輪: 両端が残した通りにつながる短い通りは残す（行き止まりばかりにしない）
  // ひとつながりの通り（曲がり・段差の piece をまとめて）ごとに見る
  const K = (x, y) => inG(x, y) && (kept[id(x, y)] || plazaM[id(x, y)]) === 1;
  const groups = new Map();
  for (const pc of pieces) { if (!groups.has(pc.grp)) groups.set(pc.grp, []); groups.get(pc.grp).push(pc); }
  for (let it = 0; it < 2; it++) {
    for (const list of groups.values()) {
      const kind = list[0].kind;
      if (kind === 'quay' || kind === 'high' || kind === 'square' || kind === 'court') continue;
      const horiz = list[0].dir === 'h';
      let a0 = Infinity, a1 = -Infinity, full = true;
      for (const pc of list) {
        a0 = Math.min(a0, horiz ? pc.x0 : pc.y0); a1 = Math.max(a1, horiz ? pc.x1 : pc.y1);
        if (!pc.keep || pc.keep[0] !== (pc.dir === 'h' ? pc.x0 : pc.y0) || pc.keep[1] !== (pc.dir === 'h' ? pc.x1 : pc.y1)) full = false;
      }
      if (full || a1 - a0 + 1 > 30) continue;
      // 両端（はじめと終わりの 2 マス）が、ほかの通りの残した所か広場に触れているか
      let e0 = false, e1 = false;
      for (const pc of list) for (let y = pc.y0; y <= pc.y1; y++) for (let x = pc.x0; x <= pc.x1; x++) {
        const v = horiz ? x : y;
        if (v > a0 + 1 && v < a1 - 1) continue;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (!K(nx, ny) || (road[id(nx, ny)] >= 0 && pieces[road[id(nx, ny)]].grp === list[0].grp)) continue;
          if (v <= a0 + 1) e0 = true;
          if (v >= a1 - 1) e1 = true;
        }
      }
      if (!e0 || !e1) continue;
      for (const pc of list) for (let y = pc.y0; y <= pc.y1; y++) for (let x = pc.x0; x <= pc.x1; x++) kept[id(x, y)] = 1;
    }
    widen();
  }
  // 小さな広場は、つながる通りを残すなら舗装する
  for (const sq of P.squares) {
    let touch = false;
    for (let y = sq.y0; y <= sq.y1 + 1 && !touch; y++) for (let x = sq.x0 - 1; x <= sq.x1 + 1; x++) if (inG(x, y) && kept[id(x, y)] && (y > sq.y1 || x < sq.x0 || x > sq.x1 || road[id(x, y)] !== sq.k)) { touch = true; break; }
    if (!touch) continue;
    sq.keep = [sq.x0, sq.x1];
    for (let y = sq.y0; y <= sq.y1; y++) for (let x = sq.x0; x <= sq.x1; x++) kept[id(x, y)] = 1;
  }
  for (let k = 0; k < N; k++) if (kept[k] && road[k] >= 0) g[k] = pieces[road[k]].code;
  S.kept = kept;
}
