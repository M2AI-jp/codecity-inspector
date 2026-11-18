import { STREET } from '../../constants.mjs';

// 岸: 南の通りの終点から船着場を予約し、最後に連続した岸の通りを加える。
export function drawWaterfront(F) {
  const { AS, southEnd, harbour, fac, dirS, ri, hTop, southRows, pinned, addPiece, cols, pieces } = F;
  const aSq = AS.at(southEnd);
  // 船着場: 岸の通りに面して、斜めの通りの下の端の脇（斜めが来る側の反対）
  let dockAt = null;
  if (harbour) {
    const d = fac.dock, side = dirS;
    const x = side < 0 ? aSq - 2 - d.w - ri(0, 3) : aSq + 3 + ri(0, 3);
    const yb = hTop + 3 + southRows - 1;
    dockAt = { x, y: yb - d.h + 1, w: d.w, h: d.h, yb };
    pinned.push([x - 1, dockAt.y - 2, x + d.w, yb]);
  }
  // 水辺: 岸の通り（街の幅いっぱいの、途切れない直線。使わない所は消える）
  let quay = null;
  if (harbour) {
    const qTop = hTop + 3 + southRows;
    const qk = addPiece('h', 1, qTop, cols - 2, qTop + 1, STREET, 'quay');
    const qt = new Int16Array(cols).fill(qTop);
    quay = {
      top: qTop, bottom: qTop + 1, qt,
      water0: qTop + 2, water1: qTop + 1 + harbour.water,
      grps: qk >= 0 ? [pieces[qk].grp] : [],
    };
  }
  Object.assign(F, { dockAt, quay });
}
