// 地面の合成（Node側）: Town の ground（16px tile の文字）から、街全体で1枚の連続した地面画像をつくる。
//   '.' 草地  '#' 石畳の通り  ':' 土の路地  '+' 広場  '~' 水  ' ' 街の外（暗い下草 → 地図の端で闇へ）
// 水は art/game/ground/water.png（あれば。無ければ暗い色）。石畳の通りのすぐ下の水の行には
// quay.png（岸壁の石の帯、横に継ぎ目なし、上端が通りの下端）を重ねる。
// Town.canal.cells の水路は tile 全体を水にし、草地・土・通りへにじまない石垣の岸を重ねる。
// 光は焼き込まない: 石の左上の面取り、一段高い草地が右下に落とす影、夜のゆるい色調だけ。夜の照明はブラウザ側。
// 建物の footprint は無地の地面のまま（建物の絵が覆う）。footprint の下辺・右辺に薄い接地影を置く。
//
//   renderGround(town, artDir) → { width: cols*16, height: rows*16, data: RGBA }
//   groundPNG(town, { artDir, cacheDir }) → { buffer, file, cached, ms }   （os.tmpdir()/codecity-cache に保存して再利用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodePNG } from '../tools/png.mjs';
import { GROUND_VERSION, T, DEFAULT_ART, TEX_NAMES, OPT_TEX } from './ground/constants.mjs';
import { makeRng, hashStr } from './ground/noise.mjs';
import { texturePath, loadTextures } from './ground/textures.mjs';

import { prepareTiles } from './ground/tiles.mjs';
import { prepareFields } from './ground/membership.mjs';
import { classifyPixels } from './ground/classify.mjs';
import { prepareRuts } from './ground/ruts.mjs';
import { prepareDistances } from './ground/distances.mjs';
import { preparePuddles } from './ground/puddles.mjs';
import { paintMaterials } from './ground/colour.mjs';
import { scatterGrass } from './ground/grass.mjs';
import { paintDirtLanes } from './ground/dirt-lanes.mjs';
import { prepareMasonry } from './ground/masonry.mjs';
import { paintQuay } from './ground/quay.mjs';
import { paintCanalBanks } from './ground/canal-banks.mjs';
import { paintTerraces } from './ground/terraces.mjs';
import { paintBuildingShadows } from './ground/shadows.mjs';
import { paintNight } from './ground/night.mjs';
export { GROUND_VERSION };

// ---------------------------------------------------------------- 本体
export function renderGround(town, artDir = DEFAULT_ART) {
  const X = loadTextures(artDir);
  const cols = town.cols, rows = town.rows, W = cols * T, H = rows * T, N = W * H;
  const SEED = hashStr(`${town.repo?.name ?? ''}\n${town.ground.join('\n')}`) & 0xffffff;
  const rng = makeRng(SEED ^ 0x5bd1e995);

  // 同じ配列と rng を順に渡す。各段階の出力は S に加え、画素の書き込み順を保つ。
  const S = { town, X, cols, rows, W, H, N, SEED, rng };
  prepareTiles(S);
  prepareFields(S);
  classifyPixels(S);
  prepareRuts(S);
  prepareDistances(S);
  preparePuddles(S);
  paintMaterials(S);
  scatterGrass(S);
  paintDirtLanes(S);
  prepareMasonry(S);
  paintQuay(S);
  paintCanalBanks(S);
  paintTerraces(S);
  paintBuildingShadows(S);
  paintNight(S);
  return { width: W, height: H, data: S.out };
}

// ---------------------------------------------------------------- キャッシュ
function textureDigest(artDir) {
  const h = crypto.createHash('sha1');
  for (const n of TEX_NAMES) h.update(fs.readFileSync(texturePath(artDir, n)));
  for (const n of OPT_TEX) { const f = path.join(artDir, 'ground', `${n}.png`); if (fs.existsSync(f)) h.update(n).update(fs.readFileSync(f)); }
  return h.digest('hex');
}
export function groundCacheFile(town, { artDir = DEFAULT_ART, cacheDir = path.join(os.tmpdir(), 'codecity-cache') } = {}) {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify({
    v: GROUND_VERSION, tex: textureDigest(artDir), cols: town.cols, rows: town.rows, ground: town.ground,
    b: (town.buildings || []).map((b) => [b.x, b.y, b.w, b.h]),
    c: town.canal?.cells || [], t: town.terraces || [], s: town.stairs || [],
  }));
  const safe = (s) => String(s ?? 'repo').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
  return path.join(cacheDir, `${safe(town.repo?.name)}-${safe(town.repo?.head ?? 'worktree')}-${h.digest('hex').slice(0, 12)}.png`);
}
export function groundPNG(town, opts = {}) {
  const artDir = opts.artDir ?? DEFAULT_ART;
  const file = groundCacheFile(town, { ...opts, artDir });
  if (!opts.noCache) {
    try { return { buffer: fs.readFileSync(file), file, cached: true, ms: 0 }; } catch { /* まだ無い */ }
  }
  const t0 = performance.now();
  const buffer = encodePNG(renderGround(town, artDir), { level: 6 });
  const ms = Math.round(performance.now() - t0);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, file);
  } catch (e) { console.warn(`地面のキャッシュを書けなかった: ${e.message}`); }
  return { buffer, file, cached: false, ms };
}
