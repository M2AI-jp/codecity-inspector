// 室内の行き先を選ぶ処理を分け、番人の場所を避ける順を保つ。

export function wanderInside(walker) {
  const b = walker.insideBuilding, w = walker.world;
  for (let k = 0; k < 8; k++) {
    const t = b.interior[Math.floor(walker.rng() * b.interior.length)];
    if (w.nav[t]) continue;
    if (b.keeperSpot && t === b.keeperSpot.ty * w.cols + b.keeperSpot.tx) continue;
    const tx = t % w.cols, ty = (t / w.cols) | 0;
    const p = w.navPoint(tx, ty);
    if (walker.goTo(p.x, p.y, 'inside')) return;
  }
  walker.state = 'inside'; walker.timer = 1.5;
}
