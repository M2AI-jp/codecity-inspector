import { DIRT, GRASS, WATER, clamp } from '../constants.mjs';
import { makeRng } from '../util.mjs';

// 街の外へ土道を延ばし、門を置ける南北の出口を記録する。
export function paintExits(S) {
  const { P, g, crop } = S;
  const { cols, id, inG, pieces, plaza, placed, foot, quay } = P;
  // 街の外へ続く土の道（北・南・西・東）。ゆるく揺れる
  const wob = makeRng(P.cx * 131 + plaza.x0);
  const path = (x, y, dx, dy, w = 1, stair = 0) => {
    let off = 0, next = 3 + Math.floor(wob() * 4);
    for (let s = 0; ; s++) {
      const px = dx ? x + dx * s : x + off, py = dy ? y + dy * s : y + off;
      if (px < crop.x0 || px > crop.x1 || py < crop.y0 || py > crop.y1) break;
      if (g[id(px, py)] === WATER) break;
      for (let k = 0; k < w; k++) {
        const qx = dx ? px : px + k, qy = dy ? py + k : py;
        if (inG(qx, qy) && foot[id(qx, qy)] < 0 && g[id(qx, qy)] === GRASS) g[id(qx, qy)] = DIRT;
      }
      if (s >= next) {
        const prev = off;
        if (stair) { off += stair; next = s + 2 + Math.floor(wob() * 2); }      // 斜めの通りの続き（段々）
        else { if (wob() < 0.6) off = clamp(off + (wob() < 0.5 ? -1 : 1), -2, 2); next = s + 4 + Math.floor(wob() * 5); }
        if (off !== prev) {                             // 段差はつなぐ
          const qx = dx ? x + dx * s : x + off, qy = dy ? y + dy * s : y + off;
          if (inG(qx, qy) && foot[id(qx, qy)] < 0 && g[id(qx, qy)] === GRASS) g[id(qx, qy)] = DIRT;
          const rx = dx ? x + dx * s : x + prev, ry = dy ? y + dy * s : y + prev;
          if (dx) { for (let yy = Math.min(y + prev, y + off); yy <= Math.max(y + prev, y + off); yy++) if (g[id(rx, yy)] === GRASS && foot[id(rx, yy)] < 0) g[id(rx, yy)] = DIRT; }
          else { for (let xx = Math.min(x + prev, x + off); xx <= Math.max(x + prev, x + off); xx++) if (g[id(xx, ry)] === GRASS && foot[id(xx, ry)] < 0) g[id(xx, ry)] = DIRT; }
        }
      }
    }
  };
  const avNs = pieces.filter((p) => p.kind === 'avenue' && p.dir === 'v' && p.y1 < plaza.y0), avSs = pieces.filter((p) => p.kind === 'avenue' && p.dir === 'v' && p.y0 > plaza.y0);
  const topN = avNs.filter((p) => p.keep).sort((a, b) => a.keep[0] - b.keep[0])[0] || avNs.sort((a, b) => b.y1 - a.y1)[0];
  // 南北の通りが街の外へ出る所（門を置ける所）: 通りの列 x..x+1、端の行 end、外へ dir（-1 北・1 南）、土の道の始まりの列 col
  const exits = [];
  if (topN) {
    const end = topN.keep ? topN.keep[0] : topN.y1 + 1;
    path(topN.x0, end - 1, 0, -1, 1);
    exits.push({ dir: -1, x: topN.x0, end, col: topN.x0 });
  }
  const botS = avSs.filter((p) => p.keep).sort((a, b) => b.keep[1] - a.keep[1])[0] || avSs.sort((a, b) => a.y0 - b.y0)[0];
  if (!quay && botS) {
    const end = botS.keep ? botS.keep[1] : botS.y0 - 1;
    path(botS.x0 + 1, end + 1, 0, 1, 1, P.aSdir);
    exits.push({ dir: 1, x: botS.x0, end, col: botS.x0 + 1 });
  }
  // 大通りの両端から西と東へ。宿屋のある側は2行の街道
  let hw = Infinity, he = -Infinity;
  for (const pc of pieces) if (pc.kind === 'high' && pc.keep) { hw = Math.min(hw, pc.keep[0]); he = Math.max(he, pc.keep[1]); }
  const inn = placed.find((p) => p.spec.archetype === 'inn' && p.track.high);
  const innW = inn && inn.x < P.cx, innE = inn && inn.x > P.cx;
  if (Number.isFinite(hw)) path(hw - 1, P.Htop[Math.max(1, hw - 1)] + 1, -1, 0, innW ? 2 : 1);
  if (Number.isFinite(he)) path(he + 1, P.Htop[Math.min(cols - 2, he + 1)] + 1, 1, 0, innE ? 2 : 1);
  S.exits = exits;
}
