#!/usr/bin/env node
// node codecity.mjs <repoPath> [--overlay overlay.json] [--port N] [--json out.json] [--ground out.png]
import { writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeRepository } from './src/analyze.mjs';
import { layoutTown } from './src/layout.mjs';
import { readOverlay } from './src/overlay/read.mjs';
import { overlayLayoutOptions } from './src/overlay/layout-options.mjs';
import { applyGroups } from './src/overlay/groups.mjs';
import { placeOverlay } from './src/overlay/place.mjs';
import { populateTown } from './src/overlay/town.mjs';
import { createOverlaySession } from './src/overlay/live.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const repoPath = args.find((a, i) => !a.startsWith('--') && !['--port', '--json', '--ground', '--overlay'].includes(args[i - 1]));
if (!repoPath) {
  console.error('使い方: node codecity.mjs <リポジトリ> [--overlay overlay.json] [--port 4317] [--json town.json] [--ground ground.png]');
  process.exit(2);
}
const port = Number(opt('--port') ?? 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`--port は 0〜65535 の整数: ${opt('--port')}`);
  process.exit(2);
}
try { if (!statSync(repoPath).isDirectory()) throw new Error(); } catch {
  console.error(`ディレクトリが見つからない: ${repoPath}`);
  process.exit(2);
}

let overlay;
const overlayFile = opt('--overlay');
try { if (args.includes('--overlay')) overlay = readOverlay(overlayFile); }
catch (e) { console.error(e.message); process.exit(1); }
const t0 = Date.now();
const moduleFiles = new Map();
const model = analyzeRepository(repoPath, overlay ? { onModules(_modules, groups) {
  for (const g of groups) moduleFiles.set(g.path, g.files.map((f) => f.path));
} } : undefined);
const t1 = Date.now();
const arrange = (input) => layoutTown(input ? applyGroups(model, input.groups, moduleFiles) : model,
  overlayLayoutOptions(input));
const baseTown = arrange(overlay);
const t2 = Date.now();
populateTown(baseTown, model, repoPath);
const creatureMs = Date.now() - t2;
const makeBase = (input) => populateTown(arrange(input), model, repoPath);
const town = overlay ? placeOverlay(baseTown, overlay) : baseTown;
// 住人の数は bot を犬にしたあとの数（街を歩く人の数）
const kinds = {};
for (const b of town.buildings) kinds[b.module.kind] = (kinds[b.module.kind] || 0) + 1;
console.log(`${model.name}${model.head ? ` @ ${model.head}` : ''}: モジュール ${model.modules.length}、建物 ${town.buildings.length}`
  + ` (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')})、住人 ${town.residents.length}、${town.cols}×${town.rows} tiles`
  + `（解析 ${t1 - t0}ms、配置 ${t2 - t1}ms）`);
const ck = {};
for (const c of town.creatures) ck[c.kind] = (ck[c.kind] || 0) + 1;
if (town.contractors.length) console.log(`外部工務店 ${town.contractors.map((c) => `${c.name} ${c.commits}件`).join('、')}`);
console.log(`生き物 ${town.creatures.length}${town.creatures.length ? ` (${Object.entries(ck).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}（${creatureMs}ms）`);

// 地面の画像（キャッシュがあれば読むだけ）
const loadGround = async () => {
  const { groundPNG } = await import('./src/ground.mjs');
  const g = groundPNG(town);
  console.log(`地面 ${town.cols * 16}×${town.rows * 16}px: ${g.cached ? 'キャッシュ' : `${g.ms}ms`}（${g.file}）`);
  return g.buffer;
};

const groundOut = opt('--ground');
const out = opt('--json');
if (groundOut || out) {                    // 書き出して終わる
  if (groundOut) {
    writeFileSync(resolve(groundOut), await loadGround());
    console.log(`書き出した: ${resolve(groundOut)}`);
  }
  if (out) {
    writeFileSync(resolve(out), JSON.stringify(town, null, 1));
    console.log(`書き出した: ${resolve(out)}`);
  }
} else {
  let ground;
  try { ground = await loadGround(); } catch (e) { console.warn(`地面の画像を作れなかった: ${e.message}`); }
  const { serveTown } = await import('./src/serve.mjs');
  const overlaySession = overlay ? createOverlaySession({ file: resolve(overlayFile), overlay, baseTown, town, makeBase }) : null;
  const { url } = await serveTown(town, { port, ground, overlaySession });
  console.log(`街を開く: ${url}`);
}
