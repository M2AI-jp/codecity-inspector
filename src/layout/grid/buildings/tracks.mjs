// 直前の家並みを続け、面が閉じたときだけ密度と近さで次の面を選ぶ。
export function selectBuildingTrack(B) {
  const { activeTrack, nominal, denseTracks, tracks, trackAffinity } = B;
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
  return { t, tn };
}
