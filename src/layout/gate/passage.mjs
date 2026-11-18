import { GRASS, STREET, DIRT } from '../constants.mjs';

// 道と柱を仮置きする。門番を置けない試行は、保存した順で地面を復元する。
export function tryGatePassage(S, C) {
  const { g, id, blocked, flood } = S.ctx;
  const { paint, erase, pillar } = C;
  // 塗って、柱をふさいで、街のどこからでも門の外まで行けるかを確かめる
  const touched = [...paint, ...erase, ...pillar];
  const saved = touched.map(([x, y]) => g[id(x, y)]);
  const restore = () => { touched.forEach(([x, y], i) => { g[id(x, y)] = saved[i]; }); pillar.forEach(([x, y]) => { blocked[id(x, y)] = 0; }); };
  erase.forEach(([x, y]) => { g[id(x, y)] = GRASS; });
  paint.forEach(([x, y]) => { if (g[id(x, y)] !== STREET) g[id(x, y)] = DIRT; });
  pillar.forEach(([x, y]) => { if (g[id(x, y)] !== GRASS) g[id(x, y)] = GRASS; });
  const before = flood().count;
  pillar.forEach(([x, y]) => { blocked[id(x, y)] = 1; });
  C.before = before;
  return restore;
}
