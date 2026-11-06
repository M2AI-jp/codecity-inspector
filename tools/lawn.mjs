#!/usr/bin/env node
// 何も無い芝生の広さを数える道具。基準 target-town.png の町の緑はほとんどが茂み・花・木で、何も無い芝生はいちばん大きい所でも 7 マスほど。
//   node tools/lawn.mjs <town.json> [上位の数] [--with-roof]
// 芝生のマス: 草地（'.'）で、建物・小物とその周り1マスにかからない所。建物のすぐ上の2行は屋根の陰で見えないので数えない
// （--with-roof で数える）。4近傍のつながりの大きさを、大きい順に出す。src/layout.mjs は 10 マスを超えるつながりに茂み・花・木を置く
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const [file, topArg] = args.filter((a) => !a.startsWith('--'));
if (!file) { console.error('使い方: node tools/lawn.mjs <town.json> [上位の数] [--with-roof]'); process.exit(2); }
const town = JSON.parse(readFileSync(file, 'utf8'));
const ascii = path.join(import.meta.dirname, 'ascii-town.mjs');
const grid = execFileSync('node', [ascii, file], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').slice(0, town.rows).map((r) => [...r]);
const { cols, rows } = town;
const GROUND = new Set(['.', '#', ':', '+', ' ', '~', '"', ';', '@']);   // 地面・段の壁・階段・開始位置（物ではない）
const occ = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !GROUND.has(grid[y][x]);
const roof = new Uint8Array(cols * rows);
if (!args.includes('--with-roof')) for (const b of town.buildings) for (let y = b.y - 2; y < b.y; y++) for (let x = b.x; x < b.x + b.w; x++) if (y >= 0) roof[y * cols + x] = 1;
const lawn = new Uint8Array(cols * rows);
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
  if (grid[y][x] !== '.' || roof[y * cols + x]) continue;
  let near = false;
  for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (occ(x + dx, y + dy)) { near = true; break; }
  if (!near) lawn[y * cols + x] = 1;
}
const seen = new Uint8Array(cols * rows), comps = [];
for (let i = 0; i < cols * rows; i++) {
  if (!lawn[i] || seen[i]) continue;
  const q = [i]; seen[i] = 1;
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let h = 0; h < q.length; h++) {
    const t = q[h], x = t % cols, y = (t / cols) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = ny * cols + nx;
      if (lawn[n] && !seen[n]) { seen[n] = 1; q.push(n); }
    }
  }
  comps.push({ n: q.length, x0, x1, y0, y1 });
}
comps.sort((a, b) => b.n - a.n);
console.log(`${town.repo.name}${args.includes('--with-roof') ? '（屋根の陰も数える）' : ''}: 芝生のつながり ${comps.length}、10マスを超える ${comps.filter((c) => c.n > 10).length}、最大 ${comps[0]?.n ?? 0}`);
for (const c of comps.slice(0, +(topArg || 8))) console.log(`  ${c.n} マス（x${c.x0}〜${c.x1}, y${c.y0}〜${c.y1}）`);
