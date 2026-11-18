// 倉庫の話し方を独立して確認できるよう、台詞をここにまとめる。
import { fmtInt } from '../../util.js';
import { q } from '../text.js';
import { count } from '../contents.js';

export const warehouseVoice = {
    greet: ['……倉庫だ。', 'ん。倉庫に用か。'],
    what: ['データをしまっておく場所だ。', 'ここには、街のデータがしまってある。'],
    facts(f) {
      const out = [];
      if (f.kinds && f.kinds.length) out.push(`しまい方は ${f.kinds.slice(0, 4).join('、')}。`);
      if (f.sqlFiles > 0) out.push(`SQL のファイルが${count(f.sqlFiles)}。`);
      if (f.migrations > 0) out.push(`棚の作りかえの手順（migrations）が${fmtInt(f.migrations)}件。`);
      if (f.configs && f.configs[0]) out.push(`棚の並べ方は${q(f.configs[0])}に書いてある。`);
      if (f.dataFiles && f.dataFiles[0]) out.push(`データの箱${q(f.dataFiles[0])}も、ここにある。`);
      else if (f.sqliteCode && f.sqliteCode[0]) out.push(`${q(f.sqliteCode[0])}が、SQLite の箱を開け閉めしてる。`);
      return out;
    },
    close: ['勝手に棚をいじるなよ。', '以上だ。'],
};
