// Keep the public development handle and its property order unchanged.
export function exposeInspection({ town, art, world, ground, player, npcs, creatures, view, cam, ui, input, overlay, loop, walkToWorld }) {
  window.__codecity = {
    town, art, world, ground, player, npcs, creatures, view, cam, ui, input, overlay,
    step: loop.step,
    renderNow: loop.renderNow,
    frames: loop.frames,
    hold(dir, on = true) { input.held[dir] = on; },
    release() { input.clear(); },
    walkTo(wx, wy) { walkToWorld(wx, wy); return player.path; },
    teleport(px, py) { player.x = player.prevX = px; player.y = player.prevY = py; player.vx = player.vy = 0; },
  };
}
