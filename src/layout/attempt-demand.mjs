import { WORKSHOP_ANGLE, clamp } from './constants.mjs';
import { cmp, makeRng } from './util.mjs';
import { moduleGroup } from '../group-components.mjs';
import { goalPlot } from '../overlay/goal.mjs';

// 地区の需要と施設・城の予約寸法をまとめ、施設用乱数を従来の順序で引く。
export function prepareAttemptDemand(S) {
  const { opts, specs, seed, facSpecs, propArt, lms } = S;
  // 工房はひとまとまり、それ以外は最上位ディレクトリごとの地区
  const byKey = new Map();
  const groupOf = (key) => {
    if (!byKey.has(key)) byKey.set(key, { key, items: [], ruins: [] });
    return byKey.get(key);
  };
  for (const s of specs) {
    if (moduleGroup(s.module) !== undefined) groupOf(`\u0000group:${s.module.group}`).items.push(s);
    else if (s.module.kind === 'workshop') groupOf('\u0000workshops').items.push(s);
    else if (s.module.kind === 'ruin') groupOf(s.district).ruins.push(s);
    else groupOf(s.district).items.push(s);
  }
  const demand = (g) => [...g.items, ...g.ruins].reduce((t, s) => t + s.w + 1.6, 0);
  const groups = [...byKey.values()].sort((a, b) => {
    if (a.key === '\u0000workshops') return -1;
    if (b.key === '\u0000workshops') return 1;
    return demand(b) - demand(a) || cmp(a.key, b.key);
  });
  for (const g of groups) g.items.sort((a, b) => cmp(a.district, b.district) || cmp(a.module.path, b.module.path));
  const total = groups.reduce((t, g) => t + demand(g), 0) || 1;
  let a = WORKSHOP_ANGLE - (groups[0] ? (Math.PI * demand(groups[0])) / total : 0);
  groups.forEach((g, i) => {
    g.index = i;
    g.a0 = a;
    a += (2 * Math.PI * demand(g)) / total;
    g.a1 = a;
  });

  // 施設の置き場所: 役場は広場の北、酒場は広場のきわ、宿屋は大通りの入口、道場・倉庫は別々の地区、見張り台は外縁、
  // 船着場は南の岸。修理小屋は工房の近く、工房が無ければ外縁。
  const frng = makeRng(seed ^ 0x51ed270b);
  const fac = { hall: null, pub: null, inn: null, dock: null, early: [], late: [],
    hallSide: frng() < 0.5 ? -1 : 1, pubSide: frng() < 0.5 ? -1 : 1, innSide: frng() < 0.5 ? -1 : 1 };
  const slots = [-0.95, 1.2, 2.35, -2.3].map((a) => a + (frng() - 0.5) * 0.3);
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(frng() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  for (const s of facSpecs) {
    if (s.archetype === 'town_hall') fac.hall = s;
    else if (s.archetype === 'pub') fac.pub = s;
    else if (s.archetype === 'inn') fac.inn = s;
    else if (s.archetype === 'dock') fac.dock = s;
    else if (s.archetype === 'watchtower') fac.late.push({ ...s, angle: slots.pop() ?? -Math.PI / 2 });
    else if (s.archetype === 'repair') {
      const hasWorkshop = specs.some((s) => s.module.kind === 'workshop');
      if (hasWorkshop) fac.early.push({ ...s, angle: WORKSHOP_ANGLE });
      else fac.late.push({ ...s, angle: Math.PI / 2 });
    }
    else fac.early.push({ ...s, angle: slots.pop() ?? Math.PI / 2 });
  }
  // 水の深さ: 桟橋が届く行に、岸から2行ぶんの余水を足す
  let pierRows = 0;
  for (const t of ['pier', 'pier-2']) if (propArt[t]?.deck) pierRows = Math.max(pierRows, Math.ceil(propArt[t].deck[3] / 16));
  const harbour = { water: clamp(pierRows + 2, 5, 9) };
  const plot = goalPlot(opts.goalLook, propArt);
  const goalSpec = plot ? {
    id: '$goal-site', archetype: 'goal-site', goalSite: true,
    w: plot.w + 2, h: plot.h, roofRows: plot.roofRows,
    doorDx: Math.floor((plot.w + 2) / 2), module: { kind: 'landmark' }, angle: -Math.PI / 2,
  } : null;
  if (goalSpec) fac.early.unshift(goalSpec);
  const all = [...specs, ...facSpecs, ...(goalSpec ? [goalSpec] : [])];
  const maxH = Math.max(4, ...all.filter((s) => s !== fac.hall).map((s) => s.h));
  const need = all.reduce((t, s) => t + s.w + 1.6, 0);
  const gateRows = lms.some((l) => l.archetype === 'gate') && propArt.gate
    ? Math.ceil((propArt.gate.origin?.[1] ?? 64) / 16) : 0;
  Object.assign(S, { groups, fac, harbour, plot, goalSpec, all, maxH, need, gateRows });
}
