import { DIRT, OUT, PLAZA, STREET, WATER } from '../constants.mjs';
import { placeGate } from '../gate.mjs';

export function placeBoundaryProps(S) {
  const { P, F, inC, id, foot, blocked, doorRow, g, tryProp, landmarks, propArt, placed, roofZ, crop, reserved, flood, walk, props, noTree, lamps, mark, out } = S;
  // 段の東西の端は縁石: 外側の歩ける草地・広場は柵・茂み・プランターでふさぐ（通り・路地は同じ高さで段につながってよい）
  for (const t of P.terraces) for (const side of [-1, 1]) {
    const x = side < 0 ? t.x - 1 : t.x + t.w;
    for (let y = t.y; y < t.y + t.h; y++) {
      if (!inC(x, y)) continue;
      const k = id(x, y);
      if (foot[k] >= 0 || blocked[k] || doorRow[k] || g[k] === STREET || g[k] === DIRT || g[k] === OUT || g[k] === WATER) continue;
      tryProp(g[k] === PLAZA ? 'planter' : y === t.y + t.h - 1 ? 'bush' : 'fence', x, y, true);
    }
  }

  // 門（外から人が入る入口）: 南北の通りが街の外へ出る所（宿屋に近い方から）に、通りをまたいで南向きに立てる。
  // 柱（solids）はふさぎ、くぐれる所（opening、3マス）は歩ける。通りの端から門の先の1行までは門の幅の土の道にする。
  // 門番は街の内側の柱のわき（通りの外）に立つ。門のまわり1マスには木を植えない。街灯は門の灯から離す
  for (const lm of landmarks.filter((l) => l.data.archetype === 'gate')) {
    const gateState = { reach: S.reach };
    const got = placeGate(lm, {
      propArt, placed, exits: F.exits || [], inC, foot, roofZ, g, crop, id, blocked, reserved, flood,
      walk, props, noTree, lamps, mark, state: gateState,
    });
    if (got) {
      S.reach = gateState.reach;
      out.landmarks.push({ ...lm.data, x: got.prop.x, y: got.prop.y, keeper: got.keeper });
    }
  }
}
