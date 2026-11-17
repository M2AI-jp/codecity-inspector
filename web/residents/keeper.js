// 建物と屋外施設の番人、その役と絵。
import { TILE, NEAR_KEEPER } from '../config.js';
import { Character, facingFrom } from '../character.js';
import { mulberry32 } from '../util.js';

const T = TILE;

export const KEEPER_ROLE = {
  workshop: '工房の親方', shop: '商店の主人', house: '家の人', ruin: '廃屋の管理人',
  town_hall: '役場の書記', inn: '宿屋の番頭', pub: '酒場の主人', warehouse: '倉庫番', watchtower: '見張り台の番人', dojo: '道場の検査官',
  dock: '船頭', repair: '修理小屋の職人', well: '井戸番', gate: '門番',
};
// 施設の番人の絵がまだ無いときに代わりに立てる、いちばん近い番人
export const KEEPER_STAND_IN = { town_hall: 'house', inn: 'shop', pub: 'shop', warehouse: 'workshop', watchtower: 'house', dojo: 'house', dock: 'workshop', repair: 'workshop', well: 'house', gate: 'watchtower' };

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

// The keeper of an outdoor facility (town.landmarks: the well's 井戸番, the gate's 門番) stands beside its prop and
// talks like a building keeper. `building` is a stand-in so the dialogue code treats both alike.
export class LandmarkKeeper extends Keeper {
  constructor(kind, sheet, landmark, world, seed) {
    let x = landmark.keeper.x * T, y = landmark.keeper.y * T;
    if (world.feetHit(x, y)) {
      const f = world.nearestFree(Math.floor(x / T), Math.floor((y - 3) / T), 3);
      if (f) ({ x, y } = world.navPoint(f[0], f[1]));
    }
    const spot = { x, y, tx: Math.floor(x / T), ty: Math.floor((y - 3) / T) };
    const fac = landmark.facility || { archetype: landmark.archetype, name: landmark.name, facts: {} };
    super(kind, sheet, { id: landmark.id, keeperSpot: spot, data: { facility: fac }, facility: fac, module: landmark.module || null, landmark, inside: false }, seed);
    this.outdoor = true;
  }

  update(dt, player) {
    this.beginStep();
    const dx = player.x - this.x, dy = player.y - this.y;
    if (dx * dx + dy * dy < (NEAR_KEEPER + 30) ** 2) this.facing = facingFrom(dx, dy, this.facing);
    else {
      this.lookTimer -= dt;
      if (this.lookTimer <= 0) {
        this.lookTimer = 1.5 + this.rng() * 3;
        const r = this.rng();
        this.facing = r < 0.6 ? 'down' : r < 0.8 ? 'left' : 'right';
      }
    }
    this.animate(dt);
  }
}

// The keeper's picture: their own, else the nearest kind's (KEEPER_STAND_IN), else none.
function keeperSheet(art, kind) {
  if (art.keepers[kind]) return art.keepers[kind];
  const standIn = art.keepers[KEEPER_STAND_IN[kind]] || art.keepers.house || null;
  if (standIn) console.info(`[codecity] ${KEEPER_ROLE[kind]}の絵がないので、${art.keepers[KEEPER_STAND_IN[kind]] ? KEEPER_STAND_IN[kind] : 'house'} の番人の絵で立てる`);
  return standIn;
}

export { keeperSheet };
