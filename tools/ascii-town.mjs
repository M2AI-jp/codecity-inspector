#!/usr/bin/env node
// 街を文字で表示して目で確かめる道具。
//   node tools/ascii-town.mjs <repoPath | town.json> [--check] [--no-props] [--manifest art/game/manifest.json]
// 建物: W 工房 / S 商店 / H 住宅 / R 廃屋 / G 役場 / Y 宿屋 / P 酒場 / K 倉庫 / M 見張り台 / D 道場 / Q 船着場 / E 修理小屋（扉は小文字）。
// 地面: . 草地 # 石畳 : 土の路地 + 広場 ~ 水（空白は街の外）
// 小物: T 木 * 茂み o 樽 x 木箱 % 袋 f 鉢 v プランター c 荷車 = 柵 n ベンチ i 街灯 O 井戸 N 掲示板 & 井戸小屋 | 桟橋 ^ 舟
//       ! 足場 $ 工事中の札 _ 材木 [ 門の柱（くぐれる所は地面のまま） / k 外に立つ番人 / " 段の前の壁 ; 階段 / @ 開始位置
// --districts: 建物を種類ではなく地区（最上位ディレクトリ）ごとの文字で描く
// --check: 重なり・版ごとの屋根の余白・footprint の下の行（幅いっぱい歩けて広場から届く）・同じ入力で同じ出力になるか。問題があれば終了コード1
import { readFileSync } from 'node:fs';
import { analyzeRepository } from '../src/analyze.mjs';
import { layoutTown, loadArt, loadProps, loadGround, propTiles } from '../src/layout.mjs';

const args = process.argv.slice(2);
const mi = args.indexOf('--manifest');
const manifestPath = mi >= 0 ? args[mi + 1] : new URL('../art/game/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const lopts = { art: loadArt(manifest), props: loadProps(manifest), ground: loadGround(manifest) };
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--manifest');
if (!target) { console.error('使い方: node tools/ascii-town.mjs <repoPath | town.json> [--check] [--no-props]'); process.exit(2); }

let town, model = null;
if (target.endsWith('.json')) town = JSON.parse(readFileSync(target, 'utf8'));
else { model = analyzeRepository(target); town = layoutTown(model, lopts); }

const LETTER = { workshop: 'W', shop: 'S', house: 'H', ruin: 'R', town_hall: 'G', inn: 'Y', pub: 'P', warehouse: 'K', watchtower: 'M', dojo: 'D', dock: 'Q', repair: 'E' };
const PROP = { tree: 'T', bush: '*', barrel: 'o', crate: 'x', fence: '=', bench: 'n', lamp: 'i', well: 'O', noticeboard: 'N',
  sacks: '%', flowerpot: 'f', planter: 'v', cart: 'c', wellhouse: '&', pier: '|', boat: '^', scaffold: '!', 'sign-works': '$', lumber: '_', gate: '[' };
const propArt = lopts.props;
// 桟橋（deck のある小物）は水の上の板: 板の tile を数える。ほかは layout と同じ tile の大きさ
const deckTiles = (p) => {
  const d = propArt[p.look || p.type]?.deck;
  if (!d) return null;
  const x0 = Math.floor((p.x * 16 + d[0]) / 16), x1 = Math.floor((p.x * 16 + d[0] + d[2] - 1) / 16);
  const y0 = Math.floor((p.y * 16 + d[1]) / 16), y1 = Math.floor((p.y * 16 + d[1] + d[3] - 1) / 16);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
};
const grid = town.ground.map((r) => [...r]);
// 柱の箱（solids）のある小物（門）は、柱の tile だけ。くぐれる所（opening）の列は歩ける
const solidsTiles = (p) => {
  const a = propArt[p.look || p.type];
  if (!a?.solids) return null;
  const fx = Math.round(p.x * 16), fy = Math.round(p.y * 16), op = a.opening;
  const opCols = new Set();
  if (op) for (let x = Math.floor((fx + op[0]) / 16); x <= Math.floor((fx + op[0] + op[2] - 1) / 16); x++) opCols.add(x);
  const out = [];
  for (const sb of a.solids) {
    for (let y = Math.floor((fy + sb[1]) / 16); y <= Math.floor((fy + sb[1] + sb[3] - 1) / 16); y++)
      for (let x = Math.floor((fx + sb[0]) / 16); x <= Math.floor((fx + sb[0] + sb[2] - 1) / 16); x++)
        if (!opCols.has(x) && !out.some(([a2, b2]) => a2 === x && b2 === y)) out.push([x, y]);
  }
  return out;
};
const propTilesOf = (p) => {
  const deck = deckTiles(p);
  if (deck) return deck;
  const pil = solidsTiles(p);
  if (pil) return pil;
  if (p.type === 'boat') return [[Math.floor(p.x), Math.floor(p.y - 0.01)]];
  let [w, h] = propTiles(p.look || p.type, propArt);
  if (Number.isInteger(p.w) && p.w > 0) w = p.w;                  // layout が絵より細く場所を取った（足場）
  const tx = Math.floor(p.x - w / 2 + 0.5), ty = Math.round(p.y - h);
  const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([tx + dx, ty + dy]);
  return out;
};
const coverOf = (b) => {
  const vs = manifest.archetypes?.[b.archetype]?.variants || [];
  const v = vs.find((x) => x.id === b.variant) || vs[0];
  return Array.isArray(v?.cover) ? v.cover : null;
};
if (!args.includes('--no-props')) for (const p of town.props) for (const [x, y] of propTilesOf(p)) if (grid[y]?.[x] !== undefined) grid[y][x] = PROP[p.type] || '?';
for (const l of town.landmarks || []) if (l.keeper && grid[Math.floor(l.keeper.y - 0.01)]?.[Math.floor(l.keeper.x)] !== undefined) grid[Math.floor(l.keeper.y - 0.01)][Math.floor(l.keeper.x)] = 'k';
// 段の前の壁（階段の所を除く）
const stairAt = new Set((town.stairs || []).flatMap((s) => Array.from({ length: s.w }, (_, i) => `${s.x + i},${s.y}`)));
const faceCells = (town.terraces || []).flatMap((t) => Array.from({ length: t.w }, (_, i) => [t.x + i, t.y + t.h])).filter(([x, y]) => !stairAt.has(`${x},${y}`));
for (const [x, y] of faceCells) if (grid[y]?.[x] !== undefined) grid[y][x] = '"';
for (const k of stairAt) { const [x, y] = k.split(',').map(Number); if (grid[y]?.[x] !== undefined) grid[y][x] = ';'; }
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
  JSON.stringify(kinds), JSON.stringify(arch), `小物 ${town.props.length}, 住人 ${town.residents.length}, 常連 ${(town.crowd || []).length}`);

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
    const cover = coverOf(b);
    for (let dx = 0; dx < b.w; dx++) for (let y = b.y - (cover?.[dx] ?? 2); y < b.y; y++) {
      const x = b.x + dx;
      const o = foot[y * cols + x];
      if (y >= 0 && o >= 0 && town.buildings[o] !== b) problems.push(`${b.id} の屋根の余白に ${town.buildings[o].id}`);
    }
  }
  const seenProp = new Set();
  const deckT = new Uint8Array(cols * rows);
  for (const p of town.props) {
    const deck = !!deckTiles(p);
    for (const [x, y] of propTilesOf(p)) {
      const t = y * cols + x;
      if (x < 0 || y < 0 || x >= cols || y >= rows) { problems.push(`小物 ${p.type} (${x},${y}) が範囲外`); continue; }
      if (foot[t] >= 0) problems.push(`小物 ${p.type} (${x},${y}) が建物の上`);
      if (seenProp.has(t)) problems.push(`小物 (${x},${y}) が重なる`);
      if (town.ground[y]?.[x] === ' ' || town.ground[y]?.[x] === undefined) problems.push(`小物 ${p.type} (${x},${y}) が街の外`);
      if (deck) { if (town.ground[y][x] === '~') deckT[t] = 1; continue; }     // 桟橋の板は歩ける（水の上）
      if (town.ground[y]?.[x] === '~' && p.type !== 'boat') problems.push(`小物 ${p.type} (${x},${y}) が水の上`);
      seenProp.add(t);
      blocked[t] = 1;
    }
  }
  for (const l of town.landmarks || []) {
    if (!l.keeper) { problems.push(`${l.id} に番人の立つ所が無い`); continue; }
    const kx = Math.floor(l.keeper.x), ky = Math.floor(l.keeper.y - 0.01), t = ky * cols + kx;
    if (!'.#:+'.includes(town.ground[ky]?.[kx] ?? ' ') || foot[t] >= 0 || blocked[t]) problems.push(`${l.id} の番人 (${kx},${ky}) が歩けない所に立つ`);
    if (!town.props.some((p) => p.type === l.prop && Math.abs(p.x - l.x) < 0.01 && Math.abs(p.y - l.y) < 0.01)) problems.push(`${l.id} の ${l.prop} が props に無い`);
  }
  for (const [x, y] of faceCells) if (x >= 0 && y >= 0 && x < cols && y < rows) blocked[y * cols + x] = 1;    // 段の壁は歩けない
  const walk = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && ('.#:+'.includes(town.ground[y][x]) || deckT[y * cols + x]) && foot[y * cols + x] < 0 && !blocked[y * cols + x];
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
    const again = JSON.stringify(layoutTown(analyzeRepository(target), lopts));
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
