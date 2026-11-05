// Static world model: collision (tiles + px rects), buildings, props, navigation grid, A*.

import { TILE, FEET_W, FEET_H, FEET_UP } from './config.js';
import { MAT } from './ground.js';
import { warnOnce } from './assets.js';
import { strHash } from './util.js';

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

  // Stable variant choice: hash(building.id) among the variants whose footprint fits.
  pickVariant(b, w, h) {
    const a = this.art.archetypes[b.archetype];
    if (!a || !a.variants.length) return null;
    const fits = a.variants.filter((v) => !v.footprint || (v.footprint[0] === w && v.footprint[1] === h));
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
    // door gap on the bottom row
    let d0, d1;
    if (arch && arch.door && Number.isFinite(arch.door.x)) {
      d0 = x + (arch.door.x | 0); d1 = d0 + Math.max(1, arch.door.w | 0);
      if (b.door && (b.door.x < d0 || b.door.x >= d1)) warnOnce(`door:${b.id}`, `${b.id}: town の扉 x=${b.door.x} が archetype の扉 ${d0}..${d1 - 1} の外です`);
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
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (!this.inGrid(tx, ty)) continue;
        const k = ty * this.cols + tx;
        this.buildingMap[k] = index;
        const ring = ty === y || ty === y + 1 || ty === bottom || tx === x || tx === x + w - 1;
        const doorGap = ty === bottom && tx >= d0 && tx < d1;
        if (ring && !doorGap) this.tileSolid[k] = 1;
        else {
          this.tileSolid[k] = 0;
          if (!doorGap) bld.interior.push(k);
        }
      }
    }
    if (arch) {
      for (const bl of arch.blockers) {
        if (Array.isArray(bl) && bl.length >= 4) this.addRect(bld.px + bl[0], bld.py + bl[1], bl[2], bl[3], 'blocker');
      }
      arch.lights.forEach((l, i) => {
        if (Array.isArray(l) && l.length >= 3) this.lights.push({ x: bld.px + l[0], y: bld.py + l[1], poolY: bld.py + l[1] + 4, r: l[2], kind: 'window', seed: index * 31 + i, building: bld });
      });
    }
    // door lantern just outside the door
    this.lights.push({ x: bld.doorPx, y: bld.bottomPx - 10, poolY: bld.bottomPx + 2, r: 34, kind: 'door', seed: index * 31 + 29, building: bld });
    this.buildings.push(bld);
  }

  addProp(p, index) {
    const def = this.art.props[p.type] || null;
    if (!def) warnOnce(`prop:${p.type}`, `prop "${p.type}" が manifest にありません（描画しません）`);
    const ax = Math.round(p.x * T), ay = Math.round(p.y * T);
    const prop = { index, type: p.type, data: p, def, x: ax, y: ay, solid: null };
    if (def && def.solid) prop.solid = this.addRect(ax + def.solid[0], ay + def.solid[1], def.solid[2], def.solid[3], 'prop');
    if (def && def.light) {
      // the glow sits at the light point; the pool it casts is centred lower, toward the
      // ground under it (3/4 view: a lantern on a post lights the street around its foot)
      const lx = ax + def.light[0], ly = ay + def.light[1];
      this.lights.push({ x: lx, y: ly, poolY: ly + Math.max(0, ay - ly) * 0.6, r: def.light[2], kind: def.flicker ? 'flame' : 'steady', seed: 1000 + index, building: null });
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
  computeNav() {
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) {
        const k = ty * this.cols + tx;
        // a tile is walkable for paths when a feet box centred on it is free
        const cx = tx * T + T / 2, cy = ty * T + T / 2 + 3;
        const blocked = this.tileSolid[k] || this.feetHit(cx, cy);
        this.nav[k] = blocked ? 1 : 0;
        const m = this.grid[k];
        this.cost[k] = this.buildingMap[k] >= 0 ? 1.1 : m === MAT.STREET || m === MAT.PLAZA ? 1 : m === MAT.DIRT ? 1.35 : 2.4;
      }
    }
  }

  buildNav() {
    const n = this.cols * this.rows;
    this.nav = new Uint8Array(n);
    this.cost = new Float32Array(n);
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
    const { g, f, from, stamp, closed, heap, nav, cost } = this;
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
        if (dx && dy && (nav[cy * cols + nx] || nav[ny * cols + cx])) continue;
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
    const pts = tiles.map(([tx, ty]) => ({ x: tx * T + T / 2, y: ty * T + T / 2 + 3 }));
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
