// Build animation frames separately from loading so frame fallback and mirroring stay consistent.
import { flipCanvas } from './canvas.js';

const DIRS = ['up', 'down', 'right', 'left'];
const OPPOSITE = { left: 'right', right: 'left' };

// Builds a character sheet: { image, flipped, fw, fh, px, py, cols, anims[name][dir] = [{flip, sx, sy}] }
export function buildSheet(canvas, def, fallbackAnims) {
  const [fw, fh] = def.frame || [32, 32];
  const [px, py] = def.pivot || [Math.floor(fw / 2), fh - 1];
  const cols = Math.max(1, Math.floor(canvas.width / fw));
  const rows = Math.max(1, Math.floor(canvas.height / fh));
  const src = def.anims || fallbackAnims || {};
  let flipped = null;
  const frameOf = (idx, flip) => {
    const n = Math.max(0, Math.min(cols * rows - 1, idx | 0));
    const col = n % cols, row = Math.floor(n / cols);
    return { flip, sx: (flip ? cols - 1 - col : col) * fw, sy: row * fh };
  };
  const anims = {};
  for (const name of ['idle', 'walk']) {
    anims[name] = {};
    for (const dir of DIRS) {
      let list = src[name] && src[name][dir];
      let flip = false;
      if ((!list || !list.length) && OPPOSITE[dir] && src[name] && src[name][OPPOSITE[dir]]) {
        list = src[name][OPPOSITE[dir]]; flip = true;
      }
      if (!list || !list.length) list = null;
      anims[name][dir] = list ? list.map((i) => frameOf(i, flip)) : null;
      if (flip) flipped = flipped || flipCanvas(canvas);
    }
  }
  // fill gaps: idle <- walk[0], walk <- idle, missing dirs <- down
  for (const dir of DIRS) {
    if (!anims.idle[dir] && anims.walk[dir]) anims.idle[dir] = [anims.walk[dir][0]];
    if (!anims.walk[dir] && anims.idle[dir]) anims.walk[dir] = anims.idle[dir];
  }
  for (const dir of DIRS) {
    if (!anims.idle[dir]) anims.idle[dir] = anims.idle.down || [frameOf(0, false)];
    if (!anims.walk[dir]) anims.walk[dir] = anims.walk.down || anims.idle[dir];
  }
  return { image: canvas, flipped, fw, fh, px, py, cols, anims };
}
