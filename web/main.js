// CodeCity browser runtime entry: boot, view sizing, camera, fixed-timestep loop.

import { TILE, SIM_DT, MAX_FRAME_DT, CUTAWAY_FADE, CAMERA_OMEGA, CAMERA_LOOK_UP, CAMERA_LEAD, NATIVE_TARGET_W,
  NEAR_RESIDENT, NEAR_KEEPER, NEAR_NOTICE, KEEPER_BOX } from './config.js';
import { loadJSON, loadArt, loadImage, warnOnce } from './assets.js';
import { parseGround, composeGround } from './ground.js';
import { World } from './world.js';
import { Player } from './player.js';
import { createResidents } from './residents.js';
import { loadCreatureArt, createCreatures } from './creatures.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Smoke } from './effects.js';
import { UI, showError } from './ui.js';

const T = TILE;
const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const TOWN_URL = params.get('town') || '/town.json';
const MANIFEST_URL = params.get('manifest') || '/art/game/manifest.json';

async function boot() {
  let town;
  try {
    town = await loadJSON(TOWN_URL);
  } catch (e) {
    document.getElementById('loading').classList.add('hide');
    showError(`town.json を読み込めませんでした（${e.message}）`);
    throw e;
  }
  if (!(town.cols > 0 && town.rows > 0)) { showError('town.json に cols / rows がありません'); return; }

  let manifest = null;
  if (DEBUG && params.get('art') === 'placeholder') {
    // debug only: procedural stand-ins to exercise the art code paths before real art exists
    manifest = (await import('./dev/placeholder-art.js')).placeholderManifest();
  } else {
    try { manifest = await loadJSON(MANIFEST_URL); }
    catch (e) { warnOnce('manifest', `art manifest を読み込めません（${e.message}）。素材なしで続けます`); }
  }
  // Ground: the server's pre-composed image when the town names one, else compose here.
  let groundImg = null;
  if (town.groundImage) {
    groundImg = await loadImage(new URL(town.groundImage, new URL(TOWN_URL, location.href)).href);
    // (no img.decode(): it can stall indefinitely in a hidden tab; onload is enough to draw)
    if (groundImg && (groundImg.naturalWidth !== town.cols * T || groundImg.naturalHeight !== town.rows * T)) {
      warnOnce('groundsize', `groundImage の大きさ ${groundImg.naturalWidth}x${groundImg.naturalHeight} が ${town.cols * T}x${town.rows * T} と一致しません`);
    }
  }
  const art = await loadArt(manifest, MANIFEST_URL, { playerOverride: params.get('player'), needGround: !groundImg });
  if (!art.player) warnOnce('player', 'プレイヤーの画像がありません');

  const grid = parseGround(town);
  let ground;
  if (groundImg) {
    ground = { canvas: groundImg, width: groundImg.naturalWidth, height: groundImg.naturalHeight };
  } else {
    const tg = performance.now();
    ground = composeGround(town, grid, art.ground);
    console.info(`[codecity] ground ${town.cols}x${town.rows} composed in the browser in ${Math.round(performance.now() - tg)} ms`);
  }
  const world = new World(town, art, grid);
  const spawn = town.spawn || { x: town.cols / 2, y: town.rows / 2 };
  let [sx, sy] = [Math.floor(spawn.x), Math.floor(spawn.y)];
  const free = world.nearestFree(sx, sy, 20);
  if (free) [sx, sy] = free;
  const sp = world.navPoint(sx, sy);
  const player = new Player(sp.x, sp.y, art.player);
  player.isPlayer = true;
  player.facing = 'down';

  const npcs = createResidents(town, world, art, DEBUG);
  const creatures = createCreatures(town, world, await loadCreatureArt(manifest, MANIFEST_URL));   // pass-through, never solid
  // keepers stand still: make them solid for everyone and refresh navigation around them
  for (const k of npcs.keepers) world.addRect(k.x + KEEPER_BOX[0], k.y + KEEPER_BOX[1], KEEPER_BOX[2], KEEPER_BOX[3], 'npc');
  if (npcs.keepers.length) world.computeNav();
  // the keeper answers as soon as you step in: one standing further back than NEAR_KEEPER from the
  // spot just inside the door (behind a shop counter) still speaks from there
  for (const k of npcs.keepers) {
    const b = k.building, d = b.doorInside ? Math.hypot(k.x - b.doorInside.x, k.y - b.doorInside.y) + 6 : 0;
    b.talkR = Math.min(72, Math.max(NEAR_KEEPER, d));
  }
  const movers = [...npcs.walkers, ...npcs.locals];     // named contributors + ambient townsfolk
  player.blockers = movers;

  const canvas = document.getElementById('view');
  const renderer = new Renderer(canvas, world, ground, DEBUG);
  const input = new Input(canvas);
  const smoke = new Smoke(world);
  const ui = new UI(town);
  document.getElementById('loading').classList.add('hide');

  const noticeboards = world.props.filter((p) => p.type === 'noticeboard');
  const readme = town.repo && town.repo.readme;

  // ---- view sizing: integer device-pixel scale, native view ~400-480 px wide --------------
  const view = { vw: 480, vh: 270, scale: 1, cssPerPx: 1, camX: 0, camY: 0 };
  let lastW = 0, lastH = 0, lastDpr = 0;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    lastW = window.innerWidth; lastH = window.innerHeight; lastDpr = dpr;
    const dw = Math.max(1, Math.round(window.innerWidth * dpr));
    const dh = Math.max(1, Math.round(window.innerHeight * dpr));
    const scale = Math.max(1, Math.ceil(dw / NATIVE_TARGET_W));
    view.scale = scale;
    view.vw = Math.ceil(dw / scale);
    view.vh = Math.ceil(dh / scale);
    view.cssPerPx = scale / dpr;
    canvas.width = view.vw; canvas.height = view.vh;
    canvas.style.width = `${(view.vw * scale) / dpr}px`;
    canvas.style.height = `${(view.vh * scale) / dpr}px`;
    renderer.ctx.imageSmoothingEnabled = false;
  }
  resize();
  window.addEventListener('resize', resize);
  // also catch size / DPR changes that arrive without a resize event (monitor moves, emulation)
  const checkSize = () => {
    if (window.innerWidth !== lastW || window.innerHeight !== lastH || (window.devicePixelRatio || 1) !== lastDpr) resize();
  };

  // ---- camera: critically damped spring on the player, clamped to the town ---------------
  const cam = { x: 0, y: 0, vx: 0, vy: 0 };
  const clampCam = (v, size, worldSize) => (worldSize <= size ? (worldSize - size) / 2 : Math.max(0, Math.min(worldSize - size, v)));
  cam.x = clampCam(player.x - view.vw / 2, view.vw, world.W);
  cam.y = clampCam(player.y - CAMERA_LOOK_UP - view.vh / 2, view.vh, world.H);
  function updateCamera(dt) {
    // look slightly ahead along the velocity so running never hides what is in front
    const tx = player.rx - view.vw / 2 + player.vx * CAMERA_LEAD;
    let ty = player.ry - CAMERA_LOOK_UP - view.vh / 2 + player.vy * CAMERA_LEAD * 0.8;
    // while a panel is docked, frame the player away from it
    if (ui.talking) ty += (ui.dock === 'top' ? -1 : 1) * view.vh * 0.17;
    const w = CAMERA_OMEGA;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 120);
      remaining -= h;
      cam.vx += (-2 * w * cam.vx - w * w * (cam.x - tx)) * h;
      cam.vy += (-2 * w * cam.vy - w * w * (cam.y - ty)) * h;
      cam.x += cam.vx * h; cam.y += cam.vy * h;
    }
    const cx = clampCam(cam.x, view.vw, world.W), cy = clampCam(cam.y, view.vh, world.H);
    if (cx !== cam.x) { cam.x = cx; cam.vx = 0; }
    if (cy !== cam.y) { cam.y = cy; cam.vy = 0; }
    // Round relative to the player's rounded position so the player never jitters against
    // the screen while the world scrolls in whole native pixels.
    const prx = Math.round(player.rx), pry = Math.round(player.ry);
    let rx = prx - Math.round(player.rx - cam.x), ry = pry - Math.round(player.ry - cam.y);
    if (world.W > view.vw) rx = Math.max(0, Math.min(world.W - view.vw, rx)); else rx = Math.round(cam.x);
    if (world.H > view.vh) ry = Math.max(0, Math.min(world.H - view.vh, ry)); else ry = Math.round(cam.y);
    view.camX = rx; view.camY = ry;
  }

  // ---- click / tap to walk ---------------------------------------------------------------
  function handleClick(c) {
    const rect = canvas.getBoundingClientRect();
    walkToWorld(view.camX + (c.x - rect.left) / view.cssPerPx, view.camY + (c.y - rect.top) / view.cssPerPx);
  }
  function walkToWorld(wx, wy) {
    // clicking a building (footprint or the roof above it) walks you inside
    let best = null;
    for (const b of world.buildings) {
      const up = b.arch ? b.arch.exteriorOrigin[1] : 32;
      if (wx >= b.px && wx < b.px + b.pw && wy >= b.py - up && wy < b.bottomPx) {
        if (!best || b.bottomPx > best.bottomPx) best = b;
      }
    }
    // standing inside a building whose floor the tile graph does not link to its door: leave
    // straight through the door first (the way pathInto() comes in), then route from outside
    const cur = world.buildingAtPx(player.x, player.y);
    const exit = cur ? [{ x: cur.doorPx, y: Math.min(player.y, cur.bottomPx - 6) }, { x: cur.doorPx, y: cur.bottomPx + 9 }] : null;
    if (best && !(best.inside && wy >= best.py)) {
      let route = world.pathInto(best, player.x, player.y);
      if (!route && exit && best !== cur) {
        const r2 = world.pathInto(best, cur.doorOutside.x, cur.doorOutside.y);
        if (r2) route = { target: r2.target, points: [...exit, ...r2.points] };
      }
      if (route) player.setPath(route.points, route.target);
      return;
    }
    let tx = Math.floor(wx / T), ty = Math.floor((wy - 3) / T);
    const f = world.nearestFree(tx, ty, 8);
    if (!f) return;
    [tx, ty] = f;
    const exact = f[0] === Math.floor(wx / T) && f[1] === Math.floor((wy - 3) / T) && !world.feetHit(wx, wy);
    const target = exact ? { x: wx, y: wy } : world.navPoint(tx, ty);
    const tiles = world.findPath(Math.floor(player.x / T), Math.floor((player.y - 3) / T), Math.floor(target.x / T), Math.floor((target.y - 3) / T), { useCost: false });
    if (!tiles && exit) {
      const o = cur.doorOutside;
      const t2 = world.findPath(Math.floor(o.x / T), Math.floor((o.y - 3) / T), Math.floor(target.x / T), Math.floor((target.y - 3) / T), { useCost: false });
      if (t2) player.setPath([...exit, ...world.smoothPath(o.x, o.y, t2, target.x, target.y)], target);
      return;
    }
    if (!tiles) return;
    player.setPath(world.smoothPath(player.x, player.y, tiles, target.x, target.y), target);
  }

  // ---- simulation ------------------------------------------------------------------------
  let time = 0;
  let current = null;
  const viewRect = { x: 0, y: 0, w: 0, h: 0 };
  const characters = [player, ...npcs.keepers, ...movers, ...creatures.list];
  const npcList = [...npcs.keepers, ...movers];
  let playerMoved = false;

  function update(dt) {
    time += dt;
    while (input.clicks.length) handleClick(input.clicks.shift());
    player.update(dt, input, world);
    playerMoved = player.moving;
    // someone standing in the player's way steps aside for a moment (the town is crowded; a click
    // path or a held key should never stall against a townsperson)
    const h = input.held;
    if ((player.path || h.up || h.down || h.left || h.right) && Math.hypot(player.x - player.prevX, player.y - player.prevY) < 0.05) {
      for (const w of movers) if (Math.abs(w.x - player.x) < 20 && Math.abs(w.y - player.y) < 16) w.yieldT = 1.2;
    }

    // which building are the player's feet in? (door gap or interior)
    const b = world.buildingAtPx(player.x, player.y);
    current = b;
    for (const bb of world.buildings) {
      bb.inside = bb === b;
      const target = bb.inside ? 1 : 0;
      if (bb.open !== target) {
        const step = dt / CUTAWAY_FADE;
        bb.open = target > bb.open ? Math.min(1, bb.open + step) : Math.max(0, bb.open - step);
      }
    }
    for (const k of npcs.keepers) k.update(dt, player);
    creatures.update(dt, player);
    for (const w of movers) {
      w.update(dt, player);
      // residents are solid on the street, but never while pausing at / passing through a door or
      // inside, and not once they have waited a while for the player
      if (w.yieldT > 0) w.yieldT -= dt;
      w.solid = w.state !== 'door' && w.state !== 'inside' && !world.buildingAtPx(w.x, w.y) && w.wait < 0.5 && !(w.yieldT > 0);
    }
    viewRect.x = view.camX; viewRect.y = view.camY; viewRect.w = view.vw; viewRect.h = view.vh;
    smoke.update(dt, time, viewRect);
  }

  // ---- proximity for UI ------------------------------------------------------------------
  function nearest(list, maxD, filter) {
    let best = null, bd = maxD * maxD;
    for (const c of list) {
      if (filter && !filter(c)) continue;
      const dx = c.x - player.x, dy = c.y - player.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  const uiState = { building: null, keeper: null, walker: null, notice: null, view, player, dt: 0, playerMoved: false };
  const scene = { world, camX: 0, camY: 0, vw: 0, vh: 0, t: 0, player, npcs: npcList, characters, smoke };

  function render(alpha, frameDt) {
    checkSize();
    for (let i = 0; i < characters.length; i++) characters[i].interpolate(alpha);
    updateCamera(frameDt);
    scene.camX = view.camX; scene.camY = view.camY; scene.vw = view.vw; scene.vh = view.vh; scene.t = time;
    renderer.render(scene);

    uiState.building = current && current.module ? current : null;
    uiState.keeper = current && current.keeper &&
      Math.hypot(current.keeper.x - player.x, current.keeper.y - player.y) < (current.talkR || NEAR_KEEPER) + (ui.curKeeper === current.keeper ? 24 : 0)
      ? current.keeper : null;
    uiState.walker = uiState.keeper ? null : nearest(movers, NEAR_RESIDENT);   // one speaker at a time: the keeper's dialogue wins
    uiState.notice = readme && noticeboards.length && nearest(noticeboards, NEAR_NOTICE) ? readme : null;
    uiState.dt = frameDt;
    uiState.playerMoved = playerMoved;
    const pet = uiState.keeper ? null : creatures.pick(player, uiState.walker);   // a creature nearer than the resident
    if (pet) uiState.walker = null;
    ui.update(uiState);
    creatures.bubble(view, player, pet);
  }

  // ---- loop: fixed timestep, clamped dt, rAF with a setTimeout fallback -------------------
  let last = performance.now();
  let acc = 0;
  let lastFrameAt = 0;
  let fpsFrames = 0, fpsTime = 0;
  function frame(now) {
    if (!Number.isFinite(now)) now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    acc += dt;
    let steps = 0;
    while (acc >= SIM_DT && steps < 24) { update(SIM_DT); acc -= SIM_DT; steps++; }
    if (steps >= 24) acc = 0;
    render(acc / SIM_DT, dt);
    lastFrameAt = now;
    if (DEBUG) {
      fpsFrames++; fpsTime += dt;
      if (fpsTime >= 0.5) { ui.fps(`${Math.round(fpsFrames / fpsTime)} fps  ${player.x.toFixed(1)},${player.y.toFixed(1)}  ${current ? current.id : '-'}`); fpsFrames = 0; fpsTime = 0; }
    }
  }
  function rafLoop() {
    frame(performance.now());
    requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);
  // When rAF is throttled or not firing (hidden tab, automated pane), keep the world moving.
  function timerLoop() {
    if (performance.now() - lastFrameAt > 60) frame(performance.now());
    setTimeout(timerLoop, document.hidden ? 33 : 16);
  }
  setTimeout(timerLoop, 100);

  // Inspection handle for development and automated checks.
  window.__codecity = {
    town, art, world, ground, player, npcs, creatures, view, cam, ui, input,
    step(seconds = 1) { const n = Math.round(seconds / SIM_DT); for (let i = 0; i < n; i++) update(SIM_DT); render(1, SIM_DT); last = performance.now(); },
    renderNow() { render(1, 0); },
    // run n frames with synthetic timestamps (hz) and report on-screen player x/y and camera
    frames(n = 60, hz = 60) {
      const out = [];
      for (let i = 0; i < n; i++) {
        frame(last + 1000 / hz);
        out.push([Math.round(player.rx) - view.camX, Math.round(player.ry) - view.camY, view.camX, view.camY]);
      }
      return out;
    },
    hold(dir, on = true) { input.held[dir] = on; },
    release() { input.clear(); },
    walkTo(wx, wy) { walkToWorld(wx, wy); return player.path; },
    teleport(px, py) { player.x = player.prevX = px; player.y = player.prevY = py; player.vx = player.vy = 0; },
  };
}

boot().catch((e) => console.error('[codecity] boot failed', e));
