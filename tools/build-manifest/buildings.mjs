import fs from 'node:fs';
import path from 'node:path';
import { isBox, isLight, isPt } from './source.mjs';
import { pngSize } from './png-size.mjs';
import { wallInset } from './wall-inset.mjs';
import { roofCover } from './roof-cover.mjs';

export function buildings(source) {
  const { GAME, list, readJSON, rel, warn } = source;
  const dir = path.join(GAME, 'buildings');
  const archetypes = {};
  for (const f of list(dir, '.json')) {
    const file = path.join(dir, f);
    const s = readJSON(file);
    if (!s) continue;
    const id = f.replace(/\.json$/, '');
    const key = s.archetype || id.replace(/-\d+$/, '');
    const img = (part) => {
      const p = s[part];
      if (!p || !p.src) return null;
      const abs = path.join(dir, p.src);
      if (!fs.existsSync(abs)) { warn(`${rel(file)}: ${part} の画像 ${p.src} がありません`); return null; }
      const origin = isPt(p.origin) ? p.origin.slice(0, 2) : [0, 0];
      if (!isPt(p.origin)) warn(`${rel(file)}: ${part}.origin がありません（[0,0] とみなす）`);
      return { src: rel(abs), origin, size: pngSize(abs) };
    };
    const exterior = img('exterior');
    if (!exterior) { warn(`${rel(file)}: exterior が無いので、この版は使いません`); continue; }
    const cutaway = img('cutaway');
    if (!cutaway) warn(`${rel(file)}: cutaway がありません（中に入っても外観のまま）`);
    const fp = isPt(s.footprint) ? s.footprint.slice(0, 2) : null;
    if (!fp) warn(`${rel(file)}: footprint がありません`);
    const wall = fp ? wallInset(path.join(dir, s.exterior.src), fp[1]) : null;
    const cover = fp ? roofCover(path.join(dir, s.exterior.src), exterior.origin, fp[0]) : null;
    const variant = {
      id,
      footprint: fp,
      exterior,
      cutaway,
      ...(wall ? { wall } : {}),
      ...(cover ? { cover } : {}),
      door: s.door && Number.isFinite(s.door.x) ? { x: s.door.x, w: Number.isFinite(s.door.w) ? s.door.w : 1 } : null,
      floor: isBox(s.floor) ? s.floor.slice(0, 4) : null,
      blockers: (s.blockers || []).filter(isBox),
      lights: (s.lights || []).filter(isLight),
      smoke: (s.smoke || []).filter(isPt),
    };
    // lights inside the building (hearth, forge): lit only while the building is open (cutaway)
    const inner = (s.interiorLights || []).filter(isLight);
    if (inner.length) variant.interiorLights = inner;
    if (!variant.door) warn(`${rel(file)}: door がありません（town.json の扉を使う）`);
    (archetypes[key] || (archetypes[key] = { variants: [] })).variants.push(variant);
  }
  for (const a of Object.values(archetypes)) a.variants.sort((p, q) => p.id.localeCompare(q.id, 'en', { numeric: true }));
  return archetypes;
}
