#!/usr/bin/env node
// 配置の密度を測る道具（Node 22以上、標準ライブラリのみ）。
//
//   node tools/density.mjs [--label 名前] town.json [...]
//
// footprint / 街の内側:
//   建物 footprint の面積を、建物から Chebyshev 距離6以内で ground が街の外(' ')でない
//   マス数で割る。水は「街の外」ではないため分母に含める。
// 間隔:
//   x方向に隣り合い、扉の行が1行以内の建物を同じ通りの隣として数える。
// 裏:
//   版の cover の外側から上へ、裸の草地（物と建物が無い'.'）が続く最大行数を建物ごとに数える。
// 広場の辺:
//   '+' の外周を広場とし、入口の通り（外側が最も舗装された辺）を除く。
//   建物または役場の段が、その辺に直接または1マス以内の前庭・通りをはさんで面する長さを数える。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProps, propTiles } from '../src/layout.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mi = args.indexOf('--manifest');
const manifestPath = resolve(mi >= 0 ? args[mi + 1] : `${ROOT}/art/game/manifest.json`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const propArt = loadProps(manifest);

const inputs = [];
let pendingLabel = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--manifest') { i++; continue; }
  if (a === '--label') { pendingLabel = args[++i]; continue; }
  if (a.startsWith('--')) continue;
  inputs.push({ file: a, label: pendingLabel || basename(a, '.json') });
  pendingLabel = null;
}
if (!inputs.length) {
  console.error('使い方: node tools/density.mjs [--label 名前] town.json [...]');
  process.exit(2);
}

const key = (x, y) => `${x},${y}`;
const deckCells = (p, a) => {
  if (!a?.deck) return null;
  const d = a.deck;
  const fx = p.x * 16, fy = p.y * 16;
  const x0 = Math.floor((fx + d[0]) / 16), x1 = Math.floor((fx + d[0] + d[2] - 1) / 16);
  const y0 = Math.floor((fy + d[1]) / 16), y1 = Math.floor((fy + d[1] + d[3] - 1) / 16);
  const cells = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push([x, y]);
  return cells;
};
const solidCells = (p, a) => {
  if (!a?.solids?.length) return null;
  const fx = Math.round(p.x * 16), fy = Math.round(p.y * 16);
  const opCols = new Set();
  if (a.opening) {
    for (let x = Math.floor((fx + a.opening[0]) / 16); x <= Math.floor((fx + a.opening[0] + a.opening[2] - 1) / 16); x++) opCols.add(x);
  }
  const cells = [];
  for (const s of a.solids) {
    const x0 = Math.floor((fx + s[0]) / 16), x1 = Math.floor((fx + s[0] + s[2] - 1) / 16);
    const y0 = Math.floor((fy + s[1]) / 16), y1 = Math.floor((fy + s[1] + s[3] - 1) / 16);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!opCols.has(x) && !cells.some(([cx, cy]) => cx === x && cy === y)) cells.push([x, y]);
    }
  }
  return cells;
};
const propCellsOf = (town) => {
  const cells = new Set();
  for (const p of town.props || []) {
    const a = propArt[p.look || p.type];
    const cells0 = deckCells(p, a) || solidCells(p, a);
    if (cells0) {
      for (const [x, y] of cells0) cells.add(key(x, y));
      continue;
    }
    if (p.type === 'boat') {
      cells.add(key(Math.floor(p.x), Math.floor(p.y - 0.01)));
      continue;
    }
    let [w, h] = propTiles(p.look || p.type, propArt);
    if (Number.isInteger(p.w) && p.w > 0) w = p.w;
    const tx = Math.floor(p.x - w / 2 + 0.5), ty = Math.round(p.y - h);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.add(key(tx + dx, ty + dy));
  }
  return cells;
};
const coverOf = (b) => {
  const variants = manifest.archetypes?.[b.archetype]?.variants || [];
  const v = variants.find((x) => x.id === b.variant) || variants[0];
  return Array.isArray(v?.cover) ? v.cover : null;
};

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

function plazaEdgeOf(town) {
  const { cols, rows, ground } = town;
  const plaza = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (ground[y]?.[x] === '+') plaza.push([x, y]);
  if (!plaza.length) return '0/0 (0.0%, 入口不明)';
  const x0 = Math.min(...plaza.map(([x]) => x)), x1 = Math.max(...plaza.map(([x]) => x));
  const y0 = Math.min(...plaza.map(([, y]) => y)), y1 = Math.max(...plaza.map(([, y]) => y));
  const edges = [
    { name: '北', cells: Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y0 - 1]), step: [0, -1] },
    { name: '南', cells: Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y1 + 1]), step: [0, 1] },
    { name: '西', cells: Array.from({ length: y1 - y0 + 1 }, (_, i) => [x0 - 1, y0 + i]), step: [-1, 0] },
    { name: '東', cells: Array.from({ length: y1 - y0 + 1 }, (_, i) => [x1 + 1, y0 + i]), step: [1, 0] },
  ];
  const paved = (x, y) => '#:+'.includes(ground[y]?.[x] ?? ' ');
  const building = (x, y) => town.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  const terrace = (x, y) => (town.terraces || []).some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
  const roadCount = (e) => e.cells.reduce((n, [x, y]) => n + (paved(x, y) ? 1 : 0), 0);
  const entry = [...edges].sort((a, b) => roadCount(b) - roadCount(a) || (b.name === '南') - (a.name === '南'))[0];
  let contact = 0, total = 0;
  for (const e of edges) {
    if (e === entry) continue;
    for (const [x, y] of e.cells) {
      total++;
      let touches = building(x, y) || terrace(x, y);
      for (let dx = -1; dx <= 1 && !touches; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (building(x + dx, y + dy) || terrace(x + dx, y + dy)) { touches = true; break; }
      }
      if (touches) contact++;
    }
  }
  return `${contact}/${total} (${(100 * contact / Math.max(1, total)).toFixed(1)}%, 入口${entry.name})`;
}

function measure(file) {
  const town = JSON.parse(readFileSync(file, 'utf8'));
  const { cols, rows, buildings, ground } = town;
  const props = propCellsOf(town);
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

  const gaps = [0, 0, 0, 0];
  const sorted = [...buildings].sort((a, b) => a.x - b.x || a.door.y - b.door.y || a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    let next = null;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.x < a.x + a.w) continue;
      if (Math.abs((b.door?.y ?? b.y + b.h - 1) - (a.door?.y ?? a.y + a.h - 1)) > 1) continue;
      next = b;
      break;
    }
    if (!next) continue;
    const gap = next.x - (a.x + a.w);
    // 4マス以上離れているものは同じ通りの「隣」ではなく、別の街区の建物として除く。
    // 旧規則の上限3マスだけを 3+ バケットに残し、その間の前面が舗装されているものに限る。
    if (gap < 0 || gap > 3) continue;
    if (gap >= 3) {
      const row = Math.round(((a.door?.y ?? a.y + a.h - 1) + (next.door?.y ?? next.y + next.h - 1)) / 2) + 1;
      if (![...Array(gap)].every((_, k) => '#:+'.includes(town.ground[row]?.[a.x + a.w + k] ?? ' '))) continue;
    }
    gaps[Math.min(gap, 3)]++;
  }

  const back = [0, 0, 0, 0];
  for (const b of buildings) {
    const cover = coverOf(b);
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

  const shade = new Uint8Array(cols * rows);
  for (const b of buildings) {
    const cover = coverOf(b);
    for (let dx = 0; dx < b.w; dx++) for (let j = 1; j <= (cover?.[dx] ?? 2); j++) {
      if (b.y - j >= 0) shade[(b.y - j) * cols + b.x + dx] = 1;
    }
  }
  const lawn = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (ground[y]?.[x] === '.' && !shade[y * cols + x] && !props.has(key(x, y)) && !foot.has(key(x, y))) lawn[y * cols + x] = 1;
  }
  const lawnMax = maxBareRect(lawn, cols, rows);
  const lawnOutput = execFileSync(process.execPath, [resolve(ROOT, 'tools/lawn.mjs'), file], { encoding: 'utf8' });
  const lawnMatch = lawnOutput.match(/最大\s+(\d+)\s+マス/);
  return {
    name: town.repo?.name || basename(file, '.json'),
    size: `${cols}×${rows}`,
    buildings: buildings.length,
    ratio: `${footprint}/${inside} (${(100 * footprint / Math.max(1, inside)).toFixed(1)}%)`,
    gaps: gaps.join('/'),
    back: back.join('/'),
    plazaEdge: plazaEdgeOf(town),
    lawnMax: lawnMatch ? Number(lawnMatch[1]) : lawnMax,
  };
}

for (const input of inputs) {
  const r = measure(resolve(input.file));
  console.log(`${input.label}: ${r.name} size=${r.size} 建物=${r.buildings} 占有=${r.ratio} 間0/1/2/3+=${r.gaps} 裏0/1/2/3+=${r.back} 広場辺=${r.plazaEdge} lawn最大=${r.lawnMax}`);
}
