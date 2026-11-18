import { hash32 } from '../../util.mjs';

// 境界判定と出力配列を共有し、再帰の途中でも同じ通りの追加を参照する。
export function createDistrictContext(S) {
  const { seed, pieces, addPiece } = S;
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
  return { S, leaves, courts, alignedV, alignedH, wmaxOf, sub, reachDiag, crossSpan };
}
