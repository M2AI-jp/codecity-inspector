// 街の当たり判定と道案内。Worldの公開メソッドと初期化の順を保つ入口。
import { TILE } from './config.js';
import { MAT } from './ground.js';
import { applyDecks, addRect, pickVariant, addBuilding, propDef, addProp } from './world/placement.js';
import { addFloorWalls, floorReach, floorSpots } from './world/floor.js';
import { computeNav, navPoint, buildNav, navFree } from './world/navigation.js';
import { pathTo, pathInto, nearestFree, findPath, sweepFree, smoothPath } from './world/path.js';
import { boxHits, feetHit, buildingAtPx } from './world/collision.js';
import { addOverlayPeople } from './overlay-world.js';

const T = TILE;

export class World {
  constructor(town, art, grid) {
    this.town = town;
    this.art = art;
    this.cols = town.cols | 0;
    this.rows = town.rows | 0;
    this.W = this.cols * T;
    this.H = this.rows * T;
    this.grid = grid;
    const n = this.cols * this.rows;
    this.tileSolid = new Uint8Array(n);
    this.buildingMap = new Int16Array(n).fill(-1);
    this.rects = [];               // { x, y, w, h, kind }
    this.buckets = new Array(n).fill(null);
    this.buildings = [];
    this.props = [];
    this.lights = [];              // 固定の灯 { x, y, r, kind, seed, building }

    for (let i = 0; i < n; i++) {
      const m = grid[i];
      if (m === MAT.OUT || m === MAT.WATER) this.tileSolid[i] = 1;
    }
    // 段の手前の1行（擁壁、y + h）は、town.stairs の階段以外は歩けない。
    // 段の上面は普通の地面として歩ける。
    this.stairTile = new Uint8Array(n);
    for (const st of Array.isArray(town.stairs) ? town.stairs : []) {
      for (let x = st.x | 0; x < (st.x | 0) + (st.w | 0); x++) if (this.inGrid(x, st.y | 0)) this.stairTile[(st.y | 0) * this.cols + x] = 1;
    }
    for (const t of Array.isArray(town.terraces) ? town.terraces : []) {
      const fy = (t.y | 0) + (t.h | 0);
      for (let x = t.x | 0; x < (t.x | 0) + (t.w | 0); x++) {
        if (!this.inGrid(x, fy)) continue;
        const k = fy * this.cols + x;
        if (!this.stairTile[k]) this.tileSolid[k] = 1;
      }
    }
    (town.buildings || []).forEach((b, i) => this.addBuilding(b, i));
    this.decks = [];
    this.deckTile = new Uint8Array(n);
    (town.props || []).forEach((p, i) => this.addProp(p, i));
    this.applyDecks();
    addOverlayPeople(this, town.overlay);
    this.buildNav();
  }

  inGrid(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows; }

  // 公開メソッドはここに残し、同じWorldを各処理へ渡す。
  applyDecks() { return applyDecks(this); }
  addRect(x, y, w, h, kind) { return addRect(this, x, y, w, h, kind); }
  pickVariant(b, w, h) { return pickVariant(this, b, w, h); }
  addBuilding(b, index) { return addBuilding(this, b, index); }
  addFloorWalls(b, fl) { return addFloorWalls(this, b, fl); }
  propDef(type, ax, ay) { return propDef(this, type, ax, ay); }
  addProp(p, index) { return addProp(this, p, index); }
  boxHits(x0, y0, x1, y1) { return boxHits(this, x0, y0, x1, y1); }
  feetHit(fx, fy) { return feetHit(this, fx, fy); }
  buildingAtPx(px, py) { return buildingAtPx(this, px, py); }
  computeNav() { return computeNav(this); }
  pathTo(x, y, wx, wy) { return pathTo(this, x, y, wx, wy); }
  pathInto(b, x, y, opts = { useCost: false }) { return pathInto(this, b, x, y, opts); }
  navPoint(tx, ty) { return navPoint(this, tx, ty); }
  buildNav() { return buildNav(this); }
  floorReach(b, free, extra) { return floorReach(this, b, free, extra); }
  floorSpots(b) { return floorSpots(this, b); }
  navFree(tx, ty) { return navFree(this, tx, ty); }
  nearestFree(tx, ty, maxR = 12) { return nearestFree(this, tx, ty, maxR); }
  findPath(sx, sy, gx, gy, opts = {}) { return findPath(this, sx, sy, gx, gy, opts); }
  sweepFree(ax, ay, bx, by) { return sweepFree(this, ax, ay, bx, by); }
  smoothPath(fromX, fromY, tiles, endX, endY) { return smoothPath(this, fromX, fromY, tiles, endX, endY); }
}
