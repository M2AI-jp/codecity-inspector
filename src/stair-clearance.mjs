import { coverOf, propCells } from './town-grid.mjs';

// 全階段で共通: 階段の幅＋左右1マス、階段の行＋前後2行。
export function stairClearance(s) {
  return { x0: s.x - 1, x1: s.x + s.w, y0: s.y - 2, y1: s.y + 2 };
}

// 版の cover・小物の占有は ASCII / lawn と同じ定義。座標は入力の Town と同じ。
export function stairClearanceConflicts(town, art, propArt) {
  const conflicts = [];
  for (const [index, stair] of (town.stairs || []).entries()) {
    const r = stairClearance(stair);
    const add = (x, y, kind, object) => conflicts.push({ index, stair, x, y, kind, object });
    for (const b of town.buildings || []) {
      const cover = coverOf(b, art);
      for (let x = Math.max(r.x0, b.x); x <= Math.min(r.x1, b.x + b.w - 1); x++) {
        const top = b.y - (cover?.[x - b.x] ?? 2);
        for (let y = Math.max(r.y0, top); y <= Math.min(r.y1, b.y + b.h - 1); y++) {
          add(x, y, y < b.y ? 'cover' : 'footprint', b);
        }
      }
    }
    for (const p of town.props || []) for (const [x, y] of propCells(p, propArt)) {
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) add(x, y, 'prop', p);
    }
  }
  return conflicts;
}

export function describeStairConflict({ index, stair, x, y, kind, object }) {
  const target = kind === 'prop' ? `小物 ${object.type} (${object.x},${object.y})`
    : `建物 ${object.id} (${object.archetype}) の ${kind}`;
  return `階段 ${index + 1} (${stair.x},${stair.y},幅${stair.w}) の確保範囲 (${x},${y}) が ${target} に重なる`;
}
