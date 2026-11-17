// 矩形・人物の足元・建物の位置を問い合わせる。
import { TILE, FEET_W, FEET_H, FEET_UP } from '../config.js';

const T = TILE;

export function boxHits(world, x0, y0, x1, y1) {
  if (x0 < 0 || y0 < 0 || x1 > world.W || y1 > world.H) return true;
  const tx0 = Math.floor(x0 / T), ty0 = Math.floor(y0 / T);
  const tx1 = Math.floor((x1 - 0.0001) / T), ty1 = Math.floor((y1 - 0.0001) / T);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const k = ty * world.cols + tx;
      if (world.tileSolid[k]) return true;
      const bk = world.buckets[k];
      if (bk) {
        for (let i = 0; i < bk.length; i++) {
          const r = world.rects[bk[i]];
          if (x0 < r.x + r.w && x1 > r.x && y0 < r.y + r.h && y1 > r.y) return true;
        }
      }
    }
  }
  return false;
}

export function feetHit(world, fx, fy) {
  const hw = FEET_W / 2;
  return world.boxHits(fx - hw, fy - FEET_UP, fx + hw, fy - FEET_UP + FEET_H);
}

export function buildingAtPx(world, px, py) {
  const tx = Math.floor(px / T), ty = Math.floor(py / T);
  if (!world.inGrid(tx, ty)) return null;
  const i = world.buildingMap[ty * world.cols + tx];
  return i >= 0 ? world.buildings[i] : null;
}
