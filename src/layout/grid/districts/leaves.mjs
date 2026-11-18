import { DIRT, STREET } from '../../constants.mjs';

// 分割後の街区へ小路・中庭を加え、確定した街区を試した順に残す。
export function prepareDistrictLeaves(D) {
  const { ri, chance, rng, hitsPin, meander, roadGroups, addPiece, pieces, isRoad } = D.S;
  const { alignedV, sub, courts, leaves } = D;
  // 街区: 深ければ土の路地（ずれる・ときどき行き止まり）か中庭で2段に、広ければ一度折れる南北の小路で2つに
  function leaf(R, closedTop, lvl) {
    const w = R.x1 - R.x0 + 1, h = R.y1 - R.y0 + 1;
    if (lvl === 0 && w >= 24 && chance(0.35)) {
      for (let t = 0; t < 6; t++) {
        const x = R.x0 + ri(9, w - 10);
        const dj = h >= 10 && chance(0.6) ? (rng() < 0.5 ? -1 : 1) * ri(2, 3) : 0, j = R.y0 + ri(3, Math.max(3, h - 4));
        const xa = Math.min(x, x + dj), xb = Math.max(x, x + dj);
        if (xa < R.x0 + 7 || xb > R.x1 - 7 || hitsPin(xa - 1, R.y0, xb + 1, R.y1) || alignedV(x, x, R.y0, R.y1)) continue;
        let l1 = xa - 1, r0 = xb + 1;
        if (!dj) {
          // 1列ずつ揺れる小路
          const st = meander('v', x, R.y0, R.y1, 1, DIRT, 'alley', { ok: (y, v) => x + v > R.x0 + 6 && x + v < R.x1 - 6 });
          l1 = st.min - 1; r0 = st.max + 1;
        } else {
          // 一度折れる小路（折れた角の内側は小さな裏庭になる）
          const grp = roadGroups.next++;
          addPiece('v', x, R.y0, x, j, DIRT, 'alley', grp);
          addPiece('h', xa, j, xb, j, DIRT, 'alley', grp);
          addPiece('v', x + dj, j, x + dj, R.y1, DIRT, 'alley', grp);
        }
        leaf(sub(R, R.x0, l1, R.y0, R.y1), closedTop, 1);
        leaf(sub(R, r0, R.x1, R.y0, R.y1), closedTop, 1);
        return;
      }
    }
    if (h >= 16 && w >= 14 && chance(courts.length ? 0.4 : 0.9)) {
      // 中庭: 街区の中ほどの小さな舗装の庭に、下の通りから小路が入る。奥の家は中庭に扉を向ける
      for (let t = 0; t < 6; t++) {
        const cw = ri(6, 8), c0 = R.x0 + ri(2, Math.max(2, w - cw - 2)), c1 = c0 + cw - 1, m = R.y0 + ri(8, h - 8), ax = c0 + ri(1, cw - 2);
        if (c1 > R.x1 - 2 || hitsPin(c0 - 1, m - 2, c1 + 1, R.y1)) continue;
        const grp = roadGroups.next++;
        const k = addPiece('h', c0, m - 1, c1, m, STREET, 'court', grp);
        addPiece('v', ax, m + 1, ax, R.y1, DIRT, 'alley', grp);
        if (k >= 0) courts.push(pieces[k]);
        leaves.push({ x0: R.x0, x1: R.x1, y0: R.y0, y1: m - 2, closedTop });
        leaves.push({ x0: R.x0, x1: ax - 1, y0: m + 1, y1: R.y1, closedTop: true });
        leaves.push({ x0: ax + 1, x1: R.x1, y0: m + 1, y1: R.y1, closedTop: true });
        return;
      }
    }
    if (h >= 15 && w >= 12) {
      // 深い街区: 土の路地（下へだけ1行ずつ揺れる。上の家並みの深さを保つ）。ときどき通りのある側から入る行き止まり
      for (let t = 0; t < 6; t++) {
        const du = ri(7, h - 8), m = R.y0 + du;
        if (hitsPin(R.x0, m - 2, R.x1, m + 3)) continue;
        if (chance(0.45)) {
          const lr = isRoad(R.x0 - 1, m), rr = isRoad(R.x1 + 1, m);
          const fromLeft = lr && rr ? rng() < 0.5 : lr;
          const L = Math.round(w * (0.5 + rng() * 0.3));
          if (L < 10 || (!lr && !rr)) continue;
          const a = fromLeft ? R.x0 : R.x1 - L + 1, b = fromLeft ? R.x0 + L - 1 : R.x1;
          meander('h', m, fromLeft ? a : b, fromLeft ? b : a, 1, DIRT, 'lane', { lo: 0, hi: 1 });
          leaves.push({ x0: a, x1: b, y0: R.y0, y1: m - 1, closedTop });
        } else {
          meander('h', m, R.x0, R.x1, 1, DIRT, 'lane', { lo: 0, hi: 1 });
          leaves.push({ x0: R.x0, x1: R.x1, y0: R.y0, y1: m - 1, closedTop });
        }
        leaves.push({ x0: R.x0, x1: R.x1, y0: m + 2, y1: R.y1, closedTop: true });
        return;
      }
    }
    leaves.push({ x0: R.x0, x1: R.x1, y0: R.y0, y1: R.y1, closedTop });
  }
  D.leaf = leaf;
}
