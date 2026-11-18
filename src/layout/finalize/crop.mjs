import { STREET, WATER } from '../constants.mjs';

// 門と港の余地を残して街を切り出し、岸と水を街の幅にそろえる。
export function cropTown(S) {
  const { P, opt, g, setG, kept } = S;
  const { cols, rows, id, pieces, plaza, placed, quay } = P;
  // 切り出す範囲
  // 余白は門・港の候補を残す範囲で小さくし、未使用の森だけで街を広げない。
  let x0 = plaza.x0 - 3, x1 = plaza.x1 + 3, y0 = plaza.y0 - 5, y1 = plaza.y1 + 6;
  for (const p of placed) {
    x0 = Math.min(x0, p.x - 3); x1 = Math.max(x1, p.x + p.w + 2);
    y0 = Math.min(y0, p.y - (p.spec.goalSite ? Math.max(4, p.spec.roofRows) : 4)); y1 = Math.max(y1, p.yb + 4);
  }
  // 門を置く余地: 南北の通りが街の外へ出る所の先に、両わきの建物（と屋根）より外へ、門の絵の高さ＋数行の土の道を残す。
  // 通りの端のすぐ外まで建物が並ぶ街では、切り出す範囲がその建物で止まり、門の立つ所が無くなっていた
  if (opt.gateRows) {
    const near = (p, x) => p.x <= x + 9 && p.x + p.w - 1 >= x - 8;
    const avN = pieces.filter((p) => p.kind === 'avenue' && p.dir === 'v' && p.y1 < plaza.y0);
    const tN = avN.filter((p) => p.keep).sort((a, b) => a.keep[0] - b.keep[0])[0] || [...avN].sort((a, b) => b.y1 - a.y1)[0];
    if (tN) {
      const end = tN.keep ? tN.keep[0] : tN.y1 + 1;
      let top = end;
      for (const p of placed) if (near(p, tN.x0) && p.yb < end + 2) top = Math.min(top, p.y);
      y0 = Math.min(y0, top - opt.gateRows - 4);
    }
    const avS = pieces.filter((p) => p.kind === 'avenue' && p.dir === 'v' && p.y0 > plaza.y0);
    const bS = avS.filter((p) => p.keep).sort((a, b) => b.keep[1] - a.keep[1])[0] || [...avS].sort((a, b) => a.y0 - b.y0)[0];
    if (!quay && bS) {
      const end = bS.keep ? bS.keep[1] : bS.y0 - 1;
      let bot = end;
      for (const p of placed) if (near(p, bS.x0) && p.y > end - 2) bot = Math.max(bot, p.yb);
      y1 = Math.max(y1, bot + opt.gateRows + 4);
    }
  }
  if (quay) y1 = quay.water1;
  const crop = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(cols - 1, x1), y1: Math.min(rows - 1, y1) };
  // 岸の通りは切り出した街の幅いっぱいにする。その下は水（街の幅いっぱい）。
  // 使った桟橋の区間だけを岸にすると、岸の東西端が森で切れて港が見えなくなる。
  if (quay) {
    const a = crop.x0, b = crop.x1;
    for (let x = a; x <= b; x++) {
      const qt = Number.isFinite(quay.qt[x]) ? quay.qt[x] : quay.top;
      for (let y = qt; y <= qt + 1; y++) { g[id(x, y)] = STREET; kept[id(x, y)] = 1; }
      for (let y = qt + 2; y <= crop.y1; y++) setG(x, y, WATER);
    }
    quay.keep = [a, b];
  }
  S.crop = crop;
}
