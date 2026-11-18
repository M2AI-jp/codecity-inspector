// コミットした人と外部工務店の代理人が、建物のあいだを歩く。
// 初期化とプロトタイプをここに残し、継承先からも同じメソッドを使えるようにする。
import { TILE } from '../config.js';
import { Character } from '../character.js';
import { mulberry32 } from '../util.js';
import { goTo, pickNext } from './walker/destination.js';
import { update } from './walker/update.js';
import { wanderInside } from './walker/interior.js';
import { idleLook } from './walker/look.js';
import { walk } from './walker/walk.js';

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
    const sx = Math.floor(b.doorOutside.x / T) + Math.floor(this.rng() * 5) - 2, sy = Math.floor(b.doorOutside.y / T) + 1 + Math.floor(this.rng() * 2);
    // 戸口と同じ道のつながりに出す。柵や小物に囲まれた1マスや、切り離された桟橋に出ると、どこへも道を引けない。
    const door = world.nearestFree(Math.floor(b.doorOutside.x / T), Math.floor((b.doorOutside.y - 3) / T), 2);
    const comp = door && world.navComp ? world.navComp[door[1] * world.cols + door[0]] : -1;
    const start = (comp >= 0 && world.nearestFree(sx, sy, 6, comp)) || world.nearestFree(sx, sy, 6);
    if (start) { const p = world.navPoint(start[0], start[1]); this.x = p.x; this.y = p.y; } else { this.x = b.doorOutside.x; this.y = b.doorOutside.y; }
    this.prevX = this.x; this.prevY = this.y; this.rx = this.x; this.ry = this.y;
    this.facing = DIRS4[Math.floor(this.rng() * 4)];
  }

  goTo(px, py, then) { return goTo(this, px, py, then); }

  pickNext() { return pickNext(this); }

  update(dt, player) { return update(this, dt, player); }

  wanderInside() { return wanderInside(this); }

  idleLook(dt) { return idleLook(this, dt); }

  walk(dt, player) { return walk(this, dt, player); }
}
