import { DIRT, GRASS, OUT, PLAZA, STREET, WATER, clamp } from './constants.mjs';
import { hash32, makeRng } from './util.mjs';

// ---------- 地面を塗る: 使った所だけ通りを残し、切り出し、外を「街の外」にする ----------
export function finalize(P, maxH, opt = {}) {
  const { cols, rows, N, id, inG, road, pieces, plazaM, plaza, placed, foot, roofZ, front, quay, hall } = P;
  const g = new Uint8Array(N);
  const setG = (x, y, c) => { if (inG(x, y)) g[id(x, y)] = c; };
  const walk = (k) => road[k] >= 0 || plazaM[k];

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
  for (let k = 0; k < N; k++) if (plazaM[k]) g[k] = PLAZA;
  // 広場の角の植え込み（大きさは角ごとに違う）
  const crng = makeRng(P.cx * 7919 + plaza.y0);
  plaza.cuts = [];
  const corners = [[plaza.x0, plaza.y0, 1, 1], [plaza.x1, plaza.y0, -1, 1], [plaza.x0, plaza.y1, 1, -1], [plaza.x1, plaza.y1, -1, -1]];
  corners.forEach(([x, y, dx, dy], i) => {
    const r = crng();
    const shape = i >= 2 ? (r < 0.5 ? [[0, 0]] : r < 0.8 ? [[0, 0], [dx, 0]] : []) : r < 0.35 ? [[0, 0], [dx, 0], [0, dy]] : r < 0.7 ? [[0, 0], [dx, 0], [0, dy], [dx, dy]] : [[0, 0], [dx, 0], [2 * dx, 0], [0, dy]];
    // 広場に面する建物の扉の前の行には植え込みを作らない
    for (const [ox, oy] of shape) if (!(inG(x + ox, y + oy - 1) && foot[id(x + ox, y + oy - 1)] >= 0)) plaza.cuts.push([x + ox, y + oy, shape.length]);
  });
  for (const [x, y] of plaza.cuts) { setG(x, y, GRASS); plazaM[id(x, y)] = 0; }

  // footprint のすぐ下の行と前庭を、前の通りと同じ舗装（または土）にする。
  // 以前の「2行下がった家だけ草地＋柵」の前庭は作らない。
  for (const p of placed) {
    for (let k = 0; k < p.w; k++) {
      const x = p.x + k, below = g[id(x, p.sd[k])], code = below === PLAZA ? STREET : below || STREET;
      // dense track が未使用の通りとして整理された場合でも、建物直下の1行は
      // 扉から端まで歩ける前庭に戻す。広場・土道・既存の通りはそのまま残す。
      if (below === GRASS) g[id(x, p.sd[k])] = STREET;
      for (let y = p.yb + 1; y < p.sd[k]; y++) g[id(x, y)] = code;
    }
  }
  // 建物の間の路地（下の通りから裏庭を抜けて上の通りへ）と、路地でない隙間
  const gap = new Uint8Array(N);
  for (const t of P.tracks) {
    const items = [...t.items].sort((a, b) => a.x - b.x);
    for (let k = 0; k + 1 < items.length; k++) {
      const a = items[k], b = items[k + 1];
      const gx0 = a.x + a.w, gx1 = b.x - 1, w = gx1 - gx0 + 1;
      if (w < 1 || w > 4) continue;                    // 大きく飛ばした所は庭のまま
      // 工事中の建物の横の1マスは路地にせず草地のまま（足場を立てる所）
      const works = opt.scaffold && ((a.spec.module?.works?.dirty || 0) > 0 || (b.spec.module?.works?.dirty || 0) > 0);
      const lanes = w === 1 ? (works ? [] : [gx0]) : w === 2 ? (a.group !== b.group && !works ? [gx0, gx1] : [hash32(`${a.x}:${b.x}`) % 2 ? gx1 : gx0]) : [gx0 + 1];
      const yTop = Math.min(a.y, b.y);
      for (let x = gx0; x <= gx1; x++) {
        // 通りの向こう側に同じ列で路地が続くなら、ここは路地にしない（十字路を一直線に抜ける線を作らない）
        let across = false;
        {
          const y0 = Math.max(a.sd[0], b.sd[0]), g0 = inG(x, y0) && road[id(x, y0)] >= 0 ? pieces[road[id(x, y0)]].grp : -1;
          let y = y0;
          while (g0 >= 0 && inG(x, y) && road[id(x, y)] >= 0 && pieces[road[id(x, y)]].grp === g0) y++;
          across = y > y0 && inG(x, y) && road[id(x, y)] >= 0 && kept[id(x, y)] === 1;
        }
        if (lanes.includes(x) && !across) {
          // 下の通りから上へ。上に残した通りがあれば半分はそこまで抜け、残りは裏庭の途中まで（行き止まり）
          let top = yTop - 2;
          if (hash32(`gap:${x},${yTop}`) % 2) for (let y = yTop - 1; y >= Math.max(1, yTop - 4); y--) if (g[id(x, y)] === STREET || g[id(x, y)] === DIRT) { top = y + 1; break; }
          let y0 = Math.max(a.sd[0], b.sd[0]);
          for (let y = y0 - 1; y >= top; y--) {
            const k2 = id(x, y);
            if (foot[k2] >= 0 || (g[k2] !== GRASS && g[k2] !== DIRT)) break;
            g[k2] = DIRT;
          }
        } else {
          for (let y = Math.max(a.y, b.y); y <= Math.max(a.yb, b.yb); y++) if (g[id(x, y)] === GRASS && foot[id(x, y)] < 0) gap[id(x, y)] = 1;
        }
      }
    }
  }

  // 使わなかった街区（木立ち・緑地）を抜ける、曲がった土の小道。下の通りから上の通りへ（上が無ければ途中まで）
  for (const L of P.leaves) {
    if (L.flank) continue;
    const w = L.x1 - L.x0 + 1, h = L.y1 - L.y0 + 1;
    if (w < 7 || h < 5 || placed.some((p) => p.x <= L.x1 && p.x + p.w - 1 >= L.x0 && p.y <= L.y1 && p.yb >= L.y0)) continue;
    const hs = hash32(`path:${L.x0},${L.y0}`);
    let x = -1, from = -1;
    // 入口: 下の通りに出る列。通りの向こう側に同じ列で路地が続く所は避ける
    for (let t2 = 0; t2 < w - 4 && x < 0; t2++) {
      const c = L.x0 + 2 + ((hs + t2 * 5) % Math.max(1, w - 4));
      let f = -1;
      for (let y = L.y1 + 1; y <= L.y1 + 3; y++) if (inG(c, y) && kept[id(c, y)]) { f = y; break; }
      if (f < 0) continue;
      let y = f; while (inG(c, y) && kept[id(c, y)]) y++;
      if (inG(c, y) && road[id(c, y)] >= 0) continue;
      x = c; from = f;
    }
    if (from < 0) continue;
    const through = inG(x, L.y0 - 1) && kept[id(x, L.y0 - 1)] || (hs >> 8) % 3 > 0;
    const stop = through ? L.y0 : L.y0 + Math.floor(h / 2);
    let next = 2 + ((hs >> 4) % 2);
    for (let y = from - 1, k = 0; y >= stop; y--, k++) {
      if (foot[id(x, y)] >= 0 || g[id(x, y)] !== GRASS) break;
      g[id(x, y)] = DIRT;
      if (k >= next) {
        let nx = clamp(x + (hash32(`w:${x},${y}`) % 2 ? 1 : -1), L.x0 + 1, L.x1 - 1);
        if (nx === x) nx = clamp(x + (x <= L.x0 + 1 ? 1 : -1), L.x0 + 1, L.x1 - 1);     // 端なら内側へ
        if (nx !== x && g[id(nx, y)] === GRASS && foot[id(nx, y)] < 0) { g[id(nx, y)] = DIRT; x = nx; }
        next = k + 2 + (hash32(`n:${x},${y}`) % 3);
      }
    }
    // 上の通りの手前で止まったら、そこまでつなぐ（つながる通りがあるときだけ）
    if (through && inG(x, L.y0 - 1) && g[id(x, L.y0)] === DIRT && !kept[id(x, L.y0 - 1)]) {
      for (const dx of [1, -1, 2, -2]) if (inG(x + dx, L.y0 - 1) && kept[id(x + dx, L.y0 - 1)]) {
        for (let xx = Math.min(x, x + dx); xx <= Math.max(x, x + dx); xx++) if (g[id(xx, L.y0)] === GRASS && foot[id(xx, L.y0)] < 0) g[id(xx, L.y0)] = DIRT;
        break;
      }
    }
  }

  // 切り出す範囲
  // 余白は門・港の候補を残す範囲で小さくし、未使用の森だけで街を広げない。
  let x0 = plaza.x0 - 3, x1 = plaza.x1 + 3, y0 = plaza.y0 - 5, y1 = plaza.y1 + 6;
  for (const p of placed) {
    x0 = Math.min(x0, p.x - 3); x1 = Math.max(x1, p.x + p.w + 2);
    y0 = Math.min(y0, p.y - 4); y1 = Math.max(y1, p.yb + 4);
  }
  // 門を置く余地: 南北の通りが街の外へ出る所の先に、両わきの建物（と屋根）より外へ、門の絵の高さ＋数行の土の道を残す。
  // 通りの端のすぐ外まで建物が並ぶ街では、切り出す範囲がその建物で止まり、門の立つ所が無くなっていた
  if (opt.gateRows) {
    const near = (p, x) => p.x <= x + 9 && p.x + p.w - 1 >= x - 8;
    const avN = pieces.filter((p) => p.kind === 'avenue' && p.dir === 'v' && p.y1 < plaza.y0);
    const tN = avN.filter((p) => p.keep).sort((a, b) => a.keep[0] - b.keep[0])[0] || [...avN].sort((a, b) => b.y1 - a.y1)[0];
    if (tN) {
      const end = tN.keep ? tN.keep[0] : tN.y1 + 1;
      let top = end;
      for (const p of placed) if (near(p, tN.x0) && p.yb < end + 2) top = Math.min(top, p.y);
      y0 = Math.min(y0, top - opt.gateRows - 4);
    }
    const avS = pieces.filter((p) => p.kind === 'avenue' && p.dir === 'v' && p.y0 > plaza.y0);
    const bS = avS.filter((p) => p.keep).sort((a, b) => b.keep[1] - a.keep[1])[0] || [...avS].sort((a, b) => a.y0 - b.y0)[0];
    if (!quay && bS) {
      const end = bS.keep ? bS.keep[1] : bS.y0 - 1;
      let bot = end;
      for (const p of placed) if (near(p, bS.x0) && p.y > end - 2) bot = Math.max(bot, p.yb);
      y1 = Math.max(y1, bot + opt.gateRows + 4);
    }
  }
  if (quay) y1 = quay.water1;
  const crop = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(cols - 1, x1), y1: Math.min(rows - 1, y1) };
  // 岸の通りは切り出した街の幅いっぱいにする。その下は水（街の幅いっぱい）。
  // 使った桟橋の区間だけを岸にすると、岸の東西端が森で切れて港が見えなくなる。
  if (quay) {
    const a = crop.x0, b = crop.x1;
    for (let x = a; x <= b; x++) {
      const qt = Number.isFinite(quay.qt[x]) ? quay.qt[x] : quay.top;
      for (let y = qt; y <= qt + 1; y++) { g[id(x, y)] = STREET; kept[id(x, y)] = 1; }
      for (let y = qt + 2; y <= crop.y1; y++) setG(x, y, WATER);
    }
    quay.keep = [a, b];
  }

  // 街の外へ続く土の道（北・南・西・東）。ゆるく揺れる
  const wob = makeRng(P.cx * 131 + plaza.x0);
  const path = (x, y, dx, dy, w = 1, stair = 0) => {
    let off = 0, next = 3 + Math.floor(wob() * 4);
    for (let s = 0; ; s++) {
      const px = dx ? x + dx * s : x + off, py = dy ? y + dy * s : y + off;
      if (px < crop.x0 || px > crop.x1 || py < crop.y0 || py > crop.y1) break;
      if (g[id(px, py)] === WATER) break;
      for (let k = 0; k < w; k++) {
        const qx = dx ? px : px + k, qy = dy ? py + k : py;
        if (inG(qx, qy) && foot[id(qx, qy)] < 0 && g[id(qx, qy)] === GRASS) g[id(qx, qy)] = DIRT;
      }
      if (s >= next) {
        const prev = off;
        if (stair) { off += stair; next = s + 2 + Math.floor(wob() * 2); }      // 斜めの通りの続き（段々）
        else { if (wob() < 0.6) off = clamp(off + (wob() < 0.5 ? -1 : 1), -2, 2); next = s + 4 + Math.floor(wob() * 5); }
        if (off !== prev) {                             // 段差はつなぐ
          const qx = dx ? x + dx * s : x + off, qy = dy ? y + dy * s : y + off;
          if (inG(qx, qy) && foot[id(qx, qy)] < 0 && g[id(qx, qy)] === GRASS) g[id(qx, qy)] = DIRT;
          const rx = dx ? x + dx * s : x + prev, ry = dy ? y + dy * s : y + prev;
          if (dx) { for (let yy = Math.min(y + prev, y + off); yy <= Math.max(y + prev, y + off); yy++) if (g[id(rx, yy)] === GRASS && foot[id(rx, yy)] < 0) g[id(rx, yy)] = DIRT; }
          else { for (let xx = Math.min(x + prev, x + off); xx <= Math.max(x + prev, x + off); xx++) if (g[id(xx, ry)] === GRASS && foot[id(xx, ry)] < 0) g[id(xx, ry)] = DIRT; }
        }
      }
    }
  };
  const avNs = pieces.filter((p) => p.kind === 'avenue' && p.dir === 'v' && p.y1 < plaza.y0), avSs = pieces.filter((p) => p.kind === 'avenue' && p.dir === 'v' && p.y0 > plaza.y0);
  const topN = avNs.filter((p) => p.keep).sort((a, b) => a.keep[0] - b.keep[0])[0] || avNs.sort((a, b) => b.y1 - a.y1)[0];
  // 南北の通りが街の外へ出る所（門を置ける所）: 通りの列 x..x+1、端の行 end、外へ dir（-1 北・1 南）、土の道の始まりの列 col
  const exits = [];
  if (topN) {
    const end = topN.keep ? topN.keep[0] : topN.y1 + 1;
    path(topN.x0, end - 1, 0, -1, 1);
    exits.push({ dir: -1, x: topN.x0, end, col: topN.x0 });
  }
  const botS = avSs.filter((p) => p.keep).sort((a, b) => b.keep[1] - a.keep[1])[0] || avSs.sort((a, b) => a.y0 - b.y0)[0];
  if (!quay && botS) {
    const end = botS.keep ? botS.keep[1] : botS.y0 - 1;
    path(botS.x0 + 1, end + 1, 0, 1, 1, P.aSdir);
    exits.push({ dir: 1, x: botS.x0, end, col: botS.x0 + 1 });
  }
  // 大通りの両端から西と東へ。宿屋のある側は2行の街道
  let hw = Infinity, he = -Infinity;
  for (const pc of pieces) if (pc.kind === 'high' && pc.keep) { hw = Math.min(hw, pc.keep[0]); he = Math.max(he, pc.keep[1]); }
  const inn = placed.find((p) => p.spec.archetype === 'inn' && p.track.high);
  const innW = inn && inn.x < P.cx, innE = inn && inn.x > P.cx;
  if (Number.isFinite(hw)) path(hw - 1, P.Htop[Math.max(1, hw - 1)] + 1, -1, 0, innW ? 2 : 1);
  if (Number.isFinite(he)) path(he + 1, P.Htop[Math.min(cols - 2, he + 1)] + 1, 1, 0, innE ? 2 : 1);

  // 建物が少ない街では、切り出し枠の角に残る草地だけを街の外へ戻す。
  // 端の森を2マスだけ詰めて、建物から6マス以内の街区を過大にしない。
  // 通り・階段・建物・小物の置き場には触れない。
  if (!quay && placed.length <= 8) {
    const edge = [];
    for (let x = crop.x0; x <= crop.x1; x++) { edge.push([x, crop.y0], [x, crop.y1]); }
    for (let y = crop.y0 + 1; y < crop.y1; y++) { edge.push([crop.x0, y], [crop.x1, y]); }
    let trimmed = 0;
    for (const [x, y] of edge) {
      const k = id(x, y);
      if (g[k] !== GRASS || foot[k] >= 0 || kept[k] || plazaM[k]) continue;
      g[k] = OUT;
      if (++trimmed >= 2) break;
    }
  }

  // 建物・道から離れた所の距離（森の深さ）
  const dist = new Int32Array(N).fill(1 << 20);
  const dq = [];
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if ((g[t] !== GRASS && g[t] !== WATER) || foot[t] >= 0) { dist[t] = 0; dq.push(t); }
  }
  for (let h = 0; h < dq.length; h++) {
    const t = dq[h], x = t % cols, y = (t / cols) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < crop.x0 || ny < crop.y0 || nx > crop.x1 || ny > crop.y1) continue;
      const n = id(nx, ny);
      if (dist[n] > dist[t] + 1) { dist[n] = dist[t] + 1; dq.push(n); }
    }
  }
  // 裏庭（上の通りと、下の建物の屋根の間で見えている草地）と、街の内側の草地
  const garden = new Uint8Array(N), inside = new Uint8Array(N);
  const built = (k) => foot[k] >= 0 || g[k] === STREET || g[k] === DIRT || g[k] === PLAZA;
  for (let x = crop.x0; x <= crop.x1; x++) {
    for (let y = crop.y0; y <= crop.y1; y++) {
      const t = id(x, y);
      if (g[t] !== GRASS || foot[t] >= 0) continue;
      let up = false, dn = false;
      for (let d = 1; d <= 10 && !up; d++) if (inG(x, y - d) && built(id(x, y - d))) up = true;
      for (let d = 1; d <= 10 && !dn; d++) if (inG(x, y + d) && built(id(x, y + d))) dn = true;
      if (!up || !dn) continue;
      inside[t] = 1;
      // 下に建物（または通り）が近く、屋根の下ではない所
      let below = false;
      for (let d = 1; d <= maxH + 4 && !below; d++) { const k = id(x, y + d); if (!inG(x, y + d)) break; if (foot[k] >= 0) below = true; else if (g[k] !== GRASS) break; }
      if (below && !roofZ[t] && !front[t] && !gap[t]) garden[t] = 1;
    }
  }
  return { g, gap, garden, inside, kept, crop, dist, exits };
}
