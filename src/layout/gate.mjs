import { DIRT, GRASS, OUT, PLAZA, STREET, WATER } from './constants.mjs';
import { propTiles } from './manifest.mjs';
import { hash32 } from './util.mjs';

export function placeGate(lm, ctx) {
    const { propArt, placed, exits, inC, foot, roofZ, g, crop, id, blocked, reserved, flood, walk, props, noTree, lamps, mark, state } = ctx;
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
    const exitDefs = [...(exits || [])].sort((p, q) => {
      if (!inn) return p.dir - q.dir;                   // 宿屋が無ければ北の出口から
      const d = (e) => Math.abs((inn.doorCol ?? inn.x) - e.x) + 1.2 * Math.abs(inn.yb - e.end);
      return d(p) - d(q) || p.dir - q.dir;
    });
    const paveable = (x, y) => inC(x, y) && foot[id(x, y)] < 0 && g[id(x, y)] !== WATER && g[id(x, y)] !== PLAZA;
    for (const e of exitDefs) {
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
          // 門の外は建物・広場が無い所。密な街では出口の土道が石畳の
          // 端へつながることがあるので、石畳そのものは通過可能な外側
          // の道として許し、建物と広場だけを候補から除く。
          const yEnd = e.dir < 0 ? crop.y0 : crop.y1;
          // compact な街では隣家や別の縦道が絵の端に来る。門の絵の幅だけを
          // 外へ空ければよく、周囲の余白まで要求すると門候補を失う。
          for (let y = out1; ok && (y - yEnd) * e.dir <= 0; y += e.dir) for (let x = vx0; x <= vx1; x++) {
            if (!inC(x, y)) continue;
            const k2 = id(x, y);
            if (foot[k2] >= 0 || g[k2] === PLAZA) { ok = false; break; }
          }
          if (!ok) continue;
          // 柱は草地・街の外・土道の上。石畳の端にしか候補が残らない
          // 密な街では、石畳にも置ける（歩行到達性は下で再確認する）。
          for (const [x, y] of pillar) if (!inC(x, y) || foot[id(x, y)] >= 0 ||
            (g[id(x, y)] !== GRASS && g[id(x, y)] !== OUT && g[id(x, y)] !== STREET && !(g[id(x, y)] === DIRT && x === pathCol(e, y))) ||
            blocked[id(x, y)] || reserved[id(x, y)]) ok = false;
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
          state.reach = flood().count;
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
    // 密な格子では、出口の通りの周囲を建物の前庭が埋めて通常候補が
    // 全滅することがある。空いた草地の端に土道を通してから同じ門の
    // 開口・柱・番人の到達性を検査する最後の候補を持つ。
    const edgeRows = [];
    for (let r = crop.y0 + 2; r <= crop.y1 - 2; r++) edgeRows.push(r);
    edgeRows.sort((u, v) => Math.min(u - crop.y0, crop.y1 - u) - Math.min(v - crop.y0, crop.y1 - v) || u - v);
    for (const r of edgeRows) for (let c0 = crop.x0 + 2; c0 <= crop.x1 - n - 3; c0++) {
      const fx = c0 * 16 - op[0], fy = (r + 1) * 16;
      const opCols = new Set(Array.from({ length: n }, (_, i) => c0 + i));
      const pillar = [];
      for (const sb of solids) {
        const tx0 = Math.floor((fx + sb[0]) / 16), tx1 = Math.floor((fx + sb[0] + sb[2] - 1) / 16);
        const ty0 = Math.floor((fy + sb[1]) / 16), ty1 = Math.floor((fy + sb[1] + sb[3] - 1) / 16);
        for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++)
          if (!opCols.has(x) && !pillar.some(([px, py]) => px === x && py === y)) pillar.push([x, y]);
      }
      const paint = [];
      for (let y = r - 1; y <= r + 1; y++) for (let x = c0; x < c0 + n; x++) paint.push([x, y]);
      if (!pillar.length || pillar.some(([x, y]) => !inC(x, y) || foot[id(x, y)] >= 0 || blocked[id(x, y)] || reserved[id(x, y)] ||
        ![GRASS, STREET, DIRT].includes(g[id(x, y)])) || paint.some(([x, y]) => !inC(x, y) || foot[id(x, y)] >= 0 || g[id(x, y)] === WATER)) continue;
      const saved = paint.map(([x, y]) => g[id(x, y)]);
      paint.forEach(([x, y]) => { if (g[id(x, y)] === GRASS) g[id(x, y)] = DIRT; });
      pillar.forEach(([x, y]) => { g[id(x, y)] = GRASS; blocked[id(x, y)] = 1; });
      const before = flood().count;
      let keeper = null;
      for (const [kx, ky] of [[c0 - 1, r + 1], [c0 + n, r + 1], [c0 - 1, r - 1], [c0 + n, r - 1]]) {
        if (!walk(kx, ky) || reserved[id(kx, ky)] || paint.some(([x, y]) => x === kx && y === ky)) continue;
        blocked[id(kx, ky)] = 1;
        if (flood().count === before - 1) { keeper = { x: kx + 0.5, y: ky + 0.6875 }; break; }
        blocked[id(kx, ky)] = 0;
      }
      if (!keeper) {
        for (const [x, y] of pillar) blocked[id(x, y)] = 0;
        for (const [[x, y], old] of paint.map((p, i) => [p, saved[i]])) g[id(x, y)] = old;
        continue;
      }
      const prop = { type: lm.prop, x: fx / 16, y: fy / 16 };
      state.reach = flood().count;
      props.push(prop);
      for (const [x, y] of paint) reserved[id(x, y)] = 1;
      mark(reserved, c0 - 1, r - 1, c0 + n, r + 1);
      mark(noTree, c0 - 2, r - 2, c0 + n + 1, r + 4);
      mark(reserved, Math.floor(keeper.x) - 1, Math.floor(keeper.y) - 1, Math.floor(keeper.x) + 1, Math.floor(keeper.y) + 1);
      for (const l of a.lights || []) lamps.push([Math.floor((fx + l[0]) / 16), Math.floor((fy + Math.max(l[1], -8)) / 16)]);
      return { prop, keeper };
    }
    return null;
  }
