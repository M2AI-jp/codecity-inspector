// 行き先の選択と経路の開始をまとめ、乱数と探索の順を保つ。
import { TILE } from '../../config.js';

const T = TILE;

export function goTo(walker, px, py, then) {
  const w = walker.world;
  const tiles = w.findPath(Math.floor(walker.x / T), Math.floor((walker.y - 3) / T), Math.floor(px / T), Math.floor((py - 3) / T));
  if (!tiles) { walker.path = null; return false; }
  walker.path = w.smoothPath(walker.x, walker.y, tiles, px, py);
  walker.pi = 0; walker.state = 'walk'; walker.after = then; walker.wait = 0; walker.detours = 0; walker.gaveUp = false;
  return true;
}

export function pickNext(walker) {
  const w = walker.world;
  if (walker.homes.length > 1) {
    let i = Math.floor(walker.rng() * (walker.homes.length - 1));
    if (i >= walker.homeIdx) i++;
    walker.homeIdx = i;
  }
  const b = walker.homes[walker.homeIdx];
  if (walker.homes.length === 1 && walker.rng() < 0.5) {
    // stroll somewhere on the street near home and come back later
    for (let k = 0; k < 12; k++) {
      const tx = Math.floor(b.doorOutside.x / T) + Math.floor((walker.rng() - 0.5) * 20);
      const ty = Math.floor(b.doorOutside.y / T) + Math.floor((walker.rng() - 0.5) * 14);
      if (w.navFree(tx, ty) && !w.buildingAtPx(tx * T + 8, ty * T + 8) && w.cost[ty * w.cols + tx] <= 1.35) {
        const p = w.navPoint(tx, ty);
        if (walker.goTo(p.x, p.y, 'look')) return;
      }
    }
  }
  if (!walker.goTo(b.doorOutside.x, b.doorOutside.y, 'door')) { walker.state = 'look'; walker.timer = 2 + walker.rng() * 2; }
}
