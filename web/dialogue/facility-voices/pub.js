// 酒場の話し方を独立して確認できるよう、台詞をここにまとめる。
import { listJa, q } from '../text.js';

export const pubVoice = {
    greet: ['おう、酒場へようこそ。', 'いらっしゃい。まあ、座んな。'],
    what: ['この街と外をつなぐ連中が、ここに集まってる。', '外とつながる連中は、みんなここに顔を出すのさ。'],
    facts(f) {
      const out = [];
      const cs = Array.isArray(f.connectors) ? f.connectors : [];
      const names = cs.map((c) => c.name);
      if (names.length) {
        const first = names.slice(0, 4), rest = names.length - first.length;
        out.push(names.length === 1 ? `名簿に載ってるのは、${names[0]}だけだ。` : `名簿を読むぞ。${first.join('、')}${rest > 0 ? `、ほか${rest}組` : ''}。`);
      }
      const dep = cs.find((c) => c.via === 'dep' && c.paths && c.paths[0]);
      if (dep) {
        const same = cs.filter((c) => c.via === 'dep' && c.paths[0] === dep.paths[0]).map((c) => c.name).slice(0, 3);
        out.push(`${listJa(same)}の名前は、${q(dep.paths[0])}に載ってる。`);
      }
      const url = cs.find((c) => c.via === 'url' && c.paths && c.paths[0]);
      if (url) out.push(`${url.name}へは、${q(url.paths[0])}から使いを出してる。`);
      if (f.webhooks && f.webhooks[0]) out.push(`外からの知らせは${q(f.webhooks[0])}で受けてる。`);
      return out;
    },
    // the last line offers the guild roster (web/ui.js shows the choice under it)
    close: ['ここは接続者ギルドだ。名簿を見ていくかい？'],
    offer: 'roster',
};
