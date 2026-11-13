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

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { agentForAuthor } from './analyze.mjs';

const MAX_PIGEONS = 14, MAX_DOGS = 3, MAX_CATS = 4;
const MAX_FILES = 300000, MAX_READ = 256 * 1024;
const SKIP_DIR = /(^|\/)(node_modules|vendor|third_party|\.git|dist|build|out|target|__fixtures__|fixtures|testdata|\.venv|venv|site-packages)(\/|$)/;

// --- files ------------------------------------------------------------------------------
function git(root, args, max = 64 * 1024 * 1024) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: max, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}

// 作業ツリーから読むときは、リポジトリ内の通常ファイルだけに限定する。
// 親ディレクトリの symlink も拒否し、/dev/stdin・/dev/zero などの外部特殊ファイルを開かない。
function repoFile(root, rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  const baseRoot = resolve(root);
  const abs = resolve(baseRoot, rel);
  const fromRoot = relative(baseRoot, abs);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
  try {
    const rootStat = lstatSync(baseRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
  } catch { return null; }
  let cur = baseRoot;
  const parts = fromRoot.split(sep);
  for (let i = 0; i < parts.length; i++) {
    cur = join(cur, parts[i]);
    let st;
    try { st = lstatSync(cur); } catch { return null; }
    if (st.isSymbolicLink()) return null;
    if (i < parts.length - 1 && !st.isDirectory()) return null;
    if (i === parts.length - 1 && !st.isFile()) return null;
  }
  return abs;
}

function listFiles(root) {
  const out = git(root, ['ls-files', '-z']);
  if (out != null) return out.split('\0').filter(Boolean).slice(0, MAX_FILES).filter((p) => repoFile(root, p));
  // git でなければ浅く歩く
  const files = [];
  const walk = (rel, depth) => {
    if (files.length >= 20000 || depth > 4) return;
    let ents;
    try { ents = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!e.name.startsWith('.') || e.name === '.github') { if (!SKIP_DIR.test(p)) walk(p, depth + 1); } }
      else if (e.isFile()) files.push(p);
    }
  };
  walk('', 0);
  return files;
}

function readText(root, rel) {
  try {
    const abs = repoFile(root, rel);
    if (!abs) return null;
    const st = lstatSync(abs);
    if (st.size > MAX_READ) return null;
    return readFileSync(abs, 'utf8');
  } catch { return null; }
}

const depth = (p) => p.split('/').length - 1;
const base = (p) => p.slice(p.lastIndexOf('/') + 1);

// --- dependencies (pigeons) -------------------------------------------------------------
// TOML: keys of the named tables ([dependencies], [dev-dependencies], [tool.poetry.dependencies] ...)
function tomlTableKeys(text, tables) {
  const out = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const t = /^\[([^\]]+)\]$/.exec(line);
    if (t) {
      const name = t[1].trim();
      cur = tables.includes(name) ? name : null;
      // [dependencies.foo] style
      for (const tb of tables) if (name.startsWith(`${tb}.`) && !name.slice(tb.length + 1).includes('.')) out.push(name.slice(tb.length + 1).replace(/"/g, ''));
      continue;
    }
    if (!cur) continue;
    const k = /^("?)([A-Za-z0-9_.\-]+)\1\s*=/.exec(line);
    if (k) out.push(k[2]);
  }
  return out;
}

// PEP 621: [project] dependencies = ["requests>=2", ...]
function pyprojectDeps(text) {
  const out = [];
  const sec = /(^|\n)\[project\]([\s\S]*?)(\n\[|$)/.exec(text);
  const d = sec && /(^|\n)\s*dependencies\s*=\s*\[([\s\S]*?)\]/.exec(sec[2]);
  if (d) for (const s of d[2].matchAll(/["']([^"']+)["']/g)) out.push(pyName(s[1]));
  return out.concat(tomlTableKeys(text, ['tool.poetry.dependencies', 'tool.poetry.dev-dependencies', 'tool.poetry.group.dev.dependencies']).filter((n) => n !== 'python'));
}

const pyName = (spec) => spec.trim().split(/[\s<>=!~;\[(@]/)[0];

function requirementsDeps(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-') || /^[a-z]+:\/\//i.test(line)) continue;
    const n = pyName(line);
    if (/^[A-Za-z0-9][A-Za-z0-9_.\-]*$/.test(n)) out.push(n);
  }
  return out;
}

function goModDeps(text) {
  const out = [];
  let block = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) { block = true; continue; }
    if (block && line === ')') { block = false; continue; }
    if (/\/\/\s*indirect/.test(line)) continue;
    const m = block ? /^(\S+)\s+v\S+/.exec(line) : /^require\s+(\S+)\s+v\S+/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

function gemfileDeps(text) {
  return [...text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1]);
}

// one manifest -> [{ name, reason }]
function manifestDeps(root, rel) {
  const b = base(rel);
  const text = readText(root, rel);
  if (text == null) return [];
  const tag = (names, what) => names.map((name) => ({ name, reason: `${rel} の${what}` }));
  try {
    if (b === 'package.json' || b === 'composer.json') {
      const j = JSON.parse(text);
      if (b === 'composer.json') {
        const ok = (n) => n !== 'php' && !n.startsWith('ext-');
        return [...tag(Object.keys(j.require || {}).filter(ok), ' require'), ...tag(Object.keys(j['require-dev'] || {}).filter(ok), ' require-dev')];
      }
      return [...tag(Object.keys(j.dependencies || {}), ' dependencies'), ...tag(Object.keys(j.devDependencies || {}), ' devDependencies')];
    }
  } catch { return []; }
  if (/^requirements[^/]*\.txt$/i.test(b)) return tag(requirementsDeps(text), '依存');
  if (b === 'pyproject.toml') return tag(pyprojectDeps(text), '依存');
  if (b === 'Pipfile') return tag(tomlTableKeys(text, ['packages', 'dev-packages']), '依存');
  if (b === 'Cargo.toml') return tag(tomlTableKeys(text, ['dependencies', 'dev-dependencies', 'build-dependencies']), '依存');
  if (b === 'go.mod') return tag(goModDeps(text), ' require');
  if (b === 'Gemfile') return tag(gemfileDeps(text), ' gem');
  return [];
}

const MANIFEST = /^(package\.json|composer\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|Cargo\.toml|go\.mod|Gemfile)$/i;

function findDependencies(root, files) {
  // the repository's own manifests first; docs / examples / tests sites after them
  const aside = (f) => (/(^|\/)(docs?|examples?|samples?|demos?|tests?|spec|benchmarks?)\//i.test(f) ? 1 : 0);
  const manifests = files.filter((f) => MANIFEST.test(base(f)) && !SKIP_DIR.test(f) && depth(f) <= 3)
    .sort((a, b) => aside(a) - aside(b) || depth(a) - depth(b) || a.localeCompare(b));
  const seen = new Set(), out = [];
  for (const m of manifests.slice(0, 40)) {
    for (const d of manifestDeps(root, m)) {
      const key = d.name.toLowerCase();
      if (!d.name || seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

// --- bots (dogs) ------------------------------------------------------------------------
const BOT_NAME = /\[bot\]$|(^|[-_ ])bot$|[a-z]Bot$|^(dependabot|renovate|github-actions|greenkeeper|mergify|imgbot|snyk-bot|pre-commit-ci|allcontributors)\b/;
const botKey = (n) => n.replace(/\[bot\]$/i, '').replace(/-preview$/i, '').toLowerCase();
const botName = (n) => n.replace(/\[bot\]$/i, '');

const BOT_CONFIGS = [
  [/^\.github\/dependabot\.ya?ml$/, 'dependabot'],
  [/^(\.github\/)?(renovate\.json5?|\.renovaterc(\.json5?)?)$/, 'renovate'],
  [/^\.github\/renovate\.json5?$/, 'renovate'],
  [/^(\.github\/)?\.?mergify\.ya?ml$/, 'mergify'],
  [/^\.imgbotconfig$/, 'imgbot'],
  [/^\.github\/\.?kodiak\.toml$|^\.kodiak\.toml$/, 'kodiak'],
];

// コミット数は解析（src/analyze.mjs）の contributors から数える: 住人・役場と同じくマージを除いた数
// （解析が履歴を上限まで読んだときは、その範囲 win を添える）
function findBots(files, contributors, win) {
  const bots = new Map();       // key -> { name, commits, config }
  for (const c of contributors || []) {
    const name = String(c.name || '').trim();
    // コードを書く外部エージェント（copilot-swe-agent[bot] など）は犬ではなく外部工務店（town.contractors）
    if (!name || !BOT_NAME.test(name) || c.agent || agentForAuthor(name)) continue;
    const k = botKey(name);
    const b = bots.get(k) || { name: botName(name), commits: 0, config: null };
    b.commits += c.commits | 0;
    bots.set(k, b);
  }
  for (const f of files) {
    if (depth(f) > 1) continue;
    for (const [re, name] of BOT_CONFIGS) {
      if (!re.test(f)) continue;
      const b = bots.get(name) || { name, commits: 0, config: null };
      if (!b.config) b.config = f;
      bots.set(name, b);
    }
  }
  return [...bots.values()]
    .sort((a, b) => b.commits - a.commits || (a.config ? 0 : 1) - (b.config ? 0 : 1) || a.name.localeCompare(b.name))
    .slice(0, MAX_DOGS)
    .map((b) => ({
      name: b.name,
      reason: [b.commits ? `${win ? `直近の ${win.toLocaleString('en-US')} 件のうち` : 'git の履歴に'} ${b.name} のコミットが ${b.commits.toLocaleString('en-US')} 件（マージを除く）` : null, b.config ? `${b.config} がある` : null].filter(Boolean).join('・'),
      evidence: b.config || null,
    }));
}

// --- scheduled / background work (cats) -------------------------------------------------
const WORK_DIR = /^(workers?|jobs?|queues?|cron|crons|cronjobs?|schedulers?|background)$/i;
const WORK_FILE = /(\.|_|-)(worker|job|cron)\.[a-z]+$|^(workers?|jobs?|queues?|cron|crontab|scheduler)\.[a-z]+$|^crontab$/i;
const WORK_LIBS = new Set(['node-cron', 'cron', 'node-schedule', 'bull', 'bullmq', 'bee-queue', 'agenda', 'bree', 'toad-scheduler', 'croner',
  'sidekiq', 'resque', 'delayed_job', 'good_job', 'whenever', 'sidekiq-cron', 'que', 'solid_queue',
  'celery', 'rq', 'apscheduler', 'huey', 'dramatiq', 'schedule', 'django-q',
  'github.com/robfig/cron', 'github.com/robfig/cron/v3', 'github.com/hibiken/asynq', 'github.com/go-co-op/gocron',
  'tokio-cron-scheduler', 'job_scheduler', 'cron']);

function findWork(root, files, deps) {
  const out = [];
  // 1) GitHub Actions workflows that run on a schedule
  for (const f of files.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).slice(0, 80)) {
    const text = readText(root, f);
    if (!text || !/^\s*schedule\s*:/m.test(text)) continue;
    const cron = /cron\s*:\s*["']?([^"'\n#]+?)["']?\s*(#.*)?$/m.exec(text);
    out.push({ name: base(f), reason: `${f} が決まった時間に動く（schedule${cron ? `・cron: ${cron[1].trim()}` : ''}）`, evidence: f, meaning: 'cron' });
  }
  // 2) worker / job / queue directories and files
  const dirs = new Map();
  const single = [];
  for (const f of files) {
    if (SKIP_DIR.test(f) || /(^|\/)(tests?|spec|__tests__|e2e|docs?|examples?)\//.test(f)) continue;
    const parts = f.split('/');
    let hit = false;
    for (let i = 0; i < parts.length - 1; i++) {
      if (WORK_DIR.test(parts[i])) {
        const d = `${parts.slice(0, i + 1).join('/')}/`;
        dirs.set(d, (dirs.get(d) || 0) + 1);
        hit = true;
        break;
      }
    }
    if (!hit && WORK_FILE.test(parts[parts.length - 1]) && !/\.(md|txt|json|lock|snap)$/i.test(f)) single.push(f);
  }
  for (const [d, n] of [...dirs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    out.push({ name: base(d.slice(0, -1)) + '/', reason: `${d} に ${n} 個のファイル（裏で動く仕事の置き場）`, evidence: d.slice(0, -1), meaning: 'job' });
  }
  for (const f of single.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
    out.push({ name: base(f), reason: `${f}（裏で動く仕事のファイル）`, evidence: f, meaning: 'job' });
  }
  // 3) cron / queue libraries among the dependencies
  for (const d of deps) {
    if (WORK_LIBS.has(d.name.toLowerCase())) out.push({ name: d.name, reason: `${d.reason}（決まった時間・裏で仕事を動かす道具）`, evidence: d.reason.split(' ')[0], meaning: 'lib' });
  }
  // one cat per name; the schedule ones first
  const seen = new Set();
  return out.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true))).slice(0, MAX_CATS);
}

// --- homes: walkable tiles near the right place -----------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const WALKABLE = new Set(['.', ':', '#', '+']);

function townGrid(town) {
  const { cols, rows } = town;
  const ch = (x, y) => (x >= 0 && y >= 0 && x < cols && y < rows ? (town.ground[y] || '')[x] || ' ' : ' ');
  const blocked = new Uint8Array(cols * rows);      // not a place to stand
  const hidden = new Uint8Array(cols * rows);       // behind a roof / canopy (would not be seen)
  // 立てるのは歩ける地面（草地・土・石畳・広場）だけ。水・岸・街の外、知らない記号の地面には置かない
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!WALKABLE.has(ch(x, y))) blocked[y * cols + x] = 1;
  }
  const mark = (arr, x0, y0, w, h) => {
    for (let y = Math.max(0, y0); y < Math.min(rows, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(cols, x0 + w); x++) arr[y * cols + x] = 1;
  };
  for (const b of town.buildings || []) { mark(blocked, b.x, b.y, b.w, b.h); mark(hidden, b.x, b.y - 3, b.w, 3); }
  for (const p of town.props || []) {
    const x = Math.floor(p.x), y = Math.floor(p.y - 0.01);
    mark(blocked, x, y, 1, 1);
    if (p.type === 'tree') mark(hidden, x - 1, y - 2, 3, 2);
  }
  // 外に立つ番人（井戸番など）の足もと
  for (const l of town.landmarks || []) if (l.keeper) mark(blocked, Math.floor(l.keeper.x), Math.floor(l.keeper.y - 0.01), 1, 1);
  // 段（terrace）の石垣の前面（y+h の行）には立たない。階段の段だけは歩ける
  const step = new Set();
  for (const s of town.stairs || []) for (let x = s.x; x < s.x + s.w; x++) step.add(s.y * cols + x);
  for (const t of town.terraces || []) {
    const fy = t.y + t.h;
    if (fy < 0 || fy >= rows) continue;
    for (let x = Math.max(0, t.x); x < Math.min(cols, t.x + t.w); x++) if (!step.has(fy * cols + x)) blocked[fy * cols + x] = 1;
  }
  const ok = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !blocked[y * cols + x] && !hidden[y * cols + x];
  return { ch, ok, cols, rows };
}

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
