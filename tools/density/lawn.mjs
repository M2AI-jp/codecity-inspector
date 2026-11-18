import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { coverOf, key } from './occupancy.mjs';

function maxBareRect(lawn, cols, rows) {
  const heights = new Int32Array(cols);
  let best = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) heights[x] = lawn[y * cols + x] ? heights[x] + 1 : 0;
    const stack = [];
    for (let i = 0; i <= cols; i++) {
      const h = i < cols ? heights[i] : 0;
      let from = i;
      while (stack.length && stack[stack.length - 1][1] >= h) {
        const [start, height] = stack.pop();
        const width = i - start;
        if (height >= 2 && width >= 2) best = Math.max(best, height * width);
        from = start;
      }
      stack.push([from, h]);
    }
  }
  return best;
}

export function lawnOf(town, manifest, props, foot, file, root) {
  const { cols, rows, buildings, ground } = town;
  const shade = new Uint8Array(cols * rows);
  for (const b of buildings) {
    const cover = coverOf(b, manifest);
    for (let dx = 0; dx < b.w; dx++) for (let j = 1; j <= (cover?.[dx] ?? 2); j++) {
      if (b.y - j >= 0) shade[(b.y - j) * cols + b.x + dx] = 1;
    }
  }
  const lawn = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (ground[y]?.[x] === '.' && !shade[y * cols + x] && !props.has(key(x, y)) && !foot.has(key(x, y))) lawn[y * cols + x] = 1;
  }
  const lawnMax = maxBareRect(lawn, cols, rows);
  // 町は生成しない。lawn CLI の測定値を優先し、読めない形式の出力なら上の値を使う。
  // 従来どおり --manifest は渡さず、lawn CLI 自身の既定 manifest を使う。
  const lawnOutput = execFileSync(process.execPath, [resolve(root, 'tools/lawn.mjs'), file], { encoding: 'utf8' });
  const lawnMatch = lawnOutput.match(/最大\s+(\d+)\s+マス/);
  return lawnMatch ? Number(lawnMatch[1]) : lawnMax;
}
