export function checkWaterfront(town, canal, canalHas, problems) {
  const { cols, rows } = town;
  // 港の水は地図の下端から flood fill し、港の水でない水路と区別する。
  // 水路との間に1〜2マスの陸が残ると、細い草の島や岸の帯になる。
  const harbourWater = new Set();
  const hq = [];
  for (let x = 0; x < cols; x++) {
    if (town.ground[rows - 1]?.[x] === '~' && !canalHas(x, rows - 1)) {
      const key = `${x},${rows - 1}`;
      if (!harbourWater.has(key)) { harbourWater.add(key); hq.push([x, rows - 1]); }
    }
  }
  for (let h = 0; h < hq.length; h++) {
    const [x, y] = hq[h];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || harbourWater.has(key) || canalHas(nx, ny)) continue;
      if (town.ground[ny]?.[nx] === '~') { harbourWater.add(key); hq.push([nx, ny]); }
    }
  }
  const waterStripHits = new Set();
  const parallelWaterHits = new Set();
  for (const [x, y] of canal) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let n = 1; n <= 3; n++) {
        const nx = x + dx * n, ny = y + dy * n, key = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) break;
        if (canalHas(nx, ny)) break;       // 同じ水路の幅・曲がり角の向こうは調べない
        if (harbourWater.has(key)) {
          const hit = `${x},${y}->${nx},${ny}`;
          if (n === 1 && town.canal.to === 'harbour') break; // 注ぎ口の直接接続
          if (n <= 3) parallelWaterHits.add(hit);
          if (n <= 3 && n - 1 <= 2) waterStripHits.add(hit);
          break;
        }
        if (town.ground[ny]?.[nx] === '~') break;
      }
    }
  }
  const waterLandStripCount = waterStripHits.size;
  if (waterStripHits.size) problems.push(`水と水の間に幅1〜2マスの陸の帯が ${waterStripHits.size} 箇所`);
  if (parallelWaterHits.size) problems.push(`水路が港の水と平行に3マス以内を流れる箇所が ${parallelWaterHits.size} 箇所`);
  if (town.canal.to === 'harbour' && harbourWater.size &&
    !canal.some(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .some(([dx, dy]) => harbourWater.has(`${x + dx},${y + dy}`)))) {
    problems.push('港へ注ぐ水路の終端が港の水に接していない');
  }
  // 地図端に沿って3マス以内を流れる長い区間は、外へ出る直前の
  // 横走りになっていないかを確認する（端へ直角に入る短い終端は除く）。
  const edgeParallel = new Set();
  for (const [x, y] of canal) {
    let hRun = 1, vRun = 1;
    for (let xx = x - 1; canalHas(xx, y); xx--) hRun++;
    for (let xx = x + 1; canalHas(xx, y); xx++) hRun++;
    for (let yy = y - 1; canalHas(x, yy); yy--) vRun++;
    for (let yy = y + 1; canalHas(x, yy); yy++) vRun++;
    if (hRun >= 3 && (y <= 3 || rows - 1 - y <= 3)) edgeParallel.add(`${x},${y}`);
    if (vRun >= 3 && (x <= 3 || cols - 1 - x <= 3)) edgeParallel.add(`${x},${y}`);
  }
  if (edgeParallel.size) problems.push(`水路が地図の端と平行に3マス以内を流れる箇所が ${edgeParallel.size} マス`);
  return waterLandStripCount;
}
