
// 屋根や背の高い小物による隠れ方と、既存の乱数生成器による選択を共有する。
export function preparePropVisibility(C) {
  const { roofZ, id, foot, props, rng } = C;
  // 先に置いた建物の屋根・背の高い小物（足場・井戸小屋）の陰になる所か（そこに置いた札や材木は見えない）
  const TALL = { scaffold: [1, 4.5], 'scaffold-2': [1.5, 4.5], wellhouse: [2, 3.8], gate: [3, 4.5] };
  const hidden = (tx, ty, fw = 1) => {
    for (let dx = 0; dx < fw; dx++) if (roofZ[id(tx + dx, ty)] || foot[id(tx + dx, ty + 1)] >= 0 || foot[id(tx + dx, ty + 2)] >= 0) return true;
    const cx = tx + fw / 2, cy = ty + 1;
    return props.some((q) => { const t = TALL[q.look || q.type]; return t && q.y > cy + 0.01 && q.y - cy < t[1] && Math.abs(q.x - cx) < t[0] + fw / 2; });
  };
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  Object.assign(C, { hidden, pick });
}
