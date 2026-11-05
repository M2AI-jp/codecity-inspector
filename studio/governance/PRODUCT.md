# CodeCity — ユーザー根拠に基づく唯一の製品SSoT

## 最初に読む失敗記録と権威

旧PRODUCT.mdには、ユーザー原文の裏付けを示さないままassistantが生成した仕様、固定の実装構造、検証方法、完了条件が混入していた。現行コードと旧文書を互いの根拠にすると、その混入が製品要求として再生産される。この文書はそれらを継承せず、取得できたユーザー要求を出典とともに整理し直す。

このファイルだけがCodeCityの規範SSoTである。README、AGENTS.md、コード、Git履歴、画像のファイル名、assistantの提案、Linearは、独立した製品仕様を定めない。LinearはこのSSoTに従う実行mirrorであり、製品意図を上書きしない。ユーザーの新しい決定は出典とともにここへ反映し、その後Linearへ同期する。矛盾や必要な文脈の欠落があれば、依存する作業を止めてユーザーに確認する。

Linear project: [CodeCity — リポジトリが街になる](https://linear.app/matsunai/project/codecity-リポジトリが街になる-a5a14b57f9bb)
Linear mirror document: [CodeCity PRODUCT SSoT — Linear mirror](https://linear.app/matsunai/document/codecity-product-ssot-linear-mirror-0b5e16adca55)

現行remoteから取得したclean baselineは変更を始めるための基準であって、製品の正解ではない。既存実装と旧README・旧PRODUCTは現状把握のinventoryとしてのみ扱い、ユーザー意図の証拠にはしない。旧仕様をGit履歴から復活させない。

## 出典台帳

ユーザーが書いた要求とassistantの応答は区別する。過去taskは保存されたuser promptを出典とし、task IDと保存記録内のordinalで位置を示す。要約は要求の整理であり、原文にない範囲を増やさない。

| ID | 出典 | 要求・扱い | 状態 |
|---|---|---|---|
| U1 | 現行task `01a03534-029a-7533-bf59-915e21ccb8a9` のユーザー要求 | 必要な行動・コード・ファイルを最小化する。stack変更は可能。既存環境とassetを再利用する。 | 現行ユーザー要求 |
| U2 | 同taskのユーザー指定参照 [X投稿](https://x.com/80Level/status/2092931158510043540?s=20) | 2026-08-27に当該task内でbrowserを通じて直接取得し、動画の可視frameを確認済み。解釈は参照品質に限定し、作品の複製指示として扱わない。 | 直接取得・可視frame確認済み |
| U3 | 同taskのユーザー要求 | product関連task/sessionを参考にSSoTと新規Linear projectを作成し、現行code/specに意図しない内容が含まれる可能性を扱う。 | 現行ユーザー要求 |
| U4 | 「工房デザイン指示」`6a52dcf4-df08-83ee-94ed-174a1a6e7dcc`、saved ordinal 3817 | 工房が表すrepository概念、密度・材質・視点・光源・生活感、オリジナル制作、同座標での自動cutaway。 | 保存user原文を回収 |
| U5 | 「建物デザインガイドライン」`6a52de56-01fc-83e8-8275-3340bab4277d`、saved ordinal 3816 | 住宅・商店が表すrepository概念、廃屋の意味の扱い、路地が成立する密度と全体の統一。 | 保存user原文を回収 |
| U6 | 「石畳タイル制作依頼」`6a52dc32-e370-83ee-ad5e-5622b6919a97`、saved ordinal 3818 | 連続した地面と街路、静かな歩行面、一方向の3/4見下ろし、人物尺度と左上の夜間光源の共有。 | 保存user原文を回収 |
| U7 | 現行task `01a03534-029a-7533-bf59-915e21ccb8a9`、rollout ordinal 10 | main agentによるtest・build・lint・typecheck・runtime・browser検証は禁止。 | 旧指示。U9が残る完成阻害に必要なruntime・CLI・browser利用を上書き |
| U8 | 現行ユーザー提供AGENTS規則 | 対象SSoTとLinearを読んでから実行し、必要文脈の不足または矛盾があれば停止して確認する。 | 現行ユーザー規則 |
| U9 | 現行taskの最新ユーザー指示 | 承認待ちや未確認を理由に停止せず、付与済みfull accessを使って目的達成まで進める。 | 現行ユーザー要求 |
| G1 | 「CodeCity v1 PRODUCT決定」taskの回収状態 | 添付本文を取得できていない。周辺のassistant生成文をユーザー決定に読み替えない。 | 根拠欠落。未確定 |
| X1 | agent-harnessに関する別製品のtask | CodeCityの要求ではない。 | 対象外 |

原文の主要な根拠：

- U4：「このゲームでは、工房は build、CI、local run、開発環境、街を動かす作業を表します。」「参考にするのは、密度、材質感、視点、光源、生活感、街の空気です」「ただし既存作品の素材、マップ、キャラクター、建物、UIをコピー・トレース・再現しないでください」
- U4： “Entry must be automatic when the player crosses the occupied threshold.” “Keep the exterior, interior, ground footprint, roof/foreground occlusion, shadow, and state overlays aligned to the same coordinates.”
- U4の入場方式： “Do not design an action-key prompt, a door-directed objective, a teleport, UI, labels, or a detached room.” この禁止は当該入場方式に対する指示であり、全ゲームのUI・action key禁止に拡張しない。
- U5：「このゲームでは、一般住宅や商店は feature、module、component、UI領域など、街の日常を構成する機能を表します。」「ただし、廃屋は単なる悪ではありません。」「住宅群だけで街の路地が成立する密度を出す」「建物、地面、小物、人物が同じ世界に存在しているように統一する」
- U5： “The result must show the same workshop at the same place. The inside must be reachable from the existing street through the same occupancy area.”
- U6： “Reconstruct only the continuous terrain and worn stone street below them, on the same canvas and with the same road alignment and edge connections.” “Keep it quiet enough for the workshop building and residents when layers are placed above it.”
- U6： “Do not make a contact sheet, a catalog, repeated opaque stamps, or separate unrelated tiles.” “Preserve the fixed one-way three-quarter top-down projection, no camera rotation, the same pixel density, the same human height scale, and the same upper-left night light.”

## 顧客が得る体験

| ID | 主体 | 入力→処理→出力 | 依存/出典 | 状態 |
|---|---|---|---|---|
| C-01 | CodeCity | ユーザーのrepository → 意味を解釈 → 建物・地区・街路がつながる連続した街 | 対象repositoryと意味変換。U1、U4、U5 | 確定 |
| C-02 | 制作担当／CodeCity | 視覚参照とオリジナルart → 統一した3/4見下ろしで構成 → 高密度で緻密かつ生活感のある街 | 参照品質を採用し作品を複製しない。U2、U4〜U6 | 確定 |
| C-03 | 制作担当／CodeCity | 建物・人物・小物・地面・街路 → 尺度・素材・密度・左上の夜間光を統一 → カタログではなく一つの場所 | 各要素の視覚的一貫性。U4〜U6 | 確定 |
| C-04 | CodeCity | build・CI・local run・開発環境・feature・module・component・UI・legacy → 文脈に沿って意味を対応付け → 工房・一般建物・地区・古びた場所として表現し、単純な善悪にしない | repositoryの文脈と概念の因果関係。U4、U5 | 確定 |
| C-05 | 制作担当／CodeCity | 摩耗した石畳と街路の接続 → 連続した控えめな地面を構成 → 読み取りやすい歩行面 | 道の位置と縁の接続。U6 | 確定 |
| C-06 | プレイヤー／CodeCity | プレイヤーが占有領域を越える → 座標のそろった屋根・前景を自動cutaway → action key・teleport・独立した別室なしで同座標の内部を見せる | 外観・内部・footprint・遮蔽の位置の一致。U4、U5 | 確定 |
| C-07 | 実装担当 | 確定したoutcomeと既存環境・asset → SOLIDに従いstackを自由に選び最小構成で実装 → 必要最小限のコード・ファイル・行動 | 確定outcomeと再利用可能な環境・素材。U1 | 確定 |

ユーザーのリポジトリが、意味のある建物や地区を持つ、一つの連続した街になる。工房はbuild・CI・local run・開発環境などを、一般住宅や商店はfeature・module・component・UI領域などを表す（U4、U5）。廃屋を単に悪いものと扱わない。その他の概念の対応は入力との因果関係を明示し、既存の対応表があるという理由だけで製品仕様にしない。

街は高密度で緻密なオリジナル2Dピクセルアートで表現する。既存作品の素材・マップ・キャラクター・建物・UIをコピー、トレース、再現しない。3/4見下ろしと左上からの夜間光を共有し、素材、人物尺度、建物密度、生活感が街全体で一貫する（U4〜U6）。建物を個別の画像として並べるだけでなく、連続した地面と街路で一つの場所としてつなぐ。石畳は周囲の建築や人物を支える静かな歩行面にする。

建物の内部は、その建物と同じ座標に存在する。プレイヤーが占有領域を越えると上部が自動的に切り替わるcutawayを用いる。外観、内部、地面のfootprint、屋根・前景の遮蔽、影、状態overlayを同座標でそろえる。既存の街路から同じ占有領域を通って入る。入場のためのaction keyや扉への誘導、teleport、独立した別室を設けない（U4、U5）。

個別の画像制作taskに指定されたcanvas寸法を、全asset共通寸法へ拡張しない。共通にするのは街での見え方、人物尺度、pixel density、視点、光の整合である。街の具体的なゲーム進行、起動方法、配布方式を視覚意図から推測して確定しない。

## 主体・依存関係・入出力・処理順序・状態

| 順序 | 主体 | 入力・必要な文脈 | 処理と依存関係 | 出力 | 状態 |
|---|---|---|---|---|---|
| 1 | ユーザー／main agent | 回収したuser prompt、指定参照、欠落の記録 | user原文とassistant生成を分離し、根拠のある要求を確定する。 | このSSoTの根拠付き要求と未承認事項 | 完了（2026-09-12） |
| 2 | main agent | 確定したSSoTと対象Linear | 両方を読み、相違を解消する。LinearはSSoTの要求と作業状態を写す。 | 一致した実行対象 | 同期済み（2026-09-12） |
| 3 | main agent | 合意済み要求、現行実装inventory、既存環境・asset | 根拠のない仕様を規範から削除し、実装上の不要部分を特定する。根拠未確定の範囲は実装しない。 | 最小実装に必要な範囲 | QA指摘を含め完了（MAT-624） |
| 4 | 実装担当 | ユーザーが対象とするrepository、確定した意味変換、再利用素材 | repositoryの概念を建物・地区へ変換し、一貫した尺度・光・素材・街路・cutawayを組み立てる。SOLIDに従い責任と依存を分離する。 | 意図を一貫して体験できる最小vertical slice | 実装提出済み（MAT-626、MAT-630） |
| 5 | 独立QA担当 | 原要求、受入条件、提出済み成果、必要な根拠 | 成果提出後に評価し、具体的反証の修正範囲だけを再評価して終了する。 | 根拠付きの不一致・最終判定 | 静的不一致、11件以上の配置、集約関係、実画面、cutaway、asset最小化を確認して最終PASS（MAT-631、MAT-660、2026-09-12） |
| 6 | main agent／独立QA担当 | 実装済みCLI・runtime・browser、C-02・C-03、U9 | 実画面を起動して街・歩行・cutawayを確認し、欠陥を修正して独立QAへ渡す。 | 顧客が実際に得る完成画面と操作体験 | 完了（MAT-660、2026-09-12） |
| 7 | ユーザー | 完成画面、操作体験、独立QA結果 | 意図に合っているか判断し、必要な変更を決定する。 | 次の決定とSSoTの更新 | 完成成果を引き渡し |

これは因果関係と作業順序であり、現行のモジュール名・ファイル数・利用stackを固定しない。stack変更はユーザーが許容している。既存環境とassetを再利用し、要求を満たすために必要な行動・コード・ファイルだけを残す。現在のファイルが存在することも、参照がないことも、それだけでは必要性の証拠にならない。

## 未承認・実装前に確認

次の内容は取得できたユーザー原文に根拠がない、または根拠の回収が不足している。旧仕様に存在しても承認済みの要求として実装・維持・完了判定に用いない。

| 内容 | 現時点の扱い |
|---|---|
| 依頼受領、必ず3回の調査、別の場所での報告、town-hall lantern、退出・再訪・永続化を必須にする進行 | ユーザー意図の確認前に固定しない |
| 複数の完全なworldviewをv1の必須条件にすること | 視覚的一貫性の要求から複数世界観を導出しない |
| 固定の`npx codecity`、Nodeバージョン、port、配布方式 | 現行の実装事実があっても製品上の約束にしない |
| `ship/10`〜`90`の固定構造、番号順依存、特定のcomposition root・SceneBundle・index経由import | SOLIDを満たすための唯一の実装として扱わない |
| 全assetに共通寸法や固定pixel gridを強制すること | 必要なのは街での尺度・視点・表現の一貫性。具体寸法を既存コードから規範化しない |
| `ship/50-art/assets/`の新しいexact bytesをownerだけが承認できる規則、22枚という原本固定数 | user原文未回収。既存assetを改変する権限の根拠にはしない |
| 一律のRPG機能、住民数・施設数・動作数、入力キー、カメラ寸法 | 顧客の確定意図に必要な範囲を確認してから定める |
| `observed`・`inferred`・`unknown`等の固定contractや検証表示、local/serverの具体仕様 | 旧コードの設計を承認済み仕様にしない。事実・推測・不明を混同する根拠にもならない |

根拠のない仕様を未承認へ移すことは、対象repositoryの実行・破壊、素材の上書き、公開、送信などを新しく許可する意味ではない。具体的操作はユーザーが与えた対象と権限の範囲で行う。

## 実行制約と残作業

U9に従い、main agentは残るC-02・C-03と実際の操作体験を完成させるため、CLI・runtime・browserを承認待ちなしで使用する。目的に不要なtest suite・build・lint・typecheckは追加しない。独立QAは成果提出後の評価で終了し、待機担当にしない。具体的変更や新しい反証がない限り再監査を追加しない。

未完了は未完了として記録する。assistantの承認語、実装の存在、asset数、検証結果だけでユーザーの意図を満たしたと判断しない。

2026-09-12の実測では、main agentが現行CLIからCodeCity自身を街へ変換し、Chrome上で初期街、連続歩行、camera追従、背景・建物・室内collision、占有thresholdでの自動cutaway、同一座標の室内、退出時の外観復帰を確認した。browserのwarning・errorは0件だった。実sceneは10地点、全地点automatic entry、1312×920の単一environment image、28個の使用assetで構成された。

11件以上のsemantic groupは、town-domainが元のsource paths、根拠、履歴、member meanings、内部・外部linkを失わず最大10の物理districtへ集約する。worldgenは重複配置fallbackを持たない。shipping inventoryはworldgen全分岐から到達可能なmanifest・provenance・PNG各36件へ縮小し、旧quest・report・lantern・snow・multiworld由来の到達不能素材108件を削除した。独立QAは、実画面とこれらの修正を最終PASSと判定した。

## Linear対応と現在状態

SSoTとLinear管理基盤: 完了（2026-09-12）

製品実装: 完了（2026-09-12）。CLI・runtime・Chromeで街・歩行・collision・同座標cutaway・退出復帰を実測し、容量超過時のdistrict集約、関係情報のscene保持、shipping asset最小化を含めて独立QAが最終PASSと判定した。

| Linear issue | 作業 | 依存関係 | 状態 |
|---|---|---|---|
| [MAT-624](https://linear.app/matsunai/issue/MAT-624) | 現行実装意図監査 | 依存なし | Done |
| [MAT-626](https://linear.app/matsunai/issue/MAT-626) | 連続街 | blocked by MAT-624 | Done |
| [MAT-630](https://linear.app/matsunai/issue/MAT-630) | 同座標cutaway | blocked by MAT-626 | Done |
| [MAT-631](https://linear.app/matsunai/issue/MAT-631) | 独立QA一回とuser判断 | blocked by MAT-630 | Done |
| [MAT-660](https://linear.app/matsunai/issue/MAT-660) | 実画面の街・歩行・cutaway完成 | blocked by MAT-630 | Done |
