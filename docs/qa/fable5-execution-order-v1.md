# Fable5 完成実装の依存関係・実行順 v1

> **目的:** 品質基準（総点 85 点以上、各行 60 % 以上、分野下限、HG-01〜HG-10 の全 PASS）を
> 下げずに、最終顧客導線を最短で完成させるための実装順、責任分界、再評価点を固定する。
> これはスケジュール上のバッファを設ける文書ではない。並行作業で待ち時間をなくす一方、
> 依存する証拠・承認・素材がない状態を「完了」や runtime 採用として扱わない。

## 0. 判定の前提と現時点の状態

この文書の優先順位は、`docs/qa/fable5-acceptance-scope-v1.md` の決定記録に従う。同記録により、
この完成runでは次が決定済みである。

- 正本の町画像・座標系は `user_target_town_current`、1586×992、指定 SHA-256 である。
- 受入対象の素材は固定個数ではなく、最終 revision の可視 runtime asset set manifest で凍結する。
- footstep・door・dialogue の音と mute/volume は完成範囲に含む。
- 宿屋・市庁舎・M住宅、完全調査、保存復元、3 repository 比較、所有者の実プレイは全て完成範囲に含む。

`fable5-current-acceptance-baseline.md` の DEC-01〜04 表は、この決定より前に観測した矛盾の
記録である。本runでは未決定として再び扱わない。ただし、同ベースラインの **「同一 revision・
同一 browser session の証拠なしには PASS にしない」** という規則はそのまま有効である。

### 状態の読み方

- **Observed:** ハッシュ、実行ログ、同一 session の capture、又は記名済み人間レビューで直接
  裏付けられる事実。
- **Inferred:** 設計上の結論又はテストからの推論。顧客体験・視覚品質の PASS ではない。
- **Unknown:** 現行受入 revision について必要な観測がまだない状態。
- **UNMET:** 必要な実装、成果物、又は権限を持つ承認がまだない状態。

### 開始時の誠実な基線

| 種別 | 内容 |
|---|---|
| Observed | 既存記録には、48 prefab の offline 再合成が 1,573,312 pixel 差分 0、runtime が町マスターを直接読まないための実装・回帰テストがある。既存の宿屋入退室、閉鎖入口理由、reduced motion、touch target も中間実装として記録されている。 |
| Inferred | prefab renderer は A1/HG-03 の実装基盤を前進させるが、承認済み asset set、実ブラウザの network、自然な移動、最終顧客導線の合格を示すものではない。 |
| Unknown | 現行の完成 revision に結び付いた browser session、全可視素材の N1–N9、4方向人物、3建物、完全 quest、保存復元、両 viewport、3 repository、最終採点、所有者プレイ承認。 |
| UNMET | 同一 revision の完全 evidence packet、最終 approved runtime asset set、所有者が承認した新規素材の runtime 統合、全 HG の PASS。 |

したがって、以下の各出口条件が満たされるまで、完成・85点・Hard Gate PASS は主張しない。

## 1. 破ってはならない依存関係

### 1.1 素材の権限境界（Hard dependency）

Asset Forge は画像生成器ではなく、契約・取り込み・出自・検収・承認を管理する経路である。
次の鎖は一段も飛ばせない。

```text
asset ID / reference / contract を凍結
  → job pack
  → 所有者が許可した外部生成 session
  → hash 保持の pending import
  → 機械検収（N1–N9 を含む）
  → 人間の視覚レビュー
  → 権限を持つ人間の interactive promotion / approved export
  → frozen runtime asset manifest との照合
  → runtime binding と browser 再捕捉
```

- 生成画像、整形済み sheet、`pending` candidate、mock、legacy fallback は **承認済み素材ではない**。
- Codex、runtime worker、Asset Forge worker、QA は `promote` を実行せず、候補を runtime に入れない。
- 人間の所有者／承認権者だけが candidate の視覚的妥当性を確認し interactive promotion を行う。
- **character は画風固定の追加 Hard Gate を持つ。** 人間の terminal record は `runtime-use` に加えて
  `character-style-lock` scope を必須とし、user reference・player・NPC を整数 nearest-neighbour 400 %
  以上で対比較する。輪郭太さ、pixel cluster、頭身、顔、陰影語彙の一つでも「別の絵師」と読めれば
  reject して A2 に戻る。機械 sheet 検査だけでこの gate を通してはならない。
- candidate が不合格なら A2（生成し直し又は非破壊な処理の修正）、契約自体の欠陥なら A1 へ戻り、
  承認済み asset や既存の provenance を上書きしない。

この権限境界は工程上の待機ではなく、HG-04 と最終受入の入力条件である。並行作業で代替できない。

### 1.2 runtime 統合境界

実装を先に書くことはできるが、次の入力がない限り本番 binding を切り替えない。

| runtime 機能 | 実装を始められる条件 | 本番統合を許す条件 |
|---|---|---|
| player / innkeeper 4×10 再生器 | Fable5 sheet contract と unit fixture | 承認済み export、hash、pivot、asset-set entry |
| 市庁舎・住宅の portal / nav / collision / cutaway | world 座標・door contract・テスト用の明示 fixture | 室内 kit、visible props、NPC が approved asset set に全て載る |
| dialogue / quest state machine | repository facts の入力 contract と dialogue UI source | 実際の UI 素材、3 repository case、保存 schema |
| audio / settings / persistence | 明示 API と failure fixture | mute/volume、scoped save、実ブラウザ recovery 証拠 |

承認前の素材を仮に runtime URL へ置く、旧素材へ静かに fallback する、又は master/target を隠れた
代替画像として使うことは禁止する。asset 未承認は UI に明示的に失敗として出すか、統合前の隔離
fixture でテストする。

### 1.3 証拠境界

最終判定はコード・単体テストの合格順ではなく、同一 revision の顧客 session で集めた
`00`〜`92` evidence packet の整合性で行う。

```text
実装・承認済み素材・静的検証
  → clean な受入 revision を commit
  → revision identity を capture 開始時に固定
  → 同一 URL / browser / DPR / WorldPlan / session で golden route を連続 capture
  → network / console / error / assets / screenshots / video を同じ session に紐付け
  → independent QA の HG・rubric 再判定
  → owner が同じ revision を実プレイ
```

capture の後に runtime を変更した場合、その capture は新 revision には使えない。影響した出口から
再評価する。

## 2. 依存グラフと正しい統合順

次の DAG は **統合・判定の順番** であり、矢印がない実装作業だけ並行できる。`O` は所有者の
排他的権限を表す。

```text
S0 Git 状態記録・P0 decision record
  ├─→ S1 受入 asset set / runtime binding / evidence schema を凍結
  │     ├─→ A1 Fable5 Asset Forge job pack と import 契約
  │     │     └─→ A2 外部生成・pending import・機械検収
  │     │           └─→ A3 O: 視覚承認・promotion・approved export
  │     │                 └─→ A4 frozen approved asset manifest
  │     ├─→ R0 純粋 runtime contracts（sprites / portals / quest / persistence / audio）
  │     └─→ Q0 evidence harness / fixture / 3-repository input 準備
  ├─→ R1 approved character binding + four-way player/NPC
  ├─→ R2 approved interior kit + inn/town-hall/house spaces
  ├─→ R3 quest/dialogue + persistence + accessibility/audio
  └─→ Q1 static / asset / determinism preflight

A4 + R1 + R2 + R3 + Q1
  └─→ Q2 clean acceptance revision + single browser golden route
        └─→ Q3 independent HG-01..10 / 85-point review
              └─→ O: owner play acceptance (E8)
```

`R0` と `A1`、`Q0` は `S1` 後に並行可能である。`R1`〜`R3` の内部実装は対応する
fixture で先行できるが、approved asset manifest への統合は `A4` より後に限定する。`Q2` は
一つでも未承認素材、未解決 runtime failure、又は未通過の preflight があれば開始しない。

## 3. フェーズ別の実装順・入口・出口

### S0 — Git と評価対象の固定

**担当:** Lead（実施）、QA（読取確認）

| 項目 | 内容 |
|---|---|
| 入口 | 現在の branch / HEAD / staged・unstaged差分を確認できること。 |
| 実施順 | 1) Git 状態を記録する。2) scope v1 と本書に従う。3) 受入用 worktree と成果物の保存先を決める。4) worker の owns file を固定する。 |
| 並行可否 | Git 状態を記録した後、S1 の設計を並行可能。未整理の競合差分を抱えたまま capture は不可。 |
| 出口 | 実装変更・生成候補・受入成果物を混同しない配置、Lead の統合責任、worker の非 commit / 非 push が明記されている。 |
| 評価 | E1 の前提。ここだけでは HG / rubric の PASS はない。 |

### S1 — 受入 asset set・インタフェース・検証仕様を凍結

**担当:** Lead（決定・統合）、Asset Forge worker（契約）、runtime worker（binding contract）、QA（schema）

| 項目 | 内容 |
|---|---|
| 入口 | S0、DEC-01〜04 が適用済み。 |
| 実施順 | 1) すべての最終顧客導線の visible asset を ID 化する。2) 各 ID に runtime URL、source/derivation、pivot/layer、approval 状態、N1–N9適用性を定義する。3) character、interior、dialogue、audio、UI の binding contract を固定する。4) `00`〜`92` packet と3 repository fixture の schema を固定する。 |
| 並行可否 | A1、R0、Q0 の開始点。asset set 未凍結のまま新規絵を runtime に増やすことは不可。 |
| 出口 | `10-approved-runtime-asset-set.json` の最終形を生成できる schema と、全未充足素材の明示リストがある。job pack と runtime が同じ asset ID / contract を参照する。 |
| 評価 | **E1:** 正本、座標系、asset-set方式、音声、完成範囲を revision 付きで確認。E1 は評価可能性の PASS であって製品完成ではない。 |

### A1 — Asset Forge の Fable5 契約 preflight

**担当:** Asset Forge worker（実装・テスト）、Lead（統合）、QA（読取レビュー）

| 項目 | 内容 |
|---|---|
| 入口 | S1 の asset ID、正本 reference hash、640×512 / 4×10 / 64×128 / pivot `(32,120)` 契約。 |
| 実施順 | 1) asset ごとの job pack を作る。2) legacy identity/reference が混入しないことを検査する。3) import が pending のみへ書くこと、hash・PNG/grid/alpha/pivot/east非mirrorを fail-closed で検査することをテストする。 |
| 並行可否 | R0 / Q0 と並行可。外部生成・runtime binding より必ず先。 |
| 出口 | `doctor`・`validate`・契約 unit test・job dry-run の記録があり、job pack が画像を生成又は承認しないことが確認できる。 |
| 評価 | **E2a:** 生成前 preflight。旧 identity、mock、pending、fallback が job/runtime binding に混ざらない。 |

### A2 — 外部生成、pending import、機械検収

**担当:** 所有者（生成 session の明示許可）、Asset Forge worker（pending import / 検査）、QA（結果監査）

| 項目 | 内容 |
|---|---|
| 入口 | A1。各 asset の provider/session、費用・利用条件、reference、承認者、返却bytes を記録できること。 |
| 実施順 | 1) 所有者が外部生成の対象と session を明示許可する。2) candidate bytes を原本として保持する。3) non-destructive な整形の後、hash 検証済み `pending` に import する。4) N1–N9、40セル、全 frame pivot、east非mirror、chroma/alpha、文字/watermark/halo、同一人物性の機械可能部分を検査する。5) ignored local pending のみで終わらせず、exact bytes・metadata・job receipt を commit-backed review evidence に保存し、clean checkout でも再検査可能にする。 |
| 並行可否 | asset ごとに並行可。R0/R2/R3 の fixture 実装と並行可。A3 より前に runtime install は不可。 |
| 出口 | candidate ごとの provenance、元bytes hash、処理履歴、検査結果、reject/quarantine理由が保存される。機械検収に失敗した candidate は pending のままでも runtime へ進めない。 |
| 評価 | **E2b:** format、hash、grid、pivot、N1–N9 の機械結果。ここは人間の視覚承認ではない。 |

### A3 — 人間の視覚承認と approved export

**担当:** 所有者／承認権者のみ（promotion）、QA（review packet）、Lead（manifest 統合）

| 項目 | 内容 |
|---|---|
| 入口 | A2 の機械合格 candidate と、native/contact sheet、pivot overlay、east/west 比較、runtime 合成見本。 |
| 実施順 | 1) 人間が人物同一性、画風、輪郭、光、readability、room/interiorの密度をレビューする。2) 承認者が candidate hash を確認する。3) 承認者だけが interactive promotion を実行する。4) approved export、approval note、hash を frozen asset manifest に結び付ける。 |
| 並行可否 | asset 単位で並行可。ただし一つでも runtime が読む asset は該当 asset の承認後でなければならない。 |
| 出口 | approved metadata / export と human sign-off が存在し、pending と approved が区別される。 |
| 評価 | **E2c:** 人間視覚承認。A3 完了前の素材は全て UNMET と扱う。 |

### R0 — 素材に依存しない runtime 基盤を実装する

**担当:** runtime worker（実装・unit test）、Lead（統合）、QA（failure-path review）

| 項目 | 内容 |
|---|---|
| 入口 | S1 の各 interface と fixture。 |
| 実施順 | 1) 4×10 sprite selector / timing / pivot API。2) 3 building 共通 portal・camera・collision model。3) quest state machine と observed/inferred/unknown model。4) repository+digest namespace persistence。5) user gesture 後のみ鳴る audio feedback と設定。6) accessibility/failure API を、素材 URL なしでも unit test する。 |
| 並行可否 | A1/A2/Q0 と並行可。R0 が asset approval を代替することはない。 |
| 出口 | 全 API が fail-closed、明示 dependency injection、既存導線を壊さない回帰テストを持つ。 |
| 評価 | 静的・unit のみ。E3〜E6/HG-05〜08 の browser PASS はまだない。 |

### R1 — 承認済み人物を統合し、自然な4方向操作を完成する

**担当:** runtime worker（実装）、Lead（approved binding 照合・統合）、QA（capture）

| 項目 | 内容 |
|---|---|
| 入口 | R0 と A3。approved player / innkeeper export が manifest にある。 |
| 実施順 | 1) runtime binding を approved URL/hash のみへ更新する。2) idle2@4fps、walk6@10fps、interact2@6fps、4 direction、pivotを再生する。3) player/NPC/foreground/cutaway の draw order と keyboard/click/touch/reduced-motion を結合する。 |
| 並行可否 | R2/R3 と並行可だが、同じ app entry の統合は Lead が直列化する。 |
| 出口 | approved asset 以外の fallback がなく、contract/unit test と両 viewport browser smoke が通る。 |
| 評価 | **E3:** 60fps capture で向き、10fps、pivot drift ≤2px、足滑りなし、integer zoom を確認。HG-05 は E3 と後続 golden route の両方が揃うまで PASS にしない。 |

### R2 — 宿屋・市庁舎・M住宅を同一空間契約で完成する

**担当:** runtime worker（実装）、Asset Forge worker（必要素材の契約・pending 管理）、Lead（統合）、QA（navigation）

| 項目 | 内容 |
|---|---|
| 入口 | R0。各室内に必要な visible asset は A3 済みかつ A4 の frozen manifest に記載済み、又は asset gap として A1〜A3 へ戻されている。 |
| 実施順 | 1) 既存宿屋を新 portal contract に揃える。2) 市庁舎、M住宅に exterior threshold、interior rectangle、collision、spawn、NPC、camera、exitを定義する。3) active building のみ roof/cutaway、正しい前景・door alignment・corner movement を実装する。 |
| 並行可否 | R1/R3 と並行可。未承認 interior image を使う完成 screenshot は不可。 |
| 出口 | 3 building を spawn から入室、移動、対話、退出でき、各 room の asset binding と外観 footprint が追跡可能。 |
| 評価 | **E4:** 10 corner approaches、door/nav/collision overlay、3 building連続入退室、cutaway・camera を同一 revision で確認。HG-06 は golden route まで暫定。 |

### R3 — 調査、会話、保存、回復、アクセシビリティを顧客導線として結合する

**担当:** runtime worker（実装）、Lead（3-repo product decision）、QA（stress/recovery）

| 項目 | 内容 |
|---|---|
| 入口 | R0。市庁舎で答えを返すため R2 の portal が機能していること。 |
| 実施順 | 1) 宿屋会話で quest を開始し、選択で次の行動を変える。2) 手帳→問い→3調査→市庁舎回答→結果説明を状態機械に結ぶ。3) observed/inferred/unknown と根拠を UI・保存値の双方で区別する。4) repo/digest scoped save、restore、確認付き reset、invalid/save failure の回復を結合する。5) keyboard/focus/touch/reduced-motion、audio unlock/mute/volume を結合する。 |
| 並行可否 | R1/R2 と並行可。ただし end-to-end quest capture は R2 と全 required UI asset の後。 |
| 出口 | 3 repository fixture で内容差が追跡可能で、新規開始・復元開始・reset・failure の各経路が unit と browser smoke で確認できる。 |
| 評価 | **E5/E6:** dialogue の長文・選択肢、完全quest、3 repo、reload/resize/settings/failure/accessibility/audio。HG-07/08/09 の判定入力を作る。 |

### Q0 / Q1 — 受入を自動化し、最終 capture 前に fail-fast する

**担当:** QA worker（実装・実行）、Lead（統合）、runtime / Asset Forge worker（各失敗を修正）

| 項目 | 内容 |
|---|---|
| 入口 | S1。Q0 は R/A の完成を待たずに開始する。 |
| 実施順 | 1) evidence packet schema validator、identity/hash/index validator を実装する。2) asset-set と N1–N9 の機械 report を接続する。3) deterministic same-WorldPlan render hash、network allow/deny list、console/error 検査を実装する。4) 3 repository fixture、viewport、reduced motion、touch、failure scenario を golden route harness にする。5) preflight を clean revision で実行する。 |
| 並行可否 | A1〜R3 と並行可。Q1 の結果は修正先へ直ちに戻す。 |
| 出口 | capture が必要とする `00`〜`50` を作成・検証でき、未記名 owner approval のとき accepted=false を維持する。 |
| 評価 | **Q1 preflight:** `npm run check`、Forge validate/check、prefab reconstruction、asset checks、render determinism、browser smoke。失敗時は対象 A/R フェーズへ戻る。 |

### Q2 / Q3 — 同一 revision の実ブラウザ受入と独立再判定

**担当:** Lead（受入 revision と統合）、QA（capture と独立判定）、所有者（最終確認）

| 項目 | 内容 |
|---|---|
| 入口 | A3、R1、R2、R3、Q1 が全て出口済み。worktree は capture 対象として固定できる。 |
| 実施順 | 1) Lead が clean acceptance revision を commit する。2) QA が capture 開始時と終了時に HEAD/worktree/browser/DPR/URL/WorldPlan を記録する。3) 1280×720 と 1920×1080、3 repo、4方向移動、3 blocker、3 building、dialogue、quest、reload/resize/audio/settings/recoveryを一つの連続 session で捕捉する。4) network/console/errors/asset hashes と packet index を照合する。5) QA が rubric と HG を独立に採点する。 |
| 並行可否 | capture 中は runtime・asset の変更不可。QA 採点と owner のプレイ準備は、同じ固定 revision を前提に並行可。 |
| 出口 | `00`〜`91` が単一 session / revision に結び付き、HG-01〜HG-09 が全て PASS、rubric が総点≥85・分野下限・各行≥60% を満たす。 |
| 評価 | **E7:** 最終 Hard Gate 再判定。どれか一つが UNKNOWN / UNMET / FAIL なら E8 に進めない。 |

### E8 — 所有者の実プレイ受入

**担当:** 所有者（排他的承認）、Lead（記録）、QA（証拠整合確認）

| 項目 | 内容 |
|---|---|
| 入口 | Q3 の全 PASS と、同じ revision / URL の実行環境。 |
| 実施順 | 所有者が開始、移動、3建物、対話、調査、回答、保存/復元/reset、音量/アクセシビリティ、失敗表示を実際にプレイする。承認又は差し戻しを `92-owner-play-approval.md` に記録する。 |
| 並行可否 | 不可。これは人間の最終意思決定である。 |
| 出口 | 記名済み承認、対象 HEAD、プレイ範囲、既知の制約、時刻が packet にある。差し戻しなら該当 A/R/Q フェーズへ戻り、Q2/Q3 を全て再実行する。 |
| 評価 | **E8:** この出口でのみ完成を宣言できる。未記名の場合は `accepted=false`。 |

## 4. Hard Gate と Eval の割当表

| Gate / Eval | 最初に評価可能になる時点 | PASS を確定する時点 | 主担当 | 必須の戻り先 |
|---|---|---|---|---|
| E1 | S1 | S1 | Lead + QA | S0/S1 |
| E2a | A1 | A1 | Asset Forge worker + QA | A1 |
| E2b | A2 | A2 | Asset Forge worker + QA | A2 |
| E2c | A3 | A3 | Owner + QA | A2/A3 |
| E3 / HG-05 | R1 | Q2/Q3 | runtime worker + QA | A2/A3/R1 |
| E4 / HG-06 | R2 | Q2/Q3 | runtime worker + QA | A1〜A3/R2 |
| E5 / HG-07/HG-09 | R3 | Q2/Q3 | runtime worker + QA | R2/R3 |
| E6 / HG-08 | R3 + Q1 | Q2/Q3 | runtime worker + QA | R1〜R3/Q0 |
| HG-01 | Q2 identity capture | Q3 | QA | S0/Q0/Q2 |
| HG-02 | Q2 session capture | Q3 | QA | Q0/Q2 |
| HG-03 | A4 + Q1 | Q3 | Lead + QA | A3/R1〜R3/Q0 |
| HG-04 | A4 + Q1 | Q3 | Asset Forge worker + Owner + QA | A1〜A4 |
| HG-10 | Q3 verdict draft | E8 | Lead + QA + Owner | Q2/Q3/E8 |
| E7 | Q2 | Q3 | QA | 対象 Gate の戻り先 |
| E8 | E7 | E8 | Owner | 差し戻された対象フェーズ |

HG-10 は他の Gate の「自動的なまとめ」ではない。HG-01〜09 の未完や owner 未記名を隠さず、
`accepted=false` を維持すること自体が PASS 条件の一部である。

## 5. 担当割当と作業境界

| 役割 | 所有する判断・成果 | 禁止事項 |
|---|---|---|
| **Lead** | Git 整理、依存順の管理、asset/runtime/evidence の統合、競合解消、commit、最終 release 判断の記録。 | worker の未検証成果を PASS と呼ぶこと、owner の承認を代行すること。 |
| **Asset Forge worker** | job/import/validation、provenance、pending/quarantine、asset contract とテスト。 | 画像生成を Asset Forge がしたと偽ること、promotion、approved asset の runtime install、commit/push。 |
| **runtime worker** | 純粋 model、renderer、interaction、3 building、quest/persistence/audio/accessibility、その unit/contract test。 | pending/legacy/master/target を fallback として読むこと、他 worker の所有ファイルを編集すること、commit/push。 |
| **QA worker** | evidence schema/harness、asset/network/console/determinism 検査、browser capture、HG/rubric の独立判定。 | 静的テストだけで顧客体験を PASS とすること、capture 後の変更を同じ証拠へ混ぜること、commit/push。 |
| **所有者／承認権者** | 外部生成 session の許可、候補の人間視覚審査、interactive promotion、最終実プレイ受入。 | provenance のない候補を approved と扱うこと。 |

同じ app entry など競合しやすい統合点は Lead が直列に取り込む。worker は割当済み owns files
だけを編集し、変更の根拠・実行したテスト・既知の Unknown を Lead に報告する。

## 6. Fail-fast と再実行の規則

- **素材検査失敗:** runtime を修正して隠さない。A2 に戻り、処理・candidate・prompt のどれが原因かを
  provenance に残す。
- **人間レビュー差し戻し:** A3 から A2/A1 に戻る。未承認 candidate は runtime に入れない。
- **3 building / quest / save の実装失敗:** 影響する R フェーズだけを修正して unit/preflight を再実行する。
- **network、console、determinism、asset allowlist の失敗:** Q1 から原因となる A/R へ戻る。例外リストで
  隠さない。
- **capture の session/identity 不整合:** Q2 を破棄し、固定 revision から再捕捉する。
- **owner の差し戻し:** 対象の A/R フェーズへ戻り、変更後は Q1、Q2、Q3、E8 を再実行する。

この規則により、急ぐために依存関係を破壊するのではなく、失敗を最も近い原因へ即時に戻して
再統合コストを最小にする。

## 7. 完成と未完の境界

次の全てが同じ Git revision で揃ったときだけ、最終顧客体験は完成である。

- approved runtime asset set の全 entry に contract、provenance、hash、必要な N1–N9、承認がある。
- prefab-only world、承認済み人物、3 building、完全 quest、保存復元、音声・アクセシビリティが
  実ブラウザで一続きに動く。
- 1280×720 と 1920×1080、3 repository、network/console/error/reload/resize/failure の証拠が
  単一 session と revision に結び付く。
- HG-01〜HG-10 が全 PASS、rubric は総点 85 以上・分野下限・各行 60 % 以上である。
- 所有者が同じ revision を実プレイして、記名承認している。

それ以前は、個別の実装・テスト・pending candidate・中間 screenshot がどれだけ増えても、
該当フェーズの Observed progress であり、完成宣言の根拠ではない。
