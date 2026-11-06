#!/usr/bin/env node
// node codecity.mjs <repoPath> [--port N] [--json out.json] [--ground out.png]
import { writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeRepository, agentForAuthor } from './src/analyze.mjs';
import { layoutTown } from './src/layout.mjs';
import { findCreatures } from './src/creatures.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const repoPath = args.find((a, i) => !a.startsWith('--') && !['--port', '--json', '--ground'].includes(args[i - 1]));
if (!repoPath) {
  console.error('使い方: node codecity.mjs <リポジトリ> [--port 4317] [--json town.json] [--ground ground.png]');
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

const t0 = Date.now();
const model = analyzeRepository(repoPath);
const t1 = Date.now();
const town = layoutTown(model);
town.groundImage = '/ground.png';          // 地面の1枚画像（cols*16 × rows*16 px、serve.mjs が配信）
const t2 = Date.now();
// 小さな生き物（鳩＝依存、犬＝bot、猫＝決まった時間・裏で動く仕事と廃屋）。根拠が無ければ置かない
const t3 = Date.now();
try { town.creatures = findCreatures(resolve(repoPath), model, town); }
catch (e) { town.creatures = []; console.warn(`生き物を探せなかった: ${e.message}`); }
// 犬になった bot は、人の姿では歩かせない（同じ bot が二重に現れない）
const dogNames = new Set(town.creatures.filter((c) => c.kind === 'dog').map((c) => String(c.name).replace(/-preview$/i, '').toLowerCase()));
if (dogNames.size) town.residents = town.residents.filter((r) => !dogNames.has(String(r.name).replace(/\[bot\]$/i, '').replace(/-preview$/i, '').toLowerCase()));
// 外部工務店（コードを書く外部エージェント）: 工事した建物（モジュール・施設がそのモジュールを含む建物）を歩く代理人。
// 作者そのものがエージェント（copilot-swe-agent[bot] など）の住人は、代理人と二重に現れないよう歩かせない
{
  const idOf = new Map();
  for (const b of town.buildings) {
    if (!b.facility && b.module) idOf.set(b.module.path, b.id);
    for (const m of (b.module && b.module.merged) || []) if (!idOf.has(m)) idOf.set(m, b.id);
    for (const m of (b.facility && b.facility.merged) || []) if (!idOf.has(m)) idOf.set(m, b.id);
  }
  const hall = town.buildings.find((b) => b.facility && b.facility.archetype === 'town_hall');
  town.contractors = (model.agents || []).map((a, i) => {
    const homes = [];
    for (const m of a.modules || []) {
      const id = idOf.get(m);
      if (id && !homes.includes(id)) homes.push(id);
      if (homes.length >= 4) break;
    }
    // 工事した建物が街に無ければ、工事報告を届ける役場のまわり
    if (!homes.length && hall) homes.push(hall.id);
    return { id: `a${i + 1}`, name: a.name, commits: a.commits, recent: a.recent, homes, last: a.last || null };
  }).filter((c) => c.homes.length);
  const agentNames = new Set((model.contributors || []).filter((c) => c.agent).map((c) => c.name));
  if (town.contractors.length) town.residents = town.residents.filter((r) => !agentNames.has(r.name) && !agentForAuthor(r.name));
}
// 住人の数は bot を犬にしたあとの数（街を歩く人の数）
const kinds = {};
for (const b of town.buildings) kinds[b.module.kind] = (kinds[b.module.kind] || 0) + 1;
console.log(`${model.name}${model.head ? ` @ ${model.head}` : ''}: モジュール ${model.modules.length}、建物 ${town.buildings.length}`
  + ` (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')})、住人 ${town.residents.length}、${town.cols}×${town.rows} tiles`
  + `（解析 ${t1 - t0}ms、配置 ${t2 - t1}ms）`);
const ck = {};
for (const c of town.creatures) ck[c.kind] = (ck[c.kind] || 0) + 1;
if (town.contractors.length) console.log(`外部工務店 ${town.contractors.map((c) => `${c.name} ${c.commits}件`).join('、')}`);
console.log(`生き物 ${town.creatures.length}${town.creatures.length ? ` (${Object.entries(ck).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}（${Date.now() - t3}ms）`);

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
  const { url } = await serveTown(town, { port, ground });
  console.log(`街を開く: ${url}`);
}
