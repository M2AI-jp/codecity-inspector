// 通過点の短縮を独立させ、遠い点から直進を試す順序を保つ。
// tileの経路をpxの通過点に変換し、直進できる区間をまとめて格子に沿った動きを減らす。
export function smoothPath(world, fromX, fromY, tiles, endX, endY) {
  const pts = tiles.map(([tx, ty]) => world.navPoint(tx, ty));
  if (endX !== undefined && pts.length) pts[pts.length - 1] = { x: endX, y: endY };
  const out = [];
  let cx = fromX, cy = fromY, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !world.sweepFree(cx, cy, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    cx = pts[j].x; cy = pts[j].y; i = j + 1;
  }
  return out;
}
