import { groupComponents, moduleGroup } from '../../src/group-components.mjs';

export function checkGroups(town, repo, problems, lines) {
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
  return groups;
}
