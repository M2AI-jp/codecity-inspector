// 修理小屋の話し方を独立して確認できるよう、台詞をここにまとめる。
import { q } from '../text.js';
import { recoveryDetail } from './shared.js';

  // 修理小屋: evidence is a sign that a return path was written down, not proof that it works.
export const repairVoice = {
    greet: ['いらっしゃい。修理小屋の職人だ。', 'こんばんは。修理小屋へようこそ。'],
    what: ['壊れたときに戻す手がかりを、ここで預かっている。', '作った所のそばで、切り戻しと復旧の手順を見張っているんだ。'],
    facts(f) {
      const out = [];
      const deployment = Array.isArray(f.deployment) ? f.deployment : [];
      const database = Array.isArray(f.database) ? f.database : [];
      const backup = Array.isArray(f.backup) ? f.backup : [];
      const runbook = Array.isArray(f.runbook) ? f.runbook : [];
      if (deployment[0]) out.push(`デプロイを切り戻す証拠は${q(deployment[0].path)}にある。${recoveryDetail(deployment[0].detail)}`);
      if (database[0]) out.push(`DBを戻す証拠は${q(database[0].path)}にある。${recoveryDetail(database[0].detail)}`);
      if (backup[0]) out.push(`バックアップの手がかりは${q(backup[0].path)}にある。${recoveryDetail(backup[0].detail)}`);
      if (runbook[0]) out.push(`復旧の手順書は${q(runbook[0].path)}だ。${recoveryDetail(runbook[0].detail)}`);
      out.push('ここで見つけたのは、戻す手段を書いた証拠だけだ。本当に戻せるかは、ここでは確かめていないんだ。');
      return out;
    },
    max: 5,
    close: ['壊れたときほど、手順書を落ち着いて確かめてくれ。'],
};
