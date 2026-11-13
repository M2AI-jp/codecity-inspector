// DEBUG ONLY (?debug=1&art=placeholder). Procedural stand-in art so the runtime's art code paths (archetype origins,
// exterior/cutaway cross-fade, blockers, lights, smoke, props, ground textures, resident
// sprites) can be exercised before the real art exists. Never loaded in normal mode.
// These images are deliberately plain and are not game assets.

import { hash2, mulberry32 } from '../util.js';

const T = 16;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
const shade = (c, k) => rgb(c[0] * k, c[1] * k, c[2] * k);

function noiseTex(size, base, amp, seed, speck) {
  const c = mk(size, size), g = c.getContext('2d');
  const id = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = (hash2(x, y, seed) - 0.5) * amp + (hash2(x >> 2, y >> 2, seed + 1) - 0.5) * amp * 0.8;
    let k = 1 + n / 100;
    if (speck && hash2(x, y, seed + 2) < speck) k *= 1.25;
    const i = (y * size + x) * 4;
    id.data[i] = base[0] * k; id.data[i + 1] = base[1] * k; id.data[i + 2] = base[2] * k; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}

function stoneTex(size, rowH, minW, maxW, base, mortar, seed) {
  const c = mk(size, size), g = c.getContext('2d');
  g.fillStyle = rgb(...mortar); g.fillRect(0, 0, size, size);
  const rng = mulberry32(seed);
  for (let y = 0; y < size; y += rowH) {
    const widths = []; let sum = 0;
    while (sum < size) { let w = minW + Math.floor(rng() * (maxW - minW + 1)); if (size - sum - w < minW && size - sum - w !== 0) w = size - sum; widths.push(w); sum += w; }
    let x = Math.floor(rng() * size);
    for (const w of widths) {
      const k = 0.82 + rng() * 0.3;
      const col = [base[0] * k, base[1] * k, base[2] * k];
      for (let yy = 1; yy < rowH; yy++) for (let xx = 1; xx < w; xx++) {
        const px = (x + xx) % size, py = y + yy;
        let kk = 1;
        if (yy === 1 || xx === 1) kk = 1.14; else if (yy === rowH - 1 || xx === w - 1) kk = 0.8;
        if ((yy === 1 && xx === 1) || (yy === 1 && xx === w - 1) || (yy === rowH - 1 && xx === 1) || (yy === rowH - 1 && xx === w - 1)) continue;
        kk *= 1 + (hash2(px, py, seed) - 0.5) * 0.12;
        g.fillStyle = rgb(col[0] * kk, col[1] * kk, col[2] * kk); g.fillRect(px, py, 1, 1);
      }
      x = (x + w) % size;
    }
  }
  return c;
}

const ARCH = {
  house_s: { fp: [5, 4], door: { x: 2, w: 1 }, wall: [150, 128, 104], roof: [120, 64, 52], blockers: [[52, 34, 10, 8]], chimney: 3 },
  house_m: { fp: [6, 5], door: { x: 2, w: 2 }, wall: [138, 122, 108], roof: [92, 70, 96], blockers: [[66, 34, 12, 9]], chimney: 1 },
  shop: { fp: [6, 5], door: { x: 2, w: 2 }, wall: [146, 132, 98], roof: [60, 88, 112], blockers: [[18, 34, 12, 8], [66, 34, 12, 8]], chimney: -1 },
  workshop: { fp: [8, 6], door: { x: 3, w: 2 }, wall: [120, 104, 92], roof: [86, 70, 56], blockers: [[20, 34, 24, 10], [86, 50, 18, 12]], chimney: 6 },
  ruin: { fp: [6, 5], door: { x: 2, w: 1 }, wall: [104, 104, 96], roof: [72, 80, 66], blockers: [[66, 36, 12, 10]], chimney: -1, ruin: true },
};
const UP = 40;   // image px above the footprint top (roof overhang)

function drawFacade(g, a, w, h, cut) {
  const pw = w * T, ph = h * T;
  const top = UP, bottomY = UP + ph;
  const wall = a.wall;
  const d0 = a.door.x * T, d1 = (a.door.x + a.door.w) * T;
  if (!cut) {
    // facade (front wall) occupies the last row and a bit above
    g.fillStyle = shade(wall, 0.92); g.fillRect(0, bottomY - T - 10, pw, T + 10);
    g.fillStyle = shade(wall, 0.7); g.fillRect(0, bottomY - 2, pw, 2);
    for (let x = 0; x < pw; x += 8) { g.fillStyle = shade(wall, 0.8); g.fillRect(x, bottomY - T - 10, 1, T + 8); }
    // door opening
    g.fillStyle = '#1a1214'; g.fillRect(d0 + 2, bottomY - 22, d1 - d0 - 4, 22);
    g.fillStyle = shade(wall, 0.55); g.fillRect(d0 + 1, bottomY - 23, d1 - d0 - 2, 2);
    // windows
    for (let x = T; x < pw - T; x += 2 * T) {
      if (x + 10 > d0 && x < d1) continue;
      g.fillStyle = '#2a1e1a'; g.fillRect(x + 2, bottomY - 20, 10, 9);
      g.fillStyle = a.ruin ? '#3b3a36' : '#f2c46a'; g.fillRect(x + 3, bottomY - 19, 8, 7);
      g.fillStyle = '#2a1e1a'; g.fillRect(x + 6, bottomY - 19, 1, 7);
    }
    // roof: covers everything above the facade
    const roofBottom = bottomY - T - 10;
    const rc = a.roof;
    for (let y = 2; y < roofBottom; y++) {
      const inset = Math.max(0, 6 - Math.floor(y / 4));
      const k = 0.75 + 0.35 * (y / roofBottom);
      g.fillStyle = shade(rc, k * ((y % 5 === 0) ? 0.8 : 1));
      g.fillRect(inset - 4, y, pw + 8 - inset * 2, 1);
    }
    g.fillStyle = shade(rc, 0.55); g.fillRect(-4, roofBottom - 2, pw + 8, 3);
    for (let y = 4; y < roofBottom - 2; y += 5) for (let x = (y % 10 === 4 ? 0 : 4); x < pw; x += 8) { g.fillStyle = shade(rc, 0.68); g.fillRect(x, y, 1, 4); }
    if (a.chimney >= 0) {
      const cx = a.chimney * T + 4;
      g.fillStyle = shade(wall, 0.6); g.fillRect(cx, 4, 8, 16);
      g.fillStyle = shade(wall, 0.4); g.fillRect(cx - 1, 2, 10, 3);
    }
    if (a.ruin) {
      g.fillStyle = '#121414'; g.fillRect(pw * 0.55, 12, 14, 9); g.fillRect(pw * 0.25, 22, 8, 6);
      for (let i = 0; i < 70; i++) { const x = (hash2(i, 1, 4) * pw) | 0, y = (UP + hash2(i, 2, 4) * (ph - 6)) | 0; g.fillStyle = i % 2 ? '#3f5a34' : '#2f4a2a'; g.fillRect(x, y, 2, 3); }
    }
  } else {
    // floor
    g.fillStyle = shade([120, 90, 62], 1); g.fillRect(6, top + 2 * T, pw - 12, ph - 2 * T);
    for (let y = top + 2 * T; y < bottomY; y += 4) { g.fillStyle = shade([120, 90, 62], 0.82); g.fillRect(6, y, pw - 12, 1); }
    // back wall (visible face) and its cap
    g.fillStyle = shade(wall, 1.02); g.fillRect(0, top - 10, pw, 2 * T + 10);
    g.fillStyle = shade(wall, 0.8); for (let x = 0; x < pw; x += 8) g.fillRect(x, top - 10, 1, 2 * T + 10);
    g.fillStyle = shade(wall, 0.5); g.fillRect(0, top - 12, pw, 3);
    g.fillStyle = '#2a1e1a'; g.fillRect(pw / 2 - 8, top + 6, 16, 12);
    g.fillStyle = '#5d7aa0'; g.fillRect(pw / 2 - 7, top + 7, 14, 10);
    // side walls seen from above
    g.fillStyle = shade(wall, 0.55); g.fillRect(0, top - 10, 6, ph + 10); g.fillRect(pw - 6, top - 10, 6, ph + 10);
    // low front wall stub with the door gap
    g.fillStyle = shade(wall, 0.62); g.fillRect(0, bottomY - 8, d0, 8); g.fillRect(d1, bottomY - 8, pw - d1, 8);
    g.fillStyle = shade(wall, 0.45); g.fillRect(0, bottomY - 9, d0, 2); g.fillRect(d1, bottomY - 9, pw - d1, 2);
    // furniture where the blockers are
    for (const [x, y, bw, bh] of a.blockers) {
      g.fillStyle = '#5a3c26'; g.fillRect(x, top + y - 6, bw, bh + 6);
      g.fillStyle = '#7b5636'; g.fillRect(x, top + y - 6, bw, 3);
    }
  }
}

function building(key, a) {
  const [w, h] = a.fp;
  const ex = mk(w * T, h * T + UP), cu = mk(w * T, h * T + UP);
  drawFacade(ex.getContext('2d'), a, w, h, false);
  drawFacade(cu.getContext('2d'), a, w, h, true);
  const lights = [];
  for (let x = T; x < w * T - T; x += 2 * T) {
    if (x + 10 > a.door.x * T && x < (a.door.x + a.door.w) * T) continue;
    if (!a.ruin) lights.push([x + 7, h * T - 14, 26]);
  }
  return {
    footprint: [w, h],
    exterior: { src: ex.toDataURL(), origin: [0, UP] },
    cutaway: { src: cu.toDataURL(), origin: [0, UP] },
    door: a.door, blockers: a.blockers, lights,
    smoke: a.chimney >= 0 ? [[a.chimney * T + 8, -UP + 2]] : [],
  };
}

function prop(w, h, draw) { const c = mk(w, h); draw(c.getContext('2d')); return c.toDataURL(); }

function residentSheet(tunic, hair) {
  const c = mk(192, 256), g = c.getContext('2d');
  const skin = '#e0b48c';
  const dirs = ['up', 'down', 'right', 'left'];
  dirs.forEach((dir, di) => {
    for (let col = 0; col < 6; col++) {
      const ox = col * 32, oy = di * 64;
      const phase = col >= 2 ? col - 2 : -1;
      const bob = phase === 1 || phase === 3 ? -1 : 0;
      const legA = phase === 0 ? 2 : phase === 2 ? -2 : 0;
      const y0 = oy + 6 + bob;
      // legs
      g.fillStyle = '#2c2a34';
      if (dir === 'up' || dir === 'down') { g.fillRect(ox + 12, y0 + 18, 3, 7 + (legA > 0 ? 0 : -1)); g.fillRect(ox + 17, y0 + 18, 3, 7 + (legA < 0 ? 0 : -1)); }
      else { g.fillRect(ox + 14 + legA, y0 + 18, 3, 7); g.fillRect(ox + 15 - legA, y0 + 18, 3, 7); }
      // body
      g.fillStyle = tunic; g.fillRect(ox + 10, y0 + 9, 12, 11);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(ox + 10, y0 + 17, 12, 3);
      // head
      g.fillStyle = skin; g.fillRect(ox + 11, y0 + 1, 10, 9);
      g.fillStyle = hair;
      if (dir === 'up') g.fillRect(ox + 11, y0, 10, 9);
      else if (dir === 'down') { g.fillRect(ox + 11, y0, 10, 3); g.fillStyle = '#1d1a1a'; g.fillRect(ox + 13, y0 + 5, 1, 2); g.fillRect(ox + 18, y0 + 5, 1, 2); }
      else if (dir === 'right') { g.fillRect(ox + 11, y0, 10, 3); g.fillRect(ox + 11, y0, 4, 8); g.fillStyle = '#1d1a1a'; g.fillRect(ox + 18, y0 + 5, 1, 2); }
      else { g.fillRect(ox + 11, y0, 10, 3); g.fillRect(ox + 17, y0, 4, 8); g.fillStyle = '#1d1a1a'; g.fillRect(ox + 13, y0 + 5, 1, 2); }
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(ox + 11, oy + 31, 10, 1);
    }
  });
  return c.toDataURL();
}

export function placeholderManifest() {
  const archetypes = {};
  // two visual variants per archetype (second one with a different roof) to exercise variant choice
  for (const [k, a] of Object.entries(ARCH)) {
    const alt = { ...a, roof: [a.roof[2], a.roof[0], a.roof[1]] };
    archetypes[k] = { variants: [{ id: `${k}-1`, ...building(k, a) }, { id: `${k}-2`, ...building(k, alt) }] };
  }
  // hand-made test variant: explicit floor rect, door at column 4 (not where town.json puts it)
  {
    const a = { ...ARCH.house_m, door: { x: 4, w: 1 }, blockers: [[14, 32, 14, 10]], roof: [70, 96, 70] };
    const v = { id: 'house_m-2', ...building('house_m', a), floor: [10, 30, 76, 38] };
    archetypes.house_m.variants[1] = v;
  }
  const ground = {
    grass: noiseTex(64, [62, 88, 52], 22, 3, 0.04).toDataURL(),
    dirt: noiseTex(64, [112, 90, 64], 18, 5, 0.03).toDataURL(),
    street: stoneTex(64, 8, 7, 11, [118, 116, 122], [58, 56, 62], 7).toDataURL(),
    plaza: stoneTex(64, 16, 12, 20, [132, 124, 116], [70, 66, 64], 9).toDataURL(),
  };
  const props = {
    lamp: { src: prop(9, 28, (g) => { g.fillStyle = '#2a2a30'; g.fillRect(3, 6, 3, 22); g.fillRect(1, 26, 7, 2); g.fillStyle = '#3a3640'; g.fillRect(1, 0, 7, 8); g.fillStyle = '#ffd88a'; g.fillRect(2, 2, 5, 5); }), origin: [4, 27], solid: [-2, -2, 4, 3], light: [0, -23, 60] },
    tree: { src: prop(32, 42, (g) => { g.fillStyle = '#3b2a1e'; g.fillRect(14, 26, 5, 16); g.fillStyle = '#24402a'; g.fillRect(3, 6, 26, 22); g.fillRect(7, 1, 18, 30); g.fillStyle = '#2f5234'; g.fillRect(8, 4, 12, 10); }), origin: [16, 41], solid: [-3, -3, 6, 4], light: null },
    bush: { src: prop(16, 11, (g) => { g.fillStyle = '#2a4a2e'; g.fillRect(1, 3, 14, 8); g.fillRect(4, 0, 8, 11); g.fillStyle = '#386040'; g.fillRect(4, 2, 5, 3); }), origin: [8, 10], solid: null, light: null },
    barrel: { src: prop(10, 13, (g) => { g.fillStyle = '#6a4428'; g.fillRect(1, 0, 8, 13); g.fillStyle = '#3a2a20'; g.fillRect(1, 3, 8, 1); g.fillRect(1, 9, 8, 1); }), origin: [5, 12], solid: [-4, -4, 8, 5], light: null },
    crate: { src: prop(12, 12, (g) => { g.fillStyle = '#7a5a34'; g.fillRect(0, 0, 12, 12); g.fillStyle = '#4e3a22'; g.strokeStyle = '#4e3a22'; g.fillRect(0, 0, 12, 1); g.fillRect(0, 11, 12, 1); g.fillRect(5, 0, 2, 12); }), origin: [6, 11], solid: [-5, -5, 10, 6], light: null },
    bench: { src: prop(20, 10, (g) => { g.fillStyle = '#5a3e28'; g.fillRect(0, 2, 20, 4); g.fillStyle = '#3a2a1e'; g.fillRect(2, 6, 2, 4); g.fillRect(16, 6, 2, 4); }), origin: [10, 9], solid: [-9, -4, 18, 5], light: null },
    well: { src: prop(24, 24, (g) => { g.fillStyle = '#5c5a60'; g.fillRect(1, 10, 22, 13); g.fillStyle = '#16202c'; g.fillRect(4, 12, 16, 6); g.fillStyle = '#4a3424'; g.fillRect(2, 0, 2, 12); g.fillRect(20, 0, 2, 12); g.fillRect(1, 0, 22, 3); }), origin: [12, 21], solid: [-10, -8, 20, 10], light: null },
    noticeboard: { src: prop(20, 24, (g) => { g.fillStyle = '#4a3424'; g.fillRect(2, 8, 2, 16); g.fillRect(16, 8, 2, 16); g.fillStyle = '#6e4e30'; g.fillRect(0, 0, 20, 14); g.fillStyle = '#d8ccb0'; g.fillRect(3, 3, 6, 7); g.fillRect(11, 2, 6, 5); }), origin: [10, 23], solid: [-8, -3, 16, 4], light: null },
    fence: { src: prop(16, 10, (g) => { g.fillStyle = '#5a4a3a'; g.fillRect(0, 3, 16, 2); g.fillRect(0, 7, 16, 1); g.fillRect(1, 0, 2, 10); g.fillRect(13, 0, 2, 10); }), origin: [8, 9], solid: [-8, -3, 16, 3], light: null },
  };
  const anims = {
    idle: { up: [0], down: [12], right: [24], left: [36] },
    walk: { up: [2, 3, 4, 5], down: [14, 15, 16, 17], right: [26, 27, 28, 29], left: [38, 39, 40, 41] },
  };
  const residents = [['#7a4a3a', '#2a1a14'], ['#3a5a7a', '#c0a060'], ['#4a6a3a', '#5a3a2a']]
    .map(([t, h]) => ({ src: residentSheet(t, h), frame: [32, 32], pivot: [16, 31], anims }));
  const keepers = {
    workshop: { src: residentSheet('#6a4a30', '#8a2a20'), frame: [32, 32], pivot: [16, 31], anims },
    shop: { src: residentSheet('#7a2a3a', '#7a5a3a'), frame: [32, 32], pivot: [16, 31], anims },
    house: { src: residentSheet('#a06a4a', '#4a2a1a'), frame: [32, 32], pivot: [16, 31], anims },
    ruin: { src: residentSheet('#6a6058', '#c8c8c8'), frame: [32, 32], pivot: [16, 31], anims },
  };
  return { tile: 16, characters: { keepers, townsfolk: residents }, archetypes, props, ground };
}
