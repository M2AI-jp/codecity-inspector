import { moduleGroup, neighboringFootprints } from '../../group-components.mjs';
import { cmp } from '../util.mjs';

// 既存の配置手順で施設の場所を確保してから、明示 group の通常建物をまとめて確定する。
// 道・施設・group 未指定の建物を動かさず、同じ fit（屋根・階段・水路予約）を使う。
export function placeGroups(S) {
  if (!S.placed.some((p) => !p.spec.facility && moduleGroup(p.spec.module) !== undefined)) return;
  // 修理小屋の近隣の工房も先に確保する。担当のために工房だけを遠くへ移さない。
  const repairNeighbors = new Set();
  for (const repair of S.placed.filter((p) => p.spec.archetype === 'repair')) {
    const workshop = S.placed.filter((p) => p.spec.module.kind === 'workshop')
      .sort((a, b) => Math.abs(a.x - repair.x) + Math.abs(a.y - repair.y) -
        Math.abs(b.x - repair.x) - Math.abs(b.y - repair.y))[0];
    if (workshop) repairNeighbors.add(workshop);
  }
  const movable = S.placed.filter((p) => !p.spec.facility && !repairNeighbors.has(p) && moduleGroup(p.spec.module) !== undefined);
  if (!movable.length) return;
  const fixed = S.placed.filter((p) => !movable.includes(p));
  for (const t of new Set([...S.tracks, ...S.placed.map((p) => p.track)])) t.items.length = 0;
  S.placed.length = 0;
  S.foot.fill(-1); S.roofZ.fill(0); S.front.fill(0);
  for (const p of fixed) S.commit(p.spec, p.track, p, p.group);

  const groups = new Map();
  for (const p of movable) {
    const key = p.spec.module.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p.spec);
  }
  const anchors = (group) => S.placed.filter((p) => moduleGroup(p.spec.module) === group);
  // 施設を含む担当から置く。次に面積の大きい担当を先に確保する。
  const ordered = [...groups].sort(([a, aa], [b, bb]) =>
    Number(!!anchors(b).length) - Number(!!anchors(a).length) ||
    bb.reduce((n, s) => n + s.w, 0) - aa.reduce((n, s) => n + s.w, 0) || cmp(a, b));
  S.groupUnplaced = [];
  for (const [group, specs] of ordered) {
    specs.sort((a, b) => b.w - a.w || b.h - a.h || cmp(a.module.path, b.module.path));
    const candidates = (s) => {
      const near = anchors(group), result = [], seen = new Set();
      for (const t of S.tracks) {
        if (t.innOnly) continue;
        const affinity = S.trackAffinity(t, group);
        const row = [];
        for (let x = t.x0; x <= t.x1 - s.w + 1; x++) for (const setback of [0, 1, 2]) {
          const pos = S.fit(t, x, s, setback, !!t.dense);
          if (!pos || (near.length && !near.some((p) => neighboringFootprints(pos, p)))) continue;
          const key = `${pos.x},${pos.y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const distance = near.length
            ? Math.min(...near.map((p) => Math.abs(pos.x - p.x) + Math.abs(pos.y - p.y)))
            : Math.abs(pos.x + pos.w / 2 - S.pcx) + Math.abs(pos.y - S.pcy);
          row.push({ s, t, pos, score: distance + affinity * 2 + setback * 0.1 });
        }
        // 先頭を狭い穴に置くと、残りの担当を置けない。実際に fit する連続幅を先に測る。
        if (!near.length) {
          const columns = new Set(row.map((c) => c.pos.x));
          for (const c of row) {
            let left = c.pos.x, right = c.pos.x;
            while (columns.has(left - 1)) left--;
            while (columns.has(right + 1)) right++;
            const room = right - left + s.w;
            const need = specs.reduce((n, p) => n + p.w, 0);
            c.score += Math.max(0, need - room) * 40;
          }
        }
        result.push(...row);
      }
      return result.sort((a, b) => a.score - b.score || a.pos.y - b.pos.y || a.pos.x - b.pos.x);
    };
    // 最初の場所が悪いだけで未配置にしない。最大24候補で担当全体を仮置きして比較する。
    const count = S.placed.length, foot = S.foot.slice(), roof = S.roofZ.slice(), front = S.front.slice();
    const lengths = new Map(S.tracks.map((t) => [t, t.items.length]));
    const restore = () => {
      S.placed.length = count;
      S.foot.set(foot); S.roofZ.set(roof); S.front.set(front);
      for (const [t, length] of lengths) t.items.length = length;
    };
    const starts = candidates(specs[0]).slice(0, 24);
    let chosen = [], pending = [...specs];
    for (const first of starts) {
      restore();
      const todo = [...specs];
      S.commit(first.s, first.t, first.pos, group);
      todo.shift();
      while (todo.length) {
        let next;
        for (let i = 0; i < todo.length; i++) {
          const candidate = candidates(todo[i])[0];
          if (candidate) { next = candidate; todo.splice(i, 1); break; }
        }
        if (!next) break;
        S.commit(next.s, next.t, next.pos, group);
      }
      if (todo.length < pending.length) {
        chosen = S.placed.slice(count);
        pending = todo;
      }
      if (!pending.length) break;
    }
    restore();
    for (const p of chosen) S.commit(p.spec, p.track, p, group);
    if (pending.length) S.groupUnplaced.push({
      archetype: 'group', name: group, group, pieces: 0, buildings: [],
      modules: pending.flatMap((s) => s.module.merged?.length ? [s.module.path, ...s.module.merged] : [s.module.path]),
      reason: '施設・屋根・階段・水路の予約を守り、同じ担当の建物に隣接する空き場所を確保できなかった',
    });
  }
}
