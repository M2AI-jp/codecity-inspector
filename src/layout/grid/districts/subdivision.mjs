// 幅と奥行きに応じた再帰の優先順位を一箇所に置き、家並みの形を保つ。
export function prepareDistrictSubdivision(D) {
  const { chance } = D.S;
  const { wmaxOf, cutV, cutHN, cutHS, leaf } = D;
  function bsp(R0, type, closedTop) {
    const R = { ...R0, rx0: R0.x0, rx1: R0.x1 };
    if (R.clipR) R.x1 = Math.min(R.x1, R.clipR(R.y0, R.y1));
    if (R.clipL) R.x0 = Math.max(R.x0, R.clipL(R.y0, R.y1));
    const w = R.x1 - R.x0 + 1, h = R.y1 - R.y0 + 1;
    if (w < 5 || h < 4) return;
    const wmax = wmaxOf(R);
    if (type === 'S') {
      if (w > wmax && chance(0.5) && cutV(R, 'S', closedTop)) return;
      if (h >= 9) cutHS(R);
      return;
    }
    const tall = h > 12;
    if (w > wmax && (!tall || chance(0.6)) && cutV(R, type, closedTop)) return;
    if (tall && cutHN(R, closedTop)) return;
    if (w > wmax && cutV(R, type, closedTop)) return;
    leaf(R, closedTop, 0);
  }
  D.bsp = bsp;
}
