import { resolveAt } from '../resolve.mjs';
import { hash32 } from '../../layout/util.mjs';
import { xy } from './space.mjs';
// 配置済みの札を解決先に含め、人を入力順に置いて次の人の占有へ渡す。
export function placePeople(S) {
  const { town, overlay, manifest, data, reject, personSpot, targets, occupied } = S;
  for (const p of overlay.people) {
    const target = resolveAt(town, p.at, { kind: 'person', markers: data.markers });
    if (target.reason) { reject(p, 'people', target.reason); continue; }
    if (!manifest.characters?.townsfolk?.length) { reject(p, 'people', 'missing townsfolk art'); continue; }
    const pos = personSpot(target);
    if (!pos) { reject(p, 'people', 'no safe reachable space for person'); continue; }
    const person = { ...p, look: p.look ?? hash32(p.id), ...pos };
    data.people.push(person); targets.push(person); occupied.add(xy(Math.floor(pos.x), Math.floor(pos.y)));
  }
}
