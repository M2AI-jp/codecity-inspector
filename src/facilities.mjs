// リポジトリの証拠から施設（PRODUCT.md §4 の施設表）を見つける。控えめに判定し、理由は事実だけを書く。
//   town_hall 役場     : git リポジトリ（コミット・タグ・リリース）
//   inn       宿屋     : 公開Webサービス（Webサーバーのコード、公開・配備の設定、Webの骨組み）
//   pub       酒場     : API・外部接続・LLM API・webhook（依存の SDK、API の住所、webhook の道）
//   warehouse 倉庫     : DB・storage（DB の依存、SQL・SQLite、migrations・prisma）
//   watchtower 見張り台: logs・monitoring（記録・監視の依存、logs ディレクトリ、監視の設定）
//   dojo      道場     : test・E2E（テストのディレクトリ・ファイル、テストの道具）
//   well      井戸     : env・secrets・config（外に立つ施設）
//   dock      船着場   : アプリ・パッケージの配布
//   gate      門       : 外から人が入る入口（宿屋と同じ証拠＋受付の道・ログインの道具）。外に立つ施設
//   repair    修理小屋 : rollback・recovery（切り戻し・復旧の手順やコマンド）
// 中身を読むのは依存の一覧と、上限つきのソースの走査だけ（git なら HEAD の内容を cat-file --batch でまとめて読む）。
import { prepareFiles } from './facilities/detect/files.mjs';
import { readDependencies } from './facilities/detect/dependencies.mjs';
import { scanSources } from './facilities/detect/sources.mjs';
import { prepareEvidence } from './facilities/detect/evidence.mjs';
import { addTownHall } from './facilities/detect/town-hall.mjs';
import { addServiceFacilities } from './facilities/detect/services.mjs';
import { finishFacilities } from './facilities/detect/finish.mjs';

export { hasPgDumpAndRestore, hasFlyDeployImageBack } from './facilities/recovery.mjs';
export { pickWithinBudget } from './facilities/scan.mjs';

// ---------- 本体 ----------
// files: [{path, ext, bytes, binary}], history: 新しい順のコミット [{hash,date,author(key),subject,files}],
// groups: モジュール [{path, files}], extra: { root, isGit, head, git, keyer, refTime, rootFiles }
export function detectFacilities(files, history, groups, extra) {
  // 各段階が同じ証拠と読込キャッシュを使う。判定・追加・統合の順序を保つ。
  const S = { files, history, groups, extra };
  prepareFiles(S);
  readDependencies(S);
  scanSources(S);
  prepareEvidence(S);

  // --- 修理小屋: rollback / recovery ---
  const { recovery, add } = S;
  if (recovery) add('repair', '修理小屋', recovery.reason, recovery.evidence, recovery.facts);

  addTownHall(S);
  addServiceFacilities(S);
  return finishFacilities(S);
}
