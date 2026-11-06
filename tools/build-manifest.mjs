#!/usr/bin/env node
// Builds art/game/manifest.json from the images and their sidecar .json files (CONTRACTS.md
// 「画像ごとのsidecar」). Never edit manifest.json by hand; run `node tools/build-manifest.mjs`.
//
//   art/game/buildings/<archetype>-<n>.json (+ the pngs it names)  -> archetypes[archetype].variants[]
//                                                                      (+ wall: [left, right] inset px, measured)
//   art/game/residents/keeper-<kind>.png                            -> characters.keepers[kind]
//   art/game/residents/townsfolk-<n>.png                            -> characters.townsfolk[] (by n)
//   art/game/residents/contractor.png                               -> characters.contractor (外部工務店の代理人)
//   art/game/props/<type>.png (+ <type>.json)                       -> props[type] (solid, light, flicker, layer, deck,
//                                                                      solids, lights, opening)
//   art/game/ground/<name>.png                                      -> ground[name]
//   art/game/creatures/<name>.png (+ <name>.json)                   -> creatures[name]
//
// Node 22+, standard library only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'art', 'game');
const OUT = path.join(GAME, 'manifest.json');

// 4x4 people sheets: rows down / left / right / up; cols idle / walkA / idle / walkB.
const PEOPLE_ANIMS = {
  idle: { down: [0], left: [4], right: [8], up: [12] },
  walk: { down: [1, 2, 3, 0], left: [5, 6, 7, 4], right: [9, 10, 11, 8], up: [13, 14, 15, 12] },
};
// The approved player sheet (6x8): see web/assets.js for how the frames were chosen.
const PLAYER = {
  src: '../approved/player--default.png', frame: [32, 32], pivot: [16, 31],
  anims: {
    idle: { up: [0], down: [12], right: [24], left: [36] },
    walk: { up: [2, 3, 4, 5], down: [14, 15, 16, 17], right: [26, 27, 28, 29], left: [38, 39, 40, 41] },
  },
};
// file name -> module.kind
const KEEPER_KIND = { smith: 'workshop', workshop: 'workshop', shop: 'shop', house: 'house', ruin: 'ruin' };

const warnings = [];
const warn = (m) => warnings.push(m);
const rel = (abs) => path.relative(GAME, abs).split(path.sep).join('/');
const list = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : []);

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { warn(`${rel(file)}: JSON を読めません (${e.message})`); return null; }
}

const isBox = (a) => Array.isArray(a) && a.length >= 4 && a.slice(0, 4).every(Number.isFinite);

// How far the drawn walls sit inside the footprint's left / right edge (px): the median first /
// last opaque column over the lower wall rows of the exterior image (props such as a scaffold are
// pushed against the wall by this much).
function wallInset(abs, footH) {
  try {
    const im = decodePNG(fs.readFileSync(abs));
    const W = im.width, H = im.height, L = [], R = [];
    for (let y = Math.max(0, H - Math.min(40, footH * 16 - 4)); y < H - 4; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < W; x++) if (im.data[(y * W + x) * 4 + 3] > 128) { if (l < 0) l = x; r = x; }
      if (l >= 0) { L.push(l); R.push(W - 1 - r); }
    }
    if (!L.length) return null;
    const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    return [med(L), med(R)];
  } catch { return null; }
}
const isLight = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every(Number.isFinite);
const isPt = (a) => Array.isArray(a) && a.length >= 2 && a.slice(0, 2).every(Number.isFinite);

// --- buildings -------------------------------------------------------------------------
function buildings() {
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
    const variant = {
      id,
      footprint: fp,
      exterior,
      cutaway,
      ...(wall ? { wall } : {}),
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

// --- people ----------------------------------------------------------------------------
function personDef(abs) {
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

function people() {
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
      keepers[kind] = personDef(abs);
    } else if ((m = /^townsfolk-(\d+)\.png$/.exec(f))) {
      folk.push([Number(m[1]), personDef(abs)]);
    } else if (f === 'contractor.png') {
      contractor = personDef(abs);
    } else warn(`residents/${f}: keeper-<kind>.png・townsfolk-<n>.png・contractor.png のどれでもないので無視します`);
  }
  folk.sort((a, b) => a[0] - b[0]);
  for (const k of ['workshop', 'shop', 'house', 'ruin']) if (!keepers[k]) warn(`番人 ${k} の画像がありません`);
  return { keepers, townsfolk: folk.map(([, d]) => d), contractor };
}

// --- props -----------------------------------------------------------------------------
function props() {
  const dir = path.join(GAME, 'props');
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
  }
  for (const f of list(dir, '.json')) {
    if (!fs.existsSync(path.join(dir, f.replace(/\.json$/, '.png')))) warn(`props/${f}: 対応する png がありません`);
  }
  return out;
}

function ground() {
  const dir = path.join(GAME, 'ground');
  const out = {};
  for (const f of list(dir, '.png')) out[f.replace(/\.png$/, '')] = rel(path.join(dir, f));
  return out;
}

// --- creatures (art/game/creatures/<name>.png + <name>.json: frame, pivot, anims) --------
function creatures() {
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

const { keepers, townsfolk, contractor } = people();
const manifest = {
  _generated: 'tools/build-manifest.mjs が art/game/ の画像と sidecar から作ったファイル。手で編集しない。',
  tile: 16,
  characters: { player: PLAYER, keepers, townsfolk, ...(contractor ? { contractor } : {}) },
  archetypes: buildings(),
  props: props(),
  ground: ground(),
  creatures: creatures(),
};
// keep short number arrays on one line so the file stays readable
const text = JSON.stringify(manifest, null, 2).replace(/\[\s+([-\d.,\s]+?)\s+\]/g, (_, inner) => `[${inner.trim().split(/\s*,\s*/).join(', ')}]`);
fs.writeFileSync(OUT, `${text}\n`);

const nv = Object.values(manifest.archetypes).reduce((n, a) => n + a.variants.length, 0);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${Object.keys(manifest.archetypes).length} archetypes (${nv} variants), ` +
  `${Object.keys(keepers).length} keepers, ${townsfolk.length} townsfolk${contractor ? ', contractor' : ''}, ${Object.keys(manifest.props).length} props, ` +
  `${Object.keys(manifest.ground).length} ground textures, ${Object.keys(manifest.creatures).length} creatures`);
for (const w of warnings) console.warn(`  ! ${w}`);
