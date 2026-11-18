// 石垣の共通描画。運河と段が同じ色・粒・丸めを使う。
import { F_FOOT } from './constants.mjs';
import { hash2 } from './noise.mjs';
import { samp } from './fields.mjs';
import { lumOf, stats } from './texture-analysis.mjs';

export function prepareMasonry(S) {
  const { W, H, flg, out, GRIME, SEED } = S;
  const { WALL, PLZ, PMEAN } = S.X;
  // ---- 石垣の共通部品（段と水路の岸で同じ石の色・粒・目地を使う）
  const masonry = (() => {
    const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const mul = (x, y, k) => { if (!inMap(x, y) || flg[y * W + x] & F_FOOT) return; const o = (y * W + x) * 4; out[o] *= k; out[o + 1] *= k; out[o + 2] *= k; };
    const put = (x, y, c, k) => { if (!inMap(x, y) || flg[y * W + x] & F_FOOT) return; const o = (y * W + x) * 4; out[o] = c[0] * k; out[o + 1] = c[1] * k; out[o + 2] = c[2] * k; };
    // 石の地の色（平均）と粒（明るさの比、弱め）
    const SRC = WALL ?? PLZ, SM = stats(SRC).m, SL = 0.299 * SM[0] + 0.587 * SM[1] + 0.114 * SM[2];
    const BASE = [PMEAN[0] * 0.8, PMEAN[1] * 0.79, PMEAN[2] * 0.78];         // 石垣の石は広場の石と同じ色の系統（粒は wall.png）
    const grain = (x, y) => {
      const o = ((((y % SRC.height) + SRC.height) % SRC.height) * SRC.width + (((x % SRC.width) + SRC.width) % SRC.width)) * 4;
      return 1 + 0.55 * (lumOf(SRC.data, o) / SL - 1);
    };
    const grimeAt = (x, y) => 1 + 0.16 * (samp(GRIME, x, y) - 0.5);
    const tone = (key) => 0.72 + 0.42 * hash2(key, 7, SEED + 611);            // 石ごとの明るさ
    const warm = (key) => hash2(key, 8, SEED + 612);
    // 1 段の切り石: 世界の x を、長さ 7〜15px の石に区切る（段ごとにずらす）
    const blockAt = (x, course) => {
      x = Math.floor(x);
      const L = 11, sh = course * 37, cell = Math.floor((x + sh) / L);
      const st = (c) => c * L - sh + ((hash2(c, course, SEED + 613) * 8) | 0) - 4;   // 継ぎ目の位置を前後にずらす
      let c = cell; if (x < st(c)) c--; else if (x >= st(c + 1)) c++;
      const a = st(c), b = st(c + 1);
      return { key: c * 7 + course, lx: x - a, len: b - a };
    };
    // 階段の踏み石だけ粒を差し替えられる。石垣・水路・袖の既定の色と粒はそのまま。
    const STONE = (x, y, key, k, surfaceGrain = grain(x, y)) => { const w = warm(key) * 0.5; put(x, y, [BASE[0] * (1 + 0.05 * w), BASE[1], BASE[2] * (1 - 0.08 * w)], k * tone(key) * surfaceGrain * grimeAt(x, y)); };
    const MORTAR = [BASE[0] * 0.26, BASE[1] * 0.245, BASE[2] * 0.23];
    return { inMap, mul, put, blockAt, STONE, MORTAR, grimeAt };
  })();

  Object.assign(S, { masonry });
}
