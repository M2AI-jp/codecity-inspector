import { resolveAt, doorChoices } from '../resolve.mjs';
import { propCells } from '../../town-grid.mjs';
import { KEEPER_BOX } from '../../../web/config.js';
import { cutCandidates } from './candidates.mjs';
import { xy } from './space.mjs';
// 札・掲示板・門を入力順に置き、門番と既存の到達先を一緒に守る。
export function placeMarkers(S) {
  const { town, overlay, manifest, data, reject, world, doors, doorSpots, nearby, propArt,
    boxes, cellOK, clearRects, keepTilePaths, reach, personSpot, accessible, addedRects, occupied, targets } = S;
  let cuts;
  for (const m of overlay.markers) {
    const target = resolveAt(town, m.at, { kind: m.kind, markers: data.markers });
    if (target.reason) { reject(m, 'markers', target.reason); continue; }
    const type = m.kind === 'record' ? `sign-${m.state}` : m.kind === 'board' ? 'noticeboard' : 'gate';
    if (!manifest.props?.[type]) { reject(m, 'markers', `missing art: ${type}`); continue; }
    if (m.kind === 'gate' && !manifest.characters?.keepers?.gate) { reject(m, 'markers', 'missing art: gate keeper'); continue; }
    const choices = doorChoices(town, target);
    let placed = null;
    const candidates = m.kind === 'gate' ? (cuts ||= cutCandidates(world))
      .filter((p) => Math.hypot(p.x - target.x, p.y - target.y) <= 16)
      .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))
      .map((p) => ({ ...p, building: target.building?.id }))
      : choices.length ? choices.filter((b) => !doors.has(b.id)).flatMap((b) => doorSpots(b).map((p) => ({ ...p, building: b.id })))
        : nearby(target, 5);
    for (const pos of candidates) {
      if (pos.building && doors.has(pos.building)) continue;
      const prop = { type, look: type, x: pos.x, y: pos.y, overlayId: `marker:${m.id}` };
      const cells = propCells(prop, propArt), rs = boxes(prop);
      if (!cells.every(([x, y]) => cellOK(x, y)) || !clearRects(rs) || !keepTilePaths(cells)) continue;
      let keeper;
      if (m.kind === 'gate') {
        const def = manifest.props.gate, op = def.opening;
        if (!op || !manifest.characters?.keepers?.gate) continue;
        const top = pos.y * 16 - (def.origin?.[1] || 88), left = pos.x * 16 - (def.origin?.[0] || 48);
        if (world.buildings.some((b) => left < b.px + b.pw && left + (def.size?.[0] || 96) > b.px &&
          top < b.bottomPx && pos.y * 16 > b.py - (b.arch?.exteriorOrigin?.[1] || 0))) continue;
        if (!reach.cutTile(Math.floor(pos.x), Math.floor(pos.y - 1))) continue;
        // Both ends and every pixel of the central passage must remain walkable.
        const cx = Math.round(pos.x * 16 + op[0] + op[2] / 2);
        let through = true;
        for (let y = Math.round(pos.y * 16 + op[1] - 8); y <= Math.round(pos.y * 16 + op[1] + op[3] + 10); y++) {
          if (!reach.seen[y * reach.W + cx]) { through = false; break; }
        }
        if (!through) continue;
        keeper = personSpot({ x: pos.x + 3.5, y: pos.y + 1 }, [pos], false);
        if (!keeper) continue;
        const kr = { x: keeper.x * 16 + KEEPER_BOX[0], y: keeper.y * 16 + KEEPER_BOX[1], w: KEEPER_BOX[2], h: KEEPER_BOX[3] };
        if (rs.some((r) => r.x < kr.x + kr.w && r.x + r.w > kr.x && r.y < kr.y + kr.h && r.y + r.h > kr.y)) continue;
        rs.push(kr);
      }
      if (!reach.attempt(rs, (seen) => accessible(seen, [pos, ...(keeper ? [keeper] : [])]))) continue;
      keepTilePaths(cells, true);
      addedRects.push(...rs);
      for (const [x, y] of cells) occupied.add(xy(x, y));
      if (keeper) occupied.add(xy(Math.floor(keeper.x), Math.floor(keeper.y)));
      placed = { ...m, x: pos.x, y: pos.y, ...(pos.building ? { building: pos.building } : {}), ...(keeper ? { keeper } : {}) };
      town.props.push(prop); data.props.push(prop); data.markers.push(placed); targets.push(placed);
      if (keeper) targets.push(keeper);
      if (pos.building) doors.add(pos.building);
      break;
    }
    if (!placed) reject(m, 'markers', m.kind === 'gate' ? 'no safe walkable cut point for gate and keeper'
      : choices.length ? 'no safe free doorway in district' : 'no safe space near plaza or landmark');
  }
}
