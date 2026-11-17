export function stampOverlay(grid, overlay) {
  const stamp = (p, symbol) => {
    const x = Math.floor(p.x), y = Math.floor(p.y - .001);
    if (grid[y]?.[x] !== undefined) grid[y][x] = symbol;
  };
  for (const p of overlay?.people || []) stamp(p, 'p');
  for (const m of overlay?.markers || []) if (m.keeper) stamp(m.keeper, 'k');
  if (overlay?.goal) stamp(overlay.goal, '◎');
}
