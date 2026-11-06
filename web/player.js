// The player: 8-direction movement (run by default, Shift walks), crisp acceleration,
// feet-box collision with axis-separated sliding and corner correction, click-to-walk paths.

import { RUN_SPEED, WALK_SPEED, ACCEL, DECEL, CORNER_SLIDE, FEET_W, FEET_H, FEET_UP } from './config.js';
import { Character, facingFrom } from './character.js';

const axis = { x: 0, y: 0 };

export class Player extends Character {
  constructor(x, y, sheet) {
    super(x, y, sheet);
    this.vx = 0; this.vy = 0;
    this.path = null; this.pi = 0;
    this.pathStuck = 0;
    this.pathGoal = null;
    this.blockers = null;   // dynamic feet boxes: array of characters with x,y (solid NPCs)
  }

  setPath(points, goal) {
    this.path = points && points.length ? points : null;
    this.pi = 0; this.pathStuck = 0; this.pathGoal = goal || null;
  }

  blocked(world, x, y) {
    if (world.feetHit(x, y)) return true;
    const list = this.blockers;
    if (list) {
      const hw = FEET_W / 2;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c.solid) continue;
        // NPC feet box is a little narrower so passing by feels generous; never trap the player
        // inside someone they already overlap
        if (x - hw < c.x + 5 && x + hw > c.x - 5 && y - FEET_UP < c.y + 2 && y - FEET_UP + FEET_H > c.y - 4 &&
            !(this.x - hw < c.x + 5 && this.x + hw > c.x - 5 && this.y - FEET_UP < c.y + 2 && this.y - FEET_UP + FEET_H > c.y - 4)) return true;
      }
    }
    return false;
  }

  update(dt, input, world) {
    this.beginStep();
    input.axis(axis);
    let dirX = axis.x, dirY = axis.y;
    const keyboard = dirX !== 0 || dirY !== 0;
    if (keyboard && this.path) this.setPath(null);
    let speed = input.slow ? WALK_SPEED : RUN_SPEED;

    let following = false;
    if (!keyboard && this.path) {
      let wp = this.path[this.pi];
      let dx = wp.x - this.x, dy = wp.y - this.y;
      let dist = Math.hypot(dx, dy);
      // intermediate waypoints are taken a little early so turns stay smooth, when the way on to
      // the next one is clear from here (else cutting the turn would catch a wall corner)
      while (this.path && dist < (this.pi < this.path.length - 1 ? 5 : 0.6) &&
        (this.pi === this.path.length - 1 || dist < 0.6 || world.sweepFree(this.x, this.y, this.path[this.pi + 1].x, this.path[this.pi + 1].y))) {
        this.pi++;
        if (this.pi >= this.path.length) { this.setPath(null); break; }
        wp = this.path[this.pi]; dx = wp.x - this.x; dy = wp.y - this.y; dist = Math.hypot(dx, dy);
      }
      if (this.path) {
        following = true;
        if (this.pi === this.path.length - 1) speed = Math.min(speed, Math.sqrt(2 * DECEL * 0.8 * dist) + 6);
        dirX = dx / (dist || 1); dirY = dy / (dist || 1);
      } else { dirX = dirY = 0; }
    } else if (keyboard && dirX && dirY) {
      dirX *= Math.SQRT1_2; dirY *= Math.SQRT1_2;
    }

    if (following) {
      // path steering: direction follows the path exactly, speed eases in/out
      const cur = Math.hypot(this.vx, this.vy);
      const ns = cur < speed ? Math.min(speed, cur + ACCEL * dt) : Math.max(speed, cur - DECEL * dt);
      this.vx = dirX * ns; this.vy = dirY * ns;
    } else {
      // keyboard: velocity toward target with bounded acceleration
      const tvx = dirX * speed, tvy = dirY * speed;
      const dvx = tvx - this.vx, dvy = tvy - this.vy;
      const dl = Math.hypot(dvx, dvy);
      const a = (dirX || dirY ? ACCEL : DECEL) * dt;
      if (dl <= a) { this.vx = tvx; this.vy = tvy; }
      else { this.vx += (dvx / dl) * a; this.vy += (dvy / dl) * a; }
    }

    if (dirX || dirY) this.facing = facingFrom(dirX, dirY, this.facing);

    // integrate in <=1px sub-steps, x then y, with sliding
    const mx = this.vx * dt, my = this.vy * dt;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my))));
    const sx = mx / n, sy = my / n;
    // (corner correction always applies while following a path: a path that grazes a door jamb or
    // a wall corner by a fraction of a pixel must slide past it, not stall against it)
    for (let i = 0; i < n; i++) {
      if (sx) this.moveAxis(world, sx, 0, dirY === 0 || following, Math.max(Math.abs(this.vx), following ? Math.abs(this.vy) : 0) * dt);
      if (sy) this.moveAxis(world, 0, sy, dirX === 0 || following, Math.max(Math.abs(this.vy), following ? Math.abs(this.vx) : 0) * dt);
    }

    if (this.path) {
      const moved = Math.hypot(this.x - this.prevX, this.y - this.prevY);
      this.pathStuck = moved < 0.05 ? this.pathStuck + dt : 0;
      if (this.pathStuck > 1.5) this.setPath(null);
    }
    this.animate(dt);
  }

  // Moves along one axis; on contact tries partial moves, then corner correction
  // (nudging perpendicular around wall corners / into door gaps) when allowed.
  moveAxis(world, dx, dy, allowCorner, budget) {
    const nx = this.x + dx, ny = this.y + dy;
    if (!this.blocked(world, nx, ny)) { this.x = nx; this.y = ny; return; }
    // partial move up to the contact
    let t = 0.5, best = 0;
    for (let k = 0; k < 4; k++) {
      if (!this.blocked(world, this.x + dx * t, this.y + dy * t)) { best = t; t += 0.5 ** (k + 2); } else t -= 0.5 ** (k + 2);
    }
    if (best > 0) { this.x += dx * best; this.y += dy * best; }
    if (allowCorner) {
      const step = Math.max(0.35, Math.min(1, budget));
      for (let o = 1; o <= CORNER_SLIDE; o++) {
        const freeA = dx ? !this.blocked(world, nx, this.y - o) : !this.blocked(world, this.x - o, ny);
        const freeB = dx ? !this.blocked(world, nx, this.y + o) : !this.blocked(world, this.x + o, ny);
        if (freeA === freeB) { if (freeA) break; continue; }
        const s = freeA ? -1 : 1;
        const tx = dx ? this.x : this.x + s * step, ty = dx ? this.y + s * step : this.y;
        if (!this.blocked(world, tx, ty)) { this.x = tx; this.y = ty; }
        return;
      }
    }
    if (dx) this.vx *= 0.5; else this.vy *= 0.5;
  }
}
