// Night lighting: a light buffer filled with a cool dark ambient, warm lights added on top,
// multiplied over the scene, followed by a subtle additive glow pass.

import { AMBIENT, AMBIENT_TINT, LIGHT_WARM, PLAYER_LIGHT_RADIUS } from './config.js';
import { noise1 } from './util.js';

const FL = { i: 1, r: 1 };

function lightSprite(size, rgb, falloff) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const stops = 12;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const a = Math.pow(1 - t, falloff);
    grad.addColorStop(t, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(4)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

// A pool of light on the ground: flat bright centre, soft edge (reads as a lit patch of street,
// not as a glow around the lamp head)
function poolSprite(size, rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = t < 0.38 ? 1 : Math.pow(1 - (t - 0.38) / 0.62, 1.7);
    grad.addColorStop(t, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(4)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export class Lighting {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    const a = AMBIENT;
    const mix = (k) => Math.round(255 * Math.min(1, a * k));
    this.ambient = `rgb(${mix(AMBIENT_TINT[0])},${mix(AMBIENT_TINT[1])},${mix(AMBIENT_TINT[2])})`;
    this.warm = lightSprite(128, LIGHT_WARM, 1.3);
    this.window = lightSprite(64, [255, 206, 140], 1.4);
    this.neutral = lightSprite(128, [205, 196, 186], 1.25);
    this.glow = lightSprite(64, [255, 170, 90], 2.2);
    this.interior = lightSprite(128, [255, 214, 160], 0.8);
    this.pool = poolSprite(128, [255, 206, 138]);
    this.poolGlow = poolSprite(64, [255, 178, 96]);
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  // per-light seeded flicker: ~10 Hz jitter + slow drift (flames/door lanterns), gentle drift for windows
  static flicker(light, t) {
    if (light.kind === 'flame' || light.kind === 'door' || light.kind === 'hearth') {
      const s = light.seed;
      const fast = noise1(t * 10.5 + s * 1.37, s) * 0.06 + noise1(t * 23 + s, s + 3) * 0.025;
      const slow = noise1(t * 0.6 + s * 0.71, s + 9) * 0.06;
      FL.i = 1 + fast + slow; FL.r = 1 + fast * 0.5 + slow * 0.4;
    } else if (light.kind === 'window') {
      FL.i = 1 + noise1(t * 0.35 + light.seed, light.seed + 5) * 0.04; FL.r = 1;
    } else { FL.i = 1; FL.r = 1; }
    return FL;
  }

  // scene: { world, camX, camY, vw, vh, t, player:{x,y}, npcs:[{rx,ry}] }
  render(target, s) {
    const { world, camX, camY, vw, vh, t } = s;
    const g = this.ctx;
    this.resize(vw, vh);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = this.ambient;
    g.fillRect(0, 0, vw, vh);
    g.globalCompositeOperation = 'lighter';

    // interior light of open buildings
    for (const b of world.buildings) {
      if (b.open <= 0.001) continue;
      const x = b.px - camX, y = b.py - camY;
      if (x > vw || y > vh || x + b.pw < 0 || y + b.ph < -48) continue;
      g.globalAlpha = 0.95 * b.open;
      g.drawImage(this.interior, x - b.pw * 0.25, y - 40 - b.ph * 0.2, b.pw * 1.5, b.ph * 1.4 + 48);
      g.globalAlpha = 0.35 * b.open;
      g.drawImage(this.interior, x - 6, y - 44, b.pw + 12, b.ph + 52);
    }

    for (const L of world.lights) {
      // interior lights (hearth, forge) burn only while their building is open
      const on = L.interior ? (L.building ? L.building.open : 0) : 1;
      if (on <= 0.001) continue;
      const f = Lighting.flicker(L, t);
      const r = L.r * f.r;
      const x = L.x - camX, y = L.poolY - camY;
      if (x + r < 0 || y + r < 0 || x - r > vw || y - r > vh) continue;
      if (L.kind === 'window') {
        g.globalAlpha = Math.min(1, 1.0 * f.i);
        g.drawImage(this.window, x - r, y - r, r * 2, r * 2);
      } else if (L.footY !== undefined) {
        // street lamp: a softer glow around the lamp, and a bright flattened pool on the ground at its foot
        g.globalAlpha = Math.min(1, 0.5 * f.i);
        const rg = r * 0.75;
        g.drawImage(this.warm, x - rg, y - rg, rg * 2, rg * 2);
        const px = r * 0.95 * f.r, py = r * 0.58 * f.r, fy = L.footY - camY - 3;
        g.globalAlpha = Math.min(1, 0.65 * f.i);
        g.drawImage(this.pool, x - px, fy - py, px * 2, py * 2);
      } else {
        // broad pool + hot core: strong enough to show the stone texture, ambient stays dark
        g.globalAlpha = Math.min(1, (L.kind === 'door' ? 0.8 : 1) * f.i) * on;
        g.drawImage(this.warm, x - r, y - r, r * 2, r * 2);
        const rc = r * 0.55;
        g.globalAlpha = Math.min(1, (L.kind === 'door' ? 0.35 : 0.55) * f.i) * on;
        g.drawImage(this.warm, x - rc, y - rc, rc * 2, rc * 2);
      }
    }

    // personal light so the player always reads clearly; NPCs get a faint one too
    const p = s.player;
    if (p) {
      const r = PLAYER_LIGHT_RADIUS;
      g.globalAlpha = 0.42;
      g.drawImage(this.neutral, p.rx - camX - r, p.ry - 12 - camY - r, r * 2, r * 2);
    }
    if (s.npcs) {
      g.globalAlpha = 0.22;
      for (const c of s.npcs) {
        const x = c.rx - camX, y = c.ry - 12 - camY;
        if (x < -30 || y < -30 || x > vw + 30 || y > vh + 30) continue;
        g.drawImage(this.neutral, x - 22, y - 22, 44, 44);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // composite
    target.globalCompositeOperation = 'multiply';
    target.drawImage(this.canvas, 0, 0);
    // glow pass (additive, subtle)
    target.globalCompositeOperation = 'lighter';
    // street lamps lift the ground under them above its base colour, so the pools read as lit patches
    for (const L of world.lights) {
      if (L.footY === undefined) continue;
      const f = Lighting.flicker(L, t);
      const px = L.r * 0.7 * f.r, py = L.r * 0.4 * f.r;
      const x = L.x - camX, y = L.footY - camY - 3;
      if (x + px < 0 || y + py < 0 || x - px > vw || y - py > vh) continue;
      // 地面は src/ground.mjs で月明かりに読める明るさにしてあるので、足し算の光だまりは控えめに（基準の広場の明るい所 131）
      target.globalAlpha = 0.1 * f.i;
      target.drawImage(this.poolGlow, x - px, y - py, px * 2, py * 2);
    }
    for (const L of world.lights) {
      if (L.kind === 'steady') continue;
      const on = L.interior ? (L.building ? L.building.open : 0) : 1;
      if (on <= 0.001) continue;
      const f = Lighting.flicker(L, t);
      const r = L.r * (L.kind === 'window' ? 0.45 : 0.55) * f.r;
      const x = L.x - camX, y = L.y - camY;
      if (x + r < 0 || y + r < 0 || x - r > vw || y - r > vh) continue;
      target.globalAlpha = (L.kind === 'window' ? 0.2 : L.kind === 'door' ? 0.16 : 0.22) * f.i * on;
      target.drawImage(this.glow, x - r, y - r, r * 2, r * 2);
    }
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
  }
}
