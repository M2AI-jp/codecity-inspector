import { key } from './occupancy.mjs';

// footprint / Chebyshev 距離6以内の街の内側（水を含む）。
export function footprintOf(town) {
  const { cols, rows, buildings, ground } = town;
  const foot = new Set();
  let footprint = 0;
  for (const b of buildings) {
    footprint += b.w * b.h;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) foot.add(key(x, y));
  }

  let inside = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let near = false;
    for (const b of buildings) {
      const dx = Math.max(b.x - x, 0, x - (b.x + b.w - 1));
      const dy = Math.max(b.y - y, 0, y - (b.y + b.h - 1));
      if (Math.max(dx, dy) <= 6) { near = true; break; }
    }
    if (near && ground[y]?.[x] !== ' ') inside++;
  }
  return { foot, footprint, inside };
}
