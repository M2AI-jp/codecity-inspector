// Y-sorted creature sprites, ground shadows, and sleeping marks.
import { frameOf } from './art.js';

const SHADOW = { pigeon: [6, 2], cat: [10, 3], dog: [14, 4] };

export function draw(creature, ctx, camX, camY) {
  const fx = Math.round(creature.rx) - camX, fy = Math.round(creature.ry) - camY, z = Math.round(creature.rz);
  // shadow on the ground, shrinking as the bird climbs
  const [sw, sh] = SHADOW[creature.kind] || [8, 3];
  if (z < 40) {
    const k = z > 0 ? Math.max(0.4, 1 - z / 50) : 1;
    const w = Math.max(2, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    ctx.fillStyle = `rgba(0,0,0,${(0.34 * k).toFixed(3)})`;
    ctx.fillRect(fx - (w >> 1), fy - (h >> 1), w, h);
    if (w > 4) ctx.fillRect(fx - (w >> 1) - 1, fy - (h >> 1) + (h > 2 ? 1 : 0), w + 2, Math.max(1, h - 2));
  }
  let s = creature.sheet, f = null;
  if (creature.kind === 'pigeon' && creature.flying && creature.fly) { s = creature.fly; f = frameOf(s, 'fly', creature.facing, creature.t, 12); }
  else if (s) {
    const st = creature.state;
    if (st === 'walk' || st === 'trot' || (st === 'follow' && Math.hypot(creature.x - creature.prevX, creature.y - creature.prevY) > 0.05)) f = frameOf(s, 'walk', creature.facing, creature.t, st === 'walk' ? 6 : 10);
    else if (st === 'hop') f = frameOf(s, 'hop', creature.facing, creature.t, 8);
    else if (st === 'peck') f = frameOf(s, 'peck', creature.facing, creature.t, 5);
    else if (st === 'stand' || (creature.kind === 'dog' && (st === 'rest' || st === 'watch' || st === 'follow'))) f = frameOf(s, 'stand', creature.facing, creature.t, 1);
    else f = frameOf(s, 'idle', creature.facing, creature.t, 1);
  }
  if (s && f) ctx.drawImage(s.image, f.sx, f.sy, s.fw, s.fh, fx - s.px, fy - z - s.py, s.fw, s.fh);
  if (creature.state === 'nap' && s) creature.drawZ(ctx, fx + 3, fy - s.py - 1);
}

// tiny pixel "z"s drifting up from a sleeping cat
export function drawZ(creature, ctx, x, y) {
  ctx.fillStyle = 'rgb(232,226,255)';
  for (let i = 0; i < 2; i++) {
    const ph = (creature.t * 0.45 + i * 0.5) % 1;
    const n = i === 0 ? 4 : 3;
    const zx = Math.round(x + ph * 5 + i * 2), zy = Math.round(y - ph * 10);
    ctx.globalAlpha = ph < 0.75 ? 0.9 : (1 - ph) * 3.6;
    ctx.fillRect(zx, zy, n, 1);
    ctx.fillRect(zx, zy + n - 1, n, 1);
    for (let k = 1; k < n - 1; k++) ctx.fillRect(zx + n - 1 - k, zy + k, 1, 1);
  }
  ctx.globalAlpha = 1;
}
