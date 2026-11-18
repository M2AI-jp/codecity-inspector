import { buildCanal } from './canal.mjs';
import { finalize } from './finalize.mjs';
import { generate } from './grid.mjs';
import { moduleGroup } from '../group-components.mjs';

// 格子と水路の候補を同じ順で試し、担当地区の欠落が少ない候補を残す。
export function selectAttemptGrid(S) {
  const { repo, opts, propArt, groups, maxH, need, seed, fac, harbour, gateRows, all,
    rejectedPlacements, doorVariants, stairReservations, art, facSpecs } = S;
  let P = null, F = null, canal = null, lastCanalAttempt = null, bestGroupAttempt = null;
  const acceptGroups = (candidateP, candidateF, candidateCanal) => {
    const missing = (candidateP.groupUnplaced || []).reduce((n, u) => n + u.modules.length, 0);
    if (!missing) return true;
    if (!bestGroupAttempt || missing < bestGroupAttempt.missing) {
      bestGroupAttempt = { P: candidateP, F: candidateF, canal: candidateCanal, missing };
    }
    return false;
  };
  const canalRequested = (repo.facilities || []).some((f) => f.archetype === 'well' && f.facts) &&
    !!propArt['bridge-h']?.deck && !!propArt['bridge-v']?.deck;
  const C = { groups, maxH, need, seed, fac, harbour, gateRows, count: all.length, rejectedPlacements, doorVariants, stairReservations, art,
    goalAt: opts.goalAt };
  const hasGroups = (repo.modules || []).some((m) => moduleGroup(m) !== undefined);
  // 通常の格子で担当が収まらない場合だけ、横幅の違う候補も調べる。
  // 戸口・階段を空けた結果、長い担当が途中で切れるのを避ける。未指定の街の候補は変えない。
  const attempts = [];
  for (const widthExtra of hasGroups ? [0, 8, 16, 24, 32] : [0]) {
    for (let attempt = 0, scale = 1; attempt < 14; attempt++, scale *= 1.15) attempts.push({ scale, widthExtra });
  }
  for (const { scale, widthExtra } of attempts) {
    if (P) break;
    C.widthExtra = widthExtra;
    // 施設ごとの置き場所の列を、試すたびに作り直す（generate は列を書き換える）
    const g2 = groups.map((g) => ({ ...g, items: [...g.items], ruins: [...g.ruins] }));
    const firstP = generate({ ...C, groups: g2, fac: { ...fac, early: [...fac.early], late: [...fac.late] } }, scale);
    if (!firstP) continue;
    if (opts.debug && firstP.groupUnplaced) {
      (opts.debug.groupAttempts ||= []).push({ scale, missing: firstP.groupUnplaced.flatMap((u) => u.modules).length });
    }
    const firstF = finalize(firstP, maxH, { scaffold: !!(propArt.scaffold || propArt['scaffold-2']), gateRows });
    const beforeCanal = firstF.g.slice();
    const firstCanal = buildCanal(firstP, firstF, repo, propArt);
    if (canalRequested) {
      // 最終形の検査を通った港行きは、既に建物と橋の両岸を両立している。
      if (firstCanal?.cells?.length && (firstCanal.to === 'harbour' || !firstP.quay)) {
        if (!acceptGroups(firstP, firstF, firstCanal)) continue;
        P = firstP; F = firstF; canal = firstCanal;
        break;
      }
      // 水路が先に見つかった場合も、橋の deck と両端を建物が覆わないよう
      // 水路・橋の帯を予約して、同じ格子をもう一度建物へ渡す。
      // 最初の配置で水路を置けなかったときは、建物を無視した探索で帯を作る。
      let reserve = null;
      // 先に建物を無視した港行きも試す。最初の建物配置で外向きが
      // 見つかっても、港への道筋を建物の後から奪わない。
      const openHarbour = buildCanal(firstP, { ...firstF, g: beforeCanal }, repo, propArt, { ignoreBuildings: true, reserveOnly: true });
      if (openHarbour?.to === 'harbour') {
        reserve = openHarbour;
      } else if (firstCanal?.cells?.length) {
        reserve = {
          reserveCells: [
            ...firstCanal.cells,
            ...(firstCanal.bridgeReserveCells || firstCanal.bridgeDeckCells || firstCanal.bridgeCells || []),
          ],
          states: firstCanal.states,
          past: firstCanal.past,
          to: firstCanal.to,
        };
      } else {
        reserve = openHarbour;
      }
      if (reserve?.reserveCells?.length) {
        const rg = groups.map((g) => ({ ...g, items: [...g.items], ruins: [...g.ruins] }));
        const reservedP = generate({
          ...C, groups: rg, canalReserve: reserve.reserveCells,
          fac: { ...fac, early: [...fac.early], late: [...fac.late] },
        }, scale);
        if (reservedP && facSpecs.every((s) => reservedP.placed.some((p) => p.spec.id === s.id))) {
          const reservedF = finalize(reservedP, maxH, { scaffold: !!(propArt.scaffold || propArt['scaffold-2']), gateRows });
          const reservedCanal = buildCanal(reservedP, reservedF, repo, propArt, {
            forcedStates: reserve.states, forcedPast: reserve.past, forcedTo: reserve.to,
          });
          if (!reservedCanal?.unplaced && (!reserve.to || reservedCanal.to === reserve.to)) {
            if (!acceptGroups(reservedP, reservedF, reservedCanal)) {
              // 港行きの予約が担当を分断する場合、既に成立した外向き水路と連続地区を残す。
              if (firstP.groupUnplaced && firstCanal?.cells?.length && acceptGroups(firstP, firstF, firstCanal)) {
                P = firstP; F = firstF; canal = firstCanal;
                break;
              }
              continue;
            }
            P = reservedP; F = reservedF; canal = reservedCanal;
            break;
          }
        }
      }
      // 予約で固定施設が置けなくなる場合も、先に見つかった有効な街を
      // 捨てない。最後の失敗候補で有効な水路を上書きしない。
      if (firstP.groupUnplaced && firstCanal?.cells?.length && acceptGroups(firstP, firstF, firstCanal)) {
        P = firstP; F = firstF; canal = firstCanal;
        break;
      }
      if (!lastCanalAttempt?.canal?.cells?.length) lastCanalAttempt = { P: firstP, F: firstF, canal: firstCanal };
      continue;
    }
    if (acceptGroups(firstP, firstF, firstCanal)) { P = firstP; F = firstF; canal = firstCanal; }
  }
  if (!P && bestGroupAttempt) ({ P, F, canal } = bestGroupAttempt);
  if (!P && lastCanalAttempt) ({ P, F, canal } = lastCanalAttempt);
  Object.assign(S, { P, F, canal, hasGroups });
}
