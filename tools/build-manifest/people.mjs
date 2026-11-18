import fs from 'node:fs';
import path from 'node:path';
import { isPt } from './source.mjs';
import { pngSize } from './png-size.mjs';

// 4x4 people sheets: rows down / left / right / up; cols idle / walkA / idle / walkB.
const PEOPLE_ANIMS = {
  idle: { down: [0], left: [4], right: [8], up: [12] },
  walk: { down: [1, 2, 3, 0], left: [5, 6, 7, 4], right: [9, 10, 11, 8], up: [13, 14, 15, 12] },
};
// The approved player sheet (6x8): see web/assets.js for how the frames were chosen.
export const PLAYER = {
  src: '../approved/player--default.png', frame: [32, 32], pivot: [16, 31],
  anims: {
    idle: { up: [0], down: [12], right: [24], left: [36] },
    walk: { up: [2, 3, 4, 5], down: [14, 15, 16, 17], right: [26, 27, 28, 29], left: [38, 39, 40, 41] },
  },
};
// file name -> module.kind
const KEEPER_KIND = { smith: 'workshop', workshop: 'workshop', shop: 'shop', house: 'house', ruin: 'ruin' };

function personDef(abs, source) {
  const { readJSON, rel, warn } = source;
  const size = pngSize(abs);
  const side = abs.replace(/\.png$/, '.json');
  const s = fs.existsSync(side) ? readJSON(side) || {} : {};
  if (size && (size[0] % 32 || size[1] % 32)) warn(`${rel(abs)}: ${size.join('x')} は 32px の frame で割り切れません`);
  return {
    src: rel(abs),
    frame: isPt(s.frame) ? s.frame.slice(0, 2) : [32, 32],
    pivot: isPt(s.pivot) ? s.pivot.slice(0, 2) : [16, 31],
    anims: s.anims || PEOPLE_ANIMS,
  };
}

export function people(source) {
  const { GAME, list, warn } = source;
  const dir = path.join(GAME, 'residents');
  const keepers = {};
  const folk = [];
  let contractor = null;
  for (const f of list(dir, '.png')) {
    const abs = path.join(dir, f);
    let m;
    if ((m = /^keeper-([a-z_]+)\.png$/.exec(f))) {
      const kind = KEEPER_KIND[m[1]] || m[1];
      if (!kind) { warn(`residents/${f}: 番人の種類 "${m[1]}" を知りません`); continue; }
      keepers[kind] = personDef(abs, source);
    } else if ((m = /^townsfolk-(\d+)\.png$/.exec(f))) {
      folk.push([Number(m[1]), personDef(abs, source)]);
    } else if (f === 'contractor.png') {
      contractor = personDef(abs, source);
    } else warn(`residents/${f}: keeper-<kind>.png・townsfolk-<n>.png・contractor.png のどれでもないので無視します`);
  }
  folk.sort((a, b) => a[0] - b[0]);
  for (const k of ['workshop', 'shop', 'house', 'ruin']) if (!keepers[k]) warn(`番人 ${k} の画像がありません`);
  return { keepers, townsfolk: folk.map(([, d]) => d), contractor };
}
