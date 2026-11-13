import { DIRT, GRASS, OUT, PLAZA, STREET, WATER, clamp } from './constants.mjs';
import { hash32 } from './util.mjs';
import { propTiles } from './manifest.mjs';
import { placeGate } from './gate.mjs';

// ---------- 小物（歩ける所をふさがないことを確かめながら置く） ----------
export function placeProps(P, F, rng, spawn, extra) {
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

  // 段の前の壁（face）は歩けない（階段の所だけ）。階段の上下は小物を置かない。
  // 広場の南階段は、前（大通り側）・後ろ（広場側）を2行ずつあける。
  for (const t of P.terraces) {
    const fy = t.y + t.h;
    const clear = t.plaza ? 2 : 1;
    for (let x = t.x; x < t.x + t.w; x++) {
      if (x >= t.stair.x && x < t.stair.x + t.stair.w) mark(reserved, x, fy - clear, x, fy + clear);
      else if (inC(x, fy)) blocked[id(x, fy)] = 1;
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
  let reach = flood().count;
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
    for (const [x, y] of tiles) if (!walk(x, y) || (reserved[id(x, y)] && !force) || (type === 'tree' && noTree[id(x, y)])) return false;
    // 木の樹冠は足元の2行上までかかる: すぐ上に通り・路地・広場がある所には植えない（歩く人を隠さない）
    if (type === 'tree' && !force) for (let y = ty - 2; y < ty; y++) for (let x = tx - 1; x <= tx + 1; x++) if (isPavedAt(x, y)) return false;
    if (tiles.length === 1 && locallySafe(tx, ty)) blocked[id(tx, ty)] = 1;
    else {
      for (const [x, y] of tiles) blocked[id(x, y)] = 1;
      if (flood().count !== reach - tiles.length) { for (const [x, y] of tiles) blocked[id(x, y)] = 0; return false; }
    }
    reach -= tiles.length;
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

  // 水辺: 桟橋（水の上の歩ける板）と、もやった舟。岸の通りから南へ
  if (quay && extra.dock) {
    const dk = extra.dock;
    const piers = ['pier', 'pier-2'].filter((t) => propArt[t]?.deck);
    const doorX = dk.doorCol ?? dk.x + Math.floor(dk.w / 2);
    const spots = [doorX + 2 + (rng() < 0.5 ? 0 : 1), doorX - 4 - Math.floor(rng() * 2), doorX + 9 + Math.floor(rng() * 3)];
    const used = [];
    let boatDone = !has('boat');
    for (let i = 0; i < spots.length && used.filter((u) => u[2]).length < 2 && piers.length; i++) {
      const look = piers[used.filter((u) => u[2]).length % piers.length];
      const d = propArt[look].deck;
      // 板は岸壁の石の上の 4px を見せて始める（歩けるつながりは web/world.js が岸の行につなぐ）
      const qb = quay.qt[spots[i]] + 1;                // その列の岸の通りの下の行
      const fx = spots[i] * 16 + 8, fy = (qb + 1) * 16 + 4 - d[1];
      const dx0 = Math.floor((fx + d[0]) / 16), dx1 = Math.floor((fx + d[0] + d[2] - 1) / 16);
      const dy1 = Math.floor((fy + d[1] + d[3] - 1) / 16);
      if (dy1 > crop.y1 - 1 || dx0 < crop.x0 + 1 || dx1 > crop.x1 - 1) continue;
      let ok = true;
      for (let x = dx0 - 1; x <= dx1 + 1 && ok; x++) if (quay.qt[x] + 1 !== qb || g[id(x, qb)] !== STREET || used.some(([a, b]) => x >= a - 1 && x <= b + 1)) ok = false;
      if (!ok) continue;
      used.push([dx0, dx1, true]);
      props.push({ type: 'pier', x: fx / 16, y: fy / 16, look });
      for (let x = dx0; x <= dx1; x++) reserved[id(x, qb)] = 1;
      lampAt([[dx0 - 1, qb], [dx1 + 1, qb]], 3);
      // 舟: 最初の桟橋の杭にぴったりもやう（板の中ほどの高さ）
      if (!boatDone) {
        const bs = propArt.boat?.solid || [-24, -17, 48, 18];
        const side = spots[1] < spots[0] ? 1 : -1;                    // 次の桟橋と反対の側
        const half = Math.round(propArt[look].deck[2] / 2) + 7;        // 板の幅の半分 + 杭
        // 舟の絵の船体は絵の幅より細いので、杭に少しかかるまで寄せる
        const bx = side < 0 ? fx - half - (bs[0] + bs[2]) + 9 : fx + half - bs[0] - 9;
        const by = fy + d[1] + Math.round(d[3] * 0.55) - (bs[1] + Math.round(bs[3] / 2));
        const bl = Math.floor((bx + bs[0]) / 16), br = Math.floor((bx + bs[0] + bs[2] - 1) / 16);
        if (bl >= crop.x0 + 1 && br <= crop.x1 - 1 && by / 16 <= crop.y1 + 0.7) {
          props.push({ type: 'boat', x: bx / 16, y: by / 16 });
          used.push([bl, br, false]);
          boatDone = true;
        }
      }
    }
    // 岸の通りにも荷物を寄せる。桟橋の間隔を空け、歩く列は残す。
    const clutter = ['barrel', 'crate', 'sacks'].filter((type) => has(type));
    for (let x = quay.keep[0] + 2, i = 0; x <= quay.keep[1] - 2 && clutter.length; x += 4, i++) {
      const qt = Number.isFinite(quay.qt[x]) ? quay.qt[x] : quay.top;
      tryProp(clutter[i % clutter.length], x, qt + 1);
    }
    // 水際 frontage に建物を並べきれない列は、森ではなく荷物で埋める。
    // 建物の扉列（footprint直下の歩行列）は reserved のまま残す。
    const frontage = clutter.length ? clutter : (has('fence') ? ['fence'] : []);
    for (let x = quay.keep[0] + 1, i = 0; x <= quay.keep[1] - 1 && frontage.length; x += 3, i++) {
      const y = quay.top - 1;
      if (foot[id(x, y)] >= 0) continue;
      for (const type of [frontage[i % frontage.length], ...frontage]) {
        if (tryProp(type, x, y)) break;
      }
    }
    // 岸の通りの街灯: 桟橋から離れた所に少しだけ
    if (quay.keep) for (let x = quay.keep[0] + 3; x <= quay.keep[1] - 3; x += 3) lampAt([[x, quay.qt[x] + 1]], 18);
  }

  // 段の東西の端は縁石: 外側の歩ける草地・広場は柵・茂み・プランターでふさぐ（通り・路地は同じ高さで段につながってよい）
  for (const t of P.terraces) for (const side of [-1, 1]) {
    const x = side < 0 ? t.x - 1 : t.x + t.w;
    for (let y = t.y; y < t.y + t.h; y++) {
      if (!inC(x, y)) continue;
      const k = id(x, y);
      if (foot[k] >= 0 || blocked[k] || doorRow[k] || g[k] === STREET || g[k] === DIRT || g[k] === OUT || g[k] === WATER) continue;
      tryProp(g[k] === PLAZA ? 'planter' : y === t.y + t.h - 1 ? 'bush' : 'fence', x, y, true);
    }
  }

  // 門（外から人が入る入口）: 南北の通りが街の外へ出る所（宿屋に近い方から）に、通りをまたいで南向きに立てる。
  // 柱（solids）はふさぎ、くぐれる所（opening、3マス）は歩ける。通りの端から門の先の1行までは門の幅の土の道にする。
  // 門番は街の内側の柱のわき（通りの外）に立つ。門のまわり1マスには木を植えない。街灯は門の灯から離す
  for (const lm of landmarks.filter((l) => l.data.archetype === 'gate')) {
    const gateState = { reach };
    const got = placeGate(lm, {
      propArt, placed, exits: F.exits || [], inC, foot, roofZ, g, crop, id, blocked, reserved, flood,
      walk, props, noTree, lamps, mark, state: gateState,
    });
    if (got) {
      reach = gateState.reach;
      out.landmarks.push({ ...lm.data, x: got.prop.x, y: got.prop.y, keeper: got.keeper });
    }
  }

  // 広場は舞台: まん中の飾り（井戸小屋か花壇、無ければ花の島）に向いたベンチ、縁に樽と鉢、南の縁に低い柵、縁の街灯。
  // 役場の段・広場の南階段の上下と、飾りのまわり1マスは歩けるようにあけておく
  const { x0: px0, x1: px1, y0: py0, y1: py1 } = plaza, pc = P.cx;
  const ht = P.terraces.find((t) => t.hall);
  const sq0 = ht ? ht.y + ht.h + 1 : py0;                               // 段の壁の下から広場
  const feature = { x0: 0, x1: -1, y0: 0, y1: -1 };
  const ring = (x0, y0, x1, y1) => mark(reserved, x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  const placeFeature = (type, look, spots, withKeeper) => {
    const [fw, fh] = propTiles(look || type, propArt);
    for (const [tx, ty, side] of spots) {
      if (tx < px0 || tx + fw - 1 > px1 || ty < sq0 || ty + fh - 1 > py1) continue;
      const before = props.length;
      if (!tryProp(type, tx, ty, false, look)) continue;
      let keeper = null;
      if (withKeeper) {
        // 番人の立つ所（井戸小屋の外側の下の段、なければ反対側）の歩ける1マスを確かめる
        const ox = side < 0 ? tx - 1 : tx + fw, ix = side < 0 ? tx + fw : tx - 1;
        for (const [kx, ky] of [[ox, ty + fh - 1], [ox, ty + fh], [ix, ty + fh - 1], [ix, ty + fh]]) {
          if (!walk(kx, ky) || reserved[id(kx, ky)]) continue;
          blocked[id(kx, ky)] = 1;
          if (flood().count === reach - 1) { keeper = { x: kx + 0.5, y: ky + 0.6875 }; reach--; break; }
          blocked[id(kx, ky)] = 0;
        }
        if (!keeper) {                                   // 番人が立てない → 置き直す
          props.splice(before, 1);
          for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) blocked[id(tx + dx, ty + dy)] = 0;
          reach = flood().count;
          continue;
        }
        const kx = Math.floor(keeper.x), ky = Math.floor(keeper.y);
        mark(reserved, kx - 1, ky - 1, kx + 1, ky + 1);
        mark(noTree, kx - 1, ky - 1, kx + 1, ky + 1);
      }
      ring(tx, ty, tx + fw - 1, ty + fh - 1);
      mark(noTree, tx - 2, ty - 2, tx + fw + 1, ty + fh + 1);
      Object.assign(feature, { x0: tx, x1: tx + fw - 1, y0: ty, y1: ty + fh - 1 });
      return { prop: props[before], keeper };
    }
    return null;
  };
  const centreSpots = (fw, fh) => {
    const ty = py1 - fh, tx = pc - Math.floor(fw / 2);
    return [[tx, ty, 1], [tx - 1, ty, -1], [tx + 1, ty, 1], [tx, ty - 1, 1], [tx - 2, ty, -1], [tx + 2, ty, 1]];
  };
  const hasBed = has('flowerbed');
  let wellAtCentre = false;
  for (const lm of landmarks.filter((l) => l.data.archetype === 'well')) {
    const [fw, fh] = propTiles(lm.prop, propArt);
    // 井戸小屋が広場のまん中の飾り。置けなければ左右の寄り、広場に近い緑地
    const spots = centreSpots(fw, fh);
    const side0 = hash32(`well:${lm.data.id}:${pc}`) % 2 ? 1 : -1;
    for (const side of [side0, -side0]) for (const off of [3, 1, 5]) spots.push([side < 0 ? pc - 1 - off - fw : pc + 1 + off, py1 - fh - 1, side]);
    let got = placeFeature(lm.prop, null, spots, true);
    if (got) wellAtCentre = Math.abs((feature.x0 + feature.x1) / 2 - pc) <= 2;
    if (!got) {
      for (const L of P.leaves.filter((L) => L.green).sort((a, b) => Math.hypot(a.x0 - pc, a.y0 - py0) - Math.hypot(b.x0 - pc, b.y0 - py0))) {
        const [tx, ty] = [Math.floor((L.x0 + L.x1 - fw) / 2), L.y1 - fh - 1];
        const before = props.length;
        if (!tryProp(lm.prop, tx, ty)) continue;
        let keeper = null;
        for (const [kx, ky] of [[tx + fw, ty + fh - 1], [tx - 1, ty + fh - 1]]) {
          if (!walk(kx, ky) || reserved[id(kx, ky)]) continue;
          blocked[id(kx, ky)] = 1;
          if (flood().count === reach - 1) { keeper = { x: kx + 0.5, y: ky + 0.6875 }; reach--; break; }
          blocked[id(kx, ky)] = 0;
        }
        if (!keeper) { props.splice(before, 1); for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) blocked[id(tx + dx, ty + dy)] = 0; reach = flood().count; continue; }
        got = { prop: props[before], keeper };
        mark(noTree, tx - 2, ty - 2, tx + fw + 1, ty + fh + 1);
        break;
      }
    }
    if (got) out.landmarks.push({ ...lm.data, x: got.prop.x, y: got.prop.y, keeper: got.keeper });
  }
  // 井戸小屋がまん中にあれば、花壇（あれば）は広場の上の方の片側に（ベンチは井戸小屋に向いたまま）
  if (wellAtCentre && hasBed) {
    const keep = { ...feature };
    const [fw, fh] = propTiles('flowerbed', propArt);
    const left = hash32(`bed:${pc}:${sq0}`) % 2 === 0;
    // 上の方・中心から離れた所から順に、広場の中のすべての位置を試す
    const spots = [];
    for (let y = sq0 + 1; y + fh - 1 <= py1 - 1; y++) for (let x = px0; x + fw - 1 <= px1; x++) spots.push([x, y, 1]);
    const far = (x) => Math.abs(x + fw / 2 - pc - 0.5);
    const edge = (x) => (x < px0 + 1 || x + fw - 1 > px1 - 1 ? 1 : 0);    // 広場の縁にかかる所は最後に
    spots.sort((a, b) => edge(a[0]) - edge(b[0]) || (a[1] - b[1]) * 2 - (far(a[0]) - far(b[0])) || (left ? a[0] - b[0] : b[0] - a[0]));
    placeFeature('flowerbed', null, spots, false);
    Object.assign(feature, keep);
  }
  // 井戸小屋がまん中に無ければ、花壇（あれば）か花の島をまん中に
  if (!wellAtCentre) {
    if (hasBed) { const [fw, fh] = propTiles('flowerbed', propArt); placeFeature('flowerbed', null, centreSpots(fw, fh), false); }
    else {
      const tx = pc - 1, ty = py1 - 1;
      if (tryProp('planter', tx, ty) | tryProp('planter', tx + 1, ty)) {
        tryProp('flowerpot', tx - 1, ty); tryProp('flowerpot', tx + 2, ty);
        Object.assign(feature, { x0: tx - 1, x1: tx + 2, y0: ty, y1: ty });
        ring(tx - 1, ty, tx + 2, ty);
      }
    }
  }
  // まん中の飾りに向いたベンチ（左右）
  if (feature.x1 >= feature.x0) {
    for (const [x, y] of [[feature.x0 - 3, feature.y1], [feature.x0 - 3, feature.y1 - 1]]) if (tryProp('bench', x, y)) break;
    for (const [x, y] of [[feature.x1 + 2, feature.y1], [feature.x1 + 2, feature.y1 - 1]]) if (tryProp('bench', x, y)) break;
  }
  // 掲示板: 段の下、階段の脇
  const sx = ht?.stair ? ht.stair.x : pc - 1, sw2 = ht?.stair ? ht.stair.w : 2;
  [[sx - 4, sq0], [sx + sw2 + 2, sq0], [px0 + 1, sq0 + 1], [px1 - 2, sq0 + 1], [pc - 1, py1 - 1]].find(([x, y]) => tryProp('noticeboard', x, y));
  // 角の植え込み: 大きい角には茂み、小さい角には花
  for (const [x, y, n] of plaza.cuts) tryProp(n >= 3 ? 'bush' : pick(['planter', 'flowerpot', 'bush']), x, y);
  // 縁: 樽と鉢（2行おき、出入りできる切れ目を残す）。南の縁の両わきに低い柵
  for (const [x, list] of [[px0, ['barrel', 'flowerpot', 'barrel', 'planter']], [px1, ['flowerpot', 'barrel', 'planter', 'barrel']]]) {
    let n = 0;
    for (let y = sq0 + 2; y <= py1 - 2; y += 2) if (rng() < 0.75) tryProp(list[n++ % list.length], x, y);
  }
  // 南の縁の両わき: 低い石垣（2マス）があればそれ、無ければ低い柵。
  // 広場の階段の上下2行は reserved 済みなので、段の壁・階段には重ならない。
  if (has('lowwall')) { for (const x of [px0 + 1, px1 - 2]) if (!tryProp('lowwall', x, py1)) { tryProp('fence', x, py1); tryProp('fence', x + 1, py1); } }
  else for (const x of [px0 + 1, px0 + 2, px1 - 2, px1 - 1]) tryProp('fence', x, py1);
  // 縁の街灯は2本だけ（基準 target-town.png の広場も、西と東の縁に1本ずつ）: 段の下の舞台の上の方、西と東の縁。
  // 多いと広場のほとんどが光だまりの明るさになる。階段の明かりは役場の扉の灯と、この2本の光だまりで足りる
  // 縁の列を上から順に（花壇・樽のまわりで立てられなければ、その下）、だめなら1マス内側
  const edgeLamp = (x, xi) => {
    const c = [];
    for (let y = sq0 + 1; y <= py1 - 1; y++) c.push([x, y]);
    for (let y = sq0 + 1; y <= py1 - 1; y++) c.push([xi, y]);
    return lampAt(c, 4);
  };
  edgeLamp(px0, px0 + 1);
  edgeLamp(px1, px1 - 1);

  // 工事中（作業中の変更がある建物）: 横の壁に足場、そばに工事中の札、余地があれば材木
  for (const p of placed) {
    const dirty = p.spec.module?.works?.dirty || 0;
    if (!(dirty > 0)) continue;
    const scaf = ['scaffold', 'scaffold-2'].filter(has);
    if (!scaf.length) continue;
    const look = scaf[hash32(`scaf:${p.spec.id}`) % scaf.length];
    const [sw, sh] = propTiles(look, propArt);
    const sides = hash32(`side:${p.spec.id}`) % 2 ? [1, -1] : [-1, 1];
    let at = null;
    for (const side of sides) {
      const tx = side < 0 ? p.x - sw : p.x + p.w, ty = p.yb - sh + 1;
      let ok = true;
      for (let dy = 0; dy < sh && ok; dy++) for (let dx = 0; dx < sw && ok; dx++) { const k = id(tx + dx, ty + dy); if (g[k] !== GRASS) ok = false; }
      if (ok && tryProp('scaffold', tx, ty, false, look)) { at = { side, tx, sw }; break; }
    }
    if (at) props[props.length - 1].x += at.side < 0 ? p.wall[0] / 16 : -p.wall[1] / 16;    // 絵の壁にぴったり
    // 横が1マスしかあかないときは、細い足場をその1マスの真ん中に（足場の板は両側の壁にかかる）
    if (!at && has('scaffold')) {
      for (const side of sides) {
        const tx = side < 0 ? p.x - 1 : p.x + p.w;
        if (g[id(tx, p.yb)] === GRASS && tryProp('scaffold', tx, p.yb, false, 'scaffold', [1, 1])) {
          at = { side, tx, sw: 1 };
          props[props.length - 1].x += side < 0 ? p.wall[0] / 16 : -p.wall[1] / 16;
          break;
        }
      }
    }
    if (!at) continue;
    // 札と材木: 建物の横か手前（扉の前の2行の外）で、屋根や足場の陰にならない草地。札は足場の手前か反対側の壁ぎわ
    const far = at.side < 0 ? p.x + p.w : p.x - 1, out = at.side < 0 ? at.tx - 1 : at.tx + at.sw;
    const grassRun = (x, y, w) => { for (let dx = 0; dx < w; dx++) if (!inC(x + dx, y) || g[id(x + dx, y)] !== GRASS) return false; return true; };
    if (has('sign-works')) {
      const cands = [[at.tx + (at.side < 0 ? 0 : at.sw - 1), p.yb + 1], [far, p.yb + 1], [far, p.yb], [out, p.yb], [out, p.yb + 1], [far, p.yb - 1]];
      for (const [x, y] of cands) if (grassRun(x, y, 1) && !hidden(x, y) && tryProp('sign-works', x, y)) break;
    }
    if (has('lumber')) {
      const [lw] = propTiles('lumber', propArt);
      const fx = at.side < 0 ? far : far - lw + 1, ox = at.side < 0 ? at.tx - lw : at.tx + at.sw;
      const cands = [[ox, p.yb], [ox, p.yb + 1], [fx, p.yb], [fx, p.yb + 1], [at.side < 0 ? at.tx : at.tx + at.sw - lw, p.yb + 1], [ox, p.yb - 1], [fx, p.yb - 1]];
      for (const [x, y] of cands) if (grassRun(x, y, lw) && !hidden(x, y, lw) && tryProp('lumber', x, y)) break;
    }
  }

  // 道場の検査状態: 扉の前をふさがない脇に、状態を図形で示す札を1つだけ立てる。
  const statusProp = { passed: 'sign-passed', failed: 'sign-failed', unverified: 'sign-unverified' };
  for (const p of placed) {
    if (p.spec.facility?.archetype !== 'dojo') continue;
    const type = statusProp[p.spec.facility.facts?.state];
    if (!type || !has(type)) continue;
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    const left = hash32(`dojo-sign:${p.spec.id}`) % 2 === 0;
    const sides = left ? [-1, 1] : [1, -1];
    const candidates = [];
    for (const side of sides) {
      const x = side < 0 ? p.x - 1 : p.x + p.w;
      candidates.push([x, p.yb + 1], [x, p.yb], [x, p.yb - 1]);
    }
    // 版の扉の左右2マスの外側も試す。扉の列とその前の通りは reserved のままにする。
    candidates.push([dc - 3, p.yb + 1], [dc + 4, p.yb + 1], [dc - 3, p.yb], [dc + 4, p.yb]);
    for (const [x, y] of candidates) if (tryProp(type, x, y)) break;
  }

  // 建物の足もと: 横の壁ぎわ（下の1〜2段）に、その建物らしい小物のかたまり（扉の前の2行はあける）
  const FEET = {
    workshop: ['crate', 'barrel', 'sacks', 'crate', 'barrel'],
    shop: ['barrel', 'crate', 'sacks', 'flowerpot', 'planter', 'barrel'],
    ruin: ['crate', 'bush', 'sacks', 'bush'],
    house: ['planter', 'flowerpot', 'barrel', 'sacks', 'flowerpot', 'crate'],
    facility: ['barrel', 'crate', 'sacks', 'planter', 'barrel'],
  };
  for (const p of placed) {
    const list = FEET[p.spec.facility ? 'facility' : p.spec.module.kind] || FEET.house;
    for (const side of hash32(`feet:${p.spec.id}`) % 2 ? [-1, 1] : [1, -1]) {
      const x = side < 0 ? p.x - 1 : p.x + p.w;
      for (const [dy, prob] of [[0, 0.85], [-1, 0.5], [-2, 0.2]]) {
        if (isGrass(x, p.yb + dy) && rng() < prob) tryProp(pick(list), x, p.yb + dy);
      }
    }
  }

  // 前庭の舗装: 扉の列は空け、左右の2行目以降に店先・工房先の小物を寄せる。
  // gap=0 の壁面でも、前面の舗装は建物ごとに独立して置ける。
  const FRONT = {
    workshop: ['crate', 'barrel', 'sacks', 'crate', 'barrel'],
    shop: ['barrel', 'crate', 'flowerpot', 'planter', 'sacks'],
    ruin: ['bush', 'crate', 'sacks', 'bush'],
    house: ['planter', 'flowerpot', 'barrel', 'sacks', 'crate'],
    facility: ['barrel', 'crate', 'sacks', 'planter'],
  };
  for (const p of placed) {
    const list = FRONT[p.spec.facility ? 'facility' : p.spec.module.kind] || FRONT.house;
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    const candidates = [];
    for (let k = 0; k < p.w; k++) {
      const x = p.x + k;
      for (let y = p.yb + 2; y < p.sd[k]; y++) {
        if (x === dc || !isPavedAt(x, y) || reserved[id(x, y)]) continue;
        candidates.push([hash32(`front:${p.spec.id}:${x},${y}`), x, y]);
      }
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const limit = p.spec.facility ? 2 : p.spec.archetype === 'shop' ? 4 : 3;
    let got = 0;
    for (const [, x, y] of candidates) {
      if (got >= limit) break;
      if (rng() < 0.72 && tryProp(pick(list), x, y)) got++;
    }
  }

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

  // 生活の小物: 近くの建物の種類に合わせて選ぶ。続けて置きやすくして、かたまりにする
  const CLUTTER = {
    workshop: ['crate', 'barrel', 'sacks', 'crate', 'cart', 'barrel'],
    shop: ['barrel', 'crate', 'sacks', 'flowerpot', 'planter'],
    ruin: ['bush', 'crate', 'bush', 'sacks'],
    house: ['planter', 'flowerpot', 'barrel', 'bush', 'sacks', 'bench', 'crate'],
    facility: ['barrel', 'crate', 'sacks', 'planter'],
  };
  const kindNear = (x, y) => {
    for (let d = 0; d <= 5; d++) for (const [dx, dy] of [[0, d], [-1, d], [1, d], [0, -d]]) {
      const t = id(x + dx, y + dy);
      if (t >= 0 && t < N && foot[t] >= 0) { const s = placed[foot[t]].spec; return s.facility ? 'facility' : s.module.kind; }
    }
    return 'house';
  };
  const clutter = (x, y, kind) => {
    const list = CLUTTER[kind] || CLUTTER.house;
    const type = pick(list);
    return tryProp(type, x, y) || tryProp(list[0], x, y);
  };
  const nearPathAt = (t) => { for (const n of [t - 1, t + 1, t - cols, t + cols]) if (g[n] !== GRASS && g[n] !== OUT && g[n] !== WATER) return true; return false; };

  // 木はかたまりで: 裏庭・広い隙間・小さな緑地・街のきわに、2〜5本の木と根もとの茂み
  const TOFF = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 1], [2, 1], [1, -1], [-1, 0], [2, 0], [0, 2]];
  const clusterAt = (x, y, n) => {
    let got = 0;
    for (const [dx, dy] of TOFF) { if (got >= n) break; if (isGrass(x + dx, y + dy) && !nearPathAt(id(x + dx, y + dy)) && tryProp('tree', x + dx, y + dy)) got++; }
    if (got) for (const [dx, dy] of [[-1, 2], [2, 2], [1, 2], [-2, 1], [3, 1]]) if (rng() < 0.45 && isGrass(x + dx, y + dy)) tryProp('bush', x + dx, y + dy);
    return got;
  };
  const seeds = [];
  const farFromSeeds = (x, y, r) => !seeds.some(([a, b]) => Math.max(Math.abs(a - x), Math.abs(b - y)) < r);
  const order = [];
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (g[t] !== GRASS || foot[t] >= 0 || roofZ[t] || reserved[t] || noTree[t]) continue;
    const where = garden[t] ? 0 : gap[t] ? 1 : inside[t] ? 2 : dist[t] <= 3 ? 3 : -1;
    if (where < 0) continue;
    order.push([hash32(`tc:${x},${y}`), x, y, where]);
  }
  order.sort((a, b) => a[0] - b[0]);
  for (const [, x, y, where] of order) {
    const r = where === 0 ? 5 : where === 1 ? 4 : where === 2 ? 6 : 5;
    if (!farFromSeeds(x, y, r)) continue;
    const n = where === 1 ? 1 + Math.floor(rng() * 2) : where === 3 ? 3 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 3);
    if (clusterAt(x, y, n)) seeds.push([x, y]);
  }

  // 小さな緑地: ベンチと街灯（木はかたまりで植えてある）
  for (const L of P.leaves) {
    if (!L.green || !inC(L.x0, L.y1) || g[id(L.x0, L.y1)] === OUT) continue;
    const cxL = L.x0 + Math.floor((L.x1 - L.x0 + 1) / 2);
    tryProp('bench', cxL - 1, L.y1) || tryProp('bench', cxL, L.y1 - 1);
    lampAt([[L.x0, L.y1], [L.x1, L.y1]], 14);
    for (const [x, y] of [[L.x1 - 1, L.y1], [L.x0 + 2, L.y1 - 1]]) tryProp(pick(['bush', 'planter', 'flowerpot', 'bush']), x, y);
  }

  // 建物の間の隙間: 通りぎわに樽・木箱・鉢、奥に茂み
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (!gap[t] || g[t] !== GRASS) continue;
    const r = rng();
    const nb = foot[t - 1] >= 0 ? foot[t - 1] : foot[t + 1];
    const kind = nb >= 0 ? (placed[nb].spec.facility ? 'facility' : placed[nb].spec.module.kind) : 'house';
    const frontRow = g[t + cols] !== GRASS && g[t + cols] !== OUT && !gap[t + cols];
    if (frontRow && r < 0.5) clutter(x, y, kind);
    else if (!frontRow && r < 0.25) { if (r < 0.12) tryProp('bush', x, y); else clutter(x, y, kind); }
  }
  // 家の裏の庭: 通りぎわに柵（ところどころ切れ目）、中は生活の小物のかたまりと茂み
  let run = 0, gapAt = 4, chain = 0;
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (!garden[t] || g[t] !== GRASS) { run = 0; chain = 0; continue; }
    const r = rng();
    const edge = g[t - cols] === STREET || g[t - cols] === DIRT;
    if (edge) {
      // 柵は続けて立て、数マスおきに1マスの切れ目（木戸）を残す。切れ目のあとは数え直す
      run++;
      if (run > gapAt) { run = 0; gapAt = 4 + Math.floor(rng() * 5); continue; }
      tryProp('fence', x, y);
    } else if (chain > 0 && r < 0.5) { chain = clutter(x, y, kindNear(x, y)) ? chain - 1 : 0; }
    else if (r < 0.1) { tryProp(rng() < 0.5 ? 'bush' : 'planter', x, y); chain = 0; }
    else if (r < 0.2) chain = clutter(x, y, kindNear(x, y)) ? 1 + Math.floor(rng() * 2) : 0;
    else chain = 0;
  }
  // 残りの草地: 街の内側の空き地は木立ち、建物の近くは茂みと花、外側は森（道のすぐ脇は空ける）
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (g[t] !== GRASS || foot[t] >= 0 || garden[t] || gap[t] || roofZ[t] || reserved[t]) continue;
    const nearPath = nearPathAt(t);
    const r = rng();
    if (inside[t]) {
      let nearFoot = false;
      for (let dy = -3; dy <= 3 && !nearFoot; dy++) for (let dx = -3; dx <= 3; dx++) if (inC(x + dx, y + dy) && foot[id(x + dx, y + dy)] >= 0) { nearFoot = true; break; }
      if (!nearFoot) {
        if (nearPath) { if (r < 0.1) tryProp('bush', x, y); continue; }
        const lattice = y % 2 === 0 && (x + (y >> 1)) % 2 === 0;
        if (lattice ? r < 0.8 : r < 0.12) tryProp(lattice ? 'tree' : 'bush', x, y);
        continue;
      }
      if (!nearPath && r < 0.08) tryProp(pick(['bush', 'planter', 'flowerpot', 'bush']), x, y);
      continue;
    }
    // 街の外まわり: 道のすぐ脇は空け、その外は茂みの生け垣と木、さらに外は木の詰まった森（ずらした格子で樹冠がつながる）
    if (nearPath) continue;
    const shore = g[t + cols] === WATER || g[t + 2 * cols] === WATER;
    const d = dist[t];
    if (d <= 2) {
      if (r < (shore ? 0.15 : 0.3)) tryProp('tree', x, y);
      else if (r < 0.62) tryProp('bush', x, y);
      continue;
    }
    const lattice = y % 2 === 0 && (x + (y >> 1)) % 2 === 0;
    if (lattice ? r < (shore ? 0.5 : 0.9) : r < 0.16) tryProp(lattice || r < 0.06 ? 'tree' : 'bush', x, y);
  }

  // 建物の裏に続く見える芝生は1行を目安にする。屋根の cover の外側で、
  // 2行以上の裸の草地が残る列には、木・茂み・鉢を1つ置いて帯を分ける。
  // 置ける場所だけを選ぶため、通路を塞いだときは tryProp の到達性検査で戻す。
  for (const p of placed) {
    for (let dx = 0; dx < p.w; dx++) {
      const cover = p.cover?.[dx] ?? p.spec.roofRows ?? 2;
      const x = p.x + dx;
      const run = [];
      for (let y = p.y - cover - 1; y >= crop.y0; y--) {
        if (!inC(x, y) || !isGrass(x, y) || blocked[id(x, y)] || foot[id(x, y)] >= 0) break;
        run.push(y);
      }
      if (run.length < 2) continue;
      const targets = [...new Set([run[1], run[0], run[Math.floor(run.length / 2)]])];
      let placedBack = false;
      for (const y of targets) {
        for (const type of ['tree', 'bush', 'planter', 'flowerpot']) {
          if (tryProp(type, x, y)) { placedBack = true; break; }
        }
        if (placedBack) break;
      }
    }
  }

  // 何も無い芝生を割る: 基準 target-town.png の町の緑はほとんどが茂み・花・木・樽で埋まり、何も無い芝生はいちばん大きい所でも 7 マスほど。
  // 見える芝生（草地で、物が無く、建物の絵の屋根の陰（版の cover）でない所）の中で、何も無い長方形（縦横とも2マス以上）の
  // いちばん大きいものが LAWN_MAX を超えるあいだ、その長方形のまん中に2〜3個の組（建物の近くは樽・鉢・茂み、離れた所は茂み・花・木）を置く
  {
    const LAWN_MAX = 8;
    const shade = new Uint8Array(N);
    for (const p of placed) for (let tx = 0; tx < p.w; tx++) {
      const k = p.cover ? p.cover[tx] : 2;
      for (let j = 1; j <= k; j++) if (inC(p.x + tx, p.y - j)) shade[id(p.x + tx, p.y - j)] = 1;
    }
    const skip = new Uint8Array(N);
    const W0 = crop.x1 - crop.x0 + 1, Hh = new Int32Array(W0), lawnM = new Uint8Array(N);
    const nearBuilding = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inC(x + dx, y + dy) && foot[id(x + dx, y + dy)] >= 0) return true; return false; };
    const GROUPS = {
      house: [['barrel', 'flowerpot', 'bush'], ['planter', 'bush', 'crate'], ['bush', 'flowerpot', 'barrel'], ['sacks', 'planter', 'bush']],
      open: [['bush', 'flowerpot', 'bush'], ['tree', 'bush', 'planter'], ['bush', 'planter', 'flowerpot'], ['tree', 'bush', 'bush']],
    };
    const SHAPES = [[[0, 0], [1, 0], [0, 1]], [[0, 0], [-1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [-1, 1]]];
    for (let iter = 0; iter < 3000; iter++) {
      for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
        const t = id(x, y);
        lawnM[t] = isGrass(x, y) && !blocked[t] && !shade[t] && !skip[t] ? 1 : 0;
      }
      // いちばん大きい何も無い長方形（縦横とも2マス以上）
      Hh.fill(0);
      let best = null;
      for (let y = crop.y0; y <= crop.y1; y++) {
        for (let i = 0; i < W0; i++) Hh[i] = lawnM[id(crop.x0 + i, y)] ? Hh[i] + 1 : 0;
        const st = [];
        for (let i = 0; i <= W0; i++) {
          const h = i < W0 ? Hh[i] : 0;
          let from = i;
          while (st.length && st[st.length - 1][1] >= h) {
            const [s0, hh] = st.pop(), w = i - s0;
            if (hh >= 2 && w >= 2 && (!best || hh * w > best.a)) best = { a: hh * w, x0: crop.x0 + s0, x1: crop.x0 + i - 1, y0: y - hh + 1, y1: y };
            from = s0;
          }
          st.push([from, h]);
        }
      }
      if (!best || best.a <= LAWN_MAX) break;
      // まん中に近いマスから、組を置ける所を探す
      const mx = (best.x0 + best.x1) / 2, my = (best.y0 + best.y1) / 2;
      const cells = [];
      for (let y = best.y0; y <= best.y1; y++) for (let x = best.x0; x <= best.x1; x++) cells.push([Math.abs(x - mx) + Math.abs(y - my) + (hash32(`lawn:${x},${y}`) % 100) / 1000, x, y]);
      cells.sort((a, b) => a[0] - b[0]);
      let got = 0;
      for (const [, x, y] of cells) {
        const h = hash32(`lawng:${x},${y}`);
        const set = (nearBuilding(x, y) ? GROUPS.house : GROUPS.open)[h % 4];
        const shape = SHAPES[(h >>> 3) % SHAPES.length];
        const n = 2 + ((h >>> 6) % 2);
        for (let k = 0; k < n; k++) {
          const [dx, dy] = shape[k], type = set[k];
          const px = x + dx, py = y + dy;
          if (!isGrass(px, py)) continue;
          if (tryProp(type, px, py) || (type !== 'bush' && tryProp('bush', px, py))) got++;
          else if (k === 0) break;                        // 組の最初が置けなければ次のマスへ
        }
        if (got) break;
      }
      if (!got) {
        // 小物が歩行面を切断する細い袋小路では、無理に物を置かず
        // 1マスだけ土の小道にして芝生の帯を分ける（DIRTは歩ける）。
        let cut = false;
        for (let y = best.y0; y <= best.y1 && !cut; y++) for (let x = best.x0; x <= best.x1; x++) {
          if (!isGrass(x, y) || blocked[id(x, y)] || reserved[id(x, y)] || foot[id(x, y)] >= 0) continue;
          g[id(x, y)] = DIRT;
          cut = true;
          break;
        }
        if (!cut) for (let y = best.y0; y <= best.y1; y++) for (let x = best.x0; x <= best.x1; x++) skip[id(x, y)] = 1;   // 扉の前などはあきらめる
      }
    }
  }
  // 小物を置くと歩行面を切断する袋小路でも、裸芝生の最大長方形を残さない。
  // 既存の小物配置を壊さず、歩ける DIRT の1マスへ変えて帯を分ける。
  {
    const W0 = crop.x1 - crop.x0 + 1, heights = new Int32Array(W0);
    const bare = (x, y) => inC(x, y) && g[id(x, y)] === GRASS && foot[id(x, y)] < 0 && !roofZ[id(x, y)];
    for (let iter = 0; iter < 64; iter++) {
      heights.fill(0);
      let best = null;
      for (let y = crop.y0; y <= crop.y1; y++) {
        for (let i = 0; i < W0; i++) heights[i] = bare(crop.x0 + i, y) ? heights[i] + 1 : 0;
        const stack = [];
        for (let i = 0; i <= W0; i++) {
          const h = i < W0 ? heights[i] : 0;
          let from = i;
          while (stack.length && stack[stack.length - 1][1] >= h) {
            const [s0, hh] = stack.pop(), w = i - s0;
            if (hh >= 2 && w >= 2 && (!best || hh * w > best.a)) best = { a: hh * w, x0: crop.x0 + s0, x1: crop.x0 + i - 1, y0: y - hh + 1, y1: y };
            from = s0;
          }
          stack.push([from, h]);
        }
      }
      if (!best || best.a <= 8) break;
      const x = Math.floor((best.x0 + best.x1) / 2), y = Math.floor((best.y0 + best.y1) / 2);
      if (!bare(x, y)) break;
      g[id(x, y)] = DIRT;
    }
  }
  // 裸芝生を割るための土の小道が、水路の脇へあとから戻らないようにする。
  // 橋の deck の取り付け道は除外する。
  const bridgeCellSet = new Set(bridgeCells.map(([x, y]) => id(x, y)));
  for (const [x, y] of canalCells) {
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inC(nx, ny)) continue;
      const k = id(nx, ny);
      if (!bridgeCellSet.has(k) && g[k] === DIRT && P.road[k] < 0 && foot[k] < 0 && !front[k] && !plazaM[k]) g[k] = GRASS;
    }
  }
  return out;
}
