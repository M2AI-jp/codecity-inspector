// Shared character state: position (feet), interpolation, facing, distance-driven walk cycle.

import { STRIDE_WALK, STRIDE_RUN, WALK_SPEED, RUN_SPEED } from './config.js';

export function facingFrom(dx, dy, current) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 1e-6 && ay < 1e-6) return current;
  const mx = Math.max(ax, ay);
  if (Math.abs(ax - ay) < 0.4 * mx) {
    // near-diagonal: keep the current facing when it is one of the two components
    if ((current === 'left' && dx < 0) || (current === 'right' && dx > 0) ||
        (current === 'up' && dy < 0) || (current === 'down' && dy > 0)) return current;
    return dx < 0 ? 'left' : 'right';
  }
  return ax > ay ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
}

export class Character {
  constructor(x, y, sheet) {
    this.x = x; this.y = y;
    this.prevX = x; this.prevY = y;
    this.rx = x; this.ry = y;        // render (interpolated) position
    this.sheet = sheet;
    this.facing = 'down';
    this.phase = 0;
    this.moving = false;
    this.stillTime = 0;
  }

  beginStep() { this.prevX = this.x; this.prevY = this.y; }

  // advance the walk cycle by the distance actually travelled this step
  animate(dt) {
    const dist = Math.hypot(this.x - this.prevX, this.y - this.prevY);
    const speed = dt > 0 ? dist / dt : 0;
    if (dist > 0.02 && speed > 6) {
      const t = Math.max(0, Math.min(1, (speed - WALK_SPEED * 0.5) / (RUN_SPEED - WALK_SPEED * 0.5)));
      const stride = STRIDE_WALK + (STRIDE_RUN - STRIDE_WALK) * t;
      if (!this.moving) this.phase = 0.5;      // first stride frame comes quickly
      this.phase += dist / stride;
      if (this.phase > 1e6) this.phase -= 1e6;
      this.moving = true;
      this.stillTime = 0;
    } else {
      this.stillTime += dt;
      if (this.stillTime > 0.03) { this.moving = false; this.phase = 0; }
    }
  }

  interpolate(alpha) {
    this.rx = this.prevX + (this.x - this.prevX) * alpha;
    this.ry = this.prevY + (this.y - this.prevY) * alpha;
  }

  frame() {
    const s = this.sheet;
    if (!s) return null;
    if (this.moving) {
      const list = s.anims.walk[this.facing];
      return list[Math.floor(this.phase) % list.length];
    }
    return s.anims.idle[this.facing][0];
  }
}
