import { WINDOW } from '../../constants.mjs';
import { arcDistance } from './angles.mjs';

// 地区の角度順を先に決め、同じ寸法を試す回数と下がり方の乱数順を保つ。
export function buildingCandidates(B, tn, phase) {
  const { queues } = B;
  return queues.filter((q) => q[phase].length)
    .map((q) => ({ q, d: arcDistance(tn.theta, q.g) }))
    .sort((a, b) => a.d - b.d || a.q.g.index - b.q.g.index);
}

export function findBuildingPosition(B, t, q, phase) {
  const { rng, fit } = B;
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
  return best;
}
