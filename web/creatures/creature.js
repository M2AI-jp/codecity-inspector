// One creature: initialization, simulation dispatch, interpolation, and the existing methods.
import { TILE } from '../config.js';
import { strHash, mulberry32 } from '../util.js';
import { free, spot, moveTo } from './movement.js';
import { pigeon, takeOff, flight, dog, cat } from './behavior.js';
import { draw, drawZ } from './render.js';

const T = TILE;

export class Creature {
  constructor(d, world, sheets) {
    this.d = d;
    this.kind = d.kind;
    this.name = d.name;
    this.world = world;
    this.sheet = sheets[d.sprite || d.kind] || null;
    this.fly = d.kind === 'pigeon' ? sheets['pigeon-fly'] || null : null;
    this.rand = mulberry32(strHash(`${d.kind}|${d.name}|${d.home.x},${d.home.y}`));
    this.hx = d.home.x * T; this.hy = d.home.y * T;
    this.x = this.prevX = this.rx = this.hx;
    this.y = this.prevY = this.ry = this.hy;
    this.z = this.prevZ = this.rz = 0;
    this.facing = ['left', 'right', 'down'][Math.floor(this.rand() * 3)];
    this.t = this.rand() * 10;              // animation clock
    this.state = d.sleeping ? 'nap' : 'rest';
    this.timer = 0.5 + this.rand() * 2;
    this.target = null;
    this.cool = 0;                          // seconds before it reacts to the player again
    this.flock = null;
  }

  get flying() { return this.z > 0.5 || this.state === 'fly'; }
  // high fliers draw above roofs (still under the night grade)
  get sortY() { return this.rz > 10 ? this.ry + 4096 : this.ry; }

  interpolate(a) {
    this.rx = this.prevX + (this.x - this.prevX) * a;
    this.ry = this.prevY + (this.y - this.prevY) * a;
    this.rz = this.prevZ + (this.z - this.prevZ) * a;
  }

  free(px, py) { return free(this, px, py); }
  spot(cx, cy, r, ax, ay, away = 0) { return spot(this, cx, cy, r, ax, ay, away); }
  moveTo(tx, ty, speed, dt) { return moveTo(this, tx, ty, speed, dt); }

  update(dt, p, all) {
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.t += dt;
    this.cool = Math.max(0, this.cool - dt);
    this.timer -= dt;
    const dx = this.x - p.x, dy = this.y - p.y, dist = Math.hypot(dx, dy);
    const speed = Math.hypot(p.vx || 0, p.vy || 0);
    if (this.kind === 'pigeon') this.pigeon(dt, p, dist, speed, all);
    else if (this.kind === 'dog') this.dog(dt, p, dist, speed);
    else this.cat(dt, p, dist);
  }

  pigeon(dt, p, dist, speed, all) { return pigeon(this, dt, p, dist, speed, all); }
  takeOff(p) { return takeOff(this, p); }
  flight(dt, p) { return flight(this, dt, p); }
  dog(dt, p, dist, speed) { return dog(this, dt, p, dist, speed); }
  cat(dt, p, dist) { return cat(this, dt, p, dist); }
  draw(ctx, camX, camY) { return draw(this, ctx, camX, camY); }
  drawZ(ctx, x, y) { return drawZ(this, ctx, x, y); }
}
