import { DAY, MAX_COMMITS } from './constants.mjs';
import { authorKeyer, scrub } from './authors.mjs';
import { readHistory } from './history.mjs';
import { topCounts } from './classify.mjs';

// 履歴の順に、モジュール・作者・外部工務店の件数を数える。
export function historyStats(root, history, groups, ownerOf, grafts) {
  const keyer = authorKeyer();
  const stats = groups.map(() => ({ commits: 0, recent: 0, last: null, authors: new Map() }));
  // 「最近」は今日ではなくリポジトリの最新コミットから90日（同じコミットなら同じ結果）
  const latestTime = history.length ? Date.parse(history[0].date) : 0;
  const people = new Map();   // key -> { commits, touches: Map(moduleIdx -> n), last: 最新のコミット }
  const crews = new Map();    // 外部エージェントの名前 -> { commits, recent, touches, last }
  for (const c of history) {
    const k = keyer.key(c.author);
    c.key = k;
    if (!people.has(k)) people.set(k, { commits: 0, touches: new Map(), last: c, agentCommits: 0, agent: null });   // 履歴は新しい順なので最初の1件が最新
    const person = people.get(k);
    person.commits++;
    if (c.byAgent) { person.agentCommits++; person.agent = c.byAgent; }
    const mods = new Set();
    for (const f of c.files) { const i = ownerOf(f); if (i !== undefined) mods.add(i); }
    const recent = latestTime - Date.parse(c.date) <= 90 * DAY;
    for (const a of c.agents || []) {
      if (!crews.has(a)) crews.set(a, { commits: 0, recent: 0, touches: new Map(), last: c });
      const w = crews.get(a);
      w.commits++;
      if (recent) w.recent++;
      for (const i of mods) w.touches.set(i, (w.touches.get(i) || 0) + 1);
    }
    for (const i of mods) {
      const s = stats[i];
      s.commits++;
      if (recent) s.recent++;
      if (!s.last) s.last = c;
      s.authors.set(k, (s.authors.get(k) || 0) + 1);
      person.touches.set(i, (person.touches.get(i) || 0) + 1);
    }
  }
  // 直近の履歴に出てこないモジュールは、それより古い履歴をそのパスだけに絞って件数上限までたどる
  if (history.length >= MAX_COMMITS) {
    const missing = groups.map((g, i) => i).filter((i) => !stats[i].last);
    const paths = missing.flatMap((i) => (groups[i].path === '.' ? groups[i].files.map((f) => f.path) : [groups[i].path])).slice(0, 400);
    if (paths.length) {
      for (const c of readHistory(root, ['--', ...paths], MAX_COMMITS, grafts)) {
        const k = keyer.key(c.author);
        const mods = new Set();
        for (const f of c.files) { const i = ownerOf(f); if (i !== undefined && missing.includes(i)) mods.add(i); }
        for (const i of mods) {
          const s = stats[i];
          s.commits++;
          if (!s.last) s.last = { ...c, key: k };
          s.authors.set(k, (s.authors.get(k) || 0) + 1);
        }
      }
    }
  }
  return { keyer, stats, latestTime, people, crews };
}

// モジュールのファイルと履歴の集計を、RepoModel の形にする。
export function buildModules(groups, stats, keyer) {
  return groups.map((g, i) => {
    const languages = Object.create(null);
    let lines = 0, bytes = 0;
    for (const f of g.files) { languages[f.ext] = (languages[f.ext] || 0) + 1; lines += f.lines; bytes += f.bytes; }
    const s = stats[i];
    return {
      path: g.path, kind: 'house', reason: '',
      files: g.files.length, lines, bytes,
      languages: Object.fromEntries(topCounts(languages, 99)),
      lastCommit: s.last ? { hash: s.last.hash, date: s.last.date, author: keyer.display(s.last.key), subject: scrub(s.last.subject) } : null,
      commits: s.commits,
      recent: s.recent,
      authors: [...s.authors.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10)
        .map(([k, n]) => ({ name: keyer.display(k), commits: n })),
      topFiles: [...g.files].sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : 1)).slice(0, 8)
        .map((f) => ({ path: f.path, lines: f.lines })),
    };
  });
}
