// 近い空きマスの選び方を独立させ、同距離の候補を調べる順序を保つ。
// comp（navComp の番号）を渡すと、その塊のtileだけを候補にする。省略時（-1）は従来どおり。
export function nearestFree(world, tx, ty, maxR = 12, comp = -1) {
  const free = (x, y) => world.navFree(x, y) && (comp < 0 || world.navComp[y * world.cols + x] === comp);
  if (free(tx, ty)) return [tx, ty];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (free(tx + dx, ty + dy)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [tx + dx, ty + dy]; } }
    }
    if (best) return best;
  }
  return null;
}
