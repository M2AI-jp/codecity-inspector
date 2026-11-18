import { WINDOW } from '../../constants.mjs';
import { arc } from './angles.mjs';

// 外縁施設の探索と面の前進をまとめ、成功・再試行の判定を呼び出し側へ返す。
export function placeOuterFacility(B) {
  const { pending, tracks, nominal, seek, commit, advance } = B;
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
    if (compactDone) return true;
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
  if (pos) { commit(s, t, pos, `\u0000${s.archetype}`); advance(t, pos); pending.late.shift(); return true; }
  t.cursor += t.dir * WINDOW;
  if (t.dir < 0 ? t.cursor < t.x0 : t.cursor > t.x1) t.closed = true;
  return true;
}
