// Pigeon flight, dog following, and cat wandering / sleep; keep each random draw in order.
import { dirOf } from './movement.js';

const RUN = 95;                  // px/s, the player counts as running above this

// pigeons: idle / peck / hop near home; take off when the player runs close, land again nearby
export function pigeon(creature, dt, p, dist, speed, all) {
  if (creature.state === 'fly') return creature.flight(dt, p);
  if (creature.state === 'startle') {           // a flock-mate took off: follow a beat later
    if (creature.timer <= 0) creature.takeOff(p);
    return;
  }
  if (!creature.cool && dist < 44 && speed > RUN) {
    creature.takeOff(p);
    for (const o of creature.flock || []) {
      if (o !== this && o.state !== 'fly' && o.state !== 'startle' && Math.hypot(o.x - creature.x, o.y - creature.y) < 40) {
        o.state = 'startle'; o.timer = 0.06 + o.rand() * 0.3;
      }
    }
    return;
  }
  if (creature.state === 'hop') {
    if (creature.moveTo(creature.target.x, creature.target.y, 30, dt) || creature.timer <= 0) { creature.state = 'rest'; creature.timer = 0.4 + creature.rand() * 1.5; }
    return;
  }
  // a walking player stepping onto it: a short hop aside
  if (dist < 13 && speed > 10 && !creature.cool) {
    const a = Math.atan2(creature.y - p.y, creature.x - p.x);
    const tx = creature.x + Math.cos(a) * 14, ty = creature.y + Math.sin(a) * 14;
    if (creature.free(tx, ty)) { creature.target = { x: tx, y: ty }; creature.state = 'hop'; creature.timer = 0.6; creature.cool = 0.8; return; }
  }
  if (creature.timer > 0) return;
  const r = creature.rand();
  if (r < 0.4) { creature.state = 'peck'; creature.timer = 0.6 + creature.rand() * 1.4; }
  else if (r < 0.75) {
    const back = Math.hypot(creature.x - creature.hx, creature.y - creature.hy) > 22;
    const s = back ? creature.spot(creature.hx, creature.hy, 10) : creature.spot(creature.x, creature.y, 14);
    if (s) { creature.target = s; creature.state = 'hop'; creature.timer = 1.2; } else { creature.state = 'rest'; creature.timer = 1; }
  } else {
    creature.state = 'rest'; creature.timer = 0.6 + creature.rand() * 2.2;
    if (creature.rand() < 0.6) creature.facing = ['left', 'right', 'down', 'up'][Math.floor(creature.rand() * 4)];
  }
}

export function takeOff(creature, p) {
  const a = Math.atan2(creature.y - p.y, creature.x - p.x) + (creature.rand() - 0.5) * 1.2;
  creature.state = 'fly';
  creature.leg = 'out';
  creature.vx = Math.cos(a) * (90 + creature.rand() * 30);
  creature.vy = Math.sin(a) * (60 + creature.rand() * 20);
  creature.zMax = 34 + creature.rand() * 26;
  creature.timer = 1.0 + creature.rand() * 0.6;
  creature.facing = creature.vx < 0 ? 'left' : 'right';
}

export function flight(creature, dt, p) {
  if (creature.leg === 'out') {
    creature.x += creature.vx * dt; creature.y += creature.vy * dt;
    creature.z = Math.min(creature.zMax, creature.z + 70 * dt);
    if (creature.timer <= 0) {
      // circle back to a spot near home, away from where the player is now
      creature.target = creature.spot(creature.hx, creature.hy, 40, p.x, p.y, 64) || creature.spot(creature.hx, creature.hy, 90, p.x, p.y, 48) || { x: creature.hx, y: creature.hy };
      creature.leg = 'back';
      creature.timer = 0.8 + creature.rand() * 1.4;    // glide a while out of reach first
    }
    return;
  }
  if (creature.leg === 'back' && creature.timer > 0) {   // wheel around, slowly turning home
    const tx = creature.target.x - creature.x, ty = creature.target.y - creature.y, d = Math.hypot(tx, ty) || 1;
    creature.vx += ((tx / d) * 90 - creature.vx) * Math.min(1, dt * 1.6);
    creature.vy += ((ty / d) * 70 - creature.vy) * Math.min(1, dt * 1.6);
    creature.x += creature.vx * dt; creature.y += creature.vy * dt;
    creature.facing = creature.vx < 0 ? 'left' : 'right';
    return;
  }
  const tx = creature.target.x - creature.x, ty = creature.target.y - creature.y, d = Math.hypot(tx, ty);
  const s = Math.min(d, 80 * dt);
  if (d > 0.5) { creature.x += (tx / d) * s; creature.y += (ty / d) * s; creature.facing = tx < 0 ? 'left' : tx > 0 ? 'right' : creature.facing; }
  creature.z = Math.min(creature.z, Math.max(0, (d - 2) * 0.45));
  if (d < 1.5) {
    creature.z = 0; creature.state = 'rest'; creature.timer = 0.8 + creature.rand() * 1.5; creature.cool = 1.6;
    creature.facing = creature.rand() < 0.5 ? 'left' : 'right';
  }
}

// dogs: trot around the town hall; follow the player a few steps when they come by
export function dog(creature, dt, p, dist, speed) {
  if (creature.state === 'follow') {
    const back = 12;
    const sp = Math.hypot(p.vx || 0, p.vy || 0);
    const tx = p.x - (sp > 1 ? (p.vx / sp) * back : 0), ty = p.y - (sp > 1 ? (p.vy / sp) * back : 0) + 2;
    if (creature.world.buildingAtPx(tx, ty) || creature.timer <= 0) { creature.state = 'watch'; creature.timer = 1 + creature.rand(); creature.cool = 7; return; }
    if (Math.hypot(tx - creature.x, ty - creature.y) > 6) creature.moveTo(tx, ty, Math.min(110, Math.max(60, sp)), dt);
    else creature.facing = dirOf(p.x - creature.x, p.y - creature.y, creature.facing);
    return;
  }
  if (!creature.cool && dist < 40 && speed > 20 && creature.state !== 'watch' && !creature.world.buildingAtPx(p.x, p.y)) {
    creature.state = 'follow'; creature.timer = 1.8 + creature.rand() * 1.2;
    return;
  }
  if (creature.state === 'watch') {
    creature.facing = dirOf(p.x - creature.x, p.y - creature.y, creature.facing);
    if (creature.timer <= 0) { creature.state = 'trot'; creature.target = creature.spot(creature.hx, creature.hy, 20) || { x: creature.hx, y: creature.hy }; creature.timer = 6; }
    return;
  }
  if (creature.state === 'trot') {
    if (creature.moveTo(creature.target.x, creature.target.y, 44, dt) || creature.timer <= 0) { creature.state = creature.rand() < 0.5 ? 'sit' : 'rest'; creature.timer = 1.2 + creature.rand() * 2.5; }
    return;
  }
  if (creature.timer > 0) {
    if ((creature.state === 'rest' || creature.state === 'sit') && dist < 60) creature.facing = dirOf(p.x - creature.x, p.y - creature.y, creature.facing);
    return;
  }
  const far = Math.hypot(creature.x - creature.hx, creature.y - creature.hy) > 56;
  creature.target = (far ? creature.spot(creature.hx, creature.hy, 24) : creature.spot(creature.hx, creature.hy, 64)) || { x: creature.hx, y: creature.hy };
  creature.state = 'trot'; creature.timer = 5;
}

// cats: wander slowly, sit, nap; the ruin cat just sleeps
export function cat(creature, dt, p, dist) {
  if (creature.d.sleeping) { creature.facing = 'down'; return; }
  if (creature.state === 'walk') {
    if (creature.moveTo(creature.target.x, creature.target.y, 17, dt) || creature.timer <= 0) { creature.state = creature.rand() < 0.6 ? 'rest' : 'stand'; creature.timer = 1.5 + creature.rand() * 4; }
    return;
  }
  if (creature.state !== 'nap' && dist < 40) creature.facing = dirOf(p.x - creature.x, p.y - creature.y, creature.facing);
  if (creature.timer > 0) return;
  const r = creature.rand();
  if (creature.state === 'nap') { creature.state = 'rest'; creature.timer = 2 + creature.rand() * 3; return; }
  if (creature.state === 'rest' && r < 0.35) { creature.state = 'nap'; creature.timer = 7 + creature.rand() * 9; creature.facing = 'down'; return; }
  if (r < 0.75) {
    creature.target = creature.spot(creature.hx, creature.hy, 36) || { x: creature.hx, y: creature.hy };
    creature.state = 'walk'; creature.timer = 8;
  } else { creature.state = 'stand'; creature.timer = 1 + creature.rand() * 2; }
}
