// 配置を記録する。到達数・小物・予約・木の余白・灯の更新順を保つ。
export function writeGate(S, C, keeper) {
  const { lm, a, n, ctx } = S;
  const { inC, id, reserved, flood, props, noTree, lamps, mark, state } = ctx;
  const { e, trail, r, out1, c0, fx, fy, vx0, vx1, vy0, paint } = C;
  state.reach = flood().count;
  const prop = { type: lm.prop, x: fx / 16, y: fy / 16 };
  props.push(prop);
  // 門の道（門の手前と先の2行まで）は小物でふさがない。門のまわり1マスには木を植えない
  for (const [x, y] of paint) reserved[id(x, y)] = 1;
  for (let x = c0; x < c0 + n; x++) for (const y of [out1 + e.dir, r - 3 * e.dir]) if (inC(x, y)) reserved[id(x, y)] = 1;
  // 木の樹冠（足元から上へ4行・左右2マス）が門と門の前の1行にかからない
  mark(noTree, vx0 - 2, vy0 - 1, vx1 + 2, r + 4);
  // 通りから門までと門の先の数行の土の道にも、木の樹冠がかからない
  for (const [y, x] of trail) if ((y - e.end) * e.dir > 0 && (y - out1) * e.dir <= 4) mark(noTree, x - 2, y, x + 2, y + 3);
  for (const [x, y] of paint) mark(noTree, x - 1, y, x + 1, y + 3);
  mark(reserved, vx0 - 1, r - 1, vx1 + 1, r + 1);
  const kx = Math.floor(keeper.x), ky = Math.floor(keeper.y);
  mark(reserved, kx - 1, ky - 1, kx + 1, ky + 1);
  mark(noTree, kx - 1, ky - 1, kx + 1, ky + 1);
  // 門の灯: ほかの街灯はここから離して立てる
  for (const l of a.lights || []) lamps.push([Math.floor((fx + l[0]) / 16), Math.floor((fy + Math.max(l[1], -8)) / 16)]);
  return { prop, keeper };
}

// 外縁候補の予約は、出口候補とは異なる元の範囲を使う。
export function writeEdgeGate(S, C, keeper) {
  const { lm, a, n, ctx } = S;
  const { id, reserved, flood, props, noTree, lamps, mark, state } = ctx;
  const { c0, r, fx, fy, paint } = C;
  const prop = { type: lm.prop, x: fx / 16, y: fy / 16 };
  state.reach = flood().count;
  props.push(prop);
  for (const [x, y] of paint) reserved[id(x, y)] = 1;
  mark(reserved, c0 - 1, r - 1, c0 + n, r + 1);
  mark(noTree, c0 - 2, r - 2, c0 + n + 1, r + 4);
  mark(reserved, Math.floor(keeper.x) - 1, Math.floor(keeper.y) - 1, Math.floor(keeper.x) + 1, Math.floor(keeper.y) + 1);
  for (const l of a.lights || []) lamps.push([Math.floor((fx + l[0]) / 16), Math.floor((fy + Math.max(l[1], -8)) / 16)]);
  return { prop, keeper };
}
