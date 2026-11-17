// リポジトリ → RepoModel（CONTRACTS.md）。Node標準ライブラリのみ。
import { basename, resolve } from 'node:path';
import { detectFacilities } from './facilities.mjs';
import { MAX_COMMITS } from './analyze/constants.mjs';
import { git } from './analyze/git.mjs';
import { gitFiles, walkFiles, makeTextReader } from './analyze/files.mjs';
import { buildTree, groupModules, makeOwnerOf } from './analyze/tree.mjs';
import { agentForAuthor, scrub, contributorsOf, agentsOf } from './analyze/authors.mjs';
import { readHistory, dirtyFiles, readShallow, referenceTime } from './analyze/history.mjs';
import { parseReadme } from './analyze/readme.mjs';
import { classifyModules } from './analyze/classify.mjs';
import { historyStats, buildModules } from './analyze/stats.mjs';

export { agentForAuthor };

// ---------- 本体 ----------
export function analyzeRepository(rootPath, { onModules } = {}) {
  const root = resolve(rootPath);
  const name = basename(root);
  // bare リポジトリ（作業ツリーなし）も HEAD から読む（objects/ などの git の中身を街にしない）
  const bare = git(root, ['rev-parse', '--is-bare-repository'])?.trim() === 'true';
  const isGit = bare || git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
  const head = isGit ? git(root, ['rev-parse', '--short', 'HEAD'])?.trim() || null : null;
  let branch = isGit ? git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() || null : null;
  if (branch === 'HEAD') branch = null;

  const fromGit = isGit && head ? gitFiles(root) : null;
  const files = fromGit ?? walkFiles(root);
  const readText = makeTextReader(root, fromGit, bare);
  const tree = buildTree(files);
  const groups = groupModules(tree);
  const ownerOf = makeOwnerOf(groups);

  const { shallow, grafts } = readShallow(root, head);
  const history = isGit && head ? readHistory(root, undefined, MAX_COMMITS, grafts) : [];
  const dirty = isGit && head ? dirtyFiles(root, bare) : null;
  const { keyer, stats, latestTime, people, crews } = historyStats(root, history, groups, ownerOf, grafts);
  const modules = buildModules(groups, stats, keyer);
  onModules?.(modules, groups);
  const refTime = referenceTime(root, isGit, head, latestTime, dirty);
  classifyModules(modules, groups, readText, refTime);

  const contributors = contributorsOf(people, groups, keyer);
  const agents = agentsOf(crews, groups);

  // 工事中: 作業ツリーで HEAD と違うファイルの数（モジュールごと）。bare・git でないときは数えない
  if (dirty) {
    const n = new Map();
    for (const p of dirty) { const i = ownerOf(p); if (i !== undefined) n.set(i, (n.get(i) || 0) + 1); }
    for (const [i, c] of n) modules[i].works = { dirty: c };
  }

  let facilities = [];
  try {
    facilities = detectFacilities(files, history, groups, {
      root, isGit, head, keyer, refTime, shallow, bare,
      git: (args) => git(root, args),
      rootFiles: tree.files.map((f) => f.path),
      dirty: dirty ? dirty.length : null,
      dirtyPaths: dirty || [],
      agents: agents.map((a) => ({ name: a.name, commits: a.commits, recent: a.recent })),
    });
  } catch (e) { console.warn(`施設の判定に失敗した（施設なしで続ける）: ${e.message}`); }
  for (const f of facilities) {
    if (f.lastCommit) f.lastCommit.subject = scrub(f.lastCommit.subject);
    if (f.facts?.latest) f.facts.latest.subject = scrub(f.facts.latest.subject);
  }

  return {
    name, head, branch,
    latestCommitDate: history.length ? history[0].date : null,
    readme: parseReadme(root, tree.files, readText),
    modules,
    facilities,
    contributors,
    agents,
  };
}
