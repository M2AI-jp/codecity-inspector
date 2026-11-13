import { DIRT, GRASS, OUT, PLAZA, STREET, WATER, clamp } from './constants.mjs';
import { cmp } from './util.mjs';
import { propTiles } from './manifest.mjs';

// past を経由する候補を全ての辺で試してから、必要なときだけ past: [] の候補を試す。
// 探索本体を引数にすることで、辺の試行順とフォールバック順を同じ規則で保つ。
export function chooseCanalRoute(edgeDefs, startsFor, {
  past = [],
  targetGoals = new Set(),
  harbourStates = new Set(),
  outsideStates = new Set(),
  astarVia,
  astar,
} = {}) {
  const findRoute = (viaPast) => {
    for (const edge of edgeDefs) {
      const starts = startsFor(edge);
      if (!starts.length) continue;
      if (viaPast) {
        if (!past.length || !targetGoals.size) continue;
        if (harbourStates.size) {
          const path = astarVia(starts, targetGoals, harbourStates);
          if (path) return { path, past: past.slice(), to: 'harbour', edge: edge.name };
        }
        if (outsideStates.size) {
          const path = astarVia(starts, targetGoals, outsideStates);
          if (path) return { path, past: past.slice(), to: 'outside', edge: edge.name };
        }
      } else {
        if (harbourStates.size) {
          const path = astar(starts, harbourStates);
          if (path) return { path, past: [], to: 'harbour', edge: edge.name };
        }
        if (outsideStates.size) {
          const path = astar(starts, outsideStates);
          if (path) return { path, past: [], to: 'outside', edge: edge.name };
        }
      }
    }
    return null;
  };
  return (past.length && targetGoals.size ? findRoute(true) : null) || findRoute(false);
}


// ---------- 井戸から流れる水路（橋の絵が両向きそろったときだけ） ----------
export function buildCanal(P, F, repo, propArt, opt = {}) {
  const well = (repo.facilities || []).find((f) => f.archetype === 'well' && f.facts);
  const cannotPlace = (reason) => ({
    unplaced: { archetype: 'canal', name: '水路', reason },
  });
  if (!well) return null;
  if (!propArt['bridge-h']?.deck || !propArt['bridge-v']?.deck) {
    return cannotPlace('橋を両方向に歩ける絵・deck がそろっていない');
  }
  const { cols, rows, N, id, plaza, plazaM, foot, roofZ, front, road, pieces, placed, quay, terraces } = P;
  const { g, crop } = F;
  const original = g.slice();
  const inG = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const inC = (x, y) => x >= crop.x0 && y >= crop.y0 && x <= crop.x1 && y <= crop.y1;
  const terraceMask = new Uint8Array(N);
  for (const t of terraces || []) {
    for (let y = t.y; y <= t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) if (inG(x, y)) terraceMask[id(x, y)] = 1;
  }
  const doorFront = new Uint8Array(N);
  const buildingWalkRow = new Uint8Array(N);
  const facilityWalkRow = new Uint8Array(N);
  const fixedFoot = new Uint8Array(N), fixedRoof = new Uint8Array(N), fixedFront = new Uint8Array(N), fixedDoorFront = new Uint8Array(N);
  for (const p of placed) {
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    for (let x = p.x; x < p.x + p.w; x++) if (inG(x, p.yb + 1)) {
      buildingWalkRow[id(x, p.yb + 1)] = 1;
      if (p.spec.facility) facilityWalkRow[id(x, p.yb + 1)] = 1;
    }
    for (let x = p.x; x < p.x + p.w; x++) {
      for (let y = p.y; y <= p.yb; y++) if (inG(x, y) && p.spec.facility) fixedFoot[id(x, y)] = 1;
      for (let y = p.y - (p.spec.roofRows ?? 2); y < p.y; y++) if (inG(x, y) && p.spec.facility) fixedRoof[id(x, y)] = 1;
      for (let y = p.yb + 1; y < (p.track?.sd?.[x - p.track.x0] ?? p.yb + 1); y++) if (inG(x, y) && p.spec.facility) fixedFront[id(x, y)] = 1;
    }
    for (let y = p.yb + 1; y <= p.yb + 2; y++) if (inG(dc, y)) {
      doorFront[id(dc, y)] = 1;
      if (p.spec.facility) fixedDoorFront[id(dc, y)] = 1;
    }
  }
  const inPlaza = (x, y) => x >= plaza.x0 && x <= plaza.x1 && y >= plaza.y0 && y <= plaza.y1;
  const paved = (k) => original[k] === STREET || original[k] === DIRT;
  const roadDirAt = (x, y) => {
    if (!inG(x, y)) return null;
    const k = id(x, y), r = road[k];
    if (!paved(k)) return null;
    if (r >= 0 && pieces[r]) return pieces[r].dir;
    let h = 0, v = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0]]) {
      const q = id(x + dx, y);
      if (inG(x + dx, y) && paved(q)) {
        const rr = road[q];
        if (rr >= 0 && pieces[rr]?.dir === 'h') h++;
        else h += 0.5;
      }
    }
    for (const [dx, dy] of [[0, -1], [0, 1]]) {
      const q = id(x, y + dy);
      if (inG(x, y + dy) && paved(q)) {
        const rr = road[q];
        if (rr >= 0 && pieces[rr]?.dir === 'v') v++;
        else v += 0.5;
      }
    }
    return h > v && h > 0 ? 'h' : v > h && v > 0 ? 'v' : null;
  };
  // 水路は通りを横切るときだけ舗装地に入り、通りに沿って流れたり、
  // 通りのすぐ脇を長く流れたりしない。roadTurn は交差点・曲がり角の核。
  const roadTurn = new Uint8Array(N);
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    if (!paved(id(x, y))) continue;
    const rd = roadDirAt(x, y);
    if (!rd) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inG(nx, ny) || !paved(id(nx, ny))) continue;
      const nd = roadDirAt(nx, ny);
      if (nd && nd !== rd) {
        roadTurn[id(x, y)] = 1;
        roadTurn[id(nx, ny)] = 1;
      }
    }
  }
  const nearRoadTurn = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 2 || !inG(x + dx, y + dy)) continue;
      if (roadTurn[id(x + dx, y + dy)]) return true;
    }
    return false;
  };
  const laneCells = (x, y, d) => d % 2 ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]];
  const laneTouchesRoadSide = (x, y, d) => {
    const cells = laneCells(x, y, d);
    const own = new Set(cells.map(([cx, cy]) => `${cx},${cy}`));
    return cells.some(([cx, cy]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      return inG(nx, ny) && !own.has(`${nx},${ny}`) && paved(id(nx, ny));
    }));
  };
  const axis = (d) => d % 2 ? 'v' : 'h';
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const sinkWater = (x, y) => !!(quay && original[id(x, y)] === WATER && y >= quay.water0);
  // 港の水は終点の幅2マスだけに入れる。途中の経路が港の水を
  // 横切って別の終点へ抜けると、岸に沿う水路や細い陸の帯を作れる。
  const parallelToWater = (cells, flow) => {
    // 終点そのもの（幅2マスの港の水）は、港へ注ぐために許す。
    if (cells.length && cells.every(([x, y]) => sinkWater(x, y))) return false;
    const normal = flow === 'h' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    for (const [x, y] of cells) {
      for (const [dx, dy] of normal) {
        for (let n = 1; n <= 3; n++) {
          const nx = x + dx * n, ny = y + dy * n;
          if (inG(nx, ny) && sinkWater(nx, ny)) return true;
        }
      }
    }
    return false;
  };
  const parallelToMapEdge = (cells, flow) => cells.some(([x, y]) =>
    flow === 'h'
      ? y - crop.y0 <= 3 || crop.y1 - y <= 3
      : x - crop.x0 <= 3 || crop.x1 - x <= 3);
  const laneAllowed = (x, y, d, goal = false) => {
    const cells = laneCells(x, y, d);
    const flow = axis(d);
    const perpendicular = flow === 'v' ? 'h' : 'v';
    let hasCrossRoad = false;
    const adjacentRoads = [];
    const crossingRoadCells = [];
    for (const [cx, cy] of cells) {
      if (!inC(cx, cy)) return false;
      const k = id(cx, cy);
       const building = opt.ignoreBuildings ? fixedFoot[k] : foot[k] >= 0;
       const roof = opt.ignoreBuildings ? fixedRoof[k] : roofZ[k];
       const fore = opt.ignoreBuildings ? fixedFront[k] : front[k];
       const door = opt.ignoreBuildings ? fixedDoorFront[k] : doorFront[k];
       const buildingFront = buildingWalkRow[k] && !paved(k);
       if (inPlaza(cx, cy) || plazaM[k] || building || roof || fore || door ||
         facilityWalkRow[k] || buildingFront || terraceMask[k]) return false;
      if (original[k] === OUT && !goal) return false;
      if (original[k] === WATER && !(goal && sinkWater(cx, cy))) return false;
      if (![GRASS, STREET, DIRT, OUT, WATER].includes(original[k])) return false;
      const rd = roadDirAt(cx, cy);
      if (rd) {
        if (rd !== perpendicular) return false;
        hasCrossRoad = true;
        crossingRoadCells.push([cx, cy]);
        continue;
      }
      // 水セルのすぐ隣に舗装地があるときは、同じ状態の lane が
      // その通りを実際に横切っている場合だけ許す。通りの直前・直後を
      // ただの草地として通してしまうと、橋の無い並走ができてしまう。
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!inG(nx, ny) || !paved(id(nx, ny))) continue;
        adjacentRoads.push({ x: nx, y: ny, dir: roadDirAt(nx, ny), cx, cy });
      }
    }
    if (adjacentRoads.some(({ dir }) => dir !== perpendicular)) return false;
    if (adjacentRoads.length && !hasCrossRoad) {
      const hasRoadAhead = adjacentRoads.every(({ x: rx, y: ry, cx, cy }) => {
        const dx = rx - cx, dy = ry - cy;
        if (!(dx === dirs[d][0] && dy === dirs[d][1]) && !(dx === -dirs[d][0] && dy === -dirs[d][1])) return false;
        return laneCells(x + dirs[d][0], y + dirs[d][1], d).some(([lx, ly]) => paved(id(lx, ly))) ||
          laneCells(x - dirs[d][0], y - dirs[d][1], d).some(([lx, ly]) => paved(id(lx, ly)));
      });
      if (!hasRoadAhead) return false;
    }
    if (parallelToWater(cells, flow) || parallelToMapEdge(cells, flow)) return false;
    if (hasCrossRoad) {
      const alongRoad = perpendicular === 'h' ? [1, 0] : [0, 1];
      const alongValues = crossingRoadCells.map(([cx, cy]) => alongRoad[0] ? cx : cy);
      const minAlong = Math.min(...alongValues), maxAlong = Math.max(...alongValues);
      const first = crossingRoadCells[0];
      const reachesBothSides = alongRoad[0]
        ? inG(minAlong - 1, first[1]) && inG(maxAlong + 1, first[1]) &&
          paved(id(minAlong - 1, first[1])) && paved(id(maxAlong + 1, first[1]))
        : inG(first[0], minAlong - 1) && inG(first[0], maxAlong + 1) &&
          paved(id(first[0], minAlong - 1)) && paved(id(first[0], maxAlong + 1));
      if (!reachesBothSides) return false;
    }
    if (hasCrossRoad) {
      const centerX = Math.round(cells.reduce((n, [cx]) => n + cx, 0) / cells.length);
      const centerY = Math.round(cells.reduce((n, [, cy]) => n + cy, 0) / cells.length);
      if (nearRoadTurn(centerX, centerY)) return false; // 橋の中心が曲がり角から2マス以内なら渡さない
    }
    return true;
  };

  // A* は水路の中心線だけを探索し、各中心線を幅2マスへ広げる。曲がり角は高く払い、直線を優先する。
  const state = (x, y, d) => (id(x, y) * 4 + d);
  const decode = (s) => { const d = s % 4, k = (s / 4) | 0; return { x: k % cols, y: (k / cols) | 0, d }; };
  const heapPush = (heap, item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= item[0]) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = item;
  };
  const heapPop = (heap) => {
    const top = heap[0], last = heap.pop();
    if (!heap.length) return top;
    let i = 0;
    while (true) {
      let l = i * 2 + 1;
      if (l >= heap.length) break;
      let r = l + 1, c = r < heap.length && heap[r][0] < heap[l][0] ? r : l;
      if (heap[c][0] >= last[0]) break;
      heap[i] = heap[c]; i = c;
    }
    heap[i] = last;
    return top;
  };
  const astar = (starts, goals) => {
    if (!starts.length || !goals.size) return null;
    const goalList = [...goals].map(decode);
    const heuristic = (s) => {
      const a = decode(s);
      let best = Infinity;
      for (const b of goalList) best = Math.min(best, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
      return best;
    };
    const dist = new Float64Array(N * 4); dist.fill(Infinity);
    const prev = new Int32Array(N * 4); prev.fill(-1);
    const heap = [];
    for (const s of starts) {
      if (dist[s] > 0) { dist[s] = 0; heapPush(heap, [heuristic(s), 0, s]); }
    }
    let expanded = 0;
    while (heap.length && expanded++ < N * 4) {
      const [, dg, s] = heapPop(heap);
      if (dg !== dist[s]) continue;
      if (goals.has(s)) {
        const path = [];
        for (let q = s; q >= 0; q = prev[q]) { path.push(q); if (prev[q] < 0) break; }
        return path.reverse();
      }
      const a = decode(s);
      for (let nd = 0; nd < 4; nd++) {
        const nx = a.x + dirs[nd][0], ny = a.y + dirs[nd][1];
        if (!inG(nx, ny)) continue;
        const ns = state(nx, ny, nd);
        if (nd !== a.d && laneTouchesRoadSide(a.x, a.y, a.d) &&
          !laneCells(nx, ny, nd).some(([cx, cy]) => roadDirAt(cx, cy))) continue;
        if (!laneAllowed(nx, ny, nd, goals.has(ns))) continue;
        const turn = nd === a.d ? 0 : 34;
        let terrain = 1;
        for (const [cx, cy] of laneCells(nx, ny, nd)) {
          const v = original[id(cx, cy)];
          terrain += v === STREET ? 2 : v === DIRT ? 1 : v === WATER ? 2 : v === OUT ? 7 : 0;
          if (opt.ignoreBuildings &&
            (foot[id(cx, cy)] >= 0 || roofZ[id(cx, cy)] || front[id(cx, cy)] ||
              buildingWalkRow[id(cx, cy)] || facilityWalkRow[id(cx, cy)])) terrain += 10000;
        }
        const ng = dg + terrain + turn;
        if (ng >= dist[ns]) continue;
        dist[ns] = ng; prev[ns] = s;
        heapPush(heap, [ng + heuristic(ns), ng, ns]);
      }
    }
    return null;
  };

  // envInCode のファイルを現在の建物の module / merged へ対応づけ、設定名の種類数で地区を選ぶ。
  const envRows = Array.isArray(well.facts?.envInCode) ? well.facts.envInCode : [];
  const candidates = placed.filter((p) => !p.spec.facility && p.spec.module);
  const modulePaths = (m) => [m.path, ...(m.merged || [])].filter((p) => typeof p === 'string' && p.length);
  const moduleForFile = (file) => {
    let best = null, score = -1;
    for (const p of candidates) for (const path of modulePaths(p.spec.module)) {
      if (file === path || file.startsWith(`${path}/`)) {
        if (path.length > score) { best = p; score = path.length; }
      }
    }
    return best;
  };
  const districtCounts = new Map();
  for (const row of envRows) {
    const hit = (row.files || []).map(moduleForFile).find(Boolean);
    if (!hit) continue;
    const key = hit.spec.module.path;
    districtCounts.set(key, (districtCounts.get(key) || 0) + 1);
  }
  const orderedDistricts = [...districtCounts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  const maxDistrict = orderedDistricts[0]?.[1] || 0;
  const past = maxDistrict ? orderedDistricts.filter(([, n]) => n === maxDistrict).slice(0, 3).map(([p]) => p) : [];
  const targetBuildings = candidates.filter((p) => past.includes(p.spec.module.path));
  const targetGoals = new Set();
  const addGoal = (x, y, d) => {
    if (inC(x, y) && laneAllowed(x, y, d, false)) targetGoals.add(state(x, y, d));
  };
  for (const p of targetBuildings) {
    // 「地区のそば」は建物の壁際だけに限定しない。建物の周囲10マス
    // までを候補にして、通りの角を避けながら到達できる余地を残す。
    for (let y = p.y - 10; y <= p.yb + 10; y++) {
      for (let x = p.x - 10; x <= p.x + p.w + 9; x++) {
        for (let d = 0; d < 4; d++) addGoal(x, y, d);
      }
    }
  }

  // 井戸小屋は placeProps() の中で置くため、ここでは同じ中心候補を
  // 基準にして、広場の縁を井戸に近い順に試す。始点はその縁の
  // 範囲内だけに置き、広場の外から水口が始まらないようにする。
  const [, wellH] = propTiles('wellhouse', propArt);
  const wellAnchor = { x: P.cx, y: plaza.y1 - wellH / 2 };
  const edgeDefs = [
    { name: 'south', d: 1, distance: Math.abs((plaza.y1 + 1) - wellAnchor.y), tie: 0 },
    { name: 'east', d: 0, distance: Math.abs((plaza.x1 + 1) - wellAnchor.x), tie: 1 },
    { name: 'west', d: 2, distance: Math.abs(wellAnchor.x - (plaza.x0 - 1)), tie: 2 },
  ].sort((a, b) => a.distance - b.distance || a.tie - b.tie);
  const startsFor = (edge) => {
    const starts = [];
    if (edge.name === 'south') {
      const xs = [];
      for (let x = plaza.x0 - 16; x <= plaza.x1 + 16; x++) xs.push(x);
      xs.sort((a, b) => Math.abs(a - wellAnchor.x) - Math.abs(b - wellAnchor.x) || a - b);
      // 南の段の階段の直下は、水路の最初の橋を置く場所にしない。
      // 階段の手すり・壁が橋の片側への歩行をふさぐため、階段の幅を
      // 外した広場の南縁から始め、口から港へ向かう道筋を保つ。
      const stairW = clamp(Math.round(plaza.w / 2), 4, 6);
      const stairX = plaza.x0 + Math.floor((plaza.w - stairW) / 2);
      for (const x of xs) {
        // 広場の擁壁そのものを水にせず、その下の大通り側から口を出す。
        // 擁壁の下の通りを1行だけ越えてから始める。+2 では南階段の
        // 直下が最初の橋になり、段の壁と橋の欄干が歩行を分断する。
        const y = plaza.y1 + 5;
        if ([x - 1, x].some((cx) => cx >= stairX && cx < stairX + stairW)) continue;
        if (inC(x, y) && laneAllowed(x, y, edge.d, false)) starts.push(state(x, y, edge.d));
      }
    } else {
      const ys = [];
      for (let y = plaza.y0 - 16; y <= plaza.y1 + 16; y++) ys.push(y);
      ys.sort((a, b) => Math.abs(a - wellAnchor.y) - Math.abs(b - wellAnchor.y) || a - b);
      const edgeX = edge.name === 'east' ? plaza.x1 + 1 : plaza.x0 - 1;
      for (let offset = 0; offset <= 16; offset++) {
        const x = edge.name === 'east' ? edgeX + offset : edgeX - offset;
        for (const y of ys) if (inC(x, y) && laneAllowed(x, y, edge.d, false)) starts.push(state(x, y, edge.d));
      }
    }
    return starts;
  };

  const atCropEdge = (x, y) => x === crop.x0 || x === crop.x1 || y === crop.y0 || y === crop.y1;
  const flowsOutside = (cells, d) => {
    if (d === 0) return cells.some(([x]) => x === crop.x1);
    if (d === 2) return cells.some(([x]) => x === crop.x0);
    if (d === 1) return cells.some(([, y]) => y === crop.y1);
    return cells.some(([, y]) => y === crop.y0);
  };
  const outsideStates = new Set();
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) for (let d = 0; d < 4; d++) {
    const cells = laneCells(x, y, d);
    if (!cells.some(([cx, cy]) => inC(cx, cy) && atCropEdge(cx, cy) && original[id(cx, cy)] === GRASS)) continue;
    if (!flowsOutside(cells, d)) continue;
    const s = state(x, y, d);
    if (laneAllowed(x, y, d, true)) outsideStates.add(s);
  }
  const harbourStates = new Set();
  if (quay) {
    for (let x = crop.x0 + 1; x <= crop.x1 - 1; x++) {
      // qt は岸の通りの上端が列ごとに1行だけ揺れるため、左右2列の
      // 最初の水行が同じ場所だけを終点にする。直前のlaneは岸の通り
      // なので、水路は岸壁の2行をまっすぐ横切って港へ入る。
      const leftQt = quay.qt[x - 1] ?? quay.top;
      const rightQt = quay.qt[x] ?? quay.top;
      if (leftQt !== rightQt) continue;
      const y = leftQt + 2;
      const s = state(x, y, 1);
      if (!laneCells(x, y, 1).every(([cx, cy]) => sinkWater(cx, cy))) continue;
      if (laneAllowed(x, y, 1, true)) harbourStates.add(s);
    }
  }
  // 中間地点（past）を必ず通る A*。通常の A* とは別に「past を通過したか」
  // を状態へ持たせるので、最初に見つけた行き止まりだけで全体を諦めない。
  const astarVia = (starts, mids, goals) => {
    if (!starts.length || !mids.size || !goals.size) return null;
    const goalList = [...goals].map(decode);
    const heuristic = (s) => {
      const a = decode(s);
      let best = Infinity;
      for (const b of goalList) best = Math.min(best, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
      return best;
    };
    const dist = new Float64Array(N * 8); dist.fill(Infinity);
    const prev = new Int32Array(N * 8); prev.fill(-1);
    const heap = [];
    const keyOf = (s, hit) => s * 2 + (hit ? 1 : 0);
    const stateOf = (key) => (key / 2) | 0;
    for (const s of starts) {
      const key = keyOf(s, mids.has(s));
      if (dist[key] > 0) { dist[key] = 0; heapPush(heap, [heuristic(s), 0, key]); }
    }
    let expanded = 0;
    while (heap.length && expanded++ < N * 8) {
      const [, dg, key] = heapPop(heap);
      if (dg !== dist[key]) continue;
      const s = stateOf(key), hit = (key & 1) === 1;
      if (hit && goals.has(s)) {
        const path = [];
        for (let q = key; q >= 0; q = prev[q]) { path.push(stateOf(q)); if (prev[q] < 0) break; }
        return path.reverse();
      }
      const a = decode(s);
      for (let nd = 0; nd < 4; nd++) {
        const nx = a.x + dirs[nd][0], ny = a.y + dirs[nd][1];
        if (!inG(nx, ny)) continue;
        const ns = state(nx, ny, nd);
        const nextHit = hit || mids.has(ns);
        if (nd !== a.d && laneTouchesRoadSide(a.x, a.y, a.d) &&
          !laneCells(nx, ny, nd).some(([cx, cy]) => roadDirAt(cx, cy))) continue;
        if (!laneAllowed(nx, ny, nd, goals.has(ns))) continue;
        const turn = nd === a.d ? 0 : 34;
        let terrain = 1;
        for (const [cx, cy] of laneCells(nx, ny, nd)) {
          const v = original[id(cx, cy)];
          terrain += v === STREET ? 2 : v === DIRT ? 1 : v === WATER ? 2 : v === OUT ? 7 : 0;
          if (opt.ignoreBuildings &&
            (foot[id(cx, cy)] >= 0 || roofZ[id(cx, cy)] || front[id(cx, cy)] ||
              buildingWalkRow[id(cx, cy)] || facilityWalkRow[id(cx, cy)])) terrain += 10000;
        }
        const ng = dg + terrain + turn, nk = keyOf(ns, nextHit);
        if (ng >= dist[nk]) continue;
        dist[nk] = ng; prev[nk] = key;
        heapPush(heap, [ng + heuristic(ns), ng, nk]);
      }
    }
    return null;
  };

  let allStates = null, routePast = [], routeTo = null;
  if (Array.isArray(opt.forcedStates) && opt.forcedStates.length) {
    const valid = opt.forcedStates.every((s, i) => {
      const a = decode(s);
      return laneAllowed(a.x, a.y, a.d, i === opt.forcedStates.length - 1);
    });
    if (valid) {
      allStates = opt.forcedStates.slice();
      routePast = Array.isArray(opt.forcedPast) ? opt.forcedPast.slice() : [];
      routeTo = opt.forcedTo || null;
    }
  }
  if (!allStates) {
    const found = chooseCanalRoute(edgeDefs, startsFor, {
      past, targetGoals, harbourStates, outsideStates, astarVia, astar,
    });
    allStates = found?.path || null;
    routePast = found?.past || [];
    routeTo = found?.to || null;
  }
  if (!allStates) {
    return cannotPlace('広場の南・東・西の縁から、港または街の外へ、通りとの直交・曲がり角2マスの規則を守る水路を置けない');
  }
  const cells = new Set();
  for (const s of allStates) {
    const a = decode(s);
    for (const [x, y] of laneCells(a.x, a.y, a.d)) if (inC(x, y)) cells.add(id(x, y));
  }
  // 始点・終点を含む水セルが幅2で一続きかを最後に確認する。
  const canalCells = [...cells].map((k) => [k % cols, (k / cols) | 0]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (canalCells.length < 4) {
    return cannotPlace('始点から終点まで幅2マスの水路を連続して置けない');
  }
  const cellSet = new Set(canalCells.map(([x, y]) => id(x, y)));
  const seen = new Set([canalCells[0] && id(canalCells[0][0], canalCells[0][1])]);
  const queue = [canalCells[0]];
  for (let h = 0; h < queue.length; h++) {
    const [x, y] = queue[h];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = id(nx, ny);
      if (cellSet.has(k) && !seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
    }
  }
  if (seen.size !== cellSet.size) {
    return cannotPlace('水路のセルが一続きにならない');
  }
  const bridgeCells = new Set(), bridgeDeckCells = new Set();
  const bridgeProps = [];
  const mouthProps = [];
  const firstState = decode(allStates[0]);
  const firstLane = laneCells(firstState.x, firstState.y, firstState.d).filter(([x, y]) => cellSet.has(id(x, y)));
  if (firstLane.length === 2) {
    const xs = firstLane.map(([x]) => x), ys = firstLane.map(([, y]) => y);
    const mouthTileX = firstState.d % 2 ? Math.min(...xs) : firstState.x;
    const mouthTileY = Math.min(...ys);
    // 始点の最初の水セルに石の口を重ねる。橋の位置は
    // 交差する道路の幅に合わせて決まるため、口を先へずらさない。
    const mouthX = mouthTileX + 1;
    const mouthY = mouthTileY + 1;
    mouthProps.push({ type: 'canal-mouth', x: mouthX, y: mouthY, look: 'canal-mouth' });
  }
  const crossings = [];
  // 1本の橋の deck は流れ方向に2マスを覆う。水路の同じ向きの
  // 交差部が近いと、前庭や dense frontage まで舗装として拾って橋が
  // 縦に重なるため、交差前にその部分だけ草地へ戻す。
  const initialRoadWater = new Set(canalCells.filter(([x, y]) => paved(id(x, y))).map(([x, y]) => id(x, y)));
  const initialRoadDir = new Map(canalCells.map(([x, y]) => [id(x, y), roadDirAt(x, y)]));
  const initialComponents = [];
  const initialSeen = new Set();
  for (const start of initialRoadWater) {
    if (initialSeen.has(start)) continue;
    const dir = initialRoadDir.get(start);
    if (!dir) continue;
    const component = [], q = [start];
    initialSeen.add(start);
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % cols, y = (k / cols) | 0;
      component.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = id(nx, ny);
        if (initialRoadWater.has(nk) && initialRoadDir.get(nk) === dir && !initialSeen.has(nk)) {
          initialSeen.add(nk);
          q.push(nk);
        }
      }
    }
    const xs = component.map(([x]) => x), ys = component.map(([, y]) => y);
    initialComponents.push({
      cells: component, dir,
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
      soft: component.every(([x, y]) => {
        const r = road[id(x, y)];
        return r < 0 || pieces[r]?.kind === 'dense';
      }),
    });
  }
  const axisRange = (c) => c.dir === 'h' ? [c.minY, c.maxY] : [c.minX, c.maxX];
  const axisGap = (a, b) => {
    const [a0, a1] = axisRange(a), [b0, b1] = axisRange(b);
    return a1 < b0 ? b0 - a1 - 1 : b1 < a0 ? a0 - b1 - 1 : 0;
  };
  const clearCrossingCell = (x, y, dir) => {
    const k = id(x, y);
    original[k] = GRASS;
    const sides = dir === 'h' ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
    for (const [nx, ny] of sides) {
      if (!inG(nx, ny)) continue;
      const nk = id(nx, ny);
      if (foot[nk] >= 0 || buildingWalkRow[nk] || front[nk] || plazaM[nk] || terraceMask[nk]) continue;
      if (original[nk] === STREET || original[nk] === DIRT) g[nk] = GRASS;
    }
  };
  const keptComponents = [];
  initialComponents
    .sort((a, b) => (a.dir === b.dir ? axisRange(a)[0] - axisRange(b)[0] : a.dir.localeCompare(b.dir)))
    .forEach((c) => {
      const nearbyNormal = initialComponents.some((q) => q !== c && q.dir === c.dir && !q.soft && axisGap(c, q) <= 2);
      const nearbyKept = keptComponents.some((q) => q.dir === c.dir && axisGap(c, q) <= 2);
      if ((c.soft && nearbyNormal) || nearbyKept) {
        for (const [x, y] of c.cells) clearCrossingCell(x, y, c.dir);
        return;
      }
      const [a0, a1] = axisRange(c);
      if (a1 - a0 + 1 > 2) {
        const keep0 = c.dir === 'h' ? Math.floor((a0 + a1) / 2) : a0;
        const keep1 = keep0 + 1;
        for (const [x, y] of c.cells) {
          const axis = c.dir === 'h' ? y : x;
          if (axis < keep0 || axis > keep1) clearCrossingCell(x, y, c.dir);
        }
      }
      keptComponents.push(c);
    });
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
  // 横橋の deck の片側から2セル以内を同じ通常建物が全行ふさいでいる
  // 場合だけ、その建物セルを次の建物配置で予約する。1行だけの接触は
  // 歩行可能なので予約せず、密な街の外枠を広げない。縦橋は deck の
  // 半端丸めを補正済み。
  const bridgeSideReserve = new Set();
  for (const p of bridgeProps) {
    if (p.type !== 'bridge-h') continue;
    const { x0, y0, x1, y1 } = deckBounds(p.type, p.x, p.y);
    const sideXs = quay ? [x0 - 1, x0 - 2, x1 + 1, x1 + 2] : [x0 - 1, x1 + 1];
    for (const x of sideXs) {
      const ks = [];
      for (let y = y0; y <= y1; y++) if (inC(x, y)) ks.push(id(x, y));
      if (ks.length && ks.some((k) => foot[k] >= 0 && !placed[foot[k]]?.spec.facility)) {
        for (const k of ks) bridgeSideReserve.add(k);
      }
    }
  }
  // 水路の中心が元の舗装セルでなくても、幅のある通りの両側に沿って
  // 横断している場合がある。橋の無い並走を残さないよう、その交差部に
  // deck が収まる道路行を探して橋と crossing の中心を同じ行へ寄せる。
  const touchesPerpendicularRoad = (x, y, flow) => {
    const sides = flow === 'v' ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
    return sides.some(([nx, ny]) => {
      if (!inG(nx, ny)) return false;
      const k = id(nx, ny), r = road[k];
      return r >= 0 && pieces[r]?.kind !== 'dense';
    });
  };
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i], p = bridgeProps[i];
    if (c.road !== 'h' || !p) continue;
    const bad = canalCells.filter(([x, y]) => {
      return Math.abs(x - c.x) <= 2 && Math.abs(y - c.y) <= 5 &&
        Math.abs(x - c.x) + Math.abs(y - c.y) > 2 && touchesPerpendicularRoad(x, y, 'v');
    });
    if (!bad.length) continue;
    const choices = [];
    for (let dy = -3; dy <= 3; dy++) {
      if (!dy) continue;
      const candidatePy = p.y + dy, b = deckBounds('bridge-h', p.x, candidatePy);
      if (b.x0 < 0 || b.y0 < 0 || b.x1 >= cols || b.y1 >= rows) continue;
      let clear = true;
      for (let y = b.y0; y <= b.y1 && clear; y++) for (let x = b.x0; x <= b.x1; x++) {
        if (!inC(x, y) || original[id(x, y)] === OUT || foot[id(x, y)] >= 0) { clear = false; break; }
      }
      if (!clear) continue;
      const ysOnDeck = [];
      for (let y = b.y0; y <= b.y1; y++) {
        const k = id(c.x, y);
        if (cellSet.has(k) && paved(id(b.x0, y)) && paved(id(b.x1, y))) ysOnDeck.push(y);
      }
      for (const cy of ysOnDeck) {
        const maxDistance = Math.max(...bad.map(([x, y]) => Math.abs(x - c.x) + Math.abs(y - cy)));
        if (maxDistance > 2) continue;
        let blocked = 0;
        for (const x of [b.x0 - 1, b.x1 + 1]) for (let y = b.y0; y <= b.y1; y++) {
          if (inC(x, y) && foot[id(x, y)] >= 0) blocked++;
        }
        choices.push({ py: candidatePy, cy, maxDistance, blocked, distance: Math.abs(dy) });
      }
    }
    choices.sort((a, b) => a.maxDistance - b.maxDistance || a.blocked - b.blocked || a.distance - b.distance || a.py - b.py);
    if (choices[0]) {
      p.y = choices[0].py;
      c.y = choices[0].cy;
    }
  }
  // 補正後の deck だけを橋の予約帯として使う。
  bridgeCells.clear();
  bridgeDeckCells.clear();
  for (const p of bridgeProps) addDeckTiles(p.type, p.x, p.y);
  // 始点直下の通りに橋がかかる場合、口の絵を同じ水路の次のセルへ
  // ずらす。口は水路の端を示し続けるが、橋の deck と小物が重ならない。
  if (mouthProps.length) {
    const [mw, mh] = propTiles('canal-mouth', propArt);
    const mouthTilesAt = (p) => {
      const tx = Math.floor(p.x - mw / 2 + 0.5), ty = Math.round(p.y - mh);
      const out = [];
      for (let dy = 0; dy < mh; dy++) for (let dx = 0; dx < mw; dx++) out.push([tx + dx, ty + dy]);
      return out;
    };
    const isMouthCandidate = (p) => {
      const tiles = mouthTilesAt(p);
      return tiles.every(([x, y]) => inC(x, y) && !bridgeDeckCells.has(id(x, y)) && foot[id(x, y)] < 0) &&
        tiles.some(([x, y]) => cellSet.has(id(x, y)));
    };
    const mouth = mouthProps[0];
    if (!isMouthCandidate(mouth)) {
      const dir = dirs[firstState.d];
      const side = [-dir[1], dir[0]];
      const candidates = [];
      for (let n = 1; n <= 8; n++) {
        candidates.push({ x: mouth.x + dir[0] * n, y: mouth.y + dir[1] * n, n, side: 0 });
        candidates.push({ x: mouth.x + side[0] * n, y: mouth.y + side[1] * n, n, side: 1 });
        candidates.push({ x: mouth.x - side[0] * n, y: mouth.y - side[1] * n, n, side: 2 });
      }
      const next = candidates.find(isMouthCandidate);
      if (next) { mouth.x = next.x; mouth.y = next.y; }
    }
  }
  const bridgeReserveCells = [
    ...bridgeDeckCells,
    ...bridgeSideReserve,
  ];
  if (opt.reserveOnly) return {
    reserveCells: [
      ...canalCells,
      ...bridgeReserveCells.map((k) => [k % cols, (k / cols) | 0]),
    ],
    states: allStates,
    past: routePast,
    to: routeTo,
  };
  for (const k of cells) g[k] = WATER;
  // finalize() が出口へ延ばした単独の土道が、水路の曲がり角の横に1マスだけ
  // 残ることがある。これは水路と平行な通りではないため、足元や扉を壊さない
  // 範囲で草地へ戻し、ascii の「水路の脇を通り・路地が流れる」を避ける。
  for (const k of cells) {
    const x = k % cols, y = (k / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inG(nx, ny)) continue;
      const nk = id(nx, ny);
      if ((original[nk] === STREET || original[nk] === DIRT) &&
        !bridgeCells.has(nk) && foot[nk] < 0 && !buildingWalkRow[nk] && !front[nk] && !plazaM[nk] && !terraceMask[nk]) g[nk] = GRASS;
    }
  }
  // bridge-h / bridge-v の deck は絵の都合で道路を前後2行覆う。
  // 1行幅の土の路地を横切る場合も、deck の水でないマスを橋の取り付け道にして
  // 草地が橋の下へ見えないようにする（footprint・水路上の建物には重ならない）。
  for (const p of bridgeProps) {
    const d = propArt[p.type].deck;
    const x0 = Math.floor((p.x * 16 + d[0]) / 16), x1 = Math.floor((p.x * 16 + d[0] + d[2] - 0.001) / 16);
    const y0 = Math.floor((p.y * 16 + d[1]) / 16), y1 = Math.floor((p.y * 16 + d[1] + d[3] - 0.001) / 16);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (inC(x, y) && g[id(x, y)] !== WATER && foot[id(x, y)] < 0) {
        g[id(x, y)] = original[id(x, y)] === GRASS ? STREET : DIRT;
      }
    }
  }
  // 橋の絵は通り1行より背が高い版もある。水でない deck の下だけを
  // 舗装にして、絵の端が草地・街の外へ浮かないようにする。
  for (const k of deckCells) if (!cells.has(k) && original[k] === GRASS) g[k] = STREET;
  return {
    cells: canalCells,
    states: allStates,
    from: 'well',
    past: routePast,
    to: routeTo,
    crossings: crossings.sort((a, b) => a.y - b.y || a.x - b.x),
    bridgeProps,
    mouthProps,
    bridgeCells: [...bridgeCells].map((k) => [k % cols, (k / cols) | 0]),
    bridgeDeckCells: [...bridgeDeckCells].map((k) => [k % cols, (k / cols) | 0]),
    bridgeReserveCells: bridgeReserveCells.map((k) => [k % cols, (k / cols) | 0]),
  };
}
