import { uniq } from '../common.mjs';

const DAY = 86400000;
const EVIDENCE_CAP = 20;

// 証拠と統計の準備。全施設が同じ上限・重複除去・履歴の並びで結果を追加する。
export function prepareEvidence(S) {
  const { history, extra: { keyer, refTime } } = S;
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

  Object.assign(S, { facilities, stats, add });
}
