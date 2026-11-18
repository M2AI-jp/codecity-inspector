export function checkReachability(town, { foot, blocked, deckT, faceCells }, problems) {
  const { cols, rows } = town;
  for (const [x, y] of faceCells) if (x >= 0 && y >= 0 && x < cols && y < rows) blocked[y * cols + x] = 1;    // 段の壁は歩けない
  const walk = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && ('.#:+'.includes(town.ground[y][x]) || deckT[y * cols + x]) && foot[y * cols + x] < 0 && !blocked[y * cols + x];
  const s = town.spawn;
  if (!walk(s.x, s.y)) problems.push('開始位置が歩けない');
  if (town.ground[s.y][s.x] !== '+') problems.push('開始位置が広場に無い');
  const seen = new Uint8Array(cols * rows);
  const q = [s.y * cols + s.x];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const t = q[h], x = t % cols, y = (t / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (walk(nx, ny) && !seen[ny * cols + nx]) { seen[ny * cols + nx] = 1; q.push(ny * cols + nx); }
    }
  }
  // 扉の列は絵の版で決まるので、footprint のすぐ下の1行は端から端まで歩ける地面で、広場から行けること
  for (const b of town.buildings) {
    const y = b.y + b.h;
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!walk(x, y)) problems.push(`${b.id} の下の行 (${x},${y}) が歩けない`);
      else if (!seen[y * cols + x]) problems.push(`${b.id} の下の行 (${x},${y}) に広場から行けない`);
      if (!'#:+'.includes(town.ground[y]?.[x])) problems.push(`${b.id} の下の行 (${x},${y}) が通り・路地・広場でない`);
    }
  }
  let walkable = 0, streets = 0, unreached = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!walk(x, y)) continue;
    walkable++;
    if (town.ground[y][x] === '#') streets++;
    if (!seen[y * cols + x]) unreached++;
  }
  if (unreached) problems.push(`広場から行けない歩行面が ${unreached} マス`);
  return { walkable, streets, reached: q.length };
}
