import { arc } from './angles.mjs';
import { placeOuterFacility } from './outer.mjs';
import { placeInn } from './inn.mjs';
import { selectBuildingTrack } from './tracks.mjs';
import { buildingCandidates, findBuildingPosition } from './candidates.mjs';
import { writeBuilding, advanceBuildingTrack } from './write.mjs';

// 通常建物・施設・廃屋の優先順位を保ち、試行間で同じキューと面を共有する。
export function placeOrdinaryBuildings(S) {
  const { queues, pending, tracks, nominal, seek, commit, advance, cx, fac, px0, px1, scale, denseTracks, trackAffinity, rng, fit } = S;
  const B = { queues, pending, tracks, nominal, seek, commit, advance, cx, fac, px0, px1, scale, denseTracks, trackAffinity, rng, fit, activeTrack: null };
  for (let guard = 0; guard < 20000; guard++) {
    const items = queues.some((q) => q.items.length);
    if (!items && pending.early.length) { pending.late.unshift(...pending.early); pending.early = []; }
    const phase = items ? 'items' : pending.late.length ? 'late' : pending.inn ? 'inn' : queues.some((q) => q.ruins.length) ? 'ruins' : null;
    if (!phase) break;

    if (phase === 'late') {
      if (!placeOuterFacility(B)) return null;
      continue;
    }
    if (phase === 'inn') {
      if (!placeInn(B)) return null;
      continue;
    }

    const { t, tn } = selectBuildingTrack(B);
    if (!t) return null;                               // 入りきらない → 大きな格子でやり直す
    // 地区に置く施設（道場・倉庫など）: 目当ての角度の面が来たら、まずそれを置く
    if (phase === 'items' && pending.early.length) {
      const e = t.dense ? pending.early[0] : tn.r >= 20 ? pending.early.find((s) => arc(tn.theta, s.angle) < 0.45) : null;
      const pos = e && seek(t, e);
      if (pos) { commit(e, t, pos, `\u0000${e.archetype}`); advance(t, pos); pending.early.splice(pending.early.indexOf(e), 1); continue; }
    }
    const cands = buildingCandidates(B, tn, phase);
    let done = false;
    for (const { q } of cands) {
      const best = findBuildingPosition(B, t, q, phase);
      if (!best) continue;
      writeBuilding(B, t, q, phase, best);
      done = true;
      break;
    }
    if (!done) advanceBuildingTrack(B, t);
  }
  if (queues.some((q) => q.items.length || q.ruins.length) || pending.late.length || pending.early.length) return null;
  return true;
}
