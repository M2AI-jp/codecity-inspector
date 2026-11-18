// 切り出し前の格子・建物・候補位置。同じ種を再試行するときも、他の候補は変えない。
export const placementKey = (cols, rows, spec, x, y) => `${cols},${rows}:${spec.id}:${x},${y}`;
