// 見える芝生と最大長方形の定義。配置の最終検査と tools/lawn.mjs が同じ Town を測る。
import { coverOf, townGrid } from './town-grid.mjs';

export const LAWN_MAX = 8;

export function visibleLawn(town, art, propArt, { withRoof = false } = {}) {
  const { cols, rows } = town;
  const grid = townGrid(town, propArt);
  const lawn = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (grid[y][x] === '.') lawn[y * cols + x] = 1;
  }
  if (!withRoof) for (const b of town.buildings) {
    const cover = coverOf(b, art);
    for (let dx = 0; dx < b.w; dx++) for (let j = 1; j <= (cover ? cover[dx] : 2); j++) {
      if (b.y - j >= 0) lawn[(b.y - j) * cols + b.x + dx] = 0;
    }
  }
  return lawn;
}

// 縦横とも2マス以上。同面積のときの走査順も配置と検査で揃える。
// bounds は切り出す前の layout の格子を測るときだけ使う。
export function largestRectangle(lawn, cols, rows, bounds = { x0: 0, y0: 0, x1: cols - 1, y1: rows - 1 }) {
  const width = bounds.x1 - bounds.x0 + 1, heights = new Int32Array(width);
  let best = null;
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let i = 0; i < width; i++) heights[i] = lawn[y * cols + bounds.x0 + i] ? heights[i] + 1 : 0;
    const stack = [];
    for (let i = 0; i <= width; i++) {
      const h = i < width ? heights[i] : 0;
      let from = i;
      while (stack.length && stack[stack.length - 1][1] >= h) {
        const [start, height] = stack.pop(), w = i - start;
        if (height >= 2 && w >= 2 && (!best || height * w > best.a)) {
          best = { a: height * w, x0: bounds.x0 + start, x1: bounds.x0 + i - 1, y0: y - height + 1, y1: y };
        }
        from = start;
      }
      stack.push([from, h]);
    }
  }
  return best;
}

// split は小物か歩ける土道で矩形を割る。予約領域を計測から除かず、実際の Town を毎回読み直す。
// 毎回少なくとも1マス減るため有限回で終わる。回数制限で未修正の街を返さない。
export function limitLawns(town, art, propArt, split) {
  let lawn = visibleLawn(town, art, propArt);
  for (;;) {
    const rect = largestRectangle(lawn, town.cols, town.rows);
    if (!rect || rect.a <= LAWN_MAX) return;
    split(rect);
    const next = visibleLawn(town, art, propArt);
    if (!lawn.some((v, i) => v && !next[i]) || next.some((v, i) => v && !lawn[i])) {
      throw new Error(`layoutTown: 芝生を分割できなかった (${rect.x0},${rect.y0}) ${rect.a}マス`);
    }
    lawn = next;
  }
}
