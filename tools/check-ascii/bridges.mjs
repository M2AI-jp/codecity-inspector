export function checkBridges(town, canal, canalSet, { deckTiles, propTilesOf }, problems) {
  const crossings = town.canal.crossings || [];
  const roadAt = (x, y) => {
    const ch = town.ground[y]?.[x];
    return ch === '#' || ch === ':';
  };
  const nearCrossing = (x, y) => crossings.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) <= 2);
  const canalHas = (x, y) => canalSet.has(`${x},${y}`);
  const bridgeProps = town.props.filter((p) => p.type === 'bridge-h' || p.type === 'bridge-v');
  const bridgeDeckSets = bridgeProps.map((p) => new Set((deckTiles(p) || propTilesOf(p)).map(([x, y]) => `${x},${y}`)));
  for (let i = 0; i < bridgeProps.length; i++) {
    for (let j = i + 1; j < bridgeProps.length; j++) {
      let adjacent = false;
      for (const key of bridgeDeckSets[i]) {
        const [x, y] = key.split(',').map(Number);
        if (bridgeDeckSets[j].has(key) ||
          bridgeDeckSets[j].has(`${x - 1},${y}`) || bridgeDeckSets[j].has(`${x + 1},${y}`) ||
          bridgeDeckSets[j].has(`${x},${y - 1}`) || bridgeDeckSets[j].has(`${x},${y + 1}`)) {
          adjacent = true;
          break;
        }
      }
      if (adjacent) {
        const a = bridgeProps[i], b = bridgeProps[j];
        problems.push(`橋 ${a.type} (${a.x},${a.y}) と ${b.type} (${b.x},${b.y}) の deck が縦横に隣り合う`);
      }
    }
  }
  const bridgeDecks = bridgeProps.flatMap((p) => deckTiles(p) || []);
  const bridgeDeckSet = new Set(bridgeDecks.map(([x, y]) => `${x},${y}`));
  const roadTurnAt = (x, y) => {
    const at = (xx, yy) => roadAt(xx, yy) && !bridgeDeckSet.has(`${xx},${yy}`);
    if (!at(x, y)) return false;
    const h = at(x - 1, y) || at(x + 1, y);
    const v = at(x, y - 1) || at(x, y + 1);
    return h && v;
  };
  for (const [x, y] of canal) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (roadAt(nx, ny) && !nearCrossing(x, y)) problems.push(`水路 (${x},${y}) が通り・路地の脇を流れる`);
    }
  }
  for (const c of crossings) {
    const expected = c.road === 'h' ? 'bridge-h' : c.road === 'v' ? 'bridge-v' : null;
    if (expected && c.bridge !== expected) problems.push(`交差点 (${c.x},${c.y}) の橋 ${c.bridge} が ${expected} でない`);
    const bridge = town.props.find((p) => p.type === c.bridge && (deckTiles(p) || []).some(([x, y]) => x === c.x && y === c.y));
    if (!bridge) {
      problems.push(`水路の交差点 (${c.x},${c.y}) に ${c.bridge} が無い`);
      continue;
    }
    const deck = deckTiles(bridge) || [];
    const deckSet = new Set(deck.map(([x, y]) => `${x},${y}`));
    if (c.bridge === 'bridge-h' && ![...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return x === c.x && canalHas(x, y - 1); })
      && ![...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return x === c.x && canalHas(x, y + 1); })) {
      problems.push(`bridge-h (${c.x},${c.y}) が南北の水路をまたいでいない`);
    }
    if (c.bridge === 'bridge-v' && ![...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return y === c.y && canalHas(x - 1, y); })
      && ![...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return y === c.y && canalHas(x + 1, y); })) {
      problems.push(`bridge-v (${c.x},${c.y}) が東西の水路をまたいでいない`);
    }
    const minX = Math.min(...deck.map(([x]) => x)), maxX = Math.max(...deck.map(([x]) => x));
    const minY = Math.min(...deck.map(([, y]) => y)), maxY = Math.max(...deck.map(([, y]) => y));
    if (deck.some(([x, y]) => !['~', '#', ':'].includes(town.ground[y]?.[x] ?? ' '))) {
      problems.push(`${c.bridge} (${c.x},${c.y}) の deck が草地・街の外にかかる`);
    }
    if (c.bridge === 'bridge-h' && (!roadAt(minX, c.y) || !roadAt(maxX, c.y))) problems.push(`bridge-h (${c.x},${c.y}) の両端が通りに乗らない`);
    if (c.bridge === 'bridge-v' && (!roadAt(c.x, minY) || !roadAt(c.x, maxY))) problems.push(`bridge-v (${c.x},${c.y}) の両端が通りに乗らない`);
    if ([...deckSet].some((k) => { const [x, y] = k.split(',').map(Number); return roadTurnAt(x, y) && Math.abs(x - c.x) + Math.abs(y - c.y) <= 2; })) {
      problems.push(`交差点 (${c.x},${c.y}) が曲がり角から2マス以内`);
    }
  }
  const mouth = town.props.find((p) => p.type === 'canal-mouth'
    && propTilesOf(p).some(([x, y]) => canalHas(x, y))
    && !propTilesOf(p).some(([x, y]) => bridgeDeckSet.has(`${x},${y}`)));
  if (!mouth) problems.push('水路の始点に広場の縁の水路口が無い');
  return { crossings, canalHas };
}
