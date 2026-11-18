import { WATER } from '../../constants.mjs';
// 丸めた占有マスからはみ出す当たりも調べ、隣の歩行面の分断を防ぐ。
export function prepareSolidEdges(C) {
  const { N, propArt, id, walk, g, stairReserved, goalReserved, reserved, cols, locallySafe, flood } = C;
  const solidEdges = new Uint8Array(N);
  C.hasSolidEdges = false;
  const propVariants = new Map();
  for (const [key, def] of Object.entries(propArt)) {
    const type = key.replace(/-\d+$/, '');
    if (!propVariants.has(type)) propVariants.set(type, []);
    propVariants.get(type).push(def);
  }
  const findSolidEdges = (type, tx, ty, fw, fh, offsetX, look, tiles, force) => {
    // 丸めた占有幅や壁寄せ後の足場から、solid が隣の歩行マスへ出ることがある。
    // そのマスも到達性検査に含める。建物・既に塞がったマスは二重に数えない。
    // 見た目の版は切り出し後の座標で決まるので、未指定なら各版の当たりを含める。
    const ax = (tx + fw / 2 + offsetX) * 16, ay = (ty + fh) * 16;
    const defs = look ? [propArt[look]] : propVariants.get(type) || [];
    const occupied = new Set(tiles.map(([x, y]) => id(x, y)));
    const edges = [];
    for (const def of defs) for (const b of def?.solids || (def?.solid ? [def.solid] : [])) {
      for (let y = Math.floor((ay + b[1]) / 16); y < Math.ceil((ay + b[1] + b[3]) / 16); y++) {
        for (let x = Math.floor((ax + b[0]) / 16); x < Math.ceil((ax + b[0] + b[2]) / 16); x++) {
          if (!walk(x, y) || occupied.has(id(x, y))) continue;
          if (g[id(x, y)] === WATER || stairReserved[id(x, y)] || goalReserved[id(x, y)] || (reserved[id(x, y)] && !force)) return false;
          occupied.add(id(x, y)); edges.push(id(x, y));
        }
      }
    }
    return { occupied, edges };
  };
  const physicalBefore = (occupied, edges) => {
    // 各マスを塞いでも周囲がつながるなら全体探索は不要。細い通路だけ flood で確かめる。
    let physical = null;
    if (C.hasSolidEdges || edges.length) {
      const staged = [];
      let safe = true;
      for (const k of occupied) {
        if (solidEdges[k]) continue;
        if (!locallySafe(k % cols, Math.floor(k / cols), solidEdges)) { safe = false; break; }
        solidEdges[k] = 1; staged.push(k);
      }
      for (const k of staged) solidEdges[k] = 0;
      if (!safe) physical = flood(solidEdges);
    }
    return physical;
  };
  Object.assign(C, { solidEdges, findSolidEdges, physicalBefore });
}
