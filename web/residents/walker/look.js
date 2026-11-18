// 見回す間隔と向きの選択をまとめ、乱数の消費順を保つ。
const DIRS4 = ['down', 'left', 'right', 'up'];

export function idleLook(walker, dt) {
  walker.lookTimer -= dt;
  if (walker.lookTimer <= 0) {
    walker.lookTimer = 0.8 + walker.rng() * 1.6;
    if (walker.rng() < 0.6) walker.facing = DIRS4[Math.floor(walker.rng() * 3)];
  }
}
