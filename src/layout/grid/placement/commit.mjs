// 配置の確定: 所有者のある予約と確定済み建物を共有し、仮置きの巻き戻しにも従う。
export function preparePlacementCommit(P) {
  const { S, pinned, id, foot, roofZ, front, clearanceBuilding } = P;
  // 予約した所（役場・船着場）には、その建物しか置かない
  S.pinOwner = null;
  const hitsPinOther = (x0, y0, x1, y1) => pinned.some((p, i) => i !== S.pinOwner && x0 <= p[2] && x1 >= p[0] && y0 <= p[3] && y1 >= p[1]);
  const placed = [];
  const commit = (spec, t, pos, group) => {
    const i = placed.length;
    for (let x = pos.x; x < pos.x + pos.w; x++) {
      for (let yy = pos.y; yy <= pos.yb; yy++) foot[id(x, yy)] = i;
      for (let yy = pos.y - (spec.roofRows ?? 2); yy < pos.y; yy++) roofZ[id(x, yy)] = 1;
      const end = spec.goalSite ? Math.max(t.sd[x - t.x0], pos.yb + 3) : t.sd[x - t.x0];
      for (let yy = pos.yb + 1; yy < end; yy++) front[id(x, yy)] = 1;
    }
    const p = { spec, ...pos, track: t, group, sd: Array.from({ length: pos.w }, (_, k) => t.sd[pos.x + k - t.x0]) };
    p.clearance = clearanceBuilding(spec, pos);
    t.items.push(p);
    placed.push(p);
    return p;
  };

  Object.assign(P, { hitsPinOther, placed, commit });
}
