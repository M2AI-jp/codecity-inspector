const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
export const scrub = (s) => String(s ?? '').replace(EMAIL, '').replace(/<\s*>/g, '').replace(/\s+/g, ' ').trim();

// ---------- 外部のコード生成エージェント（外部工務店） ----------
// コミットの作者・trailer（Co-Authored-By など）・定型の印だけで見分ける。本文に名前が出てくるだけ
// （「Codex の箱では…」のような話題）は数えない。
// [名前, 作者名だけで分かる bot の名前, 作者名とメールの両方で分かるもの [名前, メール], メッセージ]
// （「Claude」という名前の人もいるので、名前だけの作者はメールがエージェントのものであるときだけ）
const AGENTS = [
  ['Claude Code', /^claude\[bot\]$/i, [/^claude$/i, /@anthropic\.com$/i],
    /^co-authored-by:\s*claude\b[^\n<]*<noreply@anthropic\.com>|^co-authored-by:\s*claude\s+(code|opus|sonnet|haiku|fable|\d)|generated with \[claude code\]|^claude-session:\s*https:\/\/claude\.ai\/code/im],
  ['Codex', /^chatgpt-codex-connector(\[bot\])?$/i, [/^codex$/i, /@openai\.com$/i], /^co-authored-by:\s*codex\b|^co-authored-by:[^\n]*<codex@openai\.com>/im],
  ['GitHub Copilot', /^copilot-swe-agent(\[bot\])?$|^copilot\[bot\]$/i, [/^copilot$/i, /copilot@users\.noreply\.github\.com$/i], /^co-authored-by:\s*copilot\b/im],
  ['Cursor', /^cursor(-agent)?\[bot\]$/i, [/^cursor( agent)?$/i, /@cursor\.(com|sh)$/i], /^co-authored-by:\s*cursor( agent)?\s*</im],
  ['Devin', /^devin-ai-integration(\[bot\])?$/i, null, /^co-authored-by:\s*devin\b[^\n]*<[^>\n]*(devin|cognition)/im],
  ['Aider', /\(aider\)$/i, null, /^co-authored-by:\s*aider\b/im],
  ['Gemini', /^(gemini-code-assist|google-labs-jules)(\[bot\])?$/i, null, /^co-authored-by:\s*(gemini-code-assist|jules)\b/im],
  ['Amp', /^amp\[bot\]$/i, [/^amp$/i, /@ampcode\.com$/i], /^co-authored-by:\s*amp\s*<[^>\n]*ampcode\.com>|^amp-thread(-id)?:/im],
  ['OpenHands', /^openhands(-agent)?(\[bot\])?$/i, null, /^co-authored-by:\s*openhands\b/im],
];
// 作者名だけでエージェントだと分かる（copilot-swe-agent[bot] など）なら、その名前。犬（bot）や住人にはしない
export function agentForAuthor(name) {
  const n = String(name ?? '').trim();
  for (const [agent, bot] of AGENTS) if (bot.test(n)) return agent;
  return null;
}
// 作者そのものがエージェント（名前だけ、または名前とメール）なら、その名前
function authorAgent(name, email) {
  for (const [agent, bot, pair] of AGENTS) if (bot.test(name) || (pair && pair[0].test(name) && pair[1].test(email))) return agent;
  return null;
}
export function agentsOfCommit(author, email, subject, body) {
  const out = [];
  const byAuthor = authorAgent(author, email);
  for (const [agent, , , msg] of AGENTS) {
    if (byAuthor === agent || msg.test(body) || (agent === 'Aider' && /^aider: /.test(subject))) out.push(agent);
  }
  return { agents: out, byAuthor };
}

// 名前の表記ゆれ（大文字小文字）をまとめ、メールアドレスは取り除く
export function authorKeyer() {
  const variants = new Map();   // key -> Map(display -> count)
  return {
    key(name) {
      let n = scrub(String(name).replace(/@.*$/, '')) || '(名前なし)';
      const k = n.toLowerCase();
      if (!variants.has(k)) variants.set(k, new Map());
      const m = variants.get(k);
      m.set(n, (m.get(n) || 0) + 1);
      return k;
    },
    display(k) {
      const m = variants.get(k);
      return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    },
  };
}

// 作者をコミットの多い順に並べ、触ったモジュールをまとめる。
export function contributorsOf(people, groups, keyer) {
  return [...people.entries()]
    .sort((a, b) => b[1].commits - a[1].commits || (a[0] < b[0] ? -1 : 1))
    .map(([k, p]) => ({
      name: keyer.display(k),
      commits: p.commits,
      modules: [...p.touches.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([i]) => groups[i].path),
      lastCommit: { subject: scrub(p.last.subject), date: p.last.date },
      // この名前のコミットがぜんぶエージェント自身の作（作者名とメールで分かる）なら、その名前（住人・犬にしない）
      ...(p.agent && p.agentCommits === p.commits ? { agent: p.agent } : {}),
    }));
}

// 外部工務店: コミットの多い順に最大3つ（同じ数なら名前順）
export function agentsOf(crews, groups) {
  return [...crews.entries()]
    .sort((a, b) => b[1].commits - a[1].commits || (a[0] < b[0] ? -1 : 1)).slice(0, 3)
    .map(([n, w]) => ({
      name: n, commits: w.commits, recent: w.recent,
      modules: [...w.touches.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([i]) => groups[i].path),
      last: { subject: scrub(w.last.subject), date: w.last.date },
    }));
}
