// 同じ通りの隣家の間隔。並べ替えと3マスの舗装条件を保つ。
export function gapsOf(town) {
  const { buildings } = town;
  const gaps = [0, 0, 0, 0];
  const sorted = [...buildings].sort((a, b) => a.x - b.x || a.door.y - b.door.y || a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    let next = null;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.x < a.x + a.w) continue;
      if (Math.abs((b.door?.y ?? b.y + b.h - 1) - (a.door?.y ?? a.y + a.h - 1)) > 1) continue;
      next = b;
      break;
    }
    if (!next) continue;
    const gap = next.x - (a.x + a.w);
    // 4マス以上離れているものは同じ通りの「隣」ではなく、別の街区の建物として除く。
    // 旧規則の上限3マスだけを 3+ バケットに残し、その間の前面が舗装されているものに限る。
    if (gap < 0 || gap > 3) continue;
    if (gap >= 3) {
      const row = Math.round(((a.door?.y ?? a.y + a.h - 1) + (next.door?.y ?? next.y + next.h - 1)) / 2) + 1;
      if (![...Array(gap)].every((_, k) => '#:+'.includes(town.ground[row]?.[a.x + a.w + k] ?? ' '))) continue;
    }
    gaps[Math.min(gap, 3)]++;
  }
  return gaps;
}
