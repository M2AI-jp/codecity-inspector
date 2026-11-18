// Keep art key creation and the single Promise.all here to preserve the manifest loading contract.
import { enqueuePlayer, enqueuePeople } from './characters.js';
import { enqueueArchetypes } from './archetypes.js';
import { enqueueProps } from './props.js';
import { enqueueGround } from './ground.js';

// Loads everything the manifest references. Returns a normalised art object.
export async function loadArt(manifest, manifestUrl, opts) {
  const base = new URL(manifestUrl, location.href).href;
  const m = manifest || {};
  const art = { tile: m.tile || 16, player: null, keepers: {}, townsfolk: [], archetypes: {}, props: {}, ground: {} };
  const jobs = [];

  enqueuePlayer(m, base, opts, art, jobs);
  enqueuePeople(m, base, art, jobs);
  enqueueArchetypes(m, base, art, jobs);
  enqueueProps(m, base, art, jobs);
  enqueueGround(m, base, opts, art, jobs);

  await Promise.all(jobs);
  return art;
}
