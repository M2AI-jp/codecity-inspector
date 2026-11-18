// Building exterior and interior cross-fade, including the debug stand-in.
import { TILE as T } from '../config.js';

export function drawBuilding(renderer, ctx, b, camX, camY) {
  const a = b.arch;
  const open = b.open;
  if (a && (a.exterior || a.cutaway)) {
    const ex = a.exterior, cu = a.cutaway;
    if (open > 0 && cu) {
      ctx.globalAlpha = Math.min(1, open * 2);
      ctx.drawImage(cu, b.px - a.cutawayOrigin[0] - camX, b.py - a.cutawayOrigin[1] - camY);
    }
    if (open < 1 && ex) {
      ctx.globalAlpha = cu ? 1 - open : 1;
      ctx.drawImage(ex, b.px - a.exteriorOrigin[0] - camX, b.py - a.exteriorOrigin[1] - camY);
    }
    ctx.globalAlpha = 1;
    return;
  }
  if (!renderer.debug) return;
  // debug stand-in so the layout and the cross-fade are inspectable without art
  const x = b.px - camX, y = b.py - camY;
  if (open > 0) {
    ctx.globalAlpha = Math.min(1, open * 2);
    ctx.fillStyle = '#5b4a3a'; ctx.fillRect(x, y + 2 * T, b.pw, b.ph - 2 * T);
    ctx.fillStyle = '#3c3a44'; ctx.fillRect(x, y - 8, b.pw, 2 * T + 8);
    ctx.fillStyle = '#2a2830';
    ctx.fillRect(x, y + 2 * T, T, b.ph - 3 * T); ctx.fillRect(x + b.pw - T, y + 2 * T, T, b.ph - 3 * T);
    ctx.fillRect(x, y + b.ph - T, (b.doorX0 - b.x) * T, T / 2);
    ctx.fillRect(x + (b.doorX1 - b.x) * T, y + b.ph - T, (b.x + b.w - b.doorX1) * T, T / 2);
  }
  if (open < 1) {
    ctx.globalAlpha = 1 - open;
    ctx.fillStyle = '#4a4552'; ctx.fillRect(x, y + T, b.pw, b.ph - T);           // facade
    ctx.fillStyle = '#6b3f36'; ctx.fillRect(x - 4, y - 24, b.pw + 8, 2 * T + 24 - 4);  // roof
    ctx.fillStyle = '#7d4a3f'; ctx.fillRect(x - 4, y - 24, b.pw + 8, 4);
    ctx.fillStyle = '#20161a';
    ctx.fillRect((b.doorX0) * T - camX, y + b.ph - T - 6, (b.doorX1 - b.doorX0) * T, T + 6);   // door hole
    ctx.fillStyle = '#c9a25a';
    for (let wx = b.x + 1; wx < b.x + b.w - 1; wx += 2) {
      if (wx >= b.doorX0 - 1 && wx < b.doorX1 + 1) continue;
      ctx.fillRect(wx * T - camX + 4, y + b.ph - T - 10, 6, 6);
    }
  }
  ctx.globalAlpha = 1;
}
