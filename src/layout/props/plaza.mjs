import { hash32 } from '../util.mjs';
import { propTiles } from '../manifest.mjs';

export function placePlazaProps(S) {
  const { plaza, P, mark, reserved, propArt, props, tryProp, walk, id, blocked, flood, noTree, has, landmarks, out, pick, rng, lampAt } = S;
  // 広場は舞台: まん中の飾り（井戸小屋か花壇、無ければ花の島）に向いたベンチ、縁に樽と鉢、南の縁に低い柵、縁の街灯。
  // 役場の段・広場の南階段の上下と、飾りのまわり1マスは歩けるようにあけておく
  const { x0: px0, x1: px1, y0: py0, y1: py1 } = plaza, pc = P.cx;
  const ht = P.terraces.find((t) => t.hall);
  const sq0 = ht ? ht.y + ht.h + 1 : py0;                               // 段の壁の下から広場
  const feature = { x0: 0, x1: -1, y0: 0, y1: -1 };
  const ring = (x0, y0, x1, y1) => mark(reserved, x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  const placeFeature = (type, look, spots, withKeeper) => {
    const [fw, fh] = propTiles(look || type, propArt);
    for (const [tx, ty, side] of spots) {
      if (tx < px0 || tx + fw - 1 > px1 || ty < sq0 || ty + fh - 1 > py1) continue;
      const before = props.length;
      if (!tryProp(type, tx, ty, false, look)) continue;
      let keeper = null;
      if (withKeeper) {
        // 番人の立つ所（井戸小屋の外側の下の段、なければ反対側）の歩ける1マスを確かめる
        const ox = side < 0 ? tx - 1 : tx + fw, ix = side < 0 ? tx + fw : tx - 1;
        for (const [kx, ky] of [[ox, ty + fh - 1], [ox, ty + fh], [ix, ty + fh - 1], [ix, ty + fh]]) {
          if (!walk(kx, ky) || reserved[id(kx, ky)]) continue;
          blocked[id(kx, ky)] = 1;
          if (flood().count === S.reach - 1) { keeper = { x: kx + 0.5, y: ky + 0.6875 }; S.reach--; break; }
          blocked[id(kx, ky)] = 0;
        }
        if (!keeper) {                                   // 番人が立てない → 置き直す
          props.splice(before, 1);
          for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) blocked[id(tx + dx, ty + dy)] = 0;
          S.reach = flood().count;
          continue;
        }
        const kx = Math.floor(keeper.x), ky = Math.floor(keeper.y);
        mark(reserved, kx - 1, ky - 1, kx + 1, ky + 1);
        mark(noTree, kx - 1, ky - 1, kx + 1, ky + 1);
      }
      ring(tx, ty, tx + fw - 1, ty + fh - 1);
      mark(noTree, tx - 2, ty - 2, tx + fw + 1, ty + fh + 1);
      Object.assign(feature, { x0: tx, x1: tx + fw - 1, y0: ty, y1: ty + fh - 1 });
      return { prop: props[before], keeper };
    }
    return null;
  };
  const centreSpots = (fw, fh) => {
    const ty = py1 - fh, tx = pc - Math.floor(fw / 2);
    return [[tx, ty, 1], [tx - 1, ty, -1], [tx + 1, ty, 1], [tx, ty - 1, 1], [tx - 2, ty, -1], [tx + 2, ty, 1]];
  };
  const hasBed = has('flowerbed');
  let wellAtCentre = false;
  for (const lm of landmarks.filter((l) => l.data.archetype === 'well')) {
    const [fw, fh] = propTiles(lm.prop, propArt);
    // 井戸小屋が広場のまん中の飾り。置けなければ左右の寄り、広場に近い緑地
    const spots = centreSpots(fw, fh);
    const side0 = hash32(`well:${lm.data.id}:${pc}`) % 2 ? 1 : -1;
    for (const side of [side0, -side0]) for (const off of [3, 1, 5]) spots.push([side < 0 ? pc - 1 - off - fw : pc + 1 + off, py1 - fh - 1, side]);
    let got = placeFeature(lm.prop, null, spots, true);
    if (got) wellAtCentre = Math.abs((feature.x0 + feature.x1) / 2 - pc) <= 2;
    if (!got) {
      for (const L of P.leaves.filter((L) => L.green).sort((a, b) => Math.hypot(a.x0 - pc, a.y0 - py0) - Math.hypot(b.x0 - pc, b.y0 - py0))) {
        const [tx, ty] = [Math.floor((L.x0 + L.x1 - fw) / 2), L.y1 - fh - 1];
        const before = props.length;
        if (!tryProp(lm.prop, tx, ty)) continue;
        let keeper = null;
        for (const [kx, ky] of [[tx + fw, ty + fh - 1], [tx - 1, ty + fh - 1]]) {
          if (!walk(kx, ky) || reserved[id(kx, ky)]) continue;
          blocked[id(kx, ky)] = 1;
          if (flood().count === S.reach - 1) { keeper = { x: kx + 0.5, y: ky + 0.6875 }; S.reach--; break; }
          blocked[id(kx, ky)] = 0;
        }
        if (!keeper) { props.splice(before, 1); for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) blocked[id(tx + dx, ty + dy)] = 0; S.reach = flood().count; continue; }
        got = { prop: props[before], keeper };
        mark(noTree, tx - 2, ty - 2, tx + fw + 1, ty + fh + 1);
        break;
      }
    }
    if (got) out.landmarks.push({ ...lm.data, x: got.prop.x, y: got.prop.y, keeper: got.keeper });
  }
  // 井戸小屋がまん中にあれば、花壇（あれば）は広場の上の方の片側に（ベンチは井戸小屋に向いたまま）
  if (wellAtCentre && hasBed) {
    const keep = { ...feature };
    const [fw, fh] = propTiles('flowerbed', propArt);
    const left = hash32(`bed:${pc}:${sq0}`) % 2 === 0;
    // 上の方・中心から離れた所から順に、広場の中のすべての位置を試す
    const spots = [];
    for (let y = sq0 + 1; y + fh - 1 <= py1 - 1; y++) for (let x = px0; x + fw - 1 <= px1; x++) spots.push([x, y, 1]);
    const far = (x) => Math.abs(x + fw / 2 - pc - 0.5);
    const edge = (x) => (x < px0 + 1 || x + fw - 1 > px1 - 1 ? 1 : 0);    // 広場の縁にかかる所は最後に
    spots.sort((a, b) => edge(a[0]) - edge(b[0]) || (a[1] - b[1]) * 2 - (far(a[0]) - far(b[0])) || (left ? a[0] - b[0] : b[0] - a[0]));
    placeFeature('flowerbed', null, spots, false);
    Object.assign(feature, keep);
  }
  // 井戸小屋がまん中に無ければ、花壇（あれば）か花の島をまん中に
  if (!wellAtCentre) {
    if (hasBed) { const [fw, fh] = propTiles('flowerbed', propArt); placeFeature('flowerbed', null, centreSpots(fw, fh), false); }
    else {
      const tx = pc - 1, ty = py1 - 1;
      if (tryProp('planter', tx, ty) | tryProp('planter', tx + 1, ty)) {
        tryProp('flowerpot', tx - 1, ty); tryProp('flowerpot', tx + 2, ty);
        Object.assign(feature, { x0: tx - 1, x1: tx + 2, y0: ty, y1: ty });
        ring(tx - 1, ty, tx + 2, ty);
      }
    }
  }
  // まん中の飾りに向いたベンチ（左右）
  if (feature.x1 >= feature.x0) {
    for (const [x, y] of [[feature.x0 - 3, feature.y1], [feature.x0 - 3, feature.y1 - 1]]) if (tryProp('bench', x, y)) break;
    for (const [x, y] of [[feature.x1 + 2, feature.y1], [feature.x1 + 2, feature.y1 - 1]]) if (tryProp('bench', x, y)) break;
  }
  // 掲示板: 段の下、階段の脇
  const sx = ht?.stair ? ht.stair.x : pc - 1, sw2 = ht?.stair ? ht.stair.w : 2;
  [[sx - 4, sq0], [sx + sw2 + 2, sq0], [px0 + 1, sq0 + 1], [px1 - 2, sq0 + 1], [pc - 1, py1 - 1]].find(([x, y]) => tryProp('noticeboard', x, y));
  // 角の植え込み: 大きい角には茂み、小さい角には花
  for (const [x, y, n] of plaza.cuts) tryProp(n >= 3 ? 'bush' : pick(['planter', 'flowerpot', 'bush']), x, y);
  // 縁: 樽と鉢（2行おき、出入りできる切れ目を残す）。南の縁の両わきに低い柵
  for (const [x, list] of [[px0, ['barrel', 'flowerpot', 'barrel', 'planter']], [px1, ['flowerpot', 'barrel', 'planter', 'barrel']]]) {
    let n = 0;
    for (let y = sq0 + 2; y <= py1 - 2; y += 2) if (rng() < 0.75) tryProp(list[n++ % list.length], x, y);
  }
  // 南の縁の両わき: 低い石垣（2マス）があればそれ、無ければ低い柵。
  // 広場の階段の上下2行は reserved 済みなので、段の壁・階段には重ならない。
  if (has('lowwall')) { for (const x of [px0 + 1, px1 - 2]) if (!tryProp('lowwall', x, py1)) { tryProp('fence', x, py1); tryProp('fence', x + 1, py1); } }
  else for (const x of [px0 + 1, px0 + 2, px1 - 2, px1 - 1]) tryProp('fence', x, py1);
  // 縁の街灯は2本だけ（基準 target-town.png の広場も、西と東の縁に1本ずつ）: 段の下の舞台の上の方、西と東の縁。
  // 多いと広場のほとんどが光だまりの明るさになる。階段の明かりは役場の扉の灯と、この2本の光だまりで足りる
  // 縁の列を上から順に（花壇・樽のまわりで立てられなければ、その下）、だめなら1マス内側
  const edgeLamp = (x, xi) => {
    const c = [];
    for (let y = sq0 + 1; y <= py1 - 1; y++) c.push([x, y]);
    for (let y = sq0 + 1; y <= py1 - 1; y++) c.push([xi, y]);
    return lampAt(c, 4);
  };
  edgeLamp(px0, px0 + 1);
  edgeLamp(px1, px1 - 1);
}
