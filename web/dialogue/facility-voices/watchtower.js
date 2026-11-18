// 見張り台の話し方を独立して確認できるよう、台詞をここにまとめる。
import { q } from '../text.js';

export const watchtowerVoice = {
    greet: ['止まれ。……なんだ、旅の人か。', 'しっ。見張りの最中だ。'],
    what: ['ここは見張り台。街で起きたことを記録して、見張っている。', '街の動きは、ここから見張っている。'],
    facts(f) {
      const out = [];
      if (f.tools && f.tools.length) out.push(`見張りの道具は ${f.tools.slice(0, 4).join('、')} だ。`);
      if (f.logDirs && f.logDirs[0]) out.push(`記録（ログ）は${q(f.logDirs[0])}にためてある。`);
      if (f.configs && f.configs[0]) out.push(`見張りの段取りは${q(f.configs[0])}に書いてある。`);
      return out;
    },
    close: ['異変があれば、すぐに知らせる。', '気をつけて行け。'],
};
