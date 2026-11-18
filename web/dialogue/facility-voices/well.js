// 井戸の話し方を独立して確認できるよう、台詞をここにまとめる。
import { fmtInt } from '../../util.js';
import { base, listJa, q } from '../text.js';

  // 井戸番: the settings (env) the town draws from its well. Names only; values are never read.
export const wellVoice = {
    greet: ['やあ、井戸へようこそ。わたしは井戸番だよ。', 'こんばんは。井戸の番をしているよ。'],
    what: ['この井戸から、街が動くのに使う「設定」をくんでいるんだ。', 'この街は、ここから「設定」の水をくんで動いているんだよ。'],
    facts(f, town) {
      const out = [];
      const names = Array.isArray(f.names) ? f.names : [];
      const total = Math.max(f.namesTotal | 0, names.length);
      if (names.length) {
        const shown = names.slice(0, names.length > 3 ? 2 : 3);
        out.push(total > shown.length
          ? `この街が使う設定の名前は、${shown.join('、')}など、見つかっただけで${fmtInt(total)}個だよ。`
          : `この街が使う設定の名前は、${listJa(shown)}だよ。`);
      }
      const past = Array.isArray(town?.canal?.past) ? town.canal.past.filter(Boolean) : [];
      if (past.length) out.push(`水路は${past.map(q).join('、')}のそばを通っているよ。そこが、設定の名前をいちばん多く読む所だからだよ。`);
      if (f.examples && f.examples[0]) out.push(`書き方の見本は${q(f.examples[0])}にあるよ。`);
      else if (names.length) out.push('書き方の見本（.env.example）は、見当たらないね。');
      if (f.committed && f.committed[0]) {
        out.push(`秘密の鍵が入っているかもしれないファイル（${base(f.committed[0])}）が記録に入っています。`);
        out.push('わたしは中身をのぞいていないよ。気になったら、確かめてみてね。');
      }
      if (f.loaders && f.loaders.length) out.push(`水をくみ上げる道具は ${f.loaders.slice(0, 2).join('、')} だよ。`);
      if (f.ciSecrets && f.ciSecrets.length) out.push(`自動の仕事（CI）は、${f.ciSecrets[0]}${f.ciSecrets.length > 1 ? 'などの' : 'という'}鍵を使うよ。`);
      if (f.configs && f.configs[0] && out.length < 4) out.push(`設定のファイルは${q(f.configs[0])}にもあるよ。`);
      return out;
    },
    max: 5,
    close: ['水の味（設定の中身）は、わたしも知らないんだ。名前だけ知ってるのさ。'],
};
