// Residents (contributors): walkers that travel between the doors of the buildings they touched,
// pause at doors, step inside and wander, look around; and keepers who stay inside a building.

import { TILE, RESIDENT_SPEED, NEAR_KEEPER } from './config.js';
import { Character, facingFrom } from './character.js';
import { mulberry32, strHash } from './util.js';

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

export const KEEPER_ROLE = { workshop: '工房の親方', shop: '商店の主人', house: '家の人', ruin: '廃屋の管理人' };

export function kindOf(b) {
  const k = b.module && b.module.kind;
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
  const out = { walkers: [], keepers: [] };
  for (const b of world.buildings) {
    if (!b.keeperSpot || !b.module) continue;
    const kind = kindOf(b);
    const sheet = art.keepers[kind] || null;
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
  return out;
}
