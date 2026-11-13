// RepoModel → Town（CONTRACTS.md）。同じ RepoModel（と同じ art manifest）からは常に同じ街ができる。
//
// 街のつくり（古い街並み。通りは街の端から端まで通さない）:
//   - 骨組み: 中央の広場（角に植え込み、役場の前は広場の石が通りまで張り出す）、広場の南の大通り（東西、
//     ゆるく曲がり段差がある）、広場の北の通り、広場の両わきの南北の通り、役場の脇から北へ・大通りから南へ
//     の南北の通り（北と南で位置がずれるので十字路にならない）。
//   - その外側の地区を、通りで切り分けていく（BSP）。南北・東西の切れ目は地区ごとに位置が違い、
//     通りは T 字に突き当たり、ところどころ1行ずれる。街区の深さと幅は毎回違い、深い街区には土の路地
//     （ときどき途中で行き止まり）、広い街区には南北の小路が抜ける。小さな街区のいくつかは小さな緑地。
//   - 建物は3/4見下ろしなので扉は必ず南。footprint のすぐ下の1行は端から端まで歩ける地面（通り・前庭）。
//     footprint の上は版ごとの cover だけを屋根の余白にし、同じ通りの隣は壁を接して置ける。
//   - 建物は広場に近い所から埋まり、地区（最上位ディレクトリ）は広場のまわりに扇形に並ぶ。
//     工房は広場の南の大通りの東側に集まり、廃屋は最後に（外縁に）置く。使わなかった通りは消え、
//     街のまわりは森になる。街の外へ出る道が何本か残る。
//   - 船着場（dock）があるときは、街の南の端が水辺になる: 船着場の前の岸の通り（石の岸壁）、その下の水、
//     水に突き出た桟橋（歩ける）、もやった舟。
//   - 井戸（well）は建物ではなく、広場か近くの緑地に立つ井戸小屋（town.landmarks と props の wellhouse）。
//   - 作業中の変更がある建物（module.works.dirty > 0）には足場・工事中の札・材木を置く（絵があるときだけ）。
//
// 建物の大きさは art/game/manifest.json の archetypes[key].variants[*].footprint を使い、無ければ下の表を使う。
// props の (x, y) は、その小物が立つ足元の中心（tile単位）。1×1なら (tx + 0.5, ty + 1)。
import { readFileSync } from 'node:fs';

const DEFAULT_FOOT = { house_s: [5, 4], house_m: [6, 4], house_l: [7, 5], shop: [6, 4], workshop: [7, 5], ruin: [6, 4], repair: [6, 4] };
const DOOR_DX = { house_s: 2, house_m: 2, house_l: 3, shop: 2, workshop: 3, ruin: 2 };
// 施設（PRODUCT.md §4）。art manifest にその archetype の絵があるものだけを置く（作ったものだけを置く）。
export const FACILITY_NAME = { town_hall: '役場', inn: '宿屋', pub: '酒場', warehouse: '倉庫', watchtower: '見張り台', dojo: '道場', dock: '船着場', repair: '修理小屋' };
// 外に立つ施設（建物ではなく小物＋外に立つ番人）。その小物の絵があるときだけ置く
export const LANDMARK = { well: { name: '井戸', prop: 'wellhouse' }, gate: { name: '門', prop: 'gate' } };
const CROWD_CAP = 40;               // 街を歩く常連の上限
const RECENT_DAYS = 90;
const PROP_SIZE = { well: [2, 2], 'canal-mouth': [2, 1], noticeboard: [2, 1], bench: [2, 1], cart: [3, 1] };
const MARGIN = 6;
const CAP = 120;
const WINDOW = 10;                  // 置けないときに先を探す幅
const WORKSHOP_ANGLE = 0.35;        // 東やや南（広場の南の大通りの東側）
const Y_WEIGHT = 1.1;               // 縦の距離を少し重めに見て、やや横長の街にする
const GRASS = 0, STREET = 1, DIRT = 2, PLAZA = 3, OUT = 4, WATER = 5;
const CH = ['.', '#', ':', '+', ' ', '~'];
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
  const langs = Object.assign(Object.create(null), dst.languages);
  for (const [k, v] of Object.entries(src.languages || {})) langs[k] = (langs[k] || 0) + v;
  dst.languages = Object.fromEntries(Object.entries(langs).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])));
  dst.commits = Math.max(dst.commits, src.commits);           // 正確な和集合は出せないので「少なくとも」の値
  const au = new Map((dst.authors || []).map((a) => [a.name, a.commits]));
  for (const a of src.authors || []) au.set(a.name, Math.max(au.get(a.name) || 0, a.commits));
  dst.authors = [...au.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 10).map(([name, commits]) => ({ name, commits }));
  if (src.lastCommit && (!dst.lastCommit || Date.parse(src.lastCommit.date) > Date.parse(dst.lastCommit.date))) dst.lastCommit = src.lastCommit;
  dst.topFiles = [...(dst.topFiles || []), ...(src.topFiles || [])].sort((a, b) => b.lines - a.lines || cmp(a.path, b.path)).slice(0, 8);
  // 作業中の変更（未コミットのファイル数）は足す
  const dirty = (dst.works?.dirty || 0) + (src.works?.dirty || 0);
  if (dirty > 0) dst.works = { ...(dst.works || {}), dirty };
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

// ---------- art manifest（建物の footprint と扉の位置、小物の大きさ） ----------
let manifestCache;
function defaultManifest() {
  if (manifestCache === undefined) {
    try { manifestCache = JSON.parse(readFileSync(new URL('../art/game/manifest.json', import.meta.url), 'utf8')); }
    catch { manifestCache = null; }
  }
  return manifestCache;
}
export function loadArt(manifest) {
  const m = manifest ?? defaultManifest();
  const out = {};
  const okFp = (fp) => Array.isArray(fp) && fp.length === 2 && fp.every((n) => Number.isInteger(n) && n >= 2 && n <= 16);
  for (const [k, a] of Object.entries(m?.archetypes || {})) {
    const defs = Array.isArray(a?.variants) && a.variants.length ? a.variants : [a];
    const v = defs[0];                                  // 版はすべて同じ footprint
    const fp = v?.footprint ?? a?.footprint;
    if (!okFp(fp)) continue;
    const dx = v?.door?.x ?? a?.door?.x;
    // 版ごとの扉（同じ footprint の版だけ。版の名前は town.json の building.variant に書く）
    const variants = defs.filter((d) => d?.id && (!d.footprint || (d.footprint[0] === fp[0] && d.footprint[1] === fp[1])))
      .map((d) => ({ id: d.id, doorX: Number.isInteger(d.door?.x) ? d.door.x : undefined, doorW: Number.isInteger(d.door?.w) ? d.door.w : 1,
        wall: Array.isArray(d.wall) && d.wall.length === 2 && d.wall.every(Number.isFinite) ? d.wall : [0, 0],
        // 絵が footprint の上にかぶさる行の数（列ごと）。その行の草地は屋根の陰で見えない
        cover: Array.isArray(d.cover) && d.cover.length === fp[0] && d.cover.every((n) => Number.isInteger(n) && n >= 0) ? d.cover : null }));
    const roof = Math.max(0, ...defs.map((d) => Number(d?.exterior?.origin?.[1]) || 0));     // 屋根の高さ（px）
    out[k] = { footprint: fp, doorX: Number.isInteger(dx) ? dx : undefined, variants, roof };
  }
  return out;
}
// 小物: 足元を原点にした solid / deck（px）と layer。layout は tile 単位で場所を取る
const isBox = (a) => Array.isArray(a) && a.length >= 4 && a.slice(0, 4).every(Number.isFinite);
export function loadProps(manifest) {
  const m = manifest ?? defaultManifest();
  const out = {};
  for (const [k, p] of Object.entries(m?.props || {})) {
    out[k] = { solid: isBox(p?.solid) ? p.solid.slice(0, 4) : null, deck: isBox(p?.deck) ? p.deck.slice(0, 4) : null,
      layer: p?.layer === 'ground' ? 'ground' : null };
    // 門: 柱（solids）・くぐれる所（opening）・灯（lights）・絵の原点（origin）。足元を原点にした px
    if (Array.isArray(p?.origin) && p.origin.length >= 2 && p.origin.slice(0, 2).every(Number.isFinite)) out[k].origin = p.origin.slice(0, 2);
    if (Array.isArray(p?.solids) && p.solids.length && p.solids.every(isBox)) out[k].solids = p.solids.map((b) => b.slice(0, 4));
    if (isBox(p?.opening)) out[k].opening = p.opening.slice(0, 4);
    if (Array.isArray(p?.size) && p.size.length >= 2 && p.size.slice(0, 2).every(Number.isFinite)) out[k].size = p.size.slice(0, 2);
    const ls = Array.isArray(p?.lights) && p.lights.length ? p.lights : Array.isArray(p?.light) ? [p.light] : [];
    if (ls.length && ls.every((l) => Array.isArray(l) && l.length >= 3 && l.slice(0, 3).every(Number.isFinite))) out[k].lights = ls.map((l) => l.slice(0, 3));
  }
  return out;
}
// 地面の texture の名前（水辺は water があるときだけつくる）
export function loadGround(manifest) {
  const m = manifest ?? defaultManifest();
  return Object.keys(m?.ground || {});
}
// 小物の tile の大きさ（足元は下辺の中央）: 表に無ければ solid の幅と奥行きから
export function propTiles(type, propArt) {
  if (PROP_SIZE[type]) return PROP_SIZE[type];
  const s = propArt?.[type]?.solid;
  if (!s) return [1, 1];
  return [Math.max(1, Math.round(s[2] / 16)), Math.max(1, Math.ceil(s[3] / 16))];
}

function arcDistance(theta, g) {
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const t = norm(theta - g.a0);
  if (t <= g.a1 - g.a0) return 0;
  return Math.min(t - (g.a1 - g.a0), 2 * Math.PI - t);
}
const arc = (a, b) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);

// ---------- 通りを引き、建物を置く（大きめの仮想の格子の上で） ----------
function generate(C, scale) {
  const { groups, maxH, need, seed, fac } = C;
  const rng = makeRng(seed);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const chance = (p) => rng() < p;
  const harbour = fac.dock ? C.harbour : null;
  // 建物の数に対して仮想格子を広げすぎない。面を順に埋めるので、
  // 旧来の大きな余白（2.4係数・固定1200）を残すと通りだけが増える。
  const harbourArea = harbour ? (C.count > 40 ? 0.16 : 0.18) : 0.22;
  const area = Math.max(360, need * (maxH + 8) * harbourArea + 100) * scale;
  // 面積は保ったまま横長を抑え、建物を近い列へ積める格子にする。
  const cols = Math.round(Math.sqrt(area)) + 2 * MARGIN - (harbour ? 0 : 1);
  // 北南の門の絵は footprint より約6行高い。港以外では外縁の3行を
  // 門の候補に残す（届かない草地は finalize が街の外にする）。
  const baseRows = Math.round(Math.sqrt(area)) + 2 * MARGIN + maxH + 4;
  let rows = baseRows + (C.gateRows && !harbour ? 5 : 0);
  const PR = Math.max(4, maxH - 1);                                  // 広場の奥行き（密集した街区でも前庭を残す）
  const PW = fac.hall ? 12 : 10 + 2 * ri(0, 1);                       // 広場の幅（小さく、まわりを建物の正面が囲む）
  // 水辺: 大通りの南は街区 1〜3 段、その下に岸の通りと水。北へ広げる分、格子を縦に足す
  let southRows = 0, hTop;
  if (harbour) {
    const n = C.count;
    // 船着場までの南側は2〜3段の街区に収める。旧来の17〜19行は
    // 建物のない芝生と長い通りを水際まで残していたので、港の街を縦に引き延ばす。
    southRows = n <= 22 ? ri(8, 9) : n <= 70 ? ri(11, 13) : ri(22, 24);
    rows = Math.round(rows * 1.3);
    hTop = rows - 1 - harbour.water - 2 - southRows - 3;
  } else hTop = Math.floor(baseRows / 2) + Math.floor(PR / 2);
  const N = cols * rows;
  const id = (x, y) => y * cols + x;
  const inG = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const cx = Math.floor(cols / 2);

  // ---- 地図: 通り（piece の番号）、広場、予約（切ってはいけない所）
  const road = new Int32Array(N).fill(-1);
  const pieces = [];
  let grpAuto = 1 << 20;                                             // 1つだけの piece の通りの番号
  const addPiece = (dir, x0, y0, x1, y1, code, kind, grp) => {
    x0 = Math.max(1, x0); y0 = Math.max(1, y0); x1 = Math.min(cols - 2, x1); y1 = Math.min(rows - 2, y1);
    if (x1 < x0 || y1 < y0) return -1;
    const k = pieces.length;
    pieces.push({ k, dir, x0, y0, x1, y1, code, kind, grp: grp ?? grpAuto++ });
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (road[id(x, y)] < 0) road[id(x, y)] = k;
    return k;
  };
  const isRoad = (x, y) => inG(x, y) && road[id(x, y)] >= 0;
  const pinned = [];
  const hitsPin = (x0, y0, x1, y1) => pinned.some(([a, b, c, d]) => x0 <= c && x1 >= a && y0 <= d && y1 >= b);

  // ---- 通りを引く道具: 曲がりながら続く通り。まっすぐは seg（7〜12）マスまでで、そこで ±1 ずれる（lo..hi の中、予約は避ける）。
  // stair なら 2〜3 マスごとに同じ向きへ1ずれる段々の通り（斜めに見える）。flatN: はじめの何マスかはずらさない
  let grpN = 0;
  const meander = (dir, base, from, to, sw, code, kind, o = {}) => {
    const grp = grpN++;
    const step = from <= to ? 1 : -1, n = Math.abs(to - from) + 1;
    const lo = o.lo ?? -1, hi = o.hi ?? 1, seg = o.seg ?? [5, 10];
    const prof = new Map();
    const box = (a, v) => (dir === 'h' ? [a, base + v, a, base + v + sw - 1] : [base + v, a, base + v + sw - 1, a]);
    const free = (a, v) => { const r = box(a, v); return !hitsPin(r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1) && (!o.ok || o.ok(a, v)); };
    const emit = (a0, a1, v) => {
      const p = Math.min(a0, a1), q = Math.max(a0, a1);
      if (dir === 'h') addPiece('h', p, base + v, q, base + v + sw - 1, code, kind, grp);
      else addPiece('v', base + v, p, base + v + sw - 1, q, code, kind, grp);
    };
    // はじめの一区間は短め（交差点の向こうの通りと一直線につながりにくくする）
    let cur = 0, runA = from, next = (o.flatN || 0) + (o.jogAfterFlat ? 0 : o.stair ? ri(2, 3) : ri(2, 6));
    for (let i = 0; i < n; i++) {
      const a = from + i * step;
      let v = cur;
      if (i >= next) {
        // 範囲の端にいれば、内側へ（まっすぐのまま続けない）
        const want = o.stair ? cur + o.stair : cur <= lo ? cur + 1 : cur >= hi ? cur - 1 : cur + (rng() < 0.5 ? -1 : 1);
        const alt = o.stair ? cur : clamp(2 * cur - want, lo, hi);
        if (want !== cur && free(a, want) && free(a + step, want)) v = want;
        else if (alt !== cur && free(a, alt) && free(a + step, alt)) v = alt;
        next = i + (o.stair ? ri(2, 3) : ri(seg[0], seg[1]));
      }
      if (v !== 0 && !free(a, v) && free(a, 0)) v = 0;
      if (v !== cur) {
        emit(runA, a - step, cur);
        if (sw === 1 || Math.abs(v - cur) >= sw) {               // 段差をつなぐ
          const m0 = Math.min(cur, v), m1 = Math.max(cur, v) + sw - 1;
          if (dir === 'h') addPiece('v', a, base + m0, a, base + m1, code, kind, grp);
          else addPiece('h', base + m0, a, base + m1, a, code, kind, grp);
        }
        runA = a; cur = v;
      }
      prof.set(a, v);
    }
    emit(runA, to, cur);
    let mn = Infinity, mx = -Infinity;
    for (const v of prof.values()) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const at = (a) => base + (prof.get(clamp(a, Math.min(from, to), Math.max(from, to))) ?? 0);
    return { grp, at, min: base + mn, max: base + mx, sw };
  };

  // ---- 広場の南の大通り H（3行）: 広場の下はまっすぐ、その外は 7〜12 マスごとに1行ずれる
  const PWh = PW / 2;
  const Htop = new Int16Array(cols).fill(-1);
  {
    const L = meander('h', hTop, cx + PWh - 1, 1, 3, STREET, 'high', { flatN: PW, jogAfterFlat: true });
    const R = meander('h', hTop, cx + PWh, cols - 2, 3, STREET, 'high', { flatN: 1, jogAfterFlat: true });
    for (let x = 1; x <= cx + PWh - 1; x++) Htop[x] = L.at(x);
    for (let x = cx + PWh; x <= cols - 2; x++) Htop[x] = R.at(x);
  }
  const hMinTop = (a, b) => { let m = 1e9; for (let x = Math.max(1, a); x <= Math.min(cols - 2, b); x++) m = Math.min(m, Htop[x]); return m; };
  const hMaxBot = (a, b) => { let m = -1; for (let x = Math.max(1, a); x <= Math.min(cols - 2, b); x++) m = Math.max(m, Htop[x] + 2); return m; };

  // ---- 広場と、そのまわりの通り。広場の北の端（2行）は、両わきでは北の通り、広場の幅では広場の石。
  // 広場の北に面する建物（役場とその両隣）は扉を広場に向ける
  const py1 = hTop - 1, py0 = py1 - PR - 1;
  const px0 = cx - PW / 2, px1 = cx + PW / 2 - 1;
  const plaza = { x0: px0, x1: px1, y0: py0, y1: py1 };
  const plazaM = new Uint8Array(N);
  for (let y = py0; y <= py1; y++) for (let x = px0; x <= px1; x++) plazaM[id(x, y)] = 1;
  // 広場の両わき（酒場など、大通りに扉を向ける街区）の幅。北の通りが 14 マスを越えないように
  const pubW = fac.pub ? fac.pub.w : 0;
  const fwL = Math.max(fac.pubSide < 0 ? pubW + 1 + ri(0, 3) : 0, ri(8, 12));
  const fwR = Math.max(fac.pubSide > 0 ? pubW + 1 + ri(0, 3) : 0, ri(8, 12));
  // 外側の脇道が地図の端を越えると、meander の空区間が無限長になる。
  // 小さな街では広場の幅を優先し、左右の地区だけを内側へ詰める。
  const kx0 = Math.max(2, px0 - fwL), kx1 = Math.min(cols - 3, px1 + fwR);
  const U = [addPiece('h', kx0 - 2, py0, px0 - 1, py0 + 1, STREET, 'plaza'), addPiece('h', px1 + 1, py0, kx1 + 2, py0 + 1, STREET, 'plaza')];
  // 広場の両わきの南北の通り: 広場のわきはまっすぐ、北では外へ向かって1列ずつずれる
  const VW = meander('v', kx0 - 2, hMinTop(kx0 - 2, kx0 - 1) + 1, 1, 2, STREET, 'side', { lo: -1, hi: 0, flatN: hMinTop(kx0 - 2, kx0 - 1) + 1 - py0 + 3, jogAfterFlat: true });
  const VE = meander('v', kx1 + 1, hMinTop(kx1 + 1, kx1 + 2) + 1, 1, 2, STREET, 'side', { lo: 0, hi: 1, flatN: hMinTop(kx1 + 1, kx1 + 2) + 1 - py0 + 3, jogAfterFlat: true });
  // 役場: 広場の北の真ん中、北の通りに面して。北へ向かう通りは役場の脇を通り、役場の上からは曲がって北へ
  let hall = null, aN;
  if (fac.hall) {
    const hx = cx - Math.floor(fac.hall.w / 2), yb = py0 - 1;
    hall = { x: hx, y: yb - fac.hall.h + 1, w: fac.hall.w, h: fac.hall.h, yb };
    // 役場自身を守る予約にとどめ、左右の建物が壁まで寄れるようにする。
    pinned.push([hx, hall.y - 2, hx + fac.hall.w - 1, yb]);
    // 北へ抜ける通りは役場のすぐ横ではなく、隣家のさらに外側を通す。
    // 役場の左右を建物で埋めても、通りがその footprint を横切らないようにする。
    aN = fac.hallSide > 0 ? hx + fac.hall.w + 7 + ri(0, 1) : hx - 8 - ri(0, 1);
  } else aN = cx + (rng() < 0.5 ? -1 : 1) * ri(3, 6);
  const AN = meander('v', aN, py0 - 1, 1, 2, STREET, 'avenue', { flatN: hall ? py0 - hall.y + 3 : 4, jogAfterFlat: true });
  // 南へ向かう通りは、広場の南から街の端へ段々に斜めに下る（北の通りと位置もずらす）
  let aS = cx + (rng() < 0.5 ? -1 : 1) * ri(2, 6);
  if (Math.abs(aS - aN) < 3) aS = aN + (aN < cx ? 4 : -4);
  const dirS = aS < cx ? -1 : 1;
  const southEnd = harbour ? hTop + 3 + southRows - 1 : rows - 2;
  const AS = meander('v', aS, Htop[aS], southEnd, 2, STREET, 'avenue', { stair: dirS, flatN: 3, ok: (y, v) => aS + v >= MARGIN + 6 && aS + v <= cols - MARGIN - 8 });
  const aSq = AS.at(southEnd);
  // 船着場: 岸の通りに面して、斜めの通りの下の端の脇（斜めが来る側の反対）
  let dockAt = null;
  if (harbour) {
    const d = fac.dock, side = dirS;
    const x = side < 0 ? aSq - 2 - d.w - ri(0, 3) : aSq + 3 + ri(0, 3);
    const yb = hTop + 3 + southRows - 1;
    dockAt = { x, y: yb - d.h + 1, w: d.w, h: d.h, yb };
    pinned.push([x - 1, dockAt.y - 2, x + d.w, yb]);
  }
  // 水辺: 岸の通り（街の幅いっぱいの、途切れない直線。使わない所は消える）
  let quay = null;
  if (harbour) {
    const qTop = hTop + 3 + southRows;
    const qk = addPiece('h', 1, qTop, cols - 2, qTop + 1, STREET, 'quay');
    const qt = new Int16Array(cols).fill(qTop);
    quay = {
      top: qTop, bottom: qTop + 1, qt,
      water0: qTop + 2, water1: qTop + 1 + harbour.water,
      grps: qk >= 0 ? [pieces[qk].grp] : [],
    };
  }

  // ---- 地区を通りで切り分ける（BSP）
  const leaves = [], courts = [];
  // 縦の通り同士・横の通り同士が、境の通りをはさんでまっすぐ続いてしまう（十字路になる）か
  const alignedV = (x0, x1, y0, y1) => pieces.some((p) => p.dir === 'v' && p.kind !== 'side' && Math.abs(p.x0 - x0) <= 2 && Math.abs(p.x1 - x1) <= 2 &&
    (Math.abs(p.y1 - y0) <= 4 || Math.abs(y1 - p.y0) <= 4));
  const alignedH = (y0, y1, x0, x1) => pieces.some((p) => p.dir === 'h' && p.kind !== 'high' && p.kind !== 'quay' && Math.abs(p.y0 - y0) <= 1 &&
    (Math.abs(p.x1 - x0) <= 4 || Math.abs(x1 - p.x0) <= 4));
  // 街区を細かく縦割りしすぎず、同じ面の家並みを長く保つ。
  const wmaxOf = (R) => 26 + (hash32(`${seed}:${R.x0},${R.y0}`) % 11);
  // 斜めの通りに沿う地区: 行ごとに斜めの通りの手前まで（clipR / clipL）。子の地区にも引き継ぐ
  const sub = (R, x0, x1, y0, y1) => ({ x0, x1, y0, y1, clipR: R.clipR, clipL: R.clipL, diagR: R.diagR, diagL: R.diagL });
  // 斜めの通りのそばで切った東西の通りは、斜めの通りまでのばしてつなぐ
  const reachDiag = (R, st, xs0, xs1, code, kind) => {
    for (const [side, end, diag] of [[1, xs1, R.diagR], [-1, xs0, R.diagL]]) {
      if (!diag || (side > 0 ? xs1 >= R.rx1 : xs0 <= R.rx0)) continue;     // 地区の端が斜めの通りでなく切った通り
      for (let y = st.at(end); y < st.at(end) + st.sw; y++) {
        const dx = diag(y);
        if (side > 0 && dx - 1 > end) addPiece('h', end + 1, y, dx - 1, y, code, kind, st.grp);
        if (side < 0 && dx + 1 < end) addPiece('h', dx + 1, y, end - 1, y, code, kind, st.grp);
      }
    }
  };
  // 東西に切る通りの端: 斜めの通りに沿う地区では、その通りの行での斜めの通りの手前まで
  const crossSpan = (R, s, sw) => [R.clipL ? Math.max(R.rx0, R.clipL(s - 1, s + sw)) : R.x0, R.clipR ? Math.min(R.rx1, R.clipR(s - 1, s + sw)) : R.x1];

  const cutV = (R, type, closedTop) => {
    const w = R.x1 - R.x0 + 1, h = R.y1 - R.y0 + 1;
    const sw = h > 18 ? (chance(0.75) ? 2 : 1) : (chance(0.55) ? 2 : 1);
    const minW = 10;
    const cands = [];
    for (let x = R.x0 + minW; x + sw - 1 <= R.x1 - minW; x++) cands.push([Math.abs(x - (R.x0 + R.x1) / 2) + rng() * w * 0.35, x]);
    cands.sort((a, b) => a[0] - b[0]);
    for (let pass = 0; pass < 2; pass++) {
      for (const [, x] of cands) {
        if (hitsPin(x - 1, R.y0, x + sw, R.y1)) continue;
        if (pass === 0 && alignedV(x, x + sw - 1, R.y0, R.y1)) continue;
        // 南北の通りも、7〜12 マスごとに1列ずれる
        const st = meander('v', x, R.y0, R.y1, sw, sw === 2 ? STREET : DIRT, sw === 2 ? 'street' : 'alley', { ok: (y, v) => x + v >= R.x0 + minW - 1 && x + v + sw - 1 <= R.x1 - minW + 1 });
        // 斜めの通りに触れるのは片側の子だけ（もう片側は切った通りで止まる）
        bsp({ ...sub(R, R.x0, st.min - 1, R.y0, R.y1), clipR: undefined, diagR: undefined }, type, closedTop);
        bsp({ ...sub(R, st.max + sw, R.x1, R.y0, R.y1), clipL: undefined, diagL: undefined }, type, closedTop);
        return true;
      }
    }
    return false;
  };
  // 7〜8行の短い街区を大量に作ると、建物が別々の面へ散る。
  const DEPTHS = [15, 18, 21, 24, 27, 30, 33];
  // 北向きの地区（下の端が通り）: 下から街区をひとつ切り取り、残りを上へ。切る通りは上へだけずれる（下の街区の深さを保つ）
  const cutHN = (R, closedTop) => {
    const h = R.y1 - R.y0 + 1, w = R.x1 - R.x0 + 1;
    const sw = w > 26 ? 2 : (chance(0.75) ? 2 : 1);
    let opts = DEPTHS.map((d) => [d, rng()]).sort((a, b) => a[1] - b[1]).map(([d]) => d);
    // 役場・船着場のある街区は浅く（予約のせいで路地も中庭も入らず、上が空き地になるのを避ける）
    if (hitsPin(R.x0, R.y1 - 17, R.x1, R.y1)) opts = [...new Set(DEPTHS)].sort((a, b) => a - b);
    for (let pass = 0; pass < 2; pass++) {
      for (const d of opts) {
        const rem = h - d - sw - 1;
        if (rem < 7 || (closedTop && rem > 10 && rem < 15)) continue;
        const s = R.y1 - d - sw + 1;
        if (hitsPin(R.x0, s - 1, R.x1, s + sw)) continue;
        if (pass === 0 && alignedH(s, s + sw - 1, R.x0, R.x1)) continue;
        const [xs0, xs1] = crossSpan(R, s, sw), code = sw === 2 ? STREET : DIRT, kind = sw === 2 ? 'street' : 'lane';
        const st = meander('h', s, xs0, xs1, sw, code, kind, { lo: -1, hi: 0 });
        reachDiag(R, st, xs0, xs1, code, kind);
        bsp(sub(R, R.rx0, R.rx1, st.max + sw, R.y1), 'N', true);
        bsp(sub(R, R.rx0, R.rx1, R.y0, st.min - 1), 'N', closedTop);
        return true;
      }
    }
    return false;
  };
  // 南向きの地区（上の端が通り、下は開いている）: 上から街区をひとつ切り取り、その下に通り（下へだけずれる）
  const cutHS = (R) => {
    const h = R.y1 - R.y0 + 1, w = R.x1 - R.x0 + 1;
    const sw = w > 26 ? 2 : (chance(0.75) ? 2 : 1);
    const opts = DEPTHS.map((d) => [d, rng()]).sort((a, b) => a[1] - b[1]).map(([d]) => d);
    for (let pass = 0; pass < 2; pass++) {
      for (const d of opts) {
        if (d + sw + 1 > h) continue;
        const s = R.y0 + d;
        if (hitsPin(R.x0, s - 1, R.x1, s + sw + 1)) continue;
        if (pass === 0 && alignedH(s, s + sw - 1, R.x0, R.x1)) continue;
        const [xs0, xs1] = crossSpan(R, s, sw), code = sw === 2 ? STREET : DIRT, kind = sw === 2 ? 'street' : 'lane';
        const st = meander('h', s, xs0, xs1, sw, code, kind, { lo: 0, hi: 1 });
        reachDiag(R, st, xs0, xs1, code, kind);
        bsp(sub(R, R.rx0, R.rx1, R.y0, st.min - 1), 'N', true);
        if (R.y1 - (st.max + sw - 1) >= 9) bsp(sub(R, R.rx0, R.rx1, st.max + sw, R.y1), 'S', true);
        return true;
      }
    }
    return false;
  };
  function bsp(R0, type, closedTop) {
    const R = { ...R0, rx0: R0.x0, rx1: R0.x1 };
    if (R.clipR) R.x1 = Math.min(R.x1, R.clipR(R.y0, R.y1));
    if (R.clipL) R.x0 = Math.max(R.x0, R.clipL(R.y0, R.y1));
    const w = R.x1 - R.x0 + 1, h = R.y1 - R.y0 + 1;
    if (w < 5 || h < 4) return;
    const wmax = wmaxOf(R);
    if (type === 'S') {
      if (w > wmax && chance(0.5) && cutV(R, 'S', closedTop)) return;
      if (h >= 9) cutHS(R);
      return;
    }
    const tall = h > 12;
    if (w > wmax && (!tall || chance(0.6)) && cutV(R, type, closedTop)) return;
    if (tall && cutHN(R, closedTop)) return;
    if (w > wmax && cutV(R, type, closedTop)) return;
    leaf(R, closedTop, 0);
  }
  // 街区: 深ければ土の路地（ずれる・ときどき行き止まり）か中庭で2段に、広ければ一度折れる南北の小路で2つに
  function leaf(R, closedTop, lvl) {
    const w = R.x1 - R.x0 + 1, h = R.y1 - R.y0 + 1;
    if (lvl === 0 && w >= 24 && chance(0.35)) {
      for (let t = 0; t < 6; t++) {
        const x = R.x0 + ri(9, w - 10);
        const dj = h >= 10 && chance(0.6) ? (rng() < 0.5 ? -1 : 1) * ri(2, 3) : 0, j = R.y0 + ri(3, Math.max(3, h - 4));
        const xa = Math.min(x, x + dj), xb = Math.max(x, x + dj);
        if (xa < R.x0 + 7 || xb > R.x1 - 7 || hitsPin(xa - 1, R.y0, xb + 1, R.y1) || alignedV(x, x, R.y0, R.y1)) continue;
        let l1 = xa - 1, r0 = xb + 1;
        if (!dj) {
          // 1列ずつ揺れる小路
          const st = meander('v', x, R.y0, R.y1, 1, DIRT, 'alley', { ok: (y, v) => x + v > R.x0 + 6 && x + v < R.x1 - 6 });
          l1 = st.min - 1; r0 = st.max + 1;
        } else {
          // 一度折れる小路（折れた角の内側は小さな裏庭になる）
          const grp = grpN++;
          addPiece('v', x, R.y0, x, j, DIRT, 'alley', grp);
          addPiece('h', xa, j, xb, j, DIRT, 'alley', grp);
          addPiece('v', x + dj, j, x + dj, R.y1, DIRT, 'alley', grp);
        }
        leaf(sub(R, R.x0, l1, R.y0, R.y1), closedTop, 1);
        leaf(sub(R, r0, R.x1, R.y0, R.y1), closedTop, 1);
        return;
      }
    }
    if (h >= 16 && w >= 14 && chance(courts.length ? 0.4 : 0.9)) {
      // 中庭: 街区の中ほどの小さな舗装の庭に、下の通りから小路が入る。奥の家は中庭に扉を向ける
      for (let t = 0; t < 6; t++) {
        const cw = ri(6, 8), c0 = R.x0 + ri(2, Math.max(2, w - cw - 2)), c1 = c0 + cw - 1, m = R.y0 + ri(8, h - 8), ax = c0 + ri(1, cw - 2);
        if (c1 > R.x1 - 2 || hitsPin(c0 - 1, m - 2, c1 + 1, R.y1)) continue;
        const grp = grpN++;
        const k = addPiece('h', c0, m - 1, c1, m, STREET, 'court', grp);
        addPiece('v', ax, m + 1, ax, R.y1, DIRT, 'alley', grp);
        if (k >= 0) courts.push(pieces[k]);
        leaves.push({ x0: R.x0, x1: R.x1, y0: R.y0, y1: m - 2, closedTop });
        leaves.push({ x0: R.x0, x1: ax - 1, y0: m + 1, y1: R.y1, closedTop: true });
        leaves.push({ x0: ax + 1, x1: R.x1, y0: m + 1, y1: R.y1, closedTop: true });
        return;
      }
    }
    if (h >= 15 && w >= 12) {
      // 深い街区: 土の路地（下へだけ1行ずつ揺れる。上の家並みの深さを保つ）。ときどき通りのある側から入る行き止まり
      for (let t = 0; t < 6; t++) {
        const du = ri(7, h - 8), m = R.y0 + du;
        if (hitsPin(R.x0, m - 2, R.x1, m + 3)) continue;
        if (chance(0.45)) {
          const lr = isRoad(R.x0 - 1, m), rr = isRoad(R.x1 + 1, m);
          const fromLeft = lr && rr ? rng() < 0.5 : lr;
          const L = Math.round(w * (0.5 + rng() * 0.3));
          if (L < 10 || (!lr && !rr)) continue;
          const a = fromLeft ? R.x0 : R.x1 - L + 1, b = fromLeft ? R.x0 + L - 1 : R.x1;
          meander('h', m, fromLeft ? a : b, fromLeft ? b : a, 1, DIRT, 'lane', { lo: 0, hi: 1 });
          leaves.push({ x0: a, x1: b, y0: R.y0, y1: m - 1, closedTop });
        } else {
          meander('h', m, R.x0, R.x1, 1, DIRT, 'lane', { lo: 0, hi: 1 });
          leaves.push({ x0: R.x0, x1: R.x1, y0: R.y0, y1: m - 1, closedTop });
        }
        leaves.push({ x0: R.x0, x1: R.x1, y0: m + 2, y1: R.y1, closedTop: true });
        return;
      }
    }
    leaves.push({ x0: R.x0, x1: R.x1, y0: R.y0, y1: R.y1, closedTop });
  }

  // 広場の両わきの街区（大通りに面する）
  const flankW = { x0: kx0, x1: px0 - 1, y0: py0 + 2, y1: hMinTop(kx0, px0 - 1) - 1, closedTop: true, flank: -1 };
  const flankE = { x0: px1 + 1, x1: kx1, y0: py0 + 2, y1: hMinTop(px1 + 1, kx1) - 1, closedTop: true, flank: 1 };
  leaves.push(flankW, flankE);
  // 北: 西の地区・広場の北（北へ向かう通りの両側）・東の地区
  bsp({ x0: 1, x1: VW.min - 1, y0: 1, y1: hMinTop(1, VW.min - 1) - 1 }, 'N', false);
  bsp({ x0: kx0, x1: AN.min - 1, y0: 1, y1: py0 - 1 }, 'N', false);
  bsp({ x0: AN.max + 2, x1: kx1, y0: 1, y1: py0 - 1 }, 'N', false);
  bsp({ x0: VE.max + 2, x1: cols - 2, y0: 1, y1: hMinTop(VE.max + 2, cols - 2) - 1 }, 'N', false);
  // 南: 斜めの通りの両側。地区は行ごとに斜めの通りの手前まで
  const ys0 = Htop[aS], clipY = (y) => clamp(y, ys0, southEnd);
  const SWr = { x0: 1, x1: cols - 2, clipR: (a, b) => { let m = 1e9; for (let y = a; y <= b; y++) m = Math.min(m, AS.at(clipY(y)) - 1); return m; }, diagR: (y) => AS.at(clipY(y)) };
  const SEr = { x0: 1, x1: cols - 2, clipL: (a, b) => { let m = -1e9; for (let y = a; y <= b; y++) m = Math.max(m, AS.at(clipY(y)) + 2); return m; }, diagL: (y) => AS.at(clipY(y)) + 1 };
  if (harbour) {
    bsp({ ...SWr, y0: hMaxBot(1, AS.min - 1) + 1, y1: quay.top - 1 }, 'N', true);
    bsp({ ...SEr, y0: hMaxBot(AS.max + 2, cols - 2) + 1, y1: quay.top - 1 }, 'N', true);
  } else {
    bsp({ ...SWr, y0: hMaxBot(1, AS.min - 1) + 1, y1: rows - 2 }, 'S', true);
    bsp({ ...SEr, y0: hMaxBot(AS.max + 2, cols - 2) + 1, y1: rows - 2 }, 'S', true);
  }

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

  // ---- 建物を置く面（街区の下の端）
  const foot = new Int32Array(N).fill(-1), roofZ = new Uint8Array(N), front = new Uint8Array(N);
  const walkRoad = (x, y) => isRoad(x, y) || (inG(x, y) && plazaM[id(x, y)]);
  const tracks = [];
  for (const L of leaves) {
    if (L.green) continue;
    const sd = new Int16Array(L.x1 - L.x0 + 1).fill(-1);
    let any = false;
    // 列ごとに、街区の中（小さな広場）か下の端の先にある最初の通り
    for (let x = L.x0; x <= L.x1; x++) {
      for (let y = Math.min(L.y1 + 1, L.y0 + 6); y <= L.y1 + 4; y++) {
        if (!inG(x, y)) break;
        if (walkRoad(x, y)) { sd[x - L.x0] = y; any = true; break; }
      }
    }
    if (!any) continue;
    const dir = L.flank ? L.flank : (L.x0 + L.x1) / 2 < cx ? -1 : 1;
    // 並びのはじめを 0〜2 マスずらす（上下に重なる街区で家と路地が同じ列にそろわないように）
    const off = L.flank ? 0 : hash32(`start:${seed}:${L.x0},${L.y0}`) % 2;
    tracks.push({ L, sd, dir, x0: L.x0, x1: L.x1, cursor: dir < 0 ? L.x1 - off : L.x0 + off, items: [], high: false });
  }
  for (const t of tracks) {
    // H に面しているか（宿屋の場所）: 面のどこかの下が大通り
    t.high = false;
    for (let x = t.x0; x <= t.x1; x++) { const y = t.sd[x - t.x0]; if (y >= 0 && road[id(x, y)] >= 0 && pieces[road[id(x, y)]].kind === 'high') { t.high = true; break; } }
  }
  const green = new Uint8Array(N);
  for (const L of leaves) if (L.green) for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) green[id(x, y)] = 1;

  // 広場の北側に、建物を続けて置くための長い frontage を用意する。
  // BSP の小さな面を順に選ぶだけでは建物が街全体へ散るため、役場の上側に
  // 数本の決まった通りを引き、通常の面選択より先にこの列を埋める。
  const denseTracks = [];
  if (hall) {
    const denseX0 = Math.min(3, cols - 2), denseX1 = Math.max(denseX0, cols - 4);
    const denseWidth = denseX1 - denseX0 + 1;
    const rowCount = Math.max(2, Math.ceil((need + 5) / Math.max(12, denseWidth - 10)));
    const rowStep = Math.max(8, maxH + 3);
    const addDenseRow = (yb, flags = {}) => {
      const streetY = yb + 1;
      if (streetY < 2 || yb - maxH - 5 < 1 || streetY > rows - 2) return false;
      addPiece('h', denseX0, streetY, denseX1, streetY, STREET, 'dense');
      const L = { x0: denseX0, x1: denseX1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: false, dense: true };
      const sd = new Int16Array(L.x1 - L.x0 + 1).fill(streetY);
      denseTracks.push({ L, sd, dir: 1, x0: L.x0, x1: L.x1, cursor: L.x0, items: [], high: false, dense: true, ...flags });
      return true;
    };
    let made = 0;
    // 船着場がある街では、その手前の建物列も先に一列埋める。
    // 水辺だけが遠くに孤立して、占有領域を広げるのを防ぐ。
    if (dockAt && addDenseRow(dockAt.y - rowStep)) made++;
    for (let i = 0; i < rowCount && made < rowCount; i++) {
      if (addDenseRow(hall.yb - rowStep - i * rowStep)) made++;
    }
    // 北側が上端に届いた小さな街では、広場の南側にも同じ面を続ける。
    // 役場の左右を崩さず、残りの建物だけを別の長い通りへ受け渡す。
    for (let i = 0; made < rowCount && i < rowCount; i++) {
      if (addDenseRow(plaza.y1 + rowStep + i * rowStep)) made++;
    }
  } else {
    // 役場のない街も広場の北辺から建物を続けて置く。
    // 通常のBSP面だけに任せると、修理小屋・見張り台を外縁へ置いたあと
    // 広場の四辺が草地になり、小さな街でも空いた街区が長く残る。
    const yb = plaza.y0 - 1, streetY = plaza.y0;
    const x0 = Math.max(1, kx0), x1 = Math.min(cols - 2, kx1);
    if (x1 >= x0 && yb - maxH - 5 >= 1) {
      const L = { x0, x1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: true, dense: true, plaza: true };
      const sd = new Int16Array(x1 - x0 + 1).fill(streetY);
      denseTracks.push({ L, sd, dir: 1, x0, x1, cursor: x0, items: [], high: false, dense: true, plaza: true });
    }
    const addCompactRow = (rowYb, flags = {}) => {
      const rowStreet = rowYb + 1;
      if (rowStreet < 2 || rowYb - maxH - 2 < 0 || rowStreet > rows - 2) return false;
      addPiece('h', x0, rowStreet, x1, rowStreet, STREET, 'dense');
      const L = { x0, x1, y0: Math.max(1, rowYb - maxH - 8), y1: rowYb, closedTop: false, dense: true };
      const sd = new Int16Array(x1 - x0 + 1).fill(rowStreet);
      denseTracks.push({ L, sd, dir: 1, x0, x1, cursor: x0, items: [], high: false, dense: true, ...flags });
      return true;
    };
    const rowStep = Math.max(6, maxH + 1);
    const rowCount = Math.max(1, Math.ceil((need + 5) / Math.max(12, x1 - x0 + 1 - 10)));
    for (let i = 0; i < rowCount; i++) addCompactRow(plaza.y0 - 1 - rowStep * (i + 1), i === 0 ? { compactOuter: true } : {});
    addCompactRow(plaza.y1 + rowStep, { compactOuter: true });
  }
  // 港では、船着場と同じ岸の通りに向く一列を最優先で埋める。
  // BSPの面を先に選ぶと南の街区が森の前へ散るため、岸の両端から
  // 建物を続けて置き、船着場の左右も同じ frontage に渡す。
  if (harbour && quay) {
    const x0 = 1, x1 = cols - 2, yb = quay.top - 1, streetY = quay.top;
    const L = { x0, x1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: false, dense: true, harbour: true };
    const sd = new Int16Array(x1 - x0 + 1).fill(streetY);
    denseTracks.unshift({
      L, sd, dir: 1, x0, x1, cursor: x0, items: [], high: false, dense: true, harbour: true,
    });
  }
  // 広場の東西にも短い dense track を置く。南向きの扉は広場の外側へ向けたまま、
  // footprint の側面が広場に接するので、広場を挟んだ上下の列だけで街を広げない。
  if (!harbour) {
    const sideTracks = [];
    const addPlazaSide = (side, offset = 0) => {
      let sx0 = side < 0 ? 1 : Math.min(cols - 2, px1 + 1);
      let sx1 = side < 0 ? Math.min(cols - 2, px0 - 1) : cols - 2;
      // 宿屋を compact frontage に置く街では、入口側の7マスを先に空ける。
      // 通常の家並みがその予約を埋めないので、宿屋を広場の直近へ置ける。
      if (offset === 0 && fac.inn && side === fac.innSide) {
        if (side < 0) sx1 -= fac.inn.w;
        else sx0 += fac.inn.w;
      }
      if (sx1 - sx0 + 1 < 5) return;
      const yb = plaza.y1 + offset, streetY = yb + 1;
      const L = { x0: sx0, x1: sx1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: false, dense: true, plazaSide: side };
      const sd = new Int16Array(sx1 - sx0 + 1).fill(streetY);
      sideTracks.push({ L, sd, dir: side < 0 ? -1 : 1, x0: sx0, x1: sx1,
        cursor: side < 0 ? sx1 : sx0, items: [], high: false, dense: true, plazaSide: side });
    };
    addPlazaSide(-1);
    addPlazaSide(1);
    addPlazaSide(-1, 5);
    addPlazaSide(1, 5);
    if (fac.inn) {
      const side = fac.innSide, sx0 = side < 0 ? 1 : Math.min(cols - 2, px1 + 1), sx1 = side < 0 ? Math.min(cols - 2, px0 - 1) : cols - 2;
      if (sx1 - sx0 + 1 >= fac.inn.w) {
        const yb = plaza.y1, streetY = yb + 1;
        const L = { x0: sx0, x1: sx1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: false, dense: true, plazaSide: side };
        const sd = new Int16Array(sx1 - sx0 + 1).fill(streetY);
        sideTracks.unshift({ L, sd, dir: side < 0 ? -1 : 1, x0: sx0, x1: sx1,
          cursor: side < 0 ? sx1 : sx0, items: [], high: false, dense: true, plazaSide: side, innOnly: true });
      }
    }
    denseTracks.splice(Math.min(1, denseTracks.length), 0, ...sideTracks);
  }
  tracks.unshift(...denseTracks);

  const canalReserve = new Set((C.canalReserve || []).map(([x, y]) => `${x},${y}`));
  const reservedForCanal = (x, y) => canalReserve.has(`${x},${y}`);

  // footprint のすぐ下の行（と、通りまでの前庭）が通りにつながる位置か。
  // roofRows は外観の版の cover の最大値で、屋根が上の通り・建物を隠す余白だけを予約する。
  const fit = (t, x0, w, h, setback, roofRows = 2, allowRoad = false) => {
    if (x0 < t.x0 || x0 + w - 1 > t.x1) return null;
    let smin = 1e9;
    for (let x = x0; x < x0 + w; x++) { const s = t.sd[x - t.x0]; if (s < 0) return null; smin = Math.min(smin, s); }
    const yb = smin - 1 - setback, y = yb - h + 1;
    if (y < t.L.y0 + (t.L.closedTop ? 2 : 0) || y - roofRows < 1) return null;
    for (let x = x0; x < x0 + w; x++) {
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
  let pinOwner = null;
  const hitsPinOther = (x0, y0, x1, y1) => pinned.some((p, i) => i !== pinOwner && x0 <= p[2] && x1 >= p[0] && y0 <= p[3] && y1 >= p[1]);
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
  // 3マス以上は作らない。
  const nextGap = () => { const r = rng(); return r < 0.5 ? 0 : r < 0.9 ? 1 : 2; };
  const advance = (t, pos) => {
    const gap = nextGap();
    t.cursor = t.dir < 0 ? pos.x - gap - 1 : pos.x + pos.w + gap;
    if (t.dir < 0 ? t.cursor < t.x0 : t.cursor > t.x1) t.closed = true;
  };
  const seek = (t, s, span = WINDOW, allowRoad = false) => {
    for (let k = 0; k <= span; k++) {
      const x0 = t.dir < 0 ? t.cursor - k - s.w + 1 : t.cursor + k;
      if (t.dir < 0 ? x0 < t.x0 : x0 + s.w - 1 > t.x1) return null;
      const pos = fit(t, x0, s.w, s.h, 0, s.roofRows, allowRoad || !!t.dense);
      if (pos) return pos;
    }
    return null;
  };
  const trackAt = (x, y) => tracks
    .filter((t) => x >= t.x0 && x <= t.x1 && y >= t.L.y0 && y <= t.L.y1)
    .sort((a, b) => Math.abs(a.L.y1 - y) - Math.abs(b.L.y1 - y) || Number(!!b.dense) - Number(!!a.dense))[0];

  // 役場・酒場・船着場は先に置く
  const pending = { early: [...fac.early], late: [...fac.late], inn: fac.inn };
  if (hall) {
    const t = trackAt(hall.x, hall.yb);
    pinOwner = 0;
    const pos = t && fit(t, hall.x, hall.w, hall.h, 0, fac.hall.roofRows);
    pinOwner = null;
    if (pos) commit(fac.hall, t, pos, '\u0000hall');
    else pending.late.unshift({ ...fac.hall, angle: -Math.PI / 2 });
  }
  if (fac.pub) {
    const t = tracks.find((c) => c.L === (fac.pubSide < 0 ? flankW : flankE));
    const x0 = fac.pubSide < 0 ? px0 - fac.pub.w : px1 + 1;
    const pos = t && fit(t, x0, fac.pub.w, fac.pub.h, 0, fac.pub.roofRows);
    if (pos) { commit(fac.pub, t, pos, '\u0000pub'); advance(t, pos); }
    else pending.early.push({ ...fac.pub, angle: fac.pubSide < 0 ? Math.PI : 0 });
  }
  if (dockAt) {
    const t = trackAt(dockAt.x, dockAt.yb);
    pinOwner = pinned.length - 1;
    const pos = t && fit(t, dockAt.x, dockAt.w, dockAt.h, 0, fac.dock.roofRows);
    pinOwner = null;
    if (pos) commit(fac.dock, t, pos, '\u0000dock');
    else if (scale < 2.5) return null;               // 岸に船着場が入らない → 少し大きな格子でやり直す
  }
  // 広場の脇の通り: 酒場の反対側は、広場から外へ
  const queues = groups.map((g) => ({ g, items: [...g.items], ruins: [...g.ruins] }));
  // 役場の左右は、広場の北辺を空けないために先に同じ面へ置く。
  // 通常の面選択へ戻す前に、住宅を優先して左右1棟ずつ確保する。
  if (hall) {
    const hp = placed.find((p) => p.spec.archetype === 'town_hall');
    if (!hp) {
      // 役場がこの格子に入らなかった試行では、通常の pending 処理へ戻す。
      // scale を上げた再試行を壊さないため、ここで隣家を先取りしない。
    } else {
      const terrace = terraces.find((t) => t.hall);
      const row = {
        L: { x0: kx0, x1: kx1, y0: Math.max(1, hall.y - 4), y1: hall.yb, closedTop: true },
        x0: kx0, x1: kx1, dir: -1, cursor: hall.x, items: [], sd: new Int16Array(kx1 - kx0 + 1).fill(hall.yb + 1),
        high: false, closed: true,
      };
      const takeHallNeighbor = (side) => {
        const refs = [];
        for (let qi = 0; qi < queues.length; qi++) for (let si = 0; si < queues[qi].items.length; si++) {
          const s = queues[qi].items[si];
          refs.push({ qi, si, s, house: s.module?.kind === 'house' ? 0 : 1 });
        }
        refs.sort((a, b) => a.house - b.house || a.qi - b.qi || a.si - b.si);
        for (const ref of refs) {
          for (const gap of [0, 1]) {
            const x0 = side < 0 ? hp.x - gap - ref.s.w : hp.x + hp.w + gap;
            // 北の通りが役場の脇を通る場合でも、建物の footprint でその区間を覆える。
            const pos = fit(row, x0, ref.s.w, ref.s.h, 0, ref.s.roofRows, true);
            if (!pos) continue;
            queues[ref.qi].items.splice(ref.si, 1);
            commit(ref.s, row, pos, '\u0000hall-row');
            if (terrace) {
              const x1 = pos.x + pos.w - 1;
              const left = Math.min(terrace.x, pos.x), right = Math.max(terrace.x + terrace.w - 1, x1);
              terrace.x = left; terrace.w = right - left + 1;
            }
            return true;
          }
        }
        return false;
      };
      takeHallNeighbor(-1);
      takeHallNeighbor(1);
    }
  }
  // 港の船着場も、左右の水際 frontage を先に建物でつなぐ。
  // 通常のカーソルは船着場の予約へ進んだあと戻らないため、
  // 先取りしないと片側に2〜3マスの空きが残る。
  if (harbour && dockAt) {
    const dockPlaced = placed.find((p) => p.spec.archetype === 'dock');
    const dockTrack = dockPlaced?.track;
    const takeHarbourNeighbor = (side) => {
      if (!dockPlaced || !dockTrack) return false;
      const refs = [];
      for (let qi = 0; qi < queues.length; qi++) for (let si = 0; si < queues[qi].items.length; si++) {
        const s = queues[qi].items[si];
        refs.push({ qi, si, s, house: s.module?.kind === 'house' ? 0 : 1 });
      }
      refs.sort((a, b) => a.house - b.house || a.qi - b.qi || a.si - b.si);
      for (const ref of refs) {
        for (const gap of side < 0 ? [1, 0] : [0, 1]) {
          const x0 = side < 0 ? dockPlaced.x - gap - ref.s.w : dockPlaced.x + dockPlaced.w + gap;
          pinOwner = pinned.length - 1;
          const pos = fit(dockTrack, x0, ref.s.w, ref.s.h, 0, ref.s.roofRows, true);
          pinOwner = null;
          if (!pos) continue;
          queues[ref.qi].items.splice(ref.si, 1);
          commit(ref.s, dockTrack, pos, '\u0000harbour-row');
          return true;
        }
      }
      return false;
    };
    takeHarbourNeighbor(-1);
    takeHarbourNeighbor(1);
  }
  let activeTrack = null;
  for (let guard = 0; guard < 20000; guard++) {
    const items = queues.some((q) => q.items.length);
    if (!items && pending.early.length) { pending.late.unshift(...pending.early); pending.early = []; }
    const phase = items ? 'items' : pending.late.length ? 'late' : pending.inn ? 'inn' : queues.some((q) => q.ruins.length) ? 'ruins' : null;
    if (!phase) break;

    if (phase === 'late') {
      // 外縁へ: 目当ての角度に近く、いま外周にある面を選ぶ
      const s = pending.late[0];
      if (s.archetype === 'watchtower') {
        const compact = tracks.filter((c) => c.compactOuter && !c.closed)
          .sort((a, b) => nominal(a).r - nominal(b).r || a.y - b.y);
        let compactDone = false;
        for (const c of compact) {
          const pos = seek(c, s, 60);
          if (!pos) continue;
          commit(s, c, pos, `\u0000${s.archetype}`);
          advance(c, pos);
          pending.late.shift();
          compactDone = true;
          break;
        }
        if (compactDone) continue;
      }
      let t = null, best = Infinity;
      for (const c of tracks) {
        if (c.closed) continue;
        const n = nominal(c);
        const score = n.r + 30 * arc(n.theta, s.angle);
        if (score < best) { best = score; t = c; }
      }
      if (!t) return null;
      const pos = seek(t, s);
      if (pos) { commit(s, t, pos, `\u0000${s.archetype}`); advance(t, pos); pending.late.shift(); continue; }
      t.cursor += t.dir * WINDOW;
      if (t.dir < 0 ? t.cursor < t.x0 : t.cursor > t.x1) t.closed = true;
      continue;
    }
    if (phase === 'inn') {
      // 宿屋: 大通り H を外から入ってきた所（いま街の端になっている所）。そのあと H のその側は閉じる
      const s = pending.inn;
      pending.inn = null;
      let done = false;
      const compactFirst = tracks.filter((c) => c.innOnly)
        .sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - cx) - Math.abs((b.x0 + b.x1) / 2 - cx));
      for (const c of compactFirst) {
        const save = c.cursor, dir = c.dir;
        c.cursor = c.dir < 0 ? c.x1 : c.x0;
        const pos = seek(c, s, 60, true);
        c.dir = dir;
        if (pos) { commit(s, c, pos, `\u0000${s.archetype}`); done = true; break; }
        c.cursor = save;
      }
      for (const side of [fac.innSide, -fac.innSide]) {
        if (done) break;
        const hs = tracks.filter((c) => c.high && (side < 0 ? c.x1 < cx : c.x0 > cx)).sort((a, b) => side * (a.x0 - b.x0));
        let outer = null;
        for (const c of hs) for (const p of c.items) if (!outer || side * (p.x - outer.x) > 0) outer = p;
        let from = outer ? (side < 0 ? outer.x - 2 : outer.x + outer.w + 1) : (side < 0 ? px0 - 1 : px1 + 1);
        for (const c of hs) {
          if (side < 0 ? c.x0 > from : c.x1 < from) continue;
          const save = c.cursor, dir = c.dir;
          c.cursor = side < 0 ? Math.min(c.x1, from) : Math.max(c.x0, from); c.dir = side;
          const pos = seek(c, s, 60, true);
          c.dir = dir;
          if (pos) { commit(s, c, pos, `\u0000${s.archetype}`); done = true; break; }
          c.cursor = save;
        }
        if (done) {
          for (const c of hs) c.closed = true;
          break;
        }
      }
      if (!done) {
        // 小さな格子で大通りの外端が遠くなったときは、広場に直結する側面の
        // compact frontage を入口の宿場として使う。宿屋を外縁へ送って街全体を
        // 縦に引き延ばさず、広場から大通りへ歩ける位置を優先する。
      const compact = tracks.filter((c) => c.innOnly)
          .sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - cx) - Math.abs((b.x0 + b.x1) / 2 - cx));
        for (const c of compact) {
          const save = c.cursor, dir = c.dir;
          c.cursor = c.dir < 0 ? c.x1 : c.x0;
          const pos = seek(c, s, 60, true);
          c.dir = dir;
          if (pos) { commit(s, c, pos, `\u0000${s.archetype}`); done = true; break; }
          c.cursor = save;
        }
      }
      if (!done && scale < 2.5) return null;          // 大通りの端に入らない → 少し大きな格子でやり直す
      if (!done) pending.late.push({ ...s, angle: fac.innSide < 0 ? Math.PI : 0 });
      continue;
    }

    let t = activeTrack, tn = t ? nominal(t) : null;
    if (!t || t.closed) {
      t = null; tn = null;
      const dense = denseTracks.find((c) => !c.closed && !c.innOnly);
      if (dense) {
        t = dense;
        tn = nominal(t);
      }
      for (const c of tracks) {
        if (t) break;
        if (c.innOnly) continue;
        if (c.closed) continue;
        const n = nominal(c);
        const score = 12 * Math.min(6, trackAffinity(c)) + n.r;
        if (!t || score < t.score - 1e-9) { t = c; tn = n; t.score = score; }
      }
    }
    if (!t) return null;                               // 入りきらない → 大きな格子でやり直す
    // 地区に置く施設（道場・倉庫など）: 目当ての角度の面が来たら、まずそれを置く
    if (phase === 'items' && pending.early.length) {
      const e = t.dense ? pending.early[0] : tn.r >= 20 ? pending.early.find((s) => arc(tn.theta, s.angle) < 0.45) : null;
      const pos = e && seek(t, e);
      if (pos) { commit(e, t, pos, `\u0000${e.archetype}`); advance(t, pos); pending.early.splice(pending.early.indexOf(e), 1); continue; }
    }
    const cands = queues.filter((q) => q[phase].length)
      .map((q) => ({ q, d: arcDistance(tn.theta, q.g) }))
      .sort((a, b) => a.d - b.d || a.q.g.index - b.q.g.index);
    let done = false;
    for (const { q } of cands) {
      // この地区の建物のうち、カーソルにいちばん近く置けるもの（隙間を残さない）。同じ近さなら並び順の先
      const tried = new Set();
      let best = null;
      const last = t.last;
      for (let i = 0; i < q[phase].length; i++) {
        const s = q[phase][i];
        if (tried.has(s.w * 64 + s.h)) continue;
        tried.add(s.w * 64 + s.h);
        // 建物を上の通り側へ寄せる: 前に1〜2行の舗装を残し、0行は少なくする。
        // 直前の建物とは下がり方を変える。
        const sr = rng();
        let setback = sr < 0.55 ? 2 : sr < 0.9 ? 1 : 0;
        if (last && setback === last.sb) setback = last.sb === 2 ? 1 : 2;
        for (let k = 0; k <= WINDOW && (!best || k <= best.k); k++) {
          const x0 = t.dir < 0 ? t.cursor - k - s.w + 1 : t.cursor + k;
          if (t.dir < 0 ? x0 < t.x0 : x0 + s.w - 1 > t.x1) break;
          let pos = null;
          for (let sb = setback; sb >= 0 && !pos; sb--) pos = fit(t, x0, s.w, s.h, sb, s.roofRows, !!t.dense);
          if (!pos) continue;
          // 同じ近さなら、直前の家と幅か下がり方が違うほう
          const same = last && last.w === s.w && last.yb === pos.yb;
          if (!best || k < best.k || (k === best.k && best.same && !same)) best = { i, s, pos, k, same };
          break;
        }
        if (best && best.k === 0 && !best.same) break;
      }
      if (!best) continue;
      q[phase].splice(best.i, 1);
      commit(best.s, t, best.pos, q.g.key);
      t.last = { sb: Math.min(...t.sd.slice(best.pos.x - t.x0, best.pos.x - t.x0 + best.pos.w)) - 1 - best.pos.yb, w: best.s.w, yb: best.pos.yb };
      advance(t, best.pos);
      activeTrack = t;
      done = true;
      break;
    }
    if (!done) {
      t.cursor += t.dir * WINDOW;
      if (t.dir < 0 ? t.cursor < t.x0 : t.cursor > t.x1) {
        t.closed = true;
        if (activeTrack === t) activeTrack = null;
      }
    }
  }
  if (queues.some((q) => q.items.length || q.ruins.length) || pending.late.length || pending.early.length) return null;
  return { cols, rows, N, id, inG, cx, aN, aS, aSdir: dirS, Htop, road, pieces, plazaM, plaza, hall, quay, leaves, tracks, placed, foot, roofZ, front, green, pcx, pcy, kx0, kx1, U, squares: [...squares, ...courts], terraces };
}

// ---------- 地面を塗る: 使った所だけ通りを残し、切り出し、外を「街の外」にする ----------
function finalize(P, maxH, opt = {}) {
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

// ---------- 井戸から流れる水路（橋の絵が両向きそろったときだけ） ----------
 function buildCanal(P, F, repo, propArt, opt = {}) {
  const well = (repo.facilities || []).find((f) => f.archetype === 'well' && f.facts);
  const cannotPlace = (reason) => ({
    unplaced: { archetype: 'canal', name: '水路', reason },
  });
  if (!well) return null;
  if (!propArt['bridge-h']?.deck || !propArt['bridge-v']?.deck) {
    return cannotPlace('橋を両方向に歩ける絵・deck がそろっていない');
  }
  const { cols, rows, N, id, plaza, plazaM, foot, roofZ, front, road, pieces, placed, quay, terraces } = P;
  const { g, crop } = F;
  const original = g.slice();
  const inG = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const inC = (x, y) => x >= crop.x0 && y >= crop.y0 && x <= crop.x1 && y <= crop.y1;
  const terraceMask = new Uint8Array(N);
  for (const t of terraces || []) {
    for (let y = t.y; y <= t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) if (inG(x, y)) terraceMask[id(x, y)] = 1;
  }
  const doorFront = new Uint8Array(N);
  const buildingWalkRow = new Uint8Array(N);
  const fixedFoot = new Uint8Array(N), fixedRoof = new Uint8Array(N), fixedFront = new Uint8Array(N), fixedDoorFront = new Uint8Array(N);
  for (const p of placed) {
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    for (let x = p.x; x < p.x + p.w; x++) if (inG(x, p.yb + 1)) buildingWalkRow[id(x, p.yb + 1)] = 1;
    for (let x = p.x; x < p.x + p.w; x++) {
      for (let y = p.y; y <= p.yb; y++) if (inG(x, y) && p.spec.facility) fixedFoot[id(x, y)] = 1;
      for (let y = p.y - (p.spec.roofRows ?? 2); y < p.y; y++) if (inG(x, y) && p.spec.facility) fixedRoof[id(x, y)] = 1;
      for (let y = p.yb + 1; y < (p.track?.sd?.[x - p.track.x0] ?? p.yb + 1); y++) if (inG(x, y) && p.spec.facility) fixedFront[id(x, y)] = 1;
    }
    for (let y = p.yb + 1; y <= p.yb + 2; y++) if (inG(dc, y)) {
      doorFront[id(dc, y)] = 1;
      if (p.spec.facility) fixedDoorFront[id(dc, y)] = 1;
    }
  }
  const inPlaza = (x, y) => x >= plaza.x0 && x <= plaza.x1 && y >= plaza.y0 && y <= plaza.y1;
  const paved = (k) => original[k] === STREET || original[k] === DIRT;
  const roadDirAt = (x, y) => {
    if (!inG(x, y)) return null;
    const k = id(x, y), r = road[k];
    if (!paved(k)) return null;
    if (r >= 0 && pieces[r]) return pieces[r].dir;
    let h = 0, v = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0]]) {
      const q = id(x + dx, y);
      if (inG(x + dx, y) && paved(q)) {
        const rr = road[q];
        if (rr >= 0 && pieces[rr]?.dir === 'h') h++;
        else h += 0.5;
      }
    }
    for (const [dx, dy] of [[0, -1], [0, 1]]) {
      const q = id(x, y + dy);
      if (inG(x, y + dy) && paved(q)) {
        const rr = road[q];
        if (rr >= 0 && pieces[rr]?.dir === 'v') v++;
        else v += 0.5;
      }
    }
    return h > v && h > 0 ? 'h' : v > h && v > 0 ? 'v' : null;
  };
  // 水路は通りを横切るときだけ舗装地に入り、通りに沿って流れたり、
  // 通りのすぐ脇を長く流れたりしない。roadTurn は交差点・曲がり角の核。
  const roadTurn = new Uint8Array(N);
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    if (!paved(id(x, y))) continue;
    const rd = roadDirAt(x, y);
    if (!rd) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inG(nx, ny) || !paved(id(nx, ny))) continue;
      const nd = roadDirAt(nx, ny);
      if (nd && nd !== rd) {
        roadTurn[id(x, y)] = 1;
        roadTurn[id(nx, ny)] = 1;
      }
    }
  }
  const nearRoadTurn = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 2 || !inG(x + dx, y + dy)) continue;
      if (roadTurn[id(x + dx, y + dy)]) return true;
    }
    return false;
  };
  const laneCells = (x, y, d) => d % 2 ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]];
  const laneTouchesRoadSide = (x, y, d) => {
    const cells = laneCells(x, y, d);
    const own = new Set(cells.map(([cx, cy]) => `${cx},${cy}`));
    return cells.some(([cx, cy]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      return inG(nx, ny) && !own.has(`${nx},${ny}`) && paved(id(nx, ny));
    }));
  };
  const axis = (d) => d % 2 ? 'v' : 'h';
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const sinkWater = (x, y) => !!(quay && original[id(x, y)] === WATER && y >= quay.water0);
  // 港の水は終点の幅2マスだけに入れる。途中の経路が港の水を
  // 横切って別の終点へ抜けると、岸に沿う水路や細い陸の帯を作れる。
  const parallelToWater = (cells, flow) => {
    // 終点そのもの（幅2マスの港の水）は、港へ注ぐために許す。
    if (cells.length && cells.every(([x, y]) => sinkWater(x, y))) return false;
    const normal = flow === 'h' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    for (const [x, y] of cells) {
      for (const [dx, dy] of normal) {
        for (let n = 1; n <= 3; n++) {
          const nx = x + dx * n, ny = y + dy * n;
          if (inG(nx, ny) && sinkWater(nx, ny)) return true;
        }
      }
    }
    return false;
  };
  const parallelToMapEdge = (cells, flow) => cells.some(([x, y]) =>
    flow === 'h'
      ? y - crop.y0 <= 3 || crop.y1 - y <= 3
      : x - crop.x0 <= 3 || crop.x1 - x <= 3);
  const laneAllowed = (x, y, d, goal = false) => {
    const cells = laneCells(x, y, d);
    const flow = axis(d);
    const perpendicular = flow === 'v' ? 'h' : 'v';
    let hasCrossRoad = false;
    const adjacentRoads = [];
    const crossingRoadCells = [];
    for (const [cx, cy] of cells) {
      if (!inC(cx, cy)) return false;
      const k = id(cx, cy);
       const building = opt.ignoreBuildings ? fixedFoot[k] : foot[k] >= 0;
       const roof = opt.ignoreBuildings ? fixedRoof[k] : roofZ[k];
       const fore = opt.ignoreBuildings ? fixedFront[k] : front[k];
       const door = opt.ignoreBuildings ? fixedDoorFront[k] : doorFront[k];
       if (inPlaza(cx, cy) || plazaM[k] || building || roof || fore || door || terraceMask[k]) return false;
      if (original[k] === OUT && !goal) return false;
      if (original[k] === WATER && !(goal && sinkWater(cx, cy))) return false;
      if (![GRASS, STREET, DIRT, OUT, WATER].includes(original[k])) return false;
      const rd = roadDirAt(cx, cy);
      if (rd) {
        if (rd !== perpendicular) return false;
        hasCrossRoad = true;
        crossingRoadCells.push([cx, cy]);
        continue;
      }
      // 水セルのすぐ隣に舗装地があるときは、同じ状態の lane が
      // その通りを実際に横切っている場合だけ許す。通りの直前・直後を
      // ただの草地として通してしまうと、橋の無い並走ができてしまう。
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!inG(nx, ny) || !paved(id(nx, ny))) continue;
        adjacentRoads.push({ x: nx, y: ny, dir: roadDirAt(nx, ny), cx, cy });
      }
    }
    if (adjacentRoads.some(({ dir }) => dir !== perpendicular)) return false;
    if (adjacentRoads.length && !hasCrossRoad) {
      const hasRoadAhead = adjacentRoads.every(({ x: rx, y: ry, cx, cy }) => {
        const dx = rx - cx, dy = ry - cy;
        if (!(dx === dirs[d][0] && dy === dirs[d][1]) && !(dx === -dirs[d][0] && dy === -dirs[d][1])) return false;
        return laneCells(x + dirs[d][0], y + dirs[d][1], d).some(([lx, ly]) => paved(id(lx, ly))) ||
          laneCells(x - dirs[d][0], y - dirs[d][1], d).some(([lx, ly]) => paved(id(lx, ly)));
      });
      if (!hasRoadAhead) return false;
    }
    if (parallelToWater(cells, flow) || parallelToMapEdge(cells, flow)) return false;
    if (hasCrossRoad) {
      const alongRoad = perpendicular === 'h' ? [1, 0] : [0, 1];
      const alongValues = crossingRoadCells.map(([cx, cy]) => alongRoad[0] ? cx : cy);
      const minAlong = Math.min(...alongValues), maxAlong = Math.max(...alongValues);
      const first = crossingRoadCells[0];
      const reachesBothSides = alongRoad[0]
        ? inG(minAlong - 1, first[1]) && inG(maxAlong + 1, first[1]) &&
          paved(id(minAlong - 1, first[1])) && paved(id(maxAlong + 1, first[1]))
        : inG(first[0], minAlong - 1) && inG(first[0], maxAlong + 1) &&
          paved(id(first[0], minAlong - 1)) && paved(id(first[0], maxAlong + 1));
      if (!reachesBothSides) return false;
    }
    if (hasCrossRoad) {
      const centerX = Math.round(cells.reduce((n, [cx]) => n + cx, 0) / cells.length);
      const centerY = Math.round(cells.reduce((n, [, cy]) => n + cy, 0) / cells.length);
      if (nearRoadTurn(centerX, centerY)) return false; // 橋の中心が曲がり角から2マス以内なら渡さない
    }
    return true;
  };

  // A* は水路の中心線だけを探索し、各中心線を幅2マスへ広げる。曲がり角は高く払い、直線を優先する。
  const state = (x, y, d) => (id(x, y) * 4 + d);
  const decode = (s) => { const d = s % 4, k = (s / 4) | 0; return { x: k % cols, y: (k / cols) | 0, d }; };
  const heapPush = (heap, item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= item[0]) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = item;
  };
  const heapPop = (heap) => {
    const top = heap[0], last = heap.pop();
    if (!heap.length) return top;
    let i = 0;
    while (true) {
      let l = i * 2 + 1;
      if (l >= heap.length) break;
      let r = l + 1, c = r < heap.length && heap[r][0] < heap[l][0] ? r : l;
      if (heap[c][0] >= last[0]) break;
      heap[i] = heap[c]; i = c;
    }
    heap[i] = last;
    return top;
  };
  const astar = (starts, goals) => {
    if (!starts.length || !goals.size) return null;
    const goalList = [...goals].map(decode);
    const heuristic = (s) => {
      const a = decode(s);
      let best = Infinity;
      for (const b of goalList) best = Math.min(best, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
      return best;
    };
    const dist = new Float64Array(N * 4); dist.fill(Infinity);
    const prev = new Int32Array(N * 4); prev.fill(-1);
    const heap = [];
    for (const s of starts) {
      if (dist[s] > 0) { dist[s] = 0; heapPush(heap, [heuristic(s), 0, s]); }
    }
    let expanded = 0;
    while (heap.length && expanded++ < N * 3) {
      const [, dg, s] = heapPop(heap);
      if (dg !== dist[s]) continue;
      if (goals.has(s)) {
        const path = [];
        for (let q = s; q >= 0; q = prev[q]) { path.push(q); if (prev[q] < 0) break; }
        return path.reverse();
      }
      const a = decode(s);
      for (let nd = 0; nd < 4; nd++) {
        const nx = a.x + dirs[nd][0], ny = a.y + dirs[nd][1];
        if (!inG(nx, ny)) continue;
        const ns = state(nx, ny, nd);
        if (nd !== a.d && laneTouchesRoadSide(a.x, a.y, a.d) &&
          !laneCells(nx, ny, nd).some(([cx, cy]) => roadDirAt(cx, cy))) continue;
        if (!laneAllowed(nx, ny, nd, goals.has(ns))) continue;
        const turn = nd === a.d ? 0 : 34;
        let terrain = 1;
        for (const [cx, cy] of laneCells(nx, ny, nd)) {
          const v = original[id(cx, cy)];
          terrain += v === STREET ? 2 : v === DIRT ? 1 : v === WATER ? 2 : v === OUT ? 7 : 0;
        }
        const ng = dg + terrain + turn;
        if (ng >= dist[ns]) continue;
        dist[ns] = ng; prev[ns] = s;
        heapPush(heap, [ng + heuristic(ns), ng, ns]);
      }
    }
    return null;
  };

  // envInCode のファイルを現在の建物の module / merged へ対応づけ、設定名の種類数で地区を選ぶ。
  const envRows = Array.isArray(well.facts?.envInCode) ? well.facts.envInCode : [];
  const candidates = placed.filter((p) => !p.spec.facility && p.spec.module);
  const modulePaths = (m) => [m.path, ...(m.merged || [])].filter((p) => typeof p === 'string' && p.length);
  const moduleForFile = (file) => {
    let best = null, score = -1;
    for (const p of candidates) for (const path of modulePaths(p.spec.module)) {
      if (file === path || file.startsWith(`${path}/`)) {
        if (path.length > score) { best = p; score = path.length; }
      }
    }
    return best;
  };
  const districtCounts = new Map();
  for (const row of envRows) {
    const hit = (row.files || []).map(moduleForFile).find(Boolean);
    if (!hit) continue;
    const key = hit.spec.module.path;
    districtCounts.set(key, (districtCounts.get(key) || 0) + 1);
  }
  const orderedDistricts = [...districtCounts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  const maxDistrict = orderedDistricts[0]?.[1] || 0;
  const past = maxDistrict ? orderedDistricts.filter(([, n]) => n === maxDistrict).slice(0, 3).map(([p]) => p) : [];
  const targetBuildings = candidates.filter((p) => past.includes(p.spec.module.path));
  const targetGoals = new Set();
  const addGoal = (x, y, d) => {
    if (inC(x, y) && laneAllowed(x, y, d, false)) targetGoals.add(state(x, y, d));
  };
  for (const p of targetBuildings) {
    // 「地区のそば」は建物の壁際だけに限定しない。建物の周囲10マス
    // までを候補にして、通りの角を避けながら到達できる余地を残す。
    for (let y = p.y - 10; y <= p.yb + 10; y++) {
      addGoal(p.x - 9, y, 1);
      addGoal(p.x + p.w + 9, y, 1);
    }
    for (let x = p.x - 10; x <= p.x + p.w + 9; x++) {
      addGoal(x, p.y - 9, 0);
      addGoal(x, p.yb + 10, 0);
    }
  }

  // 井戸小屋は placeProps() の中で置くため、ここでは同じ中心候補を
  // 基準にして、広場の縁を井戸に近い順に試す。始点はその縁の
  // 範囲内だけに置き、広場の外から水口が始まらないようにする。
  const [, wellH] = propTiles('wellhouse', propArt);
  const wellAnchor = { x: P.cx, y: plaza.y1 - wellH / 2 };
  const edgeDefs = [
    { name: 'south', d: 1, distance: Math.abs((plaza.y1 + 1) - wellAnchor.y), tie: 0 },
    { name: 'east', d: 0, distance: Math.abs((plaza.x1 + 1) - wellAnchor.x), tie: 1 },
    { name: 'west', d: 2, distance: Math.abs(wellAnchor.x - (plaza.x0 - 1)), tie: 2 },
  ].sort((a, b) => a.distance - b.distance || a.tie - b.tie);
  const startsFor = (edge) => {
    const starts = [];
    if (edge.name === 'south') {
      const xs = [];
      for (let x = plaza.x0; x <= plaza.x1; x++) xs.push(x);
      xs.sort((a, b) => Math.abs(a - wellAnchor.x) - Math.abs(b - wellAnchor.x) || a - b);
      for (const x of xs) {
        // 広場の擁壁そのものを水にせず、その下の大通り側から口を出す。
        const y = plaza.y1 + 2;
        if (inC(x, y) && laneAllowed(x, y, edge.d, false)) starts.push(state(x, y, edge.d));
      }
    } else {
      const ys = [];
      for (let y = plaza.y0; y <= plaza.y1; y++) ys.push(y);
      ys.sort((a, b) => Math.abs(a - wellAnchor.y) - Math.abs(b - wellAnchor.y) || a - b);
      const x = edge.name === 'east' ? plaza.x1 + 1 : plaza.x0 - 1;
      for (const y of ys) if (inC(x, y) && laneAllowed(x, y, edge.d, false)) starts.push(state(x, y, edge.d));
    }
    return starts;
  };

  const atCropEdge = (x, y) => x === crop.x0 || x === crop.x1 || y === crop.y0 || y === crop.y1;
  const flowsOutside = (cells, d) => {
    if (d === 0) return cells.some(([x]) => x === crop.x1);
    if (d === 2) return cells.some(([x]) => x === crop.x0);
    if (d === 1) return cells.some(([, y]) => y === crop.y1);
    return cells.some(([, y]) => y === crop.y0);
  };
  const outsideStates = new Set();
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) for (let d = 0; d < 4; d++) {
    const cells = laneCells(x, y, d);
    if (!cells.some(([cx, cy]) => inC(cx, cy) && atCropEdge(cx, cy) && original[id(cx, cy)] === GRASS)) continue;
    if (!flowsOutside(cells, d)) continue;
    const s = state(x, y, d);
    if (laneAllowed(x, y, d, true)) outsideStates.add(s);
  }
  const harbourStates = new Set();
  if (quay) {
    for (let x = crop.x0 + 1; x <= crop.x1 - 1; x++) {
      // qt は岸の通りの上端が列ごとに1行だけ揺れるため、左右2列の
      // 最初の水行が同じ場所だけを終点にする。直前のlaneは岸の通り
      // なので、水路は岸壁の2行をまっすぐ横切って港へ入る。
      const leftQt = quay.qt[x - 1] ?? quay.top;
      const rightQt = quay.qt[x] ?? quay.top;
      if (leftQt !== rightQt) continue;
      const y = leftQt + 2;
      const s = state(x, y, 1);
      if (!laneCells(x, y, 1).every(([cx, cy]) => sinkWater(cx, cy))) continue;
      if (laneAllowed(x, y, 1, true)) harbourStates.add(s);
    }
  }
  // 中間地点（past）を必ず通る A*。通常の A* とは別に「past を通過したか」
  // を状態へ持たせるので、最初に見つけた行き止まりだけで全体を諦めない。
  const astarVia = (starts, mids, goals) => {
    if (!starts.length || !mids.size || !goals.size) return null;
    const goalList = [...goals].map(decode);
    const heuristic = (s) => {
      const a = decode(s);
      let best = Infinity;
      for (const b of goalList) best = Math.min(best, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
      return best;
    };
    const dist = new Float64Array(N * 8); dist.fill(Infinity);
    const prev = new Int32Array(N * 8); prev.fill(-1);
    const heap = [];
    const keyOf = (s, hit) => s * 2 + (hit ? 1 : 0);
    const stateOf = (key) => (key / 2) | 0;
    for (const s of starts) {
      const key = keyOf(s, mids.has(s));
      if (dist[key] > 0) { dist[key] = 0; heapPush(heap, [heuristic(s), 0, key]); }
    }
    let expanded = 0;
    while (heap.length && expanded++ < N * 6) {
      const [, dg, key] = heapPop(heap);
      if (dg !== dist[key]) continue;
      const s = stateOf(key), hit = (key & 1) === 1;
      if (hit && goals.has(s)) {
        const path = [];
        for (let q = key; q >= 0; q = prev[q]) { path.push(stateOf(q)); if (prev[q] < 0) break; }
        return path.reverse();
      }
      const a = decode(s);
      for (let nd = 0; nd < 4; nd++) {
        const nx = a.x + dirs[nd][0], ny = a.y + dirs[nd][1];
        if (!inG(nx, ny)) continue;
        const ns = state(nx, ny, nd);
        const nextHit = hit || mids.has(ns);
        if (nd !== a.d && laneTouchesRoadSide(a.x, a.y, a.d) &&
          !laneCells(nx, ny, nd).some(([cx, cy]) => roadDirAt(cx, cy))) continue;
        if (!laneAllowed(nx, ny, nd, goals.has(ns))) continue;
        const turn = nd === a.d ? 0 : 34;
        let terrain = 1;
        for (const [cx, cy] of laneCells(nx, ny, nd)) {
          const v = original[id(cx, cy)];
          terrain += v === STREET ? 2 : v === DIRT ? 1 : v === WATER ? 2 : v === OUT ? 7 : 0;
        }
        const ng = dg + terrain + turn, nk = keyOf(ns, nextHit);
        if (ng >= dist[nk]) continue;
        dist[nk] = ng; prev[nk] = key;
        heapPush(heap, [ng + heuristic(ns), ng, nk]);
      }
    }
    return null;
  };

  let allStates = null, routePast = [], routeTo = null;
  if (Array.isArray(opt.forcedStates) && opt.forcedStates.length) {
    const valid = opt.forcedStates.every((s, i) => {
      const a = decode(s);
      return laneAllowed(a.x, a.y, a.d, i === opt.forcedStates.length - 1);
    });
    if (valid) {
      allStates = opt.forcedStates.slice();
      routePast = Array.isArray(opt.forcedPast) ? opt.forcedPast.slice() : [];
      routeTo = opt.forcedTo || null;
    }
  }
  for (const edge of edgeDefs) {
    if (allStates) break;
    const starts = startsFor(edge);
    if (!starts.length) continue;
    // (a) 港の水、(b) 街の外の順で、まず設定地区のそばを通る道を探す。
    let found = null;
    if (harbourStates.size && past.length && targetGoals.size) {
      const path = astarVia(starts, targetGoals, harbourStates);
      if (path) found = { path, past: past.slice(), to: 'harbour' };
    }
    if (!found && outsideStates.size && past.length && targetGoals.size) {
      const path = astarVia(starts, targetGoals, outsideStates);
      if (path) found = { path, past: past.slice(), to: 'outside' };
    }
    // 地区を決められない街では、(a) 港、(b) 外の順で直接流す。
    if (!found && !past.length && harbourStates.size) {
      const path = astar(starts, harbourStates);
      if (path) found = { path, past: [], to: 'harbour' };
    }
    // past のそばを通る道が無いときだけ、past を空にして街の外へ流す。
    if (!found && outsideStates.size) {
      const path = astar(starts, outsideStates);
      if (path) found = { path, past: [], to: 'outside' };
    }
    if (found) {
      allStates = found.path;
      routePast = found.past;
      routeTo = found.to;
      break;
    }
  }
  if (!allStates) {
    return cannotPlace('広場の南・東・西の縁から、港または街の外へ、通りとの直交・曲がり角2マスの規則を守る水路を置けない');
  }
  const cells = new Set();
  for (const s of allStates) {
    const a = decode(s);
    for (const [x, y] of laneCells(a.x, a.y, a.d)) if (inC(x, y)) cells.add(id(x, y));
  }
  // 始点・終点を含む水セルが幅2で一続きかを最後に確認する。
  const canalCells = [...cells].map((k) => [k % cols, (k / cols) | 0]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (canalCells.length < 4) {
    return cannotPlace('始点から終点まで幅2マスの水路を連続して置けない');
  }
  const cellSet = new Set(canalCells.map(([x, y]) => id(x, y)));
  const seen = new Set([canalCells[0] && id(canalCells[0][0], canalCells[0][1])]);
  const queue = [canalCells[0]];
  for (let h = 0; h < queue.length; h++) {
    const [x, y] = queue[h];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = id(nx, ny);
      if (cellSet.has(k) && !seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
    }
  }
  if (seen.size !== cellSet.size) {
    return cannotPlace('水路のセルが一続きにならない');
  }
  const bridgeCells = new Set(), bridgeDeckCells = new Set();
  const bridgeProps = [];
  const mouthProps = [];
  const firstState = decode(allStates[0]);
  const firstLane = laneCells(firstState.x, firstState.y, firstState.d).filter(([x, y]) => cellSet.has(id(x, y)));
  if (firstLane.length === 2) {
    const xs = firstLane.map(([x]) => x), ys = firstLane.map(([, y]) => y);
    const mouthTileX = firstState.d % 2 ? Math.min(...xs) : firstState.x;
    const mouthTileY = Math.min(...ys);
    // 始点の最初の水セルに石の口を重ねる。橋の位置は
    // 交差する道路の幅に合わせて決まるため、口を先へずらさない。
    const mouthX = mouthTileX + 1;
    const mouthY = mouthTileY + 1;
    mouthProps.push({ type: 'canal-mouth', x: mouthX, y: mouthY, look: 'canal-mouth' });
  }
  const crossings = [];
  // 1本の橋の deck は流れ方向に2マスを覆う。水路の同じ向きの
  // 交差部が近いと、前庭や dense frontage まで舗装として拾って橋が
  // 縦に重なるため、交差前にその部分だけ草地へ戻す。
  const initialRoadWater = new Set(canalCells.filter(([x, y]) => paved(id(x, y))).map(([x, y]) => id(x, y)));
  const initialRoadDir = new Map(canalCells.map(([x, y]) => [id(x, y), roadDirAt(x, y)]));
  const initialComponents = [];
  const initialSeen = new Set();
  for (const start of initialRoadWater) {
    if (initialSeen.has(start)) continue;
    const dir = initialRoadDir.get(start);
    if (!dir) continue;
    const component = [], q = [start];
    initialSeen.add(start);
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % cols, y = (k / cols) | 0;
      component.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = id(nx, ny);
        if (initialRoadWater.has(nk) && initialRoadDir.get(nk) === dir && !initialSeen.has(nk)) {
          initialSeen.add(nk);
          q.push(nk);
        }
      }
    }
    const xs = component.map(([x]) => x), ys = component.map(([, y]) => y);
    initialComponents.push({
      cells: component, dir,
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
      soft: component.every(([x, y]) => {
        const r = road[id(x, y)];
        return r < 0 || pieces[r]?.kind === 'dense';
      }),
    });
  }
  const axisRange = (c) => c.dir === 'h' ? [c.minY, c.maxY] : [c.minX, c.maxX];
  const axisGap = (a, b) => {
    const [a0, a1] = axisRange(a), [b0, b1] = axisRange(b);
    return a1 < b0 ? b0 - a1 - 1 : b1 < a0 ? a0 - b1 - 1 : 0;
  };
  const clearCrossingCell = (x, y, dir) => {
    const k = id(x, y);
    original[k] = GRASS;
    const sides = dir === 'h' ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
    for (const [nx, ny] of sides) {
      if (!inG(nx, ny)) continue;
      const nk = id(nx, ny);
      if (foot[nk] >= 0 || buildingWalkRow[nk] || front[nk] || plazaM[nk] || terraceMask[nk]) continue;
      if (original[nk] === STREET || original[nk] === DIRT) g[nk] = GRASS;
    }
  };
  const keptComponents = [];
  initialComponents
    .sort((a, b) => (a.dir === b.dir ? axisRange(a)[0] - axisRange(b)[0] : a.dir.localeCompare(b.dir)))
    .forEach((c) => {
      const nearbyNormal = initialComponents.some((q) => q !== c && q.dir === c.dir && !q.soft && axisGap(c, q) <= 2);
      const nearbyKept = keptComponents.some((q) => q.dir === c.dir && axisGap(c, q) <= 2);
      if ((c.soft && nearbyNormal) || nearbyKept) {
        for (const [x, y] of c.cells) clearCrossingCell(x, y, c.dir);
        return;
      }
      const [a0, a1] = axisRange(c);
      if (a1 - a0 + 1 > 2) {
        const keep0 = c.dir === 'h' ? Math.floor((a0 + a1) / 2) : a0;
        const keep1 = keep0 + 1;
        for (const [x, y] of c.cells) {
          const axis = c.dir === 'h' ? y : x;
          if (axis < keep0 || axis > keep1) clearCrossingCell(x, y, c.dir);
        }
      }
      keptComponents.push(c);
    });
  const roadWater = new Set(canalCells.filter(([x, y]) => paved(id(x, y))).map(([x, y]) => id(x, y)));
  const waterRoadDir = new Map(canalCells.map(([x, y]) => [id(x, y), roadDirAt(x, y)]));
  const crossed = new Set();
  const deckBounds = (type, px, py) => {
    const d = propArt[type].deck;
    return {
      x0: Math.floor((px * 16 + d[0]) / 16),
      y0: Math.floor((py * 16 + d[1]) / 16),
      x1: Math.floor((px * 16 + d[0] + d[2] - 0.001) / 16),
      y1: Math.floor((py * 16 + d[1] + d[3] - 0.001) / 16),
    };
  };
  const addDeckTiles = (type, px, py) => {
    const { x0, y0, x1, y1 } = deckBounds(type, px, py);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inC(x, y)) {
      bridgeCells.add(id(x, y));
      bridgeDeckCells.add(id(x, y));
    }
    // 橋の板の両端に接する道路マスも予約する。ここへ街灯や樽を置くと、
    // 橋の上へ歩き出す最初の一歩を小物が塞いでしまう。
    if (type === 'bridge-h') {
      for (let y = y0; y <= y1; y++) for (const x of [x0 - 1, x1 + 1]) if (inC(x, y)) bridgeCells.add(id(x, y));
    } else if (type === 'bridge-v') {
      for (let x = x0; x <= x1; x++) for (const y of [y0 - 1, y1 + 1]) if (inC(x, y)) bridgeCells.add(id(x, y));
    }
  };
  for (const start of roadWater) {
    if (crossed.has(start)) continue;
    const dir = waterRoadDir.get(start);
    if (!dir) continue;
    const component = [], q = [start];
    crossed.add(start);
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % cols, y = (k / cols) | 0;
      component.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = id(nx, ny);
        if (roadWater.has(nk) && waterRoadDir.get(nk) === dir && !crossed.has(nk)) { crossed.add(nk); q.push(nk); }
      }
    }
    const xs = component.map(([x]) => x), ys = component.map(([, y]) => y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    if (dir === 'h') {
      const cx = (minX + maxX + 1) / 2;
      // bridge-h の deck は、水幅2マスと東西の通り1マスずつを覆う。
      // 絵の南側のアーチ面は deck の外側に置き、北側の水へはみ出させない。
      const px = cx, py = (maxY - minY + 1) <= 2 ? maxY + 1 : Math.floor((minY + maxY) / 2) + 2;
      bridgeProps.push({ type: 'bridge-h', x: px, y: py, look: 'bridge-h' });
      addDeckTiles('bridge-h', px, py);
      crossings.push({ x: Math.floor(cx), y: Math.floor((minY + maxY) / 2), road: 'h', bridge: 'bridge-h' });
    } else if (dir === 'v') {
      const cx = (minX + maxX) / 2, cy = (minY + maxY + 1) / 2;
      // bridge-v も同じく、南北の通りの両端を deck に含める。
      const px = minX + 1, py = cy + 2.5;
      bridgeProps.push({ type: 'bridge-v', x: px, y: py, look: 'bridge-v' });
      addDeckTiles('bridge-v', px, py);
      crossings.push({ x: Math.floor(cx), y: Math.floor(cy), road: 'v', bridge: 'bridge-v' });
    }
  }
  // 横橋の deck の片側から2セル以内を同じ通常建物が全行ふさいでいる
  // 場合だけ、その建物セルを次の建物配置で予約する。1行だけの接触は
  // 歩行可能なので予約せず、密な街の外枠を広げない。縦橋は deck の
  // 半端丸めを補正済み。
  const bridgeSideReserve = new Set();
  for (const p of bridgeProps) {
    if (p.type !== 'bridge-h') continue;
    const { x0, y0, x1, y1 } = deckBounds(p.type, p.x, p.y);
    const sideXs = quay ? [x0 - 1, x0 - 2, x1 + 1, x1 + 2] : [x0 - 1, x1 + 1];
    for (const x of sideXs) {
      const ks = [];
      for (let y = y0; y <= y1; y++) if (inC(x, y)) ks.push(id(x, y));
      if (ks.length && ks.every((k) => foot[k] >= 0 && !placed[foot[k]]?.spec.facility)) {
        for (const k of ks) bridgeSideReserve.add(k);
      }
    }
  }
  // 水路の中心が元の舗装セルでなくても、幅のある通りの両側に沿って
  // 横断している場合がある。橋の無い並走を残さないよう、その交差部に
  // deck が収まる道路行を探して橋と crossing の中心を同じ行へ寄せる。
  const touchesPerpendicularRoad = (x, y, flow) => {
    const sides = flow === 'v' ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
    return sides.some(([nx, ny]) => {
      if (!inG(nx, ny)) return false;
      const k = id(nx, ny), r = road[k];
      return r >= 0 && pieces[r]?.kind !== 'dense';
    });
  };
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i], p = bridgeProps[i];
    if (c.road !== 'h' || !p) continue;
    const bad = canalCells.filter(([x, y]) => {
      return Math.abs(x - c.x) <= 2 && Math.abs(y - c.y) <= 5 &&
        Math.abs(x - c.x) + Math.abs(y - c.y) > 2 && touchesPerpendicularRoad(x, y, 'v');
    });
    if (!bad.length) continue;
    const choices = [];
    for (let dy = -3; dy <= 3; dy++) {
      if (!dy) continue;
      const candidatePy = p.y + dy, b = deckBounds('bridge-h', p.x, candidatePy);
      if (b.x0 < 0 || b.y0 < 0 || b.x1 >= cols || b.y1 >= rows) continue;
      let clear = true;
      for (let y = b.y0; y <= b.y1 && clear; y++) for (let x = b.x0; x <= b.x1; x++) {
        if (!inC(x, y) || original[id(x, y)] === OUT || foot[id(x, y)] >= 0) { clear = false; break; }
      }
      if (!clear) continue;
      const ysOnDeck = [];
      for (let y = b.y0; y <= b.y1; y++) {
        const k = id(c.x, y);
        if (cellSet.has(k) && paved(id(b.x0, y)) && paved(id(b.x1, y))) ysOnDeck.push(y);
      }
      for (const cy of ysOnDeck) {
        const maxDistance = Math.max(...bad.map(([x, y]) => Math.abs(x - c.x) + Math.abs(y - cy)));
        if (maxDistance > 2) continue;
        let blocked = 0;
        for (const x of [b.x0 - 1, b.x1 + 1]) for (let y = b.y0; y <= b.y1; y++) {
          if (inC(x, y) && foot[id(x, y)] >= 0) blocked++;
        }
        choices.push({ py: candidatePy, cy, maxDistance, blocked, distance: Math.abs(dy) });
      }
    }
    choices.sort((a, b) => a.maxDistance - b.maxDistance || a.blocked - b.blocked || a.distance - b.distance || a.py - b.py);
    if (choices[0]) {
      p.y = choices[0].py;
      c.y = choices[0].cy;
    }
  }
  // 補正後の deck だけを橋の予約帯として使う。
  bridgeCells.clear();
  bridgeDeckCells.clear();
  for (const p of bridgeProps) addDeckTiles(p.type, p.x, p.y);
  const bridgeReserveCells = [
    ...bridgeDeckCells,
    ...bridgeSideReserve,
  ];
  if (opt.reserveOnly) return {
    reserveCells: [
      ...canalCells,
      ...bridgeReserveCells.map((k) => [k % cols, (k / cols) | 0]),
    ],
    states: allStates,
    past: routePast,
    to: routeTo,
  };
  for (const k of cells) g[k] = WATER;
  // finalize() が出口へ延ばした単独の土道が、水路の曲がり角の横に1マスだけ
  // 残ることがある。これは水路と平行な通りではないため、足元や扉を壊さない
  // 範囲で草地へ戻し、ascii の「水路の脇を通り・路地が流れる」を避ける。
  for (const k of cells) {
    const x = k % cols, y = (k / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inG(nx, ny)) continue;
      const nk = id(nx, ny);
      if ((original[nk] === STREET || original[nk] === DIRT) &&
        !bridgeCells.has(nk) && foot[nk] < 0 && !buildingWalkRow[nk] && !front[nk] && !plazaM[nk] && !terraceMask[nk]) g[nk] = GRASS;
    }
  }
  // bridge-h / bridge-v の deck は絵の都合で道路を前後2行覆う。
  // 1行幅の土の路地を横切る場合も、deck の水でないマスを橋の取り付け道にして
  // 草地が橋の下へ見えないようにする（footprint・水路上の建物には重ならない）。
  for (const p of bridgeProps) {
    const d = propArt[p.type].deck;
    const x0 = Math.floor((p.x * 16 + d[0]) / 16), x1 = Math.floor((p.x * 16 + d[0] + d[2] - 0.001) / 16);
    const y0 = Math.floor((p.y * 16 + d[1]) / 16), y1 = Math.floor((p.y * 16 + d[1] + d[3] - 0.001) / 16);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (inC(x, y) && g[id(x, y)] !== WATER && foot[id(x, y)] < 0) g[id(x, y)] = DIRT;
    }
  }
  return {
    cells: canalCells,
    states: allStates,
    from: 'well',
    past: routePast,
    to: routeTo,
    crossings: crossings.sort((a, b) => a.y - b.y || a.x - b.x),
    bridgeProps,
    mouthProps,
    bridgeCells: [...bridgeCells].map((k) => [k % cols, (k / cols) | 0]),
    bridgeDeckCells: [...bridgeDeckCells].map((k) => [k % cols, (k / cols) | 0]),
    bridgeReserveCells: bridgeReserveCells.map((k) => [k % cols, (k / cols) | 0]),
  };
}

// ---------- 小物（歩ける所をふさがないことを確かめながら置く） ----------
function placeProps(P, F, rng, spawn, extra) {
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
    const got = placeGate(lm);
    if (got) out.landmarks.push({ ...lm.data, x: got.prop.x, y: got.prop.y, keeper: got.keeper });
  }
  function placeGate(lm) {
    const a = propArt[lm.prop];
    if (!a) return null;
    const solids = a.solids || (a.solid ? [a.solid] : []);
    let op = a.opening;
    if (!op && solids.length >= 2) {                    // くぐれる所が書いてなければ、いちばん内側の2本の柱の間
      const ss = [...solids].sort((p, q) => p[0] - q[0]);
      const l = ss[0], r = ss[ss.length - 1];
      op = [l[0] + l[2], Math.min(l[1], r[1]), r[0] - (l[0] + l[2]), Math.max(l[3], r[3])];
    }
    if (!op || op[2] < 16 || !solids.length) return null;
    const n = Math.max(1, Math.round(op[2] / 16));      // くぐれる所の幅（マス）
    const [ox, oy] = a.origin || [Math.ceil((op[2] + 32) / 2), 64];
    const iw = a.size ? a.size[0] : 2 * ox;
    const inn = placed.find((p) => p.spec.archetype === 'inn');
    const exits = [...(F.exits || [])].sort((p, q) => {
      if (!inn) return p.dir - q.dir;                   // 宿屋が無ければ北の出口から
      const d = (e) => Math.abs((inn.doorCol ?? inn.x) - e.x) + 1.2 * Math.abs(inn.yb - e.end);
      return d(p) - d(q) || p.dir - q.dir;
    });
    const paveable = (x, y) => inC(x, y) && foot[id(x, y)] < 0 && g[id(x, y)] !== WATER && g[id(x, y)] !== PLAZA;
    for (const e of exits) {
      // 街の外へ出る土の道を、通りの端から外へたどる。土道が草地・外で途切れていても、
      // 建物・水・舗装で遮られない列を外まで延ばし、門の手前の道にする（段々の道は行ごとにずれる）。
      const trail = new Map();
      for (let y = e.end + e.dir, col = e.col; y >= crop.y0 && y <= crop.y1; y += e.dir) {
        // 北南の出口の直後に家の footprint が寄っていても、最大6マス以内の
        // 空いた列へ道を曲げて門候補まで届ける。
        const dxs = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6];
        const dx = dxs.find((d) => {
          if (!inC(col + d, y) || foot[id(col + d, y)] >= 0) return false;
          const tile = g[id(col + d, y)];
          return tile === STREET || tile === DIRT || tile === GRASS || tile === OUT;
        });
        if (dx === undefined) break;
        col += dx;
        trail.set(y, col);
      }
      const pathCol = (e2, y) => trail.get(y) ?? -1;
      for (const k of [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
        const r = e.end + e.dir * k;                    // 門の行（柱の足元の行）
        const out1 = r + e.dir;                         // 門の外の1行
        if (out1 < crop.y0 + 1 || out1 > crop.y1 - 1 || r - Math.ceil(oy / 16) < crop.y0) continue;
        const pcol = pathCol(e, r);
        if (pcol < 0) continue;
        // 道の列を門の幅で包む所を先に。だめなら門を道の脇へ少しずらし、門の前後で道をつなぎ直す
        const c = pcol - Math.floor((n - 1) / 2);
        const starts = [c, c + 1, c - 1, c - 2, c + 2, c - 3, c + 3];
        for (const c0 of starts) {
          const fx = c0 * 16 - op[0], fy = (r + 1) * 16;
          const opCols = new Set(Array.from({ length: n }, (_, i) => c0 + i));
          // 柱の tile（くぐれる所の列は除く）
          const pillar = [];
          for (const sb of solids) {
            const tx0 = Math.floor((fx + sb[0]) / 16), tx1 = Math.floor((fx + sb[0] + sb[2] - 1) / 16);
            const ty0 = Math.floor((fy + sb[1]) / 16), ty1 = Math.floor((fy + sb[1] + sb[3] - 1) / 16);
            for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) if (!opCols.has(x) && !pillar.some(([px, py]) => px === x && py === y)) pillar.push([x, y]);
          }
          if (!pillar.length) continue;
          const isPillar = (x, y) => pillar.some(([px, py]) => px === x && py === y);
          // 絵のかかる範囲（tile。左右の端の 6px は軒・灯の張り出しなので数えない）: 建物・屋根の陰にかからない
          const vx0 = Math.floor((fx - ox + 6) / 16), vx1 = Math.floor((fx - ox + iw - 7) / 16), vy0 = Math.floor((fy - oy) / 16);
          let ok = vx0 >= crop.x0 && vx1 <= crop.x1 && vy0 >= crop.y0;
          for (let y = vy0; y <= r + 1 && ok; y++) for (let x = vx0; x <= vx1; x++) if (inC(x, y) && (foot[id(x, y)] >= 0 || roofZ[id(x, y)])) { ok = false; break; }
          if (!ok) continue;
          // 門の外は街の外（建物・石畳の通り・広場が無い）: 街の中の通りの途中には門を立てない
          const yEnd = e.dir < 0 ? crop.y0 : crop.y1;
          // compact な街では隣家や別の縦道が絵の端に来る。門の絵の幅だけを
          // 外へ空ければよく、周囲の余白まで要求すると門候補を失う。
          for (let y = out1; ok && (y - yEnd) * e.dir <= 0; y += e.dir) for (let x = vx0; x <= vx1; x++) {
            if (!inC(x, y)) continue;
            const k2 = id(x, y);
            if (foot[k2] >= 0 || g[k2] === STREET || g[k2] === PLAZA) { ok = false; break; }
          }
          if (!ok) continue;
          // 柱は草地（街の外の草地）の上だけ
          for (const [x, y] of pillar) if (!inC(x, y) || foot[id(x, y)] >= 0 || (g[id(x, y)] !== GRASS && g[id(x, y)] !== OUT && !(g[id(x, y)] === DIRT && x === pathCol(e, y))) || blocked[id(x, y)] || reserved[id(x, y)]) ok = false;
          if (!ok) continue;
          // 塗る所（門の絵は南を向くので、北側の道は屋根の上に出る所で元の道につなぐ）:
          //   門の行と、その北の2行・南の行（北の門なら手前の2行、南の門なら外の1行）は門の幅。
          //   北へは屋根の陰の間（絵のかかる行）をまん中の1列でのばし、屋根の上の1行で元の道へ横につなぐ。
          //   南の端の行でも元の道へ横につなぐ。通りの端に届くときは、通りの列へつなぐ
          const rowCol = (y) => (y === e.end ? (Math.abs(e.x - (c0 + 1)) <= Math.abs(e.x + 1 - (c0 + 1)) ? e.x : e.x + 1) : pathCol(e, y));
          const north = e.dir < 0 ? crop.y0 + 1 : e.end + 1, south = e.dir < 0 ? e.end - 1 : crop.y1 - 1;
          const B = Math.max(vy0 - 1, north);                         // 北のつなぎの行
          const Fr = Math.min(e.dir < 0 ? r + 2 : r + 1, south);      // 南のつなぎの行
          if (B > r - 1 || Fr < r) continue;
          const mid = c0 + Math.floor(n / 2);
          const paint = [];
          for (let y = B; y <= Fr; y++) {
            if (y >= r - 2) for (let x = c0; x < c0 + n; x++) paint.push([x, y]);
            else paint.push([mid, y]);
          }
          const link = (y, to, from0, from1) => {
            if (to < 0 || (to >= from0 && to <= from1)) return;
            const [p, q] = to < from0 ? [to, from0 - 1] : [from1 + 1, to];
            for (let x = p; x <= q; x++) paint.push([x, y]);
          };
          if (B < r - 2) link(B, rowCol(B - 1), mid, mid); else link(B, rowCol(B - 1), c0, c0 + n - 1);
          link(Fr, rowCol(Fr + 1), c0, c0 + n - 1);
          for (const [x, y] of paint) if (!paveable(x, y) || blocked[id(x, y)] || isPillar(x, y)) ok = false;
          if (!ok) continue;
          // 元の道で門の幅の外に残る所（門のわきを抜ける土）は草に戻す（つなぎの行はそのまま）
          const erase = [];
          const painted = (x, y) => paint.some(([px, py]) => px === x && py === y);
          for (let y = B + 1; y < Fr; y++) {
            const x0 = pathCol(e, y);
            if (x0 < 0) continue;
            // その行の道のひと続き（段々の道の横のつなぎも）
            for (const d of [-1, 1]) for (let x = d < 0 ? x0 : x0 + 1; Math.abs(x - x0) <= 3 && inC(x, y) && g[id(x, y)] === DIRT && foot[id(x, y)] < 0; x += d) {
              if (!painted(x, y)) erase.push([x, y]);
            }
          }
          // 塗って、柱をふさいで、街のどこからでも門の外まで行けるかを確かめる
          const touched = [...paint, ...erase, ...pillar];
          const saved = touched.map(([x, y]) => g[id(x, y)]);
          const restore = () => { touched.forEach(([x, y], i) => { g[id(x, y)] = saved[i]; }); pillar.forEach(([x, y]) => { blocked[id(x, y)] = 0; }); };
          erase.forEach(([x, y]) => { g[id(x, y)] = GRASS; });
          paint.forEach(([x, y]) => { if (g[id(x, y)] !== STREET) g[id(x, y)] = DIRT; });
          pillar.forEach(([x, y]) => { if (g[id(x, y)] !== GRASS) g[id(x, y)] = GRASS; });
          const before = flood().count;
          pillar.forEach(([x, y]) => { blocked[id(x, y)] = 1; });
          let keeper = null;
          if (flood().count === before - pillar.length) {
            // 門番: 街の内側（門の手前）の柱のわき。通り（門の幅の道）には立たない
            const inside = r - e.dir;
            const px = pillar.map(([x]) => x), pl = Math.min(...px), pr = Math.max(...px);
            const left = hash32(`gate:${lm.data.id}:${c0}`) % 2 === 0;
            const sides = left ? [[pl, -1], [pr, 1]] : [[pr, 1], [pl, -1]];
            const cands = e.dir < 0
              ? [...sides.map(([x]) => [x, inside]), ...sides.map(([x, s]) => [x + s, inside]), ...sides.map(([x, s]) => [x + s, r])]
              : [...sides.map(([, s]) => [s < 0 ? vx0 - 1 : vx1 + 1, inside]), ...sides.map(([, s]) => [s < 0 ? vx0 - 1 : vx1 + 1, r])];   // 南の門は絵の陰に入らない所
            const cnt = flood().count;
            for (const [kx, ky] of cands) {
              if (!walk(kx, ky) || reserved[id(kx, ky)] || g[id(kx, ky)] === OUT || paint.some(([x, y]) => x === kx && y === ky)) continue;
              blocked[id(kx, ky)] = 1;
              if (flood().count === cnt - 1) { keeper = { x: kx + 0.5, y: ky + 0.6875 }; break; }
              blocked[id(kx, ky)] = 0;
            }
          }
          if (!keeper) { restore(); continue; }          // 置けない → 元に戻して次へ
          reach = flood().count;
          const prop = { type: lm.prop, x: fx / 16, y: fy / 16 };
          props.push(prop);
          // 門の道（門の手前と先の2行まで）は小物でふさがない。門のまわり1マスには木を植えない
          for (const [x, y] of paint) reserved[id(x, y)] = 1;
          for (let x = c0; x < c0 + n; x++) for (const y of [out1 + e.dir, r - 3 * e.dir]) if (inC(x, y)) reserved[id(x, y)] = 1;
          // 木の樹冠（足元から上へ4行・左右2マス）が門と門の前の1行にかからない
          mark(noTree, vx0 - 2, vy0 - 1, vx1 + 2, r + 4);
          // 通りから門までと門の先の数行の土の道にも、木の樹冠がかからない
          for (const [y, x] of trail) if ((y - e.end) * e.dir > 0 && (y - out1) * e.dir <= 4) mark(noTree, x - 2, y, x + 2, y + 3);
          for (const [x, y] of paint) mark(noTree, x - 1, y, x + 1, y + 3);
          mark(reserved, vx0 - 1, r - 1, vx1 + 1, r + 1);
          const kx = Math.floor(keeper.x), ky = Math.floor(keeper.y);
          mark(reserved, kx - 1, ky - 1, kx + 1, ky + 1);
          mark(noTree, kx - 1, ky - 1, kx + 1, ky + 1);
          // 門の灯: ほかの街灯はここから離して立てる
          for (const l of a.lights || []) lamps.push([Math.floor((fx + l[0]) / 16), Math.floor((fy + Math.max(l[1], -8)) / 16)]);
          return { prop, keeper };
        }
      }
    }
    return null;
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

// ---------- 本体 ----------
export function layoutTown(repo, opts = {}) {
  const seed = hash32(`${repo.name}@${repo.head ?? 'worktree'}`);
  const art = opts.art ?? loadArt();
  const propArt = opts.props ?? loadProps();
  const water = (opts.ground ?? loadGround()).includes('water');
  // 施設: 絵のあるものだけ（船着場は水の絵もあるときだけ）。施設が丸ごと覆うモジュールは、その施設の建物にまとめる（家は建てない）
  const facs = (repo.facilities || []).filter((f) => FACILITY_NAME[f.archetype] && art[f.archetype]?.footprint && (f.archetype !== 'dock' || water));
  // 外に立つ施設（井戸）: 小物の絵があるときだけ
  const lms = (repo.facilities || []).filter((f) => LANDMARK[f.archetype] && propArt[LANDMARK[f.archetype].prop]);
  const byPath = new Map((repo.modules || []).map((m) => [m.path, m]));
  const covered = new Set([...facs, ...lms].flatMap((f) => f.merged || []));
  const mods = aggregate((repo.modules || []).filter((m) => !covered.has(m.path)), CAP);
  const arch = archetypes(mods);
  // 外観の版が footprint の上を隠す行数。配置・屋根陰・芝生計測で同じ値を使う。
  const coverRowsOf = (a) => {
    const vs = a?.variants || [];
    const rows = vs.flatMap((v) => Array.isArray(v.cover) ? v.cover : []);
    return rows.length ? Math.max(0, ...rows) : 2;
  };
  const specs = mods.map((m, i) => {
    const a = arch.get(m);
    const [w, h] = art[a]?.footprint ?? DEFAULT_FOOT[a];
    const doorDx = clamp(art[a]?.doorX ?? DOOR_DX[a] ?? Math.floor((w - 1) / 2), 0, w - 1);
    return { id: `b${i + 1}`, archetype: a, w, h, doorDx, roofRows: coverRowsOf(art[a]), module: m, district: m.path === '.' ? '.' : m.path.split('/')[0] };
  });
  const facModule = (f) => {
    const merged = (f.merged || []).map((p) => byPath.get(p)).filter(Boolean);
    const languages = Object.create(null);
    let lines = 0, bytes = 0, dirty = 0;
    const top = [];
    for (const m of merged) {
      lines += m.lines; bytes += m.bytes; top.push(...(m.topFiles || []));
      dirty += m.works?.dirty || 0;
      for (const [k, v] of Object.entries(m.languages || {})) languages[k] = (languages[k] || 0) + v;
    }
    return {
      path: f.merged?.length ? f.merged[0] : f.archetype === 'town_hall' ? '.' : (f.evidence[0] || '.'),
      kind: f.archetype, reason: f.reason,
      files: merged.length ? merged.reduce((t, m) => t + m.files, 0) : f.evidenceCount, lines, bytes,
      languages: Object.fromEntries(Object.entries(languages).sort((p, q) => q[1] - p[1] || cmp(p[0], q[0]))),
      lastCommit: f.lastCommit || null, commits: f.commits || 0, recent: f.recent || 0, authors: f.authors || [],
      topFiles: top.sort((p, q) => q.lines - p.lines || cmp(p.path, q.path)).slice(0, 8),
      ...(f.merged?.length ? { merged: [...f.merged] } : {}),
      ...(dirty > 0 ? { works: { dirty } } : {}),
    };
  };
  const facilityOf = (f, name) => ({ archetype: f.archetype, name, reason: f.reason, evidence: f.evidence,
    evidenceCount: f.evidenceCount, facts: f.facts || {}, merged: f.merged || [] });
  const facSpecs = facs.map((f, i) => {
    const a = art[f.archetype];
    const [w, h] = a.footprint;
    return { id: `f${i + 1}`, archetype: f.archetype, w, h, doorDx: clamp(a.doorX ?? Math.floor((w - 1) / 2), 0, w - 1),
      module: facModule(f), facility: facilityOf(f, FACILITY_NAME[f.archetype]), sourceFacility: f,
      district: '\u0000facility', roofRows: coverRowsOf(a) };
  });
  const landmarks = lms.map((f, i) => ({ sourceFacility: f, prop: LANDMARK[f.archetype].prop, data: {
    id: `f${facSpecs.length + i + 1}`, archetype: f.archetype, name: LANDMARK[f.archetype].name, prop: LANDMARK[f.archetype].prop,
    facility: facilityOf(f, LANDMARK[f.archetype].name), module: facModule(f) } }));

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

  // 施設の置き場所: 役場は広場の北、酒場は広場のきわ、宿屋は大通りの入口、道場・倉庫は別々の地区、見張り台は外縁、
  // 船着場は南の岸。修理小屋は工房の近く、工房が無ければ外縁。
  const frng = makeRng(seed ^ 0x51ed270b);
  const fac = { hall: null, pub: null, inn: null, dock: null, early: [], late: [],
    hallSide: frng() < 0.5 ? -1 : 1, pubSide: frng() < 0.5 ? -1 : 1, innSide: frng() < 0.5 ? -1 : 1 };
  const slots = [-0.95, 1.2, 2.35, -2.3].map((a) => a + (frng() - 0.5) * 0.3);
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(frng() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  for (const s of facSpecs) {
    if (s.archetype === 'town_hall') fac.hall = s;
    else if (s.archetype === 'pub') fac.pub = s;
    else if (s.archetype === 'inn') fac.inn = s;
    else if (s.archetype === 'dock') fac.dock = s;
    else if (s.archetype === 'watchtower') fac.late.push({ ...s, angle: slots.pop() ?? -Math.PI / 2 });
    else if (s.archetype === 'repair') {
      const hasWorkshop = groups.some((g) => g.key === '\u0000workshops');
      if (hasWorkshop) fac.early.push({ ...s, angle: WORKSHOP_ANGLE });
      else fac.late.push({ ...s, angle: Math.PI / 2 });
    }
    else fac.early.push({ ...s, angle: slots.pop() ?? Math.PI / 2 });
  }
  // 水の深さ: 桟橋が届く行に、岸から2行ぶんの余水を足す
  let pierRows = 0;
  for (const t of ['pier', 'pier-2']) if (propArt[t]?.deck) pierRows = Math.max(pierRows, Math.ceil(propArt[t].deck[3] / 16));
  const harbour = { water: clamp(pierRows + 2, 5, 9) };
  const all = [...specs, ...facSpecs];
  const maxH = Math.max(4, ...all.filter((s) => s !== fac.hall).map((s) => s.h));
  const need = all.reduce((t, s) => t + s.w + 1.6, 0);
  const gateRows = lms.some((l) => l.archetype === 'gate') && propArt.gate
    ? Math.ceil((propArt.gate.origin?.[1] ?? 64) / 16) : 0;
  let P = null, F = null, canal = null, lastCanalAttempt = null;
  const canalRequested = (repo.facilities || []).some((f) => f.archetype === 'well' && f.facts) &&
    !!propArt['bridge-h']?.deck && !!propArt['bridge-v']?.deck;
  const C = { groups, maxH, need, seed, fac, harbour, gateRows, count: all.length };
  for (let attempt = 0, scale = 1; attempt < 14 && !P; attempt++, scale *= 1.25) {
    // 施設ごとの置き場所の列を、試すたびに作り直す（generate は列を書き換える）
    const g2 = groups.map((g) => ({ ...g, items: [...g.items], ruins: [...g.ruins] }));
    const firstP = generate({ ...C, groups: g2, fac: { ...fac, early: [...fac.early], late: [...fac.late] } }, scale);
    if (!firstP) continue;
    let firstF = finalize(firstP, maxH, { scaffold: !!(propArt.scaffold || propArt['scaffold-2']), gateRows });
    let firstCanal = buildCanal(firstP, firstF, repo, propArt);
    if (canalRequested) {
      // 水路が先に見つかった場合も、橋の deck と両端を建物が覆わないよう
      // 水路・橋の帯を予約して、同じ格子をもう一度建物へ渡す。
      // 最初の配置で水路を置けなかったときは、建物を無視した探索で帯を作る。
      const reserve = firstCanal?.cells?.length
        ? {
            reserveCells: [
              ...firstCanal.cells,
              ...(firstCanal.bridgeReserveCells || firstCanal.bridgeDeckCells || firstCanal.bridgeCells || []),
            ],
            states: firstCanal.states,
            past: firstCanal.past,
            to: firstCanal.to,
          }
        : buildCanal(firstP, firstF, repo, propArt, { ignoreBuildings: true, reserveOnly: true });
      if (reserve?.reserveCells?.length) {
        const rg = groups.map((g) => ({ ...g, items: [...g.items], ruins: [...g.ruins] }));
        const reservedP = generate({
          ...C, groups: rg, canalReserve: reserve.reserveCells,
          fac: { ...fac, early: [...fac.early], late: [...fac.late] },
        }, scale);
        if (reservedP) {
          const reservedF = finalize(reservedP, maxH, { scaffold: !!(propArt.scaffold || propArt['scaffold-2']), gateRows });
          const reservedCanal = buildCanal(reservedP, reservedF, repo, propArt, {
            forcedStates: reserve.states, forcedPast: reserve.past, forcedTo: reserve.to,
          });
          if (!reservedCanal?.unplaced) {
            P = reservedP; F = reservedF; canal = reservedCanal;
            break;
          }
        }
      }
      lastCanalAttempt = { P: firstP, F: firstF, canal: firstCanal };
      continue;
    }
    P = firstP; F = firstF; canal = firstCanal;
  }
  if (!P && lastCanalAttempt) ({ P, F, canal } = lastCanalAttempt);
  if (!P) throw new Error('layoutTown: 建物を配置できなかった');
  const gateArt = landmarks.some((l) => l.data.archetype === 'gate') && propArt.gate;
  if (opts.debug) opts.debug.P = P;                  // 調べる道具のため（通り・街区の中身）
  // 出発点は段の下の広場の最初の行（段の前の壁の上には立たせない）
  const hallT = P.terraces.find((t) => t.hall);
  const spawn = { x: P.cx, y: hallT ? hallT.y + hallT.h + 1 : P.plaza.y0 + 2 };

  // 見た目の版: 近くに同じ archetype の同じ版が並ばないように選ぶ（同じ入力からは同じ選び方）
  const variantOf = new Map();
  for (const p of [...P.placed].sort((a, b) => a.yb - b.yb || a.x - b.x)) {
    const vs = art[p.spec.archetype]?.variants || [];
    if (vs.length < 2) { if (vs.length) variantOf.set(p, vs[0]); continue; }
    const near = new Map();
    for (const [q, v] of variantOf) {
      if (q.spec.archetype !== p.spec.archetype) continue;
      const dx = Math.max(0, Math.max(q.x, p.x) - Math.min(q.x + q.w, p.x + p.w));
      const dy = Math.abs(q.yb - p.yb);
      if (dx > 14 || dy > 12) continue;
      near.set(v.id, (near.get(v.id) || 0) + (dy <= 1 ? 3 : 1) * (dx <= 3 ? 2 : 1));
    }
    const start = hash32(p.spec.id) % vs.length;
    let best = null, bn = Infinity;
    for (let k = 0; k < vs.length; k++) {
      const v = vs[(start + k) % vs.length], n = near.get(v.id) || 0;
      if (n < bn) { bn = n; best = v; }
    }
    variantOf.set(p, best);
  }
  for (const p of P.placed) {
    p.doorCol = p.x + clamp(variantOf.get(p)?.doorX ?? p.spec.doorDx, 0, p.w - 1);
    p.wall = variantOf.get(p)?.wall || [0, 0];                // 絵の壁が footprint の端から内側にある幅（px、左・右）
    p.cover = variantOf.get(p)?.cover || null;                // 屋根が footprint の上にかぶさる行の数（列ごと）
  }
  // 役場の段の階段: 版の扉の前に、扉の幅（2〜3マス、1マスの扉なら3マスで真ん中）
  for (const t of P.terraces) {
    if (!t.hall) continue;
    const hp = P.placed.find((p) => p.spec.archetype === 'town_hall');
    if (!hp) { t.drop = true; continue; }
    const dw = variantOf.get(hp)?.doorW ?? 1;
    // 基準の役場の階段は人物の背丈の約1.6倍（約2.6マス）なので3マス: 1マスの扉なら扉が真ん中、2マスの扉なら広場の中心の側へ1マス広げる
    const towardRight = hp.doorCol + 1 <= P.cx + 0.5;
    t.stair = dw >= 3 ? { x: hp.doorCol, w: dw } : dw === 2 ? { x: towardRight ? hp.doorCol : hp.doorCol - 1, w: 3 } : { x: hp.doorCol - 1, w: 3 };
    if (t.stair.x < t.x) t.stair.x = t.x;
    if (t.stair.x + t.stair.w > t.x + t.w) t.stair.x = t.x + t.w - t.stair.w;
  }
  // 広場の南階段: 広場幅に応じた4〜6マス。中央の井戸小屋を置けるよう、中央より1マス西へ寄せる。
  const plazaT = P.terraces.find((t) => t.plaza);
  if (plazaT) {
    const w = clamp(Math.round(plazaT.w / 2), 4, 6);
    const centered = plazaT.x + Math.floor((plazaT.w - w) / 2);
    plazaT.stair = { x: clamp(centered - 1, plazaT.x, plazaT.x + plazaT.w - w), w };
  }
  P.terraces = P.terraces.filter((t) => !t.drop);
  const dock = P.placed.find((p) => p.spec.archetype === 'dock');
  const placedProps = placeProps(P, F, makeRng(seed ^ 0x9e3779b9), spawn, {
    propArt, landmarks, dock, bridgeProps: canal?.bridgeProps || [], mouthProps: canal?.mouthProps || [], bridgeCells: canal?.bridgeCells || [],
    canalCells: canal?.cells || [],
  });
  const placedFacilitySources = new Set(P.placed.map((p) => p.spec.sourceFacility).filter(Boolean));
  const placedLandmarkIds = new Set(placedProps.landmarks.map((l) => l.id));
  const unplaced = [];
  if (canal?.unplaced) unplaced.push(canal.unplaced);
  for (const f of repo.facilities || []) {
    const facilityName = FACILITY_NAME[f.archetype] || LANDMARK[f.archetype]?.name;
    if (!facilityName) continue;
    const landmarkIndex = lms.indexOf(f);
    const landmarkId = landmarkIndex >= 0 ? `f${facSpecs.length + landmarkIndex + 1}` : null;
    const placed = LANDMARK[f.archetype]
      ? landmarkId !== null && placedLandmarkIds.has(landmarkId)
      : placedFacilitySources.has(f);
    if (placed) continue;
    let reason;
    if (LANDMARK[f.archetype]) {
      const prop = LANDMARK[f.archetype].prop;
      if (!propArt[prop]) reason = `小物 ${prop} の絵が manifest にない`;
      else if (f.archetype === 'gate' && !(F.exits || []).length) reason = '門を置ける南北の出口がない';
      else if (f.archetype === 'gate') reason = '出口ごとに門の絵・柱・土道・門番を置ける場所がない';
      else reason = '広場または緑地に井戸小屋と井戸番を置ける場所がない';
    } else if (!art[f.archetype]?.footprint) {
      reason = `施設 ${f.archetype} の絵が manifest にない`;
    } else if (f.archetype === 'dock' && !water) {
      reason = '水辺の地面がない';
    } else {
      reason = '施設を配置できる建物の場所がない';
    }
    unplaced.push({
      archetype: f.archetype,
      name: f.name || facilityName,
      reason,
      evidence: Array.isArray(f.evidence) ? f.evidence.slice(0, 20) : [],
      evidenceCount: f.evidenceCount ?? (f.evidence || []).length,
    });
  }

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
    ...(variantOf.get(p) ? { variant: variantOf.get(p).id } : {}),
    x: p.x - x0, y: p.y - y0, w: p.w, h: p.h,
    // 扉の列は版の絵で決まる（footprint の下の2行は端から端まで歩けるようにしてある）
    door: { x: p.x - x0 + clamp(variantOf.get(p)?.doorX ?? p.spec.doorDx, 0, p.w - 1), y: p.yb - y0 },
    district: p.spec.district,
    module: p.spec.module,
    ...(p.spec.facility ? { facility: p.spec.facility } : {}),
  })).sort((a, b) => cmp(a.id[0], b.id[0]) || Number(a.id.slice(1)) - Number(b.id.slice(1)));

  // 住人: コミットの多い順に最大24人。家は、その人がよく触ったモジュールの建物
  const idOf = new Map();
  for (const b of buildings) {
    if (!b.facility) idOf.set(b.module.path, b.id);
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

  // 常連（街を歩くモブ）: 建物ごとに0〜2人。最近（最新コミットまでの90日）よく手が入る所ほど多い。廃屋には来ない
  const active = buildings.filter((b) => b.module.kind !== 'ruin' && b.module.recent > 0);
  const top = Math.max(1, ...active.map((b) => b.module.recent));
  const slotsC = [];
  for (const b of active) {
    slotsC.push({ b, k: 0 });
    if (b.module.recent / top >= 0.35 && b.module.recent >= 3) slotsC.push({ b, k: 1 });
  }
  slotsC.sort((p, q) => p.k - q.k || q.b.module.recent - p.b.module.recent || cmp(p.b.id, q.b.id));
  const crowd = slotsC.slice(0, CROWD_CAP).sort((p, q) => cmp(p.b.id, q.b.id) || p.k - q.k)
    .map(({ b, k }, i) => ({ id: `c${i + 1}`, home: b.id, look: hash32(`crowd:${b.id}:${k}`) % 16, fact: k }));

  const shift = (o) => ({ ...o, x: o.x - x0, y: o.y - y0 });
  return {
    version: 1,
    repo: { name: repo.name, head: repo.head ?? null, branch: repo.branch ?? null, readme: repo.readme ?? null,
      latestCommitDate: repo.latestCommitDate ?? null, recentDays: RECENT_DAYS },
    tile: 16,
    cols: x1 - x0 + 1,
    rows: y1 - y0 + 1,
    ground,
    ...(canal?.cells?.length ? {
      canal: {
        cells: canal.cells.map(([x, y]) => [x - x0, y - y0]),
        from: canal.from,
        past: canal.past,
        to: canal.to,
        crossings: canal.crossings.map((c) => ({ ...c, x: c.x - x0, y: c.y - y0 })),
      },
    } : {}),
    buildings,
    props: placedProps.props.map(shift).sort((a, b) => a.y - b.y || a.x - b.x || cmp(a.type, b.type)),
    landmarks: placedProps.landmarks.map((l) => ({ ...shift(l), keeper: shift(l.keeper) })),
    ...(unplaced.length ? { unplaced } : {}),
    // 段: 上の面（歩ける）は x..x+w-1 × y..y+h-1、前の壁は y+h 行（階段の所だけ歩ける）
    terraces: P.terraces.map((t) => ({ x: t.x - x0, y: t.y - y0, w: t.w, h: t.h })),
    stairs: P.terraces.map((t) => ({ x: t.stair.x - x0, y: t.y + t.h - y0, w: t.stair.w })),
    residents,
    crowd,
    spawn: { x: spawn.x - x0, y: spawn.y - y0 },
  };
}
