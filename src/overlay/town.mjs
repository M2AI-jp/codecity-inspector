// CLI's repository facts and living inhabitants; also used after an overlay layout change.
import { resolve } from 'node:path';
import { findCreatures } from '../creatures.mjs';
import { agentForAuthor } from '../analyze.mjs';

export function populateTown(town, model, repoPath) {
  town.groundImage = '/ground.png';
// 小さな生き物（鳩＝依存、犬＝bot、猫＝決まった時間・裏で動く仕事と廃屋）。根拠が無ければ置かない
try { town.creatures = findCreatures(resolve(repoPath), model, town); }
catch (e) { town.creatures = []; console.warn(`生き物を探せなかった: ${e.message}`); }
// 犬になった bot は、人の姿では歩かせない（同じ bot が二重に現れない）
const dogNames = new Set(town.creatures.filter((c) => c.kind === 'dog').map((c) => String(c.name).replace(/-preview$/i, '').toLowerCase()));
if (dogNames.size) town.residents = town.residents.filter((r) => !dogNames.has(String(r.name).replace(/\[bot\]$/i, '').replace(/-preview$/i, '').toLowerCase()));
// 外部工務店（コードを書く外部エージェント）: 工事した建物（モジュール・施設がそのモジュールを含む建物）を歩く代理人。
// 作者そのものがエージェント（copilot-swe-agent[bot] など）の住人は、代理人と二重に現れないよう歩かせない
{
  const idOf = new Map();
  for (const b of town.buildings) {
    if (!b.facility && b.module) idOf.set(b.module.path, b.id);
    for (const m of (b.module && b.module.merged) || []) if (!idOf.has(m)) idOf.set(m, b.id);
    for (const m of (b.facility && b.facility.merged) || []) if (!idOf.has(m)) idOf.set(m, b.id);
  }
  const hall = town.buildings.find((b) => b.facility && b.facility.archetype === 'town_hall');
  town.contractors = (model.agents || []).map((a, i) => {
    const homes = [];
    for (const m of a.modules || []) {
      const id = idOf.get(m);
      if (id && !homes.includes(id)) homes.push(id);
      if (homes.length >= 4) break;
    }
    // 工事した建物が街に無ければ、工事報告を届ける役場のまわり
    if (!homes.length && hall) homes.push(hall.id);
    return { id: `a${i + 1}`, name: a.name, commits: a.commits, recent: a.recent, homes, last: a.last || null };
  }).filter((c) => c.homes.length);
  const agentNames = new Set((model.contributors || []).filter((c) => c.agent).map((c) => c.name));
  if (town.contractors.length) town.residents = town.residents.filter((r) => !agentNames.has(r.name) && !agentForAuthor(r.name));
}
  return town;
}
