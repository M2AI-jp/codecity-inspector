// リポジトリで働く bot を、犬の根拠として見つける。
import { agentForAuthor } from '../analyze.mjs';
import { MAX_DOGS } from './constants.mjs';
import { depth } from './files.mjs';

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

export { findBots };
