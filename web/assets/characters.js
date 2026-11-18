// Queue player and people in their original order while sharing sheet preparation.
import { loadImage, resolve } from './loading.js';
import { toCanvas, cleanMagenta } from './canvas.js';
import { buildSheet } from './sheet.js';
import { DEFAULT_PLAYER_SRC, DEFAULT_PLAYER_ANIMS } from './defaults.js';

export function enqueuePlayer(m, base, opts, art, jobs) {
  // Player
  const pdef = (m.characters && m.characters.player) || {};
  const playerSrc = opts.playerOverride
    ? new URL(opts.playerOverride, location.href).href
    : pdef.src ? resolve(pdef.src, base) : new URL(DEFAULT_PLAYER_SRC, location.href).href;
  jobs.push(loadImage(playerSrc).then((img) => {
    if (!img) return;
    const c = toCanvas(img);
    const r = cleanMagenta(c);
    if (r.removed || r.neutral) console.info(`[codecity] player sprite: removed ${r.removed} magenta fringe px, neutralised ${r.neutral}`);
    art.player = buildSheet(c, pdef.frame ? pdef : { frame: [32, 32], pivot: [16, 31] }, DEFAULT_PLAYER_ANIMS);
  }));
}

export function enqueuePeople(m, base, art, jobs) {
  // People: keepers by module.kind, townsfolk walkers (older manifests: characters.residents)
  const ch = m.characters || {};
  const loadPerson = (def, put) => {
    if (!def || !def.src) return;
    jobs.push(loadImage(resolve(def.src, base)).then((img) => {
      if (!img) return;
      const c = toCanvas(img);
      cleanMagenta(c);
      put(buildSheet(c, def, null));
    }));
  };
  for (const [kind, def] of Object.entries(ch.keepers || {})) loadPerson(def, (sh) => { art.keepers[kind] = sh; });
  const folk = Array.isArray(ch.townsfolk) ? ch.townsfolk : Array.isArray(ch.residents) ? ch.residents : [];
  folk.forEach((def, i) => loadPerson(def, (sh) => { art.townsfolk[i] = sh; }));
}
