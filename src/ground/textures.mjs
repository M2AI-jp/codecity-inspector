// texture の読み込み。artDir を鍵に同じ前処理結果を共有する。
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from '../../tools/png.mjs';
import { stats, prepareGrass, segmentSeparated, segment } from './texture-analysis.mjs';

const texCache = new Map();
export function texturePath(artDir, name) {
  const cands = [path.join(artDir, 'ground', `${name}.png`), path.join(artDir, `${name}.png`)];
  const p = cands.find((c) => fs.existsSync(c));
  if (!p) throw new Error(`地面の texture が見つからない: ${cands[0]}`);
  return p;
}
export function loadTextures(artDir) {
  if (texCache.has(artDir)) return texCache.get(artDir);
  const rd = (n) => decodePNG(fs.readFileSync(texturePath(artDir, n)));
  const COB = rd('street'), GRS = rd('grass'), DRT = rd('dirt'), PLZ = rd('plaza'), MOSS = rd('moss');
  // 細かい苔の texture を草地の暗い色へ寄せる（平均・分散の移し替え）
  const a = stats(MOSS), b = stats(GRS);
  for (let i = 0; i < MOSS.width * MOSS.height; i++) for (let c = 0; c < 3; c++) {
    MOSS.data[i * 4 + c] = Math.max(0, Math.min(255, (MOSS.data[i * 4 + c] - a.m[c]) / a.s[c] * b.s[c] * 1.1 + b.m[c] * 1.3));
  }
  const grass = prepareGrass(GRS);
  const opt = (n) => { const f = path.join(artDir, 'ground', `${n}.png`); try { return fs.existsSync(f) ? decodePNG(fs.readFileSync(f)) : null; } catch { return null; } };
  const WAT = opt('water'), QUAY = opt('quay'), WALL = opt('wall');
  const t = {
    COB, GRS, DRT, PLZ, MOSS, GBASE: GRS, sprites: grass.sprites, WAT, QUAY, WALL, WMEAN: WAT ? stats(WAT).m : null,
    segC: segmentSeparated(COB, 4), segP: segment(PLZ, 0),
    CMEAN: stats(COB).m, PMEAN: stats(PLZ).m, DMEAN: stats(DRT).m,
    GLUM: b.m[0] * 0.299 + b.m[1] * 0.587 + b.m[2] * 0.114,
  };
  texCache.set(artDir, t);
  return t;
}
