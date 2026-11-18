// 各tileの歩ける足元と、隣のtileへ歩いて渡れる辺を作る。
import { TILE } from '../config.js';
import { MAT } from '../ground.js';

const T = TILE;
// 隣の8方向。edges[k]のbit dは、tile kからDIRS[d]の方向へ足元が直進できることを示す。
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const DIR_AT = new Int8Array(9).fill(-1);   // path.jsのA*も同じ方向の番号を使う
DIRS.forEach(([dx, dy], d) => { DIR_AT[(dy + 1) * 3 + dx + 1] = d; });
// tileの中央がふさがっていたら、近い順に足元を探す。同距離の候補の順も保つ。
// 足元の範囲はxが[tx*16, tx*16+16)、yが[ty*16+3, ty*16+19)（中央はty*16+11）。
const NAV_OFFSETS = [];
for (let oy = -8; oy <= 7; oy++) for (let ox = -8; ox <= 7; ox++) if (ox || oy) NAV_OFFSETS.push([ox, oy]);
NAV_OFFSETS.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);

// 道案内の格子はtile単位だが、各点は本当に足元を置ける所にする。
// 中央が空いていれば中央、そうでなければtile内の最も近い所を選ぶ。
// 隣の点へ足元が直進できるときだけ辺を張るので、家具の間の13pxの通路もつながり、
// 人物が当たる角を道案内が横切らない。
export function computeNav(world) {
  const cols = world.cols;
  for (let ty = 0; ty < world.rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const k = ty * cols + tx;
      const cx = tx * T + T / 2, cy = ty * T + T / 2 + 3;
      let free = false;
      if (!world.tileSolid[k]) {
        if (!world.feetHit(cx, cy)) { world.navX[k] = cx; world.navY[k] = cy; free = true; }
        else {
          for (let i = 0; i < NAV_OFFSETS.length; i++) {
            const x = cx + NAV_OFFSETS[i][0], y = cy + NAV_OFFSETS[i][1];
            if (!world.feetHit(x, y)) { world.navX[k] = x; world.navY[k] = y; free = true; break; }
          }
        }
      }
      world.nav[k] = free ? 0 : 1;
      const m = world.grid[k];
      world.cost[k] = world.buildingMap[k] >= 0 ? 1.1 : world.stairTile[k] ? 1.2 : m === MAT.STREET || m === MAT.PLAZA ? 1 : m === MAT.DIRT || world.deckTile[k] ? 1.35 : 2.4;
    }
  }
  const edges = world.edges;
  edges.fill(0);
  for (let ty = 0; ty < world.rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const k = ty * cols + tx;
      if (world.nav[k]) continue;
      for (let d = 0; d < 4; d++) {
        const nx = tx + DIRS[d][0], ny = ty + DIRS[d][1];
        if (!world.inGrid(nx, ny)) continue;
        const n = ny * cols + nx;
        if (world.nav[n]) continue;
        if (world.sweepFree(world.navX[k], world.navY[k], world.navX[n], world.navY[n])) {
          edges[k] |= 1 << d; edges[n] |= 1 << (d + 4);
        }
      }
    }
  }
  // どの隣にもつながらない点は、同じtile内につながる点があれば置き換える。
  for (let ty = 0; ty < world.rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const k = ty * cols + tx;
      if (world.nav[k] || edges[k]) continue;
      const cx = tx * T + T / 2, cy = ty * T + T / 2 + 3;
      for (let i = -1; i < NAV_OFFSETS.length; i++) {
        const x = cx + (i < 0 ? 0 : NAV_OFFSETS[i][0]), y = cy + (i < 0 ? 0 : NAV_OFFSETS[i][1]);
        if ((i & 1) || world.feetHit(x, y)) continue;            // ここでは候補を1つおきに調べる
        let e = 0;
        for (let d = 0; d < 8; d++) {
          const nx = tx + DIRS[d][0], ny = ty + DIRS[d][1];
          if (!world.inGrid(nx, ny)) continue;
          const n = ny * cols + nx;
          if (!world.nav[n] && world.sweepFree(x, y, world.navX[n], world.navY[n])) e |= 1 << d;
        }
        if (!e) continue;
        world.navX[k] = x; world.navY[k] = y; edges[k] = e;
        for (let d = 0; d < 8; d++) if (e & (1 << d)) edges[(ty + DIRS[d][1]) * cols + tx + DIRS[d][0]] |= 1 << ((d + 4) & 7);
        break;
      }
    }
  }
  labelNav(world);
}

// 辺でたどれるtileの塊に番号を付ける（ふさがったtileは -1）。A*が届くかどうかはこの番号と同じになる。
// 町の人の出発点を家の戸口と同じ塊から選び、柵や小物に囲まれた1マス・切り離された桟橋に出さないために使う。
function labelNav(world) {
  const n = world.cols * world.rows, cols = world.cols;
  if (!world.navComp || world.navComp.length !== n) world.navComp = new Int32Array(n);
  const comp = world.navComp, stack = new Int32Array(n);
  comp.fill(-1);
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (world.nav[s] || comp[s] >= 0) continue;
    let top = 0;
    stack[top++] = s; comp[s] = id;
    while (top) {
      const k = stack[--top], tx = k % cols, ty = (k / cols) | 0, e = world.edges[k];
      for (let d = 0; d < 8; d++) {
        if (!(e & (1 << d))) continue;
        const m = (ty + DIRS[d][1]) * cols + tx + DIRS[d][0];
        if (comp[m] < 0 && !world.nav[m]) { comp[m] = id; stack[top++] = m; }
      }
    }
    id++;
  }
}

// 歩けるtileの足元。ふさがったtileや範囲外なら中央を返す。
export function navPoint(world, tx, ty) {
  if (world.inGrid(tx, ty)) {
    const k = ty * world.cols + tx;
    if (!world.nav[k]) return { x: world.navX[k], y: world.navY[k] };
  }
  return { x: tx * T + T / 2, y: ty * T + T / 2 + 3 };
}

export function buildNav(world) {
  const n = world.cols * world.rows;
  world.nav = new Uint8Array(n);
  world.cost = new Float32Array(n);
  world.navX = new Float32Array(n);
  world.navY = new Float32Array(n);
  world.edges = new Uint8Array(n);
  world.computeNav();
  world.heap = new Int32Array(n * 8 + 16);
  world.g = new Float32Array(n);
  world.f = new Float32Array(n);
  world.from = new Int32Array(n);
  world.stamp = new Uint32Array(n);
  world.closed = new Uint32Array(n);
  world.gen = 0;
  // 建物の番人の位置と、扉の内外の点。
  for (const b of world.buildings) {
    b.doorOutside = { x: b.doorPx, y: b.bottomPx + 9 };
    if (b.floor) { world.floorSpots(b); continue; }
    b.doorInside = b.h >= 4 ? { x: b.doorPx, y: (b.y + b.h - 2) * T + 11 } : null;
    let best = null, bestScore = Infinity;
    const doorCols = [];
    for (let c = b.doorX0; c < b.doorX1; c++) doorCols.push(c);
    const icx = b.x + b.w / 2 - 0.5;
    for (const k of b.interior) {
      if (world.nav[k]) continue;
      const tx = k % world.cols, ty = (k / world.cols) | 0;
      let s = Math.abs(tx - icx) * 0.6 + (ty - (b.y + 2)) * 1.0;
      if (doorCols.includes(tx)) s += 6;
      if (s < bestScore) { bestScore = s; best = k; }
    }
    if (best !== null) {
      const tx = best % world.cols, ty = (best / world.cols) | 0;
      b.keeperSpot = { x: tx * T + T / 2, y: ty * T + 11, tx, ty };
    }
  }
}

export function navFree(world, tx, ty) { return world.inGrid(tx, ty) && world.nav[ty * world.cols + tx] === 0; }
