// 建物の床・扉の通路・番人の立つ場所。
import { TILE, FEET_W, FEET_H, FEET_UP, KEEPER_BOX, NEAR_KEEPER } from '../config.js';
import { warnOnce } from '../assets.js';

const T = TILE;
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// floorのある版は、床の矩形（家具を除く）と、footprintの下端から床までの扉の通路を歩ける。
// footprintの残りは壁にし、当たりと滑りをpx単位で扱う矩形として保存する。
export function addFloorWalls(world, b, fl) {
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
      if ((!solid || i + 2 === xs.length) && run) { world.addRect(run[0], ya, run[1] - run[0], yb - ya, 'wall'); run = null; }
    }
  }
}

// 扉からfootprintの外へ出ずに届く足元を、人物と同じ当たりで1pxずつ広げて探す。
// freeは建物ごとに一度計算する。extraには、配置する番人の当たり矩形を追加できる。
export function floorReach(world, b, free, extra) {
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

// floorのある建物の扉の内側と、番人の立つ所をpx単位で探す。
// 番人は奥の中央寄りで扉からの通路を避け、床をなるべくふさがず、話しかけられる所に置く。
export function floorSpots(world, b) {
  const f = b.floor;
  const dx = Math.max(f.x0 + 6, Math.min(f.x1 - 6, b.doorPx));
  const dy = f.y1 - 3;
  b.doorInside = !world.feetHit(dx, dy) ? { x: dx, y: dy } : null;
  const fcx = (f.x0 + f.x1) / 2;
  const d0 = b.doorX0 * T, d1 = b.doorX1 * T;
  // 扉から入る人物の足元が通る帯。余裕の広いものから試す。
  const lanes = [
    { pad: { x: -8, y: -8, w: 16, h: 14 }, lane: { x: d0 - 3, y: f.y1 - FEET_H - 16, w: d1 - d0 + 6, h: b.bottomPx - (f.y1 - FEET_H - 16) } },
    { pad: { x: KEEPER_BOX[0], y: KEEPER_BOX[1], w: KEEPER_BOX[2], h: KEEPER_BOX[3] }, lane: { x: d0, y: f.y1 - FEET_H - 4, w: d1 - d0, h: b.bottomPx - (f.y1 - FEET_H - 4) } },
  ];
  // 番人の当たりが家具に重ならない所。roomyなら体のまわりにも1〜2pxの余裕がある。
  const all = [];
  const kx0 = KEEPER_BOX[0], ky0 = KEEPER_BOX[1], kx1 = KEEPER_BOX[0] + KEEPER_BOX[2], ky1 = KEEPER_BOX[1] + KEEPER_BOX[3];
  for (let y = f.y0 + 5; y <= f.y1 - 2; y += 1) {
    for (let x = f.x0 + 6; x <= f.x1 - 6; x += 1) {
      if (y + ky0 < f.y0 - 2 || world.boxHits(x + kx0, Math.max(f.y0, y + ky0), x + kx1, y + Math.min(ky1, 3))) continue;
      all.push([Math.abs(x - fcx) + (y - f.y0) * 0.7, x, y, !world.boxHits(x - 7, y - 6, x + 7, y + 3)]);
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
  // footprint内の空いた足元を一度計算し、離れた候補を最大40か所まで採点する。
  const w = b.pw + 1, h = b.ph + 1;
  const free = new Uint8Array(w * h);
  for (let ly = 0; ly < h; ly++) for (let lx = 0; lx < w; lx++) free[ly * w + lx] = world.feetHit(b.px + lx, b.py + ly) ? 0 : 1;
  const base = world.floorReach(b, free, null);
  const hw = FEET_W / 2;
  let best = null, bestCost = Infinity, bestInfo = null;
  const tried = new Set();
  for (const [score, x, y] of cands) {
    const cell = ((x / 3) | 0) * 4096 + ((y / 3) | 0);
    if (tried.has(cell)) continue;
    tried.add(cell);
    if (tried.size > 40) break;
    const kr = { x: x + KEEPER_BOX[0], y: y + KEEPER_BOX[1], w: KEEPER_BOX[2], h: KEEPER_BOX[3] };
    const r = world.floorReach(b, free, kr);
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
  // 家具などを除き、住人が歩き回れる床。
  b.interior = [];
  for (let ty = b.y; ty < b.y + b.h; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) {
    const k = ty * world.cols + tx;
    if (world.inGrid(tx, ty) && !world.nav[k] && world.navY[k] <= f.y1) b.interior.push(k);
  }
  if (best) b.keeperSpot = { x: best[0], y: best[1], tx: Math.floor(best[0] / T), ty: Math.floor((best[1] - 3) / T) };
}
