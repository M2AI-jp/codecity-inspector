import { resolveAt } from '../resolve.mjs';
import { GOAL_ART, GOAL_SITE_REASONS, goalPlot, goalGeometry } from '../goal.mjs';
import { propCells } from '../../town-grid.mjs';
import { xy } from './space.mjs';
// 城を先に試し、採用した足元・屋根・前庭を後続の物と人のために予約する。
export function placeLandmark(S) {
  const { town, overlay, manifest, data, nearby, propArt, cellOK, clearRects, keepTilePaths,
    reach, accessible, addedRects, reservedRects, occupied, reserved, targets, reject } = S;
  if (overlay.goal?.look) {
    const g = overlay.goal, key = GOAL_ART[g.look], def = manifest.props?.[key];
    const target = resolveAt(town, g.at, { kind: 'goal' });
    let reason = target.reason || (!goalPlot(g.look, manifest.props) ? `missing solid goal art: ${key}` : null);
    const detail = { part: 'landmark', look: g.look };
    if (!reason) {
      const distance = town.goalSite && Math.hypot(town.goalSite.x - target.x, town.goalSite.y - target.y);
      const site = town.goalSite?.look === g.look &&
        distance <= 24 ? town.goalSite : null;
      detail.site = { stage: site ? 'candidate' : town.goalSite ? 'distance' : 'layout',
        ...(distance !== undefined ? { distance } : {}) };
      detail.attempts = {};
      // Prefer the plot reserved by layout. Direct placeOverlay callers may use
      // existing open land. Never move or erase buildings, props or terraces.
      const candidates = [...(site ? [site] : []), ...nearby(target, 16).map((p) => ({ x: p.x - .5, y: p.y }))];
      for (const pos of candidates) {
        const prop = { type: 'castle', look: key, x: pos.x, y: pos.y, overlayId: `goal:${g.id}` };
        const geo = goalGeometry(prop, def), cells = propCells(prop, propArt);
        const failed = (stage) => {
          detail.attempts[stage] = (detail.attempts[stage] || 0) + 1;
          if (pos === site) detail.site.stage = stage;
        };
        const blocked = [
          ['footprint', cells], ['front', geo.cells(geo.front)],
          ['sides', geo.sides.flatMap(geo.cells)], ['roof', geo.cells(geo.image)],
        ].find(([, tiles]) => !tiles.every(([x, y]) => cellOK(x, y)));
        if (blocked) { failed(blocked[0]); continue; }
        // The solid footprint must sit on one level, never across a terrace edge.
        const level = ([x, y]) => (town.terraces || []).filter((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h).length;
        if (new Set(cells.map(level)).size !== 1) { failed('level'); continue; }
        const label = { x: pos.x, y: pos.y + 11 / 16 };
        const frontPoints = geo.cells(geo.front).map(([x, y]) => ({ x: x * 16 + 8, y: y * 16 + 11 }));
        const clear = [geo.foot, geo.front, ...geo.sides];
        if (!clearRects(clear)) { failed('collision'); continue; }
        if (!keepTilePaths(cells)) { failed('tile-path'); continue; }
        if (!reach.attempt([geo.foot], (seen) => accessible(seen, [label]) &&
          frontPoints.every((p) => seen[p.y * reach.W + p.x]))) { failed('reach'); continue; }
        keepTilePaths(cells, true); addedRects.push(geo.foot);
        // Tile reservations alone miss signs/boards whose solids overhang a tile.
        reservedRects.push(geo.front, ...geo.sides);
        for (const [x, y] of [...cells, ...geo.cells(geo.image)]) occupied.add(xy(x, y));
        for (const [x, y] of geo.clearance) reserved.add(xy(x, y));
        data.goal = { ...g, ...label, landmark: { x: pos.x, y: pos.y, look: key },
          front: { x: geo.front.x / 16, y: geo.front.y / 16, w: geo.front.w / 16, h: geo.front.h / 16 } };
        town.props.push(prop); data.props.push(prop); targets.push(data.goal);
        break;
      }
      if (!data.goal) reason = 'no safe level space for goal landmark and clear front';
    }
    if (reason) {
      if (detail.site) detail.site.reason = GOAL_SITE_REASONS[detail.site.stage];
      reject(g, 'goal', reason, detail);
    }
  }
}
