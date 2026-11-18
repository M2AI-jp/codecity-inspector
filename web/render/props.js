// Props use the image and origin already resolved by World.
export function drawProp(ctx, p, camX, camY) {
  const d = p.def;
  if (d && d.image) {
    ctx.drawImage(d.image, p.x - d.origin[0] - camX, p.y - d.origin[1] - camY);
  }
}
