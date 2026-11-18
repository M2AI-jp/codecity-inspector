// 道場の話し方を独立して確認できるよう、台詞をここにまとめる。
import { fmtInt } from '../../util.js';
import { q, san, shortSubject, whenJa } from '../text.js';
import { dojoStatusLines } from './shared.js';

export const dojoVoice = {
    greet: ['ようこそ、道場へ。', 'お静かに。ここは道場です。'],
    what: ['ここでは、街のしくみが本当に動くかを確かめています。', '動くと言われたものを、実際に動かして確かめる場所です。'],
    facts(f) {
      const out = dojoStatusLines(f);
      if (f.files > 0) out.push(`試験（テスト）のファイルが${fmtInt(f.files)}個あります。`);   // test files, helpers included (not test cases)
      if (f.runners && f.runners.length) out.push(`確かめる道具は ${f.runners.slice(0, 2).join('、')} です。`);
      if (f.dirs && f.dirs.length) out.push(`稽古場は${f.dirs.slice(0, 2).map(q).join('と')}です。`);
      if (f.latest && f.latest.subject) {
        const w = whenJa(f.latest.date);
        out.push(`最近の稽古は${w ? `${w}、` : ''}${f.latest.author ? san(f.latest.author) : 'だれか'}の『${shortSubject(f.latest.subject)}』です。`);
      }
      return out;
    },
    close: ['動くと言うなら、確かめてからにしましょう。', '確かめたことだけが、本当のことです。'],
};
