import { facesOf } from './town-grid.mjs';

export const moduleGroup = (m) => typeof m?.group === 'string' ? m.group : undefined;

// footprint と周囲1 tile の和集合を4近傍で測る。道を遠回りしても地区はつながらない。
// 水・街の外・階段以外の段の縁・別の建物を halo に含めない。
export function groupComponents(town) {
  const { cols, rows, buildings } = town;
  const groups = new Map();
  for (const b of buildings) {
    const group = moduleGroup(b.module);
    if (group === undefined) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(b);
  }
  for (const u of town.unplaced || []) if (u.archetype === 'group' && typeof u.group === 'string' && !groups.has(u.group)) groups.set(u.group, []);
  if (!groups.size) return [];
  const foot = new Int32Array(cols * rows).fill(-1);
  buildings.forEach((b, i) => {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) foot[y * cols + x] = i;
  });
  const walls = new Set(facesOf(town).map(([x, y]) => y * cols + x));
  return [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([group, bs]) => {
    const cells = new Set(), owner = new Map();
    for (const b of bs) {
      for (let y = Math.max(0, b.y - 1); y <= Math.min(rows - 1, b.y + b.h); y++) {
        for (let x = Math.max(0, b.x - 1); x <= Math.min(cols - 1, b.x + b.w); x++) {
          const k = y * cols + x, other = buildings[foot[k]];
          const inside = x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
          if (!inside && (walls.has(k) || !'.#:+'.includes(town.ground[y]?.[x] ?? ' ') ||
            (other && moduleGroup(other.module) !== group))) continue;
          cells.add(k);
          if (inside) owner.set(k, b.id);
        }
      }
    }
    const components = [];
    while (cells.size) {
      const first = cells.values().next().value, q = [first], ids = new Set();
      cells.delete(first);
      for (let i = 0; i < q.length; i++) {
        const k = q[i], x = k % cols, y = Math.floor(k / cols);
        if (owner.has(k)) ids.add(owner.get(k));
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (cells.delete(n)) q.push(n);
        }
      }
      if (ids.size) components.push([...ids].sort());
    }
    return { group, buildings: bs.length, pieces: components.length, components };
  });
}

// 配置候補の安い幾何検査。最終の水路・段も含む検査は groupComponents が行う。
export function neighboringFootprints(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return dx <= 2 && dy <= 2 && dx + dy <= 3;
}
