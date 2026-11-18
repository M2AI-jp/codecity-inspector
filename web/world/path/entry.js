// 入室の候補と検証をまとめ、扉の隙間を通る順序を保つ。
import { TILE } from '../../config.js';
import { feetPath } from './feet.js';

const T = TILE;

// 足元(x, y)から建物bの扉の内側への道筋。届かなければnull。
// 内側のtileが道案内の格子につながらないときは、扉の隙間まで進み、そこからまっすぐ入る。
export function pathInto(world, b, x, y, opts = { useCost: false }) {
  const target = b.doorInside || b.doorOutside;
  const sx = Math.floor(x / T), sy = Math.floor((y - 3) / T);
  let tiles = world.findPath(sx, sy, Math.floor(target.x / T), Math.floor((target.y - 3) / T), opts);
  if (!tiles && b.doorInside) {
    let best = null;
    for (let c = b.doorX0; c < b.doorX1; c++) {
      const t = world.findPath(sx, sy, c, b.doorY, opts);
      if (t && (!best || t.length < best.length)) best = t;
    }
    if (best) tiles = [...best, [Math.floor(target.x / T), Math.floor((target.y - 3) / T)]];
  }
  const points = tiles && world.smoothPath(x, y, tiles, target.x, target.y);
  let previous = { x, y };
  const clear = points && points.every((p) => {
    const free = world.sweepFree(previous.x, previous.y, p.x, p.y);
    previous = p;
    return free;
  });
  if (!clear) {
    // 1tileに1点の道案内では、角を曲がる細い通路を表せないことがある。
    // 扉内の目標へ格子の点を差し替えた最終区間も同じ当たりで確かめる。
    const points = feetPath(world, x, y, target.x, target.y);
    return points ? { target, points } : null;
  }
  return { target, points };
}
