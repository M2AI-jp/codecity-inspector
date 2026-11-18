import { resolveAt } from '../resolve.mjs';
// 城を置けない場合も最後に到達可能な名札を探し、城の診断と両立させる。
export function placeGoalLabel(S) {
  const { town, overlay, data, nearby, cellOK, reach, reject } = S;
  if (overlay.goal && !data.goal) {
    // A landmark is optional. Its diagnostic must not erase a reachable label.
    const { look, ...g } = overlay.goal;
    const target = resolveAt(town, g.at, { kind: 'goal', markers: data.markers });
    const pos = !target.reason && nearby(target).map((p) => ({ x: p.x, y: p.y - 5 / 16 })).find((p) =>
      cellOK(Math.floor(p.x), Math.floor(p.y)) && reach.seen[Math.round(p.y * 16) * reach.W + Math.round(p.x * 16)]);
    if (pos) data.goal = { ...g, ...pos };
    else reject(g, 'goal', target.reason || 'no reachable goal location');
  }
}
