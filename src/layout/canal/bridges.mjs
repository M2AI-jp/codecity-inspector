import { OUT, WATER } from '../constants.mjs';

export function placeBridges(S) {
  const { canalCells, paved, id, roadDirAt, propArt, bridgeDeckCells, inC, bridgeCells, cols, foot, original, bridgeProps, crossings } = S;
  const roadWater = new Set(canalCells.filter(([x, y]) => paved(id(x, y))).map(([x, y]) => id(x, y)));
  const waterRoadDir = new Map(canalCells.map(([x, y]) => [id(x, y), roadDirAt(x, y)]));
  const crossed = new Set();
  const deckBounds = (type, px, py) => {
    const d = propArt[type].deck;
    return {
      x0: Math.floor((px * 16 + d[0]) / 16),
      y0: Math.floor((py * 16 + d[1]) / 16),
      x1: Math.floor((px * 16 + d[0] + d[2] - 0.001) / 16),
      y1: Math.floor((py * 16 + d[1] + d[3] - 0.001) / 16),
    };
  };
  const deckCells = bridgeDeckCells;
  const addDeckTiles = (type, px, py) => {
    const { x0, y0, x1, y1 } = deckBounds(type, px, py);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inC(x, y)) {
      bridgeCells.add(id(x, y));
      bridgeDeckCells.add(id(x, y));
    }
    // 橋の板の両端に接する道路マスも予約する。ここへ街灯や樽を置くと、
    // 橋の上へ歩き出す最初の一歩を小物が塞いでしまう。
    if (type === 'bridge-h') {
      for (let y = y0; y <= y1; y++) for (const x of [x0 - 1, x1 + 1]) if (inC(x, y)) bridgeCells.add(id(x, y));
    } else if (type === 'bridge-v') {
      for (let x = x0; x <= x1; x++) for (const y of [y0 - 1, y1 + 1]) if (inC(x, y)) bridgeCells.add(id(x, y));
    }
  };
  for (const start of roadWater) {
    if (crossed.has(start)) continue;
    const dir = waterRoadDir.get(start);
    if (!dir) continue;
    const component = [], q = [start];
    crossed.add(start);
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % cols, y = (k / cols) | 0;
      component.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = id(nx, ny);
        if (roadWater.has(nk) && waterRoadDir.get(nk) === dir && !crossed.has(nk)) { crossed.add(nk); q.push(nk); }
      }
    }
    const xs = component.map(([x]) => x), ys = component.map(([, y]) => y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    if (dir === 'h') {
      const cx = (minX + maxX + 1) / 2;
      // bridge-h の deck は、水幅2マスと東西の通り1マスずつを覆う。
      // 絵の南側のアーチ面は deck の外側に置き、北側の水へはみ出させない。
      const py = (maxY - minY + 1) <= 2 ? maxY + 1 : Math.floor((minY + maxY) / 2) + 2;
      const bridgeX = (px) => {
        const b = deckBounds('bridge-h', px, py);
        const cy = Math.floor((b.y0 + b.y1) / 2);
        const inDeck = cx >= b.x0 && cx <= b.x1 &&
          canalCells.some(([x, y]) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
        const roadEnds = paved(id(b.x0, cy)) && paved(id(b.x1, cy));
        const clearSide = [b.x0 - 1, b.x1 + 1].every((x) =>
          inC(x, b.y0) && inC(x, b.y1) &&
          Array.from({ length: b.y1 - b.y0 + 1 }, (_, i) => id(x, b.y0 + i))
            .every((k) => foot[k] < 0 && original[k] !== OUT && original[k] !== WATER));
        return inDeck && roadEnds && clearSide;
      };
      const px = [0, -1, 1, -2, 2, -3, 3]
        .map((dx) => cx + dx)
        .find(bridgeX) ?? cx;
      bridgeProps.push({ type: 'bridge-h', x: px, y: py, look: 'bridge-h' });
      addDeckTiles('bridge-h', px, py);
      const deck = deckBounds('bridge-h', px, py);
      crossings.push({
        x: Math.floor(cx),
        y: Math.floor((deck.y0 + deck.y1) / 2),
        road: 'h',
        bridge: 'bridge-h',
      });
    } else if (dir === 'v') {
      const cx = (minX + maxX) / 2, cy = (minY + maxY + 1) / 2;
      // bridge-v も同じく、南北の通りの両端を deck に含める。
      const px = minX + 1, py = cy + 2.5;
      bridgeProps.push({ type: 'bridge-v', x: px, y: py, look: 'bridge-v' });
      addDeckTiles('bridge-v', px, py);
      const deck = deckBounds('bridge-v', px, py);
      crossings.push({
        x: Math.floor((deck.x0 + deck.x1) / 2),
        y: Math.round((deck.y0 + deck.y1) / 2),
        road: 'v',
        bridge: 'bridge-v',
      });
    }
  }
  Object.assign(S, { deckBounds, deckCells, addDeckTiles });
}
