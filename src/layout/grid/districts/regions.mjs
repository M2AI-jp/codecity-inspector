import { clamp } from '../../constants.mjs';

// 広場の両わきを先に残し、北から南へ同じ順で再帰分割へ渡す。
export function addFlankDistricts(D) {
  const { kx0, kx1, px0, px1, py0, hMinTop } = D.S;
  const { leaves } = D;
  // 広場の両わきの街区（大通りに面する）
  const flankW = { x0: kx0, x1: px0 - 1, y0: py0 + 2, y1: hMinTop(kx0, px0 - 1) - 1, closedTop: true, flank: -1 };
  const flankE = { x0: px1 + 1, x1: kx1, y0: py0 + 2, y1: hMinTop(px1 + 1, kx1) - 1, closedTop: true, flank: 1 };
  leaves.push(flankW, flankE);
  Object.assign(D, { flankW, flankE });
}

export function divideNorthernDistricts(D) {
  const { kx0, kx1, py0, hMinTop, VW, VE, AN, cols } = D.S;
  const { bsp } = D;
  // 北: 西の地区・広場の北（北へ向かう通りの両側）・東の地区
  bsp({ x0: 1, x1: VW.min - 1, y0: 1, y1: hMinTop(1, VW.min - 1) - 1 }, 'N', false);
  bsp({ x0: kx0, x1: AN.min - 1, y0: 1, y1: py0 - 1 }, 'N', false);
  bsp({ x0: AN.max + 2, x1: kx1, y0: 1, y1: py0 - 1 }, 'N', false);
  bsp({ x0: VE.max + 2, x1: cols - 2, y0: 1, y1: hMinTop(VE.max + 2, cols - 2) - 1 }, 'N', false);
}

export function divideSouthernDistricts(D) {
  const { Htop, aS, southEnd, AS, cols, rows, harbour, hMaxBot, quay } = D.S;
  const { bsp } = D;
  // 南: 斜めの通りの両側。地区は行ごとに斜めの通りの手前まで
  const ys0 = Htop[aS], clipY = (y) => clamp(y, ys0, southEnd);
  const SWr = { x0: 1, x1: cols - 2, clipR: (a, b) => { let m = 1e9; for (let y = a; y <= b; y++) m = Math.min(m, AS.at(clipY(y)) - 1); return m; }, diagR: (y) => AS.at(clipY(y)) };
  const SEr = { x0: 1, x1: cols - 2, clipL: (a, b) => { let m = -1e9; for (let y = a; y <= b; y++) m = Math.max(m, AS.at(clipY(y)) + 2); return m; }, diagL: (y) => AS.at(clipY(y)) + 1 };
  if (harbour) {
    bsp({ ...SWr, y0: hMaxBot(1, AS.min - 1) + 1, y1: quay.top - 1 }, 'N', true);
    bsp({ ...SEr, y0: hMaxBot(AS.max + 2, cols - 2) + 1, y1: quay.top - 1 }, 'N', true);
  } else {
    bsp({ ...SWr, y0: hMaxBot(1, AS.min - 1) + 1, y1: rows - 2 }, 'S', true);
    bsp({ ...SEr, y0: hMaxBot(AS.max + 2, cols - 2) + 1, y1: rows - 2 }, 'S', true);
  }
}
