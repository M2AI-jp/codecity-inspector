// CodeCity browser entry: prepare the town, connect the runtime, then start its clock.
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Smoke } from './effects.js';
import { UI } from './ui.js';
import { createOverlay } from './overlay.js';
import { prepareTown } from './startup.js';
import { createView } from './view.js';
import { createCamera } from './camera.js';
import { createWalking } from './walking.js';
import { createSimulation } from './simulation.js';
import { createNearby } from './nearby.js';
import { createScene } from './scene.js';
import { createLoop } from './loop.js';
import { exposeInspection } from './inspection.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const TOWN_URL = params.get('town') || '/town.json';
const MANIFEST_URL = params.get('manifest') || '/art/game/manifest.json';

async function boot() {
  const prepared = await prepareTown({ params, DEBUG, TOWN_URL, MANIFEST_URL });
  if (!prepared) return;
  const { town, art, ground, world, player, npcs, creatures, movers, outdoorKeepers } = prepared;

  const canvas = document.getElementById('view');
  const renderer = new Renderer(canvas, world, ground, DEBUG);
  const input = new Input(canvas);
  const smoke = new Smoke(world);
  const ui = new UI(town);
  ui.input = input;
  // while the guild roster is open, ← / → turn its pages instead of walking (↑ ↓ and WASD still walk)
  input.blockKey = (code) => ui.rosterOpen && (code === 'ArrowLeft' || code === 'ArrowRight');
  document.getElementById('loading').classList.add('hide');

  const updateNearby = createNearby({ town, world, player, movers, outdoorKeepers, creatures, ui });
  const { view, checkSize } = createView(canvas, renderer);
  const { cam, updateCamera } = createCamera({ player, world, view, ui });
  const { handleClick, walkToWorld } = createWalking({ canvas, view, world, player });

  const characters = [player, ...npcs.keepers, ...movers, ...creatures.list];
  const overlay = createOverlay({ town, world, art, characters, ui });
  const npcList = [...npcs.keepers, ...movers];
  const simulation = createSimulation({ input, player, world, npcs, creatures, movers, view, smoke, handleClick });
  const render = createScene({ world, player, npcList, characters, smoke, view, renderer, checkSize, updateCamera, simulation, updateNearby, overlay });
  const loop = createLoop({ update: simulation.update, render, simulation, player, view, ui, DEBUG });
  loop.start();
  exposeInspection({ town, art, world, ground, player, npcs, creatures, view, cam, ui, input, overlay, loop, walkToWorld });
}

boot().catch((e) => console.error('[codecity] boot failed', e));
