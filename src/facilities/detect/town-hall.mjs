// 役場の追加。通常施設とは異なるリポジトリ全体の履歴とタグを数える。
export function addTownHall(S) {
  const { history, extra, stats, add } = S;
  const { isGit, head, git } = extra;
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
}
