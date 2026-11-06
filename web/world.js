// Static world model: collision (tiles + px rects), buildings, props, navigation grid, A*.

import { TILE, FEET_W, FEET_H, FEET_UP, KEEPER_BOX, NEAR_KEEPER } from './config.js';
import { MAT } from './ground.js';
import { warnOnce } from './assets.js';
import { strHash } from './util.js';

const T = TILE;
// 8-neighbour directions; bit d of World.edges[k] = the feet can walk straight from tile k to k+DIRS[d]
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIR_AT = new Int8Array(9).fill(-1);
DIRS.forEach(([dx, dy], d) => { DIR_AT[(dy + 1) * 3 + dx + 1] = d; });
// where to look for a free feet spot in a tile whose centre is blocked (nearest first). A tile
// holds the feet positions x in [tx*16, tx*16+16), y in [ty*16+3, ty*16+19) (centre ty*16+11).
const NAV_OFFSETS = [];
for (let oy = -8; oy <= 7; oy++) for (let ox = -8; ox <= 7; ox++) if (ox || oy) NAV_OFFSETS.push([ox, oy]);
NAV_OFFSETS.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

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
    this.lights = [];              // static lights { x, y, r, kind, seed, building }

    for (let i = 0; i < n; i++) {
      const m = grid[i];
      if (m === MAT.OUT || m === MAT.WATER) this.tileSolid[i] = 1;
    }
    (town.buildings || []).forEach((b, i) => this.addBuilding(b, i));
    (town.props || []).forEach((p, i) => this.addProp(p, i));
    this.buildNav();
  }

  inGrid(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows; }

  addRect(x, y, w, h, kind) {
    if (!(w > 0 && h > 0)) return null;
    const r = { x, y, w, h, kind };
    const idx = this.rects.length;
    this.rects.push(r);
    const tx0 = Math.max(0, Math.floor(x / T)), ty0 = Math.max(0, Math.floor(y / T));
    const tx1 = Math.min(this.cols - 1, Math.floor((x + w - 0.001) / T)), ty1 = Math.min(this.rows - 1, Math.floor((y + h - 0.001) / T));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = ty * this.cols + tx;
      (this.buckets[k] || (this.buckets[k] = [])).push(idx);
    }
    return r;
  }

  // Variant: the one town.json names (the layout keeps neighbours from matching), else a stable
  // hash(building.id) among the variants whose footprint fits.
  pickVariant(b, w, h) {
    const a = this.art.archetypes[b.archetype];
    if (!a || !a.variants.length) return null;
    const fits = a.variants.filter((v) => !v.footprint || (v.footprint[0] === w && v.footprint[1] === h));
    const named = b.variant && fits.find((v) => v.id === b.variant);
    if (named) return named;
    const pool = fits.length ? fits : a.variants;
    const v = pool[strHash(String(b.id)) % pool.length];
    if (!fits.length && v.footprint) {
      warnOnce(`fp:${b.id}`, `${b.id}: footprint ${w}x${h} に合う "${b.archetype}" の版がありません（${v.id} は ${v.footprint.join('x')}）`);
    }
    return v;
  }

  addBuilding(b, index) {
    const x = b.x | 0, y = b.y | 0, w = Math.max(1, b.w | 0), h = Math.max(1, b.h | 0);
    const arch = this.pickVariant(b, w, h);
    if (!arch) warnOnce(`arch:${b.archetype}`, `archetype "${b.archetype}" が manifest にありません（${b.id} などは描画しません。衝突と扉は town.json の footprint で動きます）`);
    // door gap on the bottom row: the art's door wins over town.json's door.x
    let d0, d1;
    if (arch && arch.door && Number.isFinite(arch.door.x)) {
      d0 = x + (arch.door.x | 0); d1 = d0 + Math.max(1, arch.door.w | 0);
    } else if (b.door && Number.isFinite(b.door.x)) {
      d0 = b.door.x | 0; d1 = d0 + 1;
    } else {
      d0 = x + (w >> 1); d1 = d0 + 1;
    }
    d0 = Math.max(x, Math.min(x + w - 1, d0)); d1 = Math.max(d0 + 1, Math.min(x + w, d1));
    const bottom = y + h - 1;
    const bld = {
      index, id: b.id, data: b, arch, module: b.module || null,
      archetype: b.archetype,
      x, y, w, h,
      px: x * T, py: y * T, pw: w * T, ph: h * T,
      bottomPx: (y + h) * T,
      doorX0: d0, doorX1: d1, doorY: bottom,
      doorPx: ((d0 + d1) / 2) * T,           // door centre x in px
      open: 0, inside: false,
      interior: [],
      keeperSpot: null,
      keeper: null,
    };
    const fl = arch && Array.isArray(arch.floor) && arch.floor.length >= 4 && arch.floor.slice(0, 4).every(Number.isFinite) ? arch.floor : null;
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (!this.inGrid(tx, ty)) continue;
        const k = ty * this.cols + tx;
        this.buildingMap[k] = index;
        if (fl) { this.tileSolid[k] = 0; continue; }       // walls come from px rects below
        const ring = ty === y || ty === y + 1 || ty === bottom || tx === x || tx === x + w - 1;
        const doorGap = ty === bottom && tx >= d0 && tx < d1;
        if (ring && !doorGap) this.tileSolid[k] = 1;
        else {
          this.tileSolid[k] = 0;
          if (!doorGap) bld.interior.push(k);
        }
      }
    }
    if (fl) this.addFloorWalls(bld, fl);
    if (arch) {
      for (const bl of arch.blockers) {
        if (Array.isArray(bl) && bl.length >= 4) this.addRect(bld.px + bl[0], bld.py + bl[1], bl[2], bl[3], 'blocker');
      }
      arch.lights.forEach((l, i) => {
        if (Array.isArray(l) && l.length >= 3) this.lights.push({ x: bld.px + l[0], y: bld.py + l[1], poolY: bld.py + l[1] + 4, r: l[2], kind: 'window', seed: index * 31 + i, building: bld });
      });
      // hearth / forge light inside: only lit while the building is open (web/lighting.js)
      (arch.interiorLights || []).forEach((l, i) => {
        if (Array.isArray(l) && l.length >= 3) this.lights.push({ x: bld.px + l[0], y: bld.py + l[1], poolY: bld.py + l[1] + 4, r: l[2], kind: 'hearth', interior: true, seed: index * 31 + 13 + i, building: bld });
      });
    }
    // door lantern just outside the door
    this.lights.push({ x: bld.doorPx, y: bld.bottomPx - 10, poolY: bld.bottomPx + 2, r: 34, kind: 'door', seed: index * 31 + 29, building: bld });
    this.buildings.push(bld);
  }

  // Variant with an explicit floor: walkable = floor rect (minus blockers) + a door corridor
  // from the footprint's bottom edge up to the floor; everything else in the footprint is wall,
  // stored as px rects so collision and sliding are pixel precise.
  addFloorWalls(b, fl) {
    const X0 = b.px, Y0 = b.py, X1 = b.px + b.pw, Y1 = b.bottomPx;
    const cx = (v) => Math.max(X0, Math.min(X1, v)), cy = (v) => Math.max(Y0, Math.min(Y1, v));
    const f = { x0: cx(X0 + fl[0]), y0: cy(Y0 + fl[1]), x1: cx(X0 + fl[0] + fl[2]), y1: cy(Y0 + fl[1] + fl[3]) };
    if (f.x1 - f.x0 < FEET_W || f.y1 - f.y0 < FEET_H) warnOnce(`floor:${b.id}`, `${b.id}: floor ${fl.join(',')} が狭すぎて歩けません`);
    const door = { x0: b.doorX0 * T, y0: Math.min(f.y1, Y1), x1: b.doorX1 * T, y1: Y1 };
    if (door.x1 <= f.x0 || door.x0 >= f.x1) warnOnce(`floordoor:${b.id}`, `${b.id}: 扉 (${b.doorX0 - b.x}..${b.doorX1 - b.x - 1}) が floor の真下にありません`);
    b.floor = f;
    const open = (px, py) => (px >= f.x0 && px < f.x1 && py >= f.y0 && py < f.y1) || (px >= door.x0 && px < door.x1 && py >= door.y0 && py < door.y1);
    const xs = [...new Set([X0, X1, f.x0, f.x1, cx(door.x0), cx(door.x1)])].sort((a, c) => a - c);
    const ys = [...new Set([Y0, Y1, f.y0, f.y1, door.y0])].sort((a, c) => a - c);
    for (let j = 0; j + 1 < ys.length; j++) {
      const ya = ys[j], yb = ys[j + 1];
      let run = null;
      for (let i = 0; i + 1 < xs.length; i++) {
        const xa = xs[i], xb = xs[i + 1];
        const solid = !open((xa + xb) / 2, (ya + yb) / 2);
        if (solid) { if (run) run[1] = xb; else run = [xa, xb]; }
        if ((!solid || i + 2 === xs.length) && run) { this.addRect(run[0], ya, run[1] - run[0], yb - ya, 'wall'); run = null; }
      }
    }
  }

  // A prop type may have looks <type>, <type>-2, <type>-3 ... in the manifest; each prop takes
  // one by a stable hash of where it stands, so a row of trees is not one stamp repeated.
  propDef(type, ax, ay) {
    const props = this.art.props;
    let looks = (this.propLooks || (this.propLooks = new Map())).get(type);
    if (!looks) {
      looks = [];
      if (props[type]) looks.push(props[type]);
      for (let n = 2; props[`${type}-${n}`]; n++) looks.push(props[`${type}-${n}`]);
      this.propLooks.set(type, looks);
    }
    if (!looks.length) return null;
    return looks[strHash(`${type}:${ax},${ay}`) % looks.length];
  }

  addProp(p, index) {
    const def = this.propDef(p.type, Math.round(p.x * T), Math.round(p.y * T));
    if (!def) warnOnce(`prop:${p.type}`, `prop "${p.type}" が manifest にありません（描画しません）`);
    const ax = Math.round(p.x * T), ay = Math.round(p.y * T);
    const prop = { index, type: p.type, data: p, def, x: ax, y: ay, solid: null };
    if (def && def.solid) prop.solid = this.addRect(ax + def.solid[0], ay + def.solid[1], def.solid[2], def.solid[3], 'prop');
    if (def && def.light) {
      // the glow sits at the light point; the pool it casts is centred lower, toward the
      // ground under it (3/4 view: a lantern on a post lights the street around its foot)
      const lx = ax + def.light[0], ly = ay + def.light[1];
      this.lights.push({ x: lx, y: ly, poolY: ly + Math.max(0, ay - ly) * 0.6, footY: ay, r: def.light[2], kind: def.flicker ? 'flame' : 'steady', seed: 1000 + index, building: null });
    }
    this.props.push(prop);
  }

  // --- collision -----------------------------------------------------------
  boxHits(x0, y0, x1, y1) {
    if (x0 < 0 || y0 < 0 || x1 > this.W || y1 > this.H) return true;
    const tx0 = Math.floor(x0 / T), ty0 = Math.floor(y0 / T);
    const tx1 = Math.floor((x1 - 0.0001) / T), ty1 = Math.floor((y1 - 0.0001) / T);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const k = ty * this.cols + tx;
        if (this.tileSolid[k]) return true;
        const bk = this.buckets[k];
        if (bk) {
          for (let i = 0; i < bk.length; i++) {
            const r = this.rects[bk[i]];
            if (x0 < r.x + r.w && x1 > r.x && y0 < r.y + r.h && y1 > r.y) return true;
          }
        }
      }
    }
    return false;
  }

  feetHit(fx, fy) {
    const hw = FEET_W / 2;
    return this.boxHits(fx - hw, fy - FEET_UP, fx + hw, fy - FEET_UP + FEET_H);
  }

  buildingAtPx(px, py) {
    const tx = Math.floor(px / T), ty = Math.floor(py / T);
    if (!this.inGrid(tx, ty)) return null;
    const i = this.buildingMap[ty * this.cols + tx];
    return i >= 0 ? this.buildings[i] : null;
  }

  // --- navigation ------------------------------------------------------------
  // The nav grid is per tile, but each walkable tile carries a feet point that is really free
  // (the centre when possible, else the nearest free spot in the tile), and an edge between two
  // neighbouring tiles exists only when the feet box can travel straight between their points.
  // So narrow interiors (furniture leaving a 13 px aisle) still connect, and paths never cut
  // through a corner the player would collide with.
  computeNav() {
    const cols = this.cols;
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const k = ty * cols + tx;
        const cx = tx * T + T / 2, cy = ty * T + T / 2 + 3;
        let free = false;
        if (!this.tileSolid[k]) {
          if (!this.feetHit(cx, cy)) { this.navX[k] = cx; this.navY[k] = cy; free = true; }
          else {
            for (let i = 0; i < NAV_OFFSETS.length; i++) {
              const x = cx + NAV_OFFSETS[i][0], y = cy + NAV_OFFSETS[i][1];
              if (!this.feetHit(x, y)) { this.navX[k] = x; this.navY[k] = y; free = true; break; }
            }
          }
        }
        this.nav[k] = free ? 0 : 1;
        const m = this.grid[k];
        this.cost[k] = this.buildingMap[k] >= 0 ? 1.1 : m === MAT.STREET || m === MAT.PLAZA ? 1 : m === MAT.DIRT ? 1.35 : 2.4;
      }
    }
    const edges = this.edges;
    edges.fill(0);
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const k = ty * cols + tx;
        if (this.nav[k]) continue;
        for (let d = 0; d < 4; d++) {
          const nx = tx + DIRS[d][0], ny = ty + DIRS[d][1];
          if (!this.inGrid(nx, ny)) continue;
          const n = ny * cols + nx;
          if (this.nav[n]) continue;
          if (this.sweepFree(this.navX[k], this.navY[k], this.navX[n], this.navY[n])) {
            edges[k] |= 1 << d; edges[n] |= 1 << (d + 4);
          }
        }
      }
    }
    // a tile whose point sits in a pocket (no way to any neighbour) gets another point in the
    // same tile that does connect, when there is one
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const k = ty * cols + tx;
        if (this.nav[k] || edges[k]) continue;
        const cx = tx * T + T / 2, cy = ty * T + T / 2 + 3;
        for (let i = -1; i < NAV_OFFSETS.length; i++) {
          const x = cx + (i < 0 ? 0 : NAV_OFFSETS[i][0]), y = cy + (i < 0 ? 0 : NAV_OFFSETS[i][1]);
          if ((i & 1) || this.feetHit(x, y)) continue;            // every other offset is enough here
          let e = 0;
          for (let d = 0; d < 8; d++) {
            const nx = tx + DIRS[d][0], ny = ty + DIRS[d][1];
            if (!this.inGrid(nx, ny)) continue;
            const n = ny * cols + nx;
            if (!this.nav[n] && this.sweepFree(x, y, this.navX[n], this.navY[n])) e |= 1 << d;
          }
          if (!e) continue;
          this.navX[k] = x; this.navY[k] = y; edges[k] = e;
          for (let d = 0; d < 8; d++) if (e & (1 << d)) edges[(ty + DIRS[d][1]) * cols + tx + DIRS[d][0]] |= 1 << ((d + 4) & 7);
          break;
        }
      }
    }
  }

  // Waypoints from feet (x, y) into building b (to just inside its door), or null. When the tile
  // just inside is not on the nav grid, the path goes to the door gap and straight in from there.
  pathInto(b, x, y, opts = { useCost: false }) {
    const target = b.doorInside || b.doorOutside;
    const sx = Math.floor(x / T), sy = Math.floor((y - 3) / T);
    let tiles = this.findPath(sx, sy, Math.floor(target.x / T), Math.floor((target.y - 3) / T), opts);
    if (!tiles && b.doorInside) {
      let best = null;
      for (let c = b.doorX0; c < b.doorX1; c++) {
        const t = this.findPath(sx, sy, c, b.doorY, opts);
        if (t && (!best || t.length < best.length)) best = t;
      }
      if (best) tiles = [...best, [Math.floor(target.x / T), Math.floor((target.y - 3) / T)]];
    }
    if (!tiles) return null;
    return { target, points: this.smoothPath(x, y, tiles, target.x, target.y) };
  }

  // the feet point of a walkable tile (tile centre for blocked / unknown tiles)
  navPoint(tx, ty) {
    if (this.inGrid(tx, ty)) {
      const k = ty * this.cols + tx;
      if (!this.nav[k]) return { x: this.navX[k], y: this.navY[k] };
    }
    return { x: tx * T + T / 2, y: ty * T + T / 2 + 3 };
  }

  buildNav() {
    const n = this.cols * this.rows;
    this.nav = new Uint8Array(n);
    this.cost = new Float32Array(n);
    this.navX = new Float32Array(n);
    this.navY = new Float32Array(n);
    this.edges = new Uint8Array(n);
    this.computeNav();
    this.heap = new Int32Array(n * 8 + 16);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
    // building keeper spots + door points
    for (const b of this.buildings) {
      b.doorOutside = { x: b.doorPx, y: b.bottomPx + 9 };
      if (b.floor) { this.floorSpots(b); continue; }
      b.doorInside = b.h >= 4 ? { x: b.doorPx, y: (b.y + b.h - 2) * T + 11 } : null;
      let best = null, bestScore = Infinity;
      const doorCols = [];
      for (let c = b.doorX0; c < b.doorX1; c++) doorCols.push(c);
      const icx = b.x + b.w / 2 - 0.5;
      for (const k of b.interior) {
        if (this.nav[k]) continue;
        const tx = k % this.cols, ty = (k / this.cols) | 0;
        let s = Math.abs(tx - icx) * 0.6 + (ty - (b.y + 2)) * 1.0;
        if (doorCols.includes(tx)) s += 6;
        if (s < bestScore) { bestScore = s; best = k; }
      }
      if (best !== null) {
        const tx = best % this.cols, ty = (best / this.cols) | 0;
        b.keeperSpot = { x: tx * T + T / 2, y: ty * T + 11, tx, ty };
      }
    }
  }

  // Feet positions reachable from the door gap without leaving the footprint (1 px flood with the
  // player's own collision, precomputed once per building in `free`), optionally with one extra
  // solid rect (a keeper being placed).
  floorReach(b, free, extra) {
    const x0 = b.px, y0 = b.py, w = b.pw + 1, h = b.ph + 1;
    const seen = new Uint8Array(w * h);
    const hw = FEET_W / 2;
    const open = (lx, ly) => {
      if (!free[ly * w + lx]) return false;
      if (!extra) return true;
      const x = x0 + lx, y = y0 + ly;
      return !(x - hw < extra.x + extra.w && x + hw > extra.x && y - FEET_UP < extra.y + extra.h && y - FEET_UP + FEET_H > extra.y);
    };
    const sx = Math.round(b.doorPx) - x0;
    let sy = h - 2;
    while (sy > h - 8 && !open(sx, sy)) sy--;
    if (!open(sx, sy)) return { seen, count: 0, w, h };
    const q = new Int32Array(w * h);
    let qh = 0, qt = 0;
    seen[sy * w + sx] = 1; q[qt++] = sy * w + sx;
    while (qh < qt) {
      const i = q[qh++], lx = i % w, ly = (i / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = lx + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = ly + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j]) continue;
        seen[j] = 2;
        if (!open(nx, ny)) continue;
        seen[j] = 1; q[qt++] = j;
      }
    }
    return { seen, count: qt, w, h };
  }

  // Door-inside point and keeper spot for a floor-rect building (px search). The keeper stands
  // toward the back-centre, but out of the lane the player walks in through the door, where they
  // shut off as little of the floor as possible and can be reached for a talk.
  floorSpots(b) {
    const f = b.floor;
    const dx = Math.max(f.x0 + 6, Math.min(f.x1 - 6, b.doorPx));
    const dy = f.y1 - 3;
    b.doorInside = !this.feetHit(dx, dy) ? { x: dx, y: dy } : null;
    const fcx = (f.x0 + f.x1) / 2;
    const d0 = b.doorX0 * T, d1 = b.doorX1 * T;
    // lanes, most generous first: the strip the player's feet sweep walking in from the door gap
    const lanes = [
      { pad: { x: -8, y: -8, w: 16, h: 14 }, lane: { x: d0 - 3, y: f.y1 - FEET_H - 16, w: d1 - d0 + 6, h: b.bottomPx - (f.y1 - FEET_H - 16) } },
      { pad: { x: KEEPER_BOX[0], y: KEEPER_BOX[1], w: KEEPER_BOX[2], h: KEEPER_BOX[3] }, lane: { x: d0, y: f.y1 - FEET_H - 4, w: d1 - d0, h: b.bottomPx - (f.y1 - FEET_H - 4) } },
    ];
    // spots where the keeper's sprite stands clear of furniture (the solid rect fits, and the
    // body has a pixel or two of room around it when "roomy")
    const all = [];
    const kx0 = KEEPER_BOX[0], ky0 = KEEPER_BOX[1], kx1 = KEEPER_BOX[0] + KEEPER_BOX[2], ky1 = KEEPER_BOX[1] + KEEPER_BOX[3];
    for (let y = f.y0 + 5; y <= f.y1 - 2; y += 1) {
      for (let x = f.x0 + 6; x <= f.x1 - 6; x += 1) {
        if (y + ky0 < f.y0 - 2 || this.boxHits(x + kx0, Math.max(f.y0, y + ky0), x + kx1, y + Math.min(ky1, 3))) continue;
        all.push([Math.abs(x - fcx) + (y - f.y0) * 0.7, x, y, !this.boxHits(x - 7, y - 6, x + 7, y + 3)]);
      }
    }
    all.sort((p, q) => p[0] - q[0]);
    let cands = [];
    for (let t = 0; t < lanes.length && !cands.length; t++) {
      const { pad, lane } = lanes[t];
      cands = all.filter(([, x, y, roomy]) => (t > 0 || roomy) && !overlap({ x: x + pad.x, y: y + pad.y, w: pad.w, h: pad.h }, lane));
    }
    const inLane = !cands.length;
    if (inLane) cands = all;
    // free feet positions in the footprint, once; then score up to 40 spread-out candidates
    const w = b.pw + 1, h = b.ph + 1;
    const free = new Uint8Array(w * h);
    for (let ly = 0; ly < h; ly++) for (let lx = 0; lx < w; lx++) free[ly * w + lx] = this.feetHit(b.px + lx, b.py + ly) ? 0 : 1;
    const base = this.floorReach(b, free, null);
    const hw = FEET_W / 2;
    let best = null, bestCost = Infinity, bestInfo = null;
    const tried = new Set();
    for (const [score, x, y] of cands) {
      const cell = ((x / 3) | 0) * 4096 + ((y / 3) | 0);
      if (tried.has(cell)) continue;
      tried.add(cell);
      if (tried.size > 40) break;
      const kr = { x: x + KEEPER_BOX[0], y: y + KEEPER_BOX[1], w: KEEPER_BOX[2], h: KEEPER_BOX[3] };
      const r = this.floorReach(b, free, kr);
      let lost = 0, talk = false;
      for (let i = 0; i < base.seen.length; i++) {
        if (base.seen[i] !== 1) continue;
        const px = b.px + (i % w), py = b.py + ((i / w) | 0);
        if (r.seen[i] === 1) {
          if (!talk && Math.hypot(px - x, py - y) < NEAR_KEEPER - 8) talk = true;
        } else if (!(px - hw < kr.x + kr.w && px + hw > kr.x && py - FEET_UP < kr.y + kr.h && py - FEET_UP + FEET_H > kr.y)) lost++;
      }
      const frac = base.count ? lost / base.count : 1;
      const cost = score + 250 * frac + (talk ? 0 : 1000);
      if (cost < bestCost) { bestCost = cost; best = [x, y]; bestInfo = { frac, talk }; }
    }
    if (best && (inLane || !bestInfo.talk || bestInfo.frac > 0.35)) {
      warnOnce(`keeper:${b.id}`, `${b.id} (${b.arch ? b.arch.id : b.archetype}): 番人の立つ所が${inLane ? '扉からの通り道にかかる' : !bestInfo.talk ? '話しかけられない' : `床の ${Math.round(bestInfo.frac * 100)}% をふさぐ`}`);
    }
    // the floor (minus everything inside it) that walkers may wander on
    b.interior = [];
    for (let ty = b.y; ty < b.y + b.h; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) {
      const k = ty * this.cols + tx;
      if (this.inGrid(tx, ty) && !this.nav[k] && this.navY[k] <= f.y1) b.interior.push(k);
    }
    if (best) b.keeperSpot = { x: best[0], y: best[1], tx: Math.floor(best[0] / T), ty: Math.floor((best[1] - 3) / T) };
  }

  navFree(tx, ty) { return this.inGrid(tx, ty) && this.nav[ty * this.cols + tx] === 0; }

  nearestFree(tx, ty, maxR = 12) {
    if (this.navFree(tx, ty)) return [tx, ty];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (this.navFree(tx + dx, ty + dy)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [tx + dx, ty + dy]; } }
      }
      if (best) return best;
    }
    return null;
  }

  // A* on the tile grid, 8-neighbour without corner cutting. Returns [[tx,ty],...] or null.
  findPath(sx, sy, gx, gy, opts = {}) {
    if (!this.navFree(sx, sy)) { const s = this.nearestFree(sx, sy, 2); if (!s) return null; [sx, sy] = s; }
    if (!this.navFree(gx, gy)) return null;
    const cols = this.cols, n = cols * this.rows;
    const start = sy * cols + sx, goal = gy * cols + gx;
    if (start === goal) return [[gx, gy]];
    const gen = ++this.gen;
    const { g, f, from, stamp, closed, heap, nav, cost, edges } = this;
    const useCost = opts.useCost !== false;
    const avoid = opts.avoid; // optional tile index to treat as blocked
    let hn = 0;
    const push = (k) => {
      let i = hn++; heap[i] = k;
      while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[k]) break; heap[i] = heap[p]; i = p; }
      heap[i] = k;
    };
    const pop = () => {
      const top = heap[0]; const last = heap[--hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= hn) break;
        if (c + 1 < hn && f[heap[c + 1]] < f[heap[c]]) c++;
        if (f[heap[c]] >= f[last]) break;
        heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
      return top;
    };
    const h = (k) => { const x = k % cols, y = (k / cols) | 0; const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return (dx + dy + (1.4142 - 2) * Math.min(dx, dy)); };
    stamp[start] = gen; g[start] = 0; f[start] = h(start); from[start] = -1; push(start);
    let iter = 0;
    while (hn > 0 && iter++ < n * 4) {
      const cur = pop();
      if (cur === goal) break;
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const cx = cur % cols, cy = (cur / cols) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= this.rows) continue;
        const nk = ny * cols + nx;
        if (nav[nk] || nk === avoid || closed[nk] === gen) continue;
        if (!(edges[cur] & (1 << DIR_AT[(dy + 1) * 3 + dx + 1]))) continue;
        const step = (dx && dy ? 1.4142 : 1) * (useCost ? cost[nk] : 1);
        const ng = g[cur] + step;
        if (stamp[nk] !== gen || ng < g[nk]) {
          stamp[nk] = gen; g[nk] = ng; f[nk] = ng + h(nk); from[nk] = cur;
          if (hn < heap.length) push(nk);
        }
      }
    }
    if (stamp[goal] !== gen) return null;
    const path = [];
    for (let k = goal; k !== -1 && path.length < n; k = from[k]) path.push([k % cols, (k / cols) | 0]);
    path.reverse();
    return path;
  }

  // Can a feet box travel straight from a to b? (sampled sweep)
  sweepFree(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.feetHit(ax + dx * t, ay + dy * t)) return false;
    }
    return true;
  }

  // Tile path -> px waypoints, string-pulled so motion is not grid-bound.
  smoothPath(fromX, fromY, tiles, endX, endY) {
    const pts = tiles.map(([tx, ty]) => this.navPoint(tx, ty));
    if (endX !== undefined && pts.length) pts[pts.length - 1] = { x: endX, y: endY };
    const out = [];
    let cx = fromX, cy = fromY, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.sweepFree(cx, cy, pts[j].x, pts[j].y)) j--;
      out.push(pts[j]);
      cx = pts[j].x; cy = pts[j].y; i = j + 1;
    }
    return out;
  }
}
