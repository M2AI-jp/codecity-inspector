export function checkOccupancy(town, { deckTiles, propTilesOf, coverOf }, problems) {
  const { cols, rows } = town;
  const foot = new Int32Array(cols * rows).fill(-1);
  const blocked = new Uint8Array(cols * rows);
  if (town.ground.length !== rows || town.ground.some((r) => r.length !== cols)) problems.push('ground の大きさが cols×rows と合わない');
  town.buildings.forEach((b, i) => {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) { problems.push(`${b.id} が範囲外`); continue; }
      if (foot[y * cols + x] >= 0) problems.push(`${b.id} と ${town.buildings[foot[y * cols + x]].id} が重なる`);
      foot[y * cols + x] = i;
    }
  });
  for (const b of town.buildings) {
    if (b.door.y !== b.y + b.h - 1 || b.door.x < b.x || b.door.x >= b.x + b.w) problems.push(`${b.id} の扉が下辺に無い`);
    const cover = coverOf(b);
    for (let dx = 0; dx < b.w; dx++) for (let y = b.y - (cover?.[dx] ?? 2); y < b.y; y++) {
      const x = b.x + dx;
      const o = foot[y * cols + x];
      if (y >= 0 && o >= 0 && town.buildings[o] !== b) problems.push(`${b.id} の屋根の余白に ${town.buildings[o].id}`);
    }
  }
  const seenProp = new Set();
  const deckT = new Uint8Array(cols * rows);
  for (const p of town.props) {
    const deck = !!deckTiles(p);
    for (const [x, y] of propTilesOf(p)) {
      const t = y * cols + x;
      if (x < 0 || y < 0 || x >= cols || y >= rows) { problems.push(`小物 ${p.type} (${x},${y}) が範囲外`); continue; }
      if (foot[t] >= 0) problems.push(`小物 ${p.type} (${x},${y}) が建物の上`);
      if (seenProp.has(t)) problems.push(`小物 (${x},${y}) が重なる`);
      if (town.ground[y]?.[x] === ' ' || town.ground[y]?.[x] === undefined) problems.push(`小物 ${p.type} (${x},${y}) が街の外`);
      if (deck) { if (town.ground[y][x] === '~') deckT[t] = 1; continue; }     // 桟橋の板は歩ける（水の上）
      if (town.ground[y]?.[x] === '~' && p.type !== 'boat' && p.type !== 'canal-mouth') problems.push(`小物 ${p.type} (${x},${y}) が水の上`);
      seenProp.add(t);
      blocked[t] = 1;
    }
  }
  for (const l of town.landmarks || []) {
    if (!l.keeper) { problems.push(`${l.id} に番人の立つ所が無い`); continue; }
    const kx = Math.floor(l.keeper.x), ky = Math.floor(l.keeper.y - 0.01), t = ky * cols + kx;
    if (!'.#:+'.includes(town.ground[ky]?.[kx] ?? ' ') || foot[t] >= 0 || blocked[t]) problems.push(`${l.id} の番人 (${kx},${ky}) が歩けない所に立つ`);
    if (!town.props.some((p) => p.type === l.prop && Math.abs(p.x - l.x) < 0.01 && Math.abs(p.y - l.y) < 0.01)) problems.push(`${l.id} の ${l.prop} が props に無い`);
  }
  return { foot, blocked, deckT };
}
