import { DIRT, GRASS, STREET } from '../constants.mjs';

export function prepareCrossings(S) {
  const { decode, allStates, laneCells, cellSet, id, canalCells, paved, roadDirAt, cols, road, pieces, original, inG, foot, buildingWalkRow, front, plazaM, terraceMask, g } = S;
  const bridgeCells = new Set(), bridgeDeckCells = new Set();
  const bridgeProps = [];
  const mouthProps = [];
  const firstState = decode(allStates[0]);
  const firstLane = laneCells(firstState.x, firstState.y, firstState.d).filter(([x, y]) => cellSet.has(id(x, y)));
  if (firstLane.length === 2) {
    const xs = firstLane.map(([x]) => x), ys = firstLane.map(([, y]) => y);
    const mouthTileX = firstState.d % 2 ? Math.min(...xs) : firstState.x;
    const mouthTileY = Math.min(...ys);
    // 始点の最初の水セルに石の口を重ねる。橋の位置は
    // 交差する道路の幅に合わせて決まるため、口を先へずらさない。
    const mouthX = mouthTileX + 1;
    const mouthY = mouthTileY + 1;
    mouthProps.push({ type: 'canal-mouth', x: mouthX, y: mouthY, look: 'canal-mouth' });
  }
  const crossings = [];
  // 1本の橋の deck は流れ方向に2マスを覆う。水路の同じ向きの
  // 交差部が近いと、前庭や dense frontage まで舗装として拾って橋が
  // 縦に重なるため、交差前にその部分だけ草地へ戻す。
  const initialRoadWater = new Set(canalCells.filter(([x, y]) => paved(id(x, y))).map(([x, y]) => id(x, y)));
  const initialRoadDir = new Map(canalCells.map(([x, y]) => [id(x, y), roadDirAt(x, y)]));
  const initialComponents = [];
  const initialSeen = new Set();
  for (const start of initialRoadWater) {
    if (initialSeen.has(start)) continue;
    const dir = initialRoadDir.get(start);
    if (!dir) continue;
    const component = [], q = [start];
    initialSeen.add(start);
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % cols, y = (k / cols) | 0;
      component.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = id(nx, ny);
        if (initialRoadWater.has(nk) && initialRoadDir.get(nk) === dir && !initialSeen.has(nk)) {
          initialSeen.add(nk);
          q.push(nk);
        }
      }
    }
    const xs = component.map(([x]) => x), ys = component.map(([, y]) => y);
    initialComponents.push({
      cells: component, dir,
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
      soft: component.every(([x, y]) => {
        const r = road[id(x, y)];
        return r < 0 || pieces[r]?.kind === 'dense';
      }),
    });
  }
  const axisRange = (c) => c.dir === 'h' ? [c.minY, c.maxY] : [c.minX, c.maxX];
  const axisGap = (a, b) => {
    const [a0, a1] = axisRange(a), [b0, b1] = axisRange(b);
    return a1 < b0 ? b0 - a1 - 1 : b1 < a0 ? a0 - b1 - 1 : 0;
  };
  const clearCrossingCell = (x, y, dir) => {
    const k = id(x, y);
    original[k] = GRASS;
    const sides = dir === 'h' ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
    for (const [nx, ny] of sides) {
      if (!inG(nx, ny)) continue;
      const nk = id(nx, ny);
      if (foot[nk] >= 0 || buildingWalkRow[nk] || front[nk] || plazaM[nk] || terraceMask[nk]) continue;
      if (original[nk] === STREET || original[nk] === DIRT) g[nk] = GRASS;
    }
  };
  const keptComponents = [];
  initialComponents
    .sort((a, b) => (a.dir === b.dir ? axisRange(a)[0] - axisRange(b)[0] : a.dir.localeCompare(b.dir)))
    .forEach((c) => {
      const nearbyNormal = initialComponents.some((q) => q !== c && q.dir === c.dir && !q.soft && axisGap(c, q) <= 2);
      const nearbyKept = keptComponents.some((q) => q.dir === c.dir && axisGap(c, q) <= 2);
      if ((c.soft && nearbyNormal) || nearbyKept) {
        for (const [x, y] of c.cells) clearCrossingCell(x, y, c.dir);
        return;
      }
      const [a0, a1] = axisRange(c);
      if (a1 - a0 + 1 > 2) {
        const keep0 = c.dir === 'h' ? Math.floor((a0 + a1) / 2) : a0;
        const keep1 = keep0 + 1;
        for (const [x, y] of c.cells) {
          const axis = c.dir === 'h' ? y : x;
          if (axis < keep0 || axis > keep1) clearCrossingCell(x, y, c.dir);
        }
      }
      keptComponents.push(c);
    });
  Object.assign(S, { bridgeCells, bridgeDeckCells, bridgeProps, mouthProps, firstState, crossings });
}
