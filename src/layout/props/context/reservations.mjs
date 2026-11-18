import { DIRT, PLAZA, STREET } from '../../constants.mjs';
import { propTiles } from '../../manifest.mjs';
import { stairClearance } from '../../../stair-clearance.mjs';
// 戸口・橋・水路口・階段を先に予約し、小物が通路や目印を隠さないようにする。
export function reservePropSpace(C) {
  const { P, N, id, front, placed, spawn, bridgeCells, mouthProps, propArt, g, inC, reserved, blocked } = C;
  // footprint のすぐ下の2行（扉の位置は絵で決まるので幅いっぱい）と前庭、開始位置のまわりは空ける
  const doorRow = new Uint8Array(N);                       // 建物の扉の前の2行（どんな小物でもふさがない）
  for (const p of placed) for (let x = p.x; x < p.x + p.w; x++) for (let y = p.yb + 1; y <= p.yb + 2; y++) { reserved[id(x, y)] = 1; doorRow[id(x, y)] = 1; }
  for (const [x, y] of bridgeCells) if (inC(x, y)) reserved[id(x, y)] = 1;
  for (let t = 0; t < N; t++) if (front[t]) reserved[t] = 1;
  for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) reserved[id(spawn.x + dx, spawn.y + dy)] = 1;
  // 施設の扉の前（扉の列の左右2、扉の列の通りが続く所まで 2〜5行）には何も置かない。まわりには木を置かない（主要施設を隠さない）
  const noTree = new Uint8Array(N);
  const goalReserved = new Uint8Array(N);
  for (const [x, y] of bridgeCells) if (inC(x, y)) noTree[id(x, y)] = 1;
  const mark = (arr, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inC(x, y)) arr[id(x, y)] = 1; };
  for (const p of placed.filter((p) => p.spec.goalSite)) {
    // Some props (e.g. fences) overhang their occupied tile by a pixel.
    mark(goalReserved, p.x - 1, p.y - p.spec.roofRows, p.x + p.w, p.yb + 3);
    mark(noTree, p.x - 1, p.y - p.spec.roofRows, p.x + p.w, p.yb + 3);
  }
  // 水路口は props の先頭に置くだけでなく、後から置く花壇・柵などの
  // 候補からも外す。深い広場では口が南の段の近くへ来るため、これを
  // 予約しないと花壇の絵が水路口のタイルに重なる。
  for (const p of mouthProps) {
    const [mw, mh] = propTiles(p.look || p.type, propArt);
    const mx = Math.floor(p.x - mw / 2 + 0.5), my = Math.round(p.y - mh);
    mark(reserved, mx, my, mx + mw - 1, my + mh - 1);
    mark(blocked, mx, my, mx + mw - 1, my + mh - 1);
  }
  for (const p of placed) {
    if (!p.spec.facility) continue;
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    // 扉の前は、扉の列の通り（石畳・土・広場）が続く所まで（2〜5行）。通りの向こうの草地まではあけない（何も無い芝生になる）
    let ye = p.yb + 1;
    while (ye < p.yb + 5 && inC(dc, ye + 1) && [STREET, DIRT, PLAZA].includes(g[id(dc, ye + 1)])) ye++;
    mark(reserved, dc - 2, p.yb + 1, dc + 3, Math.max(p.yb + 2, ye));
    mark(noTree, p.x - 2, p.y - 1, p.x + p.w + 1, p.yb + 5);
  }

  // 段の前の壁（face）は歩けない（階段の所だけ）。
  // 全階段の前後2行・左右1マスは、縁の柵など force の小物にも渡さない。
  const stairReserved = new Uint8Array(N);
  for (const t of P.terraces) {
    const fy = t.y + t.h;
    const r = stairClearance({ ...t.stair, y: fy });
    mark(reserved, r.x0, r.y0, r.x1, r.y1);
    mark(stairReserved, r.x0, r.y0, r.x1, r.y1);
    for (let x = t.x; x < t.x + t.w; x++) {
      if ((x < t.stair.x || x >= t.stair.x + t.stair.w) && inC(x, fy)) blocked[id(x, fy)] = 1;
    }
  }
  Object.assign(C, { doorRow, noTree, goalReserved, mark, stairReserved });
}

// 岸の森の制限を最後に足し、従来の予約更新の順序を保つ。
export function reserveQuayTrees(C) {
  const { quay, crop, mark, noTree } = C;
  // 港の岸の通りの上2行には森を近づけない。岸の幅を広げても、
  // 水際の建物・樽・桟橋が森に切られないようにする（木の最短距離は3行）。
  if (quay) {
    for (let x = crop.x0; x <= crop.x1; x++) {
      const qt = Number.isFinite(quay.qt[x]) ? quay.qt[x] : quay.top;
      mark(noTree, x - 1, qt - 2, x + 1, qt + 1);
    }
  }
}
