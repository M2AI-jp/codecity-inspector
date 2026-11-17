// Some explicit seeds/groups leave a single dirt tile beside the canal after
// lawn finishing. It is not connected to a street; restore grass at that tile.
// Both materials have the same walkable surface. Do not alter roads, bridges,
// water, entrances, or the no-overlay layout.
export function overlayGround(town) {
  if (!town.canal?.cells?.length) return town.ground;
  const changes = new Set();
  const neighbours = (x, y) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
  for (const [x, y] of town.canal.cells) for (const [nx, ny] of neighbours(x, y)) {
    if (town.ground[ny]?.[nx] !== ':') continue;
    if (neighbours(nx, ny).some(([px, py]) => '#:+'.includes(town.ground[py]?.[px] || ' '))) continue;
    if (town.buildings.some((b) => nx >= b.x && nx < b.x + b.w && ny >= b.y && ny <= b.y + b.h)) continue;
    if ((town.canal.crossings || []).some((c) => Math.abs(c.x - nx) + Math.abs(c.y - ny) <= 3)) continue;
    changes.add(ny * town.cols + nx);
  }
  if (!changes.size) return town.ground;
  return town.ground.map((row, y) => [...row].map((ch, x) => changes.has(y * town.cols + x) ? '.' : ch).join(''));
}
