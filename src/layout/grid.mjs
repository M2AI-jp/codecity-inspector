import { DIRT, GRASS, MARGIN, OUT, PLAZA, STREET, WATER, WINDOW, Y_WEIGHT, clamp } from './constants.mjs';
import { hash32, makeRng } from './util.mjs';

function arcDistance(theta, g) {
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const t = norm(theta - g.a0);
  if (t <= g.a1 - g.a0) return 0;
  return Math.min(t - (g.a1 - g.a0), 2 * Math.PI - t);
}
const arc = (a, b) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);


// ---------- 通りを引き、建物を置く（大きめの仮想の格子の上で） ----------
export function generate(C, scale) {
  const { groups, maxH, need, seed, fac } = C;
  const rng = makeRng(seed);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const chance = (p) => rng() < p;
  const harbour = fac.dock ? C.harbour : null;
  // 建物の数に対して仮想格子を広げすぎない。面を順に埋めるので、
  // 旧来の大きな余白（2.4係数・固定1200）を残すと通りだけが増える。
  const harbourArea = harbour ? (C.count > 40 ? 0.16 : 0.15) : 0.22;
  const area = Math.max(140, need * (maxH + 8) * harbourArea + 100) * scale;
  const margin = C.count <= 10 ? 4 : MARGIN;
  // 面積は保ったまま横長を抑え、建物を近い列へ積める格子にする。
  const cols = Math.round(Math.sqrt(area)) + 2 * margin - (harbour ? 0 : 1);
  // 広場を深くした分だけ縦の格子を先に確保する。後段の scale を上げて
  // 街全体を拡大すると空いた街区まで増えるため、追加分は行だけにする。
  const PR = Math.max(7, maxH + 2) + (chance(0.35) ? 1 : 0);
  const shallowPR = Math.max(4, maxH - 1);
  // 北南の門の絵は footprint より約6行高い。港以外では外縁の3行を
  // 門の候補に残す（届かない草地は finalize が街の外にする）。
  const baseRows = Math.round(Math.sqrt(area)) + 2 * margin + maxH + 4 + Math.max(0, PR - shallowPR);
  let rows = baseRows + (C.gateRows && !harbour ? 5 : 0);
  // 本線と同じ深さの広場にする。役場の段の下から南の段の壁まで歩ける面を
  // 9行前後に保ち、井戸小屋を広場の中央へ戻せる奥行きを確保する。
  const PW = fac.hall ? 12 : 10 + 2 * ri(0, 1);                       // 広場の幅（小さく、まわりを建物の正面が囲む）
  // 水辺: 大通りの南は街区 1〜3 段、その下に岸の通りと水。北へ広げる分、格子を縦に足す
  let southRows = 0, hTop;
  if (harbour) {
    const n = C.count;
    // 船着場までの南側は2〜3段の街区に収める。旧来の17〜19行は
    // 建物のない芝生と長い通りを水際まで残していたので、港の街を縦に引き延ばす。
    southRows = n <= 22 ? ri(8, 9) : n <= 70 ? ri(11, 13) : ri(22, 24);
    // 港までの水深は quay.water が確保する。余分な倍率で南北の芝生を
    // 増やすと、建物を詰めても街の内側だけが広がってしまうため、
    // 岸の通りと水面を含む最小限の余白にとどめる。
    rows = Math.round(rows * 1.1);
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
  const AS = meander('v', aS, Htop[aS], southEnd, 2, STREET, 'avenue', { stair: dirS, flatN: 3, ok: (y, v) => aS + v >= margin + 6 && aS + v <= cols - margin - 8 });
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
      if (harbour && yb >= quay.top) return false;
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
    const rowStep = C.count <= 10 ? Math.max(5, maxH) : Math.max(6, maxH + 1);
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
    if (harbour && yb >= quay.top) return null;
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
      let fallback = null;
      const last = t.last;
      for (let i = 0; i < q[phase].length; i++) {
        const s = q[phase][i];
        if (tried.has(s.w * 64 + s.h)) continue;
        tried.add(s.w * 64 + s.h);
        // 建物を上の通り側へ寄せる: 前の行は0〜1行だけにし、
        // 直前の建物とは下がり方を変える。下がり方を fit の途中で
        // 0へ戻すと一直線の家並みになるので、まず選んだ値だけを試す。
        const sr = rng();
        let setback = sr < 0.5 ? 0 : 1;
        if (last && setback === last.sb) setback = 1 - last.sb;
        for (let k = 0; k <= WINDOW && (!best || k <= best.k); k++) {
          const x0 = t.dir < 0 ? t.cursor - k - s.w + 1 : t.cursor + k;
          if (t.dir < 0 ? x0 < t.x0 : x0 + s.w - 1 > t.x1) break;
          let pos = fit(t, x0, s.w, s.h, setback, s.roofRows, !!t.dense);
          if (pos) {
            // 同じ近さなら、直前の家と幅か下がり方が違うほう
            const same = last && last.w === s.w && last.yb === pos.yb;
            if (!best || k < best.k || (k === best.k && best.same && !same)) best = { i, s, pos, k, same };
          } else if (last) {
            // 交互の下がり方がこの列に入らない場合だけ、同じ下がり方を
            // 最後の手段として記録する。これで施設や細い街区を失わず、
            // 入る家並みでは 0/1 のばらつきを優先できる。
            pos = fit(t, x0, s.w, s.h, 1 - setback, s.roofRows, !!t.dense);
            if (pos) {
              const same = last.w === s.w && last.yb === pos.yb;
              if (!fallback || k < fallback.k || (k === fallback.k && fallback.same && !same)) fallback = { i, s, pos, k, same };
            }
          }
        }
        if (best && best.k === 0 && !best.same) break;
      }
      if (!best) best = fallback;
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
