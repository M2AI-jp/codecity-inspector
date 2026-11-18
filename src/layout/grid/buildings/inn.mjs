// 宿屋の候補を入口に近い順で試し、置けない場合の格子再試行と外縁送りを保つ。
export function placeInn(B) {
  const { pending, tracks, cx, seek, commit, fac, px0, px1, scale } = B;
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
  return true;
}
