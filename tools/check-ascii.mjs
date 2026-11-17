import { loadProps } from '../src/layout/manifest.mjs';
import { deckTiles as deckCells, propCells, coverOf as roofCover, stairsOf, facesOf } from '../src/town-grid.mjs';
import { stairClearanceConflicts, describeStairConflict } from '../src/stair-clearance.mjs';
import { groupComponents, moduleGroup } from '../src/group-components.mjs';

// The complete --check used by ascii-town, also callable without spawning a process.
export function checkAscii(town, manifest, { regenerate, repo } = {}) {
  const propArt = loadProps(manifest);
  const deckTiles = (p) => deckCells(p, propArt);
  const propTilesOf = (p) => propCells(p, propArt);
  const coverOf = (b) => roofCover(b, manifest.archetypes);
  const faceCells = facesOf(town);
  const stairAt = stairsOf(town);
  const lines = [];
  const problems = stairClearanceConflicts(town, manifest.archetypes, propArt).map(describeStairConflict);
  for (const u of town.unplaced || []) if (u.archetype === 'group') {
    if (typeof u.group !== 'string' || typeof u.reason !== 'string' || !u.reason.trim() ||
      !Number.isSafeInteger(u.pieces) || u.pieces < 0 ||
      !Array.isArray(u.modules) || u.modules.some((p) => typeof p !== 'string') ||
      !Array.isArray(u.buildings) || u.buildings.some((id) => typeof id !== 'string')) {
      problems.push('group の unplaced に担当ID・理由・塊数・元のパス・建物IDが揃わない');
    }
  }
  const groups = groupComponents(town);
  for (const g of groups) {
    const records = (town.unplaced || []).filter((u) => u.archetype === 'group' && u.group === g.group);
    const explained = records.some((u) => typeof u.reason === 'string' && u.reason.trim() && u.pieces === g.pieces &&
      Array.isArray(u.modules) && Array.isArray(u.buildings) &&
      JSON.stringify([...u.buildings].sort()) === JSON.stringify(g.components.flat().sort()));
    if (g.pieces !== 1 && !explained) problems.push(`group ${JSON.stringify(g.group)} が ${g.pieces} 塊（理由付き unplaced が無い）`);
    if (records.length && !explained) problems.push(`group ${JSON.stringify(g.group)} の unplaced に理由・塊数・建物一覧が揃わない`);
    lines.push(`group ${JSON.stringify(g.group)}: ${g.pieces} 塊, ${g.buildings} 棟${explained ? `, unplaced: ${records.map((u) => u.reason).join(' / ')}` : ''}`);
  }
  for (const m of repo?.modules || []) {
    const group = moduleGroup(m);
    if (group === undefined) continue;
    const represented = town.buildings.some((b) => moduleGroup(b.module) === group &&
      (b.module.path === m.path || b.module.merged?.includes(m.path)));
    const gap = (town.unplaced || []).some((u) => u.archetype === 'group' && u.group === group &&
      typeof u.reason === 'string' && u.reason.trim() && Array.isArray(u.modules) && u.modules.includes(m.path));
    if (!represented && !gap) problems.push(`group ${JSON.stringify(group)} の ${m.path} が建物にも理由付き unplaced にも無い`);
  }
  let waterLandStripCount = 0;
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
  if (town.canal) {
    const canal = Array.isArray(town.canal.cells) ? town.canal.cells : [];
    const canalSet = new Set();
    const plazaSeen = new Set();
    const canalSpawn = town.spawn;
    const startKey = `${canalSpawn.x},${canalSpawn.y}`;
    if (town.ground[canalSpawn.y]?.[canalSpawn.x] === '+') {
      const q0 = [[canalSpawn.x, canalSpawn.y]]; plazaSeen.add(startKey);
      for (let h = 0; h < q0.length; h++) {
        const [x, y] = q0[h];
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const key = `${nx},${ny}`;
          if (!plazaSeen.has(key) && town.ground[ny]?.[nx] === '+') { plazaSeen.add(key); q0.push([nx, ny]); }
        }
      }
    }
    const plazaCells = [...plazaSeen].map((k) => k.split(',').map(Number));
    const px0 = plazaCells.length ? Math.min(...plazaCells.map(([x]) => x)) : Infinity;
    const px1 = plazaCells.length ? Math.max(...plazaCells.map(([x]) => x)) : -Infinity;
    const py0 = plazaCells.length ? Math.min(...plazaCells.map(([, y]) => y)) : Infinity;
    const py1 = plazaCells.length ? Math.max(...plazaCells.map(([, y]) => y)) : -Infinity;
    for (const [x, y] of canal) {
      const key = `${x},${y}`, k = y * cols + x;
      if (canalSet.has(key)) problems.push(`水路 (${x},${y}) が重なる`);
      canalSet.add(key);
      if (x < 0 || y < 0 || x >= cols || y >= rows) { problems.push(`水路 (${x},${y}) が範囲外`); continue; }
      if (town.ground[y][x] !== '~') problems.push(`水路 (${x},${y}) が ground の ~ でない`);
      if (foot[k] >= 0) problems.push(`水路 (${x},${y}) が建物に重なる`);
      if (x >= px0 && x <= px1 && y >= py0 && y <= py1) problems.push(`水路 (${x},${y}) が広場に重なる`);
      if (stairAt.has(key) || faceCells.some(([fx, fy]) => fx === x && fy === y)) problems.push(`水路 (${x},${y}) が段・階段に重なる`);
      for (const b of town.buildings) {
        if (x === b.door.x && y > b.door.y && y <= b.door.y + 2) problems.push(`水路 (${x},${y}) が ${b.id} の扉前に重なる`);
      }
    }
    if (canal.length) {
      const seenCanal = new Set([`${canal[0][0]},${canal[0][1]}`]), cq = [canal[0]];
      for (let h = 0; h < cq.length; h++) {
        const [x, y] = cq[h];
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const key = `${nx},${ny}`;
          if (canalSet.has(key) && !seenCanal.has(key)) { seenCanal.add(key); cq.push([nx, ny]); }
        }
      }
      if (seenCanal.size !== canalSet.size) problems.push('水路のセルが一続きでない');
    }
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
    waterLandStripCount = waterStripHits.size;
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
    const bridgeCount = town.props.filter((p) => p.type === 'bridge-h' || p.type === 'bridge-v').length;
    if (bridgeCount !== crossings.length) problems.push(`水路の交差点 ${crossings.length} 件と橋 ${bridgeCount} 件が一致しない`);
  }
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
  if (regenerate) {
    const again = JSON.stringify(regenerate());
    if (again !== JSON.stringify(town)) problems.push('同じ入力から違う街ができた');
  }
  let builtArea = 0;
  for (const b of town.buildings) builtArea += b.w * b.h;
  let inside = 0;
  for (const r of town.ground) for (const ch of r) if (ch !== ' ') inside++;
  lines.push(`check: 歩行面 ${walkable}（石畳 ${streets}）, 建物の占有率 ${(100 * builtArea / Math.max(1, inside)).toFixed(1)}%（街の内側に対して）, 到達 ${q.length}, 水と水の間の陸帯 ${waterLandStripCount}`);
  if (problems.length) { lines.push(`問題 ${problems.length} 件:\n  ` + [...new Set(problems)].slice(0, 40).join('\n  ')); }
  else lines.push('check: OK（階段と前後2行・重なり・隙間・屋根の余白・下の行・到達・決定性）');
  return { problems, lines, groups };
}
