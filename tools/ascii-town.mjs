#!/usr/bin/env node
// 街を文字で表示して目で確かめる道具。
//   node tools/ascii-town.mjs <repoPath | town.json> [--check] [--no-props]
// 建物: W 工房 / S 商店 / H 住宅 / R 廃屋（扉は小文字）。地面: . 草地 # 石畳 : 土の路地 + 広場（空白は街の外）
// 小物: T 木 * 茂み o 樽 x 木箱 = 柵 n ベンチ i 街灯 O 井戸 N 掲示板 / @ 開始位置
// --districts: 建物を種類ではなく地区（最上位ディレクトリ）ごとの文字で描く
// --check: 重なり・隙間・屋根の余白・footprint の下の行（幅いっぱい歩けて広場から届く）・同じ入力で同じ出力になるか。問題があれば終了コード1
import { readFileSync } from 'node:fs';
import { analyzeRepository } from '../src/analyze.mjs';
import { layoutTown } from '../src/layout.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) { console.error('使い方: node tools/ascii-town.mjs <repoPath | town.json> [--check] [--no-props]'); process.exit(2); }

let town, model = null;
if (target.endsWith('.json')) town = JSON.parse(readFileSync(target, 'utf8'));
else { model = analyzeRepository(target); town = layoutTown(model); }

const LETTER = { workshop: 'W', shop: 'S', house: 'H', ruin: 'R' };
const PROP = { tree: 'T', bush: '*', barrel: 'o', crate: 'x', fence: '=', bench: 'n', lamp: 'i', well: 'O', noticeboard: 'N' };
const SIZE = { well: [2, 2], noticeboard: [2, 1], bench: [2, 1] };
const grid = town.ground.map((r) => [...r]);
const propTiles = (p) => {
  const [w, h] = SIZE[p.type] || [1, 1];
  const tx = Math.round(p.x - w / 2), ty = Math.round(p.y - h);
  const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([tx + dx, ty + dy]);
  return out;
};
if (!args.includes('--no-props')) for (const p of town.props) for (const [x, y] of propTiles(p)) if (grid[y]?.[x] !== undefined) grid[y][x] = PROP[p.type] || '?';
const districts = [...new Set(town.buildings.map((b) => b.district))].sort();
const DL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const byDistrict = args.includes('--districts');
for (const b of town.buildings) {
  const L = byDistrict ? DL[districts.indexOf(b.district) % DL.length] : LETTER[b.module.kind] || '?';
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) grid[y][x] = L;
  grid[b.door.y][b.door.x] = L.toLowerCase();
}
grid[town.spawn.y][town.spawn.x] = '@';
console.log(grid.map((r) => r.join('')).join('\n'));
if (byDistrict) console.log(districts.map((d, i) => `${DL[i % DL.length]}=${d}`).join('  '));

const kinds = {};
const arch = {};
for (const b of town.buildings) { kinds[b.module.kind] = (kinds[b.module.kind] || 0) + 1; arch[b.archetype] = (arch[b.archetype] || 0) + 1; }
console.log(`\n${town.repo.name} @ ${town.repo.head ?? '-'}: ${town.cols}×${town.rows} tiles, 建物 ${town.buildings.length}`,
  JSON.stringify(kinds), JSON.stringify(arch), `小物 ${town.props.length}, 住人 ${town.residents.length}`);

if (args.includes('--check')) {
  const problems = [];
  const { cols, rows } = town;
  const foot = new Int32Array(cols * rows).fill(-1);
  const blocked = new Uint8Array(cols * rows);
  if (town.ground.length !== rows || town.ground.some((r) => r.length !== cols)) problems.push('ground の大きさが cols×rows と合わない');
  town.buildings.forEach((b, i) => {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) { problems.push(`${b.id} が範囲外`); continue; }
      if (foot[y * cols + x] >= 0) problems.push(`${b.id} と ${town.buildings[foot[y * cols + x]].id} が重なる`);
      foot[y * cols + x] = i;
    }
  });
  for (const b of town.buildings) {
    if (b.door.y !== b.y + b.h - 1 || b.door.x < b.x || b.door.x >= b.x + b.w) problems.push(`${b.id} の扉が下辺に無い`);
    for (let y = b.y - 3; y < b.y; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const o = foot[y * cols + x];
      if (y >= 0 && o >= 0 && town.buildings[o] !== b) problems.push(`${b.id} の屋根の余白に ${town.buildings[o].id}`);
    }
    for (let y = b.y; y < b.y + b.h; y++) for (const x of [b.x - 1, b.x + b.w]) {
      const o = foot[y * cols + x];
      if (o >= 0 && town.buildings[o] !== b) problems.push(`${b.id} と ${town.buildings[o].id} の間に隙間が無い`);
    }
  }
  const seenProp = new Set();
  for (const p of town.props) for (const [x, y] of propTiles(p)) {
    const t = y * cols + x;
    if (foot[t] >= 0) problems.push(`小物 ${p.type} (${x},${y}) が建物の上`);
    if (seenProp.has(t)) problems.push(`小物 (${x},${y}) が重なる`);
    if (town.ground[y]?.[x] === ' ' || town.ground[y]?.[x] === undefined) problems.push(`小物 ${p.type} (${x},${y}) が街の外`);
    seenProp.add(t);
    blocked[t] = 1;
  }
  const walk = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && '.#:+'.includes(town.ground[y][x]) && foot[y * cols + x] < 0 && !blocked[y * cols + x];
  const s = town.spawn;
  if (!walk(s.x, s.y)) problems.push('開始位置が歩けない');
  if (town.ground[s.y][s.x] !== '+') problems.push('開始位置が広場に無い');
  const seen = new Uint8Array(cols * rows);
  const q = [s.y * cols + s.x];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const t = q[h], x = t % cols, y = (t / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (walk(nx, ny) && !seen[ny * cols + nx]) { seen[ny * cols + nx] = 1; q.push(ny * cols + nx); }
    }
  }
  // 扉の列は絵の版で決まるので、footprint のすぐ下の1行は端から端まで歩ける地面で、広場から行けること
  for (const b of town.buildings) {
    const y = b.y + b.h;
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!walk(x, y)) problems.push(`${b.id} の下の行 (${x},${y}) が歩けない`);
      else if (!seen[y * cols + x]) problems.push(`${b.id} の下の行 (${x},${y}) に広場から行けない`);
      if (!'#:+'.includes(town.ground[y]?.[x])) problems.push(`${b.id} の下の行 (${x},${y}) が通り・路地・広場でない`);
    }
  }
  let walkable = 0, streets = 0, unreached = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!walk(x, y)) continue;
    walkable++;
    if (town.ground[y][x] === '#') streets++;
    if (!seen[y * cols + x]) unreached++;
  }
  if (unreached) problems.push(`広場から行けない歩行面が ${unreached} マス`);
  if (model) {
    const again = JSON.stringify(layoutTown(analyzeRepository(target)));
    if (again !== JSON.stringify(town)) problems.push('同じ入力から違う街ができた');
  }
  let builtArea = 0;
  for (const b of town.buildings) builtArea += b.w * b.h;
  let inside = 0;
  for (const r of town.ground) for (const ch of r) if (ch !== ' ') inside++;
  console.log(`check: 歩行面 ${walkable}（石畳 ${streets}）, 建物の占有率 ${(100 * builtArea / Math.max(1, inside)).toFixed(1)}%（街の内側に対して）, 到達 ${q.length}`);
  if (problems.length) { console.log(`問題 ${problems.length} 件:\n  ` + [...new Set(problems)].slice(0, 40).join('\n  ')); process.exit(1); }
  console.log('check: OK（重なり・隙間・屋根の余白・下の行・到達・決定性）');
}
