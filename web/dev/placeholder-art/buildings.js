// Keep facade and cutaway construction together so both images share the same building geometry.
import { hash2 } from '../../util.js';
import { T, mk, shade } from './shared.js';

export const ARCH = {
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

export function building(key, a) {
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
