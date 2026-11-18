// 所属と低周波ノイズの場。分類と色が同じぼかし結果を読む。
import { T, TG, TS, TD, TW, TO } from './constants.mjs';
import { fbm } from './noise.mjs';
import { lattice, boxBlur } from './fields.mjs';

export function prepareFields(S) {
  const { tc, cols, rows, W, H, canalTile, SEED } = S;
  // ---- tile の所属をぼかした場（2px 格子）
  const tileAtPx = (px, py) => tc[Math.min(rows - 1, (py / T) | 0) * cols + Math.min(cols - 1, (px / T) | 0)];
  const harbourTileAtPx = (px, py) => {
    const tx = Math.min(cols - 1, (px / T) | 0), ty = Math.min(rows - 1, (py / T) | 0);
    return canalTile[ty * cols + tx] ? TO : tc[ty * cols + tx];
  };
  const memb = (pred, radii, at = tileAtPx) => { const F = lattice(W, H, 2, (px, py) => (pred(at(px, py)) ? 1 : 0)); for (const r of radii) boxBlur(F, r); return F; };
  const Sm = memb((t) => t === TS, [2, 2]);
  const Dsm = memb((t) => t === TD, [2, 2]);
  const Gm = memb((t) => t === TG || t === TO, [3, 3, 2]);
  const Dm = memb((t) => t === TD, [3, 3, 2]);
  const Wm = memb((t) => t === TW, [3, 3, 2], harbourTileAtPx);
  // 低周波のノイズ場
  const GRIME = lattice(W, H, 4, (x, y) => fbm(x / 46, y / 46, SEED + 51));
  const MOSSY = lattice(W, H, 4, (x, y) => fbm(x / 30, y / 30, SEED + 61));
  const DTONE = lattice(W, H, 4, (x, y) => fbm(x / 20, y / 20, SEED + 71));
  const STAIN = lattice(W, H, 2, (x, y) => fbm(x / 14, y / 14, SEED + 97));
  const JMOSS = lattice(W, H, 4, (x, y) => fbm(x / 36, y / 36, SEED + 98));
  const LUSH = lattice(W, H, 4, (x, y) => fbm(x / 70, y / 70, SEED + 23));
  const RUTF = lattice(W, H, 4, (x, y) => fbm(x / 90, y / 90, SEED + 131, 2));
  const EDGEM = lattice(W, H, 2, (x, y) => fbm(x / 5, y / 5, SEED + 91));

  Object.assign(S, { Sm, Dsm, Gm, Dm, Wm, GRIME, MOSSY, DTONE, STAIN, JMOSS, LUSH, RUTF, EDGEM });
}
