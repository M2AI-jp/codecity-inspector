import { DIRT, GRASS, OUT, PLAZA, STREET, WATER } from '../constants.mjs';

// 小さな街の端に残る草地を詰め、森だけで街を広げない。
export function trimTownEdges(S) {
  const { P, g, kept, crop } = S;
  const { id, plazaM, placed, foot, quay } = P;
  // 建物が少ない街では、切り出し枠の角に残る草地だけを街の外へ戻す。
  // 端の森を2マスだけ詰めて、建物から6マス以内の街区を過大にしない。
  // 通り・階段・建物・小物の置き場には触れない。
  if (!quay && placed.length <= 8) {
    const edge = [];
    for (let x = crop.x0; x <= crop.x1; x++) { edge.push([x, crop.y0], [x, crop.y1]); }
    for (let y = crop.y0 + 1; y < crop.y1; y++) { edge.push([crop.x0, y], [crop.x1, y]); }
    let trimmed = 0;
    for (const [x, y] of edge) {
      const k = id(x, y);
      if (g[k] !== GRASS || foot[k] >= 0 || kept[k] || plazaM[k]) continue;
      g[k] = OUT;
      if (++trimmed >= 2) break;
    }
  }
}

// 小物を置く段階が森・裏庭・街内を区別できるよう、距離と草地を分類する。
export function classifyGrass(S) {
  const { P, maxH, g, gap, crop } = S;
  const { cols, N, id, inG, foot, roofZ, front } = P;
  // 建物・道から離れた所の距離（森の深さ）
  const dist = new Int32Array(N).fill(1 << 20);
  const dq = [];
  for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
    const t = id(x, y);
    if ((g[t] !== GRASS && g[t] !== WATER) || foot[t] >= 0) { dist[t] = 0; dq.push(t); }
  }
  for (let h = 0; h < dq.length; h++) {
    const t = dq[h], x = t % cols, y = (t / cols) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < crop.x0 || ny < crop.y0 || nx > crop.x1 || ny > crop.y1) continue;
      const n = id(nx, ny);
      if (dist[n] > dist[t] + 1) { dist[n] = dist[t] + 1; dq.push(n); }
    }
  }
  // 裏庭（上の通りと、下の建物の屋根の間で見えている草地）と、街の内側の草地
  const garden = new Uint8Array(N), inside = new Uint8Array(N);
  const built = (k) => foot[k] >= 0 || g[k] === STREET || g[k] === DIRT || g[k] === PLAZA;
  for (let x = crop.x0; x <= crop.x1; x++) {
    for (let y = crop.y0; y <= crop.y1; y++) {
      const t = id(x, y);
      if (g[t] !== GRASS || foot[t] >= 0) continue;
      let up = false, dn = false;
      for (let d = 1; d <= 10 && !up; d++) if (inG(x, y - d) && built(id(x, y - d))) up = true;
      for (let d = 1; d <= 10 && !dn; d++) if (inG(x, y + d) && built(id(x, y + d))) dn = true;
      if (!up || !dn) continue;
      inside[t] = 1;
      // 下に建物（または通り）が近く、屋根の下ではない所
      let below = false;
      for (let d = 1; d <= maxH + 4 && !below; d++) { const k = id(x, y + d); if (!inG(x, y + d)) break; if (foot[k] >= 0) below = true; else if (g[k] !== GRASS) break; }
      if (below && !roofZ[t] && !front[t] && !gap[t]) garden[t] = 1;
    }
  }
  Object.assign(S, { dist, garden, inside });
}
