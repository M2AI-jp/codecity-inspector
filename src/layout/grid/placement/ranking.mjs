import { Y_WEIGHT, clamp } from '../../constants.mjs';
import { moduleGroup } from '../../../group-components.mjs';

// 面の優先順位: 広場からの距離と既存建物への近さを同じ順序で測る。
export function preparePlacementRanking(P) {
  const { rng, pcy, pcx, placed } = P;
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
  const trackAffinity = (t, group) => {
    let best = 1e9;
    for (const p of placed) {
      if (group !== undefined && moduleGroup(p.spec.module) !== group) continue;
      const px0 = p.x, px1 = p.x + p.w - 1, py0 = p.y, py1 = p.yb;
      const dx = px1 < t.L.x0 ? t.L.x0 - px1 : t.L.x1 < px0 ? px0 - t.L.x1 : 0;
      const dy = py1 < t.L.y0 ? t.L.y0 - py1 : t.L.y1 < py0 ? py0 - t.L.y1 : 0;
      best = Math.min(best, dx + dy);
    }
    return best === 1e9 ? 0 : best;
  };
  Object.assign(P, { nominal, trackAffinity });
}
