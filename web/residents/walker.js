// コミットした人と外部工務店の代理人が、建物のあいだを歩く。
import { TILE, RESIDENT_SPEED } from '../config.js';
import { Character, facingFrom } from '../character.js';
import { mulberry32 } from '../util.js';

const T = TILE;
const DIRS4 = ['down', 'left', 'right', 'up'];

export class Walker extends Character {
  constructor(def, sheet, world, homes, seed) {
    super(0, 0, sheet);
    this.def = def;
    this.name = def.name || '?';
    this.commits = def.commits | 0;
    this.world = world;
    this.homes = homes;
    this.rng = mulberry32(seed);
    this.homeIdx = Math.floor(this.rng() * homes.length);
    this.state = 'look';
    this.timer = 0.5 + this.rng() * 2;
    this.path = null; this.pi = 0;
    this.wait = 0;
    this.lookTimer = 0;
    this.insideBuilding = null;
    this.wanderLeft = 0;
    this.solid = false;
    const b = homes[this.homeIdx];
    const start = world.nearestFree(Math.floor(b.doorOutside.x / T) + Math.floor(this.rng() * 5) - 2, Math.floor(b.doorOutside.y / T) + 1 + Math.floor(this.rng() * 2), 6);
    if (start) { const p = world.navPoint(start[0], start[1]); this.x = p.x; this.y = p.y; } else { this.x = b.doorOutside.x; this.y = b.doorOutside.y; }
    this.prevX = this.x; this.prevY = this.y; this.rx = this.x; this.ry = this.y;
    this.facing = DIRS4[Math.floor(this.rng() * 4)];
  }

  goTo(px, py, then) {
    const w = this.world;
    const tiles = w.findPath(Math.floor(this.x / T), Math.floor((this.y - 3) / T), Math.floor(px / T), Math.floor((py - 3) / T));
    if (!tiles) { this.path = null; return false; }
    this.path = w.smoothPath(this.x, this.y, tiles, px, py);
    this.pi = 0; this.state = 'walk'; this.after = then; this.wait = 0; this.detours = 0; this.gaveUp = false;
    return true;
  }

  pickNext() {
    const w = this.world;
    if (this.homes.length > 1) {
      let i = Math.floor(this.rng() * (this.homes.length - 1));
      if (i >= this.homeIdx) i++;
      this.homeIdx = i;
    }
    const b = this.homes[this.homeIdx];
    if (this.homes.length === 1 && this.rng() < 0.5) {
      // stroll somewhere on the street near home and come back later
      for (let k = 0; k < 12; k++) {
        const tx = Math.floor(b.doorOutside.x / T) + Math.floor((this.rng() - 0.5) * 20);
        const ty = Math.floor(b.doorOutside.y / T) + Math.floor((this.rng() - 0.5) * 14);
        if (w.navFree(tx, ty) && !w.buildingAtPx(tx * T + 8, ty * T + 8) && w.cost[ty * w.cols + tx] <= 1.35) {
          const p = w.navPoint(tx, ty);
          if (this.goTo(p.x, p.y, 'look')) return;
        }
      }
    }
    if (!this.goTo(b.doorOutside.x, b.doorOutside.y, 'door')) { this.state = 'look'; this.timer = 2 + this.rng() * 2; }
  }

  update(dt, player) {
    this.beginStep();
    switch (this.state) {
      case 'walk': this.walk(dt, player); break;
      case 'door': // pause at the door, facing it
        this.facing = 'up';
        this.timer -= dt;
        if (this.timer <= 0) {
          const b = this.homes[this.homeIdx];
          if (b.doorInside && b.interior.length && this.rng() < 0.75) {
            this.insideBuilding = b; this.wanderLeft = 1 + Math.floor(this.rng() * 2);
            this.wanderInside();
          } else { this.state = 'look'; this.timer = 1.5 + this.rng() * 2; this.lookTimer = 0; }
        }
        break;
      case 'inside':
        this.timer -= dt;
        this.idleLook(dt);
        if (this.timer <= 0) {
          if (this.wanderLeft-- > 0) this.wanderInside();
          else {
            const b = this.insideBuilding; this.insideBuilding = null;
            if (!this.goTo(b.doorOutside.x, b.doorOutside.y, 'look')) { this.state = 'look'; this.timer = 1; }
          }
        }
        break;
      case 'look':
      default:
        this.timer -= dt;
        this.idleLook(dt);
        if (this.timer <= 0) this.pickNext();
        break;
    }
    this.animate(dt);
  }

  wanderInside() {
    const b = this.insideBuilding, w = this.world;
    for (let k = 0; k < 8; k++) {
      const t = b.interior[Math.floor(this.rng() * b.interior.length)];
      if (w.nav[t]) continue;
      if (b.keeperSpot && t === b.keeperSpot.ty * w.cols + b.keeperSpot.tx) continue;
      const tx = t % w.cols, ty = (t / w.cols) | 0;
      const p = w.navPoint(tx, ty);
      if (this.goTo(p.x, p.y, 'inside')) return;
    }
    this.state = 'inside'; this.timer = 1.5;
  }

  idleLook(dt) {
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 0.8 + this.rng() * 1.6;
      if (this.rng() < 0.6) this.facing = DIRS4[Math.floor(this.rng() * 3)];
    }
  }

  walk(dt, player) {
    if (!this.path) { this.state = 'look'; this.timer = 1; return; }
    const wp = this.path[this.pi];
    const dx = wp.x - this.x, dy = wp.y - this.y;
    const dist = Math.hypot(dx, dy);
    const step = RESIDENT_SPEED * dt;
    if (dist <= step) {
      this.x = wp.x; this.y = wp.y; this.pi++;
      if (this.pi >= this.path.length) {
        this.path = null;
        const next = this.after;
        if (next === 'door') { this.state = 'door'; this.timer = 0.8 + this.rng() * 1.2; }
        else if (next === 'inside') { this.state = 'inside'; this.timer = 1.5 + this.rng() * 2.5; this.lookTimer = 0.3; }
        else { this.state = 'look'; this.timer = 1.5 + this.rng() * 2.5; this.lookTimer = 0.4; }
      }
      return;
    }
    const ux = dx / dist, uy = dy / dist;
    // stop and wait when the player stands in the way
    if (player) {
      const px = player.x - this.x, py = player.y - this.y;
      const ahead = px * ux + py * uy, side = Math.abs(px * uy - py * ux);
      if (ahead > 0 && ahead < 18 && side < 11) {
        this.wait += dt;
        this.facing = facingFrom(px, py, this.facing);
        if (this.wait > 2.2) {
          const w = this.world;
          const last = this.path[this.path.length - 1];
          // going to where the player stands, or already went round once: give up and stay here
          // for a moment (otherwise everyone bound for that spot crowds round a player who stands still)
          if (this.detours > 0 || Math.hypot(last.x - player.x, last.y - player.y) < 22) {
            this.path = null; this.wait = 0; this.detours = 0; this.gaveUp = true;
            this.state = this.after === 'inside' ? 'inside' : 'look';
            this.timer = 1 + this.rng() * 1.5; this.lookTimer = 0.3;
            return;
          }
          this.detours = 1;
          // try a path that avoids the player's tile
          const avoid = Math.floor(player.y / T - 0.2) * w.cols + Math.floor(player.x / T);
          const tiles = w.findPath(Math.floor(this.x / T), Math.floor((this.y - 3) / T), Math.floor(last.x / T), Math.floor((last.y - 3) / T), { avoid });
          if (tiles) {
            // keep the detour on tile centres (string-pulling would cut straight through the player)
            this.path = tiles.map(([tx, ty]) => w.navPoint(tx, ty));
            this.path[this.path.length - 1] = { x: last.x, y: last.y };
            this.pi = 0;
          }
          this.wait = 0;
        }
        return;
      }
    }
    this.wait = 0;
    this.x += ux * step; this.y += uy * step;
    this.facing = facingFrom(ux, uy, this.facing);
  }
}
