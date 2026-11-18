// 建物の扉・床・塞ぎ・灯をまとめ、worldへの登録順を保つ。
import { TILE } from '../../config.js';
import { warnOnce } from '../../assets.js';

const T = TILE;

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
