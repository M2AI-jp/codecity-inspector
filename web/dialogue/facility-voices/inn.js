// 宿屋の話し方を独立して確認できるよう、台詞をここにまとめる。
import { q } from '../text.js';

export const innVoice = {
    greet: ['いらっしゃいませ！宿屋へようこそ。', 'ようこそ、お疲れさまでした。宿屋の番頭でございます。'],
    what: ['ここは、外からのお客さんをお迎えする、この街の入口です。', '外から来るお客さんは、まずここに立ち寄られます。'],
    facts(f) {
      const out = [];
      if (f.servers && f.servers[0]) out.push(`お客さんは${q(f.servers[0].path)}でお迎えしています（${f.servers[0].how}）。`);
      if (f.domains && f.domains[0]) out.push(`表の看板は${q(f.domains[0])}。その住所でお店を出す段取りでございます。`);
      else if (f.deploy && f.deploy[0]) out.push(`${q(f.deploy[0])}の段取りで、表に店を出しております。`);
      if (f.frameworks && f.frameworks.length) out.push(`宿の造りは ${f.frameworks.slice(0, 2).join('、')} です。`);
      else if (f.configs && f.configs[0]) out.push(`宿の骨組みは${q(f.configs[0])}に書いてございます。`);
      if (f.pages && f.pages[0]) out.push(`最初にお見せするページは${q(f.pages[0])}です。`);
      return out;
    },
    close: ['どうぞ、ごゆっくり。', 'またのお越しを、お待ちしております。'],
};
