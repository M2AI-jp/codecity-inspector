import { propTiles } from '../../src/layout.mjs';

export const key = (x, y) => `${x},${y}`;
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
export const propCellsOf = (town, propArt) => {
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
export const coverOf = (b, manifest) => {
  const variants = manifest.archetypes?.[b.archetype]?.variants || [];
  const v = variants.find((x) => x.id === b.variant) || variants[0];
  return Array.isArray(v?.cover) ? v.cover : null;
};
