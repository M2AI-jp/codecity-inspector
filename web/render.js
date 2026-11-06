// World renderer: pre-rendered ground, y-sorted buildings / props / characters, cutaway
// cross-fade, smoke, night lighting, and the debug overlay.

import { TILE, FEET_W, FEET_H, FEET_UP } from './config.js';
import { Lighting } from './lighting.js';

const T = TILE;
const B_KIND = 0, P_KIND = 1, C_KIND = 2;

function shadowSprite() {
  const c = document.createElement('canvas');
  c.width = 14; c.height = 5;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fillRect(3, 0, 8, 5); g.fillRect(1, 1, 12, 3); g.fillRect(0, 2, 14, 1);
  return c;
}

export class Renderer {
  constructor(canvas, world, ground, debug) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.ground = ground;
    this.debug = debug;
    this.lighting = new Lighting();
    this.shadow = shadowSprite();
    this.items = [];        // reusable draw list entries
    this.count = 0;
    this.sortFn = (a, b) => a.key - b.key || a.order - b.order;
    this.drawList = [];
  }

  push(key, kind, obj, order) {
    let e = this.items[this.count];
    if (!e) { e = { key: 0, kind: 0, obj: null, order: 0 }; this.items[this.count] = e; }
    e.key = key; e.kind = kind; e.obj = obj; e.order = order;
    this.count++;
  }

  render(s) {
    const ctx = this.ctx;
    const { vw, vh, camX, camY, world } = s;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#07080c';
    ctx.fillRect(0, 0, vw, vh);

    // ground (source rect clipped to the world)
    const sx = Math.max(0, camX), sy = Math.max(0, camY);
    const sw = Math.min(this.ground.width, camX + vw) - sx, sh = Math.min(this.ground.height, camY + vh) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(this.ground.canvas, sx, sy, sw, sh, sx - camX, sy - camY, sw, sh);

    // collect drawables
    this.count = 0;
    const x0 = camX - 8, y0 = camY - 8, x1 = camX + vw + 8, y1 = camY + vh + 96;
    for (const b of world.buildings) {
      const a = b.arch;
      const top = b.py - (a ? Math.max(a.exteriorOrigin[1], a.cutawayOrigin[1]) : 40);
      const left = b.px - (a ? Math.max(a.exteriorOrigin[0], a.cutawayOrigin[0]) : 0);
      const right = left + (a && a.exterior ? Math.max(a.exterior.width, b.pw) : b.pw + 16);
      if (right < x0 || left > x1 || b.bottomPx + 32 < y0 || top > y1) continue;
      const key = (b.inside || b.open > 0.5) ? b.py - 0.5 : b.bottomPx - 0.5;
      this.push(key, B_KIND, b, 0);
    }
    for (const p of world.props) {
      if (p.x < x0 - 48 || p.x > x1 + 48 || p.y < y0 || p.y > y1 + 32) continue;
      this.push(p.y, P_KIND, p, 1);
    }
    const chars = s.characters;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (c.rx < x0 - 32 || c.rx > x1 + 32 || c.ry < y0 || c.ry > y1 + 8) continue;
      this.push(c.ry, C_KIND, c, 2);
    }
    const list = this.drawList;
    list.length = this.count;
    for (let i = 0; i < this.count; i++) list[i] = this.items[i];
    list.sort(this.sortFn);

    let playerKey = -1, occluded = false;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.kind === B_KIND) {
        this.drawBuilding(ctx, e.obj, camX, camY);
        if (playerKey >= 0 && !occluded && this.covers(e.obj, s.player)) occluded = true;
      } else if (e.kind === P_KIND) this.drawProp(ctx, e.obj, camX, camY);
      else {
        this.drawCharacter(ctx, e.obj, camX, camY);
        if (e.obj === s.player) playerKey = e.key;
      }
    }
    this.lighting.render(ctx, s);

    // the player stays readable behind roofs: a ghost on top of whatever hides them, drawn after
    // the night grade so it is not darkened twice (the roof under it already is)
    if (occluded && s.player.sheet) this.drawGhost(ctx, s.player, camX, camY);

    // chimney smoke is drawn over the night grade so it reads as pale, moonlit wisps
    if (s.smoke) s.smoke.draw(ctx, camX, camY);

    if (this.debug) this.drawDebug(ctx, s);
  }

  drawBuilding(ctx, b, camX, camY) {
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
    if (!this.debug) return;
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

  drawProp(ctx, p, camX, camY) {
    const d = p.def;
    if (d && d.image) {
      ctx.drawImage(d.image, p.x - d.origin[0] - camX, p.y - d.origin[1] - camY);
    }
  }

  // does building b's image overlap the player's sprite box?
  covers(b, p) {
    const a = b.arch;
    if (!a || !a.exterior || b.open > 0.5) return false;
    const ix = b.px - a.exteriorOrigin[0], iy = b.py - a.exteriorOrigin[1];
    const x0 = p.rx - 10, x1 = p.rx + 10, y0 = p.ry - 26, y1 = p.ry;
    return x1 > ix && x0 < ix + a.exterior.width && y1 > iy && y0 < iy + a.exterior.height;
  }

  // a warm silhouette with the sprite faintly inside it: reads at a glance on any roof colour
  drawGhost(ctx, c, camX, camY) {
    const s = c.sheet, f = c.frame();
    const g = this.ghost || (this.ghost = document.createElement('canvas'));
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

  drawCharacter(ctx, c, camX, camY, noShadow) {
    const fx = Math.round(c.rx) - camX, fy = Math.round(c.ry) - camY;
    const s = c.sheet;
    if (!noShadow) ctx.drawImage(this.shadow, fx - 7, fy - 3);
    if (s) {
      const f = c.frame();
      ctx.drawImage(f.flip ? s.flipped : s.image, f.sx, f.sy, s.fw, s.fh, fx - s.px, fy - s.py, s.fw, s.fh);
    } else if (this.debug) {
      ctx.strokeStyle = c.isPlayer ? '#7cf29a' : '#7cc8f2';
      ctx.lineWidth = 1;
      ctx.strokeRect(fx - 5.5, fy - 21.5, 11, 22);
      ctx.strokeRect(fx - 3.5, fy - 27.5, 7, 7);
      const fd = c.facing;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(fx + (fd === 'left' ? -4 : fd === 'right' ? 2 : -1), fy - (fd === 'up' ? 28 : 25), 2, 2);
    }
  }

  drawDebug(ctx, s) {
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
      if (r.kind === 'wall') { ctx.fillStyle = 'rgba(255,60,60,0.28)'; ctx.fillRect(Math.round(x), Math.round(y), r.w, r.h); continue; }
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
}
