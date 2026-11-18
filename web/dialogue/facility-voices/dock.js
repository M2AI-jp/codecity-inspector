// 船着場の話し方を独立して確認できるよう、台詞をここにまとめる。
import { base, q } from '../text.js';
import { APP_JA } from './shared.js';

  // 船頭: what is ready to ship out to other islands. Never says it was published (we have no evidence).
export const dockVoice = {
    greet: ['おう、船着場へようこそ。おれは船頭だ。', 'よう、旅の人。ここは船着場だ。'],
    what: ['ここから、この街でこしらえたものを、外の島へ運ぶんだ。', 'この街でこしらえたものは、ここから船で外へ出ていく。'],
    facts(f) {
      const out = [];
      const apps = Array.isArray(f.apps) ? f.apps : [];
      if (apps[0]) out.push(`${apps[0].path === '.' ? '街のおおもと' : q(apps[0].path)}に、${APP_JA[apps[0].kind] || `${apps[0].kind}のアプリ`}が積んである${apps.length > 1 ? `。ほかに${apps.length - 1}つ` : ''}。`);
      const pk = Array.isArray(f.packages) ? f.packages : [];
      if (pk[0]) {
        const label = `${pk[0].name}${pk[0].version ? ` ${pk[0].version}` : ''}`;
        out.push(`荷札には『${label}』と書いてある（${base(pk[0].path)}）。${pk.length > 1 ? `荷札はほかに${pk.length - 1}枚。` : ''}`);
      }
      if (f.bins && f.bins.length) out.push(`荷を開けると、${f.bins.slice(0, 2).map(q).join('と')}というコマンドが使えるようになる。`);
      if (f.publish && f.publish[0]) out.push(`出港の手順は${q(f.publish[0])}に書いてある。`);
      out.push(pk.length || (f.publish && f.publish.length)
        ? 'ただ、本当に船が出たかどうかは、ここからは分からねえ。'
        : 'ただ、まだ船を出す手順は見当たらねえな。');
      return out;
    },
    max: 5,
    close: ['届いたかどうかは、向こうの島で確かめてくれ。'],
};
