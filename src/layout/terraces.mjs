import { OUT, WATER, STREET, DIRT, PLAZA } from './constants.mjs';
import { stairClearance } from '../stair-clearance.mjs';

// 緑地は格子を作る時点の候補。道路整理・切り出し・水路の後にも、
// 上面と階段の前後が残り、広場から上れる場合だけ段にする。
export function keepReachableTerraces(P, F, spawn, bridgeCells = []) {
  const { id, cols, N, foot } = P, { g, crop } = F;
  const inC = (x, y) => x >= crop.x0 && x <= crop.x1 && y >= crop.y0 && y <= crop.y1;
  const dry = (x, y) => inC(x, y) && ![OUT, WATER].includes(g[id(x, y)]) && foot[id(x, y)] < 0;
  P.terraces = P.terraces.filter((t) => {
    if (!t.green) return true;
    if (!inC(t.x, t.y) || !inC(t.x + t.w - 1, t.y + t.h)) return false;
    const s = { ...t.stair, y: t.y + t.h }, r = stairClearance(s);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (!dry(x, y)) return false;
    }
    // 「すぐ下に通り」の条件も、間引く前の road ではなく最終地面で確かめる。
    for (let x = s.x; x < s.x + s.w; x++) {
      if (![STREET, DIRT, PLAZA].includes(g[id(x, s.y + 1)])) return false;
    }
    return true;
  });
  // 段の壁ができて初めて分断される緑地もある。小物配置が到達不能な
  // 草地を OUT にする前に段を取り下げ、元の平らな緑地として残す。
  const decks = new Set(bridgeCells.map(([x, y]) => id(x, y)));
  const flood = () => {
    const blocked = new Uint8Array(N);
    for (const t of P.terraces) for (let x = t.x; x < t.x + t.w; x++) {
      if (x < t.stair.x || x >= t.stair.x + t.stair.w) blocked[id(x, t.y + t.h)] = 1;
    }
    const seen = new Uint8Array(N), q = [id(spawn.x, spawn.y)];
    seen[q[0]] = 1;
    for (let i = 0; i < q.length; i++) {
      const x = q[i] % cols, y = Math.floor(q[i] / cols);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (!inC(nx, ny)) continue;
        const k = id(nx, ny);
        if (!(dry(nx, ny) || (decks.has(k) && foot[k] < 0))) continue;
        if (!seen[k] && !blocked[k]) { seen[k] = 1; q.push(k); }
      }
    }
    return seen;
  };
  let seen = flood();
  P.terraces = P.terraces.filter((t) => !t.green ||
    Array.from({ length: t.stair.w }, (_, dx) => t.stair.x + dx).every((x) =>
      [-2, -1, 0, 1, 2].every((dy) => seen[id(x, t.y + t.h + dy)])));
  seen = flood();
  // 広場の壁と隣家に挟まれ、建物直下の歩行行が孤立する候補も採用しない。
  return P.placed.filter((p) =>
    Array.from({ length: p.w }, (_, dx) => id(p.x + dx, p.yb + 1)).some((k) => !seen[k]));
}
