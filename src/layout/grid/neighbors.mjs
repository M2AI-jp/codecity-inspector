
export function placeNeighbors(S) {
  const { fac, hall, trackAt, fit, commit, tracks, flankW, flankE, px0, px1, advance, dockAt, pinned, scale, groups, placed, terraces, kx0, kx1, harbour } = S;
  // 役場・酒場・船着場は先に置く
  const pending = { early: [...fac.early], late: [...fac.late], inn: fac.inn };
  if (hall) {
    const t = trackAt(hall.x, hall.yb);
    S.pinOwner = 0;
    const pos = t && fit(t, hall.x, fac.hall, 0);
    S.pinOwner = null;
    if (pos) commit(fac.hall, t, pos, '\u0000hall');
    else pending.late.unshift({ ...fac.hall, angle: -Math.PI / 2 });
  }
  if (fac.pub) {
    const t = tracks.find((c) => c.L === (fac.pubSide < 0 ? flankW : flankE));
    const x0 = fac.pubSide < 0 ? px0 - fac.pub.w : px1 + 1;
    const pos = t && fit(t, x0, fac.pub, 0);
    if (pos) { commit(fac.pub, t, pos, '\u0000pub'); advance(t, pos); }
    else pending.early.push({ ...fac.pub, angle: fac.pubSide < 0 ? Math.PI : 0 });
  }
  if (dockAt) {
    const t = trackAt(dockAt.x, dockAt.yb);
    S.pinOwner = pinned.length - 1;
    const pos = t && fit(t, dockAt.x, fac.dock, 0);
    S.pinOwner = null;
    if (pos) commit(fac.dock, t, pos, '\u0000dock');
    else if (scale < 2.5) return null;               // 岸に船着場が入らない → 少し大きな格子でやり直す
  }
  // 広場の脇の通り: 酒場の反対側は、広場から外へ
  const queues = groups.map((g) => ({ g, items: [...g.items], ruins: [...g.ruins] }));
  // 役場の左右は、広場の北辺を空けないために先に同じ面へ置く。
  // 通常の面選択へ戻す前に、住宅を優先して左右1棟ずつ確保する。
  if (hall) {
    const hp = placed.find((p) => p.spec.archetype === 'town_hall');
    if (!hp) {
      // 役場がこの格子に入らなかった試行では、通常の pending 処理へ戻す。
      // scale を上げた再試行を壊さないため、ここで隣家を先取りしない。
    } else {
      const terrace = terraces.find((t) => t.hall);
      const row = {
        L: { x0: kx0, x1: kx1, y0: Math.max(1, hall.y - 4), y1: hall.yb, closedTop: true },
        x0: kx0, x1: kx1, dir: -1, cursor: hall.x, items: [], sd: new Int16Array(kx1 - kx0 + 1).fill(hall.yb + 1),
        high: false, closed: true,
      };
      const takeHallNeighbor = (side) => {
        const refs = [];
        for (let qi = 0; qi < queues.length; qi++) for (let si = 0; si < queues[qi].items.length; si++) {
          const s = queues[qi].items[si];
          refs.push({ qi, si, s, house: s.module?.kind === 'house' ? 0 : 1 });
        }
        refs.sort((a, b) => a.house - b.house || a.qi - b.qi || a.si - b.si);
        for (const ref of refs) {
          for (const gap of [0, 1]) {
            const x0 = side < 0 ? hp.x - gap - ref.s.w : hp.x + hp.w + gap;
            // 北の通りが役場の脇を通る場合でも、建物の footprint でその区間を覆える。
            const pos = fit(row, x0, ref.s, 0, true);
            if (!pos) continue;
            queues[ref.qi].items.splice(ref.si, 1);
            commit(ref.s, row, pos, '\u0000hall-row');
            if (terrace) {
              const x1 = pos.x + pos.w - 1;
              const left = Math.min(terrace.x, pos.x), right = Math.max(terrace.x + terrace.w - 1, x1);
              terrace.x = left; terrace.w = right - left + 1;
            }
            return true;
          }
        }
        return false;
      };
      takeHallNeighbor(-1);
      takeHallNeighbor(1);
    }
  }
  // 港の船着場も、左右の水際 frontage を先に建物でつなぐ。
  // 通常のカーソルは船着場の予約へ進んだあと戻らないため、
  // 先取りしないと片側に2〜3マスの空きが残る。
  if (harbour && dockAt) {
    const dockPlaced = placed.find((p) => p.spec.archetype === 'dock');
    const dockTrack = dockPlaced?.track;
    const takeHarbourNeighbor = (side) => {
      if (!dockPlaced || !dockTrack) return false;
      const refs = [];
      for (let qi = 0; qi < queues.length; qi++) for (let si = 0; si < queues[qi].items.length; si++) {
        const s = queues[qi].items[si];
        refs.push({ qi, si, s, house: s.module?.kind === 'house' ? 0 : 1 });
      }
      refs.sort((a, b) => a.house - b.house || a.qi - b.qi || a.si - b.si);
      for (const ref of refs) {
        for (const gap of side < 0 ? [1, 0] : [0, 1]) {
          const x0 = side < 0 ? dockPlaced.x - gap - ref.s.w : dockPlaced.x + dockPlaced.w + gap;
          S.pinOwner = pinned.length - 1;
          const pos = fit(dockTrack, x0, ref.s, 0, true);
          S.pinOwner = null;
          if (!pos) continue;
          queues[ref.qi].items.splice(ref.si, 1);
          commit(ref.s, dockTrack, pos, '\u0000harbour-row');
          return true;
        }
      }
      return false;
    };
    takeHarbourNeighbor(-1);
    takeHarbourNeighbor(1);
  }
  Object.assign(S, { pending, queues });
  return true;
}
