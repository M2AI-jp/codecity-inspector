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


export function traceCanal(S) {
  const { opt, decode, laneAllowed, edgeDefs, startsFor, past, targetGoals, harbourStates, outsideStates, astarVia, astar, cannotPlace, laneCells, inC, id, cols } = S;
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
  Object.assign(S, { allStates, routePast, routeTo, cells, canalCells, cellSet });
}
