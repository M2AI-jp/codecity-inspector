import { coverOf, key } from './occupancy.mjs';

// 各建物の屋根の陰から上へ続く、物も建物もない草地の行数。
export function backOf(town, manifest, props, foot) {
  const { buildings, ground } = town;
  const back = [0, 0, 0, 0];
  for (const b of buildings) {
    const cover = coverOf(b, manifest);
    let max = 0;
    for (let dx = 0; dx < b.w; dx++) {
      const x = b.x + dx;
      const hidden = cover?.[dx] ?? 2;
      let n = 0;
      for (let y = b.y - hidden - 1; y >= 0; y--) {
        if (ground[y]?.[x] !== '.' || props.has(key(x, y)) || (foot.has(key(x, y)) && !(x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h))) break;
        n++;
      }
      max = Math.max(max, n);
    }
    back[Math.min(max, 3)]++;
  }
  return back;
}
