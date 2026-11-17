// 生き物が立てて、屋根や木に隠れない街の格子。
const WALKABLE = new Set(['.', ':', '#', '+']);

function townGrid(town) {
  const { cols, rows } = town;
  const ch = (x, y) => (x >= 0 && y >= 0 && x < cols && y < rows ? (town.ground[y] || '')[x] || ' ' : ' ');
  const blocked = new Uint8Array(cols * rows);      // not a place to stand
  const hidden = new Uint8Array(cols * rows);       // behind a roof / canopy (would not be seen)
  // 立てるのは歩ける地面（草地・土・石畳・広場）だけ。水・岸・街の外、知らない記号の地面には置かない
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!WALKABLE.has(ch(x, y))) blocked[y * cols + x] = 1;
  }
  const mark = (arr, x0, y0, w, h) => {
    for (let y = Math.max(0, y0); y < Math.min(rows, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(cols, x0 + w); x++) arr[y * cols + x] = 1;
  };
  for (const b of town.buildings || []) { mark(blocked, b.x, b.y, b.w, b.h); mark(hidden, b.x, b.y - 3, b.w, 3); }
  for (const p of town.props || []) {
    const x = Math.floor(p.x), y = Math.floor(p.y - 0.01);
    mark(blocked, x, y, 1, 1);
    if (p.type === 'tree') mark(hidden, x - 1, y - 2, 3, 2);
  }
  // 外に立つ番人（井戸番など）の足もと
  for (const l of town.landmarks || []) if (l.keeper) mark(blocked, Math.floor(l.keeper.x), Math.floor(l.keeper.y - 0.01), 1, 1);
  // 段（terrace）の石垣の前面（y+h の行）には立たない。階段の段だけは歩ける
  const step = new Set();
  for (const s of town.stairs || []) for (let x = s.x; x < s.x + s.w; x++) step.add(s.y * cols + x);
  for (const t of town.terraces || []) {
    const fy = t.y + t.h;
    if (fy < 0 || fy >= rows) continue;
    for (let x = Math.max(0, t.x); x < Math.min(cols, t.x + t.w); x++) if (!step.has(fy * cols + x)) blocked[fy * cols + x] = 1;
  }
  const ok = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !blocked[y * cols + x] && !hidden[y * cols + x];
  return { ch, ok, cols, rows };
}

export { townGrid };
