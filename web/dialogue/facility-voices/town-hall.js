// 役場の話し方を独立して確認できるよう、台詞をここにまとめる。
import { fmtInt } from '../../util.js';
import { dateJa, nPeople, q } from '../text.js';

export const townHallVoice = {
    greet: ['ようこそ、役場へ。わたしは書記をしております。', 'いらっしゃいませ。こちらは役場の受付です。'],
    what: ['この街の記録は、ぜんぶここで預かっています。', 'この街の歩みを、一件ずつ帳面につけております。'],
    facts(f, town) {
      const out = [];
      if (f.commits) {
        const ppl = f.contributors ? (f.contributorsWindow ? `直近の${fmtInt(f.contributorsWindow)}件では${nPeople(f.contributors)}が手を入れています` : `手を入れた人は${nPeople(f.contributors)}です`) : '';
        out.push(f.shallow
          ? `この写しは浅いクローンで、手元にある記録はマージを除いて直近の${fmtInt(f.commits)}件だけです。${f.contributors ? `その中で手を入れた人は${nPeople(f.contributors)}です。` : ''}`
          : `記録されたコミットは、マージを除いて${fmtInt(f.commits)}件。${ppl ? `${ppl}。` : ''}`);
      }
      if (f.firstCommit && f.lastCommit) {
        out.push(dateJa(f.firstCommit) === dateJa(f.lastCommit)
          ? `記録の日付は、${dateJa(f.firstCommit)}です。`
          : `最初の記録は${dateJa(f.firstCommit)}、いちばん新しい記録は${dateJa(f.lastCommit)}です。`);
      }
      if (f.tags > 0 && f.latestTag) out.push(`節目の印（タグ）は${fmtInt(f.tags)}個。いちばん新しいのは${q(f.latestTag.name)}です。`);
      else if (f.tags === 0) out.push('節目の印（タグ）は、まだひとつもついていません。');
      // works in progress in the working tree (not yet committed)
      if (f.dirty > 0) out.push(`まだ記録していない変更が${fmtInt(f.dirty)}個あります。`);
      // 工事報告: commits made with an external code-generating agent. A self-report, never a reward.
      const ag = (Array.isArray(f.agents) ? f.agents : []).filter((a) => a && a.name && a.commits > 0);
      if (ag.length) {
        const list = ag.slice(0, 2).map((a) => `${a.name}から${fmtInt(a.commits)}件`);
        const win = f.contributorsWindow ? `直近の${fmtInt(f.contributorsWindow)}件のうち、` : '';
        out.push(`外部工務店からの工事報告も届いています。${win}${list.join('、')}${ag.length > 2 ? `、ほか${ag.length - 2}社` : ''}です。`);
        const dojo = town && (town.buildings || []).some((b) => b.facility && b.facility.archetype === 'dojo');
        out.push(`工事報告は、工務店の自己申告です。本当に動くかは、${dojo ? '道場で' : '動かして'}確かめましょう。`);
      }
      if (f.changelog) out.push(`変更の記録帳${q(f.changelog)}も、ここに保管しています。`);
      return out;
    },
    max: 6,
    close: ['記録のことなら、いつでもお尋ねください。', '帳面は、きちんとつけておきますね。'],
};
