#!/usr/bin/env node
// 何も無い芝生の広さを測る道具。基準 target-town.png の町の緑はほとんどが茂み・花・木・樽で埋まり、何も無い芝生はいちばん大きい所でも 7 マスほど。
//   node tools/lawn.mjs <town.json> [上位の数] [--with-roof] [--manifest art/game/manifest.json] [--max N]
// 見える芝生のマス: 草地（'.'）で、建物・小物が無く、建物の絵の屋根の陰でない所（版ごとの cover。manifest に無い版は2行。--with-roof で陰も数える）。
// その中の何も無い長方形（縦横とも2マス以上）を、大きい順に重ならないように出す。src/layout.mjs は 8 マスを超える長方形に小物の組を置く
import { visibleLawn, largestRectangle } from '../src/lawn.mjs';
import { loadProps } from '../src/layout/manifest.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const mi = args.indexOf('--manifest');
const maxIndex = args.indexOf('--max');
const maxArg = maxIndex >= 0 ? args[maxIndex + 1] : undefined;
const max = maxIndex >= 0 ? Number(maxArg) : null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--manifest' || args[i] === '--max') { i++; continue; }
  if (!args[i].startsWith('--')) positional.push(args[i]);
}
const [file, topArg] = positional;
if (!file || (maxIndex >= 0 && (!Number.isInteger(max) || max < 0))) {
  console.error('使い方: node tools/lawn.mjs <town.json> [上位の数] [--with-roof] [--manifest m.json] [--max N]');
  process.exit(2);
}
const town = JSON.parse(readFileSync(file, 'utf8'));
const manifest = JSON.parse(readFileSync(mi >= 0 ? args[mi + 1] : path.join(import.meta.dirname, '../art/game/manifest.json'), 'utf8'));
const { cols, rows } = town;
const lawn = visibleLawn(town, manifest.archetypes, loadProps(manifest), { withRoof: args.includes('--with-roof') });
let total = 0;
for (const v of lawn) total += v;
const found = [];
for (let k = 0; k < +(topArg || 8); k++) {
  const r = largestRectangle(lawn, cols, rows);
  if (!r) break;
  found.push(r);
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) lawn[y * cols + x] = 0;
}
console.log(`${town.repo.name}${args.includes('--with-roof') ? '（屋根の陰も数える）' : ''}: 見える芝生 ${total} マス、何も無い長方形の最大 ${found[0]?.a ?? 0} マス`);
for (const r of found) console.log(`  ${r.a} マス（${r.x1 - r.x0 + 1}×${r.y1 - r.y0 + 1}、x${r.x0}〜${r.x1}, y${r.y0}〜${r.y1}）`);
if (max !== null && (found[0]?.a ?? 0) > max) {
  console.error(`何も無い長方形の最大 ${found[0].a} マスが上限 ${max} マスを超えています`);
  process.exitCode = 1;
}
