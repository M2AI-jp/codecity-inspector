// Residents (contributors): walkers that travel between the doors of the buildings they touched,
// pause at doors, step inside and wander, look around; and keepers who stay inside a building.

import { TILE, RESIDENT_SPEED, NEAR_KEEPER } from './config.js';
import { Character, facingFrom } from './character.js';
import { mulberry32, strHash } from './util.js';
import { MAT } from './ground.js';

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
    this.pi = 0; this.state = 'walk'; this.after = then; this.wait = 0;
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
          // try a path that avoids the player's tile
          const w = this.world;
          const last = this.path[this.path.length - 1];
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

export const KEEPER_ROLE = {
  workshop: '工房の親方', shop: '商店の主人', house: '家の人', ruin: '廃屋の管理人',
  town_hall: '役場の書記', inn: '宿屋の番頭', pub: '酒場の主人', warehouse: '倉庫番', watchtower: '見張り台の番人', dojo: '道場の検査官',
};
// 施設の番人の絵がまだ無いときに代わりに立てる、いちばん近い番人
export const KEEPER_STAND_IN = { town_hall: 'house', inn: 'shop', pub: 'shop', warehouse: 'workshop', watchtower: 'house', dojo: 'house' };

export function kindOf(b) {
  const k = (b.data && b.data.facility && b.data.facility.archetype) || (b.module && b.module.kind);
  if (KEEPER_ROLE[k]) return k;
  const a = String(b.archetype || '');
  return a.startsWith('workshop') ? 'workshop' : a.startsWith('shop') ? 'shop' : a.startsWith('ruin') ? 'ruin' : 'house';
}

// A keeper is a role that belongs to the building (not a named person).
export class Keeper extends Character {
  constructor(kind, sheet, building, seed) {
    const s = building.keeperSpot;
    super(s.x, s.y, sheet);
    this.kind = kind;
    this.name = KEEPER_ROLE[kind];
    this.building = building;
    this.rng = mulberry32(seed);
    this.lookTimer = 1 + this.rng() * 2;
    this.solid = true;
  }

  update(dt, player) {
    this.beginStep();
    const dx = player.x - this.x, dy = player.y - this.y;
    if (this.building.inside && dx * dx + dy * dy < (NEAR_KEEPER + 30) ** 2) {
      this.facing = facingFrom(dx, dy, this.facing);
    } else {
      this.lookTimer -= dt;
      if (this.lookTimer <= 0) {
        this.lookTimer = 1.5 + this.rng() * 3;
        const r = this.rng();
        this.facing = r < 0.55 ? 'down' : r < 0.75 ? 'left' : r < 0.95 ? 'right' : 'up';
      }
    }
    this.animate(dt);
  }
}

// Every building with room inside gets the keeper of its kind; every contributor walks the
// streets once, as townsfolk[look % count]. Missing art means nobody is drawn for that slot —
// except with ?debug=1, where outlines stand in so the layout can be inspected.
export function createResidents(town, world, art, debug) {
  const out = { walkers: [], keepers: [], locals: [] };
  for (const b of world.buildings) {
    if (!b.keeperSpot || !b.module) continue;
    const kind = kindOf(b);
    const standIn = !art.keepers[kind] && (art.keepers[KEEPER_STAND_IN[kind]] || art.keepers.house) || null;
    if (standIn) console.info(`[codecity] ${KEEPER_ROLE[kind]}の絵がないので、${KEEPER_STAND_IN[kind] || 'house'} の番人の絵で立てる`);
    const sheet = art.keepers[kind] || standIn;
    if (!sheet && !debug) continue;
    const k = new Keeper(kind, sheet, b, strHash(`keeper:${b.id}`));
    b.keeper = k;
    out.keepers.push(k);
  }
  const folk = art.townsfolk.filter(Boolean);
  if (!folk.length && !debug) return out;
  const byId = new Map(world.buildings.map((b) => [b.id, b]));
  const defs = Array.isArray(town.residents) ? town.residents : [];
  for (const def of defs) {
    const homes = (def.homes || []).map((id) => byId.get(id)).filter(Boolean);
    if (!homes.length) continue;
    const sheet = folk.length ? folk[((def.look | 0) % folk.length + folk.length) % folk.length] : null;
    out.walkers.push(new Walker(def, sheet, world, homes, strHash(String(def.id || def.name))));
  }
  // 常連（town.crowd）: 自分の建物の近くを歩き、ときどき広場やほかの建物へ。立ち止まり、見回し、二人で立ち話
  const plaza = [];
  for (let k = 0; k < world.grid.length; k++) if (world.grid[k] === MAT.PLAZA && world.nav[k] === 0) plaza.push(k);
  const shared = { plaza, locals: out.locals, buildings: world.buildings.filter((b) => b.doorOutside) };
  for (const def of Array.isArray(town.crowd) ? town.crowd : []) {
    const home = byId.get(def.home);
    if (!home || !home.doorOutside) continue;
    const sheet = folk.length ? folk[((def.look | 0) % folk.length + folk.length) % folk.length] : null;
    out.locals.push(new Local(def, sheet, world, home, strHash(`local:${def.id}:${def.home}`), shared));
  }
  return out;
}

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
          if (o.partner === this && o.state === 'hold') {
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
