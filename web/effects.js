// Chimney smoke: a fixed particle pool fed by archetype `smoke` points (footprint-relative px).

import { mulberry32, noise1 } from './util.js';

const MAX = 320;

export class Smoke {
  constructor(world) {
    this.emitters = [];
    for (const b of world.buildings) {
      if (!b.arch || !b.arch.smoke) continue;
      b.arch.smoke.forEach((pt, i) => {
        if (Array.isArray(pt) && pt.length >= 2) this.emitters.push({ x: b.px + pt[0], y: b.py + pt[1], acc: i * 0.13, seed: b.index * 7 + i });
      });
    }
    this.x = new Float32Array(MAX); this.y = new Float32Array(MAX);
    this.vx = new Float32Array(MAX); this.vy = new Float32Array(MAX);
    this.life = new Float32Array(MAX); this.max = new Float32Array(MAX);
    this.n = 0;
    this.rng = mulberry32(77);
  }

  update(dt, t, view) {
    const rng = this.rng;
    for (const e of this.emitters) {
      if (e.x < view.x - 80 || e.x > view.x + view.w + 80 || e.y < view.y - 40 || e.y > view.y + view.h + 140) continue;
      e.acc += dt;
      const period = 0.32 + 0.1 * noise1(t * 0.5, e.seed);
      while (e.acc > period) {
        e.acc -= period;
        if (this.n >= MAX) break;
        const i = this.n++;
        this.x[i] = e.x + (rng() - 0.5) * 3; this.y[i] = e.y;
        this.vx[i] = 3 + rng() * 3; this.vy[i] = -(9 + rng() * 5);
        this.life[i] = 0; this.max[i] = 2.8 + rng() * 1.6;
      }
    }
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) {
        const j = --this.n;
        this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
        this.life[i] = this.life[j]; this.max[i] = this.max[j];
        i--; continue;
      }
      const sway = noise1(t * 0.8 + i * 0.37, 3) * 6;
      this.x[i] += (this.vx[i] + sway) * dt;
      this.y[i] += this.vy[i] * dt;
      this.vy[i] *= 1 - 0.18 * dt;
    }
  }

  draw(ctx, camX, camY) {
    for (let i = 0; i < this.n; i++) {
      const k = this.life[i] / this.max[i];
      const size = k < 0.25 ? 1 : k < 0.6 ? 2 : 3;
      const a = (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9) * 0.26;
      ctx.globalAlpha = a;
      ctx.fillStyle = k < 0.4 ? '#a9b0c4' : '#8a90a6';
      ctx.fillRect(Math.round(this.x[i] - camX - size / 2), Math.round(this.y[i] - camY - size / 2), size, size);
    }
    ctx.globalAlpha = 1;
  }
}
