// Ground, visible draw list, stable y order, then lighting, ghost, smoke and debug.
const B_KIND = 0, P_KIND = 1, C_KIND = 2;

export function push(renderer, key, kind, obj, order) {
  let e = renderer.items[renderer.count];
  if (!e) { e = { key: 0, kind: 0, obj: null, order: 0 }; renderer.items[renderer.count] = e; }
  e.key = key; e.kind = kind; e.obj = obj; e.order = order;
  renderer.count++;
}

export function render(renderer, s) {
  const ctx = renderer.ctx;
  const { vw, vh, camX, camY, world } = s;
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#07080c';
  ctx.fillRect(0, 0, vw, vh);

  // ground (source rect clipped to the world)
  const sx = Math.max(0, camX), sy = Math.max(0, camY);
  const sw = Math.min(renderer.ground.width, camX + vw) - sx, sh = Math.min(renderer.ground.height, camY + vh) - sy;
  if (sw > 0 && sh > 0) ctx.drawImage(renderer.ground.canvas, sx, sy, sw, sh, sx - camX, sy - camY, sw, sh);

  // collect drawables
  renderer.count = 0;
  const x0 = camX - 8, y0 = camY - 8, x1 = camX + vw + 8, y1 = camY + vh + 96;
  // ground-layer props (pier decks, a moored boat) lie under everyone: drawn right after the ground
  for (const p of world.props) {
    if (p.layer !== 'ground' || p.x < x0 - 96 || p.x > x1 + 96 || p.y < y0 - 96 || p.y > y1 + 96) continue;
    renderer.drawProp(ctx, p, camX, camY);
  }
  for (const b of world.buildings) {
    const a = b.arch;
    const top = b.py - (a ? Math.max(a.exteriorOrigin[1], a.cutawayOrigin[1]) : 40);
    const left = b.px - (a ? Math.max(a.exteriorOrigin[0], a.cutawayOrigin[0]) : 0);
    const right = left + (a && a.exterior ? Math.max(a.exterior.width, b.pw) : b.pw + 16);
    if (right < x0 || left > x1 || b.bottomPx + 32 < y0 || top > y1) continue;
    const key = (b.inside || b.open > 0.5) ? b.py - 0.5 : b.bottomPx - 0.5;
    renderer.push(key, B_KIND, b, 0);
  }
  for (const p of world.props) {
    if (p.layer === 'ground' || p.x < x0 - 48 || p.x > x1 + 48 || p.y < y0 || p.y > y1 + 32) continue;
    renderer.push(p.y, P_KIND, p, 1);
  }
  const chars = s.characters;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c.rx < x0 - 32 || c.rx > x1 + 32 || c.ry < y0 || c.ry > y1 + 8) continue;
    renderer.push(c.sortY !== undefined ? c.sortY : c.ry, C_KIND, c, 2);   // flying creatures sort above roofs
  }
  const list = renderer.drawList;
  list.length = renderer.count;
  for (let i = 0; i < renderer.count; i++) list[i] = renderer.items[i];
  list.sort(renderer.sortFn);

  let playerKey = -1, occluded = false;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.kind === B_KIND) {
      renderer.drawBuilding(ctx, e.obj, camX, camY);
      if (playerKey >= 0 && !occluded && renderer.covers(e.obj, s.player)) occluded = true;
    } else if (e.kind === P_KIND) {
      renderer.drawProp(ctx, e.obj, camX, camY);
      if (playerKey >= 0 && !occluded && renderer.coversProp(e.obj, s.player)) occluded = true;
    }
    else if (e.obj.draw) e.obj.draw(ctx, camX, camY);          // creatures draw themselves (web/creatures.js)
    else {
      renderer.drawCharacter(ctx, e.obj, camX, camY);
      if (e.obj === s.player) playerKey = e.key;
    }
  }
  renderer.lighting.render(ctx, s);

  // the player stays readable behind roofs: a ghost on top of whatever hides them, drawn after
  // the night grade so it is not darkened twice (the roof under it already is)
  if (occluded && s.player.sheet) renderer.drawGhost(ctx, s.player, camX, camY);

  // chimney smoke is drawn over the night grade so it reads as pale, moonlit wisps
  if (s.smoke) s.smoke.draw(ctx, camX, camY);

  if (renderer.debug) renderer.drawDebug(ctx, s);
}
