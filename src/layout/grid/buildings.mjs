import { WINDOW } from '../constants.mjs';
import { placeGroups } from './groups.mjs';

function arcDistance(theta, g) {
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const t = norm(theta - g.a0);
  if (t <= g.a1 - g.a0) return 0;
  return Math.min(t - (g.a1 - g.a0), 2 * Math.PI - t);
}
const arc = (a, b) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);

export function placeBuildings(S) {
  if (!placeOrdinaryBuildings(S)) return null;
  placeGroups(S);
  return true;
}

function placeOrdinaryBuildings(S) {
  const { queues, pending, tracks, nominal, seek, commit, advance, cx, fac, px0, px1, scale, denseTracks, trackAffinity, rng, fit } = S;
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
      // 岸の家並みと役場のない広場の北辺を先に確保する。それ以外は
      // 長い面も含めて近さを比較し、遠い北の列だけを先に埋めない。
      const dense = denseTracks.find((c) => (c.harbour || c.plaza) && !c.closed && !c.innOnly);
      if (dense) {
        t = dense;
        tn = nominal(t);
      }
      for (const c of tracks) {
        if (dense) break;
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
          let pos = fit(t, x0, s, setback, !!t.dense);
          if (pos) {
            // 同じ近さなら、直前の家と幅か下がり方が違うほう
            const same = last && last.w === s.w && last.yb === pos.yb;
            if (!best || k < best.k || (k === best.k && best.same && !same)) best = { i, s, pos, k, same };
          } else if (last) {
            // 交互の下がり方がこの列に入らない場合だけ、同じ下がり方を
            // 最後の手段として記録する。これで施設や細い街区を失わず、
            // 入る家並みでは 0/1 のばらつきを優先できる。
            pos = fit(t, x0, s, 1 - setback, !!t.dense);
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
  return true;
}
