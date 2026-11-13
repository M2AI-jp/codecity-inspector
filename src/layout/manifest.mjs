import { readFileSync } from 'node:fs';
import { PROP_SIZE } from './constants.mjs';

// ---------- art manifest（建物の footprint と扉の位置、小物の大きさ） ----------
let manifestCache;
function defaultManifest() {
  if (manifestCache === undefined) {
    try { manifestCache = JSON.parse(readFileSync(new URL('../../art/game/manifest.json', import.meta.url), 'utf8')); }
    catch { manifestCache = null; }
  }
  return manifestCache;
}
export function loadArt(manifest) {
  const m = manifest ?? defaultManifest();
  const out = {};
  const okFp = (fp) => Array.isArray(fp) && fp.length === 2 && fp.every((n) => Number.isInteger(n) && n >= 2 && n <= 16);
  for (const [k, a] of Object.entries(m?.archetypes || {})) {
    const defs = Array.isArray(a?.variants) && a.variants.length ? a.variants : [a];
    const v = defs[0];                                  // 版はすべて同じ footprint
    const fp = v?.footprint ?? a?.footprint;
    if (!okFp(fp)) continue;
    const dx = v?.door?.x ?? a?.door?.x;
    // 版ごとの扉（同じ footprint の版だけ。版の名前は town.json の building.variant に書く）
    const variants = defs.filter((d) => d?.id && (!d.footprint || (d.footprint[0] === fp[0] && d.footprint[1] === fp[1])))
      .map((d) => ({ id: d.id, doorX: Number.isInteger(d.door?.x) ? d.door.x : undefined, doorW: Number.isInteger(d.door?.w) ? d.door.w : 1,
        wall: Array.isArray(d.wall) && d.wall.length === 2 && d.wall.every(Number.isFinite) ? d.wall : [0, 0],
        // 絵が footprint の上にかぶさる行の数（列ごと）。その行の草地は屋根の陰で見えない
        cover: Array.isArray(d.cover) && d.cover.length === fp[0] && d.cover.every((n) => Number.isInteger(n) && n >= 0) ? d.cover : null }));
    const roof = Math.max(0, ...defs.map((d) => Number(d?.exterior?.origin?.[1]) || 0));     // 屋根の高さ（px）
    out[k] = { footprint: fp, doorX: Number.isInteger(dx) ? dx : undefined, variants, roof };
  }
  return out;
}
// 小物: 足元を原点にした solid / deck（px）と layer。layout は tile 単位で場所を取る
const isBox = (a) => Array.isArray(a) && a.length >= 4 && a.slice(0, 4).every(Number.isFinite);
export function loadProps(manifest) {
  const m = manifest ?? defaultManifest();
  const out = {};
  for (const [k, p] of Object.entries(m?.props || {})) {
    out[k] = { solid: isBox(p?.solid) ? p.solid.slice(0, 4) : null, deck: isBox(p?.deck) ? p.deck.slice(0, 4) : null,
      layer: p?.layer === 'ground' ? 'ground' : null };
    // 門: 柱（solids）・くぐれる所（opening）・灯（lights）・絵の原点（origin）。足元を原点にした px
    if (Array.isArray(p?.origin) && p.origin.length >= 2 && p.origin.slice(0, 2).every(Number.isFinite)) out[k].origin = p.origin.slice(0, 2);
    if (Array.isArray(p?.solids) && p.solids.length && p.solids.every(isBox)) out[k].solids = p.solids.map((b) => b.slice(0, 4));
    if (isBox(p?.opening)) out[k].opening = p.opening.slice(0, 4);
    if (Array.isArray(p?.size) && p.size.length >= 2 && p.size.slice(0, 2).every(Number.isFinite)) out[k].size = p.size.slice(0, 2);
    const ls = Array.isArray(p?.lights) && p.lights.length ? p.lights : Array.isArray(p?.light) ? [p.light] : [];
    if (ls.length && ls.every((l) => Array.isArray(l) && l.length >= 3 && l.slice(0, 3).every(Number.isFinite))) out[k].lights = ls.map((l) => l.slice(0, 3));
  }
  return out;
}
// 地面の texture の名前（水辺は water があるときだけつくる）
export function loadGround(manifest) {
  const m = manifest ?? defaultManifest();
  return Object.keys(m?.ground || {});
}
// 小物の tile の大きさ（足元は下辺の中央）: 表に無ければ solid の幅と奥行きから
export function propTiles(type, propArt) {
  if (PROP_SIZE[type]) return PROP_SIZE[type];
  const s = propArt?.[type]?.solid;
  if (!s) return [1, 1];
  return [Math.max(1, Math.round(s[2] / 16)), Math.max(1, Math.ceil(s[3] / 16))];
}
