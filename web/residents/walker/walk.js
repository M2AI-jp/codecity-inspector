// 歩行と主人公を待つ・よける処理をまとめ、座標の計算順を保つ。
import { TILE, RESIDENT_SPEED } from '../../config.js';
import { facingFrom } from '../../character.js';

const T = TILE;

export function walk(walker, dt, player) {
  if (!walker.path) { walker.state = 'look'; walker.timer = 1; return; }
  const wp = walker.path[walker.pi];
  const dx = wp.x - walker.x, dy = wp.y - walker.y;
  const dist = Math.hypot(dx, dy);
  const step = RESIDENT_SPEED * dt;
  if (dist <= step) {
    walker.x = wp.x; walker.y = wp.y; walker.pi++;
    if (walker.pi >= walker.path.length) {
      walker.path = null;
      const next = walker.after;
      if (next === 'door') { walker.state = 'door'; walker.timer = 0.8 + walker.rng() * 1.2; }
      else if (next === 'inside') { walker.state = 'inside'; walker.timer = 1.5 + walker.rng() * 2.5; walker.lookTimer = 0.3; }
      else { walker.state = 'look'; walker.timer = 1.5 + walker.rng() * 2.5; walker.lookTimer = 0.4; }
    }
    return;
  }
  const ux = dx / dist, uy = dy / dist;
  // stop and wait when the player stands in the way
  if (player) {
    const px = player.x - walker.x, py = player.y - walker.y;
    const ahead = px * ux + py * uy, side = Math.abs(px * uy - py * ux);
    if (ahead > 0 && ahead < 18 && side < 11) {
      walker.wait += dt;
      walker.facing = facingFrom(px, py, walker.facing);
      if (walker.wait > 2.2) {
        const w = walker.world;
        const last = walker.path[walker.path.length - 1];
        // going to where the player stands, or already went round once: give up and stay here
        // for a moment (otherwise everyone bound for that spot crowds round a player who stands still)
        if (walker.detours > 0 || Math.hypot(last.x - player.x, last.y - player.y) < 22) {
          walker.path = null; walker.wait = 0; walker.detours = 0; walker.gaveUp = true;
          walker.state = walker.after === 'inside' ? 'inside' : 'look';
          walker.timer = 1 + walker.rng() * 1.5; walker.lookTimer = 0.3;
          return;
        }
        walker.detours = 1;
        // try a path that avoids the player's tile
        const avoid = Math.floor(player.y / T - 0.2) * w.cols + Math.floor(player.x / T);
        const tiles = w.findPath(Math.floor(walker.x / T), Math.floor((walker.y - 3) / T), Math.floor(last.x / T), Math.floor((last.y - 3) / T), { avoid });
        if (tiles) {
          // keep the detour on tile centres (string-pulling would cut straight through the player)
          walker.path = tiles.map(([tx, ty]) => w.navPoint(tx, ty));
          walker.path[walker.path.length - 1] = { x: last.x, y: last.y };
          walker.pi = 0;
        }
        walker.wait = 0;
      }
      return;
    }
  }
  walker.wait = 0;
  walker.x += ux * step; walker.y += uy * step;
  walker.facing = facingFrom(ux, uy, walker.facing);
}
