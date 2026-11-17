import { DIRT, GRASS, OUT, PLAZA, STREET, WATER } from '../constants.mjs';
import { propTiles } from '../manifest.mjs';
import { stairClearance } from '../../stair-clearance.mjs';

// 予約・当たり・到達数を共有する。tryProp と finishLawn も同じ状態を使う。
export function createPropsContext(P, F, rng, spawn, extra) {
  const S = { P, F, rng, spawn, extra };
  const { cols, N, id, foot, front, roofZ, plaza, plazaM, placed, pieces, quay } = P;
  const { g, gap, garden, inside, crop, dist, yard } = F;
  const { propArt, landmarks, works, bridgeProps = [], mouthProps = [], bridgeCells = [], canalCells = [] } = extra;
  const has = (type) => !!propArt[type];
  const inC = (x, y) => x >= crop.x0 && y >= crop.y0 && x <= crop.x1 && y <= crop.y1;
  const blocked = new Uint8Array(N), reserved = new Uint8Array(N);
  const walk = (x, y) => inC(x, y) && g[id(x, y)] !== OUT && g[id(x, y)] !== WATER && foot[id(x, y)] < 0 && !blocked[id(x, y)];
  const props = [...bridgeProps, ...mouthProps].map((p) => ({ ...p }));
  const out = { props, landmarks: [] };

  // footprint のすぐ下の2行（扉の位置は絵で決まるので幅いっぱい）と前庭、開始位置のまわりは空ける
  const doorRow = new Uint8Array(N);                       // 建物の扉の前の2行（どんな小物でもふさがない）
  for (const p of placed) for (let x = p.x; x < p.x + p.w; x++) for (let y = p.yb + 1; y <= p.yb + 2; y++) { reserved[id(x, y)] = 1; doorRow[id(x, y)] = 1; }
  for (const [x, y] of bridgeCells) if (inC(x, y)) reserved[id(x, y)] = 1;
  for (let t = 0; t < N; t++) if (front[t]) reserved[t] = 1;
  for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) reserved[id(spawn.x + dx, spawn.y + dy)] = 1;
  // 施設の扉の前（扉の列の左右2、扉の列の通りが続く所まで 2〜5行）には何も置かない。まわりには木を置かない（主要施設を隠さない）
  const noTree = new Uint8Array(N);
  for (const [x, y] of bridgeCells) if (inC(x, y)) noTree[id(x, y)] = 1;
  const mark = (arr, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inC(x, y)) arr[id(x, y)] = 1; };
  // 水路口は props の先頭に置くだけでなく、後から置く花壇・柵などの
  // 候補からも外す。深い広場では口が南の段の近くへ来るため、これを
  // 予約しないと花壇の絵が水路口のタイルに重なる。
  for (const p of mouthProps) {
    const [mw, mh] = propTiles(p.look || p.type, propArt);
    const mx = Math.floor(p.x - mw / 2 + 0.5), my = Math.round(p.y - mh);
    mark(reserved, mx, my, mx + mw - 1, my + mh - 1);
  }
  for (const p of placed) {
    if (!p.spec.facility) continue;
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    // 扉の前は、扉の列の通り（石畳・土・広場）が続く所まで（2〜5行）。通りの向こうの草地まではあけない（何も無い芝生になる）
    let ye = p.yb + 1;
    while (ye < p.yb + 5 && inC(dc, ye + 1) && [STREET, DIRT, PLAZA].includes(g[id(dc, ye + 1)])) ye++;
    mark(reserved, dc - 2, p.yb + 1, dc + 3, Math.max(p.yb + 2, ye));
    mark(noTree, p.x - 2, p.y - 1, p.x + p.w + 1, p.yb + 5);
  }

  // 段の前の壁（face）は歩けない（階段の所だけ）。
  // 全階段の前後2行・左右1マスは、縁の柵など force の小物にも渡さない。
  const stairReserved = new Uint8Array(N);
  for (const t of P.terraces) {
    const fy = t.y + t.h;
    const r = stairClearance({ ...t.stair, y: fy });
    mark(reserved, r.x0, r.y0, r.x1, r.y1);
    mark(stairReserved, r.x0, r.y0, r.x1, r.y1);
    for (let x = t.x; x < t.x + t.w; x++) {
      if ((x < t.stair.x || x >= t.stair.x + t.stair.w) && inC(x, fy)) blocked[id(x, fy)] = 1;
    }
  }
  const flood = () => {
    const seen = new Uint8Array(N);
    const q = [id(spawn.x, spawn.y)];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const t = q[h], x = t % cols, y = (t / cols) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!walk(nx, ny)) continue;
        const n = id(nx, ny);
        if (!seen[n]) { seen[n] = 1; q.push(n); }
      }
    }
    return { seen, count: q.length };
  };
  {
    const { seen } = flood();   // 広場から届かない草地は街の外に
    for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
      const t = id(x, y);
      if (g[t] === GRASS && foot[t] < 0 && !seen[t]) g[t] = OUT;
    }
  }
  S.reach = flood().count;
  const RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const locallySafe = (x, y) => {
    const w = RING.map(([dx, dy]) => walk(x + dx, y + dy));
    if (w.every(Boolean)) return true;
    let runs = 0;
    for (let i = 0; i < 8; i++) {
      if (!w[i] || w[(i + 7) % 8]) continue;
      let touches = false;
      for (let j = i; j < i + 8 && w[j % 8]; j++) if (j % 2 === 1) touches = true;
      if (touches) runs++;
    }
    return runs <= 1;
  };
  const lamps = [];
  const isPavedAt = (x, y) => inC(x, y) && (g[id(x, y)] === STREET || g[id(x, y)] === DIRT || g[id(x, y)] === PLAZA || g[id(x, y)] === WATER);
  const tryProp = (type, tx, ty, force = false, look, size) => {
    if (!has(look || type) && !['lamp', 'tree', 'bush', 'barrel', 'crate', 'fence', 'bench', 'noticeboard', 'sacks', 'flowerpot', 'planter', 'cart'].includes(type)) return false;
    const [fw, fh] = size || propTiles(look || type, propArt);
    const tiles = [];
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) tiles.push([tx + dx, ty + dy]);
    for (const [x, y] of tiles) if (!walk(x, y) || stairReserved[id(x, y)] || (reserved[id(x, y)] && !force) || (type === 'tree' && noTree[id(x, y)])) return false;
    // 木の樹冠は足元の2行上までかかる: すぐ上に通り・路地・広場がある所には植えない（歩く人を隠さない）
    if (type === 'tree' && !force) for (let y = ty - 2; y < ty; y++) for (let x = tx - 1; x <= tx + 1; x++) if (isPavedAt(x, y)) return false;
    if (tiles.length === 1 && locallySafe(tx, ty)) blocked[id(tx, ty)] = 1;
    else {
      for (const [x, y] of tiles) blocked[id(x, y)] = 1;
      if (flood().count !== S.reach - tiles.length) { for (const [x, y] of tiles) blocked[id(x, y)] = 0; return false; }
    }
    S.reach -= tiles.length;
    if (type === 'lamp') lamps.push([tx, ty]);
    props.push({ type, x: tx + fw / 2, y: ty + fh, ...(look ? { look } : {}), ...(size ? { w: fw } : {}) });
    return true;
  };
  // 先に置いた建物の屋根・背の高い小物（足場・井戸小屋）の陰になる所か（そこに置いた札や材木は見えない）
  const TALL = { scaffold: [1, 4.5], 'scaffold-2': [1.5, 4.5], wellhouse: [2, 3.8], gate: [3, 4.5] };
  const hidden = (tx, ty, fw = 1) => {
    for (let dx = 0; dx < fw; dx++) if (roofZ[id(tx + dx, ty)] || foot[id(tx + dx, ty + 1)] >= 0 || foot[id(tx + dx, ty + 2)] >= 0) return true;
    const cx = tx + fw / 2, cy = ty + 1;
    return props.some((q) => { const t = TALL[q.look || q.type]; return t && q.y > cy + 0.01 && q.y - cy < t[1] && Math.abs(q.x - cx) < t[0] + fw / 2; });
  };
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const isPaved = (x, y) => inC(x, y) && (g[id(x, y)] === STREET || g[id(x, y)] === DIRT || g[id(x, y)] === PLAZA);

  // 街灯: 意味のある所にだけ（広場の縁、施設の扉のわき、通りの角、岸と桟橋、小さな広場・緑地）。互いに離す
  const lampAt = (cands, minD) => {
    for (const [x, y] of cands) {
      if (lamps.some(([lx, ly]) => Math.hypot(lx - x, (ly - y) * 1.2) < minD)) continue;
      if (tryProp('lamp', x, y)) return true;
    }
    return false;
  };
  const isGrass = (x, y) => inC(x, y) && g[id(x, y)] === GRASS && foot[id(x, y)] < 0;
  const kept = (x, y) => inC(x, y) && (g[id(x, y)] === STREET || g[id(x, y)] === DIRT || g[id(x, y)] === PLAZA);

  // 港の岸の通りの上2行には森を近づけない。岸の幅を広げても、
  // 水際の建物・樽・桟橋が森に切られないようにする（木の最短距離は3行）。
  if (quay) {
    for (let x = crop.x0; x <= crop.x1; x++) {
      const qt = Number.isFinite(quay.qt[x]) ? quay.qt[x] : quay.top;
      mark(noTree, x - 1, qt - 2, x + 1, qt + 1);
    }
  }
  return Object.assign(S, { cols, N, id, foot, front, roofZ, plaza, plazaM, placed, pieces, quay,
    g, gap, garden, inside, crop, dist, propArt, landmarks, bridgeCells, canalCells,
    has, inC, blocked, reserved, walk, props, out, doorRow, noTree, mark, flood,
    lamps, isPavedAt, tryProp, hidden, pick, lampAt, isGrass, kept });
}
