import { DIRT, STREET, WATER, OUT } from '../constants.mjs';
import { propCells } from '../../town-grid.mjs';

// 建物を動かすための水路予約でも、固定施設の場所は奪わない。
// 水セルが施設を避けていても、橋の板と両岸の予約帯が屋根や前庭に
// 重なると、次の generate が船着場などを置けず格子全体を広げてしまう。
export function canalReservationProblem(S) {
  const { placed, bridgeProps, deckBounds, canalCells } = S;
  for (const bridge of bridgeProps) {
    const b = deckBounds(bridge.type, bridge.x, bridge.y);
    const horizontal = bridge.type === 'bridge-h';
    const x0 = b.x0 - (horizontal ? 2 : 0), x1 = b.x1 + (horizontal ? 2 : 0);
    const y0 = b.y0 - (horizontal ? 0 : 2), y1 = b.y1 + (horizontal ? 0 : 2);
    if (!placed.some((p) => p.spec.facility && x0 < p.x + p.w && x1 >= p.x &&
      y0 <= p.yb + 2 && y1 >= p.y - (p.spec.roofRows ?? 2))) continue;
    return {
      reason: '橋の予約帯が固定施設の建物・屋根・前庭に重なる',
      cells: canalCells.filter(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1),
    };
  }
  return null;
}

// 経路探索後に橋と水路口を寄せた結果も検査する。失敗した候補を採用せず、
// layout の既存の格子再試行へ戻す（地面への反映は成功時だけ）。
export function canalProblem(S) {
  const { bridgeProps, mouthProps, deckBounds, canalCells, crossings, g, id, inC, foot, propArt, buildingWalkRow } = S;
  const bounds = bridgeProps.map((p) => deckBounds(p.type, p.x, p.y));
  const failed = (reason, bounds) => ({
    reason,
    cells: canalCells.filter(([x, y]) => x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1),
  });
  for (const p of mouthProps) {
    const tiles = propCells(p, propArt);
    // 口は横2マスなので、東西向きの始点では水セルの外にもかかる。
    // adjustBridges が移動先を見つけられず元の口を残した場合も拒否する。
    if (tiles.some(([x, y]) => !inC(x, y) || foot[id(x, y)] >= 0 || g[id(x, y)] === OUT)) {
      return failed('水路の口を建物・街の外に重ねずに置けない', {
        x0: Math.min(...tiles.map(([x]) => x)), x1: Math.max(...tiles.map(([x]) => x)),
        y0: Math.min(...tiles.map(([, y]) => y)), y1: Math.max(...tiles.map(([, y]) => y)),
      });
    }
  }
  for (let i = 0; i < bounds.length; i++) {
    const a = bounds[i];
    for (let j = i + 1; j < bounds.length; j++) {
      const b = bounds[j];
      const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
      const dy = Math.max(a.y0 - b.y1, b.y0 - a.y1, 0);
      if (dx + dy <= 1) return failed('補正後の橋の板が重なるか縦横に隣接する', a);
    }
    for (let y = a.y0; y <= a.y1; y++) for (let x = a.x0; x <= a.x1; x++) {
      if (!inC(x, y) || foot[id(x, y)] >= 0 || g[id(x, y)] === OUT) return failed('橋の板を建物・街の外に重ねずに置けない', a);
    }
    const p = bridgeProps[i];
    const horizontal = p.type === 'bridge-h';
    for (let y = a.y0 - (horizontal ? 0 : 2); y <= a.y1 + (horizontal ? 0 : 2); y++) {
      for (let x = a.x0 - (horizontal ? 2 : 0); x <= a.x1 + (horizontal ? 2 : 0); x++) {
        if (x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1) continue;
        if (!inC(x, y) || foot[id(x, y)] >= 0 || [WATER, OUT].includes(g[id(x, y)])) return failed('橋の両岸に歩き出す余地がない', a);
      }
    }
    for (const [sx, sy, w, h] of propArt[p.type].solids || []) {
      for (let y = Math.floor(p.y + sy / 16); y <= Math.floor(p.y + (sy + h - 1) / 16); y++) {
        for (let x = Math.floor(p.x + sx / 16); x <= Math.floor(p.x + (sx + w - 1) / 16); x++) {
          if (!inC(x, y) || foot[id(x, y)] >= 0 || buildingWalkRow[id(x, y)]) return failed('橋の欄干が建物または扉の前をふさぐ', a);
        }
      }
    }
    const c = crossings.find((c) => c.bridge === p.type && c.x >= a.x0 && c.x <= a.x1 && c.y >= a.y0 && c.y <= a.y1);
    if (!c) return failed('橋の板に対応する交差点がない', a);
    const ends = p.type === 'bridge-h' ? [[a.x0, c.y], [a.x1, c.y]] : [[c.x, a.y0], [c.x, a.y1]];
    if (ends.some(([x, y]) => ![STREET, DIRT].includes(g[id(x, y)]))) return failed('橋の両端が岸の通りに乗らない', a);
  }
  for (const [x, y] of canalCells) {
    if (g[id(x, y)] !== WATER) return { reason: '水路のセルが水でなくなった', cells: [[x, y]] };
    if (crossings.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) <= 2)) continue;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (inC(nx, ny) && [STREET, DIRT].includes(g[id(nx, ny)])) return { reason: '橋の交差部以外で水路が通りの脇を流れる', cells: [[x, y]] };
    }
  }
  return null;
}
