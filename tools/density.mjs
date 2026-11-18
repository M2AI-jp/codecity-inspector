#!/usr/bin/env node
// 配置の密度を測る道具（Node 22以上、標準ライブラリのみ）。
//
//   node tools/density.mjs [--label 名前] town.json [...]
//
// footprint / 街の内側:
//   建物 footprint の面積を、建物から Chebyshev 距離6以内で ground が街の外(' ')でない
//   マス数で割る。水は「街の外」ではないため分母に含める。
// 間隔:
//   x方向に隣り合い、扉の行が1行以内の建物を同じ通りの隣として数える。
// 裏:
//   版の cover の外側から上へ、裸の草地（物と建物が無い'.'）が続く最大行数を建物ごとに数える。
// 広場の辺:
//   '+' の外周を広場とし、入口の通り（外側が最も舗装された辺）を除く。
//   建物または役場の段が、その辺に直接または1マス以内の前庭・通りをはさんで面する長さを数える。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProps } from '../src/layout.mjs';
import { inputsOf, manifestPathOf } from './density/arguments.mjs';
import { measure } from './density/measure.mjs';
import { printMeasurement } from './density/report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPathOf(args, ROOT), 'utf8'));
const propArt = loadProps(manifest);
const inputs = inputsOf(args);
if (!inputs.length) {
  console.error('使い方: node tools/density.mjs [--label 名前] town.json [...]');
  process.exit(2);
}

for (const input of inputs) {
  const r = measure(resolve(input.file), manifest, propArt, ROOT);
  printMeasurement(input.label, r);
}
