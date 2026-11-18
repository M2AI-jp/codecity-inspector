// 小物の当たり・板・灯をまとめ、見た目と追加順を保つ。
import { TILE } from '../../config.js';
import { warnOnce } from '../../assets.js';

const T = TILE;
const isBox = (a) => Array.isArray(a) && a.length >= 4 && a.slice(0, 4).every(Number.isFinite);
const isLight = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every(Number.isFinite);

export function addProp(world, p, index) {
  const rectStart = world.rects.length, lightStart = world.lights.length;
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
  if (p.overlayId) {
    for (const r of world.rects.slice(rectStart)) r.overlayProp = p.overlayId;
    for (const l of world.lights.slice(lightStart)) l.overlayProp = p.overlayId;
  }
}
