#!/usr/bin/env node
// 街を文字で表示して目で確かめる道具。
//   node tools/ascii-town.mjs <repoPath | town.json> [--check] [--no-props] [--manifest art/game/manifest.json]
// 建物: W 工房 / S 商店 / H 住宅 / R 廃屋 / G 役場 / Y 宿屋 / P 酒場 / K 倉庫 / M 見張り台 / D 道場 / Q 船着場 / E 修理小屋（扉は小文字）。
// 地面: . 草地 # 石畳 : 土の路地 + 広場 ~ 水（空白は街の外）
// 小物: T 木 * 茂み o 樽 x 木箱 % 袋 f 鉢 v プランター c 荷車 = 柵 n ベンチ i 街灯 O 井戸 N 掲示板 & 井戸小屋 | 桟橋 ^ 舟 ∩ 水路口 ─ 橋-h │ 橋-v
//       ! 足場 $ 工事中の札 ✓ 検査通過済み × 壊れている ? 未確認 _ 材木 [ 門の柱（くぐれる所は地面のまま） / k 外に立つ番人 / " 段の前の壁 ; 階段 / @ 開始位置
// --districts: 建物を種類ではなく地区（最上位ディレクトリ）ごとの文字で描く
// --check: 重なり・版ごとの屋根の余白・footprint の下の行（幅いっぱい歩けて広場から届く）・同じ入力で同じ出力になるか。問題があれば終了コード1
import { readFileSync } from 'node:fs';
import { analyzeRepository } from '../src/analyze.mjs';
import { layoutTown, loadArt, loadProps, loadGround } from '../src/layout.mjs';

import { townGrid } from '../src/town-grid.mjs';
import { checkAscii } from './check-ascii.mjs';

const args = process.argv.slice(2);
const mi = args.indexOf('--manifest');
const manifestPath = mi >= 0 ? args[mi + 1] : new URL('../art/game/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const lopts = { art: loadArt(manifest), props: loadProps(manifest), ground: loadGround(manifest) };
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--manifest');
if (!target) { console.error('使い方: node tools/ascii-town.mjs <repoPath | town.json> [--check] [--no-props]'); process.exit(2); }

let town, model = null;
if (target.endsWith('.json')) town = JSON.parse(readFileSync(target, 'utf8'));
else { model = analyzeRepository(target); town = layoutTown(model, lopts); }

const propArt = lopts.props;
const districts = [...new Set(town.buildings.map((b) => b.district))].sort();
const DL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const byDistrict = args.includes('--districts');
const grid = townGrid(town, propArt, { noProps: args.includes('--no-props'), byDistrict });
console.log(grid.map((r) => r.join('')).join('\n'));
if (byDistrict) console.log(districts.map((d, i) => `${DL[i % DL.length]}=${d}`).join('  '));

const kinds = {};
const arch = {};
for (const b of town.buildings) { kinds[b.module.kind] = (kinds[b.module.kind] || 0) + 1; arch[b.archetype] = (arch[b.archetype] || 0) + 1; }
console.log(`\n${town.repo.name} @ ${town.repo.head ?? '-'}: ${town.cols}×${town.rows} tiles, 建物 ${town.buildings.length}`,
  JSON.stringify(kinds), JSON.stringify(arch), `小物 ${town.props.length}, 住人 ${town.residents.length}, 常連 ${(town.crowd || []).length}`);

if (args.includes('--check')) {
  const result = checkAscii(town, manifest, {
    regenerate: model ? () => layoutTown(analyzeRepository(target), lopts) : undefined,
  });
  for (const line of result.lines) console.log(line);
  process.exitCode = result.problems.length ? 1 : 0;
}
