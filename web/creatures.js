// Small creatures (town.creatures, CONTRACTS.md): pigeons = direct dependencies, dogs = bots that
// work on the repo, cats = scheduled / background work (and one asleep by a ruin). They are drawn
// y-sorted with the other sprites and under the night grade, never block anyone, and standing
// near one shows a tiny bubble with what it really stands for.

import { TILE } from './config.js';
import { loadImage, toCanvas, cleanMagenta, warnOnce } from './assets.js';
import { strHash, mulberry32 } from './util.js';

const T = TILE;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NEAR = 26;                 // px, bubble distance (feet to feet)
const RUN = 95;                  // px/s, the player counts as running above this
const MEANING = {
  pigeon: () => 'このリポジトリが使っている道具',
  dog: () => 'リポジトリの手伝いをするbot',
  cat: (c) => (c.meaning === 'ruin' ? '長く触られていない場所で眠っている' : c.meaning === 'cron' ? '決まった時間に動く仕事' : '裏で動く仕事'),
};
const KIND_JA = { pigeon: '鳩', dog: '犬', cat: '猫' };
const SHADOW = { pigeon: [6, 2], cat: [10, 3], dog: [14, 4] };

// --- art ---------------------------------------------------------------------------------
export async function loadCreatureArt(manifest, manifestUrl) {
  const defs = (manifest && manifest.creatures) || {};
  const base = new URL(manifestUrl, location.href).href;
  const sheets = {};
  await Promise.all(Object.entries(defs).map(async ([name, d]) => {
    const img = d && d.src ? await loadImage(new URL(d.src, base).href) : null;
    if (!img) return;
    const c = toCanvas(img);
    cleanMagenta(c);
    const [fw, fh] = d.frame || [16, 16];
    const [px, py] = d.pivot || [fw >> 1, fh - 1];
    sheets[name] = { image: c, fw, fh, px, py, cols: Math.max(1, Math.floor(c.width / fw)), anims: d.anims || {} };
  }));
  return sheets;
}

function frameOf(sheet, anim, dir, t, fps) {
  const a = sheet.anims[anim] || sheet.anims.idle || {};
  const list = a[dir] || a[dir === 'up' || dir === 'down' ? 'left' : 'down'] || a.left || Object.values(a)[0];
  if (!list || !list.length) return null;
  const i = list[Math.floor(t * fps) % list.length];
  return { sx: (i % sheet.cols) * sheet.fw, sy: Math.floor(i / sheet.cols) * sheet.fh };
}

const dirOf = (dx, dy, cur) => (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 ? cur
  : Math.abs(dx) >= Math.abs(dy) * 0.8 ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down');

// --- one creature --------------------------------------------------------------------------
class Creature {
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

  free(px, py) {
    const w = this.world;
    return !w.boxHits(px - 3, py - 3, px + 3, py + 1) && !w.buildingAtPx(px, py);
  }

  // a free spot within r px of (cx, cy), at least away px from (ax, ay)
  spot(cx, cy, r, ax, ay, away = 0) {
    for (let i = 0; i < 16; i++) {
      const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * r;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (away && Math.hypot(x - ax, y - ay) < away) continue;
      if (this.free(x, y)) return { x, y };
    }
    return null;
  }

  // walk toward the target at speed; slides along blockers; returns true on arrival / when stuck
  moveTo(tx, ty, speed, dt) {
    const dx = tx - this.x, dy = ty - this.y, dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const s = Math.min(dist, speed * dt);
    const nx = this.x + (dx / dist) * s, ny = this.y + (dy / dist) * s;
    this.facing = dirOf(dx, dy, this.facing);
    if (this.free(nx, ny)) { this.x = nx; this.y = ny; return false; }
    if (this.free(nx, this.y)) { this.x = nx; return false; }
    if (this.free(this.x, ny)) { this.y = ny; return false; }
    return true;
  }

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

  // pigeons: idle / peck / hop near home; take off when the player runs close, land again nearby
  pigeon(dt, p, dist, speed, all) {
    if (this.state === 'fly') return this.flight(dt, p);
    if (this.state === 'startle') {           // a flock-mate took off: follow a beat later
      if (this.timer <= 0) this.takeOff(p);
      return;
    }
    if (!this.cool && dist < 44 && speed > RUN) {
      this.takeOff(p);
      for (const o of this.flock || []) {
        if (o !== this && o.state !== 'fly' && o.state !== 'startle' && Math.hypot(o.x - this.x, o.y - this.y) < 40) {
          o.state = 'startle'; o.timer = 0.06 + o.rand() * 0.3;
        }
      }
      return;
    }
    if (this.state === 'hop') {
      if (this.moveTo(this.target.x, this.target.y, 30, dt) || this.timer <= 0) { this.state = 'rest'; this.timer = 0.4 + this.rand() * 1.5; }
      return;
    }
    // a walking player stepping onto it: a short hop aside
    if (dist < 13 && speed > 10 && !this.cool) {
      const a = Math.atan2(this.y - p.y, this.x - p.x);
      const tx = this.x + Math.cos(a) * 14, ty = this.y + Math.sin(a) * 14;
      if (this.free(tx, ty)) { this.target = { x: tx, y: ty }; this.state = 'hop'; this.timer = 0.6; this.cool = 0.8; return; }
    }
    if (this.timer > 0) return;
    const r = this.rand();
    if (r < 0.4) { this.state = 'peck'; this.timer = 0.6 + this.rand() * 1.4; }
    else if (r < 0.75) {
      const back = Math.hypot(this.x - this.hx, this.y - this.hy) > 22;
      const s = back ? this.spot(this.hx, this.hy, 10) : this.spot(this.x, this.y, 14);
      if (s) { this.target = s; this.state = 'hop'; this.timer = 1.2; } else { this.state = 'rest'; this.timer = 1; }
    } else {
      this.state = 'rest'; this.timer = 0.6 + this.rand() * 2.2;
      if (this.rand() < 0.6) this.facing = ['left', 'right', 'down', 'up'][Math.floor(this.rand() * 4)];
    }
  }

  takeOff(p) {
    const a = Math.atan2(this.y - p.y, this.x - p.x) + (this.rand() - 0.5) * 1.2;
    this.state = 'fly';
    this.leg = 'out';
    this.vx = Math.cos(a) * (90 + this.rand() * 30);
    this.vy = Math.sin(a) * (60 + this.rand() * 20);
    this.zMax = 34 + this.rand() * 26;
    this.timer = 1.0 + this.rand() * 0.6;
    this.facing = this.vx < 0 ? 'left' : 'right';
  }

  flight(dt, p) {
    if (this.leg === 'out') {
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.z = Math.min(this.zMax, this.z + 70 * dt);
      if (this.timer <= 0) {
        // circle back to a spot near home, away from where the player is now
        this.target = this.spot(this.hx, this.hy, 40, p.x, p.y, 64) || this.spot(this.hx, this.hy, 90, p.x, p.y, 48) || { x: this.hx, y: this.hy };
        this.leg = 'back';
        this.timer = 0.8 + this.rand() * 1.4;    // glide a while out of reach first
      }
      return;
    }
    if (this.leg === 'back' && this.timer > 0) {   // wheel around, slowly turning home
      const tx = this.target.x - this.x, ty = this.target.y - this.y, d = Math.hypot(tx, ty) || 1;
      this.vx += ((tx / d) * 90 - this.vx) * Math.min(1, dt * 1.6);
      this.vy += ((ty / d) * 70 - this.vy) * Math.min(1, dt * 1.6);
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.facing = this.vx < 0 ? 'left' : 'right';
      return;
    }
    const tx = this.target.x - this.x, ty = this.target.y - this.y, d = Math.hypot(tx, ty);
    const s = Math.min(d, 80 * dt);
    if (d > 0.5) { this.x += (tx / d) * s; this.y += (ty / d) * s; this.facing = tx < 0 ? 'left' : tx > 0 ? 'right' : this.facing; }
    this.z = Math.min(this.z, Math.max(0, (d - 2) * 0.45));
    if (d < 1.5) {
      this.z = 0; this.state = 'rest'; this.timer = 0.8 + this.rand() * 1.5; this.cool = 1.6;
      this.facing = this.rand() < 0.5 ? 'left' : 'right';
    }
  }

  // dogs: trot around the town hall; follow the player a few steps when they come by
  dog(dt, p, dist, speed) {
    if (this.state === 'follow') {
      const back = 12;
      const sp = Math.hypot(p.vx || 0, p.vy || 0);
      const tx = p.x - (sp > 1 ? (p.vx / sp) * back : 0), ty = p.y - (sp > 1 ? (p.vy / sp) * back : 0) + 2;
      if (this.world.buildingAtPx(tx, ty) || this.timer <= 0) { this.state = 'watch'; this.timer = 1 + this.rand(); this.cool = 7; return; }
      if (Math.hypot(tx - this.x, ty - this.y) > 6) this.moveTo(tx, ty, Math.min(110, Math.max(60, sp)), dt);
      else this.facing = dirOf(p.x - this.x, p.y - this.y, this.facing);
      return;
    }
    if (!this.cool && dist < 40 && speed > 20 && this.state !== 'watch' && !this.world.buildingAtPx(p.x, p.y)) {
      this.state = 'follow'; this.timer = 1.8 + this.rand() * 1.2;
      return;
    }
    if (this.state === 'watch') {
      this.facing = dirOf(p.x - this.x, p.y - this.y, this.facing);
      if (this.timer <= 0) { this.state = 'trot'; this.target = this.spot(this.hx, this.hy, 20) || { x: this.hx, y: this.hy }; this.timer = 6; }
      return;
    }
    if (this.state === 'trot') {
      if (this.moveTo(this.target.x, this.target.y, 44, dt) || this.timer <= 0) { this.state = this.rand() < 0.5 ? 'sit' : 'rest'; this.timer = 1.2 + this.rand() * 2.5; }
      return;
    }
    if (this.timer > 0) {
      if ((this.state === 'rest' || this.state === 'sit') && dist < 60) this.facing = dirOf(p.x - this.x, p.y - this.y, this.facing);
      return;
    }
    const far = Math.hypot(this.x - this.hx, this.y - this.hy) > 56;
    this.target = (far ? this.spot(this.hx, this.hy, 24) : this.spot(this.hx, this.hy, 64)) || { x: this.hx, y: this.hy };
    this.state = 'trot'; this.timer = 5;
  }

  // cats: wander slowly, sit, nap; the ruin cat just sleeps
  cat(dt, p, dist) {
    if (this.d.sleeping) { this.facing = 'down'; return; }
    if (this.state === 'walk') {
      if (this.moveTo(this.target.x, this.target.y, 17, dt) || this.timer <= 0) { this.state = this.rand() < 0.6 ? 'rest' : 'stand'; this.timer = 1.5 + this.rand() * 4; }
      return;
    }
    if (this.state !== 'nap' && dist < 40) this.facing = dirOf(p.x - this.x, p.y - this.y, this.facing);
    if (this.timer > 0) return;
    const r = this.rand();
    if (this.state === 'nap') { this.state = 'rest'; this.timer = 2 + this.rand() * 3; return; }
    if (this.state === 'rest' && r < 0.35) { this.state = 'nap'; this.timer = 7 + this.rand() * 9; this.facing = 'down'; return; }
    if (r < 0.75) {
      this.target = this.spot(this.hx, this.hy, 36) || { x: this.hx, y: this.hy };
      this.state = 'walk'; this.timer = 8;
    } else { this.state = 'stand'; this.timer = 1 + this.rand() * 2; }
  }

  draw(ctx, camX, camY) {
    const fx = Math.round(this.rx) - camX, fy = Math.round(this.ry) - camY, z = Math.round(this.rz);
    // shadow on the ground, shrinking as the bird climbs
    const [sw, sh] = SHADOW[this.kind] || [8, 3];
    if (z < 40) {
      const k = z > 0 ? Math.max(0.4, 1 - z / 50) : 1;
      const w = Math.max(2, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
      ctx.fillStyle = `rgba(0,0,0,${(0.34 * k).toFixed(3)})`;
      ctx.fillRect(fx - (w >> 1), fy - (h >> 1), w, h);
      if (w > 4) ctx.fillRect(fx - (w >> 1) - 1, fy - (h >> 1) + (h > 2 ? 1 : 0), w + 2, Math.max(1, h - 2));
    }
    let s = this.sheet, f = null;
    if (this.kind === 'pigeon' && this.flying && this.fly) { s = this.fly; f = frameOf(s, 'fly', this.facing, this.t, 12); }
    else if (s) {
      const st = this.state;
      if (st === 'walk' || st === 'trot' || (st === 'follow' && Math.hypot(this.x - this.prevX, this.y - this.prevY) > 0.05)) f = frameOf(s, 'walk', this.facing, this.t, st === 'walk' ? 6 : 10);
      else if (st === 'hop') f = frameOf(s, 'hop', this.facing, this.t, 8);
      else if (st === 'peck') f = frameOf(s, 'peck', this.facing, this.t, 5);
      else if (st === 'stand' || (this.kind === 'dog' && (st === 'rest' || st === 'watch' || st === 'follow'))) f = frameOf(s, 'stand', this.facing, this.t, 1);
      else f = frameOf(s, 'idle', this.facing, this.t, 1);
    }
    if (s && f) ctx.drawImage(s.image, f.sx, f.sy, s.fw, s.fh, fx - s.px, fy - z - s.py, s.fw, s.fh);
    if (this.state === 'nap' && s) this.drawZ(ctx, fx + 3, fy - s.py - 1);
  }

  // tiny pixel "z"s drifting up from a sleeping cat
  drawZ(ctx, x, y) {
    ctx.fillStyle = 'rgb(232,226,255)';
    for (let i = 0; i < 2; i++) {
      const ph = (this.t * 0.45 + i * 0.5) % 1;
      const n = i === 0 ? 4 : 3;
      const zx = Math.round(x + ph * 5 + i * 2), zy = Math.round(y - ph * 10);
      ctx.globalAlpha = ph < 0.75 ? 0.9 : (1 - ph) * 3.6;
      ctx.fillRect(zx, zy, n, 1);
      ctx.fillRect(zx, zy + n - 1, n, 1);
      for (let k = 1; k < n - 1; k++) ctx.fillRect(zx + n - 1 - k, zy + k, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
}

// --- the set ---------------------------------------------------------------------------------
export function createCreatures(town, world, sheets) {
  const list = [];
  for (const d of town.creatures || []) {
    if (!d || !d.home || !Number.isFinite(d.home.x) || !Number.isFinite(d.home.y)) continue;
    const c = new Creature(d, world, sheets);
    if (!c.sheet) warnOnce(`creature:${d.sprite || d.kind}`, `生き物 ${d.sprite || d.kind} の画像がありません（描かずに続けます）`);
    list.push(c);
  }
  // flocks: pigeons sharing a flock id
  const flocks = new Map();
  for (const c of list) if (c.kind === 'pigeon') {
    const k = c.d.flock ?? 0;
    (flocks.get(k) || flocks.set(k, []).get(k)).push(c);
  }
  for (const f of flocks.values()) for (const c of f) c.flock = f;

  let el = null, cur = null, lastX = -1, lastY = -1, lastBelow = null, bw = 0;
  const bubbleEl = () => {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'creature-bubble';
    el.style.cssText = 'position:absolute;left:0;top:0;max-width:min(460px,calc(100vw - 16px));width:max-content;background:rgba(12,13,22,0.88);padding:2px 9px 3px;'
      + 'border-radius:2px;box-shadow:inset 0 0 0 2px rgba(170,200,214,0.4);font-size:15px;line-height:1.35;opacity:0;'
      + 'transition:opacity 140ms ease-out;color:#ebe4d6;pointer-events:none;';
    (document.getElementById('ui') || document.body).appendChild(el);
    return el;
  };

  return {
    list,
    update(dt, player) {
      for (let i = 0; i < list.length; i++) list[i].update(dt, player, list);
    },
    // the creature to talk about: the nearest one on the ground within NEAR, unless a resident is nearer
    pick(player, walker) {
      let best = null, bd = NEAR * NEAR;
      for (const c of list) {
        if (c.flying) continue;
        const dx = c.x - player.x, dy = c.y - player.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = c; }
      }
      if (best && walker && (walker.x - player.x) ** 2 + (walker.y - player.y) ** 2 <= bd) return null;
      return best;
    },
    bubble(view, player, best) {
      if (!list.length) return;
      const b = bubbleEl();
      if (best !== cur) {
        cur = best;
        if (best) {
          const m = MEANING[best.kind](best.d);
          b.innerHTML = `<div><span style="font-weight:700;color:#d8ecff">${KIND_JA[best.kind]}「${esc(best.name)}」</span>`
            + `<span style="color:#d6ccb8">（${esc(m)}）</span></div>`
            + (best.d.reason ? `<div style="font-size:13px;color:#9d968a">${esc(best.d.reason)}</div>` : '');
          b.style.opacity = '1';
          bw = b.offsetWidth;
        } else b.style.opacity = '0';
      }
      if (best) {
        const below = player.ry < best.ry - 4;
        const head = best.sheet ? best.sheet.py + 3 : 18;
        // keep the whole bubble on screen (a long workflow name near the edge would run off it)
        const cx = (Math.round(best.rx) - view.camX) * view.cssPerPx;
        const x = Math.round(Math.max(bw / 2 + 6, Math.min(window.innerWidth - bw / 2 - 6, cx)));
        const y = Math.round((Math.round(best.ry) + (below ? 5 : -head) - view.camY) * view.cssPerPx);
        if (x !== lastX || y !== lastY || below !== lastBelow) {
          lastX = x; lastY = y; lastBelow = below;
          b.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${below ? '0' : '-100%'})`;
        }
      }
    },
    get current() { return cur; },
  };
}
