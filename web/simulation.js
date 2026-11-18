// One fixed simulation step: movement, cutaways, inhabitants, then smoke.
import { CUTAWAY_FADE } from './config.js';

export function createSimulation({ input, player, world, npcs, creatures, movers, view, smoke, handleClick }) {
  let time = 0;
  let current = null;
  const viewRect = { x: 0, y: 0, w: 0, h: 0 };
  let playerMoved = false;

  function update(dt) {
    time += dt;
    while (input.clicks.length) handleClick(input.clicks.shift());
    player.update(dt, input, world);
    playerMoved = player.moving;
    // someone standing in the player's way steps aside for a moment (the town is crowded; a click
    // path or a held key should never stall against a townsperson)
    const h = input.held;
    if ((player.path || h.up || h.down || h.left || h.right) && Math.hypot(player.x - player.prevX, player.y - player.prevY) < 0.05) {
      for (const w of movers) if (Math.abs(w.x - player.x) < 20 && Math.abs(w.y - player.y) < 16) w.yieldT = 1.2;
    }

    // which building are the player's feet in? (door gap or interior)
    const b = world.buildingAtPx(player.x, player.y);
    current = b;
    for (const bb of world.buildings) {
      bb.inside = bb === b;
      const target = bb.inside ? 1 : 0;
      if (bb.open !== target) {
        const step = dt / CUTAWAY_FADE;
        bb.open = target > bb.open ? Math.min(1, bb.open + step) : Math.max(0, bb.open - step);
      }
    }
    for (const k of npcs.keepers) k.update(dt, player);
    creatures.update(dt, player);
    for (const w of movers) {
      w.update(dt, player);
      // residents are solid on the street, but never while pausing at / passing through a door or
      // inside, and not once they have waited a while for the player
      if (w.yieldT > 0) w.yieldT -= dt;
      w.solid = w.state !== 'door' && w.state !== 'inside' && !world.buildingAtPx(w.x, w.y) && w.wait < 0.5 && !(w.yieldT > 0);
    }
    viewRect.x = view.camX; viewRect.y = view.camY; viewRect.w = view.vw; viewRect.h = view.vh;
    smoke.update(dt, time, viewRect);
  }

  return { update, get time() { return time; }, get current() { return current; }, get playerMoved() { return playerMoved; } };
}
