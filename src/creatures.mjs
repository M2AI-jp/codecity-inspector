// 街の小さな生き物（CONTRACTS.md「Town」の creatures）。コードと依存の「生活」を表す。
// 出典: 2026-07-11 の設計issue「bot / cron / worker / dependency / background job / legacy script → ペット・鳥・猫・犬」。
// リポジトリに根拠があるものだけを置く（無ければその種類の生き物はいない）。
//
//   鳩（pigeon）: 直接の依存（package.json の dependencies / devDependencies、requirements*.txt、pyproject.toml、
//                 Pipfile、Gemfile、go.mod、Cargo.toml、composer.json）。1羽に依存1つ、最大14羽。広場と通り。
//   犬（dog）   : リポジトリで働く bot（git 履歴の作者名が [bot] で終わる・…Bot、または dependabot.yml / renovate.json
//                 などの設定）。1匹に bot 1つ、最大3匹。役場のまわり。
//   猫（cat）   : 決まった時間・裏で動く仕事（GitHub Actions の schedule / cron、workers/・jobs/・queue/ などの
//                 ディレクトリ、*.worker.* / *_job.* / jobs.js などのファイル、cron・queue のライブラリ）。最大4匹。
//                 加えて廃屋があれば、そのそばで眠る猫を1匹（sprite "cat-2"）。
//
// Node 22+ 標準ライブラリだけ。git ls-files と git log（作者名）を1回ずつ読むだけにして、速く保つ。

import { MAX_PIGEONS } from './creatures/constants.mjs';
import { listFiles } from './creatures/files.mjs';
import { findDependencies } from './creatures/dependencies.mjs';
import { findBots } from './creatures/bots.mjs';
import { findWork } from './creatures/work.mjs';
import { townGrid } from './creatures/grid.mjs';
import { mulberry32, strHash } from './creatures/util.mjs';

const feet = (tx, ty) => ({ x: Math.round((tx + 0.5) * 100) / 100, y: Math.round((ty + 0.7) * 100) / 100 });

export function findCreatures(repoRoot, repoModel, town) {
  const files = listFiles(repoRoot);
  const deps = findDependencies(repoRoot, files);
  const hall = ((repoModel && repoModel.facilities) || []).find((f) => f.archetype === 'town_hall');
  const bots = findBots(files, repoModel && repoModel.contributors, hall && hall.facts && hall.facts.contributorsWindow);
  const work = findWork(repoRoot, files, deps);

  const g = townGrid(town);
  const used = new Set();
  const free = (x, y) => g.ok(x, y) && !used.has(y * g.cols + x);
  const take = (x, y) => { used.add(y * g.cols + x); return feet(x, y); };
  const rnd = mulberry32(strHash(`${town.repo && town.repo.name}|${town.repo && town.repo.head}|creatures`));
  const spawn = town.spawn || { x: g.cols / 2, y: g.rows / 2 };
  const buildings = town.buildings || [];

  // nearest free tile to (cx, cy) that passes pred, within maxR (ring search, random tie-break)
  const near = (cx, cy, maxR, pred = () => true, minR = 0) => {
    cx = Math.round(cx); cy = Math.round(cy);
    for (let r = minR; r <= maxR; r++) {
      const ring = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (free(x, y) && pred(x, y)) ring.push([x, y]);
      }
      if (ring.length) return ring[Math.floor(rnd() * ring.length)];
    }
    return null;
  };
  const creatures = [];

  // pigeons: small flocks, the first on the plaza, the rest along the streets
  if (deps.length) {
    const pigeons = deps.slice(0, MAX_PIGEONS);
    const plaza = [], street = [];
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      if (!g.ok(x, y)) continue;
      const c = g.ch(x, y);
      if (c === '+') plaza.push([x, y]); else if (c === '#') street.push([x, y]);
    }
    const flocks = Math.max(1, Math.ceil(pigeons.length / 4));
    const centers = [];
    const farFrom = (x, y, d) => centers.every(([cx, cy]) => Math.hypot(cx - x, cy - y) >= d);
    const awayFromSpawn = (x, y) => Math.hypot(x - spawn.x, y - spawn.y) >= 4;
    const pick = (pool, d) => {
      const cand = pool.filter(([x, y]) => awayFromSpawn(x, y) && farFrom(x, y, d));
      return cand.length ? cand[Math.floor(rnd() * cand.length)] : null;
    };
    for (let f = 0; f < flocks; f++) {
      const c = (f === 0 && pick(plaza, 0)) || pick(street, 10) || pick(street, 6) || pick(plaza, 4) || pick(street, 0);
      if (c) centers.push(c);
    }
    pigeons.forEach((d, i) => {
      const c = centers[i % Math.max(1, centers.length)];
      if (!c) return;
      const cls = g.ch(c[0], c[1]);
      const t = near(c[0], c[1], 3, (x, y) => g.ch(x, y) === cls) || near(c[0], c[1], 4);
      if (!t) return;
      creatures.push({ kind: 'pigeon', name: d.name, reason: d.reason, home: take(t[0], t[1]), flock: centers.indexOf(c) });
    });
  }

  // dogs: around the town hall
  if (bots.length) {
    const hall = buildings.find((b) => b.archetype === 'town_hall' || (b.module && b.module.kind === 'town_hall'));
    const cx = hall ? hall.door.x : spawn.x, cy = hall ? hall.y + hall.h + 1 : spawn.y;
    for (const b of bots) {
      const t = near(cx, cy, 6, (x, y) => !hall || y >= hall.y + hall.h, 1) || near(cx, cy, 8);
      if (!t) continue;
      creatures.push({ kind: 'dog', name: b.name, reason: b.reason, home: take(t[0], t[1]) });
    }
  }

  // cats: beside the building whose module holds the evidence (longest path prefix; workshops win ties)
  const owner = (p) => {
    let best = null, bl = -1;
    for (const b of buildings) {
      const mp = b.module && b.module.path;
      if (mp == null) continue;
      const l = mp === '.' ? 0 : (p === mp || p.startsWith(`${mp}/`)) ? mp.length : -1;
      if (l < 0) continue;
      const better = l > bl || (l === bl && b.module.kind === 'workshop' && !(best && best.module.kind === 'workshop'));
      if (better) { best = b; bl = l; }
    }
    return best;
  };
  // a tile 1-2 away from the footprint (not in front of the door), alleys / grass preferred; several
  // creatures by one building spread around it instead of piling up on one side
  const placedBy = new Map();
  const besideBuilding = (b) => {
    const side = (x, y) => (x < b.x || x >= b.x + b.w || y >= b.y + b.h) && !(y === b.y + b.h && x >= b.door.x - 1 && x <= b.door.x + 1);
    const mine = placedBy.get(b.id) || [];
    let best = null, bs = -Infinity;
    for (let y = b.y - 2; y <= b.y + b.h + 1; y++) for (let x = b.x - 2; x <= b.x + b.w + 1; x++) {
      if (!free(x, y) || !side(x, y)) continue;
      const soft = ':.'.includes(g.ch(x, y)) ? 2 : 0;
      const spread = mine.length ? Math.min(...mine.map(([px, py]) => Math.hypot(px - x, py - y))) : 0;
      const score = soft + Math.min(spread, 6) * 1.5 + rnd() * 0.5;
      if (score > bs) { bs = score; best = [x, y]; }
    }
    if (best) { mine.push(best); placedBy.set(b.id, mine); }
    return best || near(b.x + b.w / 2, b.y + b.h, Math.max(b.w, b.h) + 3, side);
  };
  for (const w of work) {
    const b = owner(w.evidence);
    const t = b ? besideBuilding(b) : near(spawn.x, spawn.y, 10, (x, y) => ':.'.includes(g.ch(x, y)), 3);
    if (!t) continue;
    creatures.push({ kind: 'cat', name: w.name, reason: w.reason, home: take(t[0], t[1]), meaning: w.meaning === 'cron' ? 'cron' : 'job' });
  }

  // the ruin cat: one, asleep beside the longest-untouched ruin
  const ruins = buildings.filter((b) => b.module && b.module.kind === 'ruin');
  if (ruins.length) {
    const when = (b) => Date.parse(b.module.lastCommit && b.module.lastCommit.date) || 0;
    const r = ruins.slice().sort((a, b) => when(a) - when(b) || a.id.localeCompare(b.id))[0];
    const t = besideBuilding(r);
    if (t) {
      const lc = r.module.lastCommit;
      const date = lc && lc.date ? String(lc.date).slice(0, 10) : null;
      creatures.push({
        kind: 'cat', sprite: 'cat-2', sleeping: true, meaning: 'ruin',
        name: r.module.path === '.' ? (town.repo && town.repo.name) || '.' : r.module.path,
        reason: `廃屋（${r.module.path}）${date ? `・最後の変更 ${date}` : ''}`,
        home: take(t[0], t[1]), building: r.id,
      });
    }
  }
  return creatures;
}
