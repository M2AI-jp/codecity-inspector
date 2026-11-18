// クリック先の補正と経路の選択をまとめ、実座標の目的地を保つ。
import { TILE } from '../../config.js';
import { feetPath } from './feet.js';

const T = TILE;

// 床・地面へのクリック。実座標で空いている点を、tile内の代表点に置き換えない。
// 家具で分かれた同じtileの中や、格子で表せない細い通路も足元で確かめる。
export function pathTo(world, x, y, wx, wy) {
  let target = { x: wx, y: wy };
  if (world.feetHit(wx, wy)) {
    const free = world.nearestFree(Math.floor(wx / T), Math.floor((wy - 3) / T), 8);
    if (!free) return null;
    target = world.navPoint(...free);
  }
  if (world.sweepFree(x, y, target.x, target.y)) return { target, points: [target] };
  const tiles = world.findPath(Math.floor(x / T), Math.floor((y - 3) / T),
    Math.floor(target.x / T), Math.floor((target.y - 3) / T), { useCost: false });
  const points = tiles && world.smoothPath(x, y, tiles, target.x, target.y);
  let previous = { x, y };
  if (points && points.every((p) => {
    const free = world.sweepFree(previous.x, previous.y, p.x, p.y);
    previous = p;
    return free;
  })) return { target, points };
  const fine = feetPath(world, x, y, target.x, target.y);
  return fine ? { target, points: fine } : null;
}
