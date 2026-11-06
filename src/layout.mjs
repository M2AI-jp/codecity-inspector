// RepoModel → Town（CONTRACTS.md）。同じ RepoModel（と同じ art manifest）からは常に同じ街ができる。
//
// 街のつくり:
//   - 中央の広場の北と南に東西の通り。そこから北と南へ、深さの違う街区と通りを重ねる。
//     通りはゆるく曲がり、ところどころで1行ずれる（jog）。深い街区には真ん中に土の路地が通り、家が2列に並ぶ。
//   - 南北の大通りが全ての通りをつなぎ、街区ごとに位置の違う横道・路地が抜ける。交わる所には小さな広場。
//   - 建物は3/4見下ろしなので扉は必ず南。footprint のすぐ下の1行は端から端まで歩ける地面（通り・前庭）にする。
//     footprint の上3行には他の footprint を置かない（屋根がかかる）。隣の建物とは1マス以上あける。
//   - 建物は広場に近い所から埋まり、地区（最上位ディレクトリ）は広場のまわりに扇形に並ぶ。
//     工房は広場の南の大通りの東側に集まり、廃屋は最後に（外縁に）置く。外周は角度ごとに出入りがあり、森で縁取る。
//
// 建物の大きさは art/game/manifest.json の archetypes[key].variants[*].footprint を使い、無ければ下の表を使う。
// props の (x, y) は、その小物が立つ足元の中心（tile単位）。1×1なら (tx + 0.5, ty + 1)。
import { readFileSync } from 'node:fs';

const DEFAULT_FOOT = { house_s: [5, 4], house_m: [6, 4], house_l: [7, 5], shop: [6, 4], workshop: [7, 5], ruin: [6, 4] };
const DOOR_DX = { house_s: 2, house_m: 2, house_l: 3, shop: 2, workshop: 3, ruin: 2 };
const PROP_SIZE = { well: [2, 2], noticeboard: [2, 1], bench: [2, 1] };
const PLAZA_W = 18, PLAZA_ROWS = 9;
const MARGIN = 8;
const CAP = 120;
const FLAT = 12;                    // 広場のまわり（中心から左右 FLAT マス）は通りをまっすぐに保つ
const WINDOW = 10;                  // 置けないときに先を探す幅
const WORKSHOP_ANGLE = 0.35;        // 東やや南（広場の南の大通りの東側）
const Y_WEIGHT = 1.3;               // 縦の距離を重めに見て、横長の街にする
const GRASS = 0, STREET = 1, DIRT = 2, PLAZA = 3, OUT = 4;
const CH = ['.', '#', ':', '+', ' '];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

// ---------- art manifest（建物の footprint と扉の位置） ----------
function loadArt() {
  let m;
  try { m = JSON.parse(readFileSync(new URL('../art/game/manifest.json', import.meta.url), 'utf8')); } catch { return {}; }
  const out = {};
  for (const [k, a] of Object.entries(m?.archetypes || {})) {
    const v = Array.isArray(a?.variants) && a.variants.length ? a.variants[0] : a;   // 版はすべて同じ footprint
    const fp = v?.footprint ?? a?.footprint;
    if (!Array.isArray(fp) || fp.length !== 2 || !fp.every((n) => Number.isInteger(n) && n >= 2 && n <= 16)) continue;
    const dx = v?.door?.x ?? a?.door?.x;
    out[k] = { footprint: fp, doorX: Number.isInteger(dx) ? dx : undefined };
  }
  return out;
}

function arcDistance(theta, g) {
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const t = norm(theta - g.a0);
  if (t <= g.a1 - g.a0) return 0;
  return Math.min(t - (g.a1 - g.a0), 2 * Math.PI - t);
}

// ---------- 通りを引き、建物を置く（大きめの仮想の格子の上で） ----------
function generate(groups, maxH, need, seed, scale) {
  const rng = makeRng(seed);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const area = (need * (maxH + 8) * 2.4 + 1200) * scale;
  const cols = Math.round(Math.sqrt(area * 1.5)) + 2 * MARGIN;
  const rows = Math.round(Math.sqrt(area / 1.5)) + 2 * MARGIN + 2 * (maxH + 8);
  const N = cols * rows;
  const id = (x, y) => y * cols + x;
  const cx = Math.floor(cols / 2);
  const hTop = Math.floor(rows / 2) + Math.floor(PLAZA_ROWS / 2);

  // 街全体のゆるい曲がり（全部の通りで同じなので街区の深さは変わらない）と、通りごとの1行のずれ
  const bendA = ri(1, 2), bendL = 36 + rng() * 34, bendP = rng() * 2 * Math.PI;
  const bend = (x) => {
    const d = x - cx, e = Math.sign(d) * Math.max(0, Math.abs(d) - FLAT);
    return Math.round(bendA * (Math.sin((2 * Math.PI * e) / bendL + bendP) - Math.sin(bendP)));
  };
  const makeRoad = (base, sh, code, kind) => {
    const jog = new Int8Array(cols);
    for (const dir of [-1, 1]) {
      let j = 0, next = FLAT + ri(3, 10);
      for (let d = 0; ; d++) {
        const x = dir < 0 ? cx - 1 - d : cx + d;
        if (x < 1 || x > cols - 2) break;
        if (d >= next) {
          if (rng() < 0.55) j = clamp(j + (rng() < 0.5 ? -1 : 1), -1, 1);
          next = d + ri(6, 14);
        }
        jog[x] = j;
      }
    }
    const top = new Int16Array(cols).fill(-1);
    for (let x = 1; x <= cols - 2; x++) {
      const t = base + bend(x) + jog[x];
      if (t >= 2 && t + sh <= rows - 2) top[x] = t;
    }
    // 段差で途切れないよう、低い側の列を上へのばす（btop = その列の道のいちばん上）
    const btop = Int16Array.from(top);
    for (let x = 2; x <= cols - 2; x++) {
      const a = top[x - 1], b = top[x];
      if (a < 0 || b < 0) continue;
      if (b - a >= sh) btop[x] = Math.min(btop[x], a + sh - 1);
      else if (a - b >= sh) btop[x - 1] = Math.min(btop[x - 1], b + sh - 1);
    }
    return { base, sh, code, kind, top, btop };
  };

  // 東西の通り: 広場の南の大通り H と北の通り U。そこから深さを変えながら北と南へ
  const H = makeRoad(hTop, 3, STREET, 'high');
  const U = makeRoad(hTop - PLAZA_ROWS - 2, 2, STREET, 'plaza');
  const roads = [H, U];
  const minTop = MARGIN + maxH + 4, maxBottom = rows - MARGIN;
  for (let cur = U.base; ;) {
    if (rng() < 0.35) {                                // 深い街区: 真ん中に土の路地、家は2列
      const m = cur - (1 + 2 + maxH + ri(1, 2)), u = m - (2 + 2 + maxH + ri(1, 2));
      if (u >= minTop) { roads.push(makeRoad(m, 1, DIRT, 'lane'), makeRoad(u, 2, STREET, 'street')); cur = u; continue; }
    }
    const u = cur - (2 + 2 + maxH + ri(0, 2));
    if (u < minTop) break;
    roads.push(makeRoad(u, 2, STREET, 'street'));
    cur = u;
  }
  for (let ct = H.base, cs = H.sh; ;) {
    if (rng() < 0.35) {
      const m = ct + cs + 2 + maxH + ri(1, 2), l = m + 1 + 2 + maxH + ri(1, 2);
      if (l + 2 <= maxBottom) { roads.push(makeRoad(m, 1, DIRT, 'lane'), makeRoad(l, 2, STREET, 'street')); ct = l; cs = 2; continue; }
    }
    const l = ct + cs + 2 + maxH + ri(0, 2);
    if (l + 2 > maxBottom) break;
    roads.push(makeRoad(l, 2, STREET, 'street'));
    ct = l; cs = 2;
  }
  roads.sort((a, b) => a.base - b.base);

  // 南北の大通り（広場の近くはまっすぐ、離れるとゆっくり左右にずれる）
  const aw = new Int8Array(rows);
  const wander = (from, to, step) => {
    let v = 0, next = from + step * ri(3, 8);
    for (let y = from; step < 0 ? y >= to : y <= to; y += step) {
      if (step < 0 ? y <= next : y >= next) {
        if (rng() < 0.6) v = clamp(v + (rng() < 0.5 ? -1 : 1), -2, 2);
        next = y + step * ri(5, 10);
      }
      aw[y] = v;
    }
  };
  wander(U.base - 3, 0, -1);
  wander(H.base + H.sh + 3, rows - 1, 1);
  const ax = (y) => cx + aw[clamp(y, 0, rows - 1)];

  const blocked = new Uint8Array(N);                   // 道・広場など（建物を置けない）
  const block = (x, y) => { if (x >= 0 && y >= 0 && x < cols && y < rows) blocked[id(x, y)] = 1; };
  for (const r of roads) for (let x = 1; x <= cols - 2; x++) if (r.top[x] >= 0) for (let y = r.btop[x]; y < r.top[x] + r.sh; y++) block(x, y);
  const last = roads[roads.length - 1];
  for (let y = 0; y < rows; y++) {
    const inside = y >= roads[0].base && y < last.base + last.sh;
    for (let x = ax(y) - (inside ? 1 : 2); x <= ax(y) + (inside ? 0 : 1); x++) block(x, y);   // 外へ続く道の分も
  }
  const plaza = { x0: cx - PLAZA_W / 2, x1: cx + PLAZA_W / 2 - 1, y0: U.base + U.sh, y1: H.base - 1 };
  for (let y = plaza.y0; y <= plaza.y1; y++) for (let x = plaza.x0; x <= plaza.x1; x++) block(x, y);

  // 街区を抜ける横道・路地（街区ごとに位置が違う）と、通りと交わる所の小さな広場
  const passages = [], squares = [];
  const addSquare = (c0, c1, r) => {
    const k = ri(2, 3), d = ri(2, 3);
    const sq = { x0: c0 - k, x1: c1 + k, d, road: r };
    for (let x = sq.x0; x <= sq.x1; x++) if (r.btop[x] >= 0) for (let y = r.btop[x] - d; y < r.btop[x]; y++) block(x, y);
    squares.push(sq);
  };
  for (let k = 0; k + 1 < roads.length; k++) {
    const up = roads[k], lo = roads[k + 1];
    const mid = Math.round((up.base + lo.base) / 2);
    for (const dir of [-1, 1]) {
      for (let x = ax(mid) + dir * ri(11, 19); x > MARGIN + 2 && x < cols - MARGIN - 3; x += dir * ri(14, 26)) {
        if (up === U && lo === H && Math.abs(x - cx) < PLAZA_W / 2 + 5) continue;
        const wide = up.code === STREET && lo.code === STREET && rng() < 0.4;
        const p = { x, w: wide ? 2 : 1, up, lo, code: wide ? STREET : DIRT };
        passages.push(p);
        for (let c = x; c < x + p.w; c++) if (up.top[c] >= 0 && lo.btop[c] >= 0) for (let y = up.top[c] + up.sh; y < lo.btop[c]; y++) block(c, y);
        if (wide && lo !== H && rng() < 0.45) addSquare(x, x + 1, lo);
      }
    }
  }
  for (const r of roads) if (r.code === STREET && r !== H && r !== U && rng() < 0.45) { const a = ax(r.base - 1); addSquare(a - 1, a, r); }

  // 面: 各通りの北側を、大通りから外へ向かって埋める
  const faces = [];
  roads.forEach((r, k) => {
    const up = k > 0 ? roads[k - 1] : null;
    const a = ax(r.base - 1);
    faces.push({ road: r, up, dir: -1, cursor: a - 3, limit: MARGIN, items: [] });
    faces.push({ road: r, up, dir: 1, cursor: a + 2, limit: cols - 1 - MARGIN, items: [] });
  });

  const foot = new Int32Array(N).fill(-1), roofZ = new Uint8Array(N), front = new Uint8Array(N);
  // footprint のすぐ下の行（と、通りまでの前庭）が通りにつながる位置か
  const fit = (f, x0, w, h, setback) => {
    const r = f.road, up = f.up;
    let tmin = 1e9;
    for (let x = x0; x < x0 + w; x++) {
      if (x < 2 || x > cols - 3 || r.top[x] < 0) return null;
      tmin = Math.min(tmin, r.btop[x]);
    }
    const yb = tmin - 1 - setback, y = yb - h + 1;
    if (y - 3 < 1) return null;
    for (let x = x0; x < x0 + w; x++) {
      if (up && up.top[x] >= 0 && y < up.top[x] + up.sh + 2) return null;    // 上の通りとの間に裏庭2行
      for (let yy = y; yy <= yb; yy++) { const t = id(x, yy); if (blocked[t] || foot[t] >= 0 || front[t] || roofZ[t]) return null; }
      for (let yy = y - 3; yy < y; yy++) if (foot[id(x, yy)] >= 0) return null;
      for (let yy = yb + 1; yy < Math.max(yb + 2, r.btop[x]); yy++) if (foot[id(x, yy)] >= 0) return null;
    }
    for (let yy = y; yy <= yb; yy++) if (foot[id(x0 - 1, yy)] >= 0 || foot[id(x0 + w, yy)] >= 0) return null;
    return { x: x0, y, w, h, yb };
  };
  const placed = [];
  const commit = (spec, f, pos, group) => {
    const i = placed.length;
    for (let x = pos.x; x < pos.x + pos.w; x++) {
      for (let yy = pos.y; yy <= pos.yb; yy++) foot[id(x, yy)] = i;
      for (let yy = pos.y - 3; yy < pos.y; yy++) roofZ[id(x, yy)] = 1;
      for (let yy = pos.yb + 1; yy < Math.max(pos.yb + 2, f.road.btop[x]); yy++) front[id(x, yy)] = 1;
    }
    const p = { spec, ...pos, face: f, group };
    f.items.push(p);
    placed.push(p);
  };

  // 広場からの「距離」。角度ごとに伸び縮みさせて、外周に出入りをつくる
  const harm = [2, 3, 5].map((k) => [k, rng() * 2 * Math.PI, 0.4 + rng() * 0.6]);
  const hsum = harm.reduce((t, h) => t + h[2], 0);
  const noise = (th) => harm.reduce((t, [k, p, a]) => t + a * Math.sin(k * th + p), 0) / hsum;
  const pcx = cx, pcy = (plaza.y0 + plaza.y1) / 2;
  const nominal = (f) => {
    const x = clamp(f.dir < 0 ? f.cursor - 3 : f.cursor + 3, 1, cols - 2);
    const y = (f.road.top[x] >= 0 ? f.road.top[x] : f.road.base) - 3;
    const theta = Math.atan2(y - pcy, x - pcx);
    return { r: Math.hypot(x - pcx, (y - pcy) * Y_WEIGHT) / (1 + 0.22 * noise(theta)), theta };
  };

  const queues = groups.map((g) => ({ g, items: [...g.items], ruins: [...g.ruins] }));
  for (;;) {
    const phase = queues.some((q) => q.items.length) ? 'items' : queues.some((q) => q.ruins.length) ? 'ruins' : null;
    if (!phase) break;
    let f = null, fn = null;
    for (const c of faces) {
      if (c.closed) continue;
      const n = nominal(c);
      if (!f || n.r < fn.r - 1e-9) { f = c; fn = n; }
    }
    if (!f) return null;                               // 入りきらない → 大きな格子でやり直す
    const cands = queues.filter((q) => q[phase].length)
      .map((q) => ({ q, d: arcDistance(fn.theta, q.g) }))
      .sort((a, b) => a.d - b.d || a.q.g.index - b.q.g.index);
    let done = false;
    search: for (const { q } of cands) {
      const extra = f.lastGroup !== undefined && f.lastGroup !== q.g.key && f.lastGap < 2 ? 1 : 0;
      const tried = new Set();
      for (let i = 0; i < q[phase].length; i++) {
        const s = q[phase][i];
        if (tried.has(s.w * 64 + s.h)) continue;
        tried.add(s.w * 64 + s.h);
        const setback = s.h < maxH && rng() < 0.3 ? 1 : 0;   // ときどき1行下がって前庭をつくる
        for (let k = 0; k <= WINDOW; k++) {
          const x0 = f.dir < 0 ? f.cursor - extra - k - s.w + 1 : f.cursor + extra + k;
          if (f.dir < 0 ? x0 < f.limit : x0 + s.w - 1 > f.limit) break;
          const pos = fit(f, x0, s.w, s.h, setback) || (setback ? fit(f, x0, s.w, s.h, 0) : null);
          if (!pos) continue;
          q[phase].splice(i, 1);
          commit(s, f, pos, q.g.key);
          const gap = rng() < 0.6 ? 1 : rng() < 0.75 ? 2 : 3;
          f.cursor = f.dir < 0 ? pos.x - gap - 1 : pos.x + s.w + gap;
          f.lastGap = gap;
          f.lastGroup = q.g.key;
          done = true;
          break search;
        }
      }
    }
    if (!done) {
      f.cursor += f.dir * WINDOW;
      f.lastGroup = undefined;
      if (f.dir < 0 ? f.cursor < f.limit : f.cursor > f.limit) f.closed = true;
    }
  }
  return { cols, rows, N, id, cx, roads, H, U, ax, plaza, passages, squares, faces, placed, foot, roofZ, front, pcx, pcy };
}

// ---------- 地面を塗る: 使った所だけ通りを残し、切り出し、外を「街の外」にする ----------
function finalize(P, maxH) {
  const { cols, rows, N, id, roads, H, U, ax, plaza, passages, squares, faces, placed, foot, roofZ, front } = P;
  const g = new Uint8Array(N);
  const setG = (x, y, c) => { if (x >= 0 && y >= 0 && x < cols && y < rows) g[id(x, y)] = c; };
  const keep = new Map();
  const extend = (r, a, b) => { const k = keep.get(r); keep.set(r, k ? [Math.min(k[0], a), Math.max(k[1], b)] : [a, b]); };
  for (const p of placed) extend(p.face.road, p.x - 3, p.x + p.w + 2);
  extend(U, plaza.x0 - 1, plaza.x1 + 1);
  extend(H, plaza.x0 - 1, plaza.x1 + 1);
  for (const r of [...keep.keys()]) { const a = ax(r.base); extend(r, a - 3, a + 2); }
  const kept = roads.filter((r) => keep.has(r));
  for (const r of kept) {
    const [a, b] = keep.get(r);
    for (let x = Math.max(1, a); x <= Math.min(cols - 2, b); x++) if (r.top[x] >= 0) for (let y = r.btop[x]; y < r.top[x] + r.sh; y++) setG(x, y, r.code);
  }
  const topR = kept[0], botR = kept[kept.length - 1];
  for (let y = topR.base; y < botR.base + botR.sh; y++) { setG(ax(y) - 1, y, STREET); setG(ax(y), y, STREET); }
  // 街の外へ続く土の道（北・南・西・東）
  const path = (pts) => {
    let prev = null;
    for (const [x, y] of pts) {
      if (prev) {
        for (let xx = Math.min(prev[0], x); xx <= Math.max(prev[0], x); xx++) setG(xx, prev[1], DIRT);
        for (let yy = Math.min(prev[1], y); yy <= Math.max(prev[1], y); yy++) setG(x, yy, DIRT);
      }
      setG(x, y, DIRT);
      prev = [x, y];
    }
  };
  const [h0, h1] = keep.get(H);
  const ptsN = [], ptsS = [], ptsW = [], ptsE = [];
  for (let y = topR.base - 1; y >= 1; y--) ptsN.push([ax(y) - 1, y]);
  for (let y = botR.base + botR.sh; y <= rows - 2; y++) ptsS.push([ax(y), y]);
  for (let x = h0 - 1; x >= 1; x--) if (H.top[x] >= 0) ptsW.push([x, H.top[x] + 1]);
  for (let x = h1 + 1; x <= cols - 2; x++) if (H.top[x] >= 0) ptsE.push([x, H.top[x] + 1]);
  for (const pts of [ptsN, ptsS, ptsW, ptsE]) path(pts);

  for (const p of passages) {
    const ku = keep.get(p.up), kl = keep.get(p.lo);
    if (!ku || !kl || p.x < Math.max(ku[0], kl[0]) || p.x + p.w - 1 > Math.min(ku[1], kl[1])) continue;
    for (let c = p.x; c < p.x + p.w; c++) for (let y = p.up.top[c] + p.up.sh; y < p.lo.btop[c]; y++) setG(c, y, p.code);
  }
  const keptSquares = squares.filter((s) => { const k = keep.get(s.road); return k && s.x0 >= k[0] && s.x1 <= k[1]; });
  for (const s of keptSquares) for (let x = s.x0; x <= s.x1; x++) if (s.road.btop[x] >= 0) for (let y = s.road.btop[x] - s.d; y < s.road.btop[x]; y++) setG(x, y, STREET);
  for (let y = plaza.y0; y <= plaza.y1; y++) for (let x = plaza.x0; x <= plaza.x1; x++) setG(x, y, PLAZA);
  plaza.cuts = [[plaza.x0, plaza.y0], [plaza.x0 + 1, plaza.y0], [plaza.x0, plaza.y0 + 1], [plaza.x1, plaza.y0], [plaza.x1 - 1, plaza.y0],
    [plaza.x1, plaza.y0 + 1], [plaza.x0, plaza.y1], [plaza.x1, plaza.y1]];
  for (const [x, y] of plaza.cuts) setG(x, y, GRASS);          // 角を落として植え込みに
  // footprint のすぐ下の行と前庭を舗装する
  for (const p of placed) for (let x = p.x; x < p.x + p.w; x++) {
    for (let y = p.yb + 1; y < Math.max(p.yb + 2, p.face.road.btop[x]); y++) if (g[id(x, y)] === GRASS) g[id(x, y)] = p.face.road.code;
  }
  // 建物の間の路地（下の通りから裏庭を抜けて上の通りへ）と、路地でない隙間
  const gap = new Uint8Array(N);
  for (const f of faces) {
    for (let k = 0; k + 1 < f.items.length; k++) {
      const a = f.items[k], b = f.items[k + 1];
      const gx0 = f.dir < 0 ? b.x + b.w : a.x + a.w, gx1 = f.dir < 0 ? a.x - 1 : b.x - 1;
      const w = gx1 - gx0 + 1;
      if (w < 1 || w > 4) continue;                    // 大きく飛ばした所は庭のまま
      const lanes = w === 1 ? [gx0] : w === 2 ? (a.group !== b.group ? [gx0, gx1] : [f.dir < 0 ? gx1 : gx0]) : [gx0 + 1];
      const yTop = Math.min(a.y, b.y);
      for (let x = gx0; x <= gx1; x++) {
        if (lanes.includes(x)) {
          const ku = f.up && keep.get(f.up);
          const stop = ku && x >= ku[0] && x <= ku[1] && f.up.top[x] >= 0 ? f.up.top[x] + f.up.sh : yTop - 2;
          for (let y = f.road.btop[x] - 1; y >= stop; y--) {
            const t = id(x, y);
            if (foot[t] >= 0 || (g[t] !== GRASS && g[t] !== DIRT)) break;
            g[t] = DIRT;
          }
        } else {
          for (let y = Math.max(a.y, b.y); y <= Math.max(a.yb, b.yb); y++) if (g[id(x, y)] === GRASS && foot[id(x, y)] < 0) gap[id(x, y)] = 1;
        }
      }
    }
  }

  // 切り出す範囲
  let x0 = plaza.x0 - 5, x1 = plaza.x1 + 5, y0 = plaza.y0 - U.sh - 6, y1 = plaza.y1 + H.sh + 6;
  for (const p of placed) {
    x0 = Math.min(x0, p.x - 5); x1 = Math.max(x1, p.x + p.w + 4);
    y0 = Math.min(y0, p.y - 6); y1 = Math.max(y1, p.yb + 6);
  }
  const crop = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(cols - 1, x1), y1: Math.min(rows - 1, y1) };
  // 建物・道から4マス以上離れた所は街の外
  const dist = new Int32Array(N).fill(1 << 20);
  const q = [];
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (g[t] !== GRASS || foot[t] >= 0) { dist[t] = 0; q.push(t); }
  }
  for (let h = 0; h < q.length; h++) {
    const t = q[h], x = t % cols, y = (t / cols) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < crop.x0 || ny < crop.y0 || nx > crop.x1 || ny > crop.y1) continue;
      const n = id(nx, ny);
      if (dist[n] > dist[t] + 1) { dist[n] = dist[t] + 1; q.push(n); }
    }
  }
  // 外周からつながっている遠い所だけを外にする（街の中の広い庭は草地のまま）
  const far = (t) => dist[t] > 3;
  const outQ = [];
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if ((x === crop.x0 || x === crop.x1 || y === crop.y0 || y === crop.y1) && far(t)) { g[t] = OUT; outQ.push(t); }
  }
  for (let h = 0; h < outQ.length; h++) {
    const t = outQ[h], x = t % cols, y = (t / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < crop.x0 || ny < crop.y0 || nx > crop.x1 || ny > crop.y1) continue;
      const n = id(nx, ny);
      if (far(n) && g[n] !== OUT) { g[n] = OUT; outQ.push(n); }
    }
  }

  // 裏庭（上の通りと、下の建物の屋根の間で見えている草地）
  const garden = new Uint8Array(N);
  roads.forEach((lo, k) => {
    const kl = keep.get(lo);
    if (!kl) return;
    const up = k > 0 ? roads[k - 1] : null, ku = up && keep.get(up);
    for (let x = kl[0]; x <= kl[1]; x++) {
      if (lo.btop[x] < 0) continue;
      const from = ku && x >= ku[0] && x <= ku[1] && up.top[x] >= 0 ? up.top[x] + up.sh : lo.btop[x] - (maxH + 4);
      for (let y = Math.max(0, from); y < lo.btop[x]; y++) {
        const t = id(x, y);
        if (g[t] === GRASS && foot[t] < 0 && !roofZ[t] && !front[t] && !gap[t]) garden[t] = 1;
      }
    }
  });
  return { g, gap, garden, keep, kept, keptSquares, crop };
}

// ---------- 小物（歩ける所をふさがないことを確かめながら置く） ----------
function placeProps(P, F, rng, spawn) {
  const { cols, N, id, foot, front, roofZ, plaza, ax, placed } = P;
  const { g, gap, garden, keep, kept, keptSquares, crop } = F;
  const inC = (x, y) => x >= crop.x0 && y >= crop.y0 && x <= crop.x1 && y <= crop.y1;
  const blocked = new Uint8Array(N), reserved = new Uint8Array(N);
  const walk = (x, y) => inC(x, y) && g[id(x, y)] !== OUT && foot[id(x, y)] < 0 && !blocked[id(x, y)];
  const props = [];

  // footprint のすぐ下の2行（扉の位置は絵で決まるので幅いっぱい）と前庭、開始位置のまわりは空ける
  for (const p of placed) for (let x = p.x; x < p.x + p.w; x++) for (let y = p.yb + 1; y <= p.yb + 2; y++) reserved[id(x, y)] = 1;
  for (let t = 0; t < N; t++) if (front[t]) reserved[t] = 1;
  for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) reserved[id(spawn.x + dx, spawn.y + dy)] = 1;

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
  const tryProp = (type, tx, ty) => {
    const [fw, fh] = PROP_SIZE[type] || [1, 1];
    const tiles = [];
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) tiles.push([tx + dx, ty + dy]);
    for (const [x, y] of tiles) if (!walk(x, y) || reserved[id(x, y)]) return false;
    if (tiles.length === 1 && locallySafe(tx, ty)) blocked[id(tx, ty)] = 1;
    else {
      for (const [x, y] of tiles) blocked[id(x, y)] = 1;
      if (flood().count !== reach - tiles.length) { for (const [x, y] of tiles) blocked[id(x, y)] = 0; return false; }
    }
    reach -= tiles.length;
    props.push({ type, x: tx + fw / 2, y: ty + fh });
    return true;
  };
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // 広場: 掲示板・井戸・ベンチ・街灯・植え込み
  const { x0: px0, x1: px1, y0: py0, y1: py1 } = plaza, pc = P.cx;
  tryProp('noticeboard', pc - 1, py0 + 1);
  tryProp('well', pc - 1, py0 + 4);
  tryProp('bench', pc - 6, py0 + 2);
  tryProp('bench', pc + 4, py0 + 2);
  for (const [x, y] of [[px0 + 1, py0 + 2], [px1 - 1, py0 + 2], [px0 + 1, py1 - 1], [px1 - 1, py1 - 1]]) tryProp('lamp', x, y);
  for (const [x, y] of [[px0 + 3, py0 + 5], [px1 - 3, py0 + 5]]) tryProp('tree', x, y);
  for (const [x, y] of plaza.cuts) tryProp(y === py0 && (x === px0 || x === px1) ? 'tree' : 'bush', x, y);

  // 小さな広場: 街灯・ベンチ・木
  for (const s of keptSquares) {
    const yTop = s.road.btop[s.x0] - s.d;
    tryProp('lamp', s.x0, yTop);
    if (s.x1 - s.x0 >= 6) tryProp(rng() < 0.5 ? 'bench' : 'tree', s.x1 - 1, s.road.btop[s.x1 - 1] - s.d);
  }

  // 通りの街灯: 6〜8マスごと。建物の間の隙間、通りの南の庭の縁、最後に通りの南端の行
  for (const r of kept) {
    const [a, b] = keep.get(r);
    const step = () => (r.code === STREET ? 6 + Math.floor(rng() * 3) : 10 + Math.floor(rng() * 3));
    for (let x = a + 2; x <= b - 2;) {
      const opts = [];
      for (const d of [0, 1, -1, 2, -2]) {
        const c = x + d;
        if (r.top[c] < 0 || Math.abs(c - ax(r.base) + 0.5) < 2) continue;
        if (gap[id(c, r.btop[c] - 1)]) opts.push([c, r.btop[c] - 1, 0]);
        if (garden[id(c, r.top[c] + r.sh)]) opts.push([c, r.top[c] + r.sh, 0]);
        if (r.sh >= 2 && g[id(c, r.top[c] + r.sh - 1)] === r.code) opts.push([c, r.top[c] + r.sh - 1, 2]);
      }
      opts.sort((p, q) => p[2] - q[2]);
      const ok = opts.find(([cx, cy]) => tryProp('lamp', cx, cy));
      x = ok ? ok[0] + step() : x + 1;
    }
  }
  // 大通りの街灯（道ばたの草地）
  for (let y = kept[0].base, n = 0; y < kept[kept.length - 1].base; y += 7, n++) {
    const a = ax(y);
    for (const x of n % 2 ? [a + 1, a - 2] : [a - 2, a + 1]) if (g[id(x, y)] === GRASS && tryProp('lamp', x, y)) break;
  }

  // 建物の間の隙間: 通りぎわに樽・木箱・茂み、奥に茂みや木
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (!gap[t] || g[t] !== GRASS) continue;
    const r = rng();
    const nb = foot[t - 1] >= 0 ? foot[t - 1] : foot[t + 1];
    const kind = nb >= 0 ? placed[nb].spec.module.kind : 'house';
    const frontRow = g[t + cols] !== GRASS && g[t + cols] !== OUT && !gap[t + cols];
    if (frontRow && r < 0.6) tryProp(kind === 'workshop' ? pick(['crate', 'barrel', 'crate']) : kind === 'shop' ? pick(['barrel', 'crate']) : pick(['bush', 'barrel', 'bush']), x, y);
    else if (!frontRow && r < 0.2) tryProp(r < 0.08 ? 'tree' : 'bush', x, y);
  }
  // 屋根の上にのぞく裏庭の木
  for (const p of placed) if (rng() < 0.35) tryProp('tree', p.x + Math.floor(rng() * p.w), p.y - 3);
  // 家の裏の庭: 通りぎわに柵（ところどころ切れ目）、中に茂み・木・樽
  let run = 0, gapAt = 4;
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (!garden[t] || g[t] !== GRASS) { run = 0; continue; }
    const r = rng();
    const edge = g[t - cols] === STREET || g[t - cols] === DIRT;
    if (edge) {
      run++;
      if (run % gapAt === 0) { gapAt = 3 + Math.floor(rng() * 5); continue; }
      if (r < 0.6) tryProp('fence', x, y);
    } else if (r < 0.07) tryProp('tree', x, y);
    else if (r < 0.17) tryProp('bush', x, y);
    else if (r < 0.19) tryProp(pick(['barrel', 'crate']), x, y);
  }
  // 街のまわりの森（道のすぐ脇は空ける）
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (g[t] !== GRASS || foot[t] >= 0 || garden[t] || gap[t] || roofZ[t] || reserved[t]) continue;
    let nearPath = false;
    for (const n of [t - 1, t + 1, t - cols, t + cols]) if (g[n] !== GRASS && g[n] !== OUT) nearPath = true;
    if (nearPath) continue;
    const r = rng();
    if (r < 0.28) tryProp('tree', x, y);
    else if (r < 0.36) tryProp('bush', x, y);
  }
  return props;
}

// ---------- 本体 ----------
export function layoutTown(repo, opts = {}) {
  const seed = hash32(`${repo.name}@${repo.head ?? 'worktree'}`);
  const art = opts.art ?? loadArt();
  const mods = aggregate(repo.modules || [], CAP);
  const arch = archetypes(mods);
  const specs = mods.map((m, i) => {
    const a = arch.get(m);
    const [w, h] = art[a]?.footprint ?? DEFAULT_FOOT[a];
    const doorDx = clamp(art[a]?.doorX ?? DOOR_DX[a] ?? Math.floor((w - 1) / 2), 0, w - 1);
    return { id: `b${i + 1}`, archetype: a, w, h, doorDx, module: m, district: m.path === '.' ? '.' : m.path.split('/')[0] };
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

  const maxH = Math.max(4, ...specs.map((s) => s.h));
  const need = specs.reduce((t, s) => t + s.w + 1.6, 0);
  let P = null;
  for (let attempt = 0, scale = 1; attempt < 14 && !P; attempt++, scale *= 1.25) P = generate(groups, maxH, need, seed, scale);
  if (!P) throw new Error('layoutTown: 建物を配置できなかった');
  const F = finalize(P, maxH);
  const spawn = { x: P.cx, y: P.plaza.y0 + 2 };
  const props = placeProps(P, F, makeRng(seed ^ 0x9e3779b9), spawn);

  const { x0, y0, x1, y1 } = F.crop;
  const ground = [];
  for (let y = y0; y <= y1; y++) {
    let s = '';
    for (let x = x0; x <= x1; x++) s += CH[F.g[P.id(x, y)]];
    ground.push(s);
  }
  const buildings = P.placed.map((p) => ({
    id: p.spec.id,
    archetype: p.spec.archetype,
    x: p.x - x0, y: p.y - y0, w: p.w, h: p.h,
    door: { x: p.x - x0 + p.spec.doorDx, y: p.yb - y0 },   // 目安。実際の扉の列は絵の版で決まる（下の1行は全部歩ける）
    district: p.spec.district,
    module: p.spec.module,
  })).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  // 住人: コミットの多い順に最大24人。家は、その人がよく触ったモジュールの建物
  const idOf = new Map();
  for (const b of buildings) {
    idOf.set(b.module.path, b.id);
    for (const m of b.module.merged || []) idOf.set(m, b.id);
  }
  const residents = (repo.contributors || []).slice(0, 24).map((c, i) => {
    const homes = [];
    for (const m of c.modules || []) {
      const hid = idOf.get(m);
      if (hid && !homes.includes(hid)) homes.push(hid);
      if (homes.length >= 3) break;
    }
    return { id: `r${i + 1}`, name: c.name, commits: c.commits, homes, look: hash32(c.name) % 16, lastCommit: c.lastCommit ?? null };
  });

  return {
    version: 1,
    repo: { name: repo.name, head: repo.head ?? null, branch: repo.branch ?? null, readme: repo.readme ?? null },
    tile: 16,
    cols: x1 - x0 + 1,
    rows: y1 - y0 + 1,
    ground,
    buildings,
    props: props.map((p) => ({ type: p.type, x: p.x - x0, y: p.y - y0 }))
      .sort((a, b) => a.y - b.y || a.x - b.x || cmp(a.type, b.type)),
    residents,
    spawn: { x: spawn.x - x0, y: spawn.y - y0 },
  };
}
