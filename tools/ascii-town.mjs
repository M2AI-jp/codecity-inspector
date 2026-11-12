#!/usr/bin/env node
// 街を文字で表示して目で確かめる道具。
//   node tools/ascii-town.mjs <repoPath | town.json> [--check] [--no-props] [--manifest art/game/manifest.json]
// 建物: W 工房 / S 商店 / H 住宅 / R 廃屋 / G 役場 / Y 宿屋 / P 酒場 / K 倉庫 / M 見張り台 / D 道場 / Q 船着場 / E 修理小屋（扉は小文字）。
// 地面: . 草地 # 石畳 : 土の路地 + 広場 ~ 水（空白は街の外）
// 小物: T 木 * 茂み o 樽 x 木箱 % 袋 f 鉢 v プランター c 荷車 = 柵 n ベンチ i 街灯 O 井戸 N 掲示板 & 井戸小屋 | 桟橋 ^ 舟 ∩ 水路口 ─ 橋-h │ 橋-v
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
  sacks: '%', flowerpot: 'f', planter: 'v', cart: 'c', wellhouse: '&', pier: '|', boat: '^', 'bridge-h': '─', 'bridge-v': '│',
  'canal-mouth': '∩', scaffold: '!', 'sign-works': '$', lumber: '_', gate: '[' };
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
  let waterLandStripCount = 0;
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
      if (town.ground[y]?.[x] === '~' && p.type !== 'boat' && p.type !== 'canal-mouth') problems.push(`小物 ${p.type} (${x},${y}) が水の上`);
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
  if (town.canal) {
    const canal = Array.isArray(town.canal.cells) ? town.canal.cells : [];
    const canalSet = new Set();
    const plazaSeen = new Set();
    const canalSpawn = town.spawn;
    const startKey = `${canalSpawn.x},${canalSpawn.y}`;
    if (town.ground[canalSpawn.y]?.[canalSpawn.x] === '+') {
      const q0 = [[canalSpawn.x, canalSpawn.y]]; plazaSeen.add(startKey);
      for (let h = 0; h < q0.length; h++) {
        const [x, y] = q0[h];
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const key = `${nx},${ny}`;
          if (!plazaSeen.has(key) && town.ground[ny]?.[nx] === '+') { plazaSeen.add(key); q0.push([nx, ny]); }
        }
      }
    }
    const plazaCells = [...plazaSeen].map((k) => k.split(',').map(Number));
    const px0 = plazaCells.length ? Math.min(...plazaCells.map(([x]) => x)) : Infinity;
    const px1 = plazaCells.length ? Math.max(...plazaCells.map(([x]) => x)) : -Infinity;
    const py0 = plazaCells.length ? Math.min(...plazaCells.map(([, y]) => y)) : Infinity;
    const py1 = plazaCells.length ? Math.max(...plazaCells.map(([, y]) => y)) : -Infinity;
    for (const [x, y] of canal) {
      const key = `${x},${y}`, k = y * cols + x;
      if (canalSet.has(key)) problems.push(`水路 (${x},${y}) が重なる`);
      canalSet.add(key);
      if (x < 0 || y < 0 || x >= cols || y >= rows) { problems.push(`水路 (${x},${y}) が範囲外`); continue; }
      if (town.ground[y][x] !== '~') problems.push(`水路 (${x},${y}) が ground の ~ でない`);
      if (foot[k] >= 0) problems.push(`水路 (${x},${y}) が建物に重なる`);
      if (x >= px0 && x <= px1 && y >= py0 && y <= py1) problems.push(`水路 (${x},${y}) が広場に重なる`);
      if (stairAt.has(key) || faceCells.some(([fx, fy]) => fx === x && fy === y)) problems.push(`水路 (${x},${y}) が段・階段に重なる`);
      for (const b of town.buildings) {
        if (x === b.door.x && y > b.door.y && y <= b.door.y + 2) problems.push(`水路 (${x},${y}) が ${b.id} の扉前に重なる`);
      }
    }
    if (canal.length) {
      const seenCanal = new Set([`${canal[0][0]},${canal[0][1]}`]), cq = [canal[0]];
      for (let h = 0; h < cq.length; h++) {
        const [x, y] = cq[h];
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const key = `${nx},${ny}`;
          if (canalSet.has(key) && !seenCanal.has(key)) { seenCanal.add(key); cq.push([nx, ny]); }
        }
      }
      if (seenCanal.size !== canalSet.size) problems.push('水路のセルが一続きでない');
    }
    const crossings = town.canal.crossings || [];
    const roadAt = (x, y) => {
      const ch = town.ground[y]?.[x];
      return ch === '#' || ch === ':';
    };
    const nearCrossing = (x, y) => crossings.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) <= 2);
    const canalHas = (x, y) => canalSet.has(`${x},${y}`);
    const bridgeDecks = town.props.filter((p) => p.type === 'bridge-h' || p.type === 'bridge-v').flatMap((p) => deckTiles(p) || []);
    const bridgeDeckSet = new Set(bridgeDecks.map(([x, y]) => `${x},${y}`));
    const roadTurnAt = (x, y) => {
      const at = (xx, yy) => roadAt(xx, yy) && !bridgeDeckSet.has(`${xx},${yy}`);
      if (!at(x, y)) return false;
      const h = at(x - 1, y) || at(x + 1, y);
      const v = at(x, y - 1) || at(x, y + 1);
      return h && v;
    };
    for (const [x, y] of canal) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (roadAt(nx, ny) && !nearCrossing(x, y)) problems.push(`水路 (${x},${y}) が通り・路地の脇を流れる`);
      }
    }
    for (const c of crossings) {
      const expected = c.road === 'h' ? 'bridge-h' : c.road === 'v' ? 'bridge-v' : null;
      if (expected && c.bridge !== expected) problems.push(`交差点 (${c.x},${c.y}) の橋 ${c.bridge} が ${expected} でない`);
      const bridge = town.props.find((p) => p.type === c.bridge && (deckTiles(p) || []).some(([x, y]) => x === c.x && y === c.y));
      if (!bridge) {
        problems.push(`水路の交差点 (${c.x},${c.y}) に ${c.bridge} が無い`);
        continue;
      }
      const deck = deckTiles(bridge) || [];
      const deckSet = new Set(deck.map(([x, y]) => `${x},${y}`));
      if (c.bridge === 'bridge-h' && ![...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return x === c.x && canalHas(x, y - 1); })
        && ![...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return x === c.x && canalHas(x, y + 1); })) {
        problems.push(`bridge-h (${c.x},${c.y}) が南北の水路をまたいでいない`);
      }
      if (c.bridge === 'bridge-v' && ![...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return y === c.y && canalHas(x - 1, y); })
        && ![...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return y === c.y && canalHas(x + 1, y); })) {
        problems.push(`bridge-v (${c.x},${c.y}) が東西の水路をまたいでいない`);
      }
      const minX = Math.min(...deck.map(([x]) => x)), maxX = Math.max(...deck.map(([x]) => x));
      const minY = Math.min(...deck.map(([, y]) => y)), maxY = Math.max(...deck.map(([, y]) => y));
      if (deck.some(([x, y]) => !['~', '#', ':'].includes(town.ground[y]?.[x] ?? ' '))) {
        problems.push(`${c.bridge} (${c.x},${c.y}) の deck が草地・街の外にかかる`);
      }
      if (c.bridge === 'bridge-h' && (!roadAt(minX, c.y) || !roadAt(maxX, c.y))) problems.push(`bridge-h (${c.x},${c.y}) の両端が通りに乗らない`);
      if (c.bridge === 'bridge-v' && (!roadAt(c.x, minY) || !roadAt(c.x, maxY))) problems.push(`bridge-v (${c.x},${c.y}) の両端が通りに乗らない`);
      if ([...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return roadTurnAt(x, y) && Math.abs(x - c.x) + Math.abs(y - c.y) <= 2; })) {
        problems.push(`交差点 (${c.x},${c.y}) が曲がり角から2マス以内`);
      }
    }
    const mouth = town.props.find((p) => p.type === 'canal-mouth'
      && propTilesOf(p).some(([x, y]) => canalHas(x, y))
      && !propTilesOf(p).some(([x, y]) => bridgeDeckSet.has(`${x},${y}`)));
    if (!mouth) problems.push('水路の始点に広場の縁の水路口が無い');
    // 港の水は地図の下端から flood fill し、港の水でない水路と区別する。
    // 水路との間に1〜2マスの陸が残ると、細い草の島や岸の帯になる。
    const harbourWater = new Set();
    const hq = [];
    for (let x = 0; x < cols; x++) {
      if (town.ground[rows - 1]?.[x] === '~' && !canalHas(x, rows - 1)) {
        const key = `${x},${rows - 1}`;
        if (!harbourWater.has(key)) { harbourWater.add(key); hq.push([x, rows - 1]); }
      }
    }
    for (let h = 0; h < hq.length; h++) {
      const [x, y] = hq[h];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || harbourWater.has(key) || canalHas(nx, ny)) continue;
        if (town.ground[ny]?.[nx] === '~') { harbourWater.add(key); hq.push([nx, ny]); }
      }
    }
    const waterStripHits = new Set();
    const parallelWaterHits = new Set();
    for (const [x, y] of canal) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let n = 1; n <= 3; n++) {
          const nx = x + dx * n, ny = y + dy * n, key = `${nx},${ny}`;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) break;
          if (canalHas(nx, ny)) break;       // 同じ水路の幅・曲がり角の向こうは調べない
          if (harbourWater.has(key)) {
            const hit = `${x},${y}->${nx},${ny}`;
            if (n === 1 && town.canal.to === 'harbour') break; // 注ぎ口の直接接続
            if (n <= 3) parallelWaterHits.add(hit);
            if (n <= 3 && n - 1 <= 2) waterStripHits.add(hit);
            break;
          }
          if (town.ground[ny]?.[nx] === '~') break;
        }
      }
    }
    waterLandStripCount = waterStripHits.size;
    if (waterStripHits.size) problems.push(`水と水の間に幅1〜2マスの陸の帯が ${waterStripHits.size} 箇所`);
    if (parallelWaterHits.size) problems.push(`水路が港の水と平行に3マス以内を流れる箇所が ${parallelWaterHits.size} 箇所`);
    if (town.canal.to === 'harbour' && harbourWater.size &&
      !canal.some(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .some(([dx, dy]) => harbourWater.has(`${x + dx},${y + dy}`)))) {
      problems.push('港へ注ぐ水路の終端が港の水に接していない');
    }
    // 地図端に沿って3マス以内を流れる長い区間は、外へ出る直前の
    // 横走りになっていないかを確認する（端へ直角に入る短い終端は除く）。
    const edgeParallel = new Set();
    for (const [x, y] of canal) {
      let hRun = 1, vRun = 1;
      for (let xx = x - 1; canalHas(xx, y); xx--) hRun++;
      for (let xx = x + 1; canalHas(xx, y); xx++) hRun++;
      for (let yy = y - 1; canalHas(x, yy); yy--) vRun++;
      for (let yy = y + 1; canalHas(x, yy); yy++) vRun++;
      if (hRun >= 3 && (y <= 3 || rows - 1 - y <= 3)) edgeParallel.add(`${x},${y}`);
      if (vRun >= 3 && (x <= 3 || cols - 1 - x <= 3)) edgeParallel.add(`${x},${y}`);
    }
    if (edgeParallel.size) problems.push(`水路が地図の端と平行に3マス以内を流れる箇所が ${edgeParallel.size} マス`);
    const bridgeCount = town.props.filter((p) => p.type === 'bridge-h' || p.type === 'bridge-v').length;
    if (bridgeCount !== crossings.length) problems.push(`水路の交差点 ${crossings.length} 件と橋 ${bridgeCount} 件が一致しない`);
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
  console.log(`check: 歩行面 ${walkable}（石畳 ${streets}）, 建物の占有率 ${(100 * builtArea / Math.max(1, inside)).toFixed(1)}%（街の内側に対して）, 到達 ${q.length}, 水と水の間の陸帯 ${waterLandStripCount}`);
  if (problems.length) { console.log(`問題 ${problems.length} 件:\n  ` + [...new Set(problems)].slice(0, 40).join('\n  ')); process.exit(1); }
  console.log('check: OK（重なり・隙間・屋根の余白・下の行・到達・決定性）');
}
