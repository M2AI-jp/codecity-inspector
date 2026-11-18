// 状態の切り替えをまとめ、継承先のメソッドを同じ順で呼ぶ。

export function update(walker, dt, player) {
  walker.beginStep();
  switch (walker.state) {
    case 'walk': walker.walk(dt, player); break;
    case 'door': // pause at the door, facing it
      walker.facing = 'up';
      walker.timer -= dt;
      if (walker.timer <= 0) {
        const b = walker.homes[walker.homeIdx];
        if (b.doorInside && b.interior.length && walker.rng() < 0.75) {
          walker.insideBuilding = b; walker.wanderLeft = 1 + Math.floor(walker.rng() * 2);
          walker.wanderInside();
        } else { walker.state = 'look'; walker.timer = 1.5 + walker.rng() * 2; walker.lookTimer = 0; }
      }
      break;
    case 'inside':
      walker.timer -= dt;
      walker.idleLook(dt);
      if (walker.timer <= 0) {
        if (walker.wanderLeft-- > 0) walker.wanderInside();
        else {
          const b = walker.insideBuilding; walker.insideBuilding = null;
          if (!walker.goTo(b.doorOutside.x, b.doorOutside.y, 'look')) { walker.state = 'look'; walker.timer = 1; }
        }
      }
      break;
    case 'look':
    default:
      walker.timer -= dt;
      walker.idleLook(dt);
      if (walker.timer <= 0) walker.pickNext();
      break;
  }
  walker.animate(dt);
}
