// 建物・小物・水上の板を、元の順に当たり矩形と灯へ追加する。
import { TILE } from '../config.js';
import { MAT } from '../ground.js';
import { warnOnce } from '../assets.js';
import { strHash } from '../util.js';

const T = TILE;
const isBox = (a) => Array.isArray(a) && a.length >= 4 && a.slice(0, 4).every(Number.isFinite);
const isLight = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every(Number.isFinite);

// 板の下の水tileは、板で覆われた部分だけ歩ける。残りは当たり矩形にして、
// 足元が板の縁に沿って滑るようにする。板をtileに丸めず、絵のdeckのpxに合わせる。
export function applyDecks(world) {
  for (const d of world.decks) {
    const tx0 = Math.max(0, Math.floor(d.x / T)), ty0 = Math.max(0, Math.floor(d.y / T));
    const tx1 = Math.min(world.cols - 1, Math.floor((d.x + d.w - 0.001) / T)), ty1 = Math.min(world.rows - 1, Math.floor((d.y + d.h - 0.001) / T));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = ty * world.cols + tx;
      if (world.grid[k] !== MAT.WATER || world.deckTile[k]) continue;
      world.deckTile[k] = 1;
      world.tileSolid[k] = 0;
      const X0 = tx * T, Y0 = ty * T, X1 = X0 + T, Y1 = Y0 + T;
      const ix0 = Math.max(X0, d.x), ix1 = Math.min(X1, d.x + d.w), iy1 = Math.min(Y1, d.y + d.h);
      // 岸壁の笠石を見せるため板の上端が少し下がっていても、岸の地面につなぐ。
      const shore = ty > 0 && d.y - Y0 <= 8 && world.grid[k - world.cols] !== MAT.WATER && world.grid[k - world.cols] !== MAT.OUT;
      const iy0 = shore ? Y0 : Math.max(Y0, d.y);
      world.addRect(X0, Y0, T, iy0 - Y0, 'water');
      world.addRect(X0, iy1, T, Y1 - iy1, 'water');
      world.addRect(X0, iy0, ix0 - X0, iy1 - iy0, 'water');
      world.addRect(ix1, iy0, X1 - ix1, iy1 - iy0, 'water');
    }
  }
}

export function addRect(world, x, y, w, h, kind) {
  if (!(w > 0 && h > 0)) return null;
  const r = { x, y, w, h, kind };
  const idx = world.rects.length;
  world.rects.push(r);
  const tx0 = Math.max(0, Math.floor(x / T)), ty0 = Math.max(0, Math.floor(y / T));
  const tx1 = Math.min(world.cols - 1, Math.floor((x + w - 0.001) / T)), ty1 = Math.min(world.rows - 1, Math.floor((y + h - 0.001) / T));
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const k = ty * world.cols + tx;
    (world.buckets[k] || (world.buckets[k] = [])).push(idx);
  }
  return r;
}

// town.jsonが指定した版を選ぶ（layoutが隣と違う版を選んでいる）。
// 指定が無ければ、footprintの合う版からbuilding.idの固定hashで選ぶ。
export function pickVariant(world, b, w, h) {
  const a = world.art.archetypes[b.archetype];
  if (!a || !a.variants.length) return null;
  const fits = a.variants.filter((v) => !v.footprint || (v.footprint[0] === w && v.footprint[1] === h));
  const named = b.variant && fits.find((v) => v.id === b.variant);
  if (named) return named;
  const pool = fits.length ? fits : a.variants;
  const v = pool[strHash(String(b.id)) % pool.length];
  if (!fits.length && v.footprint) {
    warnOnce(`fp:${b.id}`, `${b.id}: footprint ${w}x${h} に合う "${b.archetype}" の版がありません（${v.id} は ${v.footprint.join('x')}）`);
  }
  return v;
}

export function addBuilding(world, b, index) {
  const x = b.x | 0, y = b.y | 0, w = Math.max(1, b.w | 0), h = Math.max(1, b.h | 0);
  const arch = world.pickVariant(b, w, h);
  if (!arch) warnOnce(`arch:${b.archetype}`, `archetype "${b.archetype}" が manifest にありません（${b.id} などは描画しません。衝突と扉は town.json の footprint で動きます）`);
  // 最下段の扉の隙間は、town.jsonのdoor.xより絵のdoorを優先する。
  let d0, d1;
  if (arch && arch.door && Number.isFinite(arch.door.x)) {
    d0 = x + (arch.door.x | 0); d1 = d0 + Math.max(1, arch.door.w | 0);
  } else if (b.door && Number.isFinite(b.door.x)) {
    d0 = b.door.x | 0; d1 = d0 + 1;
  } else {
    d0 = x + (w >> 1); d1 = d0 + 1;
  }
  d0 = Math.max(x, Math.min(x + w - 1, d0)); d1 = Math.max(d0 + 1, Math.min(x + w, d1));
  const bottom = y + h - 1;
  const bld = {
    index, id: b.id, data: b, arch, module: b.module || null,
    archetype: b.archetype,
    x, y, w, h,
    px: x * T, py: y * T, pw: w * T, ph: h * T,
    bottomPx: (y + h) * T,
    doorX0: d0, doorX1: d1, doorY: bottom,
    doorPx: ((d0 + d1) / 2) * T,           // 扉の中央のx（px）
    open: 0, inside: false,
    interior: [],
    keeperSpot: null,
    keeper: null,
  };
  const fl = arch && Array.isArray(arch.floor) && arch.floor.length >= 4 && arch.floor.slice(0, 4).every(Number.isFinite) ? arch.floor : null;
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!world.inGrid(tx, ty)) continue;
      const k = ty * world.cols + tx;
      world.buildingMap[k] = index;
      if (fl) { world.tileSolid[k] = 0; continue; }       // 壁は下でpxの矩形にする
      const ring = ty === y || ty === y + 1 || ty === bottom || tx === x || tx === x + w - 1;
      const doorGap = ty === bottom && tx >= d0 && tx < d1;
      if (ring && !doorGap) world.tileSolid[k] = 1;
      else {
        world.tileSolid[k] = 0;
        if (!doorGap) bld.interior.push(k);
      }
    }
  }
  if (fl) world.addFloorWalls(bld, fl);
  if (arch) {
    for (const bl of arch.blockers) {
      if (Array.isArray(bl) && bl.length >= 4) world.addRect(bld.px + bl[0], bld.py + bl[1], bl[2], bl[3], 'blocker');
    }
    arch.lights.forEach((l, i) => {
      if (Array.isArray(l) && l.length >= 3) world.lights.push({ x: bld.px + l[0], y: bld.py + l[1], poolY: bld.py + l[1] + 4, r: l[2], kind: 'window', seed: index * 31 + i, building: bld });
    });
    // 室内の炉・鍛冶場の灯は、建物が開いている間だけ灯る（web/lighting.js）。
    (arch.interiorLights || []).forEach((l, i) => {
      if (Array.isArray(l) && l.length >= 3) world.lights.push({ x: bld.px + l[0], y: bld.py + l[1], poolY: bld.py + l[1] + 4, r: l[2], kind: 'hearth', interior: true, seed: index * 31 + 13 + i, building: bld });
    });
  }
  // 扉のすぐ外の提灯。
  world.lights.push({ x: bld.doorPx, y: bld.bottomPx - 10, poolY: bld.bottomPx + 2, r: 34, kind: 'door', seed: index * 31 + 29, building: bld });
  world.buildings.push(bld);
}

// manifestの<type>・<type>-2・<type>-3…から、置く位置の固定hashで見た目を選ぶ。
// 並んだ木が同じ姿の繰り返しにならないようにする。
export function propDef(world, type, ax, ay) {
  const props = world.art.props;
  let looks = (world.propLooks || (world.propLooks = new Map())).get(type);
  if (!looks) {
    looks = [];
    if (props[type]) looks.push(props[type]);
    for (let n = 2; props[`${type}-${n}`]; n++) looks.push(props[`${type}-${n}`]);
    world.propLooks.set(type, looks);
  }
  if (!looks.length) return null;
  return looks[strHash(`${type}:${ax},${ay}`) % looks.length];
}

export function addProp(world, p, index) {
  // lookはmanifestの名前そのもの（桟橋の板など、layoutが形を見て選んだもの）。
  const def = (p.look && world.art.props[p.look]) || world.propDef(p.type, Math.round(p.x * T), Math.round(p.y * T));
  if (!def) warnOnce(`prop:${p.look || p.type}`, `prop "${p.look || p.type}" が manifest にありません（描画しません）`);
  const ax = Math.round(p.x * T), ay = Math.round(p.y * T);
  const prop = { index, type: p.type, data: p, def, x: ax, y: ay, solid: null, layer: def && def.layer === 'ground' ? 'ground' : null };
  // 複数のsolids（門の柱など。開口部はあける）があれば、単一のsolidより優先する。
  const boxes = def && Array.isArray(def.solids) && def.solids.length ? def.solids.filter(isBox) : def && isBox(def.solid) ? [def.solid] : [];
  boxes.forEach((s, i) => { const r = world.addRect(ax + s[0], ay + s[1], s[2], s[3], 'prop'); if (!i) prop.solid = r; });
  // deck（桟橋の板）は水上の歩ける床。足元基準の[x, y, w, h]（px）。
  if (def && Array.isArray(def.deck) && def.deck.length >= 4 && def.deck.slice(0, 4).every(Number.isFinite)) {
    world.decks.push({ x: ax + def.deck[0], y: ay + def.deck[1], w: def.deck[2], h: def.deck[3], prop });
  }
  // 複数のlights（門の2つの提灯など）があれば、単一のlightより優先する。
  const lamps = def && Array.isArray(def.lights) && def.lights.length ? def.lights.filter(isLight) : def && isLight(def.light) ? [def.light] : [];
  lamps.forEach((l, i) => {
    // 灯そのものの光はその位置に、地面の光だまりは下へ寄せる。
    // 3/4見下ろしでは、柱の提灯が足元の道を照らす。
    const lx = ax + l[0], ly = ay + l[1];
    world.lights.push({ x: lx, y: ly, poolY: ly + Math.max(0, ay - ly) * 0.6, footY: ay, r: l[2], kind: def.flicker ? 'flame' : 'steady', seed: 1000 + index + i * 7919, building: null });
  });
  world.props.push(prop);
}
