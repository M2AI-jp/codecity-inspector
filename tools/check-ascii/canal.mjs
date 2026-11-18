import { checkBridges } from './bridges.mjs';
import { checkWaterfront } from './waterfront.mjs';

export function checkCanal(town, { foot, faceCells, stairAt, deckTiles, propTilesOf }, problems) {
  const { cols, rows } = town;
  let waterLandStripCount = 0;
  if (town.canal) {
    const canal = Array.isArray(town.canal.cells) ? town.canal.cells : [];
    const canalSet = new Set();
    const plazaSeen = new Set();
    const canalSpawn = town.spawn;
    const startKey = `${canalSpawn.x},${canalSpawn.y}`;
    if (town.ground[canalSpawn.y]?.[canalSpawn.x] === '+') {
      const q0 = [[canalSpawn.x, canalSpawn.y]]; plazaSeen.add(startKey);
      for (let h = 0; h < q0.length; h++) {
        const [x, y] = q0[h];
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const key = `${nx},${ny}`;
          if (!plazaSeen.has(key) && town.ground[ny]?.[nx] === '+') { plazaSeen.add(key); q0.push([nx, ny]); }
        }
      }
    }
    const plazaCells = [...plazaSeen].map((k) => k.split(',').map(Number));
    const px0 = plazaCells.length ? Math.min(...plazaCells.map(([x]) => x)) : Infinity;
    const px1 = plazaCells.length ? Math.max(...plazaCells.map(([x]) => x)) : -Infinity;
    const py0 = plazaCells.length ? Math.min(...plazaCells.map(([, y]) => y)) : Infinity;
    const py1 = plazaCells.length ? Math.max(...plazaCells.map(([, y]) => y)) : -Infinity;
    for (const [x, y] of canal) {
      const key = `${x},${y}`, k = y * cols + x;
      if (canalSet.has(key)) problems.push(`水路 (${x},${y}) が重なる`);
      canalSet.add(key);
      if (x < 0 || y < 0 || x >= cols || y >= rows) { problems.push(`水路 (${x},${y}) が範囲外`); continue; }
      if (town.ground[y][x] !== '~') problems.push(`水路 (${x},${y}) が ground の ~ でない`);
      if (foot[k] >= 0) problems.push(`水路 (${x},${y}) が建物に重なる`);
      if (x >= px0 && x <= px1 && y >= py0 && y <= py1) problems.push(`水路 (${x},${y}) が広場に重なる`);
      if (stairAt.has(key) || faceCells.some(([fx, fy]) => fx === x && fy === y)) problems.push(`水路 (${x},${y}) が段・階段に重なる`);
      for (const b of town.buildings) {
        if (x === b.door.x && y > b.door.y && y <= b.door.y + 2) problems.push(`水路 (${x},${y}) が ${b.id} の扉前に重なる`);
      }
    }
    if (canal.length) {
      const seenCanal = new Set([`${canal[0][0]},${canal[0][1]}`]), cq = [canal[0]];
      for (let h = 0; h < cq.length; h++) {
        const [x, y] = cq[h];
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const key = `${nx},${ny}`;
          if (canalSet.has(key) && !seenCanal.has(key)) { seenCanal.add(key); cq.push([nx, ny]); }
        }
      }
      if (seenCanal.size !== canalSet.size) problems.push('水路のセルが一続きでない');
    }
    const { crossings, canalHas } = checkBridges(town, canal, canalSet, { deckTiles, propTilesOf }, problems);
    waterLandStripCount = checkWaterfront(town, canal, canalHas, problems);
    const bridgeCount = town.props.filter((p) => p.type === 'bridge-h' || p.type === 'bridge-v').length;
    if (bridgeCount !== crossings.length) problems.push(`水路の交差点 ${crossings.length} 件と橋 ${bridgeCount} 件が一致しない`);
  }
  return waterLandStripCount;
}
