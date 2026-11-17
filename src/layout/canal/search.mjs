import { DIRT, OUT, STREET, WATER } from '../constants.mjs';

export function createSearch(S) {
  const { id, cols, N, dirs, inG, laneTouchesRoadSide, laneCells, roadDirAt, laneAllowed, original, opt, foot, roofZ, front, buildingWalkRow, facilityWalkRow } = S;
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
  Object.assign(S, { state, decode, heapPush, heapPop, astar });
}

export function createViaSearch(S) {
  const { N, decode, dirs, inG, state, laneTouchesRoadSide, laneCells, roadDirAt, laneAllowed, original, id, opt, foot, roofZ, front, buildingWalkRow, facilityWalkRow, heapPush, heapPop } = S;
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
  S.astarVia = astarVia;
}
