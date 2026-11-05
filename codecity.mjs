#!/usr/bin/env node
// node codecity.mjs <repoPath> [--port N] [--json out.json]
import { writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeRepository } from './src/analyze.mjs';
import { layoutTown } from './src/layout.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const repoPath = args.find((a, i) => !a.startsWith('--') && !['--port', '--json'].includes(args[i - 1]));
if (!repoPath) {
  console.error('使い方: node codecity.mjs <リポジトリ> [--port 4317] [--json town.json]');
  process.exit(2);
}
try { if (!statSync(repoPath).isDirectory()) throw new Error(); } catch {
  console.error(`ディレクトリが見つからない: ${repoPath}`);
  process.exit(2);
}

const t0 = Date.now();
const model = analyzeRepository(repoPath);
const t1 = Date.now();
const town = layoutTown(model);
const t2 = Date.now();
const kinds = {};
for (const b of town.buildings) kinds[b.module.kind] = (kinds[b.module.kind] || 0) + 1;
console.log(`${model.name}${model.head ? ` @ ${model.head}` : ''}: モジュール ${model.modules.length}、建物 ${town.buildings.length}`
  + ` (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')})、住人 ${town.residents.length}、${town.cols}×${town.rows} tiles`
  + `（解析 ${t1 - t0}ms、配置 ${t2 - t1}ms）`);

const out = opt('--json');
if (out) {
  writeFileSync(resolve(out), JSON.stringify(town, null, 1));
  console.log(`書き出した: ${resolve(out)}`);
} else {
  const { serveTown } = await import('./src/serve.mjs');
  const { url } = await serveTown(town, { port: Number(opt('--port') ?? 4317) });
  console.log(`街を開く: ${url}`);
}
