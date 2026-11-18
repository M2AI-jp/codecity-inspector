// Resolve pointer positions and route clicks through building entrances.
export function createWalking({ canvas, view, world, player }) {
  function handleClick(c) {
    const rect = canvas.getBoundingClientRect();
    walkToWorld(view.camX + (c.x - rect.left) / view.cssPerPx, view.camY + (c.y - rect.top) / view.cssPerPx);
  }
  function walkToWorld(wx, wy) {
    // clicking a building (footprint or the roof above it) walks you inside
    let best = null;
    for (const b of world.buildings) {
      const up = b.arch ? b.arch.exteriorOrigin[1] : 32;
      if (wx >= b.px && wx < b.px + b.pw && wy >= b.py - up && wy < b.bottomPx) {
        if (!best || b.bottomPx > best.bottomPx) best = b;
      }
    }
    // standing inside a building whose floor the tile graph does not link to its door: leave
    // straight through the door first (the way pathInto() comes in), then route from outside
    const cur = world.buildingAtPx(player.x, player.y);
    const exit = cur ? [{ x: cur.doorPx, y: Math.min(player.y, cur.bottomPx - 6) }, { x: cur.doorPx, y: cur.bottomPx + 9 }] : null;
    if (best && !(best.inside && wy >= best.py)) {
      let route = world.pathInto(best, player.x, player.y);
      if (!route && exit && best !== cur) {
        const r2 = world.pathInto(best, cur.doorOutside.x, cur.doorOutside.y);
        if (r2) route = { target: r2.target, points: [...exit, ...r2.points] };
      }
      if (route) player.setPath(route.points, route.target);
      return;
    }
    const route = world.pathTo(player.x, player.y, wx, wy);
    if (route) player.setPath(route.points, route.target);
  }

  return { handleClick, walkToWorld };
}
