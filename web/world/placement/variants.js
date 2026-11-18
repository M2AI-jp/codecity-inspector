// 建物と小物の版の選択をまとめ、固定hashと候補の順を保つ。
import { warnOnce } from '../../assets.js';
import { strHash } from '../../util.js';

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
