import { MARGIN, STREET, clamp } from '../constants.mjs';
import { makeRng } from '../util.mjs';

// 格子の大きさと、広場・役場・港を結ぶ通りの骨組み。
export function createFrame(C, scale) {
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
  const roadGroups = { next: 0 };
  const meander = (dir, base, from, to, sw, code, kind, o = {}) => {
    const grp = roadGroups.next++;
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
  return { C, scale, groups, maxH, need, seed, fac, rng, ri, chance, harbour, cols, rows, N, id, inG, cx,
    road, pieces, addPiece, isRoad, pinned, hitsPin, roadGroups, meander, Htop, hMinTop, hMaxBot,
    px0, px1, py0, py1, plaza, plazaM, kx0, kx1, U, VW, VE, hall, aN, AN, aS, dirS, southEnd, AS, dockAt, quay };
}
