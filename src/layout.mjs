// RepoModel → Town（CONTRACTS.md）。同じ RepoModel からは常に同じ街ができる。
//
// 街のつくり（上から下へ繰り返す「帯」）:
//   裏庭 3行（下の建物の屋根がかかる）→ 建物 5行（扉は最下段、南向き）→ 通り 3行（石畳）
// 中央の帯の真ん中が広場。南北の大通りが全ての通りをつなぐ。建物は広場に近い順に埋まり、
// 地区（最上位ディレクトリ）は広場のまわりに扇形に並ぶ。工房は大通りの東側に集まり、廃屋は外縁に置く。
//
// props の (x, y) は、その小物が立つ足元の中心（tile単位）。1×1なら (tx + 0.5, ty + 1)。

const FOOT = { house_s: [5, 4], house_m: [6, 4], house_l: [7, 5], shop: [6, 4], workshop: [7, 5], ruin: [6, 4] };
const DOOR_DX = { house_s: 2, house_m: 2, house_l: 3, shop: 2, workshop: 3, ruin: 2 };
const PROP_SIZE = { well: [2, 2], noticeboard: [2, 1], bench: [2, 1] };
const YARD = 3, BROW = 5, STREET = 2, MAIN_STREET = 3, BAND = YARD + BROW + STREET;
const PLAZA_W = 18, PLAZA_H = YARD + BROW;
const MARGIN = 6;
const CAP = 120;
const WORKSHOP_ANGLE = 0.35;        // 東やや南（広場の下の大通りの東側）
const Y_WEIGHT = 1.3;               // 縦の距離を重めに見て、横長の街にする

// ---------- 乱数・ハッシュ ----------
function hash32(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- モジュールが多すぎるときは、小さいものから親へまとめる ----------
const sizeOf = (m) => m.lines + 30 * m.files;
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null);

function absorb(dst, src) {
  dst.merged = [...(dst.merged || []), ...(src.orig ? [src.path] : []), ...(src.merged || [])];
  dst.files += src.files; dst.lines += src.lines; dst.bytes += src.bytes;
  const langs = { ...dst.languages };
  for (const [k, v] of Object.entries(src.languages || {})) langs[k] = (langs[k] || 0) + v;
  dst.languages = Object.fromEntries(Object.entries(langs).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])));
  dst.commits = Math.max(dst.commits, src.commits);           // 正確な和集合は出せないので「少なくとも」の値
  const au = new Map((dst.authors || []).map((a) => [a.name, a.commits]));
  for (const a of src.authors || []) au.set(a.name, Math.max(au.get(a.name) || 0, a.commits));
  dst.authors = [...au.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 10).map(([name, commits]) => ({ name, commits }));
  if (src.lastCommit && (!dst.lastCommit || Date.parse(src.lastCommit.date) > Date.parse(dst.lastCommit.date))) dst.lastCommit = src.lastCommit;
  dst.topFiles = [...(dst.topFiles || []), ...(src.topFiles || [])].sort((a, b) => b.lines - a.lines || cmp(a.path, b.path)).slice(0, 8);
}

function aggregate(modules, cap) {
  // orig: path が元の RepoModel のモジュールのパスそのものか
  let list = modules.map((m) => ({ ...m, orig: true, baseReason: m.reason }));
  const bySize = (a, b) => sizeOf(a) - sizeOf(b) || cmp(a.path, b.path);
  while (list.length > cap) {
    const deep = list.filter((m) => m.path.includes('/')).sort(bySize);
    if (!deep.length) {
      // 最上位ばかりのとき: いちばん小さいものを次に小さいものへ
      const flat = list.filter((m) => m.path !== '.').sort(bySize);
      if (flat.length < 2) break;
      absorb(flat[1], flat[0]);
      list = list.filter((m) => m !== flat[0]);
      continue;
    }
    const m = deep[0];
    const parent = parentOf(m.path);
    const p = list.find((x) => x.path === parent);
    if (p) { absorb(p, m); list = list.filter((x) => x !== m); continue; }
    const sib = list.filter((x) => x !== m && parentOf(x.path) === parent).sort(bySize)[0];
    if (sib) {
      const [big, small] = sizeOf(sib) >= sizeOf(m) ? [sib, m] : [m, sib];
      const agg = { ...big, path: parent, orig: false, merged: [...(big.orig ? [big.path] : []), ...(big.merged || [])] };
      absorb(agg, small);
      list = list.filter((x) => x !== m && x !== sib);
      list.push(agg);
    } else {
      m.merged = [...(m.orig ? [m.path] : []), ...(m.merged || [])];
      m.orig = false;
      m.path = parent;
    }
  }
  return list.map(({ orig, baseReason, ...rest }) => {
    if (rest.merged?.length) {
      const n = rest.merged.length;
      rest.reason = `${baseReason}。小さなモジュール ${n} 件をまとめた（${rest.merged.slice(0, 3).join('、')}${n > 3 ? ' ほか' : ''}）`;
    }
    return rest;
  }).sort((a, b) => (a.path === '.' ? -1 : b.path === '.' ? 1 : cmp(a.path, b.path)));
}

// ---------- 建物の大きさ ----------
function archetypes(mods) {
  const out = new Map();
  const houses = mods.filter((m) => m.kind === 'house').sort((a, b) => sizeOf(a) - sizeOf(b) || cmp(a.path, b.path));
  houses.forEach((m, i) => {
    const r = houses.length > 1 ? i / (houses.length - 1) : 0.5;
    const s = sizeOf(m);
    out.set(m, s < 300 ? 'house_s' : s > 6000 && r >= 0.5 ? 'house_l' : r < 0.35 ? 'house_s' : r >= 0.8 ? 'house_l' : 'house_m');
  });
  for (const m of mods) if (m.kind !== 'house') out.set(m, m.kind);
  return out;
}

// ---------- 配置（仮想の大きな格子の上で） ----------
function arcDistance(theta, g) {
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const t = norm(theta - g.a0);
  if (t <= g.a1 - g.a0) return 0;
  return Math.min(t - (g.a1 - g.a0), 2 * Math.PI - t);
}

function tryPlace(groups, F, NB, seed) {
  const rng = makeRng(seed);
  const cols = 2 * F + 4 + 2 * MARGIN;
  const c = Math.floor(NB / 2);
  const streetH = (b) => (b === c ? MAIN_STREET : STREET);   // 広場の南の大通りだけ広い
  const tops = [MARGIN];
  for (let b = 0; b < NB; b++) tops.push(tops[b] + YARD + BROW + streetH(b));
  const rows = tops[NB] + MARGIN;
  const pcx = Math.floor(cols / 2);                 // 南北の大通りは pcx-1, pcx の2列
  const bandTop = (b) => tops[b];
  const bandBottom = (b) => bandTop(b) + YARD + BROW - 1;   // 扉の行
  const plaza = { x0: pcx - PLAZA_W / 2, x1: pcx + PLAZA_W / 2 - 1, y0: bandTop(c), y1: bandTop(c) + PLAZA_H - 1 };
  const pcy = plaza.y0 + PLAZA_H / 2;

  const faces = [];
  for (let b = 0; b < NB; b++) {
    faces.push({ b, dir: -1, cursor: b === c ? plaza.x0 - 2 : pcx - 3, limit: MARGIN, items: [] });
    faces.push({ b, dir: 1, cursor: b === c ? plaza.x1 + 2 : pcx + 2, limit: cols - 1 - MARGIN, items: [] });
  }
  const nominal = (f) => {
    const cx = f.dir < 0 ? f.cursor - 2.5 : f.cursor + 2.5;
    const cy = bandBottom(f.b) - 2;
    return { r: Math.hypot(cx - pcx, (cy - pcy) * Y_WEIGHT), theta: Math.atan2(cy - pcy, cx - pcx) };
  };
  const fits = (f, w, extra) => (f.dir < 0 ? f.cursor - extra - w + 1 >= f.limit : f.cursor + extra + w - 1 <= f.limit);

  const queues = groups.map((g) => ({ g, items: [...g.items], ruins: [...g.ruins] }));
  const placed = [];
  for (;;) {
    let phase = queues.some((q) => q.items.length) ? 'items' : queues.some((q) => q.ruins.length) ? 'ruins' : null;
    if (!phase) break;
    let best = null, bestN = null;
    for (const f of faces) {
      if (f.closed) continue;
      const n = nominal(f);
      if (!best || n.r < bestN.r - 1e-9) { best = f; bestN = n; }
    }
    if (!best) return null;                         // 入りきらない → 大きな格子でやり直す
    const f = best;
    const cands = queues.filter((q) => q[phase].length)
      .map((q) => ({ q, d: arcDistance(bestN.theta, q.g) }))
      .sort((a, b) => a.d - b.d || a.q.g.index - b.q.g.index);
    let done = false;
    for (const { q } of cands) {
      const extra = f.lastGroup !== undefined && f.lastGroup !== q.g.key && f.lastGap < 2 ? 1 : 0;
      const idx = q[phase].findIndex((s) => fits(f, s.w, extra));
      if (idx < 0) continue;
      const s = q[phase].splice(idx, 1)[0];
      const x = f.dir < 0 ? f.cursor - extra - s.w + 1 : f.cursor + extra;
      // 小さい家はときどき1行下がって、前に石畳の前庭をつくる（通りの線を揃えすぎない）
      const setback = s.h === 4 && rng() < 0.3 ? 1 : 0;
      const y = bandBottom(f.b) - s.h + 1 - setback;
      const gap = rng() < 0.6 ? 1 : rng() < 0.75 ? 2 : 3;
      f.cursor = f.dir < 0 ? x - gap - 1 : x + s.w + gap;
      f.lastGap = gap;
      f.lastGroup = q.g.key;
      const p = { spec: s, x, y, w: s.w, h: s.h, b: f.b, face: f, group: q.g.key, setback };
      f.items.push(p);
      placed.push(p);
      done = true;
      break;
    }
    if (!done) f.closed = true;
  }
  return { cols, rows, c, pcx, pcy, plaza, faces, placed, bandTop, bandBottom, streetH, NB };
}

// ---------- 地面・小物 ----------
function paint(P) {
  const { placed, plaza, pcx, c, bandTop, bandBottom, streetH, NB } = P;
  const streetY = (b) => bandBottom(b) + 1;
  const bandsWith = new Set(placed.map((p) => p.b));
  const need = new Set([...bandsWith, c - 1, c]);

  // 切り出す範囲（建物・屋根・広場・通り＋森の縁）
  let x0 = plaza.x0 - 4, x1 = plaza.x1 + 4, y0 = plaza.y0 - STREET - 2, y1 = streetY(c) + MAIN_STREET + 2;
  for (const p of placed) {
    x0 = Math.min(x0, p.x - 4); x1 = Math.max(x1, p.x + p.w + 3);
    y0 = Math.min(y0, p.y - 5); y1 = Math.max(y1, streetY(p.b) + streetH(p.b) + 2);
  }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(P.cols - 1, x1); y1 = Math.min(P.rows - 1, y1);
  const cols = x1 - x0 + 1, rows = y1 - y0 + 1;
  const ground = Array.from({ length: rows }, () => new Array(cols).fill('.'));
  const foot = new Int32Array(rows * cols).fill(-1);
  const zone = new Uint8Array(rows * cols);        // 0 草地, 1 空き地, 2 屋根の下, 3 路地わき
  const inb = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const set = (gx, gy, ch) => { const x = gx - x0, y = gy - y0; if (inb(x, y)) ground[y][x] = ch; };
  const get = (x, y) => (inb(x, y) ? ground[y][x] : ' ');

  // 通り
  const spans = new Map();
  for (const b of need) {
    if (b < 0 || b >= NB) continue;
    const items = placed.filter((p) => p.b === b);
    let s0 = pcx - 3, s1 = pcx + 2;
    for (const p of items) { s0 = Math.min(s0, p.x - 2); s1 = Math.max(s1, p.x + p.w + 1); }
    if (b === c - 1 || b === c) { s0 = Math.min(s0, plaza.x0 - 1); s1 = Math.max(s1, plaza.x1 + 1); }
    spans.set(b, [s0, s1]);
    for (let y = streetY(b); y < streetY(b) + streetH(b); y++) for (let x = s0; x <= s1; x++) set(x, y, '#');
    // 空き地（この帯の、通りの届く範囲で建物の無いところ）
    for (let y = bandTop(b); y <= bandBottom(b); y++) for (let x = s0; x <= s1; x++) {
      const gx = x - x0, gy = y - y0;
      if (inb(gx, gy)) zone[gy * cols + gx] = 1;
    }
  }
  const used = [...spans.keys()].sort((a, b) => a - b);
  const topB = used[0], botB = used[used.length - 1];
  // 大通り（南北）と、街の外へ続く土の道
  for (let y = bandTop(topB); y < streetY(botB) + streetH(botB); y++) for (const x of [pcx - 1, pcx]) set(x, y, '#');
  for (let y = y0; y < bandTop(topB); y++) set(pcx - 1, y, ':');
  for (let y = streetY(botB) + streetH(botB); y <= y1; y++) set(pcx, y, ':');
  const [m0, m1] = spans.get(c);
  for (let x = x0; x < m0; x++) set(x, streetY(c) + 1, ':');
  for (let x = m1 + 1; x <= x1; x++) set(x, streetY(c) + 1, ':');
  // 広場
  for (let y = plaza.y0; y <= plaza.y1; y++) for (let x = plaza.x0; x <= plaza.x1; x++) set(x, y, '+');

  // 建物と、建物の間の路地
  placed.forEach((p, i) => {
    const bx = p.x - x0, by = p.y - y0;
    for (let y = by; y < by + p.h; y++) for (let x = bx; x < bx + p.w; x++) { foot[y * cols + x] = i; zone[y * cols + x] = 0; }
    for (let y = by - 3; y < by; y++) for (let x = bx; x < bx + p.w; x++) if (inb(x, y) && zone[y * cols + x] === 1) zone[y * cols + x] = 2;
    p.bx = bx; p.by = by;
  });
  for (const f of P.faces) {
    for (let k = 0; k + 1 < f.items.length; k++) {
      const a = f.items[k], b = f.items[k + 1];
      const gx0 = f.dir < 0 ? b.x + b.w : a.x + a.w, gx1 = f.dir < 0 ? a.x - 1 : b.x - 1;
      const g = gx1 - gx0 + 1;
      const boundary = a.group !== b.group;
      const lane = g === 1 ? [gx0] : g === 2 ? (boundary ? [gx0, gx1] : [f.dir < 0 ? gx1 : gx0]) : [gx0 + 1];
      for (let y = bandTop(f.b); y <= bandBottom(f.b); y++) {
        for (let x = gx0; x <= gx1; x++) {
          const lx = x - x0, ly = y - y0;
          if (!inb(lx, ly)) continue;
          if (lane.includes(x)) set(x, y, ':');
          else zone[ly * cols + lx] = 3;
        }
      }
    }
  }

  // 下がった家の前庭は石畳
  for (const p of placed) if (p.setback) for (let x = p.bx; x < p.bx + p.w; x++) { ground[p.by + p.h][x] = '#'; zone[(p.by + p.h) * cols + x] = 0; }

  // 森の外は「街の外」
  const content = (x, y) => foot[y * cols + x] >= 0 || '#:+'.includes(ground[y][x]) || zone[y * cols + x] !== 0;
  const dist = new Int32Array(rows * cols).fill(1 << 20);
  const qd = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (content(x, y)) { dist[y * cols + x] = 0; qd.push(y * cols + x); }
  for (let h = 0; h < qd.length; h++) {
    const t = qd[h], x = t % cols, y = (t / cols) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = ny * cols + nx;
      if (dist[n] > dist[t] + 1) { dist[n] = dist[t] + 1; qd.push(n); }
    }
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (dist[y * cols + x] > 3) ground[y][x] = ' ';

  return { x0, y0, cols, rows, ground, foot, zone, spans, streetY, inb, get };
}

function placeProps(P, G, rng, buildings, spawn) {
  const { cols, rows, ground, foot, zone, x0, y0, inb } = G;
  const blocked = new Uint8Array(rows * cols);
  const reserved = new Uint8Array(rows * cols);
  const props = [];
  const walk = (x, y) => inb(x, y) && '.#:+'.includes(ground[y][x]) && foot[y * cols + x] < 0 && !blocked[y * cols + x];

  for (const b of buildings) {
    for (let dx = -1; dx <= 2; dx++) for (let dy = 0; dy <= 1; dy++) {
      const x = b.door.x + dx, y = b.door.y + 1 + dy;
      if (inb(x, y)) reserved[y * cols + x] = 1;
    }
  }
  for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) if (inb(spawn.x + dx, spawn.y + dy)) reserved[(spawn.y + dy) * cols + spawn.x + dx] = 1;

  // 到達できる歩行面の数（小物を置いても減らないようにする）
  const flood = () => {
    const seen = new Uint8Array(rows * cols);
    const q = [spawn.y * cols + spawn.x];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const t = q[h], x = t % cols, y = (t / cols) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!walk(nx, ny)) continue;
        const n = ny * cols + nx;
        if (!seen[n]) { seen[n] = 1; q.push(n); }
      }
    }
    return { seen, count: q.length };
  };
  // 広場から届かない草地は街の外にする（閉じた隙間を残さない）
  {
    const { seen } = flood();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (ground[y][x] === '.' && foot[y * cols + x] < 0 && !seen[y * cols + x]) ground[y][x] = ' ';
    }
  }
  let reach = flood().count;
  const RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const locallySafe = (x, y) => {
    const w = RING.map(([dx, dy]) => walk(x + dx, y + dy));
    let runs = 0;
    for (let i = 0; i < 8; i++) {
      if (!w[i] || w[(i + 7) % 8]) continue;           // 連なりの始まり
      let touches = false;
      for (let j = i; w[j % 8] && j < i + 8; j++) if (j % 2 === 1) touches = true;
      if (touches) runs++;
    }
    if (w.every(Boolean)) runs = 1;
    return runs <= 1;
  };
  const tryProp = (type, tx, ty) => {
    const [fw, fh] = PROP_SIZE[type] || [1, 1];
    const tiles = [];
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) tiles.push([tx + dx, ty + dy]);
    for (const [x, y] of tiles) if (!walk(x, y) || reserved[y * cols + x]) return false;
    if (tiles.length === 1 && locallySafe(tx, ty)) {
      blocked[ty * cols + tx] = 1;
    } else {
      for (const [x, y] of tiles) blocked[y * cols + x] = 1;
      if (flood().count !== reach - tiles.length) { for (const [x, y] of tiles) blocked[y * cols + x] = 0; return false; }
    }
    reach -= tiles.length;
    props.push({ type, x: tx + fw / 2, y: ty + fh });
    return true;
  };

  // 広場: 掲示板・井戸・ベンチ・街灯・木
  const pz = { x0: P.plaza.x0 - x0, x1: P.plaza.x1 - x0, y0: P.plaza.y0 - y0, y1: P.plaza.y1 - y0 };
  const pc = P.pcx - x0;
  tryProp('noticeboard', pc - 1, pz.y0 + 1);
  tryProp('well', pc - 1, pz.y0 + 4);
  tryProp('bench', pc - 6, pz.y0 + 2);
  tryProp('bench', pc + 4, pz.y0 + 2);
  for (const [x, y] of [[pz.x0 + 1, pz.y0 + 1], [pz.x1 - 1, pz.y0 + 1], [pz.x0 + 1, pz.y1 - 1], [pz.x1 - 1, pz.y1 - 1]]) tryProp('lamp', x, y);
  for (const [x, y] of [[pz.x0 + 3, pz.y0 + 4], [pz.x1 - 3, pz.y0 + 4]]) tryProp('tree', x, y);
  for (const [x, y] of [[pz.x0 + 3, pz.y1 - 1], [pz.x1 - 3, pz.y1 - 1]]) tryProp('bush', x, y);

  // 通りの街灯（建物の角、扉の前は避ける）と、建物の角の樽・木箱
  const doorAt = new Map();
  for (const b of buildings) doorAt.set(b.door.y * cols + b.door.x, b);
  const nearDoor = (x, y) => {
    for (let dx = -2; dx <= 1; dx++) if (doorAt.has((y - 1) * cols + x + dx)) return true;
    return false;
  };
  // 街灯: 通りに沿って 6〜8 マスごと。建物の間の空き列か空き地の端を優先し、無ければ建物の角の前の石畳
  for (const [b, [s0, s1]] of [...G.spans.entries()].sort((a, b) => a[0] - b[0])) {
    const yf = G.streetY(b) - y0, yd = yf - 1;
    const cand = (x) => {
      if (!inb(x, yf) || x + x0 === P.pcx - 1 || x + x0 === P.pcx) return null;
      if (ground[yd][x] === '.' && foot[yd * cols + x] < 0 && (zone[yd * cols + x] === 1 || zone[yd * cols + x] === 3)) return [x, yd, 0];
      if (foot[yd * cols + x] >= 0 && !nearDoor(x, yf)) return [x, yf, 1];
      return null;
    };
    let next = s0 - x0 + 1;
    while (next <= s1 - x0) {
      const opts = [0, 1, 2, -1, 3].map((d) => cand(next + d)).filter(Boolean).sort((p, q) => p[2] - q[2]);
      const ok = opts.find(([x, y]) => tryProp('lamp', x, y));
      next = ok ? ok[0] + 6 + Math.floor(rng() * 3) : next + 1;   // 置けなければ1マスずつ探す
    }
  }
  // 建物の角の前（壁ぎわ、扉の前は空ける）: 工房は木箱・樽、商店は樽、住宅と廃屋はときどき茂みや樽
  for (const b of buildings) {
    const kind = b.module.kind;
    const n = kind === 'workshop' ? 2 : kind === 'shop' ? 1 : rng() < 0.45 ? 1 : 0;
    if (!n) continue;
    const y = b.y + b.h;
    const kinds = kind === 'workshop' ? ['crate', 'barrel', 'crate'] : kind === 'shop' ? ['barrel', 'crate', 'bush'] : kind === 'ruin' ? ['bush', 'crate'] : ['bush', 'barrel', 'bush'];
    const spots = [b.x, b.x + b.w - 1].filter((x) => !nearDoor(x, y));
    for (let k = 0; k < n && spots.length; k++) {
      const x = spots.splice(Math.floor(rng() * spots.length), 1)[0];
      tryProp(kinds[Math.floor(rng() * kinds.length)], x, y);
    }
  }
  // 屋根の上にのぞく裏庭の木
  for (const b of buildings) {
    if (rng() < 0.4) tryProp('tree', b.x + Math.floor(rng() * b.w), b.y - 3);
  }
  // 建物の間の、路地でない列: 樽・木箱・茂み
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (zone[y * cols + x] !== 3 || ground[y][x] !== '.') continue;
    const r = rng();
    const nb = foot[y * cols + x - 1] >= 0 ? foot[y * cols + x - 1] : foot[y * cols + x + 1];
    const kind = nb >= 0 ? buildings[nb].module.kind : 'house';
    const front = foot[(y + 1) * cols + x] < 0 && ground[y + 1]?.[x] === '#';
    if (front && r < 0.6) tryProp(kind === 'workshop' ? (r < 0.3 ? 'crate' : 'barrel') : kind === 'shop' ? (r < 0.3 ? 'barrel' : 'crate') : r < 0.35 ? 'bush' : 'barrel', x, y);
    else if (!front && r < 0.2) tryProp(r < 0.1 ? 'tree' : 'bush', x, y);
  }
  // 空き地: 柵で囲った庭と木
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (zone[y * cols + x] !== 1 || ground[y][x] !== '.') continue;
    const r = rng();
    const front = ground[y + 1]?.[x] === '#';
    if (front) { if (r < 0.7) tryProp('fence', x, y); }
    else if (r < 0.1) tryProp('tree', x, y);
    else if (r < 0.18) tryProp('bush', x, y);
  }
  // 街のまわりの森（道のすぐ脇は空ける）
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (zone[y * cols + x] !== 0 || ground[y][x] !== '.' || foot[y * cols + x] >= 0) continue;
    let nearPath = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if ('#:+'.includes(get(G, x + dx, y + dy))) nearPath = true;
    if (nearPath) continue;
    const r = rng();
    if (r < 0.26) tryProp('tree', x, y);
    else if (r < 0.34) tryProp('bush', x, y);
  }
  props.sort((a, b) => a.y - b.y || a.x - b.x || cmp(a.type, b.type));
  return props;
}
const get = (G, x, y) => G.get(x, y);

// ---------- 本体 ----------
export function layoutTown(repo) {
  const seed = hash32(`${repo.name}@${repo.head ?? 'worktree'}`);
  const mods = aggregate(repo.modules || [], CAP);
  const arch = archetypes(mods);
  const specs = mods.map((m, i) => {
    const a = arch.get(m);
    const [w, h] = FOOT[a];
    return { id: `b${i + 1}`, archetype: a, w, h, module: m, district: m.path === '.' ? '.' : m.path.split('/')[0] };
  });

  // 工房はひとまとまり、それ以外は最上位ディレクトリごとの地区
  const byKey = new Map();
  const groupOf = (key) => {
    if (!byKey.has(key)) byKey.set(key, { key, items: [], ruins: [] });
    return byKey.get(key);
  };
  for (const s of specs) {
    if (s.module.kind === 'workshop') groupOf('\u0000workshops').items.push(s);
    else if (s.module.kind === 'ruin') groupOf(s.district).ruins.push(s);
    else groupOf(s.district).items.push(s);
  }
  const demand = (g) => [...g.items, ...g.ruins].reduce((t, s) => t + s.w + 1.6, 0);
  const groups = [...byKey.values()].sort((a, b) => {
    if (a.key === '\u0000workshops') return -1;
    if (b.key === '\u0000workshops') return 1;
    return demand(b) - demand(a) || cmp(a.key, b.key);
  });
  for (const g of groups) g.items.sort((a, b) => cmp(a.district, b.district) || cmp(a.module.path, b.module.path));
  const total = groups.reduce((t, g) => t + demand(g), 0) || 1;
  let a = WORKSHOP_ANGLE - (groups[0] ? (Math.PI * demand(groups[0])) / total : 0);
  groups.forEach((g, i) => {
    g.index = i;
    g.a0 = a;
    a += (2 * Math.PI * demand(g)) / total;
    g.a1 = a;
  });

  // 入りきるまで格子を広げる
  const need = specs.reduce((t, s) => t + s.w + 1.6, 0);
  const odd = (v) => Math.max(3, 2 * Math.round((v - 1) / 2) + 1);
  let NB = odd(Math.sqrt(need / (0.7 * 1.5 * BAND)));
  let F = Math.max(16, Math.ceil(need / 0.7 / (2 * NB)) + 6);
  let P = null;
  for (let attempt = 0; attempt < 40 && !P; attempt++) {
    P = tryPlace(groups, F, NB, seed);
    if (!P) { F += 8; if (attempt % 2 === 1) NB += 2; }
  }
  if (!P) throw new Error('layoutTown: 建物を配置できなかった');

  const rng = makeRng(seed ^ 0x9e3779b9);
  const G = paint(P);
  const buildings = P.placed.map((p) => ({
    id: p.spec.id,
    archetype: p.spec.archetype,
    x: p.bx, y: p.by, w: p.w, h: p.h,
    door: { x: p.bx + DOOR_DX[p.spec.archetype], y: p.by + p.h - 1 },
    district: p.spec.district,
    module: p.spec.module,
  })).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  // foot の番号は placed の順なので、buildings の並びに合わせて引けるようにする
  const byPlaced = P.placed.map((p) => buildings.find((b) => b.id === p.spec.id));
  const spawn = { x: P.pcx - G.x0, y: P.plaza.y0 - G.y0 + 2 };
  const props = placeProps(P, G, rng, byPlaced, spawn);

  // 住人: コミットの多い順に最大24人。家は、その人がよく触ったモジュールの建物
  const idOf = new Map();
  for (const b of buildings) {
    idOf.set(b.module.path, b.id);
    for (const m of b.module.merged || []) idOf.set(m, b.id);
  }
  const residents = (repo.contributors || []).slice(0, 24).map((c, i) => {
    const homes = [];
    for (const m of c.modules || []) {
      const id = idOf.get(m);
      if (id && !homes.includes(id)) homes.push(id);
      if (homes.length >= 3) break;
    }
    return { id: `r${i + 1}`, name: c.name, commits: c.commits, homes, look: hash32(c.name) % 16 };
  });

  return {
    version: 1,
    repo: { name: repo.name, head: repo.head ?? null, branch: repo.branch ?? null, readme: repo.readme ?? null },
    tile: 16,
    cols: G.cols,
    rows: G.rows,
    ground: G.ground.map((r) => r.join('')),
    buildings,
    props,
    residents,
    spawn,
  };
}
