// 近い空きマスの選び方を独立させ、同距離の候補を調べる順序を保つ。
export function nearestFree(world, tx, ty, maxR = 12) {
  if (world.navFree(tx, ty)) return [tx, ty];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (world.navFree(tx + dx, ty + dy)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [tx + dx, ty + dy]; } }
    }
    if (best) return best;
  }
  return null;
}
