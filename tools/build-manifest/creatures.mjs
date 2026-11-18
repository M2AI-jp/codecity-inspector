import fs from 'node:fs';
import path from 'node:path';
import { isPt } from './source.mjs';

// --- creatures (art/game/creatures/<name>.png + <name>.json: frame, pivot, anims) --------
export function creatures(source) {
  const { GAME, list, readJSON, rel, warn } = source;
  const dir = path.join(GAME, 'creatures');
  const out = {};
  for (const f of list(dir, '.png')) {
    const name = f.replace(/\.png$/, '');
    const abs = path.join(dir, f);
    const side = path.join(dir, `${name}.json`);
    const s = fs.existsSync(side) ? readJSON(side) : null;
    if (!s || !isPt(s.frame) || !s.anims) { warn(`creatures/${name}.json に frame と anims がないので使いません`); continue; }
    out[name] = { src: rel(abs), frame: s.frame.slice(0, 2), pivot: isPt(s.pivot) ? s.pivot.slice(0, 2) : [Math.floor(s.frame[0] / 2), s.frame[1] - 1], anims: s.anims };
  }
  return out;
}
