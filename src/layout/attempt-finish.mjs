import { moduleGroup, groupComponents } from '../group-components.mjs';
import { stairClearanceConflicts, describeStairConflict } from '../stair-clearance.mjs';
import { doorClearanceConflicts, describeDoorConflict } from '../door-clearance.mjs';

// 芝生の仕上げ後に担当地区と空きを再検査し、最終の Town を返す。
export function finishAttemptTown(S) {
  const { placedProps, town, art, repo, buildings, unplaced, propArt } = S;
  placedProps.finishLawn(town, art);
  for (const m of repo.modules || []) {
    const group = moduleGroup(m);
    if (group === undefined || buildings.some((b) => moduleGroup(b.module) === group &&
      (b.module.path === m.path || b.module.merged?.includes(m.path)))) continue;
    let gap = unplaced.find((u) => u.archetype === 'group' && u.group === group);
    if (!gap) {
      gap = { archetype: 'group', name: group, group, pieces: 0, buildings: [], modules: [],
        reason: '担当のモジュールをまとめた施設を、その施設の配置条件を守って置けなかった' };
      unplaced.push(gap);
    }
    if (!gap.modules.includes(m.path)) gap.modules.push(m.path);
  }
  if (unplaced.length) town.unplaced = unplaced;
  for (const g of groupComponents(town)) {
    const gap = unplaced.find((u) => u.archetype === 'group' && u.group === g.group);
    if (gap) { gap.pieces = g.pieces; gap.buildings = g.components.flat(); }
    else if (g.pieces > 1) {
      unplaced.push({ archetype: 'group', name: g.group, group: g.group, pieces: g.pieces,
        buildings: g.components.flat(), modules: [],
        reason: '施設の固定位置または水路・段の縁により、担当地区を一つにつなげられなかった' });
    }
  }
  if (unplaced.length) town.unplaced = unplaced;
  const conflicts = stairClearanceConflicts(town, art, propArt);
  if (conflicts.length) throw new Error(`layoutTown: ${describeStairConflict(conflicts[0])}`);
  const doorConflictsFinal = doorClearanceConflicts(town, art);
  if (doorConflictsFinal.length) throw new Error(`layoutTown: ${describeDoorConflict(doorConflictsFinal[0])}`);
  return town;
}
