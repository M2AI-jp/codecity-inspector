import { WINDOW } from '../../constants.mjs';

// 採用した候補だけを書き込み、次の家が使う面と下がり方を引き継ぐ。
export function writeBuilding(B, t, q, phase, best) {
  const { commit, advance } = B;
  q[phase].splice(best.i, 1);
  commit(best.s, t, best.pos, q.g.key);
  t.last = { sb: Math.min(...t.sd.slice(best.pos.x - t.x0, best.pos.x - t.x0 + best.pos.w)) - 1 - best.pos.yb, w: best.s.w, yb: best.pos.yb };
  advance(t, best.pos);
  B.activeTrack = t;
}

// 置けない面は元と同じ幅だけ進め、端を越えた時点で閉じる。
export function advanceBuildingTrack(B, t) {
  t.cursor += t.dir * WINDOW;
  if (t.dir < 0 ? t.cursor < t.x0 : t.cursor > t.x1) {
    t.closed = true;
    if (B.activeTrack === t) B.activeTrack = null;
  }
}
