import { DIRT, STREET } from '../../constants.mjs';

// 縦・北向き・南向きの順序を再帰側に委ね、各分割の候補と乱数の順を保つ。
export function prepareDistrictCuts(D) {
  const { hitsPin, chance, rng, meander } = D.S;
  const { alignedV, alignedH, sub, crossSpan, reachDiag } = D;
  const cutV = (R, type, closedTop) => {
    const w = R.x1 - R.x0 + 1, h = R.y1 - R.y0 + 1;
    const sw = h > 18 ? (chance(0.75) ? 2 : 1) : (chance(0.55) ? 2 : 1);
    const minW = 10;
    const cands = [];
    for (let x = R.x0 + minW; x + sw - 1 <= R.x1 - minW; x++) cands.push([Math.abs(x - (R.x0 + R.x1) / 2) + rng() * w * 0.35, x]);
    cands.sort((a, b) => a[0] - b[0]);
    for (let pass = 0; pass < 2; pass++) {
      for (const [, x] of cands) {
        if (hitsPin(x - 1, R.y0, x + sw, R.y1)) continue;
        if (pass === 0 && alignedV(x, x + sw - 1, R.y0, R.y1)) continue;
        // 南北の通りも、7〜12 マスごとに1列ずれる
        const st = meander('v', x, R.y0, R.y1, sw, sw === 2 ? STREET : DIRT, sw === 2 ? 'street' : 'alley', { ok: (y, v) => x + v >= R.x0 + minW - 1 && x + v + sw - 1 <= R.x1 - minW + 1 });
        // 斜めの通りに触れるのは片側の子だけ（もう片側は切った通りで止まる）
        D.bsp({ ...sub(R, R.x0, st.min - 1, R.y0, R.y1), clipR: undefined, diagR: undefined }, type, closedTop);
        D.bsp({ ...sub(R, st.max + sw, R.x1, R.y0, R.y1), clipL: undefined, diagL: undefined }, type, closedTop);
        return true;
      }
    }
    return false;
  };
  // 7〜8行の短い街区を大量に作ると、建物が別々の面へ散る。
  const DEPTHS = [15, 18, 21, 24, 27, 30, 33];
  // 北向きの地区（下の端が通り）: 下から街区をひとつ切り取り、残りを上へ。切る通りは上へだけずれる（下の街区の深さを保つ）
  const cutHN = (R, closedTop) => {
    const h = R.y1 - R.y0 + 1, w = R.x1 - R.x0 + 1;
    const sw = w > 26 ? 2 : (chance(0.75) ? 2 : 1);
    let opts = DEPTHS.map((d) => [d, rng()]).sort((a, b) => a[1] - b[1]).map(([d]) => d);
    // 役場・船着場のある街区は浅く（予約のせいで路地も中庭も入らず、上が空き地になるのを避ける）
    if (hitsPin(R.x0, R.y1 - 17, R.x1, R.y1)) opts = [...new Set(DEPTHS)].sort((a, b) => a - b);
    for (let pass = 0; pass < 2; pass++) {
      for (const d of opts) {
        const rem = h - d - sw - 1;
        if (rem < 7 || (closedTop && rem > 10 && rem < 15)) continue;
        const s = R.y1 - d - sw + 1;
        if (hitsPin(R.x0, s - 1, R.x1, s + sw)) continue;
        if (pass === 0 && alignedH(s, s + sw - 1, R.x0, R.x1)) continue;
        const [xs0, xs1] = crossSpan(R, s, sw), code = sw === 2 ? STREET : DIRT, kind = sw === 2 ? 'street' : 'lane';
        const st = meander('h', s, xs0, xs1, sw, code, kind, { lo: -1, hi: 0 });
        reachDiag(R, st, xs0, xs1, code, kind);
        D.bsp(sub(R, R.rx0, R.rx1, st.max + sw, R.y1), 'N', true);
        D.bsp(sub(R, R.rx0, R.rx1, R.y0, st.min - 1), 'N', closedTop);
        return true;
      }
    }
    return false;
  };
  // 南向きの地区（上の端が通り、下は開いている）: 上から街区をひとつ切り取り、その下に通り（下へだけずれる）
  const cutHS = (R) => {
    const h = R.y1 - R.y0 + 1, w = R.x1 - R.x0 + 1;
    const sw = w > 26 ? 2 : (chance(0.75) ? 2 : 1);
    const opts = DEPTHS.map((d) => [d, rng()]).sort((a, b) => a[1] - b[1]).map(([d]) => d);
    for (let pass = 0; pass < 2; pass++) {
      for (const d of opts) {
        if (d + sw + 1 > h) continue;
        const s = R.y0 + d;
        if (hitsPin(R.x0, s - 1, R.x1, s + sw + 1)) continue;
        if (pass === 0 && alignedH(s, s + sw - 1, R.x0, R.x1)) continue;
        const [xs0, xs1] = crossSpan(R, s, sw), code = sw === 2 ? STREET : DIRT, kind = sw === 2 ? 'street' : 'lane';
        const st = meander('h', s, xs0, xs1, sw, code, kind, { lo: 0, hi: 1 });
        reachDiag(R, st, xs0, xs1, code, kind);
        D.bsp(sub(R, R.rx0, R.rx1, R.y0, st.min - 1), 'N', true);
        if (R.y1 - (st.max + sw - 1) >= 9) D.bsp(sub(R, R.rx0, R.rx1, st.max + sw, R.y1), 'S', true);
        return true;
      }
    }
    return false;
  };
  Object.assign(D, { cutV, cutHN, cutHS });
}
