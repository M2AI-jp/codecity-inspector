// 地面の共通定義。段階が同じ種別・幅・キャッシュ版を参照する。
import path from 'node:path';

export const GROUND_VERSION = 20;          // 見た目を変えたら上げる（キャッシュの鍵に入る）
export const T = 16;
export const DEFAULT_ART = path.resolve(import.meta.dirname, '../../art/game');
export const TEX_NAMES = ['street', 'grass', 'dirt', 'plaza', 'moss'];
export const OPT_TEX = ['water', 'quay', 'wall'];  // 無くてもよい texture（wall: 段の石垣の前面。高さ 16px、横に継ぎ目なし、上 4px が笠石）

// tile の種別
export const TG = 0, TS = 1, TD = 2, TP = 3, TW = 4, TO = 5;
export const TILE_OF = { '.': TG, '#': TS, ':': TD, '+': TP, '~': TW, ' ': TO };
// pixel の種別
export const GRASS = 0, COBBLE = 1, DIRT = 2, SLAB = 3, WATER = 4, KERB = 5, FRAME = 6;
// pixel の印
export const F_FOOT = 1, F_V = 2, F_GUTTER = 4, F_INFILL = 8, F_LOOSE = 16, F_RISER = 32, F_DIRTJ = 64, F_OUT = 128;
export const ROTATE_SETTS = false;   // 南北の通りで石の texture を 90° 回すか
export const KW = 3;          // 縁石の幅（px）
export const FW = 6;          // 広場の縁石の幅（目地1 + 石4 + 目地1）
