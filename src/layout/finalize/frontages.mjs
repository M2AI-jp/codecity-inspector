import { DIRT, GRASS, PLAZA, STREET } from '../constants.mjs';
import { hash32 } from '../util.mjs';

// 建物の正面を歩ける地面にし、隣家との隙間を路地と庭に分ける。
export function paintFrontages(S) {
  const { P, opt, g, kept } = S;
  const { N, id, inG, road, pieces, placed, foot } = P;
  // footprint のすぐ下の行と前庭を、前の通りと同じ舗装（または土）にする。
  // 以前の「2行下がった家だけ草地＋柵」の前庭は作らない。
  for (const p of placed) {
    for (let k = 0; k < p.w; k++) {
      const x = p.x + k, below = g[id(x, p.sd[k])], code = below === PLAZA ? STREET : below || STREET;
      // dense track が未使用の通りとして整理された場合でも、建物直下の1行は
      // 扉から端まで歩ける前庭に戻す。広場・土道・既存の通りはそのまま残す。
      if (below === GRASS) g[id(x, p.sd[k])] = STREET;
      for (let y = p.yb + 1; y < p.sd[k]; y++) g[id(x, y)] = code;
    }
  }
  // 建物の間の路地（下の通りから裏庭を抜けて上の通りへ）と、路地でない隙間
  const gap = new Uint8Array(N);
  for (const t of P.tracks) {
    const items = [...t.items].sort((a, b) => a.x - b.x);
    for (let k = 0; k + 1 < items.length; k++) {
      const a = items[k], b = items[k + 1];
      const gx0 = a.x + a.w, gx1 = b.x - 1, w = gx1 - gx0 + 1;
      if (w < 1 || w > 4) continue;                    // 大きく飛ばした所は庭のまま
      // 工事中の建物の横の1マスは路地にせず草地のまま（足場を立てる所）
      const works = opt.scaffold && ((a.spec.module?.works?.dirty || 0) > 0 || (b.spec.module?.works?.dirty || 0) > 0);
      const lanes = w === 1 ? (works ? [] : [gx0]) : w === 2 ? (a.group !== b.group && !works ? [gx0, gx1] : [hash32(`${a.x}:${b.x}`) % 2 ? gx1 : gx0]) : [gx0 + 1];
      const yTop = Math.min(a.y, b.y);
      for (let x = gx0; x <= gx1; x++) {
        // 通りの向こう側に同じ列で路地が続くなら、ここは路地にしない（十字路を一直線に抜ける線を作らない）
        let across = false;
        {
          const y0 = Math.max(a.sd[0], b.sd[0]), g0 = inG(x, y0) && road[id(x, y0)] >= 0 ? pieces[road[id(x, y0)]].grp : -1;
          let y = y0;
          while (g0 >= 0 && inG(x, y) && road[id(x, y)] >= 0 && pieces[road[id(x, y)]].grp === g0) y++;
          across = y > y0 && inG(x, y) && road[id(x, y)] >= 0 && kept[id(x, y)] === 1;
        }
        if (lanes.includes(x) && !across) {
          // 下の通りから上へ。上に残した通りがあれば半分はそこまで抜け、残りは裏庭の途中まで（行き止まり）
          let top = yTop - 2;
          if (hash32(`gap:${x},${yTop}`) % 2) for (let y = yTop - 1; y >= Math.max(1, yTop - 4); y--) if (g[id(x, y)] === STREET || g[id(x, y)] === DIRT) { top = y + 1; break; }
          let y0 = Math.max(a.sd[0], b.sd[0]);
          for (let y = y0 - 1; y >= top; y--) {
            const k2 = id(x, y);
            if (foot[k2] >= 0 || (g[k2] !== GRASS && g[k2] !== DIRT)) break;
            g[k2] = DIRT;
          }
        } else {
          for (let y = Math.max(a.y, b.y); y <= Math.max(a.yb, b.yb); y++) if (g[id(x, y)] === GRASS && foot[id(x, y)] < 0) gap[id(x, y)] = 1;
        }
      }
    }
  }
  S.gap = gap;
}
