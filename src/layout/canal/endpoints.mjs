import { GRASS, clamp } from '../constants.mjs';
import { cmp } from '../util.mjs';
import { propTiles } from '../manifest.mjs';

export function chooseEndpoints(S) {
  const { well, placed, inC, laneAllowed, state, propArt, P, plaza, crop, laneCells, original, id, quay, sinkWater } = S;
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
  Object.assign(S, { past, targetGoals, edgeDefs, startsFor, outsideStates, harbourStates });
}
