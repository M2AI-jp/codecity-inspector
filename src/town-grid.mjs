// Town の地面と物の占有を ASCII と芝生計測で共有する。座標・丸め方は CONTRACTS.md。
import { propTiles } from './layout/manifest.mjs';

const LETTER = { workshop: 'W', shop: 'S', house: 'H', ruin: 'R', town_hall: 'G', inn: 'Y', pub: 'P', warehouse: 'K', watchtower: 'M', dojo: 'D', dock: 'Q', repair: 'E' };
const PROP = { tree: 'T', bush: '*', barrel: 'o', crate: 'x', fence: '=', bench: 'n', lamp: 'i', well: 'O', noticeboard: 'N',
  sacks: '%', flowerpot: 'f', planter: 'v', cart: 'c', wellhouse: '&', pier: '|', boat: '^', 'bridge-h': '─', 'bridge-v': '│',
  'canal-mouth': '∩', scaffold: '!', 'sign-works': '$', 'sign-passed': '✓', 'sign-failed': '×', 'sign-unverified': '?', lumber: '_', gate: '[', castle: 'C' };
// 桟橋（deck のある小物）は水の上の板: 板の tile を数える。ほかは layout と同じ tile の大きさ
export function deckTiles(p, propArt) {
  const d = propArt[p.look || p.type]?.deck;
  if (!d) return null;
  const x0 = Math.floor((p.x * 16 + d[0]) / 16), x1 = Math.floor((p.x * 16 + d[0] + d[2] - 1) / 16);
  const y0 = Math.floor((p.y * 16 + d[1]) / 16), y1 = Math.floor((p.y * 16 + d[1] + d[3] - 1) / 16);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}
// 柱の箱（solids）のある小物（門）は、柱の tile だけ。くぐれる所（opening）の列は歩ける
function solidsTiles(p, propArt) {
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
}
export function propCells(p, propArt) {
  const deck = deckTiles(p, propArt);
  if (deck) return deck;
  const pil = solidsTiles(p, propArt);
  if (pil) return pil;
  if (p.type === 'boat') return [[Math.floor(p.x), Math.floor(p.y - 0.01)]];
  let [w, h] = propTiles(p.look || p.type, propArt);
  if (Number.isInteger(p.w) && p.w > 0) w = p.w;                  // layout が絵より細く場所を取った（足場）
  const tx = Math.floor(p.x - w / 2 + 0.5), ty = Math.round(p.y - h);
  const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([tx + dx, ty + dy]);
  return out;
}
export function coverOf(b, art) {
  const vs = art?.[b.archetype]?.variants || [];
  const v = vs.find((x) => x.id === b.variant) || vs[0];
  return Array.isArray(v?.cover) ? v.cover : null;
}

export const stairsOf = (town) => new Set((town.stairs || []).flatMap((s) => Array.from({ length: s.w }, (_, i) => `${s.x + i},${s.y}`)));
export function facesOf(town) {
  const stairs = stairsOf(town);
  return (town.terraces || []).flatMap((t) => Array.from({ length: t.w }, (_, i) => [t.x + i, t.y + t.h]))
    .filter(([x, y]) => !stairs.has(`${x},${y}`));
}

export function townGrid(town, propArt, { noProps = false, byDistrict = false } = {}) {
  const grid = town.ground.map((r) => [...r]);
  if (!noProps) for (const p of town.props) for (const [x, y] of propCells(p, propArt)) if (grid[y]?.[x] !== undefined) grid[y][x] = PROP[p.type] || '?';
  for (const l of town.landmarks || []) if (l.keeper && grid[Math.floor(l.keeper.y - 0.01)]?.[Math.floor(l.keeper.x)] !== undefined) grid[Math.floor(l.keeper.y - 0.01)][Math.floor(l.keeper.x)] = 'k';
  // 段の前の壁（階段の所を除く）
  const stairAt = stairsOf(town);
  const faceCells = facesOf(town);
  for (const [x, y] of faceCells) if (grid[y]?.[x] !== undefined) grid[y][x] = '"';
  for (const k of stairAt) { const [x, y] = k.split(',').map(Number); if (grid[y]?.[x] !== undefined) grid[y][x] = ';'; }
  const districts = [...new Set(town.buildings.map((b) => b.district))].sort();
  const DL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (const b of town.buildings) {
    const L = byDistrict ? DL[districts.indexOf(b.district) % DL.length] : LETTER[b.module.kind] || '?';
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) grid[y][x] = L;
    grid[b.door.y][b.door.x] = L.toLowerCase();
  }
  grid[town.spawn.y][town.spawn.x] = '@';
  return grid;
}
