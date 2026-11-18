// Renderer entry: preserve the public methods and ownership of reusable drawing state.
import { Lighting } from './lighting.js';
import { push, render } from './render/frame.js';
import { drawBuilding } from './render/buildings.js';
import { drawProp } from './render/props.js';
import { covers, coversProp, clearance } from './render/occlusion.js';
import { shadowSprite, drawGhost, drawCharacter } from './render/characters.js';
import { drawDebug } from './render/debug.js';

export { opaqueInBox } from './render/occlusion.js';

export class Renderer {
  constructor(canvas, world, ground, debug) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.ground = ground;
    this.debug = debug;
    this.lighting = new Lighting();
    this.shadow = shadowSprite();
    this.items = [];        // reusable draw list entries
    this.count = 0;
    this.sortFn = (a, b) => a.key - b.key || a.order - b.order;
    this.drawList = [];
  }

  // Each module uses this same Renderer and its existing caches.
  push(key, kind, obj, order) { return push(this, key, kind, obj, order); }
  render(s) { return render(this, s); }
  drawBuilding(ctx, b, camX, camY) { return drawBuilding(this, ctx, b, camX, camY); }
  drawProp(ctx, p, camX, camY) { return drawProp(ctx, p, camX, camY); }
  covers(b, p) { return covers(b, p); }
  coversProp(p, pl) { return coversProp(this, p, pl); }
  clearance(d) { return clearance(d); }
  drawGhost(ctx, c, camX, camY) { return drawGhost(this, ctx, c, camX, camY); }
  drawCharacter(ctx, c, camX, camY, noShadow) { return drawCharacter(this, ctx, c, camX, camY, noShadow); }
  drawDebug(ctx, s) { return drawDebug(ctx, s); }
}
