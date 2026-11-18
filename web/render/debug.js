// Collision, building, light and character diagnostics.
import { TILE as T, FEET_W, FEET_H, FEET_UP } from '../config.js';

export function drawDebug(ctx, s) {
  const { world, camX, camY, vw, vh } = s;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  const tx0 = Math.max(0, Math.floor(camX / T)), ty0 = Math.max(0, Math.floor(camY / T));
  const tx1 = Math.min(world.cols - 1, Math.floor((camX + vw) / T)), ty1 = Math.min(world.rows - 1, Math.floor((camY + vh) / T));
  // solid tiles (walls, water, outside)
  ctx.fillStyle = 'rgba(255,60,60,0.16)';
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (world.tileSolid[ty * world.cols + tx]) ctx.fillRect(tx * T - camX, ty * T - camY, T, T);
  }
  for (const b of world.buildings) {
    const x = b.px - camX, y = b.py - camY;
    if (x > vw || y > vh || x + b.pw < 0 || y + b.ph < 0) continue;
    ctx.strokeStyle = b.inside ? '#ffffff' : '#ffd54a';
    ctx.strokeRect(x + 0.5, y + 0.5, b.pw - 1, b.ph - 1);
    ctx.strokeStyle = '#3ff0ff';
    ctx.strokeRect(b.doorX0 * T - camX + 0.5, b.doorY * T - camY + 0.5, (b.doorX1 - b.doorX0) * T - 1, T - 1);
    if (b.keeperSpot) { ctx.fillStyle = '#ff9cf0'; ctx.fillRect(b.keeperSpot.x - camX - 1, b.keeperSpot.y - camY - 1, 3, 3); }
    ctx.fillStyle = '#ffd54a';
    ctx.fillText(`${b.id} ${b.archetype}${b.arch ? '' : ' (no art)'}`, x + 2, y + 2);
  }
  for (const r of world.rects) {
    const x = r.x - camX, y = r.y - camY;
    if (x > vw || y > vh || x + r.w < 0 || y + r.h < 0) continue;
    if (r.kind === 'wall' || r.kind === 'water') { ctx.fillStyle = r.kind === 'water' ? 'rgba(60,140,255,0.3)' : 'rgba(255,60,60,0.28)'; ctx.fillRect(Math.round(x), Math.round(y), r.w, r.h); continue; }
    ctx.strokeStyle = r.kind === 'npc' ? '#ffb0f0' : r.kind === 'prop' ? '#ffa040' : '#ff4fd8';
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, r.w - 1), Math.max(1, r.h - 1));
  }
  ctx.strokeStyle = '#7dff9a';
  for (const b of world.buildings) {
    if (!b.floor) continue;
    const f = b.floor;
    ctx.strokeRect(f.x0 - camX + 0.5, f.y0 - camY + 0.5, f.x1 - f.x0 - 1, f.y1 - f.y0 - 1);
  }
  for (const p of world.props) {
    const x = p.x - camX, y = p.y - camY;
    if (x < -20 || y < -20 || x > vw + 20 || y > vh + 20) continue;
    ctx.fillStyle = p.def ? '#c6ff8a' : '#ff8a8a';
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    ctx.fillText(p.type, Math.round(x) + 3, Math.round(y) - 9);
  }
  ctx.strokeStyle = 'rgba(255,170,60,0.9)';
  for (const L of world.lights) {
    const x = L.x - camX, y = L.y - camY, py = L.poolY - camY;
    if (x + L.r < 0 || py + L.r < 0 || x - L.r > vw || py - L.r > vh) continue;
    ctx.beginPath(); ctx.arc(Math.round(x) + 0.5, Math.round(py) + 0.5, L.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffb347'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
  }
  // character feet boxes + paths
  for (const c of s.characters) {
    const fx = Math.round(c.rx) - camX, fy = Math.round(c.ry) - camY;
    ctx.strokeStyle = c.isPlayer ? '#5dff7a' : '#5db8ff';
    ctx.strokeRect(fx - FEET_W / 2 + 0.5, fy - FEET_UP + 0.5, FEET_W - 1, FEET_H - 1);
    const path = c.path;
    if (path && path.length) {
      ctx.beginPath(); ctx.moveTo(fx + 0.5, fy + 0.5);
      for (let i = c.pi || 0; i < path.length; i++) ctx.lineTo(Math.round(path[i].x - camX) + 0.5, Math.round(path[i].y - camY) + 0.5);
      ctx.stroke();
    }
    if (!c.isPlayer && c.name) { ctx.fillStyle = '#bfe3ff'; ctx.fillText(c.name, fx - 12, fy + 3); }
  }
  ctx.restore();
}
