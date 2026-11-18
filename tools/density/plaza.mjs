// 入口の辺を除いた広場の外周と、建物・段が面する長さ。
export function plazaEdgeOf(town) {
  const { cols, rows, ground } = town;
  const plaza = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (ground[y]?.[x] === '+') plaza.push([x, y]);
  if (!plaza.length) return '0/0 (0.0%, 入口不明)';
  const x0 = Math.min(...plaza.map(([x]) => x)), x1 = Math.max(...plaza.map(([x]) => x));
  const y0 = Math.min(...plaza.map(([, y]) => y)), y1 = Math.max(...plaza.map(([, y]) => y));
  const edges = [
    { name: '北', cells: Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y0 - 1]), step: [0, -1] },
    { name: '南', cells: Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y1 + 1]), step: [0, 1] },
    { name: '西', cells: Array.from({ length: y1 - y0 + 1 }, (_, i) => [x0 - 1, y0 + i]), step: [-1, 0] },
    { name: '東', cells: Array.from({ length: y1 - y0 + 1 }, (_, i) => [x1 + 1, y0 + i]), step: [1, 0] },
  ];
  const paved = (x, y) => '#:+'.includes(ground[y]?.[x] ?? ' ');
  const building = (x, y) => town.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  const terrace = (x, y) => (town.terraces || []).some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
  const roadCount = (e) => e.cells.reduce((n, [x, y]) => n + (paved(x, y) ? 1 : 0), 0);
  const entry = [...edges].sort((a, b) => roadCount(b) - roadCount(a) || (b.name === '南') - (a.name === '南'))[0];
  let contact = 0, total = 0;
  for (const e of edges) {
    if (e === entry) continue;
    for (const [x, y] of e.cells) {
      total++;
      let touches = building(x, y) || terrace(x, y);
      for (let dx = -1; dx <= 1 && !touches; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (building(x + dx, y + dy) || terrace(x + dx, y + dy)) { touches = true; break; }
      }
      if (touches) contact++;
    }
  }
  return `${contact}/${total} (${(100 * contact / Math.max(1, total)).toFixed(1)}%, 入口${entry.name})`;
}
