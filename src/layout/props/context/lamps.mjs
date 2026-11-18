
// 灯の位置を共有し、候補順を変えずに既存の灯との距離を保つ。
export function prepareLampPlacement(C) {
  const { lamps, tryProp } = C;
  // 街灯: 意味のある所にだけ（広場の縁、施設の扉のわき、通りの角、岸と桟橋、小さな広場・緑地）。互いに離す
  const lampAt = (cands, minD) => {
    for (const [x, y] of cands) {
      if (lamps.some(([lx, ly]) => Math.hypot(lx - x, (ly - y) * 1.2) < minD)) continue;
      if (tryProp('lamp', x, y)) return true;
    }
    return false;
  };
  C.lampAt = lampAt;
}
