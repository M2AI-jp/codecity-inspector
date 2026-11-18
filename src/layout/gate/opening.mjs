import { PLAZA, WATER } from '../constants.mjs';

// 開口を準備する。絵の定義から幅を決め、宿屋に近い出口の優先順を保つ。
export function prepareOpening(S) {
  const { lm, ctx } = S;
  const { propArt, placed, exits, inC, foot, g, id } = ctx;
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
  Object.assign(S, { a, solids, op, n, ox, oy, iw, exitDefs, paveable });
  return true;
}
