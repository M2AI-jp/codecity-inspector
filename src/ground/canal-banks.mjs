// 運河の岸。岸壁の後に笠石・角・前面を元の順で重ねる。
import { T, TW } from './constants.mjs';

export function paintCanalBanks(state) {
  const { canalCells, masonry, cols, rows, tc, footT } = state;
  // ---- 4b. 水路の石垣: 水路セルの境界だけに、陸側の笠石と見える岸を描く
  if (!canalCells.size) return;
  const { inMap, mul, put, blockAt, STONE, MORTAR, grimeAt } = masonry;
  const N = 0, S = 1, W_ = 2, E = 3;
  const edges = [];
  const sideAt = (tx, ty, dir) => {
    const nx = tx + (dir === W_ ? -1 : dir === E ? 1 : 0);
    const ny = ty + (dir === N ? -1 : dir === S ? 1 : 0);
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
    const ni = ny * cols + nx;
    if (tc[ni] === TW || footT[ni] >= 0) return false;
    return true;
  };
  for (const key of canalCells) {
    const [tx, ty] = key.split(',').map(Number);
    for (const dir of [N, S, W_, E]) if (sideAt(tx, ty, dir)) edges.push({ tx, ty, dir });
  }

  // 陸側の4px笠石。外側の縁を明るく、水側の1pxを暗くする。
  const cap = ({ tx, ty, dir }) => {
    const px = tx * T, py = ty * T, horizontal = dir === N || dir === S;
    for (let along = 0; along < T; along++) {
      const q = horizontal ? px + along : py + along;
      const b = blockAt(q * 0.62, 9 + dir);
      for (let d = 0; d < 4; d++) {
        let x, y, depth;
        if (dir === N) { x = px + along; y = py - 4 + d; depth = d; }
        else if (dir === S) { x = px + along; y = py + T + d; depth = 3 - d; }
        else if (dir === W_) { x = px - 4 + d; y = py + along; depth = d; }
        else { x = px + T + d; y = py + along; depth = 3 - d; }
        if (b.lx === 0) put(x, y, MORTAR, 1.1);
        else STONE(x, y, b.key + 1500 + dir * 97, [1.34, 1.12, 0.92, 0.68][depth]);
      }
    }
  };

  // 曲がり角の外側の4×4pxを埋め、縦横の笠石が角で途切れないようにする。
  const corner = (tx, ty, a, b, salt) => {
    const dx = a === W_ || b === W_ ? -1 : 1, dy = a === N || b === N ? -1 : 1;
    const cx = tx * T + (dx < 0 ? -4 : T), cy = ty * T + (dy < 0 ? -4 : T);
    const qx = tx + dx, qy = ty + dy;
    if (qx < 0 || qy < 0 || qx >= cols || qy >= rows || tc[qy * cols + qx] === TW || footT[qy * cols + qx] >= 0) return;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = cx + i, y = cy + j, b0 = blockAt((x + y) * 0.31, 60 + salt);
      if (b0.lx === 0 || i === 0 || j === 0) put(x, y, MORTAR, 1.0);
      else STONE(x, y, b0.key + 1600 + salt * 41, (i === 3 || j === 3) ? 0.78 : 1.08);
    }
  };
  const front = ({ tx, ty }) => {
    const px = tx * T, py = ty * T;
    for (let along = 0; along < T; along++) {
      const x = px + along;
      for (let ly = 0; ly < 10; ly++) {
        const course = ly < 5 ? 0 : 1, r = ly - (course ? 5 : 0);
        const b = blockAt(x * 0.62, 40 + course);
        if (r === 4 || b.lx === 0) { put(x, py + ly, MORTAR, grimeAt(x, py + ly)); continue; }
        let k = 1.0;
        if (r === 0) k = 1.32;
        else if (r === 3) k = 0.86;
        if (b.lx === 1) k *= 1.18;
        else if (b.lx === b.len - 1) k *= 0.82;
        STONE(x, py + ly, b.key + 1700, k * (course ? 0.92 : 1.0));
      }
      mul(x, py + 10, 0.58);
      mul(x, py + 11, 0.74);
    }
  };
  const waterLine = ({ tx, ty, dir }) => {
    const px = tx * T, py = ty * T;
    if (dir === S) for (let x = px; x < px + T; x++) mul(x, py + T - 1, 0.56);
    else if (dir === W_) for (let y = py; y < py + T; y++) { mul(px, y, 0.58); mul(px + 1, y, 0.72); mul(px + 2, y, 0.86); }
    else if (dir === E) for (let y = py; y < py + T; y++) mul(px + T - 1, y, 0.56);
  };

  for (const e of edges) cap(e);
  for (const key of canalCells) {
    const [tx, ty] = key.split(',').map(Number);
    const at = (dir) => edges.some((e) => e.tx === tx && e.ty === ty && e.dir === dir);
    if (at(N) && at(W_)) corner(tx, ty, N, W_, 0);
    if (at(N) && at(E)) corner(tx, ty, N, E, 1);
    if (at(S) && at(W_)) corner(tx, ty, S, W_, 2);
    if (at(S) && at(E)) corner(tx, ty, S, E, 3);
  }
  for (const e of edges) {
    if (e.dir === N) front(e);
    else waterLine(e);
  }
}
