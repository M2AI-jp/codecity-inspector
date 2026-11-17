import { watchFile, unwatchFile } from 'node:fs';
import { readOverlay } from './read.mjs';
import { placeOverlay, layoutKey } from './place.mjs';

export function createOverlaySession({ file, overlay, baseTown, town, makeBase, manifest }) {
  let accepted = JSON.stringify(overlay), error = null, ground, renderGround, watching = false;
  function refresh() {
    try {
      const next = readOverlay(file), encoded = JSON.stringify(next);
      if (encoded === accepted) { error = null; return false; }
      const rebuild = layoutKey(next) !== layoutKey(overlay);
      const base = rebuild ? makeBase(next) : baseTown;
      const placed = placeOverlay(base, next, manifest);
      const nextGround = rebuild && renderGround ? renderGround(placed) : ground;
      // Publish a single complete snapshot. Invalid/intermediate writes retain the last good town.
      overlay = next; baseTown = base; town = placed; ground = nextGround; accepted = encoded; error = null;
      return true;
    } catch (e) { error = e.message; return false; }
  }
  const changed = () => refresh();
  return {
    get town() { return town; },
    get ground() { return ground; },
    get error() { return error; },
    refresh,
    response() {
      refresh();
      return error ? { status: 422, body: { version: 1, error } } : { status: 200, body: town.overlay };
    },
    start(makeGround) {
      renderGround = makeGround;
      if (!watching) { watching = true; watchFile(file, { persistent: false, interval: 750 }, changed); }
    },
    close() { if (watching) unwatchFile(file, changed); watching = false; },
  };
}
