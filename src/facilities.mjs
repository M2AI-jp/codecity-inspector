// リポジトリの証拠から施設（PRODUCT.md §4 の施設表）を見つける。控えめに判定し、理由は事実だけを書く。
//   town_hall 役場     : git リポジトリ（コミット・タグ・リリース）
//   inn       宿屋     : 公開Webサービス（Webサーバーのコード、公開・配備の設定、Webの骨組み）
//   pub       酒場     : API・外部接続・LLM API・webhook（依存の SDK、API の住所、webhook の道）
//   warehouse 倉庫     : DB・storage（DB の依存、SQL・SQLite、migrations・prisma）
//   watchtower 見張り台: logs・monitoring（記録・監視の依存、logs ディレクトリ、監視の設定）
//   dojo      道場     : test・E2E（テストのディレクトリ・ファイル、テストの道具）
//   well      井戸     : env・secrets・config（外に立つ施設）
//   dock      船着場   : アプリ・パッケージの配布
//   gate      門       : 外から人が入る入口（宿屋と同じ証拠＋受付の道・ログインの道具）。外に立つ施設
//   repair    修理小屋 : rollback・recovery（切り戻し・復旧の手順やコマンド）
// 中身を読むのは依存の一覧と、上限つきのソースの走査だけ（git なら HEAD の内容を cat-file --batch でまとめて読む）。
import { basename } from 'node:path';

import { sortPaths, uniq } from './facilities/common.mjs';
import {
  CODE_EXT,
  NOT_PRODUCT,
  READ_BATCH_MAX,
  READ_FILE_MAX,
  SCAN_BYTES,
  SCAN_FILE_MAX,
  SCAN_FILES,
  SKIP_DIR,
  makeReader,
} from './facilities/scan.mjs';
import { MANIFEST, depsOf, nameIn } from './facilities/sdk-names.mjs';
import { ENV_EXAMPLE, collectEnvironment } from './facilities/env.mjs';
import { detectRecovery, hasFlyDeployImageBack, hasPgDumpAndRestore } from './facilities/recovery.mjs';
import { detectDojo } from './facilities/dojo.mjs';
import { detectDock } from './facilities/dock.mjs';
import { detectGate, detectInn, scanWebSources } from './facilities/gate-inn.mjs';
import { detectPub } from './facilities/pub.mjs';
import { detectWarehouse } from './facilities/warehouse.mjs';
import { detectWatchtower } from './facilities/watchtower.mjs';
import { pickWithinBudget } from './facilities/scan.mjs';

export { hasPgDumpAndRestore, hasFlyDeployImageBack, pickWithinBudget };

const DAY = 86400000;
const EVIDENCE_CAP = 20;

// ---------- 本体 ----------
// files: [{path, ext, bytes, binary}], history: 新しい順のコミット [{hash,date,author(key),subject,files}],
// groups: モジュール [{path, files}], extra: { root, isGit, head, git, keyer, refTime, rootFiles }
export function detectFacilities(files, history, groups, extra) {
  const { root, isGit, head, git, keyer, refTime } = extra;
  // 同じファイルは1度だけ読む（git なら cat-file --batch の1回にまとめる）
  const rawRead = makeReader(root, isGit && !!head, !!extra.bare);
  const cache = new Map();
  const fileInfo = new Map(files.map((f) => [f.path, f]));
  const read = (paths) => {
    const miss = uniq(paths.filter((p) => !cache.has(p)));
    if (miss.length) {
      let budget = READ_BATCH_MAX;
      const allowed = [];
      for (const p of miss) {
        const f = fileInfo.get(p);
        const bytes = Number(f?.bytes);
        if (!f || f.binary || !Number.isFinite(bytes) || bytes < 0 || bytes > READ_FILE_MAX) continue;
        const cost = Math.max(1, bytes);
        if (cost > budget) continue;
        budget -= cost;
        allowed.push(p);
      }
      const got = allowed.length ? rawRead(allowed) : new Map();
      for (const p of miss) cache.set(p, got.has(p) ? got.get(p) : null);
    }
    const out = new Map();
    for (const p of paths) { const t = cache.get(p); if (t != null) out.set(p, t); }
    return out;
  };
  const prod = (p) => !SKIP_DIR.test(p) && !NOT_PRODUCT.test(p);
  const byBase = new Map();
  for (const f of files) {
    const b = basename(f.path).toLowerCase();
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f.path);
  }
  const named = (re) => files.filter((f) => !SKIP_DIR.test(f.path) && re.test(basename(f.path))).map((f) => f.path);

  // 依存の一覧
  const manifests = files.filter((f) => MANIFEST.test(basename(f.path)) && !SKIP_DIR.test(f.path) && f.bytes < (1 << 20)).map((f) => f.path).slice(0, 300);
  const deps = [];   // { dep, path }
  // 井戸・船着場・道場が読む小さなファイル（見本の env・workflow・package.json・配布の manifest）も、ここで一緒に読んでおく
  const examples = sortPaths(files.filter((f) => !f.binary && prod(f.path) && ENV_EXAMPLE.test(basename(f.path)) && f.bytes < (256 << 10)).map((f) => f.path)).slice(0, 8);
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path) && f.bytes < (1 << 20)).map((f) => f.path).slice(0, 80);
  const dockManifests = files.filter((f) => !f.binary && prod(f.path) && f.bytes < (1 << 20) && f.path.split('/').length <= 4 &&
    /^(package\.json|pyproject\.toml|setup\.py|cargo\.toml|[\w.-]+\.gemspec|go\.mod|composer\.json|pubspec\.yaml|package\.swift|info\.plist|app\.json|app\.config\.[cm]?[jt]s|manifest\.json|androidmanifest\.xml|tauri\.conf\.json|capacitor\.config\.(json|[jt]s)|project\.pbxproj)$/i.test(basename(f.path))).map((f) => f.path).slice(0, 40);
  const pkgJsons = (byBase.get('package.json') || []).filter((p) => !SKIP_DIR.test(p)).slice(0, 20);
  read([...manifests, ...examples, ...workflows, ...dockManifests, ...pkgJsons]);
  for (const [p, text] of read(manifests)) for (const dep of depsOf(p, text)) deps.push({ dep, path: p });
  const depHits = (table) => {
    const hits = new Map();   // name -> paths
    for (const { dep, path } of deps) {
      const n = nameIn(table, dep);
      if (!n) continue;
      if (!hits.has(n)) hits.set(n, new Set());
      hits.get(n).add(path);
    }
    return hits;
  };

  // ソースの走査（製品のコードだけ。名前の分かりやすいものから、上限まで）
  const PRIORITY = /(server|app|index|main|api|client|http|route|webhook|service|integration|github|slack|openai|llm|ai|db|database|store|storage|log|monitor|deploy)/i;
  const scanList = files.filter((f) => CODE_EXT.has(f.ext) && !f.binary && f.bytes <= SCAN_FILE_MAX && prod(f.path) && !/\.min\.js$/.test(f.path))
    .sort((a, b) => (PRIORITY.test(basename(b.path)) - PRIORITY.test(basename(a.path))) || a.path.split('/').length - b.path.split('/').length || (a.path < b.path ? -1 : 1));
  const chosen = [];
  let budget = SCAN_BYTES;
  for (const f of scanList) {
    if (chosen.length >= SCAN_FILES || budget - f.bytes < 0) break;
    chosen.push(f.path); budget -= f.bytes;
  }
  const sources = read(chosen);
  const recovery = detectRecovery({ files, workflows, chosen, read });
  const web = scanWebSources({ sources, files, prod });
  const { servers, hostsSeen, webhooks, sqliteSrc, envInCode, loaderSrc, routeList } = web;

  const facilities = [];
  const stats = (evidence) => {
    // evidence のどれかに触れたコミット（全部のとき evidence = null）
    const set = evidence ? new Set(evidence) : null;
    let commits = 0, recent = 0, last = null;
    const authors = new Map();
    for (const c of history) {
      if (set && !c.files.some((f) => set.has(f))) continue;
      commits++;
      if (refTime - Date.parse(c.date) <= 90 * DAY) recent++;
      if (!last) last = c;
      authors.set(c.key, (authors.get(c.key) || 0) + 1);
    }
    return {
      commits, recent,
      lastCommit: last ? { hash: last.hash, date: last.date, author: keyer.display(last.key), subject: last.subject } : null,
      authors: [...authors.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10).map(([k, n]) => ({ name: keyer.display(k), commits: n })),
    };
  };
  const add = (archetype, name, reason, all, facts, extraStats) => {
    const evidence = uniq(all);
    facilities.push({ archetype, name, reason, evidence: evidence.slice(0, EVIDENCE_CAP), evidenceCount: evidence.length, facts, all: evidence, ...(extraStats || stats(evidence)) });
  };

  // --- 修理小屋: rollback / recovery ---
  if (recovery) add('repair', '修理小屋', recovery.reason, recovery.evidence, recovery.facts);

  // --- 役場: git リポジトリ ---
  if (isGit && head) {
    // コミット数はどこでも同じ数え方: マージを除く（解析が読んだ git log --no-merges と同じ）。
    // 解析が上限で読み切れなかったときだけ、全体をマージを除いて数え直す
    // 浅いクローンでは、手元にあるのは直近の一部だけ（総数・最初のコミット・タグの有無は分からない）
    const shallow = !!extra.shallow;
    const total = history.length < 5000 || shallow ? history.length
      : Number(git(['rev-list', '--count', '--no-merges', 'HEAD'])?.trim()) || history.length;
    const roots = (git(['log', '--max-parents=0', '--format=%cI', 'HEAD']) || '').split('\n').filter(Boolean).sort();
    const tagLines = (git(['for-each-ref', 'refs/tags', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:iso-strict)']) || '').split('\n').filter(Boolean);
    const latestTag = tagLines.length ? { name: tagLines[0].split('\t')[0], date: tagLines[0].split('\t')[1] || null } : null;
    const changelog = extra.rootFiles.find((p) => /^(changelog|changes|history|news|releases?)(\.(md|markdown|txt|rst))?$/i.test(p)) || null;
    const people = new Set(history.map((c) => c.key));
    const facts = {
      dirty: extra.dirty ?? null,                       // 作業ツリーで HEAD と違うファイルの数（bare・作業ツリーなしは null）
      agents: extra.agents || [],                       // 外部工務店（コード生成エージェント）の工事報告 [{ name, commits, recent }]
      commits: total,
      contributors: people.size,
      contributorsWindow: history.length >= 5000 || shallow ? history.length : null,     // 履歴を上限まで（浅いクローンなら手元の分だけ）読んだときは、数えた範囲（直近のコミット数）
      firstCommit: shallow ? null : roots[0] || (history.length ? history[history.length - 1].date : null),
      lastCommit: history.length ? history[0].date : null,
      tags: shallow && !tagLines.length ? null : tagLines.length, latestTag, changelog,
      shallow,
    };
    const st = stats(null);
    add('town_hall', '役場', `git リポジトリ（${shallow ? '浅いクローンで、手元にあるのは直近の' : ''}マージを除くコミット ${total.toLocaleString('en-US')} 件${tagLines.length ? `・タグ ${tagLines.length} 個` : ''}${changelog ? `・${changelog}` : ''}）`,
      ['.git', ...(changelog ? [changelog] : [])], facts, { ...st, commits: total });
  }

  // --- 宿屋: 公開Webサービス ---
  let entry = null;          // 外から人が入る入口の証拠（門も同じものを見る）
  const inn = detectInn({ files, byBase, named, depHits, read, prod, servers });
  if (inn) {
    add('inn', '宿屋', inn.reason, inn.evidence, inn.facts);
    entry = inn.entry;
  }

  // --- 井戸と酒場の名簿で使う: 設定の名前（env）。値は読まない・出さない ---
  const environment = collectEnvironment({
    files, examples, pkgJsons, workflows, read, depHits, prod, isGit, envInCode, loaderSrc,
  });
  const { exampleSet, envNames, workflowText } = environment;

  // --- 酒場: API・外部接続・LLM・webhook ---
  const pub = detectPub({
    files, depHits, hostsSeen, webhooks, prod, envNames, exampleSet, examples, routeList,
  });
  if (pub) add('pub', '酒場', pub.reason, pub.evidence, pub.facts);

  // --- 倉庫: DB・storage ---
  const warehouse = detectWarehouse({ files, depHits, sqliteSrc });
  if (warehouse) add('warehouse', '倉庫', warehouse.reason, warehouse.evidence, warehouse.facts);

  // --- 見張り台: logs・monitoring ---
  const watchtower = detectWatchtower({ files, depHits });
  if (watchtower) add('watchtower', '見張り台', watchtower.reason, watchtower.evidence, watchtower.facts);

  // --- 道場: test・E2E ---
  const dojo = detectDojo({
    files, named, depHits, read, pkgJsons, history, keyer, stats, root, refTime, extra,
  });
  if (dojo) {
    add('dojo', '道場', dojo.reason, dojo.evidence, dojo.facts, dojo.extraStats);
    facilities[facilities.length - 1].all = dojo.all;
  }

  // --- 井戸: env・secrets・config（生活インフラ）。外に建物を持たない（広場の井戸と井戸番） ---
  if (environment.well) {
    add('well', '井戸', environment.well.reason, environment.well.evidence, environment.well.facts);
    facilities[facilities.length - 1].noMerge = true;      // 建物が無いので、モジュールをまとめない
  }

  // --- 船着場: アプリ・パッケージの配布（外の島へ届ける場所） ---
  const dock = detectDock({ files, dockManifests, workflowText, read });
  if (dock) add('dock', '船着場', dock.reason, dock.evidence, dock.facts);

  // --- 門: 外から旅の人が入ってくる入口（宿屋と同じ証拠に、受付の道とログインの道具を添える）。外に立つ施設 ---
  // 公開の設定があっても、本当に外に開いているかは分からない（確かめていない）
  const gate = detectGate({ entry, routeList, deps, prod, servers });
  if (gate) {
    add('gate', '門', gate.reason, gate.evidence, gate.facts);
    facilities[facilities.length - 1].noMerge = true;      // 建物が無いので、モジュールをまとめない
  }

  // 酒場の名簿の「じょうたい」: 記録・見張り（見張り台）があるか
  const pubF = facilities.find((f) => f.archetype === 'pub'), tower = facilities.find((f) => f.archetype === 'watchtower');
  if (pubF) Object.assign(pubF.facts, { watchtower: !!tower, watchTools: tower ? tower.facts.tools.slice(0, 4) : [] });

  // 施設が丸ごと覆うモジュール（全ファイルがその施設の証拠）は、施設の建物にまとめる
  const taken = new Set();
  for (const f of facilities) {
    const set = new Set(f.noMerge ? [] : f.all);
    delete f.noMerge;
    f.merged = [];
    for (const g of groups) {
      if (g.path === '.' || taken.has(g.path) || !g.files.length) continue;
      if (g.files.every((x) => set.has(x.path))) { f.merged.push(g.path); taken.add(g.path); }
    }
    delete f.all;
  }
  return facilities;
}
