// 当たり矩形の登録をまとめ、矩形と検索用bucketの追加順を保つ。
import { TILE } from '../../config.js';

const T = TILE;

export function addRect(world, x, y, w, h, kind) {
  if (!(w > 0 && h > 0)) return null;
  const r = { x, y, w, h, kind };
  const idx = world.rects.length;
  world.rects.push(r);
  const tx0 = Math.max(0, Math.floor(x / T)), ty0 = Math.max(0, Math.floor(y / T));
  const tx1 = Math.min(world.cols - 1, Math.floor((x + w - 0.001) / T)), ty1 = Math.min(world.rows - 1, Math.floor((y + h - 0.001) / T));
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const k = ty * world.cols + tx;
    (world.buckets[k] || (world.buckets[k] = [])).push(idx);
  }
  return r;
}
