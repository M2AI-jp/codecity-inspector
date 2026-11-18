import fs from 'node:fs';
import path from 'node:path';
import { isBox, isLight, isPt } from './source.mjs';
import { pngSize } from './png-size.mjs';
import { landmarkBounds } from './landmarks.mjs';

// Props and landmarks share sidecar rules and warning order.
export function props(source, folder = 'props') {
  const { GAME, list, readJSON, rel, warn } = source;
  const dir = path.join(GAME, folder);
  const out = {};
  for (const f of list(dir, '.png')) {
    const type = f.replace(/\.png$/, '');
    const abs = path.join(dir, f);
    const size = pngSize(abs) || [16, 16];
    const side = path.join(dir, `${type}.json`);
    const s = fs.existsSync(side) ? readJSON(side) || {} : null;
    if (!s) warn(`props/${type}.json がありません（足元は画像の下端中央、衝突・光なし）`);
    const d = s || {};
    out[type] = {
      src: rel(abs),
      origin: isPt(d.origin) ? d.origin.slice(0, 2) : [Math.floor(size[0] / 2), size[1] - 1],
      solid: isBox(d.solid) ? d.solid.slice(0, 4) : null,
      light: isLight(d.light) ? d.light.slice(0, 3) : null,
      flicker: d.flicker !== false,
    };
    // layer "ground": drawn under the characters (not y-sorted), e.g. a pier's boards or a moored boat
    if (d.layer === 'ground') out[type].layer = 'ground';
    else if (d.layer !== undefined && d.layer !== null) warn(`props/${type}.json: layer "${d.layer}" を知りません（"ground" だけ）`);
    // deck: walkable floor over water, [x, y, w, h] px relative to the foot
    if (isBox(d.deck)) out[type].deck = d.deck.slice(0, 4);
    else if (d.deck !== undefined && d.deck !== null) warn(`props/${type}.json: deck は [x, y, w, h] の数の配列にする`);
    // solids: several collision boxes (a gate's pillars), lights: several lights (its lanterns),
    // opening: the walkable gap under the lintel [x, y, w, h]. All px relative to the foot
    if (Array.isArray(d.solids) && d.solids.length && d.solids.every(isBox)) out[type].solids = d.solids.map((b) => b.slice(0, 4));
    else if (d.solids !== undefined && d.solids !== null) warn(`props/${type}.json: solids は [[x, y, w, h], ...] にする`);
    if (Array.isArray(d.lights) && d.lights.length && d.lights.every(isLight)) out[type].lights = d.lights.map((l) => l.slice(0, 3));
    else if (d.lights !== undefined && d.lights !== null) warn(`props/${type}.json: lights は [[x, y, r], ...] にする`);
    if (isBox(d.opening)) out[type].opening = d.opening.slice(0, 4);
    else if (d.opening !== undefined && d.opening !== null) warn(`props/${type}.json: opening は [x, y, w, h] の数の配列にする`);
    if (out[type].solids || out[type].opening) out[type].size = size.slice(0, 2);       // 絵の大きさ（layout が絵のかかる範囲を測る）
    if (folder === 'landmarks') {
      const bounds = landmarkBounds(abs);
      out[type].size = size.slice(0, 2);
      out[type].bounds = bounds;
    }
  }
  for (const f of list(dir, '.json')) {
    if (!fs.existsSync(path.join(dir, f.replace(/\.json$/, '.png')))) warn(`props/${f}: 対応する png がありません`);
  }
  return out;
}
