import { STREET } from '../../constants.mjs';

// 南北の通り: 役場を予約して北へ抜け、南の通りを港か外縁へつなぐ。
export function drawAvenues(F) {
  const { fac, cx, py0, pinned, ri, rng, meander, harbour, hTop, southRows, rows, Htop, margin, cols } = F;
  // 役場: 広場の北の真ん中、北の通りに面して。北へ向かう通りは役場の脇を通り、役場の上からは曲がって北へ
  let hall = null, aN;
  if (fac.hall) {
    const hx = cx - Math.floor(fac.hall.w / 2), yb = py0 - 1;
    hall = { x: hx, y: yb - fac.hall.h + 1, w: fac.hall.w, h: fac.hall.h, yb };
    // 役場自身を守る予約にとどめ、左右の建物が壁まで寄れるようにする。
    pinned.push([hx, hall.y - 2, hx + fac.hall.w - 1, yb]);
    // 北へ抜ける通りは役場のすぐ横ではなく、隣家のさらに外側を通す。
    // 役場の左右を建物で埋めても、通りがその footprint を横切らないようにする。
    aN = fac.hallSide > 0 ? hx + fac.hall.w + 7 + ri(0, 1) : hx - 8 - ri(0, 1);
  } else aN = cx + (rng() < 0.5 ? -1 : 1) * ri(3, 6);
  const AN = meander('v', aN, py0 - 1, 1, 2, STREET, 'avenue', { flatN: hall ? py0 - hall.y + 3 : 4, jogAfterFlat: true });
  // 南へ向かう通りは、広場の南から街の端へ段々に斜めに下る（北の通りと位置もずらす）
  let aS = cx + (rng() < 0.5 ? -1 : 1) * ri(2, 6);
  if (Math.abs(aS - aN) < 3) aS = aN + (aN < cx ? 4 : -4);
  const dirS = aS < cx ? -1 : 1;
  const southEnd = harbour ? hTop + 3 + southRows - 1 : rows - 2;
  const AS = meander('v', aS, Htop[aS], southEnd, 2, STREET, 'avenue', { stair: dirS, flatN: 3, ok: (y, v) => aS + v >= margin + 6 && aS + v <= cols - margin - 8 });
  Object.assign(F, { hall, aN, AN, aS, dirS, southEnd, AS });
}
