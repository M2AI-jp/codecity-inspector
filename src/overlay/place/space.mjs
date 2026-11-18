import { artFrom, buildWorld } from '../geometry.mjs';
import { reachGrid } from '../reach.mjs';
import { tileReach } from '../tile-reach.mjs';
import { navGuard } from '../nav-guard.mjs';
import { propCells, coverOf } from '../../town-grid.mjs';
import { loadProps } from '../../layout/manifest.mjs';
// 既存の占有・戸口・階段を先に予約し、後続の配置が同じ到達領域を守る。
export const xy = (x, y) => `${x},${y}`;

export function prepareSpace(S) {
  const { town, manifest } = S;
  const { world, start } = buildWorld(town, artFrom(manifest));
  const reach = reachGrid(world, start);
  // 1px の足元に加え、ゲームの道案内の格子でも出発点からの道を切り離さない（1px に通った候補だけ確かめる）。
  const keepNav = navGuard(town, manifest), pixelAttempt = reach.attempt;
  reach.attempt = (rects, test = () => true, commit = true) =>
    pixelAttempt(rects, (seen) => test(seen) && keepNav(rects, commit), commit);
  const propArt = loadProps(manifest), occupied = new Set(), reserved = new Set(), doors = new Set(), targets = [], addedRects = [], reservedRects = [];
  const keepTilePaths = tileReach(town, propArt);
  const reserve = (x0, y0, x1, y1, set = reserved) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set.add(xy(x, y));
  };
  for (const b of world.buildings) {
    const cover = coverOf(b.data, manifest.archetypes);
    for (let x = b.x; x < b.x + b.w; x++) reserve(x, b.y - (cover?.[x - b.x] ?? 2), x, b.y + b.h - 1, occupied);
    reserve(b.x, b.y + b.h, b.x + b.w - 1, b.y + b.h);
    reserve(b.doorX0 - 1, b.y + b.h, b.doorX1, b.y + b.h + 1);
  }
  for (const s of town.stairs || []) reserve(s.x - 1, s.y - 2, s.x + s.w, s.y + 2);
  for (const p of town.props) for (const [x, y] of propCells(p, propArt)) occupied.add(xy(x, y));
  reserve(Math.floor(start.x / 16), Math.floor(start.y / 16), Math.floor(start.x / 16), Math.floor(start.y / 16));
  for (const l of town.landmarks || []) if (l.keeper) {
    reserve(Math.floor(l.keeper.x), Math.floor(l.keeper.y), Math.floor(l.keeper.x), Math.floor(l.keeper.y), occupied);
  }
  const cellOK = (x, y) => x >= 0 && y >= 0 && x < town.cols && y < town.rows &&
    '.#:+'.includes(town.ground[y][x]) && !occupied.has(xy(x, y)) && !reserved.has(xy(x, y));
  const boxes = (p) => {
    const def = manifest.props[p.look || p.type];
    return (def?.solids || (def?.solid ? [def.solid] : [])).map(([x, y, w, h]) => ({ x: p.x * 16 + x, y: p.y * 16 + y, w, h }));
  };
  const clearRects = (rs) => rs.every((r) => !world.boxHits(r.x, r.y, r.x + r.w, r.y + r.h) &&
    ![...addedRects, ...reservedRects].some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y));
  const accessible = (seen, extra = []) => [...targets, ...extra].every((p) => reach.near(seen, p.x * 16, p.y * 16));
  const reject = (v, scope, reason, detail = {}) => town.unplaced.push({ overlay: true, scope, id: v.id, reason, ...detail });
  Object.assign(S, { world, reach, propArt, occupied, reserved, doors, targets, addedRects,
    reservedRects, keepTilePaths, cellOK, boxes, clearRects, accessible, reject });
}
