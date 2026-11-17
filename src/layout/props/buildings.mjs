import { GRASS } from '../constants.mjs';
import { hash32 } from '../util.mjs';
import { propTiles } from '../manifest.mjs';

export function placeBuildingProps(S) {
  const { placed, has, propArt, id, g, tryProp, props, inC, hidden, isGrass, rng, pick, isPavedAt, reserved } = S;
  // 工事中（作業中の変更がある建物）: 横の壁に足場、そばに工事中の札、余地があれば材木
  for (const p of placed) {
    const dirty = p.spec.module?.works?.dirty || 0;
    if (!(dirty > 0)) continue;
    const scaf = ['scaffold', 'scaffold-2'].filter(has);
    if (!scaf.length) continue;
    const look = scaf[hash32(`scaf:${p.spec.id}`) % scaf.length];
    const [sw, sh] = propTiles(look, propArt);
    const sides = hash32(`side:${p.spec.id}`) % 2 ? [1, -1] : [-1, 1];
    let at = null;
    for (const side of sides) {
      const tx = side < 0 ? p.x - sw : p.x + p.w, ty = p.yb - sh + 1;
      let ok = true;
      for (let dy = 0; dy < sh && ok; dy++) for (let dx = 0; dx < sw && ok; dx++) { const k = id(tx + dx, ty + dy); if (g[k] !== GRASS) ok = false; }
      if (ok && tryProp('scaffold', tx, ty, false, look)) { at = { side, tx, sw }; break; }
    }
    if (at) props[props.length - 1].x += at.side < 0 ? p.wall[0] / 16 : -p.wall[1] / 16;    // 絵の壁にぴったり
    // 横が1マスしかあかないときは、細い足場をその1マスの真ん中に（足場の板は両側の壁にかかる）
    if (!at && has('scaffold')) {
      for (const side of sides) {
        const tx = side < 0 ? p.x - 1 : p.x + p.w;
        if (g[id(tx, p.yb)] === GRASS && tryProp('scaffold', tx, p.yb, false, 'scaffold', [1, 1])) {
          at = { side, tx, sw: 1 };
          props[props.length - 1].x += side < 0 ? p.wall[0] / 16 : -p.wall[1] / 16;
          break;
        }
      }
    }
    if (!at) continue;
    // 札と材木: 建物の横か手前（扉の前の2行の外）で、屋根や足場の陰にならない草地。札は足場の手前か反対側の壁ぎわ
    const far = at.side < 0 ? p.x + p.w : p.x - 1, out = at.side < 0 ? at.tx - 1 : at.tx + at.sw;
    const grassRun = (x, y, w) => { for (let dx = 0; dx < w; dx++) if (!inC(x + dx, y) || g[id(x + dx, y)] !== GRASS) return false; return true; };
    if (has('sign-works')) {
      const cands = [[at.tx + (at.side < 0 ? 0 : at.sw - 1), p.yb + 1], [far, p.yb + 1], [far, p.yb], [out, p.yb], [out, p.yb + 1], [far, p.yb - 1]];
      for (const [x, y] of cands) if (grassRun(x, y, 1) && !hidden(x, y) && tryProp('sign-works', x, y)) break;
    }
    if (has('lumber')) {
      const [lw] = propTiles('lumber', propArt);
      const fx = at.side < 0 ? far : far - lw + 1, ox = at.side < 0 ? at.tx - lw : at.tx + at.sw;
      const cands = [[ox, p.yb], [ox, p.yb + 1], [fx, p.yb], [fx, p.yb + 1], [at.side < 0 ? at.tx : at.tx + at.sw - lw, p.yb + 1], [ox, p.yb - 1], [fx, p.yb - 1]];
      for (const [x, y] of cands) if (grassRun(x, y, lw) && !hidden(x, y, lw) && tryProp('lumber', x, y)) break;
    }
  }

  // 道場の検査状態: 扉の前をふさがない脇に、状態を図形で示す札を1つだけ立てる。
  const statusProp = { passed: 'sign-passed', failed: 'sign-failed', unverified: 'sign-unverified' };
  for (const p of placed) {
    if (p.spec.facility?.archetype !== 'dojo') continue;
    const type = statusProp[p.spec.facility.facts?.state];
    if (!type || !has(type)) continue;
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    const left = hash32(`dojo-sign:${p.spec.id}`) % 2 === 0;
    const sides = left ? [-1, 1] : [1, -1];
    const candidates = [];
    for (const side of sides) {
      const x = side < 0 ? p.x - 1 : p.x + p.w;
      candidates.push([x, p.yb + 1], [x, p.yb], [x, p.yb - 1]);
    }
    // 版の扉の左右2マスの外側も試す。扉の列とその前の通りは reserved のままにする。
    candidates.push([dc - 3, p.yb + 1], [dc + 4, p.yb + 1], [dc - 3, p.yb], [dc + 4, p.yb]);
    for (const [x, y] of candidates) if (tryProp(type, x, y)) break;
  }

  // 建物の足もと: 横の壁ぎわ（下の1〜2段）に、その建物らしい小物のかたまり（扉の前の2行はあける）
  const FEET = {
    workshop: ['crate', 'barrel', 'sacks', 'crate', 'barrel'],
    shop: ['barrel', 'crate', 'sacks', 'flowerpot', 'planter', 'barrel'],
    ruin: ['crate', 'bush', 'sacks', 'bush'],
    house: ['planter', 'flowerpot', 'barrel', 'sacks', 'flowerpot', 'crate'],
    facility: ['barrel', 'crate', 'sacks', 'planter', 'barrel'],
  };
  for (const p of placed) {
    const list = FEET[p.spec.facility ? 'facility' : p.spec.module.kind] || FEET.house;
    for (const side of hash32(`feet:${p.spec.id}`) % 2 ? [-1, 1] : [1, -1]) {
      const x = side < 0 ? p.x - 1 : p.x + p.w;
      for (const [dy, prob] of [[0, 0.85], [-1, 0.5], [-2, 0.2]]) {
        if (isGrass(x, p.yb + dy) && rng() < prob) tryProp(pick(list), x, p.yb + dy);
      }
    }
  }

  // 前庭の舗装: 扉の列は空け、左右の2行目以降に店先・工房先の小物を寄せる。
  // gap=0 の壁面でも、前面の舗装は建物ごとに独立して置ける。
  const FRONT = {
    workshop: ['crate', 'barrel', 'sacks', 'crate', 'barrel'],
    shop: ['barrel', 'crate', 'flowerpot', 'planter', 'sacks'],
    ruin: ['bush', 'crate', 'sacks', 'bush'],
    house: ['planter', 'flowerpot', 'barrel', 'sacks', 'crate'],
    facility: ['barrel', 'crate', 'sacks', 'planter'],
  };
  for (const p of placed) {
    const list = FRONT[p.spec.facility ? 'facility' : p.spec.module.kind] || FRONT.house;
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    const candidates = [];
    for (let k = 0; k < p.w; k++) {
      const x = p.x + k;
      for (let y = p.yb + 2; y < p.sd[k]; y++) {
        if (x === dc || !isPavedAt(x, y) || reserved[id(x, y)]) continue;
        candidates.push([hash32(`front:${p.spec.id}:${x},${y}`), x, y]);
      }
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const limit = p.spec.facility ? 2 : p.spec.archetype === 'shop' ? 4 : 3;
    let got = 0;
    for (const [, x, y] of candidates) {
      if (got >= limit) break;
      if (rng() < 0.72 && tryProp(pick(list), x, y)) got++;
    }
  }
}
