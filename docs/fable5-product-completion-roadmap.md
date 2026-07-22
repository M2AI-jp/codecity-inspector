# Fable5 プロダクト完成ロードマップ

> **状態:** 実行計画。ここにある未完了チェックは、未実装または同一revisionの証拠が未取得であることを示す。未検証を不具合とは扱わない。
>
> **現行の技術ベースライン:** `967acb1`。Prefabランタイム描画、町マスター画像のruntime非参照、Prefab再合成のピクセル差分0、348件のテスト成功までは観測済み。ただし、これらはプロダクト完成や公式スコアを意味しない。

## 1. 最終的に顧客が得る体験

顧客が同じゲームを初めて開始してから再開するまで、次を自然に完走できることを最終目標にする。

1. 自分のリポジトリに基づく街が表示され、目的と操作をすぐ理解できる。
2. キーボード・クリック・タッチで、4方向の人物が自然に歩く。壁・水・家具には正しく止まり、閉鎖中の入口には理由が表示される。
3. 宿屋、市庁舎、住宅へ入口を通って出入りし、入った建物だけがcutawayになり、人物・NPC・室内が読みやすい。
4. 宿屋のNPCとの会話から調査を開始し、観測・推定・不明を区別した根拠をたどり、3種類の調査を経て市庁舎で回答と結果説明まで到達する。
5. 途中で再読み込みしても、そのリポジトリとinspection digestに属する進行・位置・設定を安全に再開できる。失敗時は理由と回復方法が分かる。
6. 1280×720 と 1920×1080 のどちらでも崩れず、素材・会話・移動・保存が信頼でき、プロダクト所有者が実際に遊んで承認する。

完成は、上記を**同一Git revision・同一URL・同一実ブラウザ**で確認し、最後にプロダクト所有者がプレイ承認したときだけ宣言する。正本は [ゲーム完成条件](game-completion-definition.md) である。

## 2. 逆算した依存関係

- [ ] **G8 — 所有者が「顧客に渡せる」とプレイ承認する**
  - 必要な評価: E8の最終スコアが85点以上、各行60%以上、visual 48/55以上、gameplay 22/27以上、UI/dialogue 8/10以上、experience/robustness 5/8以上、Hard Gate全PASS。
  - そのために必要: 同一revisionの証拠パケット、独立した再判定、所有者の実プレイ。

- [ ] **G7 — 一回の実ブラウザ検証で、完全な顧客導線と品質を証明する**
  - 必要な評価: E7の連続golden route、両viewportの画像、console/network/errorログ、リロード・resize・設定の再生、3リポジトリ差分確認。
  - そのために必要: G3〜G6が実装済みで、承認済み素材だけが読み込まれること。

- [ ] **G6 — 保存・アクセシビリティ・失敗回復が顧客を置き去りにしない**
  - 必要な評価: E6の新規開始・復元開始・確認付きリセット・失敗状態・keyboard/touch/reduced-motion・音声方針の確認。
  - そのために必要: クエスト状態、設定、repository identity/inspection digestの保存設計。

- [ ] **G5 — 調査と会話が、遊ぶ意味のある一周の体験になる**
  - 必要な評価: E5の会話UI、選択肢、長文、3調査、帰還、回答、結果説明の連続実演。
  - そのために必要: 市庁舎への入場、意味のある会話状態機械、根拠ラベル、正規のdialogue素材。

- [ ] **G4 — 三つの建物が本当に遊べる場所になる**
  - 必要な評価: E4の宿屋・市庁舎・住宅の連続入退室、door alignment、cutaway、室内衝突、人物前景、10コーナー接近。
  - そのために必要: 各建物の室内kit、入口・nav・camera・collision・NPC配置、アート契約済み素材。

- [ ] **G3 — 人物とNPCが世界に属して見え、操作に即応する**
  - 必要な評価: E3の4方向 idle 2 / walk 6 / interact 2、10fps、全frame pivot `(32,120)`、独立したeast向き、人物・NPCのdraw order検証。
  - そのために必要: 承認済み640×512・4×10のキャラクターシートと、それを再生できるランタイム。

- [ ] **G2 — 必要なアートが契約・出自・人間承認つきで利用可能になる**
  - 必要な評価: E2のasset-forge候補検収、N1–N9、hash/provenance、視覚審査、human promotion/export。
  - そのために必要: 正しいFable5契約を扱えるasset-forge経路と、外部の人間監督付き生成セッション。

- [ ] **G1 — 評価対象そのものが一意に定義される**
  - 必要な評価: E1の正本・スコープ・asset inventory・browser条件の凍結。
  - そのために必要: 文書間の矛盾をプロダクト所有者が決定し、古い証拠を歴史資料として分離すること。

## 3. 実行順TODOと評価ゲート

各フェーズは、直前の評価がPASSになるまで次のフェーズを「完成扱い」にしない。実装を並行してもよいが、判定はこの順に固定する。

### P0 — 正本と受入範囲を凍結する（最初に行う）

- [ ] 現行HEAD、URL、対象ブラウザ、browser version、DPR、viewport、capture時刻を記録する新しいQA iterationを作る。古い [証拠マトリクス](qa/evidence-matrix.md) は `356f7e6` 時点の履歴として残し、現在の判定に流用しない。
- [ ] `1586×992` の現在Prefabマスターと、`1536×1024` を正本とする [Fable5 Art Contract](../Fable5ArtContract.md) の矛盾を、どちらが今回の完成対象かという所有者決定で解消する。寸法・SHA-256・座標系を一組だけ固定する。
- [ ] 必須素材数・受入manifestの正本を決める。`asset-inventory.json` の「57 core」と、固定asset quotaを退役とする `Fable5PrefabSpec.md` の不整合を解消する。
- [ ] 音声を完成基準に含めるか決定する。含めない場合は、D1/HG関連の受入条件を所有者承認つきで改訂する。黙ってスキップしない。
- [ ] 「3建物」「3調査方式」「保存・復元」「3リポジトリ比較」を今回の完成スコープに残すことを確認する。

**E1 — 受入対象凍結（PASS条件）**

- [ ] 1つの正本画像・座標系・asset set・音声方針・完成rubricが、revision付き文書に記録される。
- [ ] 古いdirect-master runtimeや旧HEADの証拠は、現行判定の根拠から除外される。
- [ ] 所有者が、このスコープで最終承認を行うことを確認する。

### P1 — 必要素材の棚卸しとasset-forgeの互換化を行う

- [ ] 顧客導線に必要な素材を、既存の決定論的Prefab由来素材、修復・派生できる素材、新規生成が必要な素材に分ける。最低限、`char_player`、`char_innkeeper`、市庁舎室内kit、住宅室内kit、door/cutaway/UIの不足分を列挙する。
- [ ] プレイヤーのart-directionを、却下済みのnavy coat/scarf/satchel identityから、ledgerの `user_character_style_reference` へ安全に移す。正確なパスとhashはledgerから解決し、tools/asset-forgeへ却下済み参照を再導入しない。
- [ ] innkeeperの新しいart-directionとruntime bindingを作る。
- [ ] asset-forgeのlegacy `24×40 / 4×3` とv2 `48×96` の前提を、Fable5の `640×512 / 4×10 / 64×128 / pivot(32,120)` 契約へ移行するか、draft contractを直接消費する安全なadapterを実装する。
- [ ] `make-job` / `import` / `process` / `promote` / export のうち、今回のFable5契約に適用する経路を明示する。legacy 78件用の `promote-required` をこの2キャラクターの承認手段として誤用しない。
- [ ] job-packが、正しいprompt、出自、reference hash、output contractだけを含み、候補画像を生成しないことを確認する。

**E2a — 生成前preflight（PASS条件）**

- [ ] schema/unit test と `doctor`・`validate`・dry-runの実行記録により、Fable5契約を処理できる。
- [ ] player/innkeeperのjob-packは640×512、40 frame、全frame pivot、独立east、正しいreference hashを示す。
- [ ] 旧identity・mock・未承認candidate・runtime fallbackがjob-packまたはruntime bindingへ混入しない。

### P2 — 外部生成、候補の取り込み、人間による素材承認を行う

asset-forgeは画像生成器ではない。ここで初めて、**所有者が明示承認した**外部の人間監督付き生成セッションを使う。API keyや暗黙の有料fallbackは使わない。`codex-subscription` も設定・明示承認がない限り利用しない。

- [ ] 各生成セッションについて、対象asset、provider/session、参照、費用・利用条件、承認者を記録し、所有者の実行承認を得る。
- [ ] playerとinnkeeper、必要なら室内kit候補を外部生成する。候補はflat chroma-keyまたはalpha、ラベル・文字・透かしなしで受け取る。
- [ ] 返却PNGをhash検証つきで `pending` にimportし、実際のtool/session/method/hash/dimensions/derivationをprovenanceへ記録する。生成物を `user-direct` と表記しない。
- [ ] alpha・trim・grid抽出は非破壊のprocess経路で実施し、候補・比較画像・元bytesを保持する。
- [ ] 人間レビューで、同一人物性（player）、画風整合（innkeeper）、40セル、idle/walk/interact、pivot、east非ミラー、透過、文字・watermark・halo・key残留、townの光と密度を確認する。
- [ ] 不合格候補は理由を記録してquarantine/rejectし、承認素材や履歴を上書きしない。
- [ ] 人間のみがinteractive promotionを実施し、承認後にexport dry-run、manifest/binding検証、必要な場合だけwrite exportを行う。

**E2b — 機械検収（PASS条件）**

- [ ] PNG hash、format、640×512、40個の64×128 frame、alpha/chroma状態、出自record、contract schemaが一致する。
- [ ] N1–N9を通過する。特に全frameのfoot pivot `(32,120)`、native scale、輪郭、不要な影、透過、文字、発光を検査する。

**E2c — 人間視覚承認（PASS条件）**

- [ ] native/contact sheet、pivot overlay、east-vs-west比較、runtime合成GIFまたは動画をレビューする。
- [ ] playerは正しい緑基調の同一人物性を保ち、innkeeperは別人でも同じpixel density・頭身・輪郭・陰影言語を共有する。
- [ ] 承認は人間レビューアの署名・note・hash確認を伴い、approved metadata/export manifestへ反映される。

### P3 — 承認済み素材をランタイムへ統合し、自然な人物操作を完成する

- [ ] `PRODUCTION_ASSETS.player` とinnkeeperの旧シート形状前提を置き換え、承認済みexportだけを読み込む。未承認・旧・master画像へのfallbackを作らない。
- [ ] playerとinnkeeperの4×10再生器を実装する。idle 2@4fps、walk 6@10fps、interact 2@6fps、south/west/east/northの行と64×128/pivotを固定する。
- [ ] player/NPCのdraw order、streetlamp、inn foreground、cutaway時の人物可読性を再検証する。
- [ ] keyboard・クリック・タッチが同じ到達可能性を持ち、reduced motionでもゲーム状態が壊れないようにする。

**E3 — 人物・操作評価（PASS条件）**

- [ ] sheet contract、frame選択、fps、pivot、approved URL/hash、fallback不在をunit/contract testで証明する。
- [ ] 実ブラウザ60fps captureで、4方向の停止・歩行・interact、入力方向一致、足滑りなし、pivot drift最大2px以下を確認する。
- [ ] 1280×720と1920×1080で人物・UIが読め、整数zoomだけが使われる。

### P4 — 三建物を遊べる空間として完成する

- [ ] 宿屋を先に完成する。室内camera framing、入口の自然なauto/manual遷移、室内collisionの引っかかり、NPC位置、roof/cutaway、exitを調整する。
- [ ] 市庁舎と住宅を「閉鎖理由表示」から、実際のdoor portal・室内nav・floor/wall/furniture/NPC・exitを持つ建物へ拡張する。
- [ ] 各室内kitの外観footprint、door threshold、interior矩形、collision、NPC routeを同じ座標系で定義し、必要な新規素材はP1〜P2の承認経路へ戻す。
- [ ] active buildingだけがroofを隠し、隣接建物は透過せず、人物は常に読めるdraw orderを保つ。

**E4 — 空間導線評価（PASS条件）**

- [ ] 宿屋・市庁舎・住宅を、spawnから連続して入室・移動・NPC対話・退出できる。
- [ ] door/nav/collision overlay、10のcorner approach、入口の自動・手動fallback、cutaway時の前景を同一revisionで記録する。
- [ ] 室内の床・壁・家具・NPCは実素材で描かれ、外観footprintと一致する。

### P5 — 調査・会話・UIを一周のゲーム体験にする

- [ ] ユーザー提供dialogue frameを正規slicing/9-sliceで実際に使い、話者・本文・選択肢・根拠区分・対象NPCを表示する。
- [ ] 宿屋で始まる2〜4ターン以上の意味ある会話を実装し、次の行動と選択肢がゲーム進行を変えるようにする。
- [ ] 手帳取得 → 問い選択 → 3種類の調査 → 市庁舎帰還 → 回答 → 結果説明を状態機械として実装する。
- [ ] すべてのfactで観測・推定・不明を視覚的かつ追跡可能に分け、ファイル・建物・参照・道路・会話の相互追跡を保つ。

**E5 — 意味ある調査評価（PASS条件）**

- [ ] 長文・選択肢・小さいviewportでdialogue UIが切れず、source crop/9-slice比較が残る。
- [ ] 新規開始から一回の連続captureで、全クエストを完走し、選択と根拠・結果説明を確認する。
- [ ] 異なる3リポジトリで入力差が建物・地区・道路・表示factに反映され、利用者が根拠分類を確認・修正できる。

### P6 — 保存、回復、アクセシビリティ、堅牢性を完成する

- [ ] repository identityとinspection digestごとに、調査状態・player位置・設定を保存する。
- [ ] reload後の復元と、「最初から」による当該保存だけの確認付き削除を実装する。
- [ ] loading、missing asset、invalid data、save failure、closed entry、network failureを明示・回復可能にする。
- [ ] keyboard-only、focus、contrast、non-color cue、44px touch target、reduced motion、resizeを確認する。音声がP0で必須になった場合はfootstep/door/dialogue cueとmute/volumeも実装する。

**E6 — 再開・回復・アクセシビリティ評価（PASS条件）**

- [ ] 新規開始と復元開始の双方でgolden routeを完走し、resetは対象保存だけを消す。
- [ ] reload・resize・設定変更・失敗状態でconsole error、unhandled rejection、network failureが0件になる。
- [ ] keyboard、クリック、タッチ、reduced motion、およびP0で確定した音声方針を実ブラウザで検証する。

### P7 — 最終preflightと証拠パケットを作る

- [ ] 同一WorldPlanの2回描画でPNG hashが一致することを検証する。
- [ ] すべての可視assetをmanifest・source・crop・pivot・layer・hash・approvalへたどれるようにする。
- [ ] Prefab再構成、diff heatmap、SSIM、建物座標比較を、P0で固定した正本に対して再実行する。
- [ ] 実ブラウザで、networkがapproved assetだけを取得し、target/master・legacy fallback・CSS world art・missing-asset concealmentを使わないことを取得ログで示す。
- [ ] 1280×720と1920×1080の全景・100% crop（人物、建物縁、terrain seam、door、cutaway、dialogue）を取得する。
- [ ] 1本の連続60fps captureに、4方向移動、3 blocker、3建物、cutaway、NPC dialogue、quest完走、reloadを含める。
- [ ] console/networkログ、asset manifest、スクリーンショット、動画、テスト出力、SHA、browser/version/DPR/capture時刻を一つの証拠パケットに保存する。

**E7 — Hard Gate再判定（PASS条件）**

- [ ] HG-01〜HG-08を同一revisionの証拠でPASSにする。HG-09/10の既存記録も現行iterationで再確認する。
- [ ] A1〜D2を採点し、各行60%以上、必要分野の最低点、合計85点以上を満たす。
- [ ] 旧matrixを都合よく上書きせず、今回のrevision用の新しい判定表・未解決事項・再現手順を残す。

### P8 — 所有者プレイ承認とリリース判断

- [ ] 所有者が証拠なしの説明ではなく、P7の同じURL/revisionを実際に遊ぶ。
- [ ] 所有者が見た目、操作、三建物、会話、調査、保存・復元、失敗表示を承認または差し戻す。
- [ ] 差し戻しがあれば、該当フェーズへ戻り、変更後はE7を再実行する。
- [ ] すべてPASSした場合だけ、完成判定と公開判断を記録する。

**E8 — 完成宣言（PASS条件）**

- [ ] プロダクト所有者の実プレイ承認がある。
- [ ] 85点基準、全Hard Gate、同一revision証拠、再現手順が揃う。
- [ ] 「テスト数」や「素材数」だけで完成を主張していない。

## 4. いま何を開始でき、何を開始してはいけないか

- [x] 開始できる: P0の正本・スコープ差分の洗い出し、P1のasset gap inventory、asset-forgeの64×128/4×10互換化、宿屋の実装設計、最終evidence harnessの設計。
- [x] 開始できる: 現行Prefabランタイムの回帰テスト、同一revisionのbrowser smoke test、未承認素材を使わない既存導線の改善。
- [ ] まだ開始してはいけない: legacy asset-forge定義のままplayer jobを作ること。これは却下済みidentityと誤ったsprite gridを再導入する。
- [ ] まだ開始してはいけない: human authorizationなしの外部画像生成、または候補をpending/provenanceなしでruntimeへ置くこと。
- [ ] まだ開始してはいけない: P0の正本を決めずに、85点・Hard Gate全PASS・完成を宣言すること。

## 5. 現状との対応

- [x] P7の一部: 48Prefabのoffline再構成は `1,573,312` pixel中差分0でPASS。これはSSIM閾値以上を強く支持するが、P0で正本を固定してから最終evidenceとして再取得する。
- [x] P7の一部: runtimeはPrefabを描画し、町マスターを通信で読まないことを現行browser smoke testとcontract testで確認済み。
- [x] P4の一部: 宿屋の入口・室内・NPC・退出、閉鎖入口の理由表示、reduced motion、touch targetには実装と静的回帰がある。
- [ ] P2/P3: player/innkeeperの新契約素材はdraftだけで、生成・import・人間承認・runtime移行は未着手。
- [ ] P4/P5/P6: 市庁舎・住宅の開放、クエスト一周、保存・復元は完成条件に対して未達または未証明。

## 6. 運用ルール

- [ ] 各実装開始時にGit状態（branch、未コミット差分、stage、HEAD）を記録する。
- [ ] 各評価には、実行コマンド、HEAD、環境、URL、browser/version/DPR、stdout/stderr要約、verified scope、unknown scopeを残す。
- [ ] 生成候補は常にpendingから始め、人間だけが承認する。Codex/workerはpromotionを実行しない。
- [ ] 評価失敗時は「何が観測されたか」と「次に戻るフェーズ」を記録し、未知を失敗またはPASSへ読み替えない。
