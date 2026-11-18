// Character sprites, per-renderer foot shadow and lazily allocated ghost canvas.
export function shadowSprite() {
  const c = document.createElement('canvas');
  c.width = 14; c.height = 5;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fillRect(3, 0, 8, 5); g.fillRect(1, 1, 12, 3); g.fillRect(0, 2, 14, 1);
  return c;
}

// Warm silhouette drawn after the night grade.
export function drawGhost(renderer, ctx, c, camX, camY) {
  const s = c.sheet, f = c.frame();
  const g = renderer.ghost || (renderer.ghost = document.createElement('canvas'));
  if (g.width !== s.fw || g.height !== s.fh) { g.width = s.fw; g.height = s.fh; }
  const gc = g.getContext('2d');
  gc.globalCompositeOperation = 'source-over';
  gc.clearRect(0, 0, g.width, g.height);
  gc.drawImage(f.flip ? s.flipped : s.image, f.sx, f.sy, s.fw, s.fh, 0, 0, s.fw, s.fh);
  gc.globalCompositeOperation = 'source-in';
  gc.fillStyle = '#ffe6b0';
  gc.fillRect(0, 0, g.width, g.height);
  const x = Math.round(c.rx) - camX - s.px, y = Math.round(c.ry) - camY - s.py;
  ctx.globalAlpha = 0.5;
  ctx.drawImage(g, x, y);
  ctx.globalAlpha = 0.45;
  ctx.drawImage(f.flip ? s.flipped : s.image, f.sx, f.sy, s.fw, s.fh, x, y, s.fw, s.fh);
  ctx.globalAlpha = 1;
}

export function drawCharacter(renderer, ctx, c, camX, camY, noShadow) {
  const fx = Math.round(c.rx) - camX, fy = Math.round(c.ry) - camY;
  const s = c.sheet;
  if (!noShadow) ctx.drawImage(renderer.shadow, fx - 7, fy - 3);
  if (s) {
    const f = c.frame();
    ctx.drawImage(f.flip ? s.flipped : s.image, f.sx, f.sy, s.fw, s.fh, fx - s.px, fy - s.py, s.fw, s.fh);
  } else if (renderer.debug) {
    ctx.strokeStyle = c.isPlayer ? '#7cf29a' : '#7cc8f2';
    ctx.lineWidth = 1;
    ctx.strokeRect(fx - 5.5, fy - 21.5, 11, 22);
    ctx.strokeRect(fx - 3.5, fy - 27.5, 7, 7);
    const fd = c.facing;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(fx + (fd === 'left' ? -4 : fd === 'right' ? 2 : -1), fy - (fd === 'up' ? 28 : 25), 2, 2);
  }
}
