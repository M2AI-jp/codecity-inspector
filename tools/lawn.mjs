#!/usr/bin/env node
// 何も無い芝生の広さを測る道具。基準 target-town.png の町の緑はほとんどが茂み・花・木・樽で埋まり、何も無い芝生はいちばん大きい所でも 7 マスほど。
//   node tools/lawn.mjs <town.json> [上位の数] [--with-roof] [--manifest art/game/manifest.json]
// 見える芝生のマス: 草地（'.'）で、建物・小物が無く、建物の絵の屋根の陰でない所（版ごとの cover。manifest に無い版は2行。--with-roof で陰も数える）。
// その中の何も無い長方形（縦横とも2マス以上）を、大きい順に重ならないように出す。src/layout.mjs は 8 マスを超える長方形に小物の組を置く
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const mi = args.indexOf('--manifest');
const [file, topArg] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--manifest');
if (!file) { console.error('使い方: node tools/lawn.mjs <town.json> [上位の数] [--with-roof] [--manifest m.json]'); process.exit(2); }
const town = JSON.parse(readFileSync(file, 'utf8'));
const manifest = JSON.parse(readFileSync(mi >= 0 ? args[mi + 1] : path.join(import.meta.dirname, '../art/game/manifest.json'), 'utf8'));
const grid = execFileSync('node', [path.join(import.meta.dirname, 'ascii-town.mjs'), file], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\n').slice(0, town.rows).map((r) => [...r]);
const { cols, rows } = town;
const shade = new Uint8Array(cols * rows);
if (!args.includes('--with-roof')) for (const b of town.buildings) {
  const vs = manifest.archetypes?.[b.archetype]?.variants || [];
  const cover = (vs.find((v) => v.id === b.variant) || vs[0])?.cover;
  for (let tx = 0; tx < b.w; tx++) for (let j = 1; j <= (cover ? cover[tx] : 2); j++) if (b.y - j >= 0) shade[(b.y - j) * cols + b.x + tx] = 1;
}
const lawn = new Uint8Array(cols * rows);
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (grid[y][x] === '.' && !shade[y * cols + x]) lawn[y * cols + x] = 1;
let total = 0;
for (const v of lawn) total += v;
// いちばん大きい何も無い長方形（縦横とも2マス以上）
const maxRect = () => {
  const H = new Int32Array(cols);
  let best = null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) H[x] = lawn[y * cols + x] ? H[x] + 1 : 0;
    const st = [];
    for (let i = 0; i <= cols; i++) {
      const h = i < cols ? H[i] : 0;
      let from = i;
      while (st.length && st[st.length - 1][1] >= h) {
        const [s0, hh] = st.pop(), w = i - s0;
        if (hh >= 2 && w >= 2 && (!best || hh * w > best.a)) best = { a: hh * w, x0: s0, x1: i - 1, y0: y - hh + 1, y1: y };
        from = s0;
      }
      st.push([from, h]);
    }
  }
  return best;
};
const found = [];
for (let k = 0; k < +(topArg || 8); k++) {
  const r = maxRect();
  if (!r) break;
  found.push(r);
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) lawn[y * cols + x] = 0;
}
console.log(`${town.repo.name}${args.includes('--with-roof') ? '（屋根の陰も数える）' : ''}: 見える芝生 ${total} マス、何も無い長方形の最大 ${found[0]?.a ?? 0} マス`);
for (const r of found) console.log(`  ${r.a} マス（${r.x1 - r.x0 + 1}×${r.y1 - r.y0 + 1}、x${r.x0}〜${r.x1}, y${r.y0}〜${r.y1}）`);
