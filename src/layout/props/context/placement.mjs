import { WATER } from '../../constants.mjs';
import { propTiles } from '../../manifest.mjs';
// 候補を従来の順で検査し、失敗時は仮の塞ぎを戻してから次の候補へ進む。
export function preparePropPlacement(C) {
  const { S, extra, id, has, propArt, walk, g, stairReserved, goalReserved, reserved, noTree,
    isPavedAt, locallySafe, blocked, flood, solidEdges, removable, removableConnected, lamps, props,
    findSolidEdges, physicalBefore } = C;
  const tryProp = (type, tx, ty, force = false, look, size, offsetX = 0) => {
    if (!has(look || type) && !['lamp', 'tree', 'bush', 'barrel', 'crate', 'fence', 'bench', 'noticeboard', 'sacks', 'flowerpot', 'planter', 'cart'].includes(type)) return false;
    const [fw, fh] = size || propTiles(look || type, propArt);
    const tiles = [];
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) tiles.push([tx + dx, ty + dy]);
    for (const [x, y] of tiles) if (!walk(x, y) || g[id(x, y)] === WATER || stairReserved[id(x, y)] || goalReserved[id(x, y)] || (reserved[id(x, y)] && !force) || (type === 'tree' && noTree[id(x, y)])) return false;
    const solid = findSolidEdges(type, tx, ty, fw, fh, offsetX, look, tiles, force);
    if (!solid) return false;
    const { occupied, edges } = solid;
    // 木の樹冠は足元の2行上までかかる: すぐ上に通り・路地・広場がある所には植えない（歩く人を隠さない）
    if (type === 'tree' && !force) for (let y = ty - 2; y < ty; y++) for (let x = tx - 1; x <= tx + 1; x++) if (isPavedAt(x, y)) return false;
    const physical = physicalBefore(occupied, edges);
    if (tiles.length === 1 && locallySafe(tx, ty)) blocked[id(tx, ty)] = 1;
    else {
      for (const [x, y] of tiles) blocked[id(x, y)] = 1;
      if (flood().count !== S.reach - tiles.length) { for (const [x, y] of tiles) blocked[id(x, y)] = 0; return false; }
    }
    const added = edges.filter((k) => !solidEdges[k]);
    for (const k of added) solidEdges[k] = 1;
    if (physical) {
      const covered = [...occupied].filter((k) => physical.seen[k]).length;
      if (flood(solidEdges).count !== physical.count - covered) {
        for (const [x, y] of tiles) blocked[id(x, y)] = 0;
        for (const k of added) solidEdges[k] = 0;
        return false;
      }
    }
    if (removable.size && !removableConnected()) {
      for (const [x, y] of tiles) blocked[id(x, y)] = 0;
      for (const k of added) solidEdges[k] = 0;
      return false;
    }
    if (extra.overlay && ['sign-passed', 'sign-failed', 'sign-unverified'].includes(type)) {
      for (const [x, y] of tiles) removable.add(id(x, y));
    }
    C.hasSolidEdges ||= added.length > 0;
    S.reach -= tiles.length;
    if (type === 'lamp') lamps.push([tx, ty]);
    props.push({ type, x: tx + fw / 2 + offsetX, y: ty + fh, ...(look ? { look } : {}), ...(size ? { w: fw } : {}) });
    return true;
  };
  C.tryProp = tryProp;
}
