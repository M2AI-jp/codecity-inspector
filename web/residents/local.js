// 建物の近くを歩き、ときどき立ち話をする町の人。
import { TILE } from '../config.js';
import { facingFrom } from '../character.js';
import { Walker } from './walker.js';

const T = TILE;

// An ambient townsperson (常連) tied to one building's recent activity. Not a named person.
export class Local extends Walker {
  constructor(def, sheet, world, home, seed, shared) {
    super(def, sheet, world, [home], seed);
    this.local = true;
    this.name = '町の人';
    this.home = home;
    this.shared = shared;
    this.partner = null;          // the one I am chatting with / walking up to / waiting for
    this.timer = 0.3 + this.rng() * 3;
  }

  // a walkable street-ish tile near (tx, ty)
  spotNear(tx, ty, r) {
    const w = this.world;
    for (let k = 0; k < 14; k++) {
      const x = tx + Math.round((this.rng() - 0.5) * 2 * r), y = ty + Math.round((this.rng() - 0.5) * 1.4 * r);
      if (w.navFree(x, y) && !w.buildingAtPx(x * T + 8, y * T + 8) && w.cost[y * w.cols + x] <= 1.35) return w.navPoint(x, y);
    }
    return null;
  }

  pickNext() {
    const w = this.world, r = this.rng();
    const hx = Math.floor(this.home.doorOutside.x / T), hy = Math.floor(this.home.doorOutside.y / T);
    if (r < 0.14 && this.startChat()) return;
    if (r < 0.26 && this.shared.plaza.length) {
      const k = this.shared.plaza[Math.floor(this.rng() * this.shared.plaza.length)];
      const p = w.navPoint(k % w.cols, (k / w.cols) | 0);
      if (this.goTo(p.x, p.y, 'look')) return;
    }
    if (r < 0.4) {
      // a nearby building's door
      const near = this.shared.buildings.filter((b) => b !== this.home && Math.abs(b.doorOutside.x / T - hx) + Math.abs(b.doorOutside.y / T - hy) < 30);
      const b = near[Math.floor(this.rng() * near.length)];
      if (b && this.goTo(b.doorOutside.x, b.doorOutside.y, 'door')) { this.homes = [b]; this.homeIdx = 0; return; }
    }
    if (r < 0.52) {
      if (this.goTo(this.home.doorOutside.x, this.home.doorOutside.y, 'door')) { this.homes = [this.home]; this.homeIdx = 0; return; }
    }
    const p = this.spotNear(hx, hy + 1, 7);
    if (p && this.goTo(p.x, p.y, 'look')) return;
    this.state = 'look'; this.timer = 1.5 + this.rng() * 2;
  }

  // walk up to someone standing nearby and talk for a while
  startChat() {
    const w = this.world;
    let best = null, bd = 9 * T;
    for (const o of this.shared.locals) {
      if (o === this || o.partner || o.state !== 'look' || this.partner) continue;
      const d = Math.hypot(o.x - this.x, o.y - this.y);
      if (d < bd && w.cost[Math.floor((o.y - 3) / T) * w.cols + Math.floor(o.x / T)] <= 1.35 && !w.buildingAtPx(o.x, o.y)) { bd = d; best = o; }
    }
    if (!best) return false;
    const ox = Math.floor(best.x / T), oy = Math.floor((best.y - 3) / T);
    const side = this.x < best.x ? -1 : 1;
    for (const dx of [side, -side]) {
      if (!w.navFree(ox + dx, oy) || w.buildingAtPx((ox + dx) * T + 8, oy * T + 11)) continue;
      const p = w.navPoint(ox + dx, oy);
      if (!this.goTo(p.x, p.y, 'look')) continue;
      this.partner = best; best.partner = this;
      best.state = 'hold'; best.timer = 10;
      return true;
    }
    return false;
  }

  endChat() {
    const o = this.partner;
    this.partner = null;
    this.state = 'look'; this.timer = 1 + this.rng() * 2; this.lookTimer = 0.5;
    if (o && o.partner === this) { o.partner = null; o.state = 'look'; o.timer = 0.5 + o.rng() * 2; o.lookTimer = 0.3; }
  }

  update(dt, player) {
    this.beginStep();
    switch (this.state) {
      case 'walk':
        this.walk(dt, player);
        if (this.state === 'look' && this.partner) {
          const o = this.partner;
          if (!this.gaveUp && o.partner === this && o.state === 'hold') {
            const t = 3.5 + this.rng() * 4;
            this.state = o.state = 'chat';
            this.timer = o.timer = t;
          } else this.endChat();
        }
        break;
      case 'hold':                 // someone is coming over to talk
        this.timer -= dt;
        if (this.partner) this.facing = facingFrom(this.partner.x - this.x, this.partner.y - this.y, this.facing);
        if (this.timer <= 0 || !this.partner || this.partner.partner !== this) { this.partner = null; this.state = 'look'; this.timer = 1; }
        break;
      case 'chat': {              // stand facing each other; now and then glance away and back
        const o = this.partner;
        this.timer -= dt;
        if (!o || o.partner !== this) { this.endChat(); break; }
        this.lookTimer -= dt;
        if (this.lookTimer <= -0.6) this.lookTimer = 1.5 + this.rng() * 2.5;
        this.facing = this.lookTimer < 0 ? 'down' : facingFrom(o.x - this.x, o.y - this.y, this.facing);
        if (this.timer <= 0) this.endChat();
        break;
      }
      case 'door': {
        this.facing = 'up';
        this.timer -= dt;
        if (this.timer <= 0) {
          const b = this.homes[0];
          if (b.doorInside && b.interior.length && this.rng() < 0.35) {
            this.insideBuilding = b; this.wanderLeft = this.rng() < 0.5 ? 1 : 0;
            this.wanderInside();
          } else { this.state = 'look'; this.timer = 1 + this.rng() * 2.5; this.lookTimer = 0; }
        }
        break;
      }
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
      default:
        this.timer -= dt;
        this.idleLook(dt);
        if (this.timer <= 0) this.pickNext();
    }
    this.animate(dt);
  }
}
