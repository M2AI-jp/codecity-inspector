// Load the town and art, then build the world and its inhabitants in boot order.
import { TILE, NEAR_KEEPER, KEEPER_BOX } from './config.js';
import { loadJSON, loadArt, loadImage, warnOnce, toCanvas, cleanMagenta, buildSheet } from './assets.js';
import { parseGround, composeGround } from './ground.js';
import { World } from './world.js';
import { Player } from './player.js';
import { createResidents } from './residents.js';
import { loadCreatureArt, createCreatures } from './creatures.js';
import { showError } from './ui.js';

const T = TILE;

export async function prepareTown({ params, DEBUG, TOWN_URL, MANIFEST_URL }) {
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
  // 外部工務店の代理人の絵（manifest の characters.contractor）。無ければ町の人の姿で歩く（web/residents.js）
  const cdef = manifest && manifest.characters && manifest.characters.contractor;
  if (!art.contractor && cdef && cdef.src) {
    const img = await loadImage(new URL(cdef.src, new URL(MANIFEST_URL, location.href)).href);
    if (img) { const c = toCanvas(img); cleanMagenta(c); art.contractor = buildSheet(c, cdef, null); }
  }

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
  if (npcs.keepers.length || town.overlay) world.computeNav();
  // the keeper answers as soon as you step in: one standing further back than NEAR_KEEPER from the
  // spot just inside the door (behind a shop counter) still speaks from there
  for (const k of npcs.keepers) {
    const b = k.building, d = b.doorInside ? Math.hypot(k.x - b.doorInside.x, k.y - b.doorInside.y) + 6 : 0;
    b.talkR = Math.min(72, Math.max(NEAR_KEEPER, d));
  }
  const movers = [...npcs.walkers, ...npcs.locals, ...npcs.contractors];     // named contributors + ambient townsfolk + external agents
  const outdoorKeepers = npcs.keepers.filter((k) => k.outdoor);              // the well's 井戸番 and other landmark keepers
  // Walking townsfolk never block the player: brushing through a crowd must not stall or jolt the
  // run (they still step aside on their own). Keepers stay solid via their world rects above.
  player.blockers = null;

  return { town, art, ground, world, player, npcs, creatures, movers, outdoorKeepers };
}
