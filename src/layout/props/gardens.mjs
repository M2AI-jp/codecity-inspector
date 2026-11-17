import { DIRT, GRASS, OUT, STREET, WATER } from '../constants.mjs';
import { hash32 } from '../util.mjs';

export function placeGardenProps(S) {
  const { id, N, foot, placed, pick, tryProp, cols, g, isGrass, rng, crop, roofZ, reserved, noTree, garden, gap, inside, dist, P, inC, lampAt } = S;
  // 生活の小物: 近くの建物の種類に合わせて選ぶ。続けて置きやすくして、かたまりにする
  const CLUTTER = {
    workshop: ['crate', 'barrel', 'sacks', 'crate', 'cart', 'barrel'],
    shop: ['barrel', 'crate', 'sacks', 'flowerpot', 'planter'],
    ruin: ['bush', 'crate', 'bush', 'sacks'],
    house: ['planter', 'flowerpot', 'barrel', 'bush', 'sacks', 'bench', 'crate'],
    facility: ['barrel', 'crate', 'sacks', 'planter'],
  };
  const kindNear = (x, y) => {
    for (let d = 0; d <= 5; d++) for (const [dx, dy] of [[0, d], [-1, d], [1, d], [0, -d]]) {
      const t = id(x + dx, y + dy);
      if (t >= 0 && t < N && foot[t] >= 0) { const s = placed[foot[t]].spec; return s.facility ? 'facility' : s.module.kind; }
    }
    return 'house';
  };
  const clutter = (x, y, kind) => {
    const list = CLUTTER[kind] || CLUTTER.house;
    const type = pick(list);
    return tryProp(type, x, y) || tryProp(list[0], x, y);
  };
  const nearPathAt = (t) => { for (const n of [t - 1, t + 1, t - cols, t + cols]) if (g[n] !== GRASS && g[n] !== OUT && g[n] !== WATER) return true; return false; };

  // 木はかたまりで: 裏庭・広い隙間・小さな緑地・街のきわに、2〜5本の木と根もとの茂み
  const TOFF = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 1], [2, 1], [1, -1], [-1, 0], [2, 0], [0, 2]];
  const clusterAt = (x, y, n) => {
    let got = 0;
    for (const [dx, dy] of TOFF) { if (got >= n) break; if (isGrass(x + dx, y + dy) && !nearPathAt(id(x + dx, y + dy)) && tryProp('tree', x + dx, y + dy)) got++; }
    if (got) for (const [dx, dy] of [[-1, 2], [2, 2], [1, 2], [-2, 1], [3, 1]]) if (rng() < 0.45 && isGrass(x + dx, y + dy)) tryProp('bush', x + dx, y + dy);
    return got;
  };
  const seeds = [];
  const farFromSeeds = (x, y, r) => !seeds.some(([a, b]) => Math.max(Math.abs(a - x), Math.abs(b - y)) < r);
  const order = [];
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (g[t] !== GRASS || foot[t] >= 0 || roofZ[t] || reserved[t] || noTree[t]) continue;
    const where = garden[t] ? 0 : gap[t] ? 1 : inside[t] ? 2 : dist[t] <= 3 ? 3 : -1;
    if (where < 0) continue;
    order.push([hash32(`tc:${x},${y}`), x, y, where]);
  }
  order.sort((a, b) => a[0] - b[0]);
  for (const [, x, y, where] of order) {
    const r = where === 0 ? 5 : where === 1 ? 4 : where === 2 ? 6 : 5;
    if (!farFromSeeds(x, y, r)) continue;
    const n = where === 1 ? 1 + Math.floor(rng() * 2) : where === 3 ? 3 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 3);
    if (clusterAt(x, y, n)) seeds.push([x, y]);
  }

  // 小さな緑地: ベンチと街灯（木はかたまりで植えてある）
  for (const L of P.leaves) {
    if (!L.green || !inC(L.x0, L.y1) || g[id(L.x0, L.y1)] === OUT) continue;
    const cxL = L.x0 + Math.floor((L.x1 - L.x0 + 1) / 2);
    tryProp('bench', cxL - 1, L.y1) || tryProp('bench', cxL, L.y1 - 1);
    lampAt([[L.x0, L.y1], [L.x1, L.y1]], 14);
    for (const [x, y] of [[L.x1 - 1, L.y1], [L.x0 + 2, L.y1 - 1]]) tryProp(pick(['bush', 'planter', 'flowerpot', 'bush']), x, y);
  }

  // 建物の間の隙間: 通りぎわに樽・木箱・鉢、奥に茂み
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (!gap[t] || g[t] !== GRASS) continue;
    const r = rng();
    const nb = foot[t - 1] >= 0 ? foot[t - 1] : foot[t + 1];
    const kind = nb >= 0 ? (placed[nb].spec.facility ? 'facility' : placed[nb].spec.module.kind) : 'house';
    const frontRow = g[t + cols] !== GRASS && g[t + cols] !== OUT && !gap[t + cols];
    if (frontRow && r < 0.5) clutter(x, y, kind);
    else if (!frontRow && r < 0.25) { if (r < 0.12) tryProp('bush', x, y); else clutter(x, y, kind); }
  }
  // 家の裏の庭: 通りぎわに柵（ところどころ切れ目）、中は生活の小物のかたまりと茂み
  let run = 0, gapAt = 4, chain = 0;
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (!garden[t] || g[t] !== GRASS) { run = 0; chain = 0; continue; }
    const r = rng();
    const edge = g[t - cols] === STREET || g[t - cols] === DIRT;
    if (edge) {
      // 柵は続けて立て、数マスおきに1マスの切れ目（木戸）を残す。切れ目のあとは数え直す
      run++;
      if (run > gapAt) { run = 0; gapAt = 4 + Math.floor(rng() * 5); continue; }
      tryProp('fence', x, y);
    } else if (chain > 0 && r < 0.5) { chain = clutter(x, y, kindNear(x, y)) ? chain - 1 : 0; }
    else if (r < 0.1) { tryProp(rng() < 0.5 ? 'bush' : 'planter', x, y); chain = 0; }
    else if (r < 0.2) chain = clutter(x, y, kindNear(x, y)) ? 1 + Math.floor(rng() * 2) : 0;
    else chain = 0;
  }
  // 残りの草地: 街の内側の空き地は木立ち、建物の近くは茂みと花、外側は森（道のすぐ脇は空ける）
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if (g[t] !== GRASS || foot[t] >= 0 || garden[t] || gap[t] || roofZ[t] || reserved[t]) continue;
    const nearPath = nearPathAt(t);
    const r = rng();
    if (inside[t]) {
      let nearFoot = false;
      for (let dy = -3; dy <= 3 && !nearFoot; dy++) for (let dx = -3; dx <= 3; dx++) if (inC(x + dx, y + dy) && foot[id(x + dx, y + dy)] >= 0) { nearFoot = true; break; }
      if (!nearFoot) {
        if (nearPath) { if (r < 0.1) tryProp('bush', x, y); continue; }
        const lattice = y % 2 === 0 && (x + (y >> 1)) % 2 === 0;
        if (lattice ? r < 0.8 : r < 0.12) tryProp(lattice ? 'tree' : 'bush', x, y);
        continue;
      }
      if (!nearPath && r < 0.08) tryProp(pick(['bush', 'planter', 'flowerpot', 'bush']), x, y);
      continue;
    }
    // 街の外まわり: 道のすぐ脇は空け、その外は茂みの生け垣と木、さらに外は木の詰まった森（ずらした格子で樹冠がつながる）
    if (nearPath) continue;
    const shore = g[t + cols] === WATER || g[t + 2 * cols] === WATER;
    const d = dist[t];
    if (d <= 2) {
      if (r < (shore ? 0.15 : 0.3)) tryProp('tree', x, y);
      else if (r < 0.62) tryProp('bush', x, y);
      continue;
    }
    const lattice = y % 2 === 0 && (x + (y >> 1)) % 2 === 0;
    if (lattice ? r < (shore ? 0.5 : 0.9) : r < 0.16) tryProp(lattice || r < 0.06 ? 'tree' : 'bush', x, y);
  }
}
