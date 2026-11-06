#!/usr/bin/env node
// Play check (headless): can the player walk from the spawn into every building and talk to its keeper?
//
//   node tools/check-play.mjs <repo | town.json> [...] [--manifest art/game/manifest.json] [-v]
//
// Uses the browser runtime itself (web/world.js, web/player.js, web/residents.js) with the art
// manifest's geometry (no images), set up the way web/main.js does it: World -> keepers (solid
// rects) -> nav. Then, per building:
//   reach  : 1px flood fill of the player's feet position from the spawn with World.feetHit
//            (the exact collision the player uses). "floor" = a feet box standing fully on the
//            floor rect (or the interior tiles when the variant has no floor). "talk" = a reachable
//            spot inside the building within NEAR_KEEPER of the keeper.
//   walk-in: the real Player physics holding "up" from in front of the door (centre and +-6 px),
//            as a player would, for 1.5 s. Passes when the feet reach the floor.
//   click  : clicking the building from the spawn (the runtime's path to doorInside), followed with
//            the Player physics. Passes when the feet reach the floor.
// Also: every building has a keeper; every outdoor keeper (town.landmarks, e.g. the well's 井戸番, the
// gate's 門番) can be walked up to and talked to (a reachable feet spot within NEAR_KEEPER - 4 px); every
// gate (a prop with an `opening`) can be walked under north -> south and south -> north; every pier
// deck (a prop with `deck`) can be stepped onto from the spawn; every terrace top (town.terraces) can
// be reached and every stair (town.stairs) stood on, with the terrace wall solid as in web/world.js.
// Exit code 1 if anything fails. Prints why (what blocks the door corridor).

import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = (m) => import(new URL(`../web/${m}`, import.meta.url).href);

// web/assets.js only touches the DOM inside its loaders; give warnOnce a quiet console.
const { TILE: T, FEET_W, FEET_H, FEET_UP, SIM_DT, NEAR_KEEPER, KEEPER_BOX } = await web('config.js');
const { parseGround } = await web('ground.js');
const { World } = await web('world.js');
const { Player } = await web('player.js');
const { createResidents } = await web('residents.js');

const args = process.argv.slice(2);
const verbose = args.includes('-v');
const mi = args.indexOf('--manifest');
const manifestPath = resolve(mi >= 0 ? args[mi + 1] : `${ROOT}/art/game/manifest.json`);
const targets = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '--manifest');
if (!targets.length) {
  console.error('使い方: node tools/check-play.mjs <repo | town.json> [...] [--manifest path] [-v]');
  process.exit(2);
}

// --- art: the same normalisation as web/assets.js loadArt(), geometry only -----------------
function artFrom(m) {
  const stubSheet = { stub: true };
  const art = { tile: m.tile || 16, player: stubSheet, keepers: {}, townsfolk: [], archetypes: {}, props: {}, ground: {} };
  const ch = m.characters || {};
  for (const kind of Object.keys(ch.keepers || {})) art.keepers[kind] = stubSheet;
  for (const [key, a] of Object.entries(m.archetypes || {})) {
    const defs = Array.isArray(a.variants) && a.variants.length ? a.variants : [a];
    art.archetypes[key] = {
      key,
      variants: defs.map((v, i) => ({
        key, id: v.id || `${key}-${i + 1}`,
        footprint: v.footprint || a.footprint || null,
        exterior: null, cutaway: null,
        exteriorOrigin: (v.exterior && v.exterior.origin) || [0, 0],
        cutawayOrigin: (v.cutaway && v.cutaway.origin) || (v.exterior && v.exterior.origin) || [0, 0],
        door: v.door || null,
        floor: Array.isArray(v.floor) ? v.floor : null,
        blockers: Array.isArray(v.blockers) ? v.blockers : [],
        lights: Array.isArray(v.lights) ? v.lights : [],
        interiorLights: Array.isArray(v.interiorLights) ? v.interiorLights : [],
        smoke: Array.isArray(v.smoke) ? v.smoke : [],
      })),
    };
  }
  for (const [key, p] of Object.entries(m.props || {})) {
    art.props[key] = { key, image: null, origin: p.origin || [0, 0], solid: p.solid || null, light: p.light || null, flicker: p.flicker !== false,
      deck: Array.isArray(p.deck) ? p.deck : null, layer: p.layer === 'ground' ? 'ground' : null,
      ...(Array.isArray(p.solids) ? { solids: p.solids } : {}), ...(Array.isArray(p.lights) ? { lights: p.lights } : {}),
      ...(Array.isArray(p.opening) ? { opening: p.opening } : {}) };
  }
  return art;
}

async function townFor(target) {
  const abs = resolve(target);
  if (statSync(abs).isDirectory()) {
    const { analyzeRepository } = await import('../src/analyze.mjs');
    const { layoutTown, loadArt, loadProps, loadGround } = await import('../src/layout.mjs');
    return layoutTown(analyzeRepository(abs), { art: loadArt(manifest), props: loadProps(manifest), ground: loadGround(manifest) });
  }
  return JSON.parse(readFileSync(abs, 'utf8'));
}

// --- the world as web/main.js builds it ------------------------------------------------------
function buildWorld(town, art) {
  const warns = [];
  const ow = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let world, npcs;
  try {
    world = new World(town, art, parseGround(town));
    npcs = createResidents(town, world, art, false);
    for (const k of npcs.keepers) world.addRect(k.x + KEEPER_BOX[0], k.y + KEEPER_BOX[1], KEEPER_BOX[2], KEEPER_BOX[3], 'npc');
    if (npcs.keepers.length) world.computeNav();
  } finally { console.warn = ow; }
  const spawn = town.spawn || { x: town.cols / 2, y: town.rows / 2 };
  let [sx, sy] = [Math.floor(spawn.x), Math.floor(spawn.y)];
  const free = world.nearestFree(sx, sy, 20);
  if (free) [sx, sy] = free;
  const p = world.navPoint(sx, sy);
  return { world, npcs, start: { x: Math.round(p.x), y: Math.round(p.y) }, warns };
}

// 1px flood fill of feet positions (4-neighbour, the player's sub-steps are <= 1 px per axis)
function flood(world, start) {
  const W = world.W, H = world.H;
  const seen = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  const s = start.y * W + start.x;
  if (world.feetHit(start.x, start.y)) return { seen, count: 0 };
  seen[s] = 1; q[qt++] = s;
  while (qh < qt) {
    const k = q[qh++];
    const x = k % W, y = (k / W) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = d === 0 ? x + 1 : d === 1 ? x - 1 : x;
      const ny = d === 2 ? y + 1 : d === 3 ? y - 1 : y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (seen[n]) continue;
      seen[n] = 2;                                   // tested
      if (world.feetHit(nx, ny)) continue;
      seen[n] = 1; q[qt++] = n;
    }
  }
  return { seen, count: qt };
}

// is a reachable feet position within r px of (x, y)?
function nearSeen(world, seen, x, y, r) {
  const W = world.W;
  for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(world.H - 1, Math.ceil(y + r)); yy++) {
    for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(W - 1, Math.ceil(x + r)); xx++) {
      if (seen[yy * W + xx] === 1 && Math.hypot(xx - x, yy - y) < r) return true;
    }
  }
  return false;
}
// does a reachable feet box stand fully on deck rect d?
function onDeckSeen(world, seen, d) {
  const W = world.W, hw = FEET_W / 2;
  for (let y = Math.ceil(d.y + FEET_UP); y <= Math.floor(d.y + d.h - FEET_H + FEET_UP); y++) {
    for (let x = Math.ceil(d.x + hw); x <= Math.floor(d.x + d.w - hw); x++) if (seen[y * W + x] === 1) return true;
  }
  return false;
}

// feet positions whose box stands fully on the building's floor
function floorBox(b) {
  if (b.floor) return b.floor;
  return { x0: b.px + T, y0: b.py + 2 * T, x1: b.px + b.pw - T, y1: b.bottomPx - T };
}
const onFloor = (b, x, y) => {
  const f = floorBox(b), hw = FEET_W / 2;
  return x - hw >= f.x0 && x + hw <= f.x1 && y - FEET_UP >= f.y0 && y - FEET_UP + FEET_H <= f.y1;
};

function reachOf(world, seen, b) {
  const W = world.W;
  let floor = false, talk = !b.keeper, inside = false;
  let best = null, bestD = Infinity;
  const k = b.keeper;
  const y0 = Math.max(0, b.py - 8), y1 = Math.min(world.H - 1, b.bottomPx + 24);
  for (let y = y0; y <= y1; y++) for (let x = b.px; x < b.px + b.pw; x++) {
    if (seen[y * W + x] !== 1) continue;
    const inB = world.buildingAtPx(x, y) === b;
    if (inB) inside = true;
    if (inB && onFloor(b, x, y)) floor = true;
    if (inB && k && Math.hypot(k.x - x, k.y - y) < NEAR_KEEPER) talk = true;
    // closest reachable point to the door (for the diagnosis)
    const d = Math.hypot(x - b.doorPx, y - (b.bottomPx - 4));
    if (d < bestD) { bestD = d; best = [x, y]; }
  }
  return { inside, floor, talk, nearest: best };
}

// a prop with an opening (the gate): the player walks under it north -> south and south -> north,
// holding one key, with the runtime's Player physics; both ends must be reachable from the spawn
function throughGate(world, seen, p) {
  const op = p.def.opening;
  const cx = Math.round(p.x + op[0] + op[2] / 2), top = p.y + op[1], bottom = p.y + op[1] + op[3];
  const south = { x: cx, y: Math.round(bottom + 10) }, north = { x: cx, y: Math.round(top - 8) };
  const run = (from, dy, done) => {
    const pl = new Player(from.x, from.y, null);
    if (world.feetHit(pl.x, pl.y)) return false;
    const input = { slow: false, axis(o) { o.x = 0; o.y = dy; return o; } };
    for (let t = 0; t < 2; t += SIM_DT) { pl.update(SIM_DT, input, world); if (done(pl)) return true; }
    return false;
  };
  const r = {
    southReach: nearSeen(world, seen, south.x, south.y, 6), northReach: nearSeen(world, seen, north.x, north.y, 6),
    up: run(south, -1, (pl) => pl.y < top - 2), down: run(north, 1, (pl) => pl.y > bottom + 4),
  };
  r.ok = r.southReach && r.northReach && r.up && r.down;
  return r;
}

// the player holding "up" from just outside the door, with the runtime's Player physics
function walkIn(world, b, dx) {
  const p = new Player(b.doorPx + dx, b.bottomPx + 9, null);
  if (world.feetHit(p.x, p.y)) return { ok: false, why: 'start blocked' };
  const input = { slow: false, axis(o) { o.x = 0; o.y = -1; return o; } };
  let ok = false;
  for (let t = 0; t < 1.5 && !ok; t += SIM_DT) {
    p.update(SIM_DT, input, world);
    if (world.buildingAtPx(p.x, p.y) === b && onFloor(b, p.x, p.y)) ok = true;
  }
  return { ok, end: [Math.round(p.x - b.px), Math.round(p.y - b.py)] };
}

// click on the building from the spawn: web/main.js walkToWorld() for a building target
function clickIn(world, b, start) {
  const route = world.pathInto(b, start.x, start.y);
  if (!route) return { ok: false, why: 'no path' };
  const p = new Player(start.x, start.y, null);
  p.setPath(route.points, route.target);
  const input = { slow: false, axis(o) { o.x = 0; o.y = 0; return o; } };
  for (let t = 0; t < 120 && p.path; t += SIM_DT) {
    p.update(SIM_DT, input, world);
    if (world.buildingAtPx(p.x, p.y) === b && onFloor(b, p.x, p.y)) return { ok: true };
  }
  return { ok: false, why: `stuck@${Math.round(p.x - b.px)},${Math.round(p.y - b.py)}` };
}

// what sits in the door corridor: rects overlapping the strip from the door up to the floor
function corridorReport(world, b) {
  const f = floorBox(b);
  const x0 = b.doorX0 * T - FEET_W / 2, x1 = b.doorX1 * T + FEET_W / 2;
  const y0 = f.y1 - FEET_H - 4, y1 = b.bottomPx + 16;
  const hits = [];
  world.rects.forEach((r) => {
    if (r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0) {
      hits.push(`${r.kind}[${r.x - b.px},${r.y - b.py},${r.w},${r.h}]`);
    }
  });
  const tiles = [];
  for (let ty = Math.floor(y0 / T); ty <= Math.floor(y1 / T); ty++) for (let tx = Math.floor(x0 / T); tx <= Math.floor(x1 / T); tx++) {
    if (world.inGrid(tx, ty) && world.tileSolid[ty * world.cols + tx]) tiles.push(`(${tx - b.x},${ty - b.y})`);
  }
  return `door cols ${b.doorX0 - b.x}..${b.doorX1 - b.x - 1}, floor y ${f.y0 - b.py}..${f.y1 - b.py}; ` +
    `rects near corridor (footprint px): ${hits.join(' ') || '-'}; solid tiles: ${tiles.join(' ') || '-'}`;
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const art = artFrom(manifest);
let failed = 0;
for (const target of targets) {
  const t0 = performance.now();
  const town = await townFor(target);
  const { world, npcs, start, warns } = buildWorld(town, art);
  const { seen, count } = flood(world, start);
  const rows = [];
  for (const b of world.buildings) {
    const r = reachOf(world, seen, b);
    const w = [-6, 0, 6].map((dx) => walkIn(world, b, dx));
    const walkOk = w.filter((x) => x.ok).length;
    const c = clickIn(world, b, start);
    const ok = r.floor && r.talk && walkOk >= 1 && c.ok;
    rows.push({ b, r, w, c, walkOk, ok });
  }
  const bad = rows.filter((x) => !x.ok);
  const soft = rows.filter((x) => x.ok && x.walkOk < 3);
  failed += bad.length;
  // keepers: every building has one; outdoor keepers can be reached and talked to
  const noKeeper = world.buildings.filter((b) => b.module && !b.keeper);
  const outdoor = npcs.keepers.filter((k) => k.outdoor);
  const farKeepers = outdoor.filter((k) => !nearSeen(world, seen, k.x, k.y, NEAR_KEEPER - 4));
  const lmCount = (town.landmarks || []).length;
  if (outdoor.length < lmCount) console.log(`  x ${lmCount - outdoor.length} landmark keeper(s) were not created (town.landmarks has ${lmCount})`);
  // terraces: the raised top can be reached, and every stair can be stood on (climbed from the square / street below)
  const ters = town.terraces || [], strs = town.stairs || [];
  const tileSeen = (tx0, ty0, tx1, ty1) => {
    for (let y = ty0 * T + FEET_UP; y <= (ty1 + 1) * T - FEET_H + FEET_UP; y++) for (let x = tx0 * T + FEET_W / 2; x <= (tx1 + 1) * T - FEET_W / 2; x++) if (seen[y * world.W + x] === 1) return true;
    return false;
  };
  const dryTer = ters.filter((t) => !tileSeen(t.x, t.y, t.x + t.w - 1, t.y + t.h - 1));
  const dryStair = strs.filter((s2) => !tileSeen(s2.x, s2.y, s2.x + s2.w - 1, s2.y));
  failed += dryTer.length + dryStair.length;
  // pier decks: some reachable feet box stands fully on each deck
  const decks = world.decks || [];
  const dryDecks = decks.filter((d) => !onDeckSeen(world, seen, d));
  // gates (a prop with an opening): walk under it both ways
  const gates = world.props.filter((p) => p.def && Array.isArray(p.def.opening)).map((p) => ({ p, r: throughGate(world, seen, p) }));
  const shutGates = gates.filter((x) => !x.r.ok);
  failed += noKeeper.length + farKeepers.length + dryDecks.length + Math.max(0, lmCount - outdoor.length) + shutGates.length;
  const ms = Math.round(performance.now() - t0);
  console.log(`${town.repo?.name ?? target}: ${world.buildings.length} buildings, ${bad.length} not enterable, ` +
    `${soft.length} only from part of the door front, ${noKeeper.length} without a keeper; ` +
    `outdoor keepers ${outdoor.length - farKeepers.length}/${outdoor.length} reachable; piers ${decks.length - dryDecks.length}/${decks.length} walkable; ` +
    `gates ${gates.length - shutGates.length}/${gates.length} passable both ways; ` +
    `terraces ${ters.length - dryTer.length}/${ters.length} reachable, stairs ${strs.length - dryStair.length}/${strs.length} climbable; ` +
    `reachable feet px ${count} (${ms} ms)`);
  for (const b of noKeeper) console.log(`  x ${b.id} ${b.arch ? b.arch.id : b.archetype} at (${b.x},${b.y}) has no keeper (no spot inside)`);
  for (const k of farKeepers) console.log(`  x outdoor keeper ${k.name} of ${k.building.id} at (${(k.x / T).toFixed(2)},${(k.y / T).toFixed(2)}) cannot be reached for a talk`);
  for (const d of dryDecks) console.log(`  x pier deck at px (${d.x},${d.y},${d.w},${d.h}) cannot be stepped onto`);
  for (const { p, r } of shutGates) console.log(`  x ${p.type} at (${(p.x / T).toFixed(2)},${(p.y / T).toFixed(2)}): reach south=${r.southReach} north=${r.northReach}, walk south->north=${r.up} north->south=${r.down}`);
  for (const t of dryTer) console.log(`  x terrace top (${t.x},${t.y},${t.w},${t.h}) cannot be reached`);
  for (const s2 of dryStair) console.log(`  x stair (${s2.x},${s2.y},${s2.w}) cannot be stood on`);
  for (const x of [...bad, ...(verbose ? soft : [])]) {
    const b = x.b;
    console.log(`  ${x.ok ? '~' : 'x'} ${b.id} ${b.arch ? b.arch.id : b.archetype} at (${b.x},${b.y}) ${b.module?.path ?? ''} [${b.module?.kind ?? ''}]` +
      `  reach: inside=${x.r.inside} floor=${x.r.floor} talk=${x.r.talk}  walk-in(-6,0,+6)=${x.w.map((v) => (v.ok ? 'ok' : `no@${v.end ?? v.why}`)).join(',')}` +
      `  click=${x.c.ok ? 'ok' : x.c.why}`);
    if (!x.ok || verbose) console.log(`      ${corridorReport(world, b)}; nearest reachable to door: ${x.r.nearest ? `${x.r.nearest[0] - b.px},${x.r.nearest[1] - b.py}` : 'none'}`);
  }
  if (verbose) for (const w of new Set(warns)) console.log(`  warn: ${w}`);
}
process.exit(failed ? 1 : 0);
