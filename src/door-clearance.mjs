import { coverOf } from './town-grid.mjs';

// 扉のすぐ前2行、扉の幅＋左右1マス。生manifestとlayout用の定義で共有する。
export function doorClearance(b, art) {
  const a = art?.[b.archetype], vs = a?.variants || [];
  const v = vs.find((v) => v.id === b.variant) || vs[0] || a;
  const width = v?.door?.w ?? v?.doorW ?? a?.door?.w ?? 1;
  return { x0: b.door.x - 1, x1: b.door.x + width, y0: b.door.y + 1, y1: b.door.y + 2 };
}

export function doorClearanceConflicts(town, art) {
  const conflicts = [];
  for (const door of town.buildings || []) {
    const r = doorClearance(door, art);
    for (const b of town.buildings || []) {
      if (b === door) continue;
      const cover = coverOf(b, art);
      for (let x = Math.max(r.x0, b.x); x <= Math.min(r.x1, b.x + b.w - 1); x++) {
        const top = b.y - (cover?.[x - b.x] ?? 2);
        for (let y = Math.max(r.y0, top); y <= Math.min(r.y1, b.y + b.h - 1); y++) {
          conflicts.push({ door, x, y, kind: y < b.y ? 'cover' : 'footprint', object: b });
        }
      }
    }
  }
  return conflicts;
}

export function describeDoorConflict({ door, x, y, kind, object }) {
  return `建物 ${door.id} の戸口前の確保範囲 (${x},${y}) が 建物 ${object.id} (${object.archetype}) の ${kind} に重なる`;
}
